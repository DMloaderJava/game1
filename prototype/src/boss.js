/* ХОР-НОЛЬ · Первый Свидетель — три фазы, играет твоими механиками. */
import * as THREE from '../vendor/three.module.js';
import { S, rand, clamp } from './state.js';
import { W } from './world.js';
import { hurtPlayer } from './combat.js';
import { makeShade } from './enemies.js';
import { poseAt } from './player.js';
import { shockwave, spark, hitstop, cameraShake, debris } from './fx.js';
import { sfx } from './audio.js';
import { toast, flash } from './ui.js';

const waves = [];

export function spawnBoss(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), W.M.bossGlow);
  core.position.y = 0;
  g.add(core);

  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(4.6, 0), W.M.boss);
  shell.material = W.M.boss.clone();
  shell.material.transparent = true;
  shell.material.opacity = 0.28;
  shell.material.side = THREE.DoubleSide;
  shell.material.wireframe = true;
  g.add(shell);

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, rand(3.5, 7), 6), W.M.copper);
    pipe.position.set(Math.cos(a) * rand(3.2, 4.4), rand(-2, 2), Math.sin(a) * rand(3.2, 4.4));
    pipe.rotation.z = Math.cos(a) * 0.5;
    pipe.rotation.x = Math.sin(a) * 0.5;
    g.add(pipe);
  }

  const halo = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.12, 8, 72), W.M.bossGlow);
  halo.rotation.x = Math.PI / 2;
  g.add(halo);

  const choir = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), W.M.bossGlow);
    m.material = W.M.bossGlow.clone();
    m.material.transparent = true;
    m.material.opacity = 0.35;
    m.position.set(Math.cos((i / 6) * Math.PI * 2) * 7.5, 0, Math.sin((i / 6) * Math.PI * 2) * 7.5);
    g.add(m);
    choir.push(m);
  }

  W.scene.add(g);

  S.boss = {
    group: g, core, shell, halo, choir,
    pos: pos.clone(), hp: 1600, maxHp: 1600, alive: true,
    phase: 1, t: 0, noteCd: 4, shadeCd: 9, revCd: 16, stitchUntil: 0,
    hurt(dmg) { hurtBoss(this, dmg); },
    get ratio() { return clamp(this.hp / this.maxHp, 0, 1); }
  };
  sfx('boss');
  toast('ХОР-НОЛЬ · Первый Свидетель');
  return S.boss;
}

/* пробитие фазы: мир на мгновение замирает и бьёт по камере */
function phaseBreak(b, power) {
  const dir = S.player.pos.clone().sub(b.pos);
  dir.y = 0.18;
  hitstop(0.07);
  cameraShake(0.34 * power, 0.62, dir);
  debris(b.pos.clone(), 0xff66cc, 12, 1.5 * power, 1.3);
  shockwave(b.pos.clone(), 9 * power, 0xff66cc, 0.6);
  spark(b.pos.clone(), 0xffaaff, 26);
  flash('#ff66cc', 0.22);
}

function hurtBoss(b, dmg) {
  if (!b.alive) return;
  b.hp -= dmg;
  b.hitPulse = 0.2;
  if (b.hp <= 0) {
    b.hp = 0;
    b.alive = false;
    b.group.visible = false;
    S.stats.bossDown = true;
    S.stats.sec += 6;
    S.stats.paradox += 3;
    hitstop(0.09);
    cameraShake(0.75, 0.9, S.player.pos.clone().sub(b.pos));
    debris(b.pos.clone(), 0xff9bff, 14, 2.0, 1.6);
    shockwave(b.pos.clone(), 26, 0xff66cc, 1.6);
    spark(b.pos.clone(), 0xffaaff, 60);
    flash('#ffffff', 0.8);
    sfx('paradox');
    if (S.hooks.onBossDown) S.hooks.onBossDown();
  } else if (b.hp < b.maxHp * 0.33 && b.phase < 3) {
    b.phase = 3;
    sfx('phase');
    phaseBreak(b, 1.25);
    toast('ФАЗА III · СИНГУЛЯРНОСТЬ');
    S.rift = Math.min(100, S.rift + 10);
  } else if (b.hp < b.maxHp * 0.66 && b.phase < 2) {
    b.phase = 2;
    sfx('phase');
    phaseBreak(b, 1.0);
    toast('ФАЗА II · РЕВИЗИЯ');
  }
}

