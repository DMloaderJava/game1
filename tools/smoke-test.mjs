#!/usr/bin/env node
/**
 * tools/smoke-test.mjs — headless-прогон игровой логики «Архитектора Парадоксов».
 *
 * Что делает:
 *   1. поднимает моки окружения (DOM из настоящего prototype/index.html, Canvas, WebGL
 *      через подмену THREE.WebGLRenderer, AudioContext);
 *   2. копирует prototype/src во временный каталог, подменяя только путь к three.js —
 *      исходники игры не трогаются;
 *   3. проигрывает полный сценарий: старт → управление → все пять зон → босс → оба финала;
 *   4. добивает прогон до 9000 кадров рандомизированным вводом (перемотка, лепка,
 *      уплотнение, эхо, прыжки, рывки, Tab, случайные зоны и апгрейды);
 *   5. печатает отчёт и выходит с кодом 1, если была хоть одна ошибка.
 *
 * Запуск:  npm test        (или node tools/smoke-test.mjs)
 * Опции:   --frames=9000   --seed=12345   --verbose
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'prototype', 'src');
const HTML_FILE = join(ROOT, 'prototype', 'index.html');
const VENDOR = join(ROOT, 'prototype', 'vendor', 'three.module.js');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const TOTAL_FRAMES = arg('frames', 9000);
const SEED = arg('seed', 0x5eed1a7e);
const VERBOSE = argv.includes('--verbose');
const FRAME_MS = 1000 / 60;

/* ================================================================== */
/*  ДЕТЕРМИНИРОВАННЫЙ ГПСЧ                                            */
/* ================================================================== */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const rint = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[rint(arr.length)];

/* ================================================================== */
/*  МОКИ ОКРУЖЕНИЯ                                                    */
/* ================================================================== */
let clock = 0;

function makeClassList(el) {
  const set = new Set();
  return {
    _set: set,
    add(...c) { c.forEach((x) => set.add(x)); },
    remove(...c) { c.forEach((x) => set.delete(x)); },
    contains(c) { return set.has(c); },
    toggle(c, force) {
      if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
      else if (force) set.add(c);
      else set.delete(c);
      return set.has(c);
    }
  };
}

function makeElement(tag = 'div', attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    id: attrs.id || '',
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    children: [],
    parentNode: null,
    value: attrs.value || '',
    textContent: '',
    checked: false,
    disabled: false,
    _html: '',
    _attrs: { ...attrs },
    _h: {},
    offsetWidth: 1280,
    offsetHeight: 720,

    get className() { return [...el.classList._set].join(' '); },
    set className(v) {
      el.classList._set.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList._set.add(c));
    },

    addEventListener(type, fn) { (el._h[type] = el._h[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = el._h[type];
      if (a) el._h[type] = a.filter((f) => f !== fn);
    },
    dispatch(type, ev) { (el._h[type] || []).forEach((f) => f({ target: el, ...ev })); },
    appendChild(ch) { ch.parentNode = el; el.children.push(ch); return ch; },
    insertBefore(ch, ref) {
      const i = ref ? el.children.indexOf(ref) : -1;
      ch.parentNode = el;
      if (i < 0) el.children.push(ch); else el.children.splice(i, 0, ch);
      return ch;
    },
    removeChild(ch) {
      const i = el.children.indexOf(ch);
      if (i >= 0) el.children.splice(i, 1);
      ch.parentNode = null;
      return ch;
    },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    setAttribute(k, v) { el._attrs[k] = String(v); if (k === 'class') el.className = v; if (k === 'id') el.id = v; },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    removeAttribute(k) { delete el._attrs[k]; },
    hasAttribute(k) { return k in el._attrs; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }; },
    focus() {},
    blur() {},
    getContext() { return null; },
    requestPointerLock() { globalThis.document.pointerLockElement = el; return undefined; },
    releasePointerLock() { globalThis.document.pointerLockElement = null; }
  };
  el.classList = makeClassList(el);
  if (attrs.class) el.className = attrs.class;
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); if (v === '') { el.children.forEach((c) => (c.parentNode = null)); el.children = []; } }
  });
  return el;
}

/**
 * Разбирает prototype/index.html и строит по нему плоское дерево элементов:
 * так тест ловит расхождение между разметкой и кодом (несуществующий id → null).
 */
