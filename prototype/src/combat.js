/* Урон, нестабильные структуры, смерть, осколки. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG, addRift, clamp } from './state.js';
import { shockwave, spark, hitstop, cameraShake, debris } from './fx.js';
import { groundY } from './physics.js';
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
const C_COPPER = new THREE.Color(0x8a4a2a);
const C_GOLD = new THREE.Color(0xffb347);
const C_VIOLET = new THREE.Color(0x7b2dff);
const tmpCol = new THREE.Color();

const BLAST_R = 6;   // ровно радиус самоурона из detonate()
const blastRings = [];

/* кольцо поражения на полу: показывает, откуда надо успеть уйти */
function makeBlastRing(pos, ownMesh) {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(BLAST_R - 0.18, BLAST_R, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x7b2dff, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(BLAST_R, 48), fillMat);
  fill.rotation.x = -Math.PI / 2;
  group.add(ring, fill);
  const gy = groundY(pos.x, pos.z, pos.y + 0.5, ownMesh);
  group.position.set(pos.x, gy === null ? pos.y - 0.55 : gy + 0.07, pos.z);
  group.renderOrder = 2;
  W.scene.add(group);
  const rec = { group, ring, fill, ringMat, fillMat };
  blastRings.push(rec);
  return rec;
}

export function makeUnstable(block) {
  if (!block || block.crystal || block.dead) return false;
  /* своя копия материала: градиент цвета у каждого кристалла свой */
  const mat = W.M.crystal.clone();
  block.mesh.material = mat;
  const cr = {
    block, mesh: block.mesh, timer: CFG.FUSE, alive: true, depth: 0, rew: null,
    mat, base: block.mesh.position.clone(), ring: makeBlastRing(block.mesh.position, block.mesh)
  };
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
        if (cr.ring) cr.ring.group.visible = false;
        return;
      }
      const was = cr.alive;
      cr.alive = st.v;
      cr.timer = st.t;
      block.mesh.visible = st.v;
      block.collider.solid = !!st.v;
      block.mesh.material = st.v ? cr.mat : W.M.sculpt;
      if (cr.ring) cr.ring.group.visible = st.v;
      if (st.v && !was) sfx('condense');
    },
    block.mesh.position,
    () => { cr.alive = false; block.crystal = null; }
  );
  return true;
}

/* при смене зоны кольца телеграфа убираем вместе с остальной геометрией */
export function clearBlastRings() {
  for (let i = 0; i < blastRings.length; i++) {
    const r = blastRings[i];
    W.scene.remove(r.group);
    r.ring.geometry.dispose();
    r.fill.geometry.dispose();
    r.ringMat.dispose();
    r.fillMat.dispose();
  }
  blastRings.length = 0;
}