function noteAttack(b) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 1.1, 64),
    new THREE.MeshBasicMaterial({ color: 0xff2b6a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  mesh.position.copy(b.pos);
  mesh.position.y -= 6;
  W.scene.add(mesh);
  waves.push({ mesh, t: 0, life: 1.25, radius: 16, center: b.pos.clone(), hit: false });
  sfx('boss');
}

export function updateBoss(dt) {
  const b = S.boss;
  if (!b || !b.alive) return;
  b.t += dt;

  b.group.rotation.y += dt * 0.35 * b.phase;
  b.core.rotation.x += dt * 0.5;
  b.core.rotation.y += dt * 0.7;
  b.shell.rotation.y -= dt * 0.2;
  b.halo.rotation.z += dt * 0.6;
  const pulse = 1 + Math.sin(S.time * 3) * 0.05;
  b.core.scale.setScalar(pulse * (1 + (3 - b.phase) * 0.05));
  for (let i = 0; i < b.choir.length; i++) {
    const m = b.choir[i];
    const a = (i / b.choir.length) * Math.PI * 2 + S.time * 0.5;
    m.position.set(Math.cos(a) * 7.5, Math.sin(S.time * 1.5 + i) * 1.6, Math.sin(a) * 7.5);
  }

  /* «ноты» */
  b.noteCd -= dt;
  if (b.noteCd <= 0) {
    noteAttack(b);
    b.noteCd = b.phase === 3 ? 3.4 : b.phase === 2 ? 4.6 : 6;
  }

  /* эхо-тени */
  b.shadeCd -= dt;
  const liveShades = S.enemies.filter((e) => e.type === 'shade' && e.alive).length;
  if (b.shadeCd <= 0 && liveShades < 5) {
    const n = b.phase === 1 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const off = new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8));
      const sh = makeShade(S.player.pos.clone().add(off));
      sh.hp = 50 + b.phase * 20;
    }
    b.shadeCd = b.phase === 3 ? 9 : 14;
    toast('Хор поднял твои эхо');
  }

  /* ревизия: босс откатывает тебя */
  if (b.phase >= 2) {
    b.revCd -= dt;
    if (b.revCd <= 0) {
      b.revCd = b.phase === 3 ? 14 : 20;
      const past = poseAt(S.time - 6);
      if (past) {
        spark(S.player.pos.clone(), 0xff66ff, 22);
        S.player.pos.copy(past.p);
        S.player.vel.set(0, 0, 0);
        flash('#ff33aa', 0.45);
        sfx('rewindStart');
        toast('РЕВИЗИЯ · тебя откатило на 6 секунд');
      }
      b.stitchUntil = S.time + 7;
    }
  }

  /* третья фаза: арена осыпается */
  if (b.phase === 3) {
    b.crumbleCd = (b.crumbleCd || 4) - dt;
    if (b.crumbleCd <= 0) {
      b.crumbleCd = 5.5;
      if (S.hooks.crumble) S.hooks.crumble();
    }
    b.pos.z = -40 + Math.sin(S.time * 0.4) * 4;
    b.group.position.copy(b.pos);
  }

  /* волны */
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.t += dt;
    const k = w.t / w.life;
    const r = 2 + k * w.radius;
    w.mesh.scale.set(r, r, r);
    w.mesh.material.opacity = 0.9 * (1 - k);
    if (!w.hit && w.t > 0.9) {
      w.hit = true;
      if (S.player.pos.distanceTo(w.center) < 9.5) hurtPlayer(16);
    }
    if (k >= 1) {
      W.scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mesh.material.dispose();
      waves.splice(i, 1);
    }
  }
}

export function clearBoss() {
  if (S.boss && S.boss.group) W.scene.remove(S.boss.group);
  for (const w of waves) W.scene.remove(w.mesh);
  waves.length = 0;
  S.boss = null;
}
