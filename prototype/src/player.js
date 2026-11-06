/* Игрок: движение, скульптура, эхо, перемотка, лечение. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG, clamp, inStitch, maxRewind, echoLimit } from './state.js';
import { W } from './world.js';
import { addCollider, removeCollider, moveAxis, aimPoint, aimBlocks, refreshCollider } from './physics.js';
import { addRewindable, removeRewindable, applyZone, commitRewind, sampleValue } from './rewind.js';
import { hurtPlayer, makeUnstable, paradox } from './combat.js';
import { toast, flash } from './ui.js';
import { sfx } from './audio.js';
import { shockwave, spark } from './fx.js';

export const P = S.player;

let rewinding = false;
let rwElapsed = 0;
let sculpt = null;
export let memoryMode = false;

const poseHist = [];
const hpHist = [];

export function isRewinding() { return rewinding; }

/* ------------------------------------------------------------------ */
/*  СПАВН / СБРОС                                                     */
/* ------------------------------------------------------------------ */
export function resetPlayer(x, y, z) {
  S.flags.rewinding = false;
  S.flags.sculpting = false;
  P.pos.set(x, y, z);
  P.vel.set(0, 0, 0);
  P.hp = P.maxHp;
  P.charge = 100;
  P.mass = maxMass();
  P.alive = true;
  P.onGround = false;
  rewinding = false;
  rwElapsed = 0;
  sculpt = null;
  poseHist.length = 0;
  hpHist.length = 0;
  S.keys = {};
}

export function maxMass() { return CFG.MASS_MAX + S.upgrades.flood * 8; }

/* ------------------------------------------------------------------ */
/*  ДВИЖЕНИЕ                                                          */
/* ------------------------------------------------------------------ */
export function updatePlayer(dt) {
  const f = new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
  const r = new THREE.Vector3(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
  const K = S.keys;
  const wish = new THREE.Vector3()
    .addScaledVector(f, (K['KeyW'] ? 1 : 0) - (K['KeyS'] ? 1 : 0))
    .addScaledVector(r, (K['KeyD'] ? 1 : 0) - (K['KeyA'] ? 1 : 0));
  if (wish.lengthSq() > 0) wish.normalize();

  const speed = rewinding ? 2.0 : CFG.MOVE;
  const accel = P.onGround ? 15 : 4.5;
  P.vel.x += (wish.x * speed - P.vel.x) * Math.min(1, accel * dt);
  P.vel.z += (wish.z * speed - P.vel.z) * Math.min(1, accel * dt);

  /* гравитационные колодцы и восходящие потоки */
  applyFields(dt);

  P.vel.y -= CFG.GRAVITY * dt;
  if (P.vel.y < -60) P.vel.y = -60;

  P.dashCd = Math.max(0, P.dashCd - dt);

  moveAxis('x', P.vel.x * dt);
  moveAxis('z', P.vel.z * dt);
  P.onGround = false;
  moveAxis('y', P.vel.y * dt);

  const bobAmp = Math.min(0.055, Math.hypot(P.vel.x, P.vel.z) * 0.007);
  const bob = Math.sin(S.time * 11) * bobAmp;
  W.camera.position.set(P.pos.x, P.pos.y + CFG.EYE + bob, P.pos.z);
  W.camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ');

  if (!rewinding) P.charge = Math.min(100, P.charge + 8 * dt);
  P.mass = Math.min(maxMass(), P.mass + (rewinding ? 0 : 6 * dt));

  if (P.pos.y < -45) hurtPlayer(9999);
}

function applyFields(dt) {
  for (let i = 0; i < S.wells.length; i++) {
    const w = S.wells[i];
    const d = P.pos.distanceTo(w.pos);
    if (d < w.radius) {
      const dir = P.pos.clone().sub(w.pos).normalize();
      P.vel.addScaledVector(dir, w.power * (1 - d / w.radius) * dt);
    }
  }
  for (let i = 0; i < S.updrafts.length; i++) {
    const u = S.updrafts[i];
    const p = P.pos;
    const dx = p.x - u.pos.x, dz = p.z - u.pos.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < u.radius && p.y > u.pos.y - 8 && p.y < u.pos.y + u.height) {
      P.vel.y += u.power * dt;
      if (P.vel.y > u.maxRise) P.vel.y = u.maxRise;
      P.vel.x += -dz * 0.6 * dt;
      P.vel.z += dx * 0.6 * dt;
    }
  }
}

export function jump() {
  if (P.onGround && !rewinding && S.mode === 'play') {
    P.vel.y = 10.2;
    P.onGround = false;
    sfx('jump');
  }
}

export function dash() {
  if (P.dashCd > 0 || rewinding || S.mode !== 'play') return;
  P.dashCd = 1.1;
  const f = new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
  P.vel.x += f.x * 15;
  P.vel.z += f.z * 15;
  S.rift = Math.min(100, S.rift + 0.8);
  sfx('dash');
}

