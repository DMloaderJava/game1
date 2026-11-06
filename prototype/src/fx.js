/* Визуальные эффекты: ударные волны, искры, вспышки, линии памяти. */
import * as THREE from '../vendor/three.module.js';
import { W } from './world.js';
import { S } from './state.js';
import { nearbyPaths, PATH_MAX } from './rewind.js';

const fx = [];

export function shockwave(pos, radius, color, life) {
  life = life || 0.55;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.95, 44),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ring.position.copy(pos);
  W.scene.add(ring);
  fx.push({ o: ring, t: 0, life, radius, type: 'ring' });

  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.45, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  orb.position.copy(pos);
  W.scene.add(orb);
  fx.push({ o: orb, t: 0, life: life * 0.8, radius, type: 'orb' });
}

export function spark(pos, color, n) {
  n = n || 14;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3);
  const v = [];
  for (let i = 0; i < n; i++) {
    p[i * 3] = 0; p[i * 3 + 1] = 0; p[i * 3 + 2] = 0;
    v.push(new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 8, (Math.random() - 0.5) * 9));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size: 0.22, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  pts.position.copy(pos);
  W.scene.add(pts);
  fx.push({ o: pts, t: 0, life: 0.75, v, type: 'spark' });
}

export function trail(pos, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 6, 5),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  m.position.copy(pos);
  W.scene.add(m);
  fx.push({ o: m, t: 0, life: 0.35, type: 'fade' });
}

/* ------------------------------------------------------------------ */
/*  HITSTOP: микро-пауза кадра на удар                                */
/* ------------------------------------------------------------------ */
const HITSTOP_CAP = 0.09;
let hitstopLeft = 0;

export function hitstop(sec) {
  hitstopLeft = Math.min(HITSTOP_CAP, Math.max(hitstopLeft, sec));
}

/** Вызывается из главного цикла с РЕАЛЬНЫМ dt. true — мир в этот кадр замер. */
export function tickHitstop(realDt) {
  if (hitstopLeft <= 0) return false;
  hitstopLeft = Math.max(0, hitstopLeft - realDt);
  return true;
}

export function isHitstop() { return hitstopLeft > 0; }

/* ------------------------------------------------------------------ */
/*  ТРЯСКА КАМЕРЫ: направленная, с затуханием                         */
/* ------------------------------------------------------------------ */
const shake = { t: 1, dur: 1, amp: 0, dir: new THREE.Vector3(0, 1, 0) };
let fxClock = 0;

export function cameraShake(amp, dur, dir) {
  /* слабый импульс не перебивает сильный, который ещё играет */
  if (shake.t < shake.dur && amp < shake.amp * 0.55) return;
  shake.amp = amp;
  shake.dur = dur || 0.35;
  shake.t = 0;
  if (dir) shake.dir.copy(dir).normalize();
  else shake.dir.set(0, 0.25, 0).normalize();
}

function applyShake(realDt) {
  fxClock += realDt;
  if (shake.t >= shake.dur) return;
  shake.t += realDt;
  const k = 1 - Math.min(1, shake.t / shake.dur);
  const a = shake.amp * k * k;
  if (a <= 0.0001) return;
  const tx = fxClock;
  const nx = Math.sin(tx * 61.7) * 0.55 + Math.sin(tx * 33.1 + 1.7) * 0.45;
  const ny = Math.sin(tx * 47.3 + 2.1) * 0.55 + Math.sin(tx * 27.9 + 0.3) * 0.45;
  const nz = Math.sin(tx * 39.5 + 4.2);
  /* 65% — толчок от источника, 35% — «дрожь» по осям */
  W.camera.position.x += (shake.dir.x * 0.65 + nx * 0.35) * a;
  W.camera.position.y += (shake.dir.y * 0.65 + ny * 0.35) * a;
  W.camera.position.z += (shake.dir.z * 0.65 + nz * 0.35) * a;
  W.camera.rotation.x += ny * a * 0.16;
  W.camera.rotation.y += nx * a * 0.16;
}

/* ------------------------------------------------------------------ */
/*  ОСКОЛКИ: угловатые тетраэдры + затухающий шлейф                    */
/* ------------------------------------------------------------------ */
const DEBRIS_MAX = 36;
const debrisPool = [];
let debrisCursor = 0;
const debrisGeo = new THREE.TetrahedronGeometry(0.26, 0);

