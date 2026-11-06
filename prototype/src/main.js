/* Точка входа: машина состояний, ввод, главный цикл. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG, clamp } from './state.js';
import { W, initWorld, setMood, updateAtmosphere, renderFrame, checkShaderHealth } from './world.js';
import { initUI, hud, toast, show, hide, hideAll, refreshHud, renderUpgrade, ending, bossBar, setObjective, costOf, flash } from './ui.js';
import { initAudio, updateAudio, setVolume, sfx } from './audio.js';
import { updateFx, updateMemoryTrails, tickHitstop } from './fx.js';
import { recordHistory } from './rewind.js';
import {
  updatePlayer, updateSculpt, updateRewind, recordPlayer, resetPlayer,
  startSculpt, endSculpt, condense, spawnEcho, beginRewind, endRewind,
  jump, dash, isRewinding, toggleMemory, applyImpulse
} from './player.js';
import { updateCrystals, updatePending } from './combat.js';
import { initHands, updateHands, getHands } from './hands.js';
import { updateEnemies, clearEnemies } from './enemies.js';
import { updateBoss } from './boss.js';
import { ZONES, loadZone, updateZone, clearZone, crumbleArena } from './level.js';

const canvas = document.getElementById('c');
let pendingZone = 0;
let core = null;
let coreHint = false;

/* ------------------------------------------------------------------ */
/*  СТАРТ                                                             */
/* ------------------------------------------------------------------ */
initWorld();
initUI();
initHands();

S.hooks.rewinding = isRewinding;
S.hooks.respawn = (reason) => {
  const sp = ZONES[S.zone].spawn;
  resetPlayer(sp.x, sp.y, sp.z);
  toast('мир запомнил: ' + reason);
};
S.hooks.buy = (id) => {
  const lvl = S.upgrades[id];
  if (lvl >= 3) return;
  const c = costOf(id, lvl);
  if (S.stats.sec < c.sec || S.stats.paradox < c.par) {
    toast('не хватает осколков');
    return;
  }
  S.stats.sec -= c.sec;
  S.stats.paradox -= c.par;
  S.upgrades[id]++;
  S.player.mass = CFG.MASS_MAX + S.upgrades.flood * 8;
  sfx('buy');
  renderUpgrade();
};
S.hooks.impulse = applyImpulse;   // взрывы/парадокс отбрасывают игрока
S.hooks.nextZone = () => nextZone();
S.hooks.crumble = () => crumbleArena();
S.hooks.onBossDown = () => onBossDown();

/* ------------------------------------------------------------------ */
/*  ЭКРАНЫ                                                            */
/* ------------------------------------------------------------------ */
const startBtn = document.getElementById('startBtn');
const contBtn = document.getElementById('contBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const againBtn = document.getElementById('againBtn');
const sensEl = document.getElementById('sens');
const volEl = document.getElementById('vol');

let lockFailed = false;
function lockPointer() {
  if (lockFailed || !canvas.requestPointerLock) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { lockFailed = true; });
  } catch (e) {
    lockFailed = true;
  }
}

startBtn.addEventListener('click', () => {
  initAudio();
  S.stats = { sec: 0, paradox: 0, kills: 0, deaths: 0, nodes: 0, bossDown: false };
  S.upgrades = { stasis: 0, flood: 0, decay: 0 };
  S.time = 0;
  hideAll();
  hud(true);
  loadZone(0);
  S.mode = 'play';
  lockPointer();
});

contBtn.addEventListener('click', () => {
  initAudio();
  hideAll();
  hud(true);
  loadZone(pendingZone);
  S.mode = 'play';
  lockPointer();
});

resumeBtn.addEventListener('click', () => {
  hideAll();
  hud(true);
  S.mode = 'play';
  lockPointer();
});

restartBtn.addEventListener('click', () => {
  hideAll();
  hud(true);
  loadZone(S.zone);
  S.mode = 'play';
  lockPointer();
});

againBtn.addEventListener('click', () => location.reload());

if (sensEl) sensEl.addEventListener('input', () => { S.settings.sens = Number(sensEl.value) / 1000; });
if (volEl) volEl.addEventListener('input', () => { setVolume(Number(volEl.value) / 100); });

document.addEventListener('pointerlockerror', () => {
  lockFailed = true;
  toast('курсор не захвачен — мышь всё равно управляет обзором', 4);
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && S.mode === 'play') {
    S.mode = 'pause';
    hud(false);
    show('pause');
    if (endRewind) endRewind();
  }
});

/* ------------------------------------------------------------------ */
/*  ВВОД                                                              */
/* ------------------------------------------------------------------ */
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (S.keys[e.code]) return;
  S.keys[e.code] = true;

  if (S.mode !== 'play') return;
  if (e.code === 'KeyQ') beginRewind();
  if (e.code === 'KeyE') spawnEcho();
  if (e.code === 'Space') jump();
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dash();
  if (e.code === 'KeyF' && core) toast('1 — стабилизировать · 2 — довести коллапс');
  if (core && nearCore()) {
    if (e.code === 'Digit1') finish('stable');
    if (e.code === 'Digit2') finish('chaos');
  }
});

document.addEventListener('keyup', (e) => {
  S.keys[e.code] = false;
  if (e.code === 'KeyQ') endRewind();
});

