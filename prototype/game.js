/* =====================================================================
   АРХИТЕКТОР ПАРАДОКСОВ — играбельный прототип (вертикальный срез)
   three.js r160 · один файл · без ассетов
   ===================================================================== */
import * as THREE from './vendor/three.module.js';

/* ------------------------------------------------------------------ */
/*  КОНСТАНТЫ                                                          */
/* ------------------------------------------------------------------ */
const RIFT_RADIUS = 18;      // радиус пузыря разлома, м
const MAX_REWIND = 8;        // глубина перемотки, с
const GRAVITY = 26;
const MOVE_SPEED = 6.4;
const PLAYER_H = 1.7;
const PLAYER_R = 0.4;
const EYE = 1.55;
const ECHO_LIMIT = 3;
const ECHO_LIFE = 12;
const CRYSTAL_FUSE = 4.0;

/* ------------------------------------------------------------------ */
/*  РЕНДЕР                                                             */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_A = new THREE.Color(0x0a0620);
const FOG_B = new THREE.Color(0x2b0736);
scene.background = FOG_A.clone();
scene.fog = new THREE.FogExp2(FOG_A.getHex(), 0.016);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 700);
scene.add(camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ------------------------------------------------------------------ */
/*  СВЕТ                                                               */
/* ------------------------------------------------------------------ */
scene.add(new THREE.AmbientLight(0x2b1b55, 1.1));
const hemi = new THREE.HemisphereLight(0x6a3fd0, 0x0b0620, 0.9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xbfa6ff, 1.0);
key.position.set(-30, 60, 20);
scene.add(key);
const coreLight = new THREE.PointLight(0xb46bff, 60, 90, 2);
coreLight.position.set(0, 9, -34);
scene.add(coreLight);
const copperLight = new THREE.PointLight(0xff9a4d, 30, 55, 2);
copperLight.position.set(0, 6, -6);
scene.add(copperLight);

/* ------------------------------------------------------------------ */
/*  МАТЕРИАЛЫ                                                          */
/* ------------------------------------------------------------------ */
const M = {
  stone: new THREE.MeshStandardMaterial({ color: 0x211a44, roughness: 0.92, metalness: 0.18 }),
  stone2: new THREE.MeshStandardMaterial({ color: 0x2b2154, roughness: 0.85, metalness: 0.25 }),
  copper: new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.42, metalness: 0.95, emissive: 0x2a0d05, emissiveIntensity: 0.5 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xcfc3d8, roughness: 0.7, metalness: 0.1 }),
  violet: new THREE.MeshStandardMaterial({ color: 0x2a0a4a, emissive: 0x9b3cff, emissiveIntensity: 1.5, roughness: 0.4 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xc9a0ff }),
  sculpt: new THREE.MeshStandardMaterial({ color: 0x6a5a9a, emissive: 0x3a1d6b, emissiveIntensity: 0.8, roughness: 0.55, metalness: 0.35 }),
  crystal: new THREE.MeshStandardMaterial({ color: 0x7a2fbf, emissive: 0xff33cc, emissiveIntensity: 2.0, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.9 }),
  echo: new THREE.MeshStandardMaterial({ color: 0x8b6bff, emissive: 0x7a3cff, emissiveIntensity: 1.4, transparent: true, opacity: 0.34, roughness: 0.3, depthWrite: false }),
  echoGhost: null,
  enemy: new THREE.MeshStandardMaterial({ color: 0x3a2740, roughness: 0.6, metalness: 0.5, emissive: 0x220a22, emissiveIntensity: 0.9 }),
  enemyGlow: new THREE.MeshStandardMaterial({ color: 0x501020, emissive: 0xff2b5c, emissiveIntensity: 1.8, roughness: 0.4 }),
  mem: new THREE.MeshStandardMaterial({ color: 0x9b8bd0, emissive: 0x6a2fa0, emissiveIntensity: 1.1, transparent: true, opacity: 0.55, roughness: 0.2 }),
  rev: new THREE.MeshStandardMaterial({ color: 0x8fa0c0, emissive: 0x2a5bd0, emissiveIntensity: 1.2, transparent: true, opacity: 0.7, roughness: 0.3 }),
};
M.echoGhost = new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false });

/* ------------------------------------------------------------------ */
/*  МИР                                                                */
/* ------------------------------------------------------------------ */
const colliders = [];        // { min, max, solid, mesh }
const solidMeshes = [];      // для рейкаста
const raycastTargets = [];

function box(w, h, d, x, y, z, mat, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.rotY) m.rotation.y = opts.rotY;
  m.updateMatrixWorld(true);
  scene.add(m);
  if (opts.solid !== false) {
    const b = new THREE.Box3().setFromObject(m);
    const c = { min: b.min, max: b.max, solid: true, mesh: m };
    colliders.push(c);
    solidMeshes.push(m);
    raycastTargets.push(m);
    m.userData.collider = c;
  }
  return m;
}

/* --- платформы уровня --- */
box(26, 2, 26, 0, -1, 30, M.stone);          // A — старт
box(30, 2, 20, 0, -1, -7, M.stone2);         // B — арена
box(22, 2, 22, 0, 3, -34, M.stone);          // C — ядро
box(3, 12, 3, -14, 5, -22, M.copper, { solid: true });   // колонны
box(3, 16, 3, 14, 7, -22, M.copper, { solid: true });
box(2, 9, 2, -16, 3.5, 12, M.copper, { solid: true });
box(2, 9, 2, 16, 3.5, 12, M.copper, { solid: true });

/* «растущие» коралловые башни — без коллизии, для силуэта */
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2;
  const r = 26 + Math.random() * 16;
  const h = 12 + Math.random() * 34;
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.6 + Math.random() * 2, h, 6, 1, true), M.stone2);
  t.position.set(Math.cos(a) * r, -2 + h / 2, -14 + Math.sin(a) * r);
  t.rotation.z = (Math.random() - 0.5) * 0.25;
  scene.add(t);
  const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), M.violet);
  tip.position.copy(t.position).add(new THREE.Vector3(0, h / 2, 0));
  scene.add(tip);
}

/* парящий мусор */
const debris = [];
for (let i = 0; i < 26; i++) {
  const s = 0.4 + Math.random() * 1.4;
  const d = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 1.3), M.copper);
  d.position.set((Math.random() - 0.5) * 60, -6 + Math.random() * 26, (Math.random() - 0.5) * 70);
  d.userData.spin = new THREE.Vector3(Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4);
  d.userData.base = d.position.clone();
  d.userData.ph = Math.random() * 6.28;
  scene.add(d);
  debris.push(d);
}

