/* Зоны-биомы: геометрия, законы, узлы, портал. */
import * as THREE from '../vendor/three.module.js';
import { S, rand, clamp } from './state.js';
import { W, setMood } from './world.js';
import { makeBox, addCollider, refreshCollider, clearColliders } from './physics.js';
import { clearRewindables, addRewindable } from './rewind.js';
import { clearEnemies, makeSuture, makeMemophage, makeReversion } from './enemies.js';
import { clearBoss, spawnBoss } from './boss.js';
import { resetPlayer } from './player.js';
import { zoneCard, setObjective, toast } from './ui.js';
import { sfx, setZoneTone } from './audio.js';
import { spark } from './fx.js';

const G = new THREE.Group();   // всё, что принадлежит зоне

/* ------------------------------------------------------------------ */
/*  ХЕЛПЕРЫ                                                            */
/* ------------------------------------------------------------------ */
function add(mesh) { G.add(mesh); return mesh; }

function plat(w, h, d, x, y, z, mat, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || W.M.stone);
  m.position.set(x, y, z);
  if (opts.rotY) m.rotation.y = opts.rotY;
  m.updateMatrixWorld(true);
  add(m);
  const c = opts.solid === false ? null : addCollider(m, { dyn: !!opts.dyn });
  return { mesh: m, c };
}

function pillar(x, y, z, h, r, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, h, 7), mat || W.M.copper);
  m.position.set(x, y + h / 2, z);
  add(m);
  return m;
}

function decorRing(radius, count, yBase, hMax) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(-0.2, 0.2);
    const r = radius + rand(-5, 8);
    const h = rand(8, hMax);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rand(0.5, 1.4), rand(1.6, 3.2), h, 6, 1, true), W.M.stone2);
    m.position.set(Math.cos(a) * r, yBase + h / 2, Math.sin(a) * r);
    add(m);
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.5, 1.0), 0), W.M.violet);
    tip.position.copy(m.position).add(new THREE.Vector3(0, h / 2, 0));
    add(tip);
  }
}

function stairs(x, topY, z, dir, steps, w) {
  for (let i = 0; i < steps; i++) {
    plat(w || 5, 1.2, 3, x + dir.x * i * 2.6, topY - 0.6 + i * 1.7, z + dir.z * i * 2.6, W.M.stone2);
  }
}

function makeNode(x, y, z) {
  const g = [];
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), W.M.node.clone());
  core.position.set(x, y, z);
  add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.07, 8, 40), W.M.node.clone());
  ring.position.set(x, y, z);
  ring.rotation.x = Math.PI / 2;
  add(ring);
  const light = new THREE.PointLight(0x00ffcc, 14, 18, 2);
  light.position.set(x, y, z);
  add(light);
  const node = { mesh: core, ring, light, pos: new THREE.Vector3(x, y, z), alive: true, base: y, t: rand(0, 6) };
  S.nodes.push(node);
  return node;
}

function makePortal(x, y, z) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 10, 48), W.M.portal);
  ring.position.set(x, y, z);
  ring.rotation.y = Math.PI / 2;
  add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), W.M.portal);
  disc.position.set(x, y, z);
  disc.rotation.y = Math.PI / 2;
  add(disc);
  const light = new THREE.PointLight(0xaa44ff, 0, 26, 2);
  light.position.set(x, y, z);
  add(light);
  S.portal = { mesh: ring, disc, light, pos: new THREE.Vector3(x, y, z), active: false };
}