document.addEventListener('mousemove', (e) => {
  if (S.mode !== 'play') return;
  /* работает и без pointer lock (например, в iframe) — берём дельты */
  const mx = Math.abs(e.movementX || 0) > 220 ? 0 : (e.movementX || 0);
  const my = Math.abs(e.movementY || 0) > 220 ? 0 : (e.movementY || 0);
  S.yaw -= mx * S.settings.sens;
  S.pitch -= my * S.settings.sens;
  S.pitch = clamp(S.pitch, -1.45, 1.45);
});

document.addEventListener('mousedown', (e) => {
  if (S.mode !== 'play') return;
  if (document.pointerLockElement !== canvas) lockPointer();
  if (e.button === 0) startSculpt();
  if (e.button === 2) condense();
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) endSculpt();
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------------------------------------------ */
/*  ПЕРЕХОДЫ                                                          */
/* ------------------------------------------------------------------ */
function nextZone() {
  const next = S.zone + 1;
  if (next >= ZONES.length) return;
  pendingZone = next;
  S.mode = 'upgrade';
  if (document.exitPointerLock) document.exitPointerLock();
  hud(false);
  hideAll();
  renderUpgrade();
  show('upgrade');
  sfx('portal');
}

function onBossDown() {
  toast('Хор-Ноль замолчал');
  setObjective('Подойди к ядру', '1 — стабилизировать · 2 — довести коллапс');
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), W.M.violet);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.09, 8, 64), W.M.glow);
  ring.rotation.x = Math.PI / 2;
  const light = new THREE.PointLight(0xbb66ff, 40, 60, 2);
  g.add(orb, ring, light);
  g.position.set(0, 7, -46);
  W.scene.add(g);
  core = { group: g, orb, ring, pos: g.position.clone() };
}

function nearCore() {
  if (!core) return false;
  return S.player.pos.distanceTo(core.pos) < 9;
}

function finish(kind) {
  S.mode = 'ending';
  if (document.exitPointerLock) document.exitPointerLock();
  hud(false);
  const mins = Math.floor(S.time / 60);
  const secs = Math.floor(S.time % 60);
  const stats =
    'время: ' + mins + ':' + String(secs).padStart(2, '0') + '<br>' +
    'индекс разлома: ' + Math.round(S.rift) + '%<br>' +
    'осколки: ' + S.stats.sec + ' секунд · ' + S.stats.paradox + ' противоречий<br>' +
    'узлов разрушено: ' + S.stats.nodes + ' · врагов отменено: ' + S.stats.kills + '<br>' +
    'смертей: ' + S.stats.deaths;

  if (kind === 'stable') {
    ending('ШОВ',
      'Ты держишь ядро. Восемь секунд, потом ещё восемь, потом ещё. Каждая перемотка теперь — не побег, а стежок: мир зашивается вокруг тебя, медленно, криво, но зашивается. Где-то в глубине Хор всё ещё поёт — но уже не тебе. Здания перестают расти. Впервые за тысячу лет здесь что-то стоит на месте.',
      stats);
  } else {
    ending('НОВЫЙ ЗАКОН',
      'Ты не держишь ничего. Пузырь растёт: 18 метров, 40, километр. Перемотка больше не кончается — кончается мир, который она отменяет. Хор складывается внутрь себя, как письмо, и ты занимаешь его место: не здание, не человек, а правило. С этого дня падать можно вверх. С этого дня всё, что умирает, обязано сначала прожить это заново.',
      stats);
  }
}

/* ------------------------------------------------------------------ */
/*  ЦИКЛ                                                              */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let frameCount = 0;

function loop() {
  requestAnimationFrame(loop);
  /* через несколько кадров проверяем, что кастомные шейдеры собрались */
  if (++frameCount === 8) checkShaderHealth();
  const raw = Math.min(0.05, clock.getDelta());

  /* hitstop: мир замирает на 40–70 мс, камера при этом продолжает дрожать */
  const frozen = tickHitstop(raw);

  if (S.mode === 'play') {
    const mem = !!S.keys['Tab'];
    toggleMemory(mem);
    const dt = frozen ? 0 : raw * (mem ? 0.25 : 1);

    S.time += dt;
    S.zoneTime += dt;

    updatePlayer(dt);
    updateSculpt(dt);
    updateRewind(dt);
    updateCrystals(dt);
    updatePending(dt);
    updateEnemies(dt);
    updateBoss(dt);
    updateZone(dt);
    updateFx(dt, raw);
    updateMemoryTrails(dt);
    updateHands(dt);

    recordHistory(S.time);
    recordPlayer(S.time);

    refreshHud(raw);
    updateAudio();

    if (S.boss && S.boss.alive) {
      bossBar(true, S.boss.ratio, 'ХОР-НОЛЬ · ПЕРВЫЙ СВИДЕТЕЛЬ');
    } else {
      bossBar(false, 0);
    }

    if (core) {
      core.orb.rotation.y += raw * 0.6;
      core.ring.rotation.z += raw * 0.8;
      const near = nearCore();
      if (near && !coreHint) {
        coreHint = true;
        toast('1 — стабилизировать · 2 — довести коллапс', 3);
      }
      if (!near) coreHint = false;
    }
  } else {
    updateFx(raw, raw);
    updateMemoryTrails(0);
    updateHands(0);   // вне игры шлейфы гасим
    if (core) {
      core.orb.rotation.y += raw * 0.4;
    }
  }

  updateAtmosphere(raw);
  renderFrame();
}

loop();

/* отладка */
window.__AP = {
  S, W, THREE, get state() { return S.mode; },
  get hands() { return getHands(); },
  get enemies() { return S.enemies; },
  get planks() { return []; },
  loadZone, finish, nextZone,
  get core() { return core; }
};
