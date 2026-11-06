/* Интерфейс: HUD, экраны, всплывающие сообщения. */
import { S, echoLimit, clamp, inStitch } from './state.js';

export const UPGRADES = [
  { id: 'stasis', name: 'СТАЗИС', law: 'порядок', max: 3, desc: '+1,4 с глубины перемотки за уровень. Мир легче держать на месте.' },
  { id: 'flood', name: 'ПОТОП', law: 'масса', max: 3, desc: '+8 массы за уровень. На 2-м уровне — четвёртое эхо одновременно.' },
  { id: 'decay', name: 'РАСПАД', law: 'хаос', max: 3, desc: '+20% урона коллапса за уровень, −25% самоурона.' }
];

export function costOf(id, lvl) {
  return { sec: 3 + lvl * 3, par: 1 + Math.floor(lvl / 2) };
}

const el = {};
let toastTimer = 0;
let vignetteLevel = 0;

export function initUI() {
  const ids = [
    'hud', 'hpFill', 'hpTxt', 'chFill', 'chTxt', 'msFill', 'msTxt', 'riftFill', 'riftTxt',
    'sh1', 'sh2', 'toast', 'objMain', 'objSub', 'bossWrap', 'bossFill', 'bossName',
    'vignette', 'flash', 'stitchWarn', 'hint', 'crosshair',
    'menu', 'zonecard', 'zcTitle', 'zcSub', 'upgrade', 'upCards', 'upStats', 'pause', 'ending',
    'endTitle', 'endText', 'endStats', 'startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'contBtn',
    'sens', 'vol', 'rewindFx'
  ];
  for (const id of ids) el[id] = document.getElementById(id);
  el.echoDots = Array.from(document.querySelectorAll('.echo'));
}

export function hud(show) {
  el.hud.classList.toggle('on', !!show);
}

export function toast(text, dur) {
  el.toast.textContent = text;
  el.toast.classList.add('on');
  toastTimer = dur || 1.8;
}

export function flash(color, a) {
  el.flash.style.background = color;
  el.flash.style.opacity = String(a || 0.4);
  el.flash.classList.add('on');
  setTimeout(() => el.flash.classList.remove('on'), 90);
}

export function hurtFlash() {
  vignetteLevel = 1;
}

export function setObjective(main, sub) {
  el.objMain.textContent = main;
  el.objSub.textContent = sub || '';
}

export function bossBar(show, value, name) {
  el.bossWrap.classList.toggle('on', !!show);
  if (show) {
    el.bossFill.style.transform = 'scaleX(' + clamp(value, 0, 1) + ')';
    if (name) el.bossName.textContent = name;
  }
}

export function show(id) { el[id] && el[id].classList.remove('hidden'); }
export function hide(id) { el[id] && el[id].classList.add('hidden'); }
export function hideAll() {
  ['menu', 'upgrade', 'pause', 'ending', 'zonecard'].forEach((k) => hide(k));
}

let zcTimer = null;
export function zoneCard(title, sub, ms) {
  el.zcTitle.textContent = title;
  el.zcSub.textContent = sub || '';
  show('zonecard');
  if (zcTimer) clearTimeout(zcTimer);
  zcTimer = setTimeout(() => hide('zonecard'), ms || 2600);
}

export function ending(title, text, stats) {
  el.endTitle.textContent = title;
  el.endText.textContent = text;
  el.endStats.innerHTML = stats;
  hideAll();
  hud(false);
  show('ending');
}

export function renderUpgrade() {
  const wrap = el.upCards;
  wrap.innerHTML = '';
  for (const u of UPGRADES) {
    const lvl = S.upgrades[u.id];
    const c = costOf(u.id, lvl);
    const maxed = lvl >= u.max;
    const afford = !maxed && S.stats.sec >= c.sec && S.stats.paradox >= c.par;
    const div = document.createElement('div');
    div.className = 'upcard' + (maxed ? ' maxed' : '') + (afford ? ' afford' : '');
    div.innerHTML =
      '<div class="upName">' + u.name + '</div>' +
      '<div class="upLaw">' + u.law + '</div>' +
      '<div class="upDesc">' + u.desc + '</div>' +
      '<div class="pips">' + [0, 1, 2].map((i) => '<i class="' + (i < lvl ? 'on' : '') + '"></i>').join('') + '</div>' +
      '<div class="upCost">' + (maxed ? 'освоено' : c.sec + ' сек · ' + c.par + ' прот.') + '</div>';
    if (!maxed) {
      div.dataset.up = u.id;
      div.addEventListener('click', () => {
        if (S.hooks.buy) S.hooks.buy(u.id);
      });
    }
    wrap.appendChild(div);
  }
  el.upStats.innerHTML =
    'осколки: <b>' + S.stats.sec + '</b> секунд · <b>' + S.stats.paradox + '</b> противоречий<br>' +
    '<span>зона ' + (S.zone + 1) + ' из 4 пройдена</span>';
}

export function refreshHud(dt) {
  const P = S.player;
  el.hpFill.style.transform = 'scaleX(' + clamp(P.hp / P.maxHp, 0, 1) + ')';
  el.chFill.style.transform = 'scaleX(' + clamp(P.charge / 100, 0, 1) + ')';
  const maxMass = 40 + S.upgrades.flood * 8;
  el.msFill.style.transform = 'scaleX(' + clamp(P.mass / maxMass, 0, 1) + ')';
  el.hpTxt.textContent = Math.max(0, Math.round(P.hp));
  el.chTxt.textContent = Math.max(0, Math.round(P.charge));
  el.msTxt.textContent = Math.max(0, Math.round(P.mass));
  el.riftFill.style.height = clamp(S.rift, 0, 100) + '%';
  el.riftTxt.textContent = Math.round(S.rift) + '%';
  el.sh1.textContent = S.stats.sec;
  el.sh2.textContent = S.stats.paradox;

  for (let i = 0; i < el.echoDots.length; i++) {
    el.echoDots[i].classList.toggle('on', i < S.echoes.length);
    el.echoDots[i].classList.toggle('off', i >= echoLimit());
  }

  vignetteLevel = Math.max(0, vignetteLevel - dt * 1.8);
  el.vignette.style.opacity = String(vignetteLevel * 0.55);

  el.stitchWarn.classList.toggle('on', inStitch(S.player.pos));
  if (el.rewindFx) el.rewindFx.classList.toggle('on', !!S.flags.rewinding);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.classList.remove('on');
  }
}