/* пыль */
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(1400 * 3);
for (let i = 0; i < 1400; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 120;
  dustPos[i * 3 + 1] = -10 + Math.random() * 45;
  dustPos[i * 3 + 2] = -70 + Math.random() * 130;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0xb492ff, size: 0.16, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
}));
scene.add(dust);

/* ядро */
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), M.violet);
core.position.set(0, 9, -34);
scene.add(core);
const coreRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.09, 8, 64), M.glow);
coreRing.position.copy(core.position);
coreRing.rotation.x = Math.PI / 2;
scene.add(coreRing);

/* ------------------------------------------------------------------ */
/*  РЕЕСТР ОБЪЕКТОВ, КОТОРЫЕ МИР ПОМНИТ (перемотка)                    */
/* ------------------------------------------------------------------ */
const rewindables = [];

function addRewindable(kind, obj, getState, applyState, anchor) {
  const r = {
    kind, obj, getState, applyState,
    anchor: anchor || obj.position,
    hist: [], lastT: -99, touched: false, dead: false
  };
  rewindables.push(r);
  return r;
}
function prefill(r, state, now, seconds, rate) {
  seconds = seconds || 9; rate = rate || 25;
  for (let i = Math.ceil(seconds * rate); i >= 1; i--) r.hist.push({ t: now - i / rate, s: state });
}
function recordHistory(t) {
  for (let i = 0; i < rewindables.length; i++) {
    const r = rewindables[i];
    if (r.dead || r.kind === 'prop') continue;
    if (t - r.lastT < 0.04) continue;
    r.lastT = t;
    r.hist.push({ t, s: r.getState() });
    if (r.hist.length > 320) r.hist.shift();
  }
}
function sampleAt(r, t) {
  const h = r.hist;
  if (!h.length || h[0].t > t) return null;
  let lo = 0, hi = h.length - 1, best = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (h[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return h[best];
}
function sampleValue(arr, t) {
  if (!arr.length || arr[0].t > t) return null;
  let lo = 0, hi = arr.length - 1, best = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return arr[best];
}

/* ------------------------------------------------------------------ */
/*  МОСТ, КОТОРЫЙ РУХНУЛ 4 СЕКУНДЫ НАЗАД                               */
/* ------------------------------------------------------------------ */
const planks = [];
const plankRews = [];
for (let i = 0; i < 6; i++) {
  const z = 16.6 - i * 2.62;
  const m = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 2.75), M.copper);
  m.position.set(0, -0.225, z);
  m.updateMatrixWorld(true);
  scene.add(m);
  const c = { min: new THREE.Box3().setFromObject(m).min, max: new THREE.Box3().setFromObject(m).max, solid: true, mesh: m };
  colliders.push(c);
  raycastTargets.push(m);

  const intactP = new THREE.Vector3(0, -0.225, z);
  const fallP = new THREE.Vector3((Math.random() - 0.5) * 3, -16 - Math.random() * 8, z + (Math.random() - 0.5) * 2);
  const fallR = new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3);

  const plank = {
    mesh: m, collider: c, intactP, fallP, fallR,
    state: 'broken', fixed: false
  };
  planks.push(plank);

  const applyState = (st) => {
    if (!st) return;
    if (st.v) plank.fixed = true;
    const v = !!(st.v || plank.fixed);
    if (v) {
      m.position.copy(intactP);
      m.rotation.set(0, 0, 0);
      plank.state = 'intact';
    } else {
      m.position.copy(fallP);
      m.rotation.copy(fallR);
      plank.state = 'broken';
    }
    c.solid = v;
    const bb = new THREE.Box3().setFromObject(m);
    c.min.copy(bb.min); c.max.copy(bb.max);
  };

  const r = addRewindable('prop', m, () => ({ v: plank.state === 'intact' }), applyState, new THREE.Vector3(0, 0.1, z));
  applyState({ v: false });
  plank.state = 'broken';
  plankRews.push({ r, applyState });
}

/* Мост рушится «на глазах»: в момент, когда игрок подходит к краю,
   мир только что потерял его. Перемотка на 4+ секунды вернёт пролёты. */
let bridgeArmed = false;
function armBridge(now) {
  if (bridgeArmed) return;
  bridgeArmed = true;
  toast('мост рухнул 4 секунды назад · держи Q');
}

/* пунктирные «призраки» моста для слоя памяти */
const plankGhosts = planks.map(p => {
  const g = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 2.35), M.echoGhost);
  g.position.copy(p.intactP);
  g.visible = false;
  scene.add(g);
  return g;
});

/* ------------------------------------------------------------------ */
/*  ИГРОК                                                              */
/* ------------------------------------------------------------------ */
const START = new THREE.Vector3(0, 0.1, 30);
const player = {
  pos: START.clone(),
  vel: new THREE.Vector3(),
  onGround: false,
  hp: 100,
  maxHp: 100,
  charge: 100,
  mass: 40,
  dead: false
};
let yaw = 0, pitch = 0;
let state = 'menu';          // menu | play | pause | ending
let time = 0;
let timeScale = 1;

/* история игрока (для лечения перемоткой и для эха) */
const poseHist = [];
const hpHist = [];

/* ------------------------------------------------------------------ */
/*  ЭФФЕКТЫ                                                            */
/* ------------------------------------------------------------------ */
const fx = [];
function shockwave(pos, radius, color, life) {
  const geo = new THREE.RingGeometry(0.3, 0.9, 40);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  scene.add(m);
  fx.push({ mesh: m, t: 0, life: life || 0.55, radius, type: 'ring' });

  const g2 = new THREE.IcosahedronGeometry(0.4, 1);
  const m2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m2.position.copy(pos);
  scene.add(m2);
  fx.push({ mesh: m2, t: 0, life: (life || 0.55) * 0.8, radius, type: 'orb' });
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = f.t / f.life;
    if (k >= 1) { scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); fx.splice(i, 1); continue; }
    if (f.type === 'ring') {
      const s = 0.4 + k * f.radius;
      f.mesh.scale.set(s, s, s);
      f.mesh.material.opacity = 0.95 * (1 - k);
      f.mesh.quaternion.copy(camera.quaternion);
    } else {
      const s = 1 + k * f.radius * 0.5;
      f.mesh.scale.set(s, s, s);
      f.mesh.material.opacity = 0.9 * (1 - k);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  HUD                                                                */
/* ------------------------------------------------------------------ */
const ui = {
  hud: document.getElementById('hud'),
  hpFill: document.getElementById('hpFill'),
  chFill: document.getElementById('chargeFill'),
  msFill: document.getElementById('massFill'),
  hpTxt: document.getElementById('hpTxt'),
  chTxt: document.getElementById('chTxt'),
  msTxt: document.getElementById('msTxt'),
  riftFill: document.getElementById('riftFill'),
  riftTxt: document.getElementById('riftTxt'),
  sh1: document.getElementById('sh1'),
  sh2: document.getElementById('sh2'),
  toast: document.getElementById('toast'),
  stitch: document.getElementById('stitch'),
  objSub: document.getElementById('objSub'),
  echoes: Array.from(document.querySelectorAll('.echo')),
  menu: document.getElementById('menu'),
  ending: document.getElementById('ending'),
  endTitle: document.getElementById('endTitle'),
  endText: document.getElementById('endText'),
  endStats: document.getElementById('endStats'),
};

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  toastTimer = 1.6;
}

