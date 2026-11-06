/* Геометрия, коллайдеры, движение игрока по AABB. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG } from './state.js';
import { W } from './world.js';

const _bb = new THREE.Box3();

export function makeBox(w, h, d, x, y, z, mat, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  if (opts.rotY) mesh.rotation.y = opts.rotY;
  mesh.updateMatrixWorld(true);
  if (opts.parent) opts.parent.add(mesh); else W.scene.add(mesh);
  if (opts.solid === false) return { mesh, c: null };
  const c = addCollider(mesh, opts);
  return { mesh, c };
}

export function addCollider(mesh, opts = {}) {
  mesh.updateMatrixWorld(true);
  _bb.setFromObject(mesh);
  const c = {
    min: _bb.min.clone(),
    max: _bb.max.clone(),
    solid: opts.solid !== false,
    mesh,
    dyn: !!opts.dyn
  };
  S.colliders.push(c);
  if (opts.ray !== false && mesh) S.rayTargets.push(mesh);
  if (mesh) mesh.userData.collider = c;
  return c;
}

export function refreshCollider(c) {
  if (!c.mesh) return;
  c.mesh.updateMatrixWorld(true);
  _bb.setFromObject(c.mesh);
  c.min.copy(_bb.min);
  c.max.copy(_bb.max);
}

export function removeCollider(c) {
  let i = S.colliders.indexOf(c);
  if (i >= 0) S.colliders.splice(i, 1);
  if (c.mesh) {
    i = S.rayTargets.indexOf(c.mesh);
    if (i >= 0) S.rayTargets.splice(i, 1);
  }
}

export function clearColliders() {
  S.colliders.length = 0;
  S.rayTargets.length = 0;
}

export function playerAABB() {
  const p = S.player.pos;
  return {
    min: new THREE.Vector3(p.x - CFG.PR, p.y, p.z - CFG.PR),
    max: new THREE.Vector3(p.x + CFG.PR, p.y + CFG.PH, p.z + CFG.PR)
  };
}

function overlap(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x &&
         a.min.y < b.max.y && a.max.y > b.min.y &&
         a.min.z < b.max.z && a.max.z > b.min.z;
}

/* пошаговое разрешение столкновений по одной оси + шаг на низкие ступени */
export function moveAxis(axis, amount) {
  if (!amount) return;
  const P = S.player;
  P.pos[axis] += amount;
  let pb = playerAABB();
  for (let i = 0; i < S.colliders.length; i++) {
    const c = S.colliders[i];
    if (!c.solid) continue;
    if (!overlap(pb, c)) continue;

    if (axis !== 'y') {
      const origY = P.pos.y;
      const rise = c.max.y - origY;
      if (rise > 0 && rise < 0.62) {
        P.pos.y = c.max.y + 0.002;
        pb = playerAABB();
        if (!overlap(pb, c)) continue;
        P.pos.y = origY;
        pb = playerAABB();
      }
    }

    if (amount > 0) P.pos[axis] -= (pb.max[axis] - c.min[axis]) + 0.001;
    else P.pos[axis] += (c.max[axis] - pb.min[axis]) + 0.001;

    if (axis === 'y') {
      if (amount < 0) P.onGround = true;
      P.vel.y = 0;
    } else {
      P.vel[axis] = 0;
    }
    pb = playerAABB();
  }
}

const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

export function visibleTargets() {
  const out = [];
  for (let i = 0; i < S.rayTargets.length; i++) if (S.rayTargets[i].visible) out.push(S.rayTargets[i]);
  for (let i = 0; i < S.blocks.length; i++) if (S.blocks[i].mesh.visible) out.push(S.blocks[i].mesh);
  return out;
}

/* точка прицела: попадание по геометрии или 3.4 м вперёд */
export function aimPoint(far) {
  raycaster.setFromCamera(center, W.camera);
  raycaster.far = far || 6;
  const hits = raycaster.intersectObjects(visibleTargets(), false);
  if (hits.length) return hits[0].point.clone();
  return W.camera.position.clone().add(W.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3.4));
}

export function aimBlocks(far) {
  raycaster.setFromCamera(center, W.camera);
  raycaster.far = far || 7;
  const list = S.blocks.filter((b) => b.mesh.visible).map((b) => b.mesh);
  const hits = raycaster.intersectObjects(list, false);
  if (!hits.length) return null;
  return S.blocks.find((b) => b.mesh === hits[0].object) || null;
}

/* высота пола под точкой (для колец поражения и телеграфа) */
const downDir = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();

export function groundY(x, z, fromY, exclude) {
  rayOrigin.set(x, fromY, z);
  raycaster.set(rayOrigin, downDir);
  raycaster.far = 90;
  const hits = raycaster.intersectObjects(visibleTargets(), false);
  for (let i = 0; i < hits.length; i++) {
    if (exclude && hits[i].object === exclude) continue;
    return hits[i].point.y;
  }
  return null;
}

export function pointInBox(p, min, max) {
  return p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
}