function buildDom(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const ids = new Map();
  const byClass = new Map();
  const all = [];
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);

  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag)) continue;
    const raw = m[2] || '';
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    const attrs = {};
    let a;
    while ((a = attrRe.exec(raw))) {
      if (!a[1] || a[1] === '/') continue;
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    const el = makeElement(tag, attrs);
    all.push(el);
    if (attrs.id && !ids.has(attrs.id)) ids.set(attrs.id, el);
    for (const c of String(attrs.class || '').split(/\s+/).filter(Boolean)) {
      if (!byClass.has(c)) byClass.set(c, []);
      byClass.get(c).push(el);
    }
  }

  const body = all.find((e) => e.tagName === 'BODY') || makeElement('body');
  const root = all.find((e) => e.tagName === 'HTML') || makeElement('html');
  return { ids, byClass, all, body, root };
}

function installEnvironment() {
  const dom = buildDom(HTML_FILE);
  const docListeners = {};

  const document = {
    body: dom.body,
    documentElement: dom.root,
    pointerLockElement: null,
    hidden: false,
    getElementById(id) { return dom.ids.get(id) || null; },
    querySelectorAll(sel) {
      const s = String(sel).trim();
      if (s.startsWith('.')) return [...(dom.byClass.get(s.slice(1)) || [])];
      if (s.startsWith('#')) { const e = dom.ids.get(s.slice(1)); return e ? [e] : []; }
      return [...dom.all].filter((e) => e.tagName === s.toUpperCase());
    },
    querySelector(sel) { return document.querySelectorAll(sel)[0] || null; },
    createElement(tag) { return makeElement(tag); },
    createTextNode(txt) { const e = makeElement('#text'); e.textContent = txt; return e; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = docListeners[type];
      if (a) docListeners[type] = a.filter((f) => f !== fn);
    },
    exitPointerLock() { document.pointerLockElement = null; },
    dispatch(type, ev) { (docListeners[type] || []).forEach((f) => f({ preventDefault() {}, ...ev })); }
  };

  /* --- Web Audio: процедурный саундтрек должен реально инициализироваться --- */
  class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
    setTargetAtTime() { return this; }
    cancelScheduledValues() { return this; }
    cancelAndHoldAtTime() { return this; }
  }
  class Node {
    constructor(ctx) { this.context = ctx; this.numberOfInputs = 1; this.numberOfOutputs = 1; }
    connect(dst) { return dst; }
    disconnect() {}
  }
  class GainNode extends Node { constructor(ctx) { super(ctx); this.gain = new Param(1); } }
  class OscillatorNode extends Node {
    constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0); this.started = false; }
    start() { this.started = true; }
    stop() {}
  }
  class BiquadFilterNode extends Node {
    constructor(ctx) { super(ctx); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); this.gain = new Param(0); }
  }
  class FakeAudioContext {
    static instances = 0;
    static nodes = 0;
    constructor() {
      FakeAudioContext.instances++;
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = new Node(this);
      this.created = { gain: 0, osc: 0, filter: 0 };
    }
    createGain() { this.created.gain++; FakeAudioContext.nodes++; return new GainNode(this); }
    createOscillator() { this.created.osc++; FakeAudioContext.nodes++; return new OscillatorNode(this); }
    createBiquadFilter() { this.created.filter++; FakeAudioContext.nodes++; return new BiquadFilterNode(this); }
    createBuffer() { return { getChannelData: () => new Float32Array(128) }; }
    createBufferSource() { const n = new Node(this); n.buffer = null; n.start = () => {}; n.stop = () => {}; return n; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { reload() {}, href: 'http://localhost/prototype/index.html' },
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: null,
    __AP: null
  };

  /* часть этих имён в Node объявлена геттерами — переопределяем через defineProperty */
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

  define('window', win);
  define('document', document);
  define('navigator', { userAgent: 'node-smoke-test', maxTouchPoints: 0, language: 'ru' });
  define('location', win.location);
  define('AudioContext', FakeAudioContext);
  define('performance', { now: () => clock, timeOrigin: 0 });
  define('self', win);

  let raf = null;
  let rafSeq = 0;
  globalThis.requestAnimationFrame = (cb) => { raf = cb; return ++rafSeq; };
  globalThis.cancelAnimationFrame = () => { raf = null; };

  return {
    dom,
    document,
    audioClass: FakeAudioContext,
    fireDoc: (type, ev) => document.dispatch(type, ev),
    click: (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`нет элемента #${id}`);
      el.dispatch('click', {});
    },
    key: (code, down) => document.dispatch(down ? 'keydown' : 'keyup', { code, key: code }),
    mouse: (type, button, extra = {}) => document.dispatch(type, { button, movementX: 0, movementY: 0, ...extra }),
    frame() {
      const cb = raf;
      if (!cb) throw new Error('игровой цикл не запросил следующий кадр (requestAnimationFrame)');
      raf = null;
      cb(clock);
    }
  };
}