const shards = { sec: 0, paradox: 0 };
let rift = 0;
let kills = 0;

function addRift(n) {
  rift = Math.min(100, Math.max(0, rift + n));
}

function updateHud(dt) {
  ui.hpFill.style.transform = 'scaleX(' + Math.max(0, player.hp / player.maxHp) + ')';
  ui.chFill.style.transform = 'scaleX(' + Math.max(0, player.charge / 100) + ')';
  ui.msFill.style.transform = 'scaleX(' + Math.max(0, player.mass / 40) + ')';
  ui.hpTxt.textContent = Math.max(0, Math.round(player.hp));
  ui.chTxt.textContent = Math.max(0, Math.round(player.charge));
  ui.msTxt.textContent = Math.max(0, Math.round(player.mass));
  ui.riftFill.style.height = rift + '%';
  ui.riftTxt.textContent = Math.round(rift) + '%';
  ui.sh1.textContent = shards.sec;
  ui.sh2.textContent = shards.paradox;

  for (let i = 0; i < ui.echoes.length; i++) {
    ui.echoes[i].classList.toggle('on', i < echoes.length);
  }
  ui.stitch.classList.toggle('on', inStitch(player.pos));

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove('on');
  }
}

/* ------------------------------------------------------------------ */
/*  АУДИО — процедурный саундтрек, который ломается вместе с миром     */
/* ------------------------------------------------------------------ */
let A = null;
function initAudio() {
  if (A) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 5;
  filter.connect(master);

  const oscs = [];
  [55, 82.5, 110, 164.8, 220].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = i % 2 ? 'sawtooth' : 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.16 / (i + 1);
    o.connect(g); g.connect(filter); o.start();
    oscs.push({ o, g, base: f });
  });

  // «хор» — расстроенные синусы
  const choir = [];
  [329.6, 392, 493.9].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(master); o.start();
    choir.push({ o, g, base: f });
  });

  A = { ctx, master, filter, oscs, choir };
  master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 3);
}

function updateAudio(dt) {
  if (!A) return;
  const t = rift / 100;
  A.filter.frequency.setTargetAtTime(320 + t * 2600, A.ctx.currentTime, 0.25);
  for (let i = 0; i < A.oscs.length; i++) {
    const x = A.oscs[i];
    x.o.detune.setTargetAtTime((i - 2) * t * 34, A.ctx.currentTime, 0.3);
  }
  for (let i = 0; i < A.choir.length; i++) {
    const x = A.choir[i];
    x.g.gain.setTargetAtTime(0.006 + t * 0.035, A.ctx.currentTime, 0.4);
    x.o.detune.setTargetAtTime(-t * 60 + Math.sin(time * 0.3 + i) * 6, A.ctx.currentTime, 0.4);
  }
  A.master.gain.setTargetAtTime(0.18 + t * 0.12, A.ctx.currentTime, 0.5);
}

function blip(freq, dur, type, vol) {
  if (!A) return;
  const o = A.ctx.createOscillator();
  const g = A.ctx.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  g.gain.value = 0;
  o.connect(g); g.connect(A.master);
  const now = A.ctx.currentTime;
  g.gain.linearRampToValueAtTime(vol || 0.12, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.2));
  o.start(now); o.stop(now + (dur || 0.2) + 0.02);
}

/* ------------------------------------------------------------------ */
/*  ВВОД                                                               */
/* ------------------------------------------------------------------ */
const keys = {};
let mouseL = false, mouseR = false;
const startBtn = document.getElementById('startBtn');

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  onKeyDown(e.code);
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  onKeyUp(e.code);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});
document.addEventListener('mousedown', (e) => {
  if (state !== 'play' || document.pointerLockElement !== canvas) return;
  if (e.button === 0) { mouseL = true; startSculpt(); }
  if (e.button === 2) { mouseR = true; condense(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseL = false; endSculpt(); }
  if (e.button === 2) mouseR = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

startBtn.addEventListener('click', () => {
  initAudio();
  ui.menu.classList.add('hidden');
  ui.hud.classList.add('on');
  state = 'play';
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'play') {
    state = 'pause';
    startBtn.textContent = 'Продолжить';
    ui.menu.classList.remove('hidden');
  }
});

document.getElementById('againBtn').addEventListener('click', () => location.reload());

function onKeyDown(code) {
  if (state !== 'play') return;
  if (code === 'KeyE') spawnEcho();
  if (code === 'KeyQ') beginRewind();
  if (code === 'Space' && player.onGround) { player.vel.y = 9.2; player.onGround = false; blip(220, 0.1, 'sine', 0.06); }
  if (code === 'ShiftLeft' || code === 'ShiftRight') dash();
  if (code === 'Digit1' && nearCore()) ending('stable');
  if (code === 'Digit2' && nearCore()) ending('chaos');
  if (code === 'KeyF' && nearCore()) toast('1 — стабилизировать · 2 — довести коллапс');
}
function onKeyUp(code) {
  if (code === 'KeyQ') endRewind();
}

/* ------------------------------------------------------------------ */
/*  ФИЗИКА ИГРОКА                                                      */
/* ------------------------------------------------------------------ */
function playerAABB() {
  return {
    min: new THREE.Vector3(player.pos.x - PLAYER_R, player.pos.y, player.pos.z - PLAYER_R),
    max: new THREE.Vector3(player.pos.x + PLAYER_R, player.pos.y + PLAYER_H, player.pos.z + PLAYER_R)
  };
}
function overlap(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x &&
         a.min.y < b.max.y && a.max.y > b.min.y &&
         a.min.z < b.max.z && a.max.z > b.min.z;
}
function moveAxis(axis, amount) {
  if (!amount) return;
  player.pos[axis] += amount;
  let pb = playerAABB();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!c.solid) continue;
    if (!overlap(pb, c)) continue;

    // шаг на низкую ступень (до 0.5 м) вместо упора в неё
    if (axis !== 'y') {
      const rise = c.max.y - player.pos.y;
      if (rise > 0 && rise < 0.55) {
        player.pos.y = c.max.y + 0.002;
        pb = playerAABB();
        if (!overlap(pb, c)) continue;
        player.pos.y = c.max.y + 0.002 - rise;
        pb = playerAABB();
      }
    }

    if (amount > 0) player.pos[axis] -= (pb.max[axis] - c.min[axis]) + 0.001;
    else player.pos[axis] += (c.max[axis] - pb.min[axis]) + 0.001;
    if (axis === 'y') {
      if (amount < 0) player.onGround = true;
      player.vel.y = 0;
    } else {
      player.vel[axis] = 0;
    }
    pb = playerAABB();
  }
}

