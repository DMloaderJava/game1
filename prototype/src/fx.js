/* Визуальные эффекты: ударные волны, искры, вспышки. */
import * as THREE from '../vendor/three.module.js';
import { W } from './world.js';

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

export function updateFx(dt) {
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

export function clearFx() {
  for (const f of fx) {
    W.scene.remove(f.o);
    if (f.o.geometry) f.o.geometry.dispose();
    if (f.o.material) f.o.material.dispose();
  }
  fx.length = 0;
}
