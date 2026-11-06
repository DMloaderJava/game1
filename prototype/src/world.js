/* Сцена, свет, атмосфера, материалы. */
import * as THREE from '../vendor/three.module.js';
import { S, CFG, clamp, lerp } from './state.js';

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

  /* живая биомеханика: вершинное «дыхание» поверх обычного PBR —
     коллайдеры строятся по bounding box меша на CPU, поэтому физика не меняется */
  initLiving();

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

  initDome();
  initPost();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizePost();
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

  /* медные прожилки пульсируют в такт времени и разлому */
  const pulse = 0.5 + 0.5 * Math.sin(S.time * 2.2);
  W.M.copper.emissiveIntensity = 0.4 + pulse * (0.35 + t * 1.2);
  W.M.copper.emissive.setRGB(0.16 + pulse * 0.10, 0.05 + pulse * 0.02, 0.02);

  updateLiving(dt);
  updateDome(dt);

  W.dust.rotation.y += dt * 0.008;
  W.dust.position.y = Math.sin(S.time * 0.2) * 1.5;

  if (W.camera) {
    W.camera.rotation.z = S.rift > 60 && S.mode === 'play'
      ? Math.sin(S.time * 1.7) * 0.004 * (S.rift - 60) / 40
      : 0;

    /* FOV «плывёт»: перемотка расширяет, высокий разлом качает */
    const rew = S.flags.rewinding ? 1 : 0;
    const sc = S.flags.sculpting ? 1 : 0;
    const target = 74 + rew * 5.5 + sc * 1.1 + t * 2.0 + Math.sin(S.time * (1.1 + t * 2.6)) * t * 1.7;
    const nf = lerp(W.camera.fov, target, 1 - Math.exp(-3.5 * dt));
    if (Math.abs(nf - W.camera.fov) > 0.002) {
      W.camera.fov = nf;
      W.camera.updateProjectionMatrix();
    }
  }

  /* глитч и аберрация живут на Индексе Разлома */
  if (W.post && W.post.mat) {
    const u = W.post.mat.uniforms;
    u.uTime.value = S.time;
    u.uRift.value = t;
    u.uRewind.value = S.flags.rewinding ? 1 : 0;
    u.uGlitch.value = clamp((t - 0.35) / 0.65, 0, 1);
  }
}

/* ================================================================== */
/*  ЖИВАЯ БИОМЕХАНИКА: вершинное дыхание материалов                    */
/* ================================================================== */
export const LIVING_CFG = [
  /* key, материал, амплитуда (м), частота, скорость */
  { key: 'stone', amp: 0.075, freq: 0.34, speed: 0.85 },
  { key: 'stone2', amp: 0.055, freq: 0.52, speed: 1.15 },
  { key: 'copper', amp: 0.035, freq: 1.05, speed: 2.30 },
  { key: 'bone', amp: 0.028, freq: 1.45, speed: 1.60 }
];

/* насколько сильно дышит каждая зона */
export const ZONE_BREATH = [1.0, 1.45, 0.7, 1.2, 1.7];

export function setZoneBreath(i) {
  W.zoneBreath = ZONE_BREATH[clamp(i | 0, 0, ZONE_BREATH.length - 1)];
}

export function initLiving() {
  W.zoneBreath = 1;
  W.living = [];
  for (const cfg of LIVING_CFG) {
    const mat = W.M[cfg.key];
    if (!mat) continue;
    makeLiving(mat, cfg);
  }
}

/**
 * Подмешивает в MeshStandardMaterial смещение по нормали.
 * Ничего не аллоцирует в кадре: только обновление uniform-ов.
 */