let dashCd = 0;
function dash() {
  if (dashCd > 0) return;
  dashCd = 1.1;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  player.vel.x += f.x * 15;
  player.vel.z += f.z * 15;
  addRift(0.8);
  blip(520, 0.12, 'triangle', 0.08);
}

function updatePlayer(dt) {
  dashCd = Math.max(0, dashCd - dt);

  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wish = new THREE.Vector3()
    .addScaledVector(f, (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0))
    .addScaledVector(r, (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0));
  if (wish.lengthSq() > 0) wish.normalize();

  const speed = (rewinding ? 2.0 : MOVE_SPEED);
  const accel = player.onGround ? 15 : 4.5;
  const tx = wish.x * speed, tz = wish.z * speed;
  player.vel.x += (tx - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (tz - player.vel.z) * Math.min(1, accel * dt);

  player.vel.y -= GRAVITY * dt;
  if (player.vel.y < -55) player.vel.y = -55;

  moveAxis('x', player.vel.x * dt);
  moveAxis('z', player.vel.z * dt);
  player.onGround = false;
  moveAxis('y', player.vel.y * dt);

  // камера
  const bobAmp = Math.min(0.055, Math.hypot(player.vel.x, player.vel.z) * 0.007);
  const bob = Math.sin(time * 11) * bobAmp;
  camera.position.set(player.pos.x, player.pos.y + EYE + bob, player.pos.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  // падение в бездну
  if (player.pos.y < -24) die('бездна');

  // ресурсы
  if (!rewinding) player.charge = Math.min(100, player.charge + 8 * dt);
  player.mass = Math.min(40, player.mass + (rewinding ? 0 : 6 * dt));
}

function die(reason) {
  player.hp = 100;
  player.pos.copy(START);
  player.vel.set(0, 0, 0);
  addRift(4);
  toast('Мир запомнил: ' + reason);
  blip(70, 0.7, 'sawtooth', 0.16);
}
let lowHpHint = 0;
function hurtPlayer(n) {
  if (state !== 'play') return;
  player.hp -= n;
  if (player.hp < 45 && time - lowHpHint > 25) {
    lowHpHint = time;
    toast('перемотка лечит: откати себя на 2–3 секунды');
  }
  blip(120, 0.18, 'square', 0.07);
  if (player.hp <= 0) { toast('Ты был отменён'); die('ты был отменён'); }
}

/* ------------------------------------------------------------------ */
/*  ПЕРЕМОТКА                                                          */
/* ------------------------------------------------------------------ */
let rewinding = false;
let rwElapsed = 0;

function inStitch(p) {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.type === 'suture' && e.alive && e.group.position.distanceTo(p) < 5.2) return true;
  }
  return false;
}

function effectiveMaxRewind() {
  return Math.max(2.5, MAX_REWIND - memPenalty);
}
let memPenalty = 0;

function beginRewind() {
  if (player.charge < 6 || rewinding) return;
  rewinding = true;
  rwElapsed = 0;
  blip(300, 0.35, 'sine', 0.07);
}
function endRewind() {
  if (!rewinding) return;
  const target = time - rwElapsed;

  for (let i = 0; i < rewindables.length; i++) {
    const r = rewindables[i];
    if (r.kind === 'prop') continue;
    if (!r.touched) continue;
    r.touched = false;
    r.hist = r.hist.filter((h) => h.t <= target + 0.0001);
    if (!r.hist.length) {
      if (r.kind === 'block') destroyBlock(r);
      else if (r.kind === 'echo') destroyEcho(r);
      else if (r.kind === 'crystal') destroyCrystal(r);
    }
  }

  // парадокс-урон врагам, которых отмотали
  if (rwElapsed > 1.5) {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.group.position.distanceTo(player.pos) > RIFT_RADIUS) continue;
      if (inStitch(e.group.position)) continue;
      hurtEnemy(e, rwElapsed * 5.5, true);
    }
  }

  rwElapsed = 0;
  rewinding = false;
}

function updateRewind(dt) {
  if (!rewinding) return;
  const maxR = effectiveMaxRewind();
  rwElapsed = Math.min(maxR, rwElapsed + dt);
  player.charge -= 13 * dt;
  addRift(2.2 * dt);
  if (player.charge <= 0) { player.charge = 0; endRewind(); return; }

  const target = time - rwElapsed;

  for (let i = 0; i < rewindables.length; i++) {
    const r = rewindables[i];
    if (r.dead) continue;
    if (r.anchor.distanceTo(player.pos) > RIFT_RADIUS) continue;
    if (inStitch(r.anchor)) continue;

    if (r.kind === 'prop') { r.applyState({ v: rwElapsed >= 4 }); continue; }

    const snap = sampleAt(r, target);
    if (snap) { r.applyState(snap.s); r.touched = true; }
    else if (r.kind !== 'enemy' && r.kind !== 'prop') { r.applyState(null); r.touched = true; }
  }

  // лечение себя перемоткой
  const hs = sampleValue(hpHist, target);
  if (hs && hs.v > player.hp) player.hp = Math.min(hs.v, player.hp + 34 * dt);
}

/* ------------------------------------------------------------------ */
/*  ЛЕПКА                                                              */
/* ------------------------------------------------------------------ */
const blocks = [];
let sculpt = null;
const raycaster = new THREE.Raycaster();

function visibleTargets() {
  const out = [];
  for (let i = 0; i < raycastTargets.length; i++) if (raycastTargets[i].visible) out.push(raycastTargets[i]);
  for (let i = 0; i < blocks.length; i++) if (blocks[i].mesh.visible) out.push(blocks[i].mesh);
  return out;
}

function aimPoint(maxDist) {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = maxDist || 6;
  const hits = raycaster.intersectObjects(visibleTargets(), false);
  if (hits.length) return hits[0].point.clone();
  return camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3.4));
}