/* ------------------------------------------------------------------ */
/*  СКУЛЬПТУРА                                                        */
/* ------------------------------------------------------------------ */
export function startSculpt() {
  if (S.mode !== 'play' || sculpt || rewinding) return;
  if (P.mass < 4) { toast('нет массы'); return; }
  const point = aimPoint();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), W.M.sculpt);
  mesh.position.copy(point);
  W.scene.add(mesh);
  sculpt = { mesh, size: 0.4, base: point.clone() };
  S.flags.sculpting = true;
  sfx('sculpt');
}

export function updateSculpt(dt) {
  if (!sculpt) return;
  const grow = dt * 2.6;
  const cost = grow * 3.0;
  const sizeLimit = 3.0 + S.upgrades.flood * 0.45;
  if (P.mass < cost || sculpt.size > sizeLimit) { endSculpt(); return; }
  P.mass -= cost;
  sculpt.size += grow;
  const s = sculpt.size;
  sculpt.mesh.scale.set(s, s, s);
  sculpt.mesh.position.set(sculpt.base.x, sculpt.base.y + (s - 0.4) / 2, sculpt.base.z);
  sculpt.mesh.rotation.y += dt * 0.55;
  S.rift = Math.min(100, S.rift + 0.6 * dt);
}

export function endSculpt() {
  if (!sculpt) return;
  const mesh = sculpt.mesh;
  mesh.rotation.y = 0;
  mesh.updateMatrixWorld(true);
  const s = sculpt.size;
  sculpt = null;
  S.flags.sculpting = false;
  if (s < 0.55) {
    W.scene.remove(mesh);
    mesh.geometry.dispose();
    return;
  }
  const block = registerBlock(mesh);
  sfx('block');
  if (S.blocks.length > 14) {
    const oldest = S.blocks.find((b) => b !== block);
    if (oldest) removeBlockFull(oldest);
  }
}

export function registerBlock(mesh) {
  mesh.updateMatrixWorld(true);
  const c = addCollider(mesh);
  const block = { mesh, collider: c, crystal: null, born: S.time, dead: false, rew: null };
  S.blocks.push(block);
  block.rew = addRewindable('block', mesh,
    () => ({ v: mesh.visible, p: mesh.position.toArray(), s: mesh.scale.toArray() }),
    (st) => {
      if (!st) {
        mesh.visible = false;
        c.solid = false;
        return;
      }
      mesh.visible = st.v;
      mesh.position.fromArray(st.p);
      mesh.scale.fromArray(st.s);
      c.solid = !!st.v;
      refreshCollider(c);
    },
    mesh.position,
    () => {
      block.dead = true;
      W.scene.remove(mesh);
      removeCollider(c);
      const i = S.blocks.indexOf(block);
      if (i >= 0) S.blocks.splice(i, 1);
    }
  );
  return block;
}

function removeBlockFull(block) {
  if (block.dead) return;
  block.dead = true;
  W.scene.remove(block.mesh);
  block.mesh.geometry.dispose();
  removeCollider(block.collider);
  removeRewindable(block.rew);
  const i = S.blocks.indexOf(block);
  if (i >= 0) S.blocks.splice(i, 1);
  if (block.crystal) {
    block.crystal.alive = false;
    const ci = S.crystals.indexOf(block.crystal);
    if (ci >= 0) S.crystals.splice(ci, 1);
  }
}

export function condense() {
  if (S.mode !== 'play' || rewinding) return;
  let block = aimBlocks(7);
  if (!block) {
    if (P.mass < 6) { toast('нет массы'); return; }
    P.mass -= 6;
    const p = aimPoint(5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), W.M.sculpt);
    mesh.position.copy(p);
    W.scene.add(mesh);
    block = registerBlock(mesh);
  }
  if (block.crystal) { toast('уже нестабильно'); return; }
  makeUnstable(block);
}

/* ------------------------------------------------------------------ */
/*  ЭХО                                                               */
/* ------------------------------------------------------------------ */
export function poseAt(t) {
  const s = sampleValue(poseHist, t);
  return s ? s.v : null;
}