export function makeLiving(mat, cfg) {
  const uni = {
    uTime: { value: 0 },
    uRift: { value: 0 },
    uAmp: { value: cfg.amp },
    uFreq: { value: cfg.freq },
    uSpeed: { value: cfg.speed },
    uBreath: { value: 1 }
  };
  const entry = { mat, uni, base: cfg.amp };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uni.uTime;
    shader.uniforms.uRift = uni.uRift;
    shader.uniforms.uAmp = uni.uAmp;
    shader.uniforms.uFreq = uni.uFreq;
    shader.uniforms.uSpeed = uni.uSpeed;
    shader.uniforms.uBreath = uni.uBreath;

    shader.vertexShader = 'uniform float uTime;\nuniform float uRift;\nuniform float uAmp;\n' +
      'uniform float uFreq;\nuniform float uSpeed;\nuniform float uBreath;\n' + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        'vec3 transformed = vec3( position );',
        'float _w1 = sin( uTime * uSpeed + position.y * uFreq + position.x * uFreq * 0.7 );',
        'float _w2 = sin( uTime * uSpeed * 0.53 + position.z * uFreq * 1.3 - position.y * uFreq * 0.2 );',
        'float _breath = ( _w1 * 0.65 + _w2 * 0.45 ) * uAmp * uBreath;',
        'float _swell = ( 0.35 + uRift * 0.95 );',
        'transformed += objectNormal * _breath * _swell;'
      ].join('\n')
    );
  };
  /* свой ключ кеша: программы не смешиваются с обычными PBR-материалами */
  mat.customProgramCacheKey = () => 'living:' + cfg.key;
  W.living.push(entry);
  return entry;
}

const livingTmp = { rift: 0, breath: 1 };

export function updateLiving(dt) {
  if (!W.living) return;
  livingTmp.rift = clamp(S.rift / 100, 0, 1);
  /* скульптура и перемотка «вздувают» мир рядом с игроком */
  livingTmp.breath = (1 + (S.flags.sculpting ? 0.9 : 0) + (S.flags.rewinding ? 0.5 : 0)) * (W.zoneBreath || 1);
  for (let i = 0; i < W.living.length; i++) {
    const u = W.living[i].uni;
    u.uTime.value = S.time;
    u.uRift.value = livingTmp.rift;
    u.uBreath.value = lerp(u.uBreath.value, livingTmp.breath, 1 - Math.exp(-4 * dt));
  }
}

/* ================================================================== */
/*  КУПОЛ РАЗЛОМА: гексагональная сетка + Fresnel                     */
/* ================================================================== */
const DOME_VERT = [
  'varying vec3 vNormalW;',
  'varying vec3 vViewDir;',
  'varying vec3 vWorld;',
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
  '  vWorld = wp.xyz;',
  '  vNormalW = normalize( mat3( modelMatrix ) * normal );',
  '  vViewDir = normalize( cameraPosition - wp.xyz );',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}'
].join('\n');

const DOME_FRAG = [
  'uniform float uTime;',
  'uniform float uIntensity;',
  'uniform float uRewind;',
  'uniform float uSculpt;',
  'uniform float uRadius;',
  'uniform vec3 uColor;',
  'varying vec3 vNormalW;',
  'varying vec3 vViewDir;',
  'varying vec3 vWorld;',
  'varying vec2 vUv;',
  '',
  'float hexDist( vec2 p ) {',
  '  p = abs( p );',
  '  return max( dot( p, vec2( 0.5, 0.8660254 ) ), p.x );',
  '}',
  '',
  'void main() {',
  '  /* гексагональная сетка по UV сферы */',
  '  vec2 huv = vec2( vUv.x * 44.0, vUv.y * 22.0 );',
  '  vec2 r = vec2( 1.0, 1.7320508 );',
  '  vec2 h = r * 0.5;',
  '  vec2 a = mod( huv, r ) - h;',
  '  vec2 b = mod( huv - h, r ) - h;',
  '  vec2 gv = dot( a, a ) < dot( b, b ) ? a : b;',
  '  float hd = hexDist( gv );',
  '  float hexLine = smoothstep( 0.40, 0.50, hd );',
  '',
  '  /* топографические кольца, медленно ползущие вверх */',
  '  float topoRaw = sin( ( vWorld.y - uTime * 0.55 ) * 1.35 ) * 0.5 + 0.5;',
  '  float topo = smoothstep( 0.90, 1.0, topoRaw );',
  '',
  '  /* свечение по краям сферы */',
  '  float fres = pow( 1.0 - abs( dot( normalize( vNormalW ), normalize( vViewDir ) ) ), 3.0 );',
  '',
  '  float lines = hexLine * 0.62 + topo * 0.30;',
  '  float body = lines * ( 0.16 + 0.55 * uIntensity );',
  '  float edge = fres * ( 0.18 + 0.85 * uIntensity + 0.35 * uRewind );',
  '  float alpha = clamp( body + edge * 0.55, 0.0, 0.92 );',
  '',
  '  vec3 col = uColor * ( 0.75 + 1.7 * fres + 0.7 * uRewind );',
  '  col += vec3( 0.55, 0.32, 1.0 ) * uSculpt * 0.55 * ( 0.3 + fres );',
  '  col += uColor * topo * 0.35 * uIntensity;',
  '',
  '  gl_FragColor = vec4( col * alpha, alpha * 0.55 );',
  '}'
].join('\n');