function startSculpt() {
  if (player.mass < 4 || sculpt) return;
  const p = aimPoint();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.sculpt);
  mesh.position.copy(p);
  scene.add(mesh);
  sculpt = { mesh, size: 0.35, base: p.clone(), used: 0 };
  blip(180, 0.09, 'triangle', 0.05);
}
function updateSculpt(dt) {
  if (!sculpt) return;
  const grow = dt * 2.4;
  const cost = grow * 3.0;
  if (player.mass < cost || sculpt.size > 3.0) { endSculpt(); return; }
  player.mass -= cost;
  sculpt.used += cost;
  sculpt.size += grow;
  const s = sculpt.size;
  sculpt.mesh.scale.set(s, s, s);
  sculpt.mesh.position.set(sculpt.base.x, sculpt.base.y + (s - 0.35) / 2, sculpt.base.z);
  sculpt.mesh.rotation.y += dt * 0.6;
  addRift(0.6 * dt);
}
function endSculpt() {
  if (!sculpt) return;
  const mesh = sculpt.mesh;
  mesh.rotation.y = 0;
  mesh.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(mesh);
  const c = { min: bb.min.clone(), max: bb.max.clone(), solid: true, mesh };
  colliders.push(c);
  raycastTargets.push(mesh);

  const block = { mesh, collider: c, crystal: null, born: time };
  blocks.push(block);

  const r = addRewindable('block', mesh, () => ({
    v: mesh.visible,
    p: mesh.position.toArray(),
    s: mesh.scale.toArray()
  }), (st) => {
    if (!st) { mesh.visible = false; c.solid = false; return; }
    mesh.visible = st.v;
    mesh.position.fromArray(st.p);
    mesh.scale.fromArray(st.s);
    c.solid = !!st.v;
    const b2 = new THREE.Box3().setFromObject(mesh);
    c.min.copy(b2.min); c.max.copy(b2.max);
  });

  block.rew = r;
  sculpt = null;
  blip(90, 0.14, 'sine', 0.06);

  if (blocks.length > 14) {
    destroyBlock(blocks[0].rew);
  }
}

function destroyBlock(r) {
  const b = blocks.find((x) => x.rew === r);
  if (b && b.crystal && b.crystal.rew) {
    b.crystal.rew.dead = true;
    const k = rewindables.indexOf(b.crystal.rew);
    if (k >= 0) rewindables.splice(k, 1);
  }
  if (b) {
    scene.remove(b.mesh);
    const ci = colliders.indexOf(b.collider);
    if (ci >= 0) colliders.splice(ci, 1);
    const ri = raycastTargets.indexOf(b.mesh);
    if (ri >= 0) raycastTargets.splice(ri, 1);
    const bi = blocks.indexOf(b);
    if (bi >= 0) blocks.splice(bi, 1);
    if (b.crystal) { const cxi = crystals.indexOf(b.crystal); if (cxi >= 0) crystals.splice(cxi, 1); }
  }
  r.dead = true;
  const i = rewindables.indexOf(r);
  if (i >= 0) rewindables.splice(i, 1);
}

/* ------------------------------------------------------------------ */
/*  НЕСТАБИЛЬНЫЕ СТРУКТУРЫ (кристаллы)                                 */
/* ------------------------------------------------------------------ */
const crystals = [];
const pending = [];

function condense() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 7;
  const hits = raycaster.intersectObjects(blocks.filter(b => b.mesh.visible).map(b => b.mesh), false);
  let block = null;
  if (hits.length) block = blocks.find((b) => b.mesh === hits[0].object) || null;

  if (!block) {
    if (player.mass < 6) { toast('нет массы'); return; }
    player.mass -= 6;
    const p = aimPoint(5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), M.sculpt);
    mesh.position.copy(p);
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    const bb = new THREE.Box3().setFromObject(mesh);
    const c = { min: bb.min.clone(), max: bb.max.clone(), solid: true, mesh };
    colliders.push(c);
    raycastTargets.push(mesh);
    block = { mesh, collider: c, crystal: null, born: time };
    blocks.push(block);
    block.rew = addRewindable('block', mesh, () => ({ v: mesh.visible, p: mesh.position.toArray(), s: mesh.scale.toArray() }),
      (st) => {
        if (!st) { mesh.visible = false; c.solid = false; return; }
        mesh.visible = st.v; mesh.position.fromArray(st.p); mesh.scale.fromArray(st.s);
        c.solid = !!st.v;
        const b2 = new THREE.Box3().setFromObject(mesh);
        c.min.copy(b2.min); c.max.copy(b2.max);
      });
  }
  if (block.crystal) { toast('уже нестабильно'); return; }

  block.mesh.material = M.crystal;
  const cr = { block, mesh: block.mesh, timer: CRYSTAL_FUSE, alive: true, depth: 0 };
  block.crystal = cr;
  crystals.push(cr);
  addRift(2.0);

  cr.rew = addRewindable('crystal', block.mesh, () => ({ v: cr.alive, t: cr.timer, p: block.mesh.position.toArray() }),
    (st) => {
      if (!st) { cr.alive = false; block.mesh.visible = false; block.collider.solid = false; return; }
      const was = cr.alive;
      cr.alive = st.v;
      cr.timer = st.t;
      block.mesh.visible = st.v;
      block.collider.solid = !!st.v;
      block.mesh.material = st.v ? M.crystal : M.sculpt;
      if (st.v && !was) blip(640, 0.2, 'sine', 0.05);
    });
  blip(420, 0.12, 'square', 0.07);
}

function updateCrystals(dt) {
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    if (!c.alive) continue;
    c.timer -= dt;
    const k = 1 - c.timer / CRYSTAL_FUSE;
    const s = 1 + k * 0.35 + Math.sin(time * (6 + k * 26)) * 0.06;
    c.mesh.scale.setScalar(s);
    c.mesh.rotation.y += dt * (1 + k * 4);
    if (c.timer <= 0) detonate(c, 0);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].t -= dt;
    if (pending[i].t <= 0) {
      const p = pending.splice(i, 1)[0];
      detonate(p.c, p.depth);
    }
  }
}

