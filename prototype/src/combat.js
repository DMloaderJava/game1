/* Урон, нестабильные структуры, смерть, осколки. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG, addRift, clamp } from './state.js';
import { shockwave, spark } from './fx.js';
import { sfx } from './audio.js';
import { toast, hurtFlash, flash } from './ui.js';
import { addRewindable, removeRewindable } from './rewind.js';
import { W } from './world.js';

/* ------------------------------------------------------------------ */
/*  ИГРОК                                                             */
/* ------------------------------------------------------------------ */
let lowHpHint = -99;

export function hurtPlayer(n) {
  if (S.mode !== 'play') return;
  const P = S.player;
  if (!P.alive) return;
  P.hp -= n;
  hurtFlash();
  sfx('hurt');
  if (P.hp < 45 && S.time - lowHpHint > 28) {
    lowHpHint = S.time;
    toast('перемотка лечит: откати себя на 2–3 секунды');
  }
  if (P.hp <= 0) {
    P.hp = 0;
    P.alive = false;
    S.stats.deaths++;
    addRift(4);
    sfx('death');
    flash('#ff2b5c', 0.55);
    if (S.hooks.respawn) S.hooks.respawn('когерентность потеряна');
  }
}

/* ------------------------------------------------------------------ */
/*  ВРАГИ                                                             */
/* ------------------------------------------------------------------ */
export function hurtEnemy(e, dmg, paradox) {
  if (!e.alive) return;
  if (e.type === 'reversion' && !e.vulnerable && !paradox) return;
  e.hp -= dmg;
  e.hitFlash = 0.14;
  if (e.hp <= 0) killEnemy(e, paradox);
}

export function killEnemy(e, paradox) {
  e.alive = false;
  if (e.group) e.group.visible = false;
  S.stats.kills++;
  shockwave(e.pos.clone(), 3.2, 0xff3355, 0.42);
  spark(e.pos.clone(), 0xff5577, 12);
  sfx('kill');
  addRift(3);

  if (e.type === 'reversion') {
    S.stats.paradox += paradox ? 2 : 1;
    toast('таймлайн разорван');
  } else if (e.type === 'memophage') {
    S.stats.sec += 2;
    if (e.ate > 0) {
      S.stats.paradox += 1;
      S.memPenalty = Math.max(0, S.memPenalty - e.ate * 0.6);
      toast('память возвращена · глубина +' + (e.ate * 0.6).toFixed(1) + ' с');
    }
  } else if (e.type === 'shade') {
    S.stats.paradox += 1;
  } else {
    S.stats.sec += 2;
  }
  if (S.hooks.onKill) S.hooks.onKill(e);
}

/* ------------------------------------------------------------------ */
/*  НЕСТАБИЛЬНЫЕ СТРУКТУРЫ                                            */
/* ------------------------------------------------------------------ */
export function makeUnstable(block) {
  if (!block || block.crystal || block.dead) return false;
  block.mesh.material = W.M.crystal;
  const cr = { block, mesh: block.mesh, timer: CFG.FUSE, alive: true, depth: 0, rew: null };
  block.crystal = cr;
  S.crystals.push(cr);
  addRift(2);
  sfx('condense');

  cr.rew = addRewindable('crystal', block.mesh,
    () => ({ v: cr.alive, t: cr.timer }),
    (st) => {
      if (!st) {
        cr.alive = false;
        block.mesh.visible = false;
        block.collider.solid = false;
        return;
      }
      const was = cr.alive;
      cr.alive = st.v;
      cr.timer = st.t;
      block.mesh.visible = st.v;
      block.collider.solid = !!st.v;
      block.mesh.material = st.v ? W.M.crystal : W.M.sculpt;
      if (st.v && !was) sfx('condense');
    },
    block.mesh.position,
    () => { cr.alive = false; block.crystal = null; }
  );
  return true;
}

export function updateCrystals(dt) {
  for (let i = 0; i < S.crystals.length; i++) {
    const c = S.crystals[i];
    if (!c.alive) continue;
    c.timer -= dt;
    const k = 1 - c.timer / CFG.FUSE;
    const s = 1 + k * 0.38 + Math.sin(S.time * (6 + k * 26)) * 0.06;
    c.mesh.scale.setScalar(s);
    c.mesh.rotation.y += dt * (1 + k * 4);
    if (c.timer <= 0) detonate(c, 0);
  }
}

const pending = [];

export function detonate(c, depth) {
  if (!c.alive) return;
  c.alive = false;
  c.block.mesh.visible = false;
  c.block.collider.solid = false;
  c.timer = 0;

  const pos = c.block.mesh.position.clone();
  const decayBonus = 1 + S.upgrades.decay * 0.2;
  const mult = Math.min(3, 1 + 0.5 * depth) * decayBonus;

  shockwave(pos, 6.5, 0xff44dd, 0.5);
  spark(pos, 0xffaaff, 18);
  sfx('collapse');
  flash('#ff33cc', 0.12);
  addRift(4);

  for (let i = 0; i < S.enemies.length; i++) {
    const e = S.enemies[i];
    if (!e.alive) continue;
    const d = e.pos.distanceTo(pos);
    if (d < 6.5) hurtEnemy(e, 62 * mult * (1 - d / 13), true);
  }

  if (S.boss && S.boss.alive) {
    const d = S.boss.pos.distanceTo(pos);
    if (d < 12) S.boss.hurt(150 * mult * (1 - d / 18));
  }

  if (S.hooks.nodeDamage) S.hooks.nodeDamage(pos, 62 * mult);

  const dp = S.player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(pos);
  if (dp < 6) {
    const selfMul = 1 - S.upgrades.decay * 0.25;
    hurtPlayer(24 * (1 - dp / 8) * selfMul);
  }

  if (depth < 3) {
    for (let i = 0; i < S.crystals.length; i++) {
      const o = S.crystals[i];
      if (o === c || !o.alive) continue;
      if (o.block.mesh.position.distanceTo(pos) < 7.5) pending.push({ t: 0.07, c: o, depth: depth + 1 });
    }
  }

  if (depth >= 2) {
    S.stats.sec += 1;
    toast('каскад ×' + Math.min(3, 1 + 0.5 * depth).toFixed(1));
  }
}

export function updatePending(dt) {
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].t -= dt;
    if (pending[i].t <= 0) {
      const p = pending.splice(i, 1)[0];
      detonate(p.c, p.depth);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  ПАРАДОКС: эхо и игрок в одной точке                               */
/* ------------------------------------------------------------------ */
export function paradox(echo) {
  const p = echo.group.position.clone().add(new THREE.Vector3(0, 0.9, 0));
  shockwave(p, 5.5, 0xff7bff, 0.85);
  spark(p, 0xff9bff, 26);
  flash('#ffffff', 0.5);
  S.stats.paradox += 1;
  S.stats.sec += 2;
  addRift(7);
  toast('ПАРАДОКС');
  sfx('paradox');

  for (let i = 0; i < S.enemies.length; i++) {
    const e = S.enemies[i];
    if (e.alive && e.pos.distanceTo(p) < 5.5) hurtEnemy(e, 170, true);
  }
  if (S.boss && S.boss.alive && S.boss.pos.distanceTo(p) < 12) S.boss.hurt(220);
  hurtPlayer(22);
}
