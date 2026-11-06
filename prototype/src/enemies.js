/* Бестиарий: Шов, Мнемофаг, Реверс, Эхо-тень. */
import * as THREE from '../vendor/three.module.js';
import { S, rand, clamp } from './state.js';
import { W } from './world.js';
import { hurtPlayer, hurtEnemy } from './combat.js';
import { addRewindable, removeRewindable } from './rewind.js';
import { removeEcho } from './player.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';
import { shockwave, spark } from './fx.js';

export const needles = [];

function attach(e) {
  S.enemies.push(e);
  e.rew = addRewindable('enemy', e.group,
    () => ({ p: e.pos.toArray(), h: e.hp, v: e.alive }),
    (st) => {
      if (!st) return;
      e.pos.fromArray(st.p);
      e.hp = st.h;
      e.alive = st.v;
      e.group.visible = st.v;
      if (e.onRewind) e.onRewind();
    },
    e.pos
  );
  return e;
}

/* ------------------------------------------------------------------ */
/*  ШОВ — хирург стабильности                                          */
/* ------------------------------------------------------------------ */
export function makeSuture(x, y, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.46, 2.2, 6), W.M.enemy);
  body.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), W.M.enemyGlow);
  head.position.y = 2.55;
  const n1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 1.5, 5), W.M.bone);
  n1.position.set(0.52, 1.5, 0);
  n1.rotation.z = -0.5;
  const n2 = n1.clone();
  n2.position.x = -0.52;
  n2.rotation.z = 0.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.05, 6, 48),
    new THREE.MeshBasicMaterial({ color: 0xff5c7a, transparent: true, opacity: 0.22 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  g.add(body, head, n1, n2, ring);
  g.position.set(x, y, z);
  W.scene.add(g);

  const e = {
    type: 'suture', group: g, pos: new THREE.Vector3(x, y, z),
    hp: 120, maxHp: 120, alive: true, fireCd: rand(1.5, 3), ring,
    baseY: y, speed: 2.6, stitchR: 5.2
  };
  return attach(e);
}

/* ------------------------------------------------------------------ */
/*  МНЕМОФАГ — пожиратель памяти                                       */
/* ------------------------------------------------------------------ */
export function makeMemophage(x, y, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), W.M.mem);
  body.position.y = 1.55;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 1.5, 4), W.M.bone);
    leg.position.set(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  g.add(body);
  g.position.set(x, y, z);
  W.scene.add(g);

  const e = {
    type: 'memophage', group: g, pos: new THREE.Vector3(x, y, z),
    hp: 90, maxHp: 90, alive: true, body, biteCd: 0, ate: 0, stuffed: 0, baseY: y
  };
  return attach(e);
}

/* ------------------------------------------------------------------ */
/*  РЕВЕРС — тот, кто живёт назад                                      */
/* ------------------------------------------------------------------ */
export function makeReversion(route) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.35), W.M.rev);
  torso.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), W.M.rev);
  head.position.y = 1.95;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 32), W.M.glow);
  halo.position.y = 1.2;
  halo.rotation.x = Math.PI / 2;
  g.add(torso, head, halo);
  const start = route[route.length - 1];
  g.position.copy(start);
  W.scene.add(g);

  const e = {
    type: 'reversion', group: g, pos: start.clone(),
    hp: 70, maxHp: 70, alive: true, route, idx: route.length - 1,
    vulnerable: false, halo
  };
  return attach(e);
}

/* ------------------------------------------------------------------ */
/*  ЭХО-ТЕНЬ — копия игрока, поднятая боссом                           */
/* ------------------------------------------------------------------ */
export function makeShade(pos) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({
    color: 0x3a1a4a, emissive: 0xff2b6a, emissiveIntensity: 1.3,
    transparent: true, opacity: 0.6, roughness: 0.3, depthWrite: false
  });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), m);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), m);
  head.position.y = 1.58;
  g.add(torso, head);
  g.position.copy(pos);
  W.scene.add(g);

  const e = {
    type: 'shade', group: g, pos: pos.clone(), hp: 60, maxHp: 60, alive: true,
    biteCd: 0, speed: 4.4
  };
  return attach(e);
}

/* ------------------------------------------------------------------ */
/*  ИГЛЫ ШВА                                                          */
/* ------------------------------------------------------------------ */
function fireNeedle(e) {
  const from = e.pos.clone().add(new THREE.Vector3(0, 2.2, 0));
  const to = S.player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
  const dir = to.sub(from).normalize();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6), W.M.glow);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  W.scene.add(mesh);
  needles.push({ mesh, vel: dir.multiplyScalar(28), life: 2.2 });
  sfx('dash');
}