function detonate(c, depth) {
  if (!c.alive) return;
  c.alive = false;
  c.block.mesh.visible = false;
  c.block.collider.solid = false;
  c.timer = 0;

  const pos = c.block.mesh.position.clone();
  const mult = Math.min(3, 1 + 0.5 * depth);
  shockwave(pos, 6, 0xff44dd, 0.5);
  addRift(4);
  blip(90 - depth * 12, 0.5, 'sawtooth', 0.18);

  // враги
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const d = e.group.position.distanceTo(pos);
    if (d < 6.5) hurtEnemy(e, 60 * mult * (1 - d / 12), true);
  }
  // игрок
  const dp = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(pos);
  if (dp < 6) hurtPlayer(24 * (1 - dp / 8));

  // каскад
  for (let i = 0; i < crystals.length; i++) {
    const o = crystals[i];
    if (o === c || !o.alive || depth > 3) continue;
    if (o.block.mesh.position.distanceTo(pos) < 7.5) {
      pending.push({ t: 0.07, c: o, depth: depth + 1 });
    }
  }
  toastIfChain(depth);
}
let chainMsg = 0;
function toastIfChain(depth) {
  if (depth >= 2 && time - chainMsg > 1) { chainMsg = time; toast('каскад ×' + (1 + 0.5 * depth).toFixed(1)); shards.sec += 1; }
}

function destroyCrystal(r) {
  const c = crystals.find((x) => x.rew === r);
  if (c) {
    c.alive = false;
    const i = crystals.indexOf(c);
    if (i >= 0) crystals.splice(i, 1);
    if (c.block) c.block.crystal = null;
  }
  r.dead = true;
  const i2 = rewindables.indexOf(r);
  if (i2 >= 0) rewindables.splice(i2, 1);
}

/* ------------------------------------------------------------------ */
/*  ЭХО                                                               */
/* ------------------------------------------------------------------ */
const echoes = [];

function poseAt(t) {
  const s = sampleValue(poseHist, t);
  return s ? s.v : null;
}
function spawnEcho() {
  if (player.charge < 5) return;
  player.charge -= 5;

  if (echoes.length >= ECHO_LIMIT) removeEcho(echoes[0]);

  const past = poseAt(time - 2.5);
  const p = past ? past.p.clone() : player.pos.clone();
  if (p.distanceTo(player.pos) < 1.8) {
    const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    p.copy(player.pos).addScaledVector(back, 2.4);
  }

  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), M.echo);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), M.echo);
  head.position.y = 1.58;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.3), M.echo);
  legs.position.y = 0.3;
  g.add(torso, head, legs);
  g.position.copy(p);
  g.rotation.y = past ? past.yaw : yaw;
  scene.add(g);

  const c = { min: new THREE.Vector3(p.x - 0.45, p.y, p.z - 0.45), max: new THREE.Vector3(p.x + 0.45, p.y + 1.7, p.z + 0.45), solid: true, mesh: g };
  colliders.push(c);

  const echo = { group: g, collider: c, born: time, age: 0 };
  echoes.push(echo);

  echo.rew = addRewindable('echo', g, () => ({ v: true, p: g.position.toArray(), y: g.rotation.y }), (st) => {
    if (!st) { g.visible = false; c.solid = false; return; }
    g.visible = true; g.position.fromArray(st.p); g.rotation.y = st.y; c.solid = true;
    c.min.set(g.position.x - 0.45, g.position.y, g.position.z - 0.45);
    c.max.set(g.position.x + 0.45, g.position.y + 1.7, g.position.z + 0.45);
  });

  addRift(1.0);
  blip(660, 0.25, 'sine', 0.06);
}
function removeEcho(e) {
  scene.remove(e.group);
  const ci = colliders.indexOf(e.collider);
  if (ci >= 0) colliders.splice(ci, 1);
  const i = echoes.indexOf(e);
  if (i >= 0) echoes.splice(i, 1);
  if (e.rew) {
    e.rew.dead = true;
    const ri = rewindables.indexOf(e.rew);
    if (ri >= 0) rewindables.splice(ri, 1);
  }
}
function destroyEcho(r) {
  const e = echoes.find((x) => x.rew === r);
  if (e) removeEcho(e);
}

function updateEchoes(dt) {
  for (let i = echoes.length - 1; i >= 0; i--) {
    const e = echoes[i];
    e.age += dt;
    e.group.position.y += Math.sin(time * 2 + i) * 0.0006;
    const k = e.age / ECHO_LIFE;
    e.group.traverse((o) => { if (o.material) o.material.opacity = 0.34 * (1 - k * 0.65); });
    if (e.age > ECHO_LIFE) { removeEcho(e); continue; }

    // парадокс: игрок в точке своего эха
    if (e.age > 2.0) {
      const d = e.group.position.distanceTo(player.pos);
      if (d < 1.3) paradox(e);
    }
  }
}

function paradox(e) {
  const p = e.group.position.clone().add(new THREE.Vector3(0, 0.9, 0));
  shockwave(p, 5, 0xff7bff, 0.8);
  addRift(7);
  shards.paradox += 1;
  shards.sec += 2;
  toast('ПАРАДОКС');
  blip(1200, 0.5, 'sine', 0.16);
  blip(70, 0.6, 'sawtooth', 0.12);

  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (!en.alive) continue;
    if (en.group.position.distanceTo(p) < 5.5) hurtEnemy(en, 160, true);
  }
  hurtPlayer(22);
  removeEcho(e);
}

/* ------------------------------------------------------------------ */
/*  ВРАГИ                                                              */
/* ------------------------------------------------------------------ */
const enemies = [];
const needles = [];

function makeSuture(x, y, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 2.2, 6), M.enemy);
  body.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), M.enemyGlow);
  head.position.y = 2.55;
  const n1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 1.5, 5), M.bone);
  n1.position.set(0.5, 1.5, 0); n1.rotation.z = -0.5;
  const n2 = n1.clone(); n2.position.x = -0.5; n2.rotation.z = 0.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: 0xff5c7a, transparent: true, opacity: 0.25 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.15;
  g.add(body, head, n1, n2, ring);
  g.position.set(x, y, z);
  scene.add(g);
  const e = { type: 'suture', group: g, hp: 120, maxHp: 120, alive: true, fireCd: 2, ring };
  enemies.push(e);
  attachEnemyRewind(e);
  return e;
}
function makeMemophage(x, y, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), M.mem);
  body.position.y = 1.6;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 1.5, 4), M.bone);
    leg.position.set(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  g.add(body);
  g.position.set(x, y, z);
  scene.add(g);
  const e = { type: 'memophage', group: g, hp: 90, maxHp: 90, alive: true, biteCd: 0, body, ate: 0, stuffed: 0 };
  enemies.push(e);
  attachEnemyRewind(e);
  return e;
}
function makeReversion(x, y, z, route) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.35), M.rev);
  torso.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), M.rev);
  head.position.y = 1.95;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 32), M.glow);
  halo.position.y = 1.2; halo.rotation.x = Math.PI / 2;
  g.add(torso, head, halo);
  g.position.set(x, y, z);
  scene.add(g);
  const e = { type: 'reversion', group: g, hp: 70, maxHp: 70, alive: true, route: route, idx: route.length - 1, vulnerable: false };
  enemies.push(e);
  attachEnemyRewind(e);
  return e;
}