/* ------------------------------------------------------------------ */
/*  ЗОНЫ                                                               */
/* ------------------------------------------------------------------ */
export const ZONES = [
  /* ------------------------- 1. ЛЁГКИЕ ХОРА ------------------------ */
  {
    name: 'ЛЁГКИЕ ХОРА',
    sub: 'здесь всё растёт, даже то, что ты убил',
    mood: 0,
    spawn: new THREE.Vector3(0, 0.2, 38),
    laws: { breathing: true },
    build() {
      const p1 = plat(24, 2, 20, 0, -1, 34, W.M.stone);
      const p2 = plat(26, 2, 20, 0, -1, 2, W.M.stone2);
      const p3 = plat(20, 2, 16, -2, 3, -20, W.M.stone);
      plat(3, 10, 3, -15, 4, -20, W.M.copper);
      plat(3, 14, 3, 13, 6, -20, W.M.copper);
      plat(2, 8, 2, -12, 3, 26, W.M.copper);
      plat(2, 8, 2, 12, 3, 26, W.M.copper);
      stairs(4, 0, -6, { x: 0, z: -1 }, 3, 6);

      /* мост, который рухнул 4 секунды назад */
      for (let i = 0; i < 5; i++) {
        const z = 22.4 - i * 2.75;
        const m = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 2.8), W.M.copper);
        m.position.set(0, -0.225, z);
        add(m);
        const c = { min: new THREE.Vector3(), max: new THREE.Vector3(), solid: false, mesh: m };
        S.colliders.push(c);
        const intact = new THREE.Vector3(0, -0.225, z);
        const fall = new THREE.Vector3(rand(-3, 3), rand(-22, -14), z + rand(-2, 2));
        const fallR = new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3));
        let fixed = false;
        m.position.copy(fall);
        m.rotation.copy(fallR);
        m.updateMatrixWorld(true);
        refreshCollider(c);
        c.solid = false;
        addRewindable('prop', m, () => ({ v: fixed }), (st) => {
          if (!st) return;
          if (st.v) fixed = true;
          const v = !!(st.v || fixed);
          if (v) { m.position.copy(intact); m.rotation.set(0, 0, 0); }
          else { m.position.copy(fall); m.rotation.copy(fallR); }
          c.solid = v;
          m.updateMatrixWorld(true);
          refreshCollider(c);
        }, intact.clone());
      }

      /* дышащие платформы */
      const lungs = [
        { w: 8, h: 1.2, d: 8, x: 9, y: 2.6, z: 20, ph: 0, amp: 0.7 },
        { w: 7, h: 1.2, d: 7, x: -9, y: 1.8, z: 14, ph: 2, amp: 0.5 },
        { w: 9, h: 1.2, d: 6, x: 0, y: 4.4, z: -8, ph: 3.5, amp: 0.9 }
      ];
      for (const L of lungs) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(L.w, L.h, L.d), W.M.bone);
        m.position.set(L.x, L.y, L.z);
        add(m);
        const c = addCollider(m, { dyn: true });
        S.lungs.push({ mesh: m, c, baseY: L.y, ph: L.ph, amp: L.amp });
      }

      decorRing(46, 16, -4, 40);
      for (let i = 0; i < 10; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(rand(0.6, 1.8), 0.6, rand(0.6, 1.8)), W.M.copper);
        d.position.set(rand(-40, 40), rand(-12, 20), rand(-60, 40));
        add(d);
      }

      makeNode(8, 1.4, 36);
      makeNode(-8, 1.4, 6);
      makeNode(-2, 5.0, -20);
      makePortal(-2, 5.2, -25);

      makeSuture(7, 0.1, -2);
      makeMemophage(-7, 0.6, 8);
    }
  },

  /* ---------------------- 2. МЕДНЫЙ ПОЗВОНОЧНИК -------------------- */
  {
    name: 'МЕДНЫЙ ПОЗВОНОЧНИК',
    sub: 'гравитация здесь — жидкость',
    mood: 1,
    spawn: new THREE.Vector3(0, 0.2, 22),
    laws: {},
    build() {
      plat(16, 2, 16, 0, -1, 18, W.M.stone);
      plat(14, 2, 14, 0, 12, -4, W.M.stone2);
      plat(14, 2, 14, 0, 26, -24, W.M.stone);
      plat(12, 2, 12, 0, 30, -40, W.M.stone2);
      stairs(0, 27, -31, { x: 0, z: -1 }, 3, 5);

      /* восходящие потоки */
      const ups = [
        { x: 0, y: 0, z: 6, r: 4.6, h: 22, ph: 0 },
        { x: 0, y: 13, z: -14, r: 4.6, h: 22, ph: 1.4 }
      ];
      for (const u of ups) {
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(u.r, u.r, u.h, 14, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x66ffe0, transparent: true, opacity: 0.09, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        m.position.set(u.x, u.y + u.h / 2, u.z);
        add(m);
        for (let i = 0; i < 14; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), W.M.glow);
          p.position.set(u.x + rand(-u.r, u.r) * 0.7, u.y + rand(0, u.h), u.z + rand(-u.r, u.r) * 0.7);
          add(p);
          u.dots = u.dots || [];
          u.dots.push(p);
        }
        S.updrafts.push({ pos: new THREE.Vector3(u.x, u.y, u.z), radius: u.r, height: u.h, power: 34, maxRise: 13, dots: u.dots, mesh: m });
      }

      /* гравитационные колодцы */
      const wells = [
        { x: 11, y: 4, z: 18, r: 5, p: 16 },
        { x: -11, y: 16, z: -24, r: 6, p: 20 }
      ];
      for (const w of wells) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(w.r * 0.4, 1),
          new THREE.MeshBasicMaterial({ color: 0x33d0ff, transparent: true, opacity: 0.12, wireframe: true, depthWrite: false }));
        m.position.set(w.x, w.y, w.z);
        add(m);
        S.wells.push({ pos: new THREE.Vector3(w.x, w.y, w.z), radius: w.r, power: w.p, mesh: m });
      }

      pillar(0, 0, 6, 24, 2.2, W.M.copper);
      pillar(0, 13, -14, 24, 2.0, W.M.copper);
      decorRing(40, 12, -10, 46);

      makeNode(6, 1.4, 16);
      makeNode(5, 14.4, -4);
      makeNode(-4, 28.4, -24);
      makePortal(0, 32.2, -42);

      makeSuture(4, 13.1, -6);
      makeReversion([
        new THREE.Vector3(-6, 27.1, -28),
        new THREE.Vector3(6, 14.1, -8),
        new THREE.Vector3(-6, 14.1, -2),
        new THREE.Vector3(5, 27.1, -22)
      ]);
      makeMemophage(0, 27.6, -20);
    }
  },

  /* --------------------- 3. КАНЦЕЛЯРИЯ ЭТАЖЕЙ ---------------------- */
  {
    name: 'КАНЦЕЛЯРИЯ НЕВОЗМОЖНЫХ ЭТАЖЕЙ',
    sub: 'здание помнит, каким оно было',
    mood: 2,
    spawn: new THREE.Vector3(0, 0.2, 12),
    laws: { phase: true },
    build() {
      plat(30, 2, 24, 0, -1, 8, W.M.stone);
      for (let i = 0; i < 6; i++) {
        pillar(-13 + i * 5.2, 0, -3, 6 + (i % 2) * 4, 1.1, W.M.copper);
      }
      /* фазовые платформы вверх */
      const ph = [
        { x: 0, y: 2.0, z: -8, w: 9, d: 9, off: 0 },
        { x: -8, y: 4.0, z: -16, w: 9, d: 9, off: 2 },
        { x: 6, y: 6.0, z: -24, w: 9, d: 9, off: 4 },
        { x: 0, y: 8.0, z: -33, w: 10, d: 9, off: 1 }
      ];
      for (const p of ph) {
        const mat = W.M.stone2.clone();
        mat.transparent = true;
        const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.2, p.d), mat);
        m.position.set(p.x, p.y, p.z);
        add(m);
        const c = addCollider(m, { dyn: true });
        S.phasePlats.push({ mesh: m, c, mat, off: p.off, on: true });
      }
      plat(22, 2, 16, 0, 9.6, -44, W.M.stone);
      plat(3, 12, 3, -10, 8.6, -44, W.M.copper);
      plat(3, 12, 3, 10, 8.6, -44, W.M.copper);

      decorRing(38, 14, -6, 30);
      for (let i = 0; i < 16; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9), new THREE.MeshBasicMaterial({ color: 0xffe0a0, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }));
        s.position.set(rand(-26, 26), rand(1, 18), rand(-46, 16));
        s.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        add(s);
      }

      makeNode(-9, 1.4, 4);
      makeNode(9, 1.4, 12);
      makeNode(0, 11.0, -44);
      makePortal(0, 11.2, -49);

      makeSuture(-6, 0.1, 2);
      makeMemophage(8, 0.6, 14);
      makeReversion([
        new THREE.Vector3(-9, 0.1, 14),
        new THREE.Vector3(9, 0.1, 2),
        new THREE.Vector3(-4, 0.1, -2),
        new THREE.Vector3(4, 0.1, 16)
      ]);
    }
  },

  /* -------------------------- 4. МЕМБРАНА -------------------------- */
  {
    name: 'МЕМБРАНА',
    sub: 'это не конец мира, это его последний кадр',
    mood: 3,
    spawn: new THREE.Vector3(0, 0.2, 24),
    laws: { erase: true },
    build() {
      plat(20, 2, 18, 0, -1, 24, W.M.stone);
      const e = [
        { x: 0, y: 1.2, z: 8, w: 13, d: 11, off: 0 },
        { x: -10, y: 3.2, z: -4, w: 11, d: 11, off: 3 },
        { x: 0, y: 5.2, z: -16, w: 13, d: 11, off: 6 },
        { x: 10, y: 7.2, z: -28, w: 11, d: 11, off: 1.5 }
      ];
      for (const p of e) {
        const mat = W.M.stone.clone();
        mat.transparent = true;
        const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.4, p.d), mat);
        m.position.set(p.x, p.y, p.z);
        add(m);
        const c = addCollider(m, { dyn: true });
        S.erasePlats.push({ mesh: m, c, mat, off: p.off, solid: true });
      }
      plat(18, 2, 16, 0, 9.2, -44, W.M.stone2);
      plat(3, 16, 3, -8, 8, -44, W.M.copper);
      plat(3, 16, 3, 8, 8, -44, W.M.copper);

      /* море света */
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, 300, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x7a2fd0, transparent: true, opacity: 0.22 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, -26, -30);
      add(sea);

      decorRing(44, 18, -20, 34);

      makeNode(-6, 1.4, 26);
      makeNode(0, 6.6, -16);
      makeNode(6, 10.6, -44);
      makePortal(0, 10.8, -49);

      makeMemophage(-8, 0.6, 12);
      makeMemophage(8, 4.6, -14);
      makeReversion([
        new THREE.Vector3(-8, 0.1, 28),
        new THREE.Vector3(8, 0.1, 20),
        new THREE.Vector3(-8, 2.1, 2),
        new THREE.Vector3(6, 6.1, -14)
      ]);
      makeSuture(0, 0.1, 18);
    }
  },

  /* ------------------------- 5. ХОР-НОЛЬ --------------------------- */
  {
    name: 'ХОР-НОЛЬ',
    sub: 'первый свидетель · последний закон',
    mood: 3,
    spawn: new THREE.Vector3(0, 0.2, -24),
    laws: {},
    boss: true,
    build() {
      plat(40, 2, 40, 0, -1, -40, W.M.stone);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        plat(6, 1.4, 6, Math.cos(a) * 15, 2.5, -40 + Math.sin(a) * 15, W.M.stone2);
      }
      plat(4, 18, 4, -19, 0, -58, W.M.copper);
      plat(4, 18, 4, 19, 0, -58, W.M.copper);
      decorRing(52, 16, -20, 40);
      spawnBoss(new THREE.Vector3(0, 8, -46));
    }
  }
];

