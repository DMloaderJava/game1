/* Руки Разломщика: вьюмодель от первого лица.
   Биомеханические перчатки со светящимися швами — реагируют на ходьбу,
   лепку, перемотку и запуск от собственного взрыва. */
import * as THREE from '../vendor/three.module.js';
import { S, clamp } from './state.js';
import { W } from './world.js';

let H = null;

const lerp = (a, b, t) => a + (b - a) * t;

function makeArm(side, mat, glowMat) {
  const g = new THREE.Group();

  /* предплечье */
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.34), mat);
  forearm.position.set(0, 0.012, -0.15);
  g.add(forearm);

  /* манжета с гранёным ободом */
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 6), glowMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 0.012, -0.30);
  g.add(cuff);

  /* кисть */
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.095, 0.16), mat);
  palm.position.set(0, -0.004, -0.38);
  palm.rotation.x = -0.06;
  g.add(palm);

  /* пальцы-фаланги */
  const fingers = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.135), mat);
    const bx = (i - 1) * 0.044;
    f.position.set(bx, 0.002, -0.50);
    f.rotation.x = -0.16;
    f.userData.baseX = bx;
    g.add(f);
    fingers.push(f);
  }

  /* светящийся шов вдоль предплечья */
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.30), glowMat);
  seam.position.set(0, 0.062, -0.16);
  g.add(seam);

  g.position.set(side * 0.27, -0.28, -0.10);
  g.rotation.set(-0.10, side * 0.16, side * 0.10);
  return { group: g, fingers, side };
}

export function initHands() {
  if (!W.camera || H) return H;
  const mat = W.M.hand || new THREE.MeshStandardMaterial({ color: 0x3a2a5a, roughness: 0.55, metalness: 0.6 });
  const glowMat = W.M.handGlow || new THREE.MeshBasicMaterial({ color: 0x9b6bff });

  const group = new THREE.Group();
  group.renderOrder = 10;
  group.visible = false;

  const left = makeArm(-1, mat, glowMat);
  const right = makeArm(1, mat, glowMat);
  group.add(left.group, right.group);

  W.camera.add(group);

  H = { group, left, right, yawLag: 0, pitchLag: 0, open: 0, push: 0, bob: 0 };
  return H;
}

export function getHands() { return H; }

export function updateHands(dt) {
  if (!H) return;
  const play = S.mode === 'play';
  H.group.visible = play;
  if (!play) return;

  const P = S.player;
  const t = S.time;
  const k = dt > 0 ? 1 - Math.exp(-10 * dt) : 0;

  /* отставание при повороте — «вес» рук */
  H.yawLag = lerp(H.yawLag, S.yaw, dt > 0 ? 1 - Math.exp(-13 * dt) : 0);
  H.pitchLag = lerp(H.pitchLag, S.pitch, dt > 0 ? 1 - Math.exp(-13 * dt) : 0);
  const dYaw = clamp((S.yaw - H.yawLag) * 2.2, -0.22, 0.22);
  const dPitch = clamp((S.pitch - H.pitchLag) * 2.2, -0.22, 0.22);

  const speed = Math.hypot(P.vel.x, P.vel.z);
  const walk = Math.min(1, speed / 6.5);
  const bobY = Math.abs(Math.cos(t * 9.5)) * 0.022 * walk;
  const bobX = Math.sin(t * 4.75) * 0.016 * walk;
  const idleY = Math.sin(t * 1.6) * 0.006;

  const sculpting = S.flags.sculpting ? 1 : 0;
  const rewinding = S.flags.rewinding ? 1 : 0;
  const launched = S.flags.launched > 0 ? Math.min(1, S.flags.launched / 0.32) : 0;

  H.open = lerp(H.open, sculpting * 0.85 + rewinding * 0.5 + launched * 0.6, k);
  H.push = lerp(H.push, sculpting * 0.16 - rewinding * 0.10 - launched * 0.12, k);

  for (const arm of [H.left, H.right]) {
    const s = arm.side;
    arm.group.position.set(
      s * (0.27 - H.open * 0.025) + bobX * s * 0.6,
      -0.28 + bobY + idleY - H.open * 0.02,
      -0.10 - H.push
    );
    arm.group.rotation.set(
      -0.10 + dPitch * 0.55 + H.open * 0.20 - launched * 0.35,
      s * 0.16 + dYaw * 0.35,
      s * (0.10 + H.open * 0.06) + dYaw * 0.10
    );

    for (let i = 0; i < arm.fingers.length; i++) {
      const f = arm.fingers[i];
      f.position.x = f.userData.baseX * (1 + H.open * 1.7);
      f.rotation.x = -0.16 - H.open * 0.55;
    }
  }

  /* свечение швов живёт вместе с разломом */
  const rift = clamp(S.rift / 100, 0, 1);
  if (W.M.hand) W.M.hand.emissiveIntensity = 0.45 + rewinding * 1.5 + rift * 0.8;
  if (W.M.handGlow) {
    const pulse = 0.75 + 0.25 * Math.sin(t * (2.4 + rift * 6));
    W.M.handGlow.color.setRGB(
      (0.42 + rewinding * 0.30 + rift * 0.20) * pulse,
      (0.22 + rewinding * 0.16 + rift * 0.08) * pulse,
      (0.95 + rewinding * 0.05) * pulse
    );
  }
}