/* ================================================================== */
/*  ПОДГОТОВКА МОДУЛЕЙ (без правки исходников)                        */
/* ================================================================== */
function prepareModules() {
  if (!readFileSync(VENDOR, { encoding: 'utf8', flag: 'r' }).length) {
    throw new Error('не найден prototype/vendor/three.module.js');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ap-smoke-'));
  const out = join(tmp, 'src');
  mkdirSync(out, { recursive: true });

  const vendorUrl = pathToFileURL(VENDOR).href;
  const stubPath = join(tmp, 'three-headless.mjs');
  writeFileSync(stubPath, `/* Автогенерация smoke-теста: настоящий three.js + пустой рендерер. */
export * from ${JSON.stringify(vendorUrl)};
export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement = (opts && opts.canvas) || null;
    this.outputColorSpace = null;
    this.shadowMap = { enabled: false, type: 0 };
    this.info = { render: {}, memory: {}, programs: [] };
    this.capabilities = { isWebGL2: true, getMaxAnisotropy: () => 1 };
    this.frames = 0;
  }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  setViewport() {}
  setScissorTest() {}
  clear() {}
  setRenderTarget() {}
  getRenderTarget() { return null; }
  getPixelRatio() { return 1; }
  /* настоящий WebGLRenderer перед отрисовкой обновляет мировые матрицы;
     без этого луч из камеры (aimPoint/aimBlocks) считался бы по устаревшей матрице */
  render(scene, camera) {
    this.frames++;
    if (scene && scene.updateMatrixWorld) scene.updateMatrixWorld(true);
    if (camera && camera.updateMatrixWorld) camera.updateMatrixWorld(true);
  }
  dispose() {}
  getContext() { return null; }
  getPixelRatio() { return 1; }
}
`);
  const stubUrl = pathToFileURL(stubPath).href;

  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));
  if (!files.includes('main.js')) throw new Error('в prototype/src нет main.js');
  for (const f of files) {
    let code = readFileSync(join(SRC_DIR, f), 'utf8');
    code = code.split("'../vendor/three.module.js'").join(JSON.stringify(stubUrl));
    code = code.split('"../vendor/three.module.js"').join(JSON.stringify(stubUrl));
    writeFileSync(join(out, f), code);
  }
  TMP_DIR = tmp;
  return { url: pathToFileURL(join(out, 'main.js')).href, files, tmp };
}

/* ================================================================== */
/*  ОТЧЁТ                                                             */
/* ================================================================== */
const state = { frames: 0, errors: [], checks: 0, passed: 0 };
let TMP_DIR = null;