function debrisSlot(i) {
  if (debrisPool[i]) return debrisPool[i];
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaaff, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const mesh = new THREE.Mesh(debrisGeo, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  W.scene.add(mesh);
  const d = {
    mesh, mat, t: 0, life: 1, active: false, trailT: 0,
    vel: new THREE.Vector3(), spin: new THREE.Vector3()
  };
  debrisPool[i] = d;
  return d;
}

export function debris(pos, color, n, power, size) {
  const count = Math.max(1, Math.min(14, n || 8));
  const pw = power || 1;
  const sz = size || 1;
  for (let k = 0; k < count; k++) {
    const d = debrisSlot(debrisCursor % DEBRIS_MAX);
    debrisCursor++;
    const a = Math.random() * Math.PI * 2;
    const sp = (5 + Math.random() * 8) * pw;
    d.vel.set(Math.cos(a) * sp, (0.4 + Math.random() * 0.9) * sp * 0.75 + 2.5, Math.sin(a) * sp);
    d.mesh.position.copy(pos);
    d.mesh.position.x += (Math.random() - 0.5) * 0.7;
    d.mesh.position.y += (Math.random() - 0.5) * 0.7;
    d.mesh.position.z += (Math.random() - 0.5) * 0.7;
    d.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    d.mesh.scale.setScalar((0.6 + Math.random() * 0.9) * sz);
    d.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
    d.mat.color.setHex(color);
    d.mat.opacity = 1;
    d.t = 0;
    d.trailT = 0;
    d.life = 0.7 + Math.random() * 0.65;
    d.active = true;
    d.mesh.visible = true;
  }
}

/* пул точек-шлейфов: одна геометрия, один draw call */
const TRAIL_PTS = 240;
const tPos = new Float32Array(TRAIL_PTS * 3);
const tCol = new Float32Array(TRAIL_PTS * 3);
const tVel = new Float32Array(TRAIL_PTS * 3);
const tBase = new Float32Array(TRAIL_PTS * 3);
const tAge = new Float32Array(TRAIL_PTS);
const tLife = new Float32Array(TRAIL_PTS);
let trailGeo = null;
let trailCursor = 0;

function ensureTrailPool() {
  if (trailGeo) return;
  trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const pts = new THREE.Points(trailGeo, new THREE.PointsMaterial({
    size: 0.17, transparent: true, opacity: 0.9, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  W.scene.add(pts);
}

function emitTrail(x, y, z, r, g, b) {
  ensureTrailPool();
  const i = trailCursor % TRAIL_PTS;
  trailCursor++;
  const i3 = i * 3;
  tPos[i3] = x; tPos[i3 + 1] = y; tPos[i3 + 2] = z;
  tBase[i3] = r; tBase[i3 + 1] = g; tBase[i3 + 2] = b;
  tVel[i3] = 0; tVel[i3 + 1] = 0.35; tVel[i3 + 2] = 0;
  tAge[i] = 0;
  tLife[i] = 0.42;
}

function updateDebris(dt) {
  for (let i = 0; i < debrisPool.length; i++) {
    const d = debrisPool[i];
    if (!d.active) continue;
    d.t += dt;
    const k = d.t / d.life;
    if (k >= 1) {
      d.active = false;
      d.mesh.visible = false;
      continue;
    }
    d.vel.y -= 26 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
    d.mat.opacity = (1 - k) * (1 - k);
    d.trailT += dt;
    if (d.trailT >= 0.035) {
      d.trailT = 0;
      const c = d.mat.color;
      emitTrail(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z, c.r, c.g, c.b);
    }
  }
}

function updateTrailPoints(dt) {
  if (!trailGeo) return;
  let alive = 0;
  const drag = Math.pow(0.35, dt);
  for (let i = 0; i < TRAIL_PTS; i++) {
    if (tLife[i] <= 0) continue;
    tAge[i] += dt;
    const k = tAge[i] / tLife[i];
    const i3 = i * 3;
    if (k >= 1) {
      tLife[i] = 0;
      tCol[i3] = 0; tCol[i3 + 1] = 0; tCol[i3 + 2] = 0;
      continue;
    }
    alive++;
    tVel[i3 + 1] -= 1.5 * dt;
    tPos[i3] += tVel[i3] * dt;
    tPos[i3 + 1] += tVel[i3 + 1] * dt;
    tPos[i3 + 2] += tVel[i3 + 2] * dt;
    tVel[i3] *= drag; tVel[i3 + 1] *= drag; tVel[i3 + 2] *= drag;
    const f = 1 - k;
    tCol[i3] = tBase[i3] * f;
    tCol[i3 + 1] = tBase[i3 + 1] * f;
    tCol[i3 + 2] = tBase[i3 + 2] * f;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
  if (trailGeo.setDrawRange) trailGeo.setDrawRange(0, TRAIL_PTS);
  return alive;
}

export function clearDebris() {
  for (let i = 0; i < debrisPool.length; i++) {
    debrisPool[i].active = false;
    debrisPool[i].mesh.visible = false;
  }
  for (let i = 0; i < TRAIL_PTS; i++) {
    tLife[i] = 0;
    tCol[i * 3] = 0; tCol[i * 3 + 1] = 0; tCol[i * 3 + 2] = 0;
  }
  if (trailGeo) {
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
  }
  shake.t = shake.dur;
  shake.amp = 0;
  hitstopLeft = 0;
}

export function updateFx(dt, realDt) {
  const rt = realDt === undefined ? dt : realDt;
  applyShake(rt);
  updateDebris(dt);
  updateTrailPoints(dt);

  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = f.t / f.life;
    if (k >= 1) {
      W.scene.remove(f.o);
      if (f.o.geometry) f.o.geometry.dispose();
      if (f.o.material) f.o.material.dispose();
      fx.splice(i, 1);
      continue;
    }
    if (f.type === 'ring') {
      const s = 0.4 + k * f.radius;
      f.o.scale.set(s, s, s);
      f.o.material.opacity = 0.95 * (1 - k);
      f.o.quaternion.copy(W.camera.quaternion);
    } else if (f.type === 'orb') {
      const s = 1 + k * f.radius * 0.55;
      f.o.scale.set(s, s, s);
      f.o.material.opacity = 0.9 * (1 - k);
    } else if (f.type === 'spark') {
      const arr = f.o.geometry.attributes.position.array;
      for (let j = 0; j < f.v.length; j++) {
        f.v[j].y -= 16 * dt;
        arr[j * 3] += f.v[j].x * dt;
        arr[j * 3 + 1] += f.v[j].y * dt;
        arr[j * 3 + 2] += f.v[j].z * dt;
      }
      f.o.geometry.attributes.position.needsUpdate = true;
      f.o.material.opacity = 1 - k;
    } else {
      f.o.material.opacity = 0.75 * (1 - k);
      f.o.scale.setScalar(1 + k * 1.5);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  ЛИНИИ ПАМЯТИ                                                      */
/*  Пока игрок держит перемотку (или слой памяти Tab) — вокруг него       */
/*  расходятся тонкие пунктирные шлейфы: где был объект последние 8 с.    */
/* ------------------------------------------------------------------ */
const TRAIL_MAX = 16;
const TRAIL_RADIUS = 26;
const TRAIL_COLORS = {
  crystal: 0xff44dd,
  enemy: 0xff5a7a,
  echo: 0x9a6bff,
  block: 0x7b2dff,
  boss: 0xff2b6a
};
const trailPool = [];
const nearBuf = [];

function getTrail(i) {
  if (trailPool[i]) return trailPool[i];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
  geo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(PATH_MAX), 1));
  const mat = new THREE.LineDashedMaterial({
    color: 0x7b2dff,
    dashSize: 0.42,
    gapSize: 0.26,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 4;
  line.visible = false;
  W.scene.add(line);
  trailPool[i] = line;
  return line;
}

export function hideMemoryTrails() {
  for (let i = 0; i < trailPool.length; i++) trailPool[i].visible = false;
}

export function updateMemoryTrails(dt) {
  const active = (S.flags.rewinding || S.flags.memory) && S.mode === 'play';
  if (!active) { hideMemoryTrails(); return; }

  nearbyPaths(S.player.pos, TRAIL_RADIUS, nearBuf, TRAIL_MAX);

  for (let i = 0; i < TRAIL_MAX; i++) {
    const line = getTrail(i);
    const r = nearBuf[i];
    if (!r) { line.visible = false; continue; }

    const src = r.path;
    const total = src.length / 3;
    if (total < 4) { line.visible = false; continue; }
    const stride = total > 90 ? 2 : 1;

    const pos = line.geometry.attributes.position.array;
    const dist = line.geometry.attributes.lineDistance.array;
    let n = 0;
    let len = 0;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < total; k += stride) {
      const x = src[k * 3], y = src[k * 3 + 1], z = src[k * 3 + 2];
      if (n > 0) len += Math.hypot(x - px, y - py, z - pz);
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      dist[n] = len;
      px = x; py = y; pz = z;
      n++;
      if (n >= PATH_MAX) break;
    }
    if (n < 3) { line.visible = false; continue; }

    line.geometry.setDrawRange(0, n);
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.lineDistance.needsUpdate = true;

    line.material.color.setHex(TRAIL_COLORS[r.kind] || 0x7b2dff);
    const d = r.anchor.distanceTo(S.player.pos);
    const near = 1 - Math.min(1, d / TRAIL_RADIUS);
    const boost = S.flags.rewinding ? 1 : 0.55;
    line.material.opacity = (0.14 + near * 0.55) * boost;
    line.material.dashSize = 0.34 + near * 0.22;
    line.visible = true;
  }
}

export function clearFx() {
  clearDebris();
  for (const f of fx) {
    W.scene.remove(f.o);
    if (f.o.geometry) f.o.geometry.dispose();
    if (f.o.material) f.o.material.dispose();
  }
  fx.length = 0;
}