/* ------------------------------------------------------------------ */
/*  ОБНОВЛЕНИЕ                                                        */
/* ------------------------------------------------------------------ */
export function updateEnemies(dt) {
  const pp = S.player.pos.clone().add(new THREE.Vector3(0, 0.9, 0));

  for (let i = 0; i < S.enemies.length; i++) {
    const e = S.enemies[i];
    if (!e.alive) continue;
    const ep = e.pos;

    if (e.type === 'suture') {
      const to = S.player.pos.clone().sub(ep);
      to.y = 0;
      const dist = to.length();
      const dir = to.normalize();
      if (dist < 16) {
        if (dist > 11) ep.addScaledVector(dir, e.speed * dt);
        else if (dist < 7) ep.addScaledVector(dir, -e.speed * 0.8 * dt);
        else {
          ep.x += -dir.z * e.speed * 0.5 * dt * Math.sin(S.time + i);
          ep.z += dir.x * e.speed * 0.5 * dt * Math.sin(S.time + i);
        }
      }
      ep.y = e.baseY;
      e.group.rotation.y = Math.atan2(S.player.pos.x - ep.x, S.player.pos.z - ep.z);
      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 21) { fireNeedle(e); e.fireCd = 3.8; }
      e.ring.material.opacity = 0.14 + Math.sin(S.time * 3) * 0.07;
      e.ring.rotation.z += dt * 0.4;

    } else if (e.type === 'memophage') {
      let target = null;
      let best = 34;
      for (let k = 0; k < S.echoes.length; k++) {
        const d = ep.distanceTo(S.echoes[k].group.position);
        if (d < best) { best = d; target = S.echoes[k]; }
      }
      if (target) {
        const dir = target.group.position.clone().sub(ep).normalize();
        ep.addScaledVector(dir, 5.2 * dt);
        if (ep.distanceTo(target.group.position) < 1.9) {
          removeEcho(target);
          e.hp = Math.min(190, e.hp + 25);
          e.ate++;
          S.memPenalty = Math.min(4, S.memPenalty + 0.6);
          toast('Мнемофаг съел эхо · глубина −' + S.memPenalty.toFixed(1) + ' с');
          sfx('hurt');
          e.stuffed = S.time;
        }
      } else {
        const dir = S.player.pos.clone().sub(ep);
        dir.y = 0;
        const d = dir.length();
        if (d > 2.6) ep.addScaledVector(dir.normalize(), 3.2 * dt);
        e.biteCd -= dt;
        if (d < 3.2 && e.biteCd <= 0) { hurtPlayer(9); e.biteCd = 1.3; }
      }
      ep.y = e.baseY + Math.sin(S.time * 1.6 + i) * 0.35;
      e.body.scale.setScalar(1 + e.ate * 0.22);

      if (e.hp >= 140 && e.stuffed && S.time - e.stuffed > 7) {
        shockwave(ep.clone(), 7, 0xff88ff, 0.8);
        spark(ep.clone(), 0xffaaff, 20);
        hurtPlayer(Math.max(0, 45 - ep.distanceTo(pp) * 4));
        S.memPenalty = Math.min(4, S.memPenalty + 1.2);
        e.hp = 60;
        e.ate = 0;
        e.stuffed = 0;
        toast('взрыв памяти · глубина −1.2 с');
        sfx('collapse');
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
      e.vulnerable = (S.hooks.rewinding && S.hooks.rewinding()) || e.idx <= 1;
      e.halo.material = e.vulnerable ? W.M.enemyGlow : W.M.glow;

      for (let b = 0; b < S.blocks.length; b++) {
        const bm = S.blocks[b];
        if (!bm.mesh.visible) continue;
        if (bm.mesh.position.distanceTo(ep) < 1.7) {
          e.vulnerable = true;
          hurtEnemy(e, 260, true);
          shockwave(ep.clone(), 4, 0x66aaff, 0.6);
          break;
        }
      }

    } else if (e.type === 'shade') {
      const dir = S.player.pos.clone().sub(ep);
      dir.y = 0;
      const d = dir.length();
      if (d > 1.6) ep.addScaledVector(dir.normalize(), e.speed * dt);
      ep.y = S.player.pos.y + Math.sin(S.time * 2 + i) * 0.25;
      e.group.rotation.y = Math.atan2(dir.x, dir.z);
      e.biteCd -= dt;
      if (d < 2.2 && e.biteCd <= 0) { hurtPlayer(10); e.biteCd = 1.6; }
    }

    e.group.position.copy(e.pos);
  }

  /* иглы */
  for (let i = needles.length - 1; i >= 0; i--) {
    const n = needles[i];
    n.mesh.position.addScaledVector(n.vel, dt);
    n.life -= dt;
    if (n.mesh.position.distanceTo(pp) < 0.95) {
      hurtPlayer(9);
      W.scene.remove(n.mesh);
      needles.splice(i, 1);
      continue;
    }
    if (n.life <= 0) { W.scene.remove(n.mesh); needles.splice(i, 1); }
  }
}

export function clearEnemies() {
  for (const e of S.enemies) {
    if (e.group) W.scene.remove(e.group);
    if (e.rew) removeRewindable(e.rew);
  }
  S.enemies.length = 0;
  for (const n of needles) W.scene.remove(n.mesh);
  needles.length = 0;
}