/* ------------------------------------------------------------------ */
/*  ЗАГРУЗКА / ВЫГРУЗКА                                                */
/* ------------------------------------------------------------------ */
export function clearZone() {
  clearEnemies();
  clearBoss();

  for (const b of S.blocks) if (b.mesh) W.scene.remove(b.mesh);
  S.blocks.length = 0;
  for (const e of S.echoes) if (e.group) W.scene.remove(e.group);
  S.echoes.length = 0;
  S.crystals.length = 0;

  while (G.children.length) {
    const o = G.children.pop();
    W.scene.remove(o);
    if (o.geometry) o.geometry.dispose();
  }
  W.scene.remove(G);

  clearColliders();
  clearRewindables();

  S.nodes.length = 0;
  S.wells.length = 0;
  S.updrafts.length = 0;
  S.phasePlats.length = 0;
  S.erasePlats.length = 0;
  S.lungs.length = 0;
  S.portal = null;
}

let activeHooksSet = false;

export function loadZone(i) {
  clearZone();
  S.zone = i;
  S.zoneTime = 0;
  S.rift = 0;
  S.memPenalty = 0;

  const Z = ZONES[i];
  setMood(Z.mood);
  setZoneTone(i);
  S.laws = Z.laws || {};

  W.scene.add(G);
  Z.build();

  const sp = Z.spawn;
  resetPlayer(sp.x, sp.y, sp.z);
  S.yaw = Math.PI;      // смотрим в -Z? нет: yaw=0 смотрит в -Z
  S.yaw = 0;
  S.pitch = 0;

  zoneCard(Z.name, Z.sub);

  if (i === 0) {
    setTimeout(() => {
      if (S.mode === 'play') toast('ЛКМ — лепить · ПКМ — уплотнить · подорви структуру рядом с узлом', 5.5);
    }, 3200);
  }

  if (Z.boss) {
    setObjective('Сразись с Хором-Нолём', 'только коллапсы и парадоксы наносят ему вред');
  } else {
    setObjective('Разрушь узлы: 0 из ' + S.nodes.length, 'нестабильная структура рядом с узлом');
  }

  if (!activeHooksSet) {
    S.hooks.nodeDamage = nodeDamage;
    activeHooksSet = true;
  }
}

