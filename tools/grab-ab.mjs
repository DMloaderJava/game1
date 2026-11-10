// A/B-прогон телекинеза: один и тот же ввод в чистой игре и с narrative.js.
// Нужен, чтобы отделить сюжетный слой от физики игры: если кадры совпадают
// побитово, за поведение ящика отвечает gravity-void.html, а не narrative.js.
import fs from 'node:fs';
import vm from 'node:vm';

const HERE = new URL('.', import.meta.url);
const HTML = fs.readFileSync(new URL('../gravity-void.html', HERE), 'utf8');
const SRC = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const NARR = fs.readFileSync(new URL('../narrative.js', HERE), 'utf8');

const grad = { addColorStop() {} };
class Ctx {
  constructor(c) { this.canvas = c; }
  fillRect() {} clearRect() {} drawImage() {}
  createLinearGradient() { return grad; } createRadialGradient() { return grad; }
  beginPath() {} moveTo() {} lineTo() {} arcTo() {} arc() {} closePath() {}
  quadraticCurveTo() {} bezierCurveTo() {} ellipse() {} createPattern() { return null; }
  fill() {} stroke() {} strokeRect() {} save() {} restore() {} translate() {}
  scale() {} rotate() {} setTransform() {} setLineDash() {} clip() {} rect() {}
  measureText(t) { return { width: t.length * 6 }; } fillText() {}
}
class Canvas {
  constructor(w, h) { this.width = w; this.height = h; this.style = {}; this.L = {}; }
  getContext() { if (!this._c) this._c = new Ctx(this); return this._c; }
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); }
  fire(t, e) { for (const f of this.L[t] || []) f(e); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
}

function makeGame(withNarrative) {
  const W = 1280, H = 720;
  const view = new Canvas(W, H);
  const winL = {};
  const sandbox = {
    console, Math, Date, JSON, Uint8Array, Float32Array,
    devicePixelRatio: 1, innerWidth: W, innerHeight: H,
    requestAnimationFrame: () => 1,
    document: { createElement: () => new Canvas(1, 1), getElementById: () => view,
                addEventListener() {}, readyState: 'complete' },
    performance,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { focus() {}, addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); },
              devicePixelRatio: 1, innerWidth: W, innerHeight: H },
    setTimeout, clearTimeout
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;globalThis.__g = game; globalThis.Game = Game;'
    + 'globalThis.__T = TILE; globalThis.__CFG = CFG;', ctx, { filename: 'gravity-void.html' });
  if (withNarrative) vm.runInContext(NARR, ctx, { filename: 'narrative.js' });
  return { g: sandbox.__g, CFG: sandbox.__CFG, view };
}

const DT = 1 / 60;

// Сцена: игрок на поверхности, ящик сбоку; ПКМ по ящику, дальше 45 кадров
// ведём курсор к точке рядом с игроком — как рука, тянущая ящик к себе.
function run(withNarrative, crateDx) {
  const { g, CFG, view } = makeGame(withNarrative);
  const z = CFG.camera.zoom;
  g.update(DT);
  const p = g.player;
  p.x = 800; p.y = 15 * 32; p.vx = p.vy = 0; p.health = p.maxHealth; p.dead = false;
  g.camera.snap(p);
  g.update(DT);
  const c = g.crates[0];
  c.x = p.x + crateDx; c.y = p.y + 40;
  c.vx = c.vy = 0; c.sleeping = false; c.gravityScale = 1;
  g.update(DT);

  const mv = (wx, wy) => view.fire('mousemove', {
    clientX: (wx - g.camera.x) * z, clientY: (wy - g.camera.y) * z, preventDefault() {}
  });
  const start = { x: c.cx, y: c.cy };
  mv(c.cx, c.cy);
  view.fire('mousedown', { clientX: g.input.mouse.x, clientY: g.input.mouse.y,
                           button: 2, preventDefault() {} });
  g.update(DT);
  const grabbed = !!g.grab;

  const rows = [];
  for (let i = 0; i < 45; i++) {
    mv(p.cx + 30, p.cy - 10);
    g.update(DT);
    rows.push({
      cx: +c.cx.toFixed(3), cy: +c.cy.toFixed(3),
      vx: +c.vx.toFixed(3), vy: +c.vy.toFixed(3),
      px: +p.cx.toFixed(3), right: g.input.mouse.right, grab: !!g.grab,
      toPlayer: +Math.hypot(c.cx - p.cx, c.cy - p.cy).toFixed(1),
      toCursor: +Math.hypot(c.cx - g.mouseW.x, c.cy - g.mouseW.y).toFixed(1)
    });
  }
  return { grabbed, rows, start, crate: c, player: p, CFG };
}