function attachEnemyRewind(e) {
  const r = addRewindable('enemy', e.group, () => ({
    p: e.group.position.toArray(), h: e.hp, v: e.alive
  }), (st) => {
    if (!st) return;
    e.group.position.fromArray(st.p);
    e.hp = st.h;
    e.alive = st.v;
    e.group.visible = st.v;
  });
  e.rew = r;
}

function hurtEnemy(e, dmg, byParadox) {
  if (!e.alive) return;
  if (e.type === 'reversion' && !e.vulnerable && !byParadox) return;
  e.hp -= dmg;
  if (e.group.children[0] && e.group.children[0].material) {
    // короткая вспышка
    e.flash = 0.15;
  }
  if (e.hp <= 0) killEnemy(e, byParadox);
}

function killEnemy(e, byParadox) {
  e.alive = false;
  e.group.visible = false;
  kills++;
  const pos = e.group.position.clone();
  shockwave(pos, 3, 0xff3355, 0.4);
  blip(140, 0.3, 'sawtooth', 0.1);

  if (e.type === 'reversion') { shards.paradox += byParadox ? 2 : 1; toast('таймлайн разорван'); }
  else if (e.type === 'memophage') { shards.sec += 2; if (e.ate > 0) { shards.paradox += 1; memPenalty = Math.max(0, memPenalty - e.ate * 0.6); } }
  else { shards.sec += 2; }
  addRift(4);
}

function fireNeedle(e) {
  const from = e.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
  const to = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
  const dir = to.sub(from).normalize();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6), M.glow);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  scene.add(mesh);
  needles.push({ mesh, vel: dir.multiplyScalar(28), life: 2.2 });
  blip(880, 0.08, 'square', 0.05);
}

function updateEnemies(dt) {
  const pp = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0));

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const ep = e.group.position;

    if (e.type === 'suture') {
      const to = player.pos.clone().sub(ep); to.y = 0;
      const dist = to.length();
      const dir = to.normalize();
      const speed = 2.6;
      if (dist < 16) {
        if (dist > 11) ep.addScaledVector(dir, speed * dt);
        else if (dist < 7) ep.addScaledVector(dir, -speed * 0.8 * dt);
        else { ep.x += -dir.z * speed * 0.5 * dt * Math.sin(i); ep.z += dir.x * speed * 0.5 * dt * Math.sin(i); }
      }
      ep.y = 0.1;
      e.group.lookAt(player.pos.x, ep.y + 1.6, player.pos.z);

      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 21) { fireNeedle(e); e.fireCd = 3.8; }

      e.ring.material.opacity = 0.16 + Math.sin(time * 3) * 0.08;
      e.ring.rotation.z += dt * 0.4;

    } else if (e.type === 'memophage') {
      // ищет эхо
      let target = null, best = 34;
      for (let k = 0; k < echoes.length; k++) {
        const d = ep.distanceTo(echoes[k].group.position);
        if (d < best) { best = d; target = echoes[k]; }
      }
      if (target) {
        const dir = target.group.position.clone().sub(ep).normalize();
        ep.addScaledVector(dir, 5.2 * dt);
        if (ep.distanceTo(target.group.position) < 1.9) {
          removeEcho(target);
          e.hp = Math.min(190, e.hp + 25);
          e.ate++;
          memPenalty = Math.min(4, memPenalty + 0.6);
          toast('Мнемофаг съел эхо · глубина −' + memPenalty.toFixed(1) + ' с');
          blip(300, 0.3, 'sine', 0.08);
          e.stuffed = time;
        }
      } else {
        const dir = player.pos.clone().sub(ep); dir.y = 0;
        const d = dir.length();
        if (d > 2.5) ep.addScaledVector(dir.normalize(), 3.2 * dt);
        e.biteCd -= dt;
        if (d < 3.2 && e.biteCd <= 0) { hurtPlayer(9); e.biteCd = 1.3; }
      }
      ep.y = 0.6 + Math.sin(time * 1.6 + i) * 0.35;
      e.body.scale.setScalar(1 + e.ate * 0.22);

      if (e.hp >= 140 && e.stuffed && time - e.stuffed > 7) {
        // взрыв памяти
        shockwave(ep.clone(), 7, 0xff88ff, 0.8);
        hurtPlayer(Math.max(0, 45 - ep.distanceTo(pp) * 4));
        memPenalty = Math.min(4, memPenalty + 1.2);
        e.hp = 60; e.ate = 0; e.stuffed = 0;
        toast('взрыв памяти');
      }

    } else if (e.type === 'reversion') {
      const wp = e.route[e.idx];
      const dir = wp.clone().sub(ep);
      const d = dir.length();
      if (d < 1.2) {
        e.idx--;
        if (e.idx < 0) { e.idx = e.route.length - 1; ep.copy(e.route[e.idx]); }
      } else {
        ep.addScaledVector(dir.normalize(), 7.5 * dt);
      }
      e.group.rotation.y += dt * 2;
      e.vulnerable = rewinding || e.idx <= 1;

      // ломаем маршрут скульптурой
      for (let b = 0; b < blocks.length; b++) {
        const bm = blocks[b];
        if (!bm.mesh.visible) continue;
        if (bm.mesh.position.distanceTo(ep) < 1.6) {
          e.vulnerable = true;
          hurtEnemy(e, 260, true);
          shockwave(ep.clone(), 4, 0x66aaff, 0.6);
          break;
        }
      }
    }
  }

  // иглы
  for (let i = needles.length - 1; i >= 0; i--) {
    const n = needles[i];
    n.mesh.position.addScaledVector(n.vel, dt);
    n.life -= dt;
    const d = n.mesh.position.distanceTo(pp);
    if (d < 0.9) { hurtPlayer(9); scene.remove(n.mesh); needles.splice(i, 1); continue; }
    if (n.life <= 0) { scene.remove(n.mesh); needles.splice(i, 1); }
  }
}

/* ------------------------------------------------------------------ */
/*  СПАВН                                                              */
/* ------------------------------------------------------------------ */
makeSuture(7, 0.1, -4);
makeSuture(-6, 4.1, -30);
makeMemophage(-5, 0.6, -13);
makeReversion(
  0, 4.1, -30,
  [
    new THREE.Vector3(-7, 4.1, -38),
    new THREE.Vector3(7, 4.1, -38),
    new THREE.Vector3(8, 4.1, -27),
    new THREE.Vector3(0, 4.1, -25),
    new THREE.Vector3(-8, 4.1, -30)
  ]
);