function nodeDamage(pos, power) {
  let hit = 0;
  for (const n of S.nodes) {
    if (!n.alive) continue;
    if (n.pos.distanceTo(pos) < 6.5) {
      n.alive = false;
      n.mesh.material = W.M.nodeDead;
      n.ring.material = W.M.nodeDead;
      n.light.intensity = 0;
      n.mesh.scale.setScalar(0.5);
      spark(n.pos.clone(), 0x00ffcc, 22);
      S.stats.sec += 3;
      S.stats.paradox += 1;
      S.stats.nodes++;
      sfx('node');
      hit++;
    }
  }
  if (hit) refreshObjective();
}

function refreshObjective() {
  if (ZONES[S.zone].boss) return;
  const total = S.nodes.length;
  const done = S.nodes.filter((n) => !n.alive).length;
  if (done >= total) {
    setObjective('Портал открыт', 'иди к фиолетовому кольцу');
  } else {
    setObjective('Разрушь узлы: ' + done + ' из ' + total, 'нестабильная структура рядом с узлом');
  }
}

export function nodesLeft() {
  return S.nodes.filter((n) => n.alive).length;
}

/* ------------------------------------------------------------------ */
/*  ЗАКОНЫ БИОМОВ И ЛОГИКА                                             */
/* ------------------------------------------------------------------ */
export function updateZone(dt) {
  const t = S.time;

  /* дышащие платформы */
  for (let i = 0; i < S.lungs.length; i++) {
    const L = S.lungs[i];
    L.mesh.position.y = L.baseY + Math.sin(t * 0.8 + L.ph) * L.amp;
    L.mesh.rotation.z = Math.sin(t * 0.5 + L.ph) * 0.03;
    refreshCollider(L.c);
  }

  /* фазовые платформы */
  for (let i = 0; i < S.phasePlats.length; i++) {
    const P = S.phasePlats[i];
    const on = Math.sin((t + P.off) * 0.85) > -0.15;
    if (on !== P.on) {
      P.on = on;
      P.c.solid = on;
      P.mat.opacity = on ? 1 : 0.14;
      P.mat.emissiveIntensity = on ? 1 : 0.3;
    }
    P.mesh.rotation.y += dt * 0.1;
  }

  /* стираемые платформы */
  for (let i = 0; i < S.erasePlats.length; i++) {
    const E = S.erasePlats[i];
    const phase = (t + E.off) % 9;
    const solid = phase > 3.4;
    if (solid !== E.solid) {
      E.solid = solid;
      E.c.solid = solid;
      E.mat.opacity = solid ? 1 : 0.1;
    }
    E.mesh.position.y += Math.sin(t * 2 + i) * 0.0006;
  }

  /* потоки и колодцы — визуал */
  for (const u of S.updrafts) {
    for (let i = 0; i < u.dots.length; i++) {
      const d = u.dots[i];
      d.position.y += dt * 7;
      if (d.position.y > u.pos.y + u.height) d.position.y = u.pos.y;
    }
    u.mesh.material.opacity = 0.07 + Math.sin(t * 2) * 0.03;
  }
  for (const w of S.wells) {
    w.mesh.rotation.y += dt * 0.8;
    w.mesh.rotation.x += dt * 0.3;
  }

  /* узлы */
  for (const n of S.nodes) {
    n.t += dt;
    if (n.alive) {
      n.mesh.rotation.y += dt * 1.2;
      n.mesh.position.y = n.base + Math.sin(n.t * 1.6) * 0.18;
      n.ring.rotation.z += dt * 0.9;
      n.ring.scale.setScalar(1 + Math.sin(n.t * 2.2) * 0.05);
    } else {
      n.mesh.rotation.y += dt * 0.2;
    }
  }

  /* портал */
  if (S.portal) {
    const P = S.portal;
    P.mesh.rotation.z += dt * 0.7;
    P.disc.material.opacity = P.active ? 0.28 + Math.sin(t * 4) * 0.12 : 0.06;
    if (!P.active && nodesLeft() === 0 && !ZONES[S.zone].boss) {
      P.active = true;
      P.light.intensity = 30;
      sfx('portal');
      toast('портал открыт');
      flashPortal();
    }
    if (P.active) {
      const d = S.player.pos.distanceTo(P.pos);
      if (d < 3.4 && S.hooks.nextZone) S.hooks.nextZone();
    }
  }
}

function flashPortal() {
  if (S.portal) {
    S.portal.disc.material.emissiveIntensity = 4;
    spark(S.portal.pos.clone(), 0xaa44ff, 26);
  }
}

/* осыпание арены в третьей фазе босса */
export function crumbleArena() {
  const platforms = [];
  for (const c of S.colliders) {
    if (!c.mesh || !c.solid) continue;
    const wide = c.max.x - c.min.x;
    if (c.max.y < 6 && c.max.y > -2 && wide < 12) platforms.push(c);
  }
  if (platforms.length <= 2) return;
  const c = platforms[(Math.random() * platforms.length) | 0];
  c.solid = false;
  if (c.mesh) {
    c.mesh.material = c.mesh.material.clone();
    c.mesh.material.transparent = true;
    c.mesh.material.opacity = 0.12;
  }
  spark(new THREE.Vector3(c.mesh.position.x, c.max.y, c.mesh.position.z), 0xff66cc, 16);
  toast('арена теряет опору');
}
