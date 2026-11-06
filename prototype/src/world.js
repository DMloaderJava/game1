/* Сцена, свет, атмосфера, материалы. */
import * as THREE from '../vendor/three.module.js';
import { S, clamp, lerp } from './state.js';

export const W = { M: {}, lights: {} };

/* палитры биомов: [туман, дальний туман, небо hemi, земля hemi, солнце, акцент] */
export const MOODS = [
  { fog: 0x0a0620, fog2: 0x2b0736, sky: 0x6a3fd0, ground: 0x0b0620, sun: 0xbfa6ff, accent: 0x9b3cff },
  { fog: 0x0b1018, fog2: 0x123a3a, sky: 0x3f8fa0, ground: 0x0a1418, sun: 0xa8e0ff, accent: 0x2fd0c0 },
  { fog: 0x140a20, fog2: 0x3a1a2e, sky: 0xa06a3f, ground: 0x140a10, sun: 0xffc48a, accent: 0xc1743f },
  { fog: 0x0a0418, fog2: 0x3a0a3a, sky: 0xb04fd0, ground: 0x100418, sun: 0xff8ae0, accent: 0xff2fd0 }
];

export function initWorld() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  W.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0620);
  scene.fog = new THREE.FogExp2(0x0a0620, 0.017);
  W.scene = scene;

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 800);
  scene.add(camera);
  W.camera = camera;

  W.lights.amb = new THREE.AmbientLight(0x2b1b55, 1.15);
  scene.add(W.lights.amb);
  W.lights.hemi = new THREE.HemisphereLight(0x6a3fd0, 0x0b0620, 0.95);
  scene.add(W.lights.hemi);
  W.lights.sun = new THREE.DirectionalLight(0xbfa6ff, 1.0);
  W.lights.sun.position.set(-40, 80, 30);
  scene.add(W.lights.sun);
  W.lights.core = new THREE.PointLight(0xb46bff, 0, 120, 2);
  scene.add(W.lights.core);

  /* материалы */
  const M = W.M;
  M.stone = new THREE.MeshStandardMaterial({ color: 0x211a44, roughness: 0.93, metalness: 0.15 });
  M.stone2 = new THREE.MeshStandardMaterial({ color: 0x2b2154, roughness: 0.85, metalness: 0.25 });
  M.copper = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.42, metalness: 0.95, emissive: 0x2a0d05, emissiveIntensity: 0.5 });
  M.bone = new THREE.MeshStandardMaterial({ color: 0xcfc3d8, roughness: 0.7, metalness: 0.1 });
  M.violet = new THREE.MeshStandardMaterial({ color: 0x2a0a4a, emissive: 0x9b3cff, emissiveIntensity: 1.5, roughness: 0.4 });
  M.glow = new THREE.MeshBasicMaterial({ color: 0xc9a0ff });
  M.sculpt = new THREE.MeshStandardMaterial({ color: 0x6a5a9a, emissive: 0x3a1d6b, emissiveIntensity: 0.8, roughness: 0.55, metalness: 0.35 });
  M.crystal = new THREE.MeshStandardMaterial({ color: 0x7a2fbf, emissive: 0xff33cc, emissiveIntensity: 2.0, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.92 });
  M.echo = new THREE.MeshStandardMaterial({ color: 0x8b6bff, emissive: 0x7a3cff, emissiveIntensity: 1.4, transparent: true, opacity: 0.32, roughness: 0.3, depthWrite: false });
  M.enemy = new THREE.MeshStandardMaterial({ color: 0x3a2740, roughness: 0.6, metalness: 0.5, emissive: 0x220a22, emissiveIntensity: 0.9 });
  M.enemyGlow = new THREE.MeshStandardMaterial({ color: 0x501020, emissive: 0xff2b5c, emissiveIntensity: 1.8, roughness: 0.4 });
  M.mem = new THREE.MeshStandardMaterial({ color: 0x9b8bd0, emissive: 0x6a2fa0, emissiveIntensity: 1.1, transparent: true, opacity: 0.55, roughness: 0.2 });
  M.rev = new THREE.MeshStandardMaterial({ color: 0x8fa0c0, emissive: 0x2a5bd0, emissiveIntensity: 1.2, transparent: true, opacity: 0.7, roughness: 0.3 });
  M.ghost = new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.16, wireframe: true, depthWrite: false });
  M.node = new THREE.MeshStandardMaterial({ color: 0x2a0a4a, emissive: 0x00ffcc, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.6 });
  M.nodeDead = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, emissive: 0x226655, emissiveIntensity: 0.35, roughness: 0.8 });
  M.portal = new THREE.MeshStandardMaterial({ color: 0x1a0a3a, emissive: 0xaa44ff, emissiveIntensity: 2.2, roughness: 0.2, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  M.boss = new THREE.MeshStandardMaterial({ color: 0x3a1a2a, roughness: 0.5, metalness: 0.7, emissive: 0x6a0a2a, emissiveIntensity: 0.9 });
  M.bossGlow = new THREE.MeshStandardMaterial({ color: 0x6a0a3a, emissive: 0xff2b6a, emissiveIntensity: 2.2, roughness: 0.3 });

  /* пыль */
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 160;
    pos[i * 3 + 1] = -12 + Math.random() * 60;
    pos[i * 3 + 2] = -110 + Math.random() * 190;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  W.dust = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xb492ff, size: 0.17, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  scene.add(W.dust);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

let moodA = new THREE.Color(0x0a0620), moodB = new THREE.Color(0x2b0736);
let moodAccent = new THREE.Color(0x9b3cff);

export function setMood(index) {
  const m = MOODS[Math.min(MOODS.length - 1, index)];
  moodA.setHex(m.fog);
  moodB.setHex(m.fog2);
  moodAccent.setHex(m.accent);
  W.lights.hemi.color.setHex(m.sky);
  W.lights.hemi.groundColor.setHex(m.ground);
  W.lights.sun.color.setHex(m.sun);
  W.lights.amb.color.setHex(m.accent);
  W.dust.material.color.setHex(m.accent);
  if (W.coreLight) W.coreLight.color.setHex(m.accent);
}

const tmpC = new THREE.Color();

export function updateAtmosphere(dt) {
  const t = clamp(S.rift / 100, 0, 1);
  const beath = Math.sin(S.time * 0.8) * 0.5 + 0.5;

  tmpC.copy(moodA).lerp(moodB, t);
  W.scene.fog.color.copy(tmpC);
  W.scene.background.copy(tmpC);
  W.scene.fog.density = 0.013 + t * 0.012;

  W.M.violet.emissiveIntensity = 1.1 + beath * 0.8 + t * 0.9;
  W.M.crystal.emissiveIntensity = 1.5 + Math.sin(S.time * 9) * 0.5;
  W.lights.hemi.intensity = 0.85 + Math.sin(S.time * 0.4) * 0.08;
  W.lights.sun.intensity = 0.9 + t * 0.3;

  W.dust.rotation.y += dt * 0.008;
  W.dust.position.y = Math.sin(S.time * 0.2) * 1.5;

  if (W.camera) {
    W.camera.rotation.z = S.rift > 60 && S.mode === 'play'
      ? Math.sin(S.time * 1.7) * 0.004 * (S.rift - 60) / 40
      : 0;
  }
}