export function spawnEcho() {
  if (S.mode !== 'play' || rewinding) return;
  if (P.charge < 5) { toast('нет заряда'); return; }
  if (S.echoes.length >= echoLimit()) removeEcho(S.echoes[0]);
  P.charge -= 5;

  const past = poseAt(S.time - 2.5);
  const pos = past ? past.p.clone() : P.pos.clone();
  if (pos.distanceTo(P.pos) < 1.9) {
    const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), S.yaw);
    pos.copy(P.pos).addScaledVector(back, 2.5);
  }

  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), W.M.echo);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), W.M.echo);
  head.position.y = 1.58;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.3), W.M.echo);
  legs.position.y = 0.3;
  g.add(torso, head, legs);
  g.position.copy(pos);
  g.rotation.y = past ? past.yaw : S.yaw;
  W.scene.add(g);

  const c = {
    min: new THREE.Vector3(pos.x - 0.45, pos.y, pos.z - 0.45),
    max: new THREE.Vector3(pos.x + 0.45, pos.y + 1.7, pos.z + 0.45),
    solid: true, mesh: g
  };
  S.colliders.push(c);

  const echo = { group: g, collider: c, born: S.time, age: 0, rew: null };
  S.echoes.push(echo);
  echo.rew = addRewindable('echo', g,
    () => ({ v: true, p: g.position.toArray(), y: g.rotation.y }),
    (st) => {
      if (!st) { g.visible = false; c.solid = false; return; }
      g.visible = true;
      g.position.fromArray(st.p);
      g.rotation.y = st.y;
      c.solid = true;
      c.min.set(g.position.x - 0.45, g.position.y, g.position.z - 0.45);
      c.max.set(g.position.x + 0.45, g.position.y + 1.7, g.position.z + 0.45);
    },
    g.position,
    () => {
      W.scene.remove(g);
      const ci = S.colliders.indexOf(c);
      if (ci >= 0) S.colliders.splice(ci, 1);
      const i = S.echoes.indexOf(echo);
      if (i >= 0) S.echoes.splice(i, 1);
    }
  );

  S.rift = Math.min(100, S.rift + 1);
  sfx('echo');
}

export function removeEcho(e) {
  W.scene.remove(e.group);
  const ci = S.colliders.indexOf(e.collider);
  if (ci >= 0) S.colliders.splice(ci, 1);
  const i = S.echoes.indexOf(e);
  if (i >= 0) S.echoes.splice(i, 1);
  if (e.rew) removeRewindable(e.rew);
}

export function updateEchoes(dt) {
  for (let i = S.echoes.length - 1; i >= 0; i--) {
    const e = S.echoes[i];
    e.age += dt;
    e.group.position.y += Math.sin(S.time * 2 + i) * 0.0007;
    const k = 1 - e.age / CFG.ECHO_LIFE;
    e.group.scale.setScalar(0.9 + k * 0.1);
    if (e.age > CFG.ECHO_LIFE) { removeEcho(e); continue; }
    if (e.age > 2.0 && e.group.position.distanceTo(P.pos) < 1.35) {
      paradox(e);
      removeEcho(e);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  ПЕРЕМОТКА                                                         */
/* ------------------------------------------------------------------ */
export function beginRewind() {
  if (S.mode !== 'play' || rewinding || P.charge < 6) return;
  rewinding = true;
  rwElapsed = 0;
  S.flags.rewinding = true;
  sfx('rewindStart');
}

export function endRewind() {
  if (!rewinding) return;
  const target = S.time - rwElapsed;
  commitRewind(target);

  if (rwElapsed > 1.5) {
    for (let i = 0; i < S.enemies.length; i++) {
      const e = S.enemies[i];
      if (!e.alive) continue;
      if (e.pos.distanceTo(P.pos) > CFG.RADIUS) continue;
      if (inStitch(e.pos)) continue;
      hurtEnemySafe(e, rwElapsed * 5.5);
    }
    if (S.boss && S.boss.alive && S.boss.pos.distanceTo(P.pos) < 20) S.boss.hurt(rwElapsed * 8);
  }
  rwElapsed = 0;
  rewinding = false;
  S.flags.rewinding = false;
  sfx('rewindEnd');
}

function hurtEnemySafe(e, dmg) {
  e.hp -= dmg;
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    if (e.group) e.group.visible = false;
    if (S.hooks.onKill) S.hooks.onKill(e);
  }
}

export function updateRewind(dt) {
  if (!rewinding) return;
  rwElapsed = Math.min(maxRewind(), rwElapsed + dt);
  P.charge -= 13 * dt;
  S.rift = Math.min(100, S.rift + 2.2 * dt);
  if (P.charge <= 0) { P.charge = 0; endRewind(); return; }

  const target = S.time - rwElapsed;
  applyZone(target, P.pos, CFG.RADIUS, inStitch, rwElapsed);

  const hs = sampleValue(hpHist, target);
  if (hs && hs.v > P.hp) P.hp = Math.min(hs.v, P.hp + 34 * dt);
}

/* ------------------------------------------------------------------ */
/*  ИСТОРИЯ                                                           */
/* ------------------------------------------------------------------ */
export function recordPlayer(t) {
  if (!poseHist.length || t - poseHist[poseHist.length - 1].t > 0.05) {
    poseHist.push({ t, v: { p: P.pos.clone(), yaw: S.yaw } });
    if (poseHist.length > 320) poseHist.shift();
  }
  if (!hpHist.length || t - hpHist[hpHist.length - 1].t > 0.05) {
    hpHist.push({ t, v: P.hp });
    if (hpHist.length > 320) hpHist.shift();
  }
}

export function toggleMemory(on) {
  memoryMode = on;
  S.flags.memory = !!on;
}