export function initDome() {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.2 },
      uRewind: { value: 0 },
      uSculpt: { value: 0 },
      uRadius: { value: CFG.RADIUS },
      uColor: { value: new THREE.Color(0x7b2dff) }
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  W.scene.add(mesh);
  W.dome = { mesh, material: mat, k: 0.2, target: 0.2 };
}

export function updateDome(dt) {
  const D = W.dome;
  if (!D) return;
  const t = clamp(S.rift / 100, 0, 1);
  const rew = S.flags.rewinding ? 1 : 0;
  const sc = S.flags.sculpting ? 1 : 0;

  D.target = clamp(0.16 + t * 0.75 + rew * 0.6 + sc * 0.35, 0, 2.2);
  D.k = lerp(D.k, D.target, 1 - Math.exp(-5 * dt));

  const u = D.material.uniforms;
  u.uTime.value = S.time;
  u.uIntensity.value = D.k;
  u.uRewind.value = rew;
  u.uSculpt.value = sc;

  const p = S.player.pos;
  D.mesh.position.set(p.x, p.y + 0.9, p.z);
  const s = CFG.RADIUS * (1 + Math.sin(S.time * 1.3) * 0.007 + rew * 0.015);
  D.mesh.scale.setScalar(s);
  D.mesh.visible = S.mode === 'play' || S.mode === 'pause';
}

/* ================================================================== */
/*  ПОСТ-ОБРАБОТКА: хроматическая аберрация + глитч                    */
/* ================================================================== */
const POST_VERT = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4( position.xy, 0.0, 1.0 );',
  '}'
].join('\n');

const POST_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform vec2 uRes;',
  'uniform float uTime;',
  'uniform float uRift;',
  'uniform float uRewind;',
  'uniform float uGlitch;',
  'varying vec2 vUv;',
  '',
  'float hash( vec2 p ) {',
  '  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );',
  '}',
  '',
  'void main() {',
  '  vec2 uv = vUv;',
  '  vec2 d = uv - 0.5;',
  '',
  '  /* горизонтальные полосы-глитчи тем чаще, чем выше разлом */',
  '  float tq = floor( uTime * 16.0 );',
  '  float bandNoise = hash( vec2( floor( uv.y * 70.0 ), tq ) );',
  '  float band = step( 0.985 - 0.03 * uRift, bandNoise ) * uGlitch;',
  '  uv.x += band * ( hash( vec2( tq, floor( uv.y * 70.0 ) ) ) - 0.5 ) * 0.045;',
  '',
  '  /* хроматическая аберрация: растёт к краям кадра */',
  '  float aber = ( 0.0010 + 0.0075 * uRift + 0.0035 * uRewind ) * ( 0.30 + dot( d, d ) * 2.6 );',
  '  float cr = texture2D( tDiffuse, uv + d * aber ).r;',
  '  float cg = texture2D( tDiffuse, uv ).g;',
  '  float cb = texture2D( tDiffuse, uv - d * aber ).b;',
  '  vec3 col = vec3( cr, cg, cb );',
  '',
  '  /* скан-линии, зерно и виньетка */',
  '  col *= 0.965 + 0.035 * sin( uv.y * 780.0 + uTime * 5.0 );',
  '  col += ( hash( uv * uRes ) - 0.5 ) * ( 0.010 + 0.022 * uRift );',
  '  float vig = 1.0 - smoothstep( 0.28, 1.05, length( d ) );',
  '  col *= mix( 0.80, 1.0, vig );',
  '',
  '  /* фиолетовые всполохи в полосах */',
  '  col += vec3( 0.30, 0.10, 0.62 ) * band * 0.28;',
  '',
  '  /* сцена рисовалась в линейном пространстве — возвращаем sRGB,',
  '     иначе картинка темнеет после включения промежуточного буфера */',
  '  col = mix( col * 12.92, 1.055 * pow( max( col, vec3( 0.0 ) ), vec3( 0.4166667 ) ) - 0.055, step( vec3( 0.0031308 ), col ) );',
  '  gl_FragColor = vec4( col, 1.0 );',
  '}'
].join('\n');