const A = run(false, -96);
const B = run(true, -96);
let diffs = 0;
for (let i = 0; i < Math.min(A.rows.length, B.rows.length); i++) {
  for (const k of ['cx', 'cy', 'vx', 'vy', 'px', 'right', 'grab']) {
    if (A.rows[i][k] !== B.rows[i][k]) diffs++;
  }
}
console.log('сюжет-и-без: ' + diffs + ' расхождений на ' + A.rows.length + ' кадров');

// Что реально происходит в конце: ящик стоит там, куда его пускает физика
const last = B.rows[B.rows.length - 1];
const tele = B.CFG.tele;
console.log('константы: grabOffset=' + tele.grabOffset
  + ', разведение тел требует ' + (B.CFG.crate.w / 2 + B.CFG.player.w / 2 + tele.grabGap));
console.log('итог: ящик прошёл ' + Math.hypot(last.cx - B.start.x, last.cy - B.start.y).toFixed(1) + 'px');

// Застой: кадры, где ящик почти не двигается, хотя захват держится
let stall = 0, inStall = false, stallAt = 0;
for (let i = 4; i < B.rows.length; i++) {
  const moved = Math.hypot(B.rows[i].cx - B.rows[i - 1].cx, B.rows[i].cy - B.rows[i - 1].cy);
  if (B.rows[i].grab && moved < 0.3) { stall++; if (!inStall) { inStall = true; stallAt = B.rows[i].toPlayer; } }
  else inStall = false;
}
console.log('застой: ящик встал на ' + Math.round(stallAt) + 'px от игрока, кадров застоя ' + stall);

// Рывки: смены знака горизонтальной скорости
let flips = 0;
for (let i = 5; i < B.rows.length; i++) {
  if (Math.sign(B.rows[i].vx) !== Math.sign(B.rows[i - 1].vx) && Math.abs(B.rows[i].vx) > 1) flips++;
}
console.log('рывки: ' + flips + ' смен знака скорости за ' + B.rows.length + ' кадров');
console.log('мышь в конце: right=' + last.right + ', grab=' + last.grab
  + ', до курсора ' + last.toCursor + 'px, до игрока ' + last.toPlayer + 'px');

// ---- развёртка по частоте кадров: дрожание зависит от dt, значит это
// пружина телекинеза в updateGrab, а не сюжетный слой
function sweep(fps, gun, crateDx) {
  const DT2 = 1 / fps;
  const { g, CFG, view } = makeGame(true);
  const z = CFG.camera.zoom;
  g.update(DT2);
  const p = g.player;
  p.hasGravityGun = gun;
  p.x = 800; p.y = 15 * 32; p.vx = p.vy = 0; p.health = p.maxHealth; p.dead = false;
  g.camera.snap(p); g.update(DT2);
  const c = g.crates[0];
  c.x = p.x + crateDx; c.y = p.y + 40;
  c.vx = c.vy = 0; c.sleeping = false; c.gravityScale = 1;
  g.update(DT2);
  const mv = (wx, wy) => view.fire('mousemove', {
    clientX: (wx - g.camera.x) * z, clientY: (wy - g.camera.y) * z, preventDefault() {} });
  mv(c.cx, c.cy);
  view.fire('mousedown', { clientX: g.input.mouse.x, clientY: g.input.mouse.y,
                           button: 2, preventDefault() {} });
  g.update(DT2);
  if (!g.grab) return null;
  const rows = [];
  const total = Math.round(0.9 * fps);
  for (let i = 0; i < total; i++) {
    mv(p.cx + 30, p.cy - 10);
    g.update(DT2);
    rows.push({ vx: c.vx, d: Math.hypot(c.cx - p.cx, c.cy - p.cy) });
  }
  let flips = 0;
  for (let i = 2; i < rows.length; i++) {
    if (Math.sign(rows[i].vx) !== Math.sign(rows[i - 1].vx) && Math.abs(rows[i].vx) > 1) flips++;
  }
  return { end: +rows[rows.length - 1].d.toFixed(1), flips };
}

console.log('\nчастота кадров | без пушки | с пушкой   (итог в px до игрока / смен знака скорости)');
const sweepRows = [];
for (const fps of [30, 60, 120]) {
  const a = sweep(fps, false, -96), b = sweep(fps, true, -96);
  sweepRows.push({ fps, a, b });
  console.log('  ' + String(fps).padStart(3) + ' fps     | '
    + (a ? a.end + 'px / ' + a.flips : '—') + ' | ' + (b ? b.end + 'px / ' + b.flips : '—'));
}
const lo = sweepRows[0].a, hi = sweepRows[sweepRows.length - 1].a;
console.log('дрожание растёт с частотой: ' + (lo && hi ? lo.flips + ' → ' + hi.flips : 'нет данных'));
console.log('предел одинаков у всех: ' + sweepRows.map(r => r.a && r.a.end).join(', ') + 'px');