export function updateCrystals(dt) {
  for (let i = 0; i < S.crystals.length; i++) {
    const c = S.crystals[i];
    if (!c.alive) {
      if (c.ring && c.ring.group.visible) c.ring.group.visible = false;
      continue;
    }
    c.timer -= dt;
    const k = clamp(1 - c.timer / CFG.FUSE, 0, 1);

    /* 1. нарастающая вибрация — «сейчас рванёт» */
    const jit = 0.012 + k * k * 0.105;
    const b = c.base;
    if (b) {
      c.mesh.position.set(
        b.x + Math.sin(S.time * (34 + k * 92)) * jit,
        b.y + Math.sin(S.time * (47 + k * 71) + 1.3) * jit * 0.8,
        b.z + Math.cos(S.time * (41 + k * 83)) * jit
      );
    }

    /* 2. градиент медь → раскалённое золото → ультрафиолет */
    if (k < 0.5) tmpCol.copy(C_COPPER).lerp(C_GOLD, k / 0.5);
    else tmpCol.copy(C_GOLD).lerp(C_VIOLET, (k - 0.5) / 0.5);
    if (c.mat) {
      c.mat.color.copy(tmpCol);
      c.mat.emissive.copy(tmpCol);
      c.mat.emissiveIntensity = 1.1 + k * k * 4.6;
    }

    /* 3. кольцо радиуса поражения, заполняется по мере фитиля */
    if (c.ring) {
      const R = c.ring;
      R.group.visible = true;
      R.ring.scale.setScalar(0.18 + 0.82 * k);
      R.fill.scale.setScalar(Math.max(0.02, k));
      R.ringMat.color.copy(tmpCol);
      R.fillMat.color.copy(tmpCol);
      R.ringMat.opacity = 0.30 + 0.55 * k * (0.55 + 0.45 * Math.sin(S.time * 16));
      R.fillMat.opacity = 0.04 + 0.14 * k;
    }

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
  if (c.base) c.mesh.position.copy(c.base);   // снимаем вибрацию, взрыв от центра блока
  c.block.mesh.visible = false;
  c.block.collider.solid = false;
  c.timer = 0;
  if (c.ring) c.ring.group.visible = false;

  const pos = c.block.mesh.position.clone();
  const P = S.player;
  const dp = P.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(pos);

  /* ---- тактильность: hitstop 40–70 мс + направленная тряска + осколки ---- */
  hitstop(0.040 + Math.min(0.026, depth * 0.013) + (dp < 7 ? 0.006 : 0));
  const shakeDir = P.pos.clone().sub(pos);
  if (shakeDir.lengthSq() < 1e-4) shakeDir.set(0, 1, 0);
  const prox = clamp(1 - dp / 20, 0, 1);
  cameraShake(0.10 + prox * 0.46 * (1 + depth * 0.22), 0.36 + depth * 0.06, shakeDir);
  debris(pos, depth >= 2 ? 0xff5cff : 0xffb347, 7 + depth * 3, 0.85 + depth * 0.22, 1);

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
    if (d < 7.5) pushEnemy(e, pos, 15 * (1 - d / 7.5) * mult);
  }

  if (S.boss && S.boss.alive) {
    const d = S.boss.pos.distanceTo(pos);
    if (d < 12) S.boss.hurt(150 * mult * (1 - d / 18));
  }

  if (S.hooks.nodeDamage) S.hooks.nodeDamage(pos, 62 * mult);

  /* отбрасывание игрока: близкий коллапс подкидывает — можно рокет-джампить */
  if (dp < 7.2) {
    const push = 16 * (1 - dp / 7.2) * (depth >= 1 ? 1.12 : 1);
    const dir = P.pos.clone().sub(pos);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); else dir.normalize();
    if (S.hooks.impulse) {
      S.hooks.impulse(dir.x, 0, dir.z, push);
      S.hooks.impulse(0, 1, 0, Math.min(10.6, push * 0.68));
    }
  }

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

/* импульс врагу: гасится в updateEnemies */
function pushEnemy(e, from, power) {
  if (power <= 0.2) return;
  if (!e.knock) e.knock = new THREE.Vector3();
  const dir = e.pos.clone().sub(from);
  dir.y = Math.max(0, dir.y * 0.35) + 0.35;
  if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
  dir.normalize();
  e.knock.addScaledVector(dir, power);
  if (e.knock.length() > 26) e.knock.setLength(26);
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
  const P = S.player;

  /* парадокс — самый «липкий» удар в игре */
  hitstop(0.065);
  const dir = P.pos.clone().sub(p);
  if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
  cameraShake(0.58, 0.6, dir);
  debris(p, 0xff9bff, 12, 1.5, 1.15);

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
    if (!e.alive) continue;
    const d = e.pos.distanceTo(p);
    if (d < 5.5) hurtEnemy(e, 170, true);
    if (d < 7) pushEnemy(e, p, 20 * (1 - d / 7));
  }
  if (S.boss && S.boss.alive && S.boss.pos.distanceTo(p) < 12) S.boss.hurt(220);

  if (S.hooks.impulse) {
    const flat = P.pos.clone().sub(p);
    flat.y = 0;
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1); else flat.normalize();
    S.hooks.impulse(flat.x, 0, flat.z, 14);
    S.hooks.impulse(0, 1, 0, 9.5);
  }
  hurtPlayer(22);
}