export function initPost() {
  const renderer = W.renderer;
  if (!renderer || typeof renderer.setRenderTarget !== 'function' || !THREE.WebGLRenderTarget) {
    W.post = { enabled: false, mat: null };
    return;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.floor((window.innerWidth || 1280) * pr));
  const h = Math.max(2, Math.floor((window.innerHeight || 720) * pr));

  const samples = renderer.capabilities && renderer.capabilities.isWebGL2 ? 4 : 0;
  const target = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    samples
  });

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      uRes: { value: new THREE.Vector2(w, h) },
      uTime: { value: 0 },
      uRift: { value: 0 },
      uRewind: { value: 0 },
      uGlitch: { value: 0 }
    },
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    depthTest: false,
    depthWrite: false
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  W.post = { enabled: true, target, mat, quad, scene, camera: cam, pr };
}

export function resizePost() {
  const P = W.post;
  if (!P || !P.enabled) return;
  const pr = P.pr || 1;
  const w = Math.max(2, Math.floor(window.innerWidth * pr));
  const h = Math.max(2, Math.floor(window.innerHeight * pr));
  P.target.setSize(w, h);
  P.mat.uniforms.uRes.value.set(w, h);
}

/**
 * Страховка на случай, если драйвер не собрал кастомный шейдер:
 * откатываем живые материалы к обычному PBR, выключаем пост-проход и купол.
 * Вызывается один раз через несколько кадров после старта.
 */
export function checkShaderHealth() {
  const r = W.renderer;
  if (!r || !r.info || !Array.isArray(r.info.programs)) return true;
  let broken = 0;
  for (let i = 0; i < r.info.programs.length; i++) {
    const p = r.info.programs[i];
    if (p && p.diagnostics && p.diagnostics.runnable === false) broken++;
  }
  if (!broken) return true;

  console.warn('[AP] шейдер не собрался (' + broken + ' программ) — откат к базовой отрисовке');
  if (W.living) {
    for (let i = 0; i < W.living.length; i++) {
      const m = W.living[i].mat;
      m.onBeforeCompile = function () {};
      m.customProgramCacheKey = function () { return ''; };
      m.needsUpdate = true;
    }
  }
  if (W.post) W.post.enabled = false;
  if (W.dome) W.dome.mesh.visible = false;
  return false;
}

/** Единая точка отрисовки: сцена в буфер → полноэкранный проход с искажениями. */
export function renderFrame() {
  const P = W.post;
  if (!P || !P.enabled) {
    W.renderer.render(W.scene, W.camera);
    return;
  }
  W.renderer.setRenderTarget(P.target);
  W.renderer.render(W.scene, W.camera);
  W.renderer.setRenderTarget(null);
  W.renderer.render(P.scene, P.camera);
}