/* ------------------------------------------------------------------ */
/*  ЯДРО И ФИНАЛ                                                       */
/* ------------------------------------------------------------------ */
function nearCore() {
  const d = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z).distanceTo(core.position);
  return d < 8;
}
let corePrompted = false;
let gapHint = false;

function ending(kind) {
  if (state === 'ending') return;
  state = 'ending';
  document.exitPointerLock();
  ui.hud.classList.remove('on');

  const mins = Math.floor(time / 60), secs = Math.floor(time % 60);
  if (kind === 'stable') {
    ui.endTitle.textContent = 'ШОВ';
    ui.endText.textContent = 'Ты держишь ядро. Восемь секунд, потом ещё восемь, потом ещё. Каждая перемотка теперь — не побег, а стежок: мир зашивается вокруг тебя, медленно, криво, но зашивается. Где-то в глубине Хор всё ещё поёт — но уже не тебе. Здания перестают расти. Впервые за тысячу лет здесь что-то стоит на месте.';
  } else {
    ui.endTitle.textContent = 'НОВЫЙ ЗАКОН';
    ui.endText.textContent = 'Ты не держишь ничего. Пузырь растёт: 18 метров, 40, километр. Перемотка больше не кончается — кончается мир, который она отменяет. Хор складывается внутрь себя, как письмо, и ты занимаешь его место: не здание, не человек, а правило. С этого дня падать можно вверх. С этого дня всё, что умирает, обязано сначала прожить это заново.';
  }
  ui.endStats.innerHTML =
    'время: ' + mins + ':' + String(secs).padStart(2, '0') + '<br>' +
    'индекс разлома: ' + Math.round(rift) + '%<br>' +
    'осколки: ' + shards.sec + ' секунд · ' + shards.paradox + ' противоречий<br>' +
    'врагов отменено: ' + kills;

  ui.ending.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/*  СЛОЙ ПАМЯТИ (Tab)                                                  */
/* ------------------------------------------------------------------ */
let memoryOn = false;
function updateMemory() {
  const want = !!keys['Tab'] && state === 'play';
  if (want !== memoryOn) {
    memoryOn = want;
    plankGhosts.forEach((g) => { g.visible = want; });
  }
  timeScale = want ? 0.22 : 1;
}

/* ------------------------------------------------------------------ */
/*  ГЛАВНЫЙ ЦИКЛ                                                       */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let glowPulse = 0;

function loop() {
  requestAnimationFrame(loop);
  const raw = Math.min(0.05, clock.getDelta());

  if (state === 'play') {
    updateMemory();
    timeScale = memoryOn ? 0.22 : 1;
  } else {
    timeScale = 1;
  }
  const dt = raw * timeScale;

  if (state === 'play') {
    time += dt;
    updatePlayer(dt);
    updateSculpt(dt);
    updateCrystals(dt);
    updateRewind(dt);
    updateEchoes(dt);
    updateEnemies(dt);
    updateHud(raw);
    updateAudio(raw);

    // запись истории
    recordHistory(time);
    if (!poseHist.length || time - poseHist[poseHist.length - 1].t > 0.05) {
      poseHist.push({ t: time, v: { p: player.pos.clone(), yaw } });
      if (poseHist.length > 300) poseHist.shift();
    }
    if (!hpHist.length || time - hpHist[hpHist.length - 1].t > 0.05) {
      hpHist.push({ t: time, v: player.hp });
      if (hpHist.length > 300) hpHist.shift();
    }

    if (!bridgeArmed && player.pos.z < 25) armBridge(time);
    if (!gapHint && player.pos.z < -12 && player.pos.z > -22 && player.pos.y < 2.5) {
      gapHint = true;
      toast('выше не прыгнуть · ЛКМ — слепить ступень · E — эхо');
    }

    if (nearCore() && !corePrompted) {
      corePrompted = true;
      toast('1 — стабилизировать · 2 — довести коллапс');
    }
    if (!nearCore()) corePrompted = false;

    ui.objSub.textContent = nearCore() ? 'выбери, что останется' : 'оно всё ещё держится';
  }

  updateFx(state === 'play' ? dt : raw);

  // мир дышит и ломается
  glowPulse += raw;
  const breathe = Math.sin(glowPulse * 0.8) * 0.5 + 0.5;
  M.violet.emissiveIntensity = 1.2 + breathe * 0.9 + rift / 90;
  M.crystal.emissiveIntensity = 1.6 + Math.sin(glowPulse * 9) * 0.5;
  core.rotation.y += raw * 0.35;
  core.rotation.x += raw * 0.12;
  coreRing.rotation.z += raw * 0.5;
  core.scale.setScalar(1 + breathe * 0.04);

  const fogMix = rift / 100;
  scene.fog.color.copy(FOG_A).lerp(FOG_B, fogMix);
  scene.fog.density = 0.012 + fogMix * 0.012;
  scene.background.copy(FOG_A).lerp(FOG_B, fogMix * 0.8);
  hemi.intensity = 0.9 + Math.sin(glowPulse * 0.4) * 0.08;
  coreLight.intensity = 55 + breathe * 25 + rift * 0.6;

  for (let i = 0; i < debris.length; i++) {
    const d = debris[i];
    d.rotation.x += d.userData.spin.x * raw;
    d.rotation.y += d.userData.spin.y * raw;
    d.rotation.z += d.userData.spin.z * raw;
    d.position.y = d.userData.base.y + Math.sin(glowPulse * 0.5 + d.userData.ph) * 0.8;
  }
  dust.rotation.y += raw * 0.008;
  dust.position.y = Math.sin(glowPulse * 0.2) * 1.5;

  // лёгкое «дыхание» камеры при высоком разломе
  if (rift > 60 && state === 'play') {
    camera.rotation.z = Math.sin(glowPulse * 1.7) * 0.004 * (rift - 60) / 40;
  } else {
    camera.rotation.z = 0;
  }

  renderer.render(scene, camera);
}
loop();

/* отладка в консоли */
window.__AP = {
  player, enemies, shards, crystals, echoes, blocks, planks, rewindables,
  get rift() { return rift; },
  get state() { return state; },
  get time() { return time; },
  get armed() { return bridgeArmed; },
  get rw() { return rwElapsed; },
  get rewinding() { return rewinding; },
  ending, damage: hurtPlayer
};
