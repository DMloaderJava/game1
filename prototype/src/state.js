/* Общее состояние игры и константы. Никаких зависимостей, кроме three. */
import * as THREE from '../vendor/three.module.js';

export const CFG = {
  RADIUS: 18,        // радиус пузыря разлома, м
  MAX_REWIND: 8,     // базовая глубина перемотки, с
  GRAVITY: 26,
  MOVE: 6.4,
  PH: 1.7,           // высота игрока
  PR: 0.42,          // радиус игрока
  EYE: 1.55,
  ECHO_MAX: 3,
  ECHO_LIFE: 12,
  FUSE: 4,           // фитиль нестабильной структуры
  MASS_MAX: 40,
  SELF_DMG: 0.4
};

export const S = {
  mode: 'menu',            // menu | play | pause | upgrade | ending | zonecard
  time: 0,
  zoneTime: 0,
  zone: 0,
  yaw: 0,
  pitch: 0,
  keys: {},

  player: {
    pos: new THREE.Vector3(0, 1, 30),
    vel: new THREE.Vector3(),
    onGround: false,
    hp: 100,
    maxHp: 100,
    charge: 100,
    mass: CFG.MASS_MAX,
    dashCd: 0,
    alive: true
  },

  colliders: [],
  rayTargets: [],

  enemies: [],
  blocks: [],
  echoes: [],
  crystals: [],
  nodes: [],
  portal: null,

  wells: [],        // гравитационные колодцы (биом 2)
  updrafts: [],     // восходящие потоки (биом 2)
  phasePlats: [],   // фазовые платформы (биом 3)
  erasePlats: [],   // стираемые платформы (биом 4)
  lungs: [],        // дышащие платформы (биом 1)
  hazards: [],

  rift: 0,
  memPenalty: 0,

  stats: { sec: 0, paradox: 0, kills: 0, deaths: 0, nodes: 0 },
  upgrades: { stasis: 0, flood: 0, decay: 0 },
  settings: { sens: 0.0022, vol: 0.6 },
  flags: {},
  hooks: {},
  boss: null
};

/* ---------------- утилиты ---------------- */
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* зоны, где перемотка запечатана Швом */
export function inStitch(p) {
  for (let i = 0; i < S.enemies.length; i++) {
    const e = S.enemies[i];
    if (e.type === 'suture' && e.alive && e.pos.distanceTo(p) < 5.2) return true;
  }
  if (S.boss && S.boss.stitchUntil > S.time && S.boss.pos && S.boss.pos.distanceTo(p) < 14) return true;
  return false;
}

export function maxRewind() {
  const bonus = S.upgrades.stasis * 1.4;
  return clamp(CFG.MAX_REWIND + bonus - S.memPenalty, 2.5, 12);
}

export function echoLimit() {
  return CFG.ECHO_MAX + (S.upgrades.flood > 1 ? 1 : 0);
}

export function addRift(n) {
  S.rift = clamp(S.rift + n, 0, 100);
}
