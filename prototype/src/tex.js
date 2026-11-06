/* Процедурные текстуры: генерируются в canvas на старте, без внешних файлов.
   Всё бесшовное (периодический value-noise), поэтому тайлится на платформах.
   Если canvas/2d-контекста нет (headless-прогон), модуль молча отдаёт null —
   материалы остаются плоскими, игра работает как раньше. */
import * as THREE from '../vendor/three.module.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------------- шум ---------------- */
function hash2(ix, iy, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise2(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const p = Math.max(1, period | 0);
  const xa = ((x0 % p) + p) % p;
  const ya = ((y0 % p) + p) % p;
  const xb = (xa + 1) % p;
  const yb = (ya + 1) % p;
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function fbm(u, v, period, octaves, seed) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(u * p, v * p, p, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/* «хребты» — из них получаются прожилки и швы */
function ridges(u, v, period, octaves, seed) {
  return 1 - Math.abs(2 * fbm(u, v, period, octaves, seed) - 1);
}

/* ---------------- палитры ---------------- */
function stonePixel(u, v) {
  const n = fbm(u, v, 4, 4, 11);
  const grain = fbm(u, v, 28, 2, 23);
  const detail = fbm(u, v, 12, 3, 47);
  /* прожилки: два масштаба, тонкие */
  const veinA = Math.pow(smoothstep(0.80, 0.99, ridges(u, v, 3, 3, 77)), 3.4);
  const veinB = Math.pow(smoothstep(0.86, 1.0, ridges(u, v, 8, 2, 155)), 4.0);
  const crack = Math.pow(smoothstep(0.62, 0.96, ridges(u, v, 6, 3, 131)), 8);

  let r = 26 + n * 26 + (grain - 0.5) * 22 + detail * 10;
  let g = 20 + n * 22 + (grain - 0.5) * 18 + detail * 7;
  let b = 52 + n * 50 + (grain - 0.5) * 26 + detail * 16;

  r += veinA * 70 + veinB * 40;
  g += veinA * 18 + veinB * 13;
  b += veinA * 118 + veinB * 86;

  r -= crack * 18;
  g -= crack * 14;
  b -= crack * 24;

  return [r, g, b];
}

function copperPixel(u, v) {
  const n = fbm(u, v, 5, 3, 41);
  const warp = fbm(u, v, 6, 2, 9);
  const ridge = 0.5 + 0.45 * Math.sin(v * Math.PI * 2 * 11 + warp * 7)
              + 0.22 * Math.sin(v * Math.PI * 2 * 23 + warp * 3 + 1.7);
  const patina = smoothstep(0.52, 0.9, fbm(u, v, 3, 3, 57));

  let r = 92 + n * 74 + ridge * 44;
  let gg = 48 + n * 42 + ridge * 24;
  let b = 27 + n * 24 + ridge * 13;

  r -= patina * 46;
  gg += patina * 16;
  b += patina * 26;

  return [r, gg, b];
}

function bonePixel(u, v) {
  const n = fbm(u, v, 4, 3, 61);
  const fiber = fbm(u, v, 14, 3, 87);
  const pore = Math.pow(smoothstep(0.70, 0.98, ridges(u, v, 10, 2, 19)), 3.5);
  const stain = smoothstep(0.55, 0.85, fbm(u, v, 3, 2, 43));

  let r = 186 + n * 34 + (fiber - 0.5) * 26 - stain * 30;
  let g = 176 + n * 32 + (fiber - 0.5) * 24 - stain * 26;
  let b = 198 + n * 30 + (fiber - 0.5) * 20 - stain * 18;

  r -= pore * 58;
  g -= pore * 54;
  b -= pore * 46;

  return [r, g, b];
}

function handPixel(u, v) {
  const n = fbm(u, v, 5, 3, 71);
  const plate = fbm(u, v, 3, 2, 33);
  /* швы режут металл на пластины */
  const seamA = Math.pow(smoothstep(0.86, 0.995, ridges(u, v, 4, 3, 91)), 3.2);
  const seamB = Math.pow(smoothstep(0.90, 1.0, ridges(u, v, 7, 2, 173)), 3.0);
  const edge = smoothstep(0.47, 0.53, plate);

  let r = 30 + n * 22 + edge * 14;
  let g = 22 + n * 16 + edge * 10;
  let b = 54 + n * 34 + edge * 20;

  r += seamA * 150 + seamB * 90;
  g += seamA * 60 + seamB * 34;
  b += seamA * 210 + seamB * 150;

  return [r, g, b];
}

/* ---------------- рендер в canvas ---------------- */
function paint(size, fn) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas || !canvas.getContext) return null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx || !ctx.createImageData || !ctx.putImageData) return null;

  let img;
  try {
    img = ctx.createImageData(size, size);
  } catch (e) {
    return null;
  }
  if (!img || !img.data) return null;

  const d = img.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = fn((x + 0.5) * inv, (y + 0.5) * inv);
      const i = (y * size + x) * 4;
      d[i] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
      d[i + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
      d[i + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, srgb) {
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if ('anisotropy' in t) t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export const TEX = { ready: false, headless: false };

/**
 * Генерирует текстуры (идемпотентно).
 * Возвращает объект с THREE.Texture или пустой объект, если canvas недоступен.
 */
export function buildTextures() {
  if (TEX.ready) return TEX;
  TEX.ready = true;
  try {
    const stoneCv = paint(256, stonePixel);
    const copperCv = paint(256, copperPixel);
    const boneCv = paint(128, bonePixel);
    const handCv = paint(256, handPixel);

    TEX.stone = toTexture(stoneCv, true);
    TEX.stoneBump = toTexture(stoneCv, false);
    TEX.copper = toTexture(copperCv, true);
    TEX.copperBump = toTexture(copperCv, false);
    TEX.bone = toTexture(boneCv, true);
    TEX.hand = toTexture(handCv, true);
    TEX.handGlow = toTexture(handCv, true);

    TEX.headless = !TEX.stone;
    if (TEX.headless) {
      /* без canvas — просто плоские материалы, как раньше */
      TEX.ready = false;
    }
  } catch (e) {
    console.warn('[AP] текстуры недоступны:', e && e.message);
    TEX.headless = true;
    TEX.ready = false;
  }
  return TEX;
}

/**
 * Навешивает процедурные карты на базовые материалы мира.
 * Цвет материала обнуляется в белый: палитру теперь задаёт текстура.
 */
export function applyTextures(M) {
  const T = buildTextures();
  if (!T.stone) return false;

  const setMap = (mat, map, bump, bumpScale, tint) => {
    if (!mat) return;
    mat.map = map;
    if (bump) {
      mat.bumpMap = bump;
      mat.bumpScale = bumpScale;
    }
    mat.color.setHex(tint || 0xffffff);
    mat.needsUpdate = true;
  };

  setMap(M.stone, T.stone, T.stoneBump, 0.09, 0xffffff);
  setMap(M.stone2, T.stone, T.stoneBump, 0.07, 0xc8b8ff);
  setMap(M.copper, T.copper, T.copperBump, 0.06, 0xffffff);
  setMap(M.bone, T.bone, null, 0, 0xffffff);

  /* материал рук: тёмный металл со светящимися швами */
  if (M.hand) {
    M.hand.map = T.hand;
    M.hand.emissiveMap = T.handGlow;
    M.hand.color.setHex(0xffffff);
    M.hand.needsUpdate = true;
  }
  return true;
}