function fail(msg) {
  state.errors.push(msg);
  console.log('  ✗ ' + msg);
}
function ok(msg) {
  state.checks++;
  state.passed++;
  if (VERBOSE || !msg.startsWith('·')) console.log('  ✓ ' + msg);
}
function check(name, fn) {
  state.checks++;
  try {
    const res = fn();
    if (res === false) throw new Error('проверка вернула false');
    state.passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail(name + ' — ' + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  return true;
}

/** Один кадр игры. Любое исключение внутри — ошибка прогона. */
function step(label = '') {
  clock += FRAME_MS;
  state.frames++;
  try {
    env.frame();
  } catch (e) {
    const where = `кадр ${state.frames}${label ? ' (' + label + ')' : ''}`;
    fail(`${where}: ${e && e.message}`);
    if (VERBOSE && e && e.stack) console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    if (state.errors.length > 25) throw new Error('слишком много ошибок — прогон остановлен');
  }
}
function run(n, label) {
  for (let i = 0; i < n; i++) step(label);
}
function runUntil(pred, max, label) {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    step(label);
  }
  return -1;
}
const finite = (...nums) => nums.every((n) => Number.isFinite(n));

/* ================================================================== */
/*  СЦЕНАРИЙ                                                          */
/* ================================================================== */
let env;

async function main() {
  env = installEnvironment();
  const mod = prepareModules();

  console.log('\n═══ SMOKE: Архитектор Парадоксов ═══');
  console.log(`   разметка: ${mod.files.length} модулей, DOM из prototype/index.html`);
  console.log(`   кадров:   ${TOTAL_FRAMES}, seed: ${SEED}\n`);

  /* ---------- 1. ЗАГРУЗКА ---------- */
  console.log('▶ загрузка');
  let AP;
  try {
    await import(mod.url);
    AP = globalThis.window.__AP;
  } catch (e) {
    fail('модуль main.js не загрузился: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e));
    return report();
  }
  check('window.__AP выставлен', () => assert(!!AP, '__AP отсутствует'));
  check('стартовый режим — menu', () => assert(AP.state === 'menu', 'режим ' + AP.state));
  check('сцена собрана (камера, свет, материалы)', () =>
    assert(AP.W.scene && AP.W.camera && AP.W.renderer, 'нет сцены/камеры/рендерера'));

  /* ---------- 2. СТАРТ ---------- */
  console.log('\n▶ старт игры');
  env.click('startBtn');
  run(2, 'boot');
  check('режим play', () => assert(AP.state === 'play', 'режим ' + AP.state));
  check('зона 0, три узла', () => assert(AP.S.zone === 0 && AP.S.nodes.length === 3,
    `зона ${AP.S.zone}, узлов ${AP.S.nodes.length}`));
  check('враги и коллайдеры на месте', () =>
    assert(AP.S.enemies.length > 0 && AP.S.colliders.length > 0,
      `врагов ${AP.S.enemies.length}, коллайдеров ${AP.S.colliders.length}`));
  check('HUD обновлён', () => {
    const hp = env.document.getElementById('hpTxt');
    assert(String(hp.textContent) === '100', 'hp в HUD: ' + hp.textContent);
    assert(env.document.getElementById('hpFill').style.transform.includes('scaleX'),
      'полоса HP не двигалась');
  });

  /* ---------- 3. УПРАВЛЕНИЕ ---------- */
  console.log('\n▶ управление: ходьба, прыжок, рывок, лепка, эхо, перемотка');
  const S = AP.S;
  const z0 = S.player.pos.z;
  env.key('KeyW', true); run(90); env.key('KeyW', false); run(8);
  check('W двигает игрока вперёд', () => assert(Math.abs(S.player.pos.z - z0) > 1.5,
    `z: ${z0.toFixed(2)} → ${S.player.pos.z.toFixed(2)}`));
  check('игрок стоит на опоре, а не падает', () =>
    assert(S.player.pos.y > -2 && finite(S.player.pos.x, S.player.pos.y, S.player.pos.z),
      'y = ' + S.player.pos.y.toFixed(2)));

  S.player.mass = 40;
  env.mouse('mousedown', 0); run(20); env.mouse('mouseup', 0); run(2);
  check('ЛКМ лепит материю', () => assert(AP.S.blocks.length > 0, 'блоков ' + AP.S.blocks.length));

  S.player.mass = 40;
  env.mouse('mousedown', 2); run(2);
  check('ПКМ уплотняет в структуру', () => assert(AP.S.crystals.length > 0, 'кристаллов ' + AP.S.crystals.length));

  const echoesBefore = S.echoes.length;
  env.key('KeyE', true); run(2); env.key('KeyE', false); run(2);
  check('E оставляет эхо', () => assert(S.echoes.length > echoesBefore, 'эхо не появилось'));

  env.key('Space', true); run(4); env.key('Space', false); run(30);
  check('прыжок не ломает физику', () => assert(finite(S.player.pos.y), 'y = ' + S.player.pos.y));

  env.key('ShiftLeft', true); run(6); env.key('ShiftLeft', false); run(20);
  check('рывок откатывается по кулдауну', () => assert(finite(S.player.vel.x, S.player.vel.z), 'NaN в скорости'));

  const chargeBefore = S.player.charge;
  env.key('KeyQ', true); run(120);
  check('Q крутит перемотку (заряд тратится)', () => assert(S.player.charge < chargeBefore,
    `заряд ${chargeBefore.toFixed(0)} → ${S.player.charge.toFixed(0)}`));
  env.key('KeyQ', false); run(10);

  env.key('Tab', true); run(20); env.key('Tab', false); run(5);
  check('слой памяти (Tab) включается и выключается', () => assert(AP.state === 'play', 'режим ' + AP.state));

  /* наводим порядок: игрок жив, камера осмысленная */
  S.player.hp = 100;

  /* ---------- 3b. ВИЗУАЛЬНЫЕ СИСТЕМЫ ---------- */
  console.log('\n▶ визуальные системы: купол, живые материалы, шлейфы, аберрация');

  check('купол разлома: ShaderMaterial радиусом 18 м', () => {
    const D = AP.W.dome;
    assert(D && D.mesh && D.material, 'купол не создан');
    assert(D.material.type === 'ShaderMaterial', 'материал: ' + D.material.type);
    assert(D.material.uniforms.uColor, 'нет униформы цвета');
    assert(Math.abs(D.mesh.scale.x - 18) < 0.8, 'радиус ' + D.mesh.scale.x.toFixed(2));
    assert(D.mesh.visible, 'купол невидим в режиме play');
  });

  check('купол ярче при перемотке', () => {
    const u = AP.W.dome.material.uniforms;
    S.player.charge = 100;
    const before = u.uIntensity.value;
    env.key('KeyQ', true);
    run(26, 'dome');
    const during = u.uIntensity.value;
    const rew = u.uRewind.value;
    env.key('KeyQ', false);
    run(4, 'dome');
    assert(during > before + 0.05, `${before.toFixed(2)} → ${during.toFixed(2)}`);
    assert(rew >= 0.9, 'uRewind во время перемотки = ' + rew);
  });

  check('живые материалы: дыхание вставлено в вершинный шейдер three', () => {
    const T = AP.THREE;
    const std = T.ShaderLib.standard.vertexShader;
    assert(std.includes('#include <begin_vertex>'), 'в three нет begin_vertex — патч не сработает');
    const entry = AP.W.living[0];
    assert(!!entry && entry.mat.onBeforeCompile, 'материал не пропатчен');
    const fake = { uniforms: {}, vertexShader: std, fragmentShader: '' };
    entry.mat.onBeforeCompile(fake);
    assert(!fake.vertexShader.includes('#include <begin_vertex>'), 'include не заменён');
    assert(fake.vertexShader.includes('transformed += objectNormal'), 'нет смещения по нормали');
    assert(fake.uniforms.uRift && fake.uniforms.uAmp && fake.uniforms.uBreath, 'униформы не проброшены');
  });

  check('дыхание усиливается разломом (uniform растёт)', () => {
    const u = AP.W.living[0].uni;
    const before = u.uRift.value;
    S.rift = 100;
    run(3, 'living');
    const during = u.uRift.value;
    S.rift = 0;
    assert(before < 0.2, 'стартовый rift ' + before);
    assert(during > 0.9, 'uRift не вырос: ' + during);
  });

  check('линии памяти: шлейфы при перемотке', () => {
    S.player.charge = 100;
    S.rift = 0;
    env.key('KeyQ', true);
    run(24, 'trails');
    const lines = AP.W.scene.children.filter((o) => o.isLine);
    const shown = lines.filter((o) => o.visible && o.geometry.drawRange.count > 3);
    env.key('KeyQ', false);
    run(4, 'trails');
    assert(lines.length > 0, 'линии не созданы');
    assert(shown.length > 0, 'ни один шлейф не показан');
    assert(shown[0].geometry.attributes.lineDistance, 'нет пунктира (lineDistance)');
  });

  check('пост-обработка: буфер + аберрация на разломе', () => {
    const P = AP.W.post;
    assert(P && P.enabled, 'пост-проход не включён');
    assert(P.target && P.mat, 'нет рендер-таргета');
    S.rift = 100;
    run(3, 'post');
    const u = P.mat.uniforms;
    assert(u.uRift.value > 0.9, 'uRift = ' + u.uRift.value);
    assert(u.uGlitch.value > 0.9, 'глитч не включился: ' + u.uGlitch.value);
    S.rift = 0;
  });

  check('FOV качается от разлома, но остаётся играбельным', () => {
    S.rift = 100;
    run(40, 'fov');
    const fov = AP.W.camera.fov;
    S.rift = 0;
    assert(fov > 74.2, 'FOV не вырос: ' + fov.toFixed(2));
    assert(fov < 82, 'FOV ушёл в крайность: ' + fov.toFixed(2));
  });

  /* ---------- 3c. ТАКТИЛЬНОСТЬ БОЯ ---------- */
  console.log('\n▶ тактильность: hitstop, телеграф коллапса, осколки, отбрасывание');
  const T3 = AP.THREE;
  const lastCrystal = () => S.crystals[S.crystals.length - 1];

  check('телеграф коллапса: вибрация, градиент, кольцо поражения', () => {
    S.player.hp = 1e6;
    S.player.pos.set(0, 2.4, 25);
    S.player.vel.set(0, 0, 0);
    S.yaw = 0.9;
    S.pitch = -0.45;
    run(3, 'tele');
    const before = S.crystals.length;
    S.player.mass = 40;
    env.mouse('mousedown', 2);
    run(1, 'tele');
    assert(S.crystals.length > before, 'кристалл не создан');
    const cr = lastCrystal();
    assert(cr.ring && cr.ring.group.visible, 'кольца поражения нет');
    assert(cr.mat && cr.mat !== AP.W.M.crystal, 'материал не склонирован');

    cr.timer = 3.6;            // k ≈ 0.1
    run(1, 'tele');
    const c1 = cr.mat.color.getHex();
    const f1 = cr.ring.fill.scale.x;
    cr.timer = 0.35;           // k ≈ 0.91
    run(1, 'tele');
    const c2 = cr.mat.color.getHex();
    assert(c1 !== c2, 'градиент цвета не работает');
    assert(cr.mesh.position.distanceTo(cr.base) > 0.001, 'меш не вибрирует');
    assert(cr.ring.fill.scale.x > f1 + 0.4, 'заливка радиуса не растёт');
  });

  check('hitstop: мир замирает на кадры после взрыва', () => {
    const cr = lastCrystal();
    cr.timer = 0.004;
    const hit = runUntil(() => !cr.alive, 40, 'hitstop');   // кадр детонации
    assert(hit >= 0, 'кристалл не сдетонировал');
    const t0 = S.time;
    run(2, 'hitstop');
    assert(S.time - t0 < 1e-9, 'время шло во время hitstop: +' + (S.time - t0).toFixed(4));
  });

  check('осколки с затухающим шлейфом', () => {
    run(5, 'debris');
    const shards = AP.W.scene.children.filter(
      (o) => o.isMesh && o.visible && o.geometry && o.geometry.type === 'TetrahedronGeometry');
    assert(shards.length > 0, 'осколков нет');
    const trails = AP.W.scene.children.filter(
      (o) => o.isPoints && o.material && o.material.vertexColors === true);
    assert(trails.length > 0, 'пул шлейфа не создан');
  });

  check('отбрасывание: рокет-джамп от собственного коллапса', () => {
    S.player.hp = 1e6;
    S.player.mass = 40;
    env.mouse('mousedown', 2);
    const cr = lastCrystal();
    assert(cr && cr.alive, 'нет живого кристалла для подрыва');
    S.player.pos.copy(cr.base).add(new T3.Vector3(0, 2, 0));
    S.player.vel.set(0, 0, 0);
    const hpBefore = S.player.hp;
    cr.timer = 0.004;
    const boom = runUntil(() => !cr.alive, 40, 'rocket');
    assert(boom >= 0, 'кристалл не сдетонировал');
    assert(S.player.vel.y > 2, 'нет вертикального импульса: ' + S.player.vel.y.toFixed(2));
    assert(S.player.hp < hpBefore, 'самоурон не сработал');
  });

  /* возвращаем игрока в игру */
  S.player.hp = 100;
  S.player.vel.set(0, 0, 0);
  S.player.pos.set(0, 2, 25);
  run(4, 'restore');

  /* ---------- 4. КАМПАНИЯ: ПЯТЬ ЗОН ---------- */
  console.log('\n▶ кампания: четыре биома и арена босса');

  for (let z = 0; z < 4; z++) {
    AP.loadZone(z);
    S.mode = 'play';
    run(30, 'zone' + z);

    check(`зона ${z + 1}: загружена, 3 узла, игрок на опоре`, () => {
      assert(S.zone === z, `S.zone = ${S.zone}`);
      assert(S.nodes.length === 3, 'узлов ' + S.nodes.length);
      assert(S.player.pos.y > -3, 'игрок под миром, y = ' + S.player.pos.y.toFixed(2));
      assert(finite(S.player.pos.x, S.player.pos.y, S.player.pos.z), 'NaN в позиции');
    });

    /* ломаем узлы штатным путём — через урон от коллапса структуры */
    for (const node of S.nodes) {
      if (S.hooks.nodeDamage) S.hooks.nodeDamage(node.pos.clone(), 500);
      run(6, 'node');
    }
    const portalFrames = runUntil(() => S.portal && S.portal.active, 400, 'portal');
    check(`зона ${z + 1}: портал открылся`, () => assert(portalFrames >= 0,
      'портал не открылся за 400 кадров; узлов живо ' + S.nodes.filter((n) => n.alive).length));

    /* входим в портал — как игрок: ногами */
    if (S.portal) S.player.pos.copy(S.portal.pos);
    const upFrames = runUntil(() => AP.state === 'upgrade', 200, 'enter');
    check(`зона ${z + 1}: экран вплетения`, () => assert(upFrames >= 0, 'портал не переключил режим'));

    /* прокачка на осколках, которые дали за зону */
    S.stats.sec += 6;
    S.stats.paradox += 2;
    const lvlBefore = S.upgrades.stasis;
    S.hooks.buy('stasis');
    check(`зона ${z + 1}: апгрейд куплен за осколки`, () =>
      assert(S.upgrades.stasis === lvlBefore + 1 || lvlBefore >= 3,
        `уровень ${lvlBefore} → ${S.upgrades.stasis}`));

    env.click('contBtn');
    run(6, 'cont');
    const nextName = z === 3 ? '5 (арена Хор-Ноля)' : String(z + 2);
    check(`переход: зона ${z + 1} → зона ${nextName}`, () =>
      assert(S.zone === z + 1 || z === 3, 'остались в зоне ' + S.zone));
  }

  /* ---------- 5. БОСС ---------- */
  console.log('\n▶ босс Хор-Ноль');
  check('босс на арене и полон сил', () => {
    assert(S.zone === 4, 'зона ' + S.zone);
    assert(!!S.boss, 'S.boss отсутствует');
    assert(S.boss.hp > 0 && S.boss.maxHp > 0, 'HP ' + (S.boss && S.boss.hp));
    assert(S.boss.maxHp >= 1000, 'подозрительно мало HP: ' + S.boss.maxHp);
    return true;
  });

  const bossMaxHp = S.boss.maxHp;
  const phasesSeen = new Set();
  S.player.hp = 1e6; // смоук-прогон проверяет механику, а не ловкость
  S.player.pos.set(0, 0.2, -38);
  const aimAt = (v) => {
    const dx = v.x - S.player.pos.x;
    const dy = v.y - (S.player.pos.y + 1.55);
    const dz = v.z - S.player.pos.z;
    S.yaw = Math.atan2(-dx, -dz);
    S.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };

  let fightFrames = 0;
  let orbit = 0;
  let idleClicks = 0;
  const FIGHT_BUDGET = 3000;
  while (S.boss && S.boss.hp > 0 && fightFrames < FIGHT_BUDGET) {
    if (S.boss.phase) phasesSeen.add(S.boss.phase);
    /* бот играет как игрок: обходит босса по кругу и ставит структуру с новой точки,
       иначе прицел каждый раз попадает в прошлый кристалл («уже нестабильно») */
    if (S.player.mass >= 6 && fightFrames % 18 === 0) {
      orbit += 0.55;
      S.player.pos.set(Math.cos(orbit) * 8, 0.2, -46 + Math.sin(orbit) * 8);
      S.player.vel.set(0, 0, 0);
      aimAt(S.boss.pos);
      /* камера догоняет прицел за кадр — как у живого игрока: прицелился, увидел, нажал */
      step('boss');
      fightFrames++;
      const beforeCr = S.crystals.length;
      env.mouse('mousedown', 2);
      if (S.crystals.length === beforeCr) idleClicks++;
    }
    step('boss');
    fightFrames++;
    if (VERBOSE && fightFrames % 300 === 0) {
      console.log(`     · ${fightFrames}: hp=${S.boss ? S.boss.hp.toFixed(0) : 'dead'} mass=${S.player.mass.toFixed(0)} кристаллов=${S.crystals.length} дист=${S.player.pos.distanceTo(S.boss ? S.boss.pos : S.player.pos).toFixed(1)}`);
    }
  }
  if (S.boss) phasesSeen.add(S.boss.phase);

  check(`босс убит за ${fightFrames} кадров (HP ${bossMaxHp}, вхолостую ${idleClicks})`, () =>
    assert(S.boss && S.boss.hp <= 0, 'осталось HP ' + (S.boss ? S.boss.hp.toFixed(0) : '?')));
  check('фазы сменялись (≥2)', () => assert(phasesSeen.size >= 2, 'видели фазы: ' + [...phasesSeen].join(', ')));
  const coreFrames = runUntil(() => !!AP.core, 120, 'core');
  check('после боя появилось ядро', () => assert(coreFrames >= 0, 'ядро не создано'));

  /* ---------- 6. ФИНАЛЫ ---------- */
  console.log('\n▶ финалы');
  S.player.pos.copy(AP.core.pos);
  run(2, 'core');
  env.key('Digit1', true); env.key('Digit1', false); run(2, 'ending');
  check('финал «ШОВ» по клавише 1', () => {
    assert(AP.state === 'ending', 'режим ' + AP.state);
    const t = env.document.getElementById('endTitle').textContent;
    assert(t === 'ШОВ', 'заголовок: ' + t);
  });
  check('экран финала со статистикой', () => {
    const st = env.document.getElementById('endStats').innerHTML;
    assert(st.includes('индекс разлома'), 'нет статистики');
  });

  AP.finish('chaos');
  check('финал «НОВЫЙ ЗАКОН»', () => {
    const t = env.document.getElementById('endTitle').textContent;
    assert(t === 'НОВЫЙ ЗАКОН', 'заголовок: ' + t);
  });

  /* ---------- 7. РАНДОМИЗИРОВАННЫЙ ПРОГОН ДО 9000 КАДРОВ ---------- */
  console.log('\n▶ рандомизированный прогон до ' + TOTAL_FRAMES + ' кадров');
  const CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'Tab'];
  const held = new Set();
  const release = () => {
    for (const c of held) env.key(c, false);
    held.clear();
  };
  const zonesTouched = new Set();
  let zoneSwitches = 0;
  let sculpts = 0;
  let rewinds = 0;
  let echoes = 0;

  S.mode = 'play';
  S.player.hp = 1e9; // чтобы смерть не обрывала покрытие кода
  AP.loadZone(0);
  S.mode = 'play';

  while (state.frames < TOTAL_FRAMES) {
    const r = rnd();

    /* ввод — как у живого игрока */
    if (r < 0.055) {
      const c = pick(CODES);
      if (held.has(c)) { held.delete(c); env.key(c, false); }
      else { held.add(c); env.key(c, true); if (c === 'KeyQ') rewinds++; if (c === 'KeyE') echoes++; }
    }
    if (r > 0.972) { env.mouse('mousedown', rnd() < 0.55 ? 0 : 2); if (rnd() < 0.55) sculpts++; }
    if (r > 0.962 && r < 0.972) env.mouse('mouseup', 0);
    if (r > 0.9 && r < 0.93) env.mouse('mousemove', 0, { movementX: (rnd() - 0.5) * 60, movementY: (rnd() - 0.5) * 40 });

    /* служебные события: смена зоны, покупка, смерть игрока */
    if (r > 0.988) {
      const z = rint(5);
      release();
      AP.loadZone(z);
      S.mode = 'play';
      S.player.hp = 1e9;
      zonesTouched.add(z);
      zoneSwitches++;
    }
    if (r > 0.978 && r < 0.981) {
      S.stats.sec += 4; S.stats.paradox += 2;
      S.hooks.buy(pick(['stasis', 'flood', 'decay']));
    }
    if (r > 0.968 && r < 0.97) S.hooks.respawn && S.hooks.respawn('смоук-тест');

    step('fuzz');

    /* инварианты, которые обязаны держаться в любом кадре */
    if (!finite(S.player.pos.x, S.player.pos.y, S.player.pos.z)) {
      fail('кадр ' + state.frames + ': NaN в позиции игрока');
      break;
    }
    if (!finite(S.rift)) { fail('кадр ' + state.frames + ': NaN в индексе разлома'); break; }
    if (S.player.pos.y < -60) S.hooks.respawn && S.hooks.respawn('падение');
  }
  release();

  check('прогон дошёл до ' + TOTAL_FRAMES + ' кадров', () =>
    assert(state.frames >= TOTAL_FRAMES, 'только ' + state.frames));
  check('все пять зон побывали под нагрузкой', () =>
    assert(zonesTouched.size === 5, 'тронуто зон: ' + zonesTouched.size + ' (' + [...zonesTouched].join(',') + ')'));
  check('эхо, лепка и перемотка покрыты вводом', () =>
    assert(echoes > 0 && sculpts > 0 && rewinds > 0,
      `эхо ${echoes}, лепка ${sculpts}, перемотка ${rewinds}`));
  check('аудиодвижок реально собран (узлы Web Audio)', () => {
    const A = env.audioClass;
    assert(A.instances > 0, 'AudioContext не создавался');
    assert(A.nodes >= 10, 'создано узлов: ' + A.nodes);
  });
  check('финальное состояние целое', () => {
    assert(typeof S.mode === 'string', 'режим: ' + S.mode);
    assert(finite(S.player.hp, S.player.mass, S.player.charge), 'NaN в состоянии игрока');
    assert(S.player.mass >= 0 && S.player.mass <= 200, 'масса вне диапазона: ' + S.player.mass);
    assert(S.enemies.every((e) => finite(e.pos.x, e.pos.y, e.pos.z)), 'NaN у врага');
    assert(S.blocks.every((b) => finite(b.mesh.position.x)), 'NaN у блока');
    assert(S.crystals.every((c) => finite(c.timer)), 'NaN в таймере кристалла');
  });

  report({ zoneSwitches });
}

function report(extra = {}) {
  if (TMP_DIR) {
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* не критично */ }
    TMP_DIR = null;
  }
  const errs = state.errors.length;
  const line = '═'.repeat(58);
  console.log('\n' + line);
  console.log(`  кадров: ${state.frames}   проверок: ${state.checks}   пройдено: ${state.passed}   ошибок: ${errs}`);
  if (extra.zoneSwitches !== undefined) {
    console.log(`  смен зоны в фаззинге: ${extra.zoneSwitches}   seed: ${SEED}`);
  }
  if (errs) {
    console.log('  ── ошибки ──');
    for (const e of state.errors.slice(0, 30)) console.log('   · ' + e);
    console.log(line + '\n');
    process.exitCode = 1;
    return;
  }
  console.log('  ИТОГ: 0 ошибок — логика игры цела' + (state.passed === state.checks ? '' : ` (но ${state.checks - state.passed} проверок упало)`));
  console.log(line + '\n');
  process.exitCode = state.passed === state.checks ? 0 : 1;
}

process.on('uncaughtException', (e) => fail('uncaught: ' + (e && e.message)));
process.on('unhandledRejection', (e) => fail('unhandledRejection: ' + (e && e.message)));

main().catch((e) => {
  fail('фатально: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e));
  report();
});
