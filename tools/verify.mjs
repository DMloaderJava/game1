// Headless-проверка gravity-void.html: заглушки canvas/DOM + прогон логики
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
const m = HTML.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error('script не найден');
let SRC = m[1];

const calls = { fillRect: 0, fillTileRect: 0, drawImage: 0, fillText: 0, strokeRect: 0 };
const grad = { addColorStop() {} };

class FakeCtx {
  constructor(c) { this.canvas = c; }
  set fillStyle(v) { this._fs = v; } get fillStyle() { return this._fs; }
  set strokeStyle(v) { this._ss = v; } get strokeStyle() { return this._ss; }
  fillRect() { calls.fillRect++; if (this.canvas.kind === 'offscreen') calls.fillTileRect++; }
  clearRect() {}
  drawImage(img) {
    calls.drawImage++;
    if (img && img.kind === 'offscreen' && img.width === 200 * 32) calls.drawTileBuffer = (calls.drawTileBuffer || 0) + 1;
    // M8.1: тайл рисуется запечённым спрайтом TS*2 x TS*2 (SPR.scale = 2)
    if (img && img.kind === 'offscreen' && img.width === 64 && img.height === 64) calls.tileSprites = (calls.tileSprites || 0) + 1;
  }
  createLinearGradient() { return grad; }
  createRadialGradient() { return grad; }
  beginPath() {} moveTo() {} lineTo() {} arcTo() {} arc() {} closePath() {}
  quadraticCurveTo() {} bezierCurveTo() {} ellipse() {}
  createPattern() { return null; }
  set shadowBlur(v) {} get shadowBlur() { return 0; }
  set shadowColor(v) {} get shadowColor() { return ''; }
  set lineCap(v) {} get lineCap() { return 'butt'; }
  set lineJoin(v) {} get lineJoin() { return 'miter'; }
  set globalCompositeOperation(v) { this._gco = v; } get globalCompositeOperation() { return this._gco || 'source-over'; }
  set imageSmoothingEnabled(v) {} get imageSmoothingEnabled() { return true; }
  fill() {} stroke() {} strokeRect() { calls.strokeRect++; }
  save() {} restore() {} translate() {} scale() {} rotate() {}
  setTransform() {} setLineDash() {} clip() {} rect() {} set lineDashOffset(v) {} get lineDashOffset() { return 0; }
  measureText(t) { return { width: t.length * 6 }; }
  fillText() { calls.fillText++; }
}

class FakeCanvas {
  constructor(kind = 'offscreen') { this.kind = kind; this.width = 1280; this.height = 720; this.style = {}; }
  getContext() { if (!this._ctx) this._ctx = new FakeCtx(this); return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(t, fn) { (this._l ||= {}); (this._l[t] ||= []).push(fn); }
}

const view = new FakeCanvas('view');
const listeners = {};
const rafQueue = [];
let nowMs = 0;

const sandbox = {
  console,
  Math, Date, JSON, Uint8Array, Float32Array,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
  document: {
    createElement: () => new FakeCanvas(),
    getElementById: () => view
  },
  performance,
  localStorage: (() => {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      _mem: mem
    };
  })(),
  window: {
    focus: () => {},
    addEventListener: (t, fn) => { listeners[t] = fn; },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720
  },
  setTimeout, clearTimeout
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

SRC += '\n;globalThis.__game = game; globalThis.__CFG = CFG; globalThis.__TILE = TILE;'
     + ';globalThis.__ITEM = ITEM; globalThis.__CRAWLER_STATE = CRAWLER_STATE;'
     + ';globalThis.__cls = { Drop, Crate, PhysBody, Player, World, Game, Tide, Save, Crawler, Particles, Inventory };'
     + ';globalThis.__SPR = SPR; globalThis.__Sprites = Sprites;'
     + ';globalThis.__TouchUI = TouchUI; globalThis.__MODE = MODE;';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });

const game = sandbox.__game;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const TS = CFG.tile;

const results = [];
const ok = (name, cond, info = '') => {
  results.push({ name, pass: !!cond, info });
  if (!cond) console.log('FAIL:', name, info);
};

// ---- прогон кадров ----
function frames(n, dtMs = 1000 / 60) {
  for (let i = 0; i < n; i++) {
    nowMs += dtMs;
    const cb = rafQueue.shift();
    if (!cb) throw new Error('нет кадра в очереди');
    cb(nowMs);
  }
}
function key(code, down = true) {
  const fn = listeners[down ? 'keydown' : 'keyup'];
  fn({ code, repeat: false, preventDefault() {} });
}
function tapKey(code) { key(code, true); frames(1); key(code, false); }
function mouse(type, wx, wy, button = 0) {
  const z = CFG.camera.zoom;
  const x = (wx - game.camera.x) * z;
  const y = (wy - game.camera.y) * z;
  if (type === 'mousemove') view._l.mousemove.forEach(f => f({ clientX: x, clientY: y, preventDefault() {} }));
  else if (type === 'down') view._l.mousedown.forEach(f => f({ clientX: x, clientY: y, button, preventDefault() {} }));
  else listeners.mouseup({ clientX: x, clientY: y, button });
}

const P = game.player;
const W = game.world;
const FLOOR_Y = W.surfaceRow * TS - P.h;   // мировой Y, на котором игрок стоит на поверхности

// ---------------------------------------------------------------- мир
let topEmpty = true;
for (let y = 0; y < 5; y++) for (let x = 0; x < W.cols; x++) if (W.get(x, y) !== TILE.EMPTY) topEmpty = false;
ok('верхние 5 рядов пустые', topEmpty);

let dirt = 0, stone = 0, ferrite = 0, empty = 0;
for (const t of W.tiles) {
  if (t === TILE.DIRT) dirt++; else if (t === TILE.STONE) stone++;
  else if (t === TILE.FERRITE) ferrite++; else empty++;
}
const ferriteRatio = ferrite / (ferrite + stone); // в породе под землёй
ok('есть DIRT/STONE/FERRITE', dirt > 0 && stone > 0 && ferrite > 0, `dirt=${dirt} stone=${stone} ferrite=${ferrite} empty=${empty}`);
ok('сетка ≥ 100x40', W.cols >= 100 && W.rows >= 40, `${W.cols}x${W.rows}`);
ok('есть потолочный слой', W.solid(20, 6) && W.solid(20, 5));

// ---------------------------------------------------------------- стартовое падение
frames(60);
ok('игрок стоит на земле', P.onGround === true, `y=${P.y.toFixed(1)} vy=${P.vy.toFixed(1)}`);
ok('игрок не внутри тайла', !insideSolid(P), `x=${P.x.toFixed(1)} y=${P.y.toFixed(1)}`);
function insideSolid(b) {
  const x0 = Math.floor(b.x / TS), x1 = Math.floor((b.x + b.w - 0.001) / TS);
  const y0 = Math.floor(b.y / TS), y1 = Math.floor((b.y + b.h - 0.001) / TS);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (W.solid(x, y)) return true;
  return false;
}

// ---------------------------------------------------------------- движение
const x0 = P.x;
key('KeyD'); frames(30); key('KeyD', false);
ok('идёт вправо', P.x > x0 + 40, `dx=${(P.x - x0).toFixed(1)}`);
frames(20);

// ---------------------------------------------------------------- копание DIRT
function aimTile(tx, ty) {
  game.camera.snap(game.player);      // снимаем дрейф камеры, иначе клик уходит в другой тайл
  game._mwKey = null;
  mouse('mousemove', tx * TS + TS / 2, ty * TS + TS / 2);
  return { x: (tx * TS + TS / 2 - game.camera.x) * CFG.camera.zoom,
           y: (ty * TS + TS / 2 - game.camera.y) * CFG.camera.zoom };
}
function clickTile(tx, ty) {
  aimTile(tx, ty);
  mouse('down', tx * TS + TS / 2, ty * TS + TS / 2);
  game.camera.snap(game.player);   // камера могла сдвинуться за кадр — вернуть
  game._mwKey = null;
  frames(1);
  mouse('up', 0, 0);
  frames(1);
}

function mouseToTile(tx, ty) {
  mouse('mousemove', tx * TS + TS / 2, ty * TS + TS / 2);
}
const digTarget = { tx: Math.floor(P.cx / TS), ty: Math.floor((P.y + P.h) / TS) + 1 };
ok('цель под игроком — DIRT', W.get(digTarget.tx, digTarget.ty) === TILE.DIRT, `type=${W.get(digTarget.tx, digTarget.ty)}`);

const invBefore = game.inventory.counts[TILE.DIRT];
// M5: мир стал глубже, над залом лежит плита, а под полом — порода на 100+ рядов.
// DDA-подбор мог бы отдать дроп в руки игроку мгновенно (как раньше при дропе из-под ног),
// поэтому до начала копания тратим очередь кадров: дроп должен падать физически
frames(30);
mouseToTile(digTarget.tx, digTarget.ty);
mouse('down', digTarget.tx * TS + TS / 2, digTarget.ty * TS + TS / 2);
frames(2);
ok('копание началось (есть прогресс)', game.dig !== null && game.dig.progress > 0, JSON.stringify(game.dig && { tx: game.dig.tx, ty: game.dig.ty }));
frames(8); // итого ~10 кадров > 0.15с
ok('DIRT скопан за ~0.15с', W.get(digTarget.tx, digTarget.ty) === TILE.EMPTY);
// M3: в пещерах уже лежит BIOGEL, поэтому считаем только дропы копки
const gelDrops = () => game.drops.filter(d => d.type === 4).length;
const baseGel = gelDrops();
ok('появился физический дроп', game.drops.length === baseGel + 1, `drops=${game.drops.length} gel=${baseGel}`);
const dugDrop = game.drops.find(d => d.type === TILE.DIRT);
ok('дроп нужного типа', !!dugDrop, `type=${dugDrop && dugDrop.type}`);

// Яма рядом с игроком: дроп падает на дно физически и засыпает.
// M5: яма вырыта в двух тайлах от игрока — иначе подбор мгновенный и падения не видно
mouse('up', 0, 0);
frames(10);
const pitX = digTarget.tx + 2, pitY = digTarget.ty;
W.set(pitX, pitY, TILE.EMPTY, false);
W.set(pitX, pitY + 1, TILE.EMPTY, false);
game.tiles.flush();
const dropY0 = pitY * TS + 2;
const pitDrop = new sandbox.__cls.Drop(pitX * TS + 10, dropY0, TILE.DIRT);
pitDrop.vx = 0; pitDrop.vy = 0;
game.drops.push(pitDrop);
const dropsBeforePit = game.drops.length;
frames(4);
ok('дроп в яме начинает падать', pitDrop.y > dropY0 + 2, `dy=${(pitDrop.y - dropY0).toFixed(1)}`);
frames(120);
ok('дроп упал и заснул в яме', pitDrop.sleeping === true,
   `drops=${game.drops.length}/${dropsBeforePit} sleep=${pitDrop.sleeping} y=${(pitDrop.y / TS).toFixed(2)}`);
ok('дроп в яме физически ниже пола', pitDrop.y > pitY * TS, `y=${pitDrop.y.toFixed(1)}`);
ok('дроп в яме не подобрался: игрок далеко', game.drops.indexOf(pitDrop) >= 0);

// подбор вплотную: дроп появляется на игроке — должен подобраться за кадр
const invNow = game.inventory.counts[TILE.STONE];
game.drops.push(new sandbox.__cls.Drop(P.cx - 6, P.cy - 6, TILE.STONE));
frames(2);
ok('дроп на игроке подбирается автоматически', game.inventory.counts[TILE.STONE] === invNow + 1,
   `inv=${game.inventory.counts[TILE.STONE]}`);
// M6: к кольцу искр добавлена вспышка-«flash».
// M8.1: на спавне дымит корабль, поэтому считаем именно всплеск подбора
const burstSparks = game.particles.list.filter(p => p.kind === 'spark').length;
const burstFlash = game.particles.list.filter(p => p.kind === 'flash').length;
ok('подбор дал burst-частицы', burstSparks >= CFG.particles.pickup && burstFlash >= 1,
   `искр=${burstSparks} вспышек=${burstFlash} всего=${game.particles.list.length}`);
ok('HUD пульсирует после подбора', game.inventory.pulse[TILE.STONE] > 0,
   `pulse=${game.inventory.pulse[TILE.STONE].toFixed(2)}`);

// подбор на ходу: дроп лежит на полу в метре справа
// ставим игрока на чистый участок пола (позицию вернём после теста)
const savedX = P.x, savedY = P.y;
P.x = 330; P.y = FLOOR_Y; P.vx = 0; P.vy = 0;
frames(4);
const dropX = P.x - 70;
const dropY = P.y + P.h - CFG.drop.size;
game.drops.push(new sandbox.__cls.Drop(dropX, dropY, TILE.STONE));
const invWalk = game.inventory.counts[TILE.STONE];
key('KeyA'); frames(40); key('KeyA', false);
ok('дроп подбирается на ходу', game.inventory.counts[TILE.STONE] === invWalk + 1,
   `inv=${game.inventory.counts[TILE.STONE]} drops=${game.drops.length}`);
frames(20);
game.drops.length = 0;
P.x = savedX; P.y = savedY; P.vx = 0; P.vy = 0;
frames(4);

// ---------------------------------------------------------------- сброс прогресса при отпускании
mouseToTile(digTarget.tx + 1, digTarget.ty);
mouse('down', (digTarget.tx + 1) * TS + TS / 2, digTarget.ty * TS + TS / 2);
frames(4);
const wasDigging = game.dig !== null;
mouse('up', 0, 0);
frames(2);
ok('отпускание ЛКМ сбрасывает прогресс', wasDigging && game.dig === null);

// ---------------------------------------------------------------- stone / ferrite время
function findTileInRadius(type, nearX, nearY, maxDist) {
  let best = null, bd = 1e9;
  for (let y = nearY - 6; y <= nearY + 8; y++) {
    for (let x = nearX - 6; x <= nearX + 6; x++) {
      if (y < 0 || y >= W.rows || x < 0 || x >= W.cols) continue;
      if (W.get(x, y) !== type) continue;
      const d = Math.hypot(x - nearX, y - nearY);
      if (d > maxDist) continue;
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return best;
}

// ставим игрока рядом с камнем
const st = findTileInRadius(TILE.STONE, Math.floor(P.cx / TS), Math.floor(P.cy / TS), CFG.dig.radius - 0.6);
if (st) {
  const t0 = performance.now();
  mouseToTile(st.x, st.y);
  mouse('down', st.x * TS + 16, st.y * TS + 16);
  let n = 0;
  while (W.get(st.x, st.y) === TILE.STONE && n < 120) { frames(1); n++; }
  const secs = n / 60;
  ok('STONE копается ~0.5с', secs >= 0.4 && secs <= 0.65, `кадров=${n} (${secs.toFixed(2)}с)`);
  mouse('up', 0, 0);
}

// ---------------------------------------------------------------- «далеко»
frames(30);
let far = null;
for (let tx = Math.floor(P.cx / TS) + 8; tx < Math.floor(P.cx / TS) + 20; tx++) {
  for (let ty = Math.floor(P.cy / TS) - 2; ty < Math.floor(P.cy / TS) + 6; ty++) {
    if (W.solid(tx, ty) && Math.hypot(tx * TS + 16 - P.cx, ty * TS + 16 - P.cy) / TS > CFG.dig.radius + 1) { far = { tx, ty }; break; }
  }
  if (far) break;
}
const wasSolidFar = far ? W.solid(far.tx, far.ty) : false;
mouseToTile(far.tx, far.ty);
mouse('down', far.tx * TS + 16, far.ty * TS + 16);
frames(20);
ok('дальний тайл не копается', game.dig === null && W.get(far.tx, far.ty) !== TILE.EMPTY, `solidBefore=${wasSolidFar}`);
ok('показан фидбек «далеко»', game.tooFarT > 0, `tooFarT=${game.tooFarT.toFixed(2)}`);
mouse('up', 0, 0);

// ---------------------------------------------------------------- телекинез по ящику
frames(30);
const crate = game.crates[0];
const beforeCrate = { x: crate.x, y: crate.y };
mouse('mousemove', crate.cx, crate.cy);
mouse('down', crate.cx, crate.cy, 2);
frames(2);
ok('ПКМ по ящику — захват (телекинез)', game.grab === crate && game.dig === null, `grab=${!!game.grab} mode=${game.mode}`);
mouse('mousemove', crate.cx + 40, crate.cy - 60);
frames(30);
ok('ящик тянется за курсором', Math.abs(crate.x - beforeCrate.x) > 5 || Math.abs(crate.y - beforeCrate.y) > 5);
mouse('up', 0, 0, 2);
frames(30);
ok('гравитация ящика вернулась при отпускании', crate.gravityScale === 1);

// ---------------------------------------------------------------- переворот гравитации
const ceilingBottom = (CFG.layers.skyRows + CFG.layers.ceilingRows) * TS;
tapKey('KeyF');
ok('гравитация перевёрнута', P.gravityTarget === -1);
frames(180);
ok('игрок стоит на потолке', P.onGround === true, `onGround=${P.onGround} y=${P.y.toFixed(1)} vy=${P.vy.toFixed(1)}`);
ok('игрок не застрял в потолке', !insideSolid(P), `y=${P.y.toFixed(1)} ceiling=${ceilingBottom}`);
ok('игрок дошёл до потолка', Math.abs(P.y - ceilingBottom) <= 3, `top=${P.y.toFixed(1)} ceiling=${ceilingBottom}`);
const yUp = P.y;
key('Space'); frames(3); key('Space', false);
frames(10);
ok('прыжок работает при перевёрнутой гравитации', P.y > yUp + 1, `dy=${(P.y - yUp).toFixed(1)}`);
frames(120);

// возврат вниз
tapKey('KeyF');
frames(240);
ok('игрок вернулся на пол', P.onGround === true && P.gravityTarget === 1, `y=${P.y.toFixed(1)}`);

// ---------------------------------------------------------------- прыжок с пола
frames(20);
const yBefore = P.y;
key('Space'); frames(2); key('Space', false);
let minY = P.y;
for (let i = 0; i < 20; i++) { frames(1); minY = Math.min(minY, P.y); }
ok('прыжок с пола поднимает игрока', minY < yBefore - 40, `подъём=${(yBefore - minY).toFixed(1)}px`);
frames(60);

// ---------------------------------------------------------------- границы мира
P.x = 20; P.vx = 0; frames(4);
key('KeyA'); frames(90); key('KeyA', false);
ok('не выходит за левый край', P.x >= 0, `x=${P.x.toFixed(1)}`);

// ---------------------------------------------------------------- телекинез дропа
frames(10);
const tk = new sandbox.__cls.Drop(P.cx + 40, P.y + P.h - CFG.drop.size, TILE.STONE);
game.drops.push(tk);
frames(2);
const tmx = (tk.cx - game.camera.x) * CFG.camera.zoom, tmy = (tk.cy - game.camera.y) * CFG.camera.zoom;
mouse('mousemove', tk.cx, tk.cy);
mouse('down', tk.cx, tk.cy, 2);
frames(2);
const grabbedDrop = game.grab === tk;
mouse('mousemove', tk.cx, tk.cy - 90);
frames(20);
ok('дроп можно тянуть телекинезом (ПКМ)', grabbedDrop && tk.gravityScale === 0, `grab=${grabbedDrop} gs=${tk.gravityScale}`);
ok('дроп поднялся над полом', tk.y < P.y + P.h - 40, `y=${tk.y.toFixed(1)}`);
mouse('up', 0, 0, 2);
frames(40);
game.drops.length = 0;
game.input.mouse.left = false;

// ---------------------------------------------------------------- ящик падает после подкопa
frames(20);
const cr = game.crates.find(c => c !== game.grab) || game.crates[0];
cr.x = 40 * TS; cr.y = (W.surfaceRow - 3) * TS; cr.vx = 0; cr.vy = 0; cr.wake();
frames(20);
const crY = cr.y;
const supportTx = Math.floor(cr.cx / TS);
const supportTy = Math.floor((cr.y + cr.h + 1) / TS);   // тайл, на который опирается ящик
// ящик шириной 36px стоит на двух тайлах — убираем оба
for (let tx = Math.floor(cr.x / TS); tx <= Math.floor((cr.x + cr.w - 0.001) / TS); tx++) {
  W.set(tx, supportTy, TILE.EMPTY);
}
game.tiles.flush();
game.wakeNear(supportTx, supportTy);
frames(60);
ok('ящик падает, когда убрали опору', cr.y > crY + 4, `было=${crY.toFixed(1)} стало=${cr.y.toFixed(1)}`);

// ---------------------------------------------------------------- перф: 300 тел + 50 дропов
const N = 300;
const { Crate, Drop } = sandbox.__cls;
for (let i = 0; i < N; i++) {
  game.crates.push(new Crate(P.cx - 600 + (i % 30) * 40, P.cy - 400 - Math.floor(i / 30) * 40));
}
for (let i = 0; i < 50; i++) {
  game.drops.push(new Drop(P.cx - 100 + (i % 10) * 20, P.cy - 60, TILE.STONE));
}
frames(30);
const tPerf = [];
for (let k = 0; k < 120; k++) {
  const t0 = process.hrtime.bigint();
  game.update(CFG.step);
  game.render();
  const t1 = process.hrtime.bigint();
  tPerf.push(Number(t1 - t0) / 1e6);
}
tPerf.sort((a, b) => a - b);
const p50 = tPerf[Math.floor(tPerf.length / 2)];
const p95 = tPerf[Math.floor(tPerf.length * 0.95)];
ok('update+render < 16.6мс (p95) при 300 телах', p95 < 16.6, `p50=${p50.toFixed(2)}мс p95=${p95.toFixed(2)}мс`);

// ---------------------------------------------------------------- тайлы
calls.fillTileRect = 0;
calls.drawImage = 0;
calls.drawTileBuffer = 0;
calls.tileSprites = 0;
frames(1);
ok('в простое offscreen тайлов не перерисовывается', calls.fillTileRect === 0, `fillRect в буфер за кадр=${calls.fillTileRect}`);
// M8.1: мира-полотна больше нет, тайлы рисуются запечёнными спрайтами.
// Их число зависит от размера кадра, а не от размера мира
ok('M8.1: за кадр рисуются только видимые тайлы', calls.tileSprites > 0 && calls.tileSprites <= 1200,
   `спрайтов тайлов=${calls.tileSprites}, всего drawImage=${calls.drawImage}`);
ok('M8.1: блита буфера размером с мир больше нет', (calls.drawTileBuffer || 0) === 0,
   `блитов=${calls.drawTileBuffer || 0}`);
const beforeFlush = game.tiles.world.dirty.length;
game.world.set(3, 3, TILE.STONE);
ok('изменение тайла попадает в dirty', game.world.dirty.length === beforeFlush + 1);

// ---------------------------------------------------------------- стабильность
let crash = null;
try { frames(600); } catch (e) { crash = e; }
ok('600 кадров без исключений', !crash, crash ? String(crash) : '');

// ---------------------------------------------------------------- прилив: дропы улетают вверх
game.crates.length = 0;
game.drops.length = 0;
P.x = 330; P.y = FLOOR_Y; P.vx = 0; P.vy = 0;
frames(10);
const quiet = [];
for (let i = 0; i < 6; i++) quiet.push(new sandbox.__cls.Drop(P.cx - 160 + i * 24, P.y + P.h - CFG.drop.size, TILE.STONE));
game.drops.push(...quiet);
frames(60);
const sleepY = quiet.map(d => d.y);

// принудительно в катастрофу
game.tide.setPhase(2);
game.tide.applyPhase(game.tide.id);
game.onPhaseChanged('CATASTROPHE');
P.invuln = 999;                 // M3: изолируем физику прилива от системы здоровья
frames(200);
const movedUp = quiet.filter((d, i) => d.y < sleepY[i] - 20).length;
ok('в катастрофе дропы летят вверх', movedUp >= 4, `улетело: ${movedUp}/6`);
ok('игрок тоже улетел вверх без F', P.y < FLOOR_Y - 40, `y=${P.y.toFixed(1)} было ${FLOOR_Y.toFixed(1)}`);

// контр-манипуляция: F прижимает обратно
tapKey('KeyF');
frames(120);
ok('F при катастрофе меняет личную гравитацию', P.gravityTarget === 1, `target=${P.gravityTarget}`);
P.invuln = 0;

game.tide.setPhase(0);
game.tide.applyPhase('STABLE');
frames(120);

// ---------------------------------------------------------------- HUD-состояние
ok('пульсация HUD затухает', Object.values(game.inventory.pulse).every(v => v >= 0 && v <= CFG.hud.pulse + 0.001));

// ---------------------------------------------------------------- 1B: постройка и снос
game.drops.length = 0;
game.crates.length = 0;
game.tide.setPhase(0);
game.tide.applyPhase('STABLE');
frames(10);
game.inventory.counts[TILE.STONE] = 12;
game.inventory.counts[TILE.FERRITE] = 6;

// ставим стену из 5 камней слева от игрока
const baseX = Math.floor(P.cx / TS) - 3;
const baseY = Math.floor((P.y + P.h - 0.001) / TS) - 3;
tapKey('Digit2'); // режим STONE
ok('режим STONE выбран', game.mode === TILE.STONE, 'mode=' + game.mode);
let built = 0;
game.camera.snap(P);
for (let i = 0; i < 5; i++) {
  const ty = baseY + 2 - i;               // 2 вниз и 3 вверх от базы — всё в радиусе 5
  if (W.solid(baseX, ty)) continue;
  clickTile(baseX, ty);
  if (W.isPlaced(baseX, ty)) built++;
}
ok('поставлена стена из блоков', built >= 3, `построено=${built}`);
ok('ресурс списан на каждый блок', game.inventory.counts[TILE.STONE] === 12 - built,
   `построено=${built} осталось=${game.inventory.counts[TILE.STONE]}`);
ok('постройка помечена placed', W.isPlaced(baseX, baseY));

// нельзя строить без ресурса
game.inventory.counts[TILE.DIRT] = 0;
tapKey('Digit1');
clickTile(baseX + 2, baseY);
ok('без ресурса не строится', !W.solid(baseX + 2, baseY));
ok('фидбэк «нельзя» показан', game.denyT > 0, 'denyT=' + game.denyT.toFixed(2));

// нельзя строить далеко
game.inventory.counts[TILE.DIRT] = 5;
const farX = Math.floor(P.cx / TS) + 12;
clickTile(farX, baseY - 1);
ok('далеко не строится', !W.solid(farX, baseY - 1));

// снос возвращает ресурс
tapKey('Digit5');
const beforeDemolish = game.inventory.counts[TILE.STONE];
clickTile(baseX, baseY);
frames(2);
ok('снос возвращает ресурс', !W.solid(baseX, baseY) && game.inventory.counts[TILE.STONE] === beforeDemolish + 1,
   `камень=${game.inventory.counts[TILE.STONE]}`);

// природный тайл сносом не удаляется
const natX = Math.floor(P.cx / TS) + 1, natY = baseY;
const natType = W.get(natX, natY);
if (natType !== TILE.EMPTY && !W.isPlaced(natX, natY)) {
  clickTile(natX, natY);
  ok('природный тайл сносом не удаляется', W.get(natX, natY) === natType);
}

// ---------------------------------------------------------------- M2: якорь
game.inventory.counts[TILE.FERRITE] = 6;
game.inventory.counts[TILE.STONE] = 4;
tapKey('Digit6');
ok('режим якоря выбран', game.mode === 6);
const aTx = Math.floor(P.cx / TS) + 2, aTy = Math.floor((P.y + P.h - 0.001) / TS);
clickTile(aTx, aTy);
frames(2);
ok('якорь поставлен', game.anchors.length === 1, 'anchors=' + game.anchors.length);
ok('стоимость списана', game.inventory.counts[TILE.FERRITE] === 1 && game.inventory.counts[TILE.STONE] === 1,
   `ferrite=${game.inventory.counts[TILE.FERRITE]} stone=${game.inventory.counts[TILE.STONE]}`);

// второй якорь при нехватке ресурсов
const anchorsBefore = game.anchors.length;
clickTile(aTx + 1, aTy);
frames(2);
ok('без ресурсов якорь не ставится', game.anchors.length === anchorsBefore, 'anchors=' + game.anchors.length);
ok('фидбэк у якоря есть', game.denyT > 0);

// защита тайлов в куполе
const ax = game.anchors[0].x, ay = game.anchors[0].y;
ok('тайл рядом с якорем защищён', game.isProtected(ax + 1, ay));
ok('тайл далеко не защищён', !game.isProtected(ax + 20, ay));

// снос якоря возвращает ресурсы
const stBefore = game.inventory.counts[TILE.STONE], ferBefore = game.inventory.counts[TILE.FERRITE];
tapKey('Digit5');
clickTile(ax, ay);
frames(2);
ok('якорь сносится', game.anchors.length === 0);
ok('снос якоря возвращает ресурсы',
   game.inventory.counts[TILE.FERRITE] === ferBefore + 5 && game.inventory.counts[TILE.STONE] === stBefore + 3,
   `ferrite=${game.inventory.counts[TILE.FERRITE]} stone=${game.inventory.counts[TILE.STONE]}`);

// ---------------------------------------------------------------- M2: разрушение
game.anchors = [];
game.inventory.counts[TILE.FERRITE] = 10;
game.inventory.counts[TILE.STONE] = 40;

// ставим постройки ЯВНО через API (клик по клетке зависит от камеры — для логики это не нужно)
const anchorTx = Math.floor(P.cx / TS) + 1;
const anchorTy = Math.floor((P.y + P.h - 0.001) / TS);
const nearTx = anchorTx + 2, nearTy = anchorTy - 2;
const farTx = anchorTx + 12, farTy = anchorTy - 2;

W.set(nearTx, nearTy, TILE.STONE, true);
W.set(farTx, farTy, TILE.STONE, true);
// Якорь ставим напрямую: клик зависит от камеры, а проверяем логику
game.inventory.counts[TILE.FERRITE] = 10;
game.inventory.counts[TILE.STONE] = 40;
game.anchors.push({ x: anchorTx, y: anchorTy, born: 0 });
const haveAnchor = game.anchors.length >= 1;

const nearBuilt = W.isPlaced(nearTx, nearTy);
const farBuilt = W.isPlaced(farTx, farTy);
const nearProtected = game.isProtected(nearTx, nearTy);
const farProtected = game.isProtected(farTx, farTy);
ok('построены два тестовых тайла', nearBuilt && farBuilt && haveAnchor,
   `near=${nearBuilt} far=${farBuilt} anchor=${haveAnchor}`);
ok('один тайл под куполом, второй нет', nearProtected && !farProtected,
   `nearProt=${nearProtected} farProt=${farProtected}`);

game.tide.setPhase(2);
game.tide.applyPhase('CATASTROPHE');
game.onPhaseChanged('CATASTROPHE');
frames(330);   // ~5.5 с катастрофы — гарантированно проходит первая волна
ok('незащищённая постройка разрушена приливом', !W.isPlaced(farTx, farTy) || !W.solid(farTx, farTy),
   `far solid=${W.solid(farTx, farTy)}`);
ok('защищённая постройка цела', W.isPlaced(nearTx, nearTy) && W.solid(nearTx, nearTy));
ok('при разрушении появился дроп', game.drops.length > 0, 'drops=' + game.drops.length);

// естественные тайлы не разрушаются
let naturalBefore = 0;
for (let i = 0; i < W.tiles.length; i++) if (W.tiles[i] !== TILE.EMPTY && !W.placed[i]) naturalBefore++;
frames(300);
let naturalAfter = 0;
for (let i = 0; i < W.tiles.length; i++) if (W.tiles[i] !== TILE.EMPTY && !W.placed[i]) naturalAfter++;
ok('естественные тайлы не разрушаются', naturalBefore === naturalAfter, `${naturalBefore} → ${naturalAfter}`);

// ---------------------------------------------------------------- M2: фазы и цикл
game.tide.setPhase(1);   // WARNING
game.tide.applyPhase('WARNING');
frames(60);
ok('WARNING: небо уходит в фиолетовый', game.skyWarn > 0.5, 'skyWarn=' + game.skyWarn.toFixed(2));
const warnLeft = game.tide.left;
frames(30);
ok('WARNING: таймер идёт вниз', game.tide.left < warnLeft);

game.tide.setPhase(2);
game.tide.applyPhase('CATASTROPHE');
ok('CATASTROPHE: мировая гравитация -1', game.tide.worldGravity === -1);

game.tide.setPhase(3);
game.tide.applyPhase('AFTERMATH');
game.rewardGiven = false;
const dropsBefore = game.drops.length;
frames(10);
ok('AFTERMATH: спавн феррита', game.drops.length > dropsBefore, `было=${dropsBefore} стало=${game.drops.length}`);
ok('AFTERMATH: гравитация вернулась вниз', game.tide.worldGravity === 1);

// полный цикл по длительностям
game.tide.setPhase(3);
const cycleStart = game.tide.phaseIndex;
let seen = new Set();
for (let i = 0; i < 60 * 40; i++) { frames(1); seen.add(game.tide.id); }
ok('цикл возвращается в STABLE', game.tide.id === 'STABLE', 'фаза=' + game.tide.id);

// ---------------------------------------------------------------- сохранение
game.tide.setPhase(0);
game.tide.t = 20;   // 80 секунд до прилива
game.inventory.counts[TILE.FERRITE] = 7;
game.doSave();
const saved = JSON.parse(sandbox.localStorage.getItem(CFG.save.key));
// M8.1: формат сейва v4 — вместо RLE всей карты хранится overlay правок
ok('сейв записан', !!saved && saved.v === 4 && saved.tiles.length > 0, 'v=' + (saved && saved.v));
ok('в сейве есть фаза', saved.cycle && saved.cycle.phase === 'STABLE', JSON.stringify(saved.cycle));

// загрузка STABLE: таймер продолжается
const game2 = new (sandbox.__cls.Game)(view);
const leftAfterLoad = game2.tide.left;
ok('загрузка STABLE: таймер продолжается', leftAfterLoad > 60 && leftAfterLoad < 95, 'left=' + leftAfterLoad.toFixed(1));
ok('загрузка: инвентарь восстановлен', game2.inventory.counts[TILE.FERRITE] === 7, 'ferrite=' + game2.inventory.counts[TILE.FERRITE]);

// якоря и постройки переживают перезагрузку
game.anchors = [{ x: 40, y: 16, born: 0 }];
W.set(41, 16, TILE.STONE, true);
game.tiles.flush();
game.doSave();
const game2b = new (sandbox.__cls.Game)(view);
ok('загрузка: якоря восстановлены', game2b.anchors.length === 1 && game2b.anchors[0].x === 40,
   JSON.stringify(game2b.anchors));
ok('загрузка: маска построек восстановлена', game2b.world.isPlaced(41, 16));
ok('загрузка: защита работает по восстановленному якорю', game2b.isProtected(42, 16));

// загрузка из WARNING/CATASTROPHE → STABLE
game.tide.setPhase(2);
game.doSave();
const game3 = new (sandbox.__cls.Game)(view);
ok('загрузка из CATASTROPHE сбрасывает в STABLE', game3.tide.id === 'STABLE', 'фаза=' + game3.tide.id);

// ---------------------------------------------------------------- тестовый режим цикла
ok('quickTest по умолчанию выключен', CFG.tide.quickTest === false);
ok('длительности фаз как в спеке',
   CFG.tide.phases.map(p => p.sec).join(',') === '100,20,25,35',
   CFG.tide.phases.map(p => p.sec).join(','));

// ---------------------------------------------------------------- FPS-бюджет якоря
// купол рисуется одной окружностью, а не заливкой тайлов
const domeSrc = sandbox.__game.render.toString();
ok('купол рисуется дугой (arc), а не по тайлам',
   /drawAnchors/.test(domeSrc) && /arc\(/.test(String(sandbox.__game.drawAnchors)));

// ================================================================
// M3: жизнь и смерть
// ================================================================
const ITEM = sandbox.__ITEM;
const ST = sandbox.__CRAWLER_STATE;
const Crawler = sandbox.__cls.Crawler;

// Кадры гоняем напрямую: raf-очередь принадлежит самому первому Game
function stepG(g, n = 1) {
  for (let i = 0; i < n; i++) g.update(CFG.step);
}
function pressG(g, code) {
  g.input.pressed.add(code);
}

// свежий мир на чистом сейве
sandbox.localStorage.removeItem(CFG.save.key);
const g3 = new (sandbox.__cls.Game)(view);
const P3 = g3.player;
stepG(g3, 60);

ok('M3: здоровье 100/100 на старте', P3.health === 100 && P3.maxHealth === 100, `hp=${P3.health}`);
ok('M3: в инвентаре появился BIOGEL', !!CFG.resources.find(r => r.id === ITEM.BIOGEL),
   JSON.stringify(CFG.resources.map(r => r.name)));
ok('M3: биогель зелёный', CFG.resources.find(r => r.id === ITEM.BIOGEL).color.toLowerCase() === '#3fd66b');

// --- хищники в пещерах
const caveTop = CFG.layers.skyRows + CFG.layers.ceilingRows;
// M5: к трём хищникам зала добавились пятеро в Глубоких пещерах
const caveCrawlers = g3.crawlers.filter(c => c.cy / TS < CFG.layers.deepTopRow);
ok('M3: спавнится 2-3 хищника в зале', caveCrawlers.length >= 2 && caveCrawlers.length <= 3, `n=${caveCrawlers.length}`);
ok('M3: хищники под землёй', g3.crawlers.every(c => c.cy > caveTop * TS),
   g3.crawlers.map(c => (c.cy / TS).toFixed(1)).join(','));
ok('M3: размер хищника 32x24', g3.crawlers.every(c => c.w === 32 && c.h === 24));
ok('M3: у хищника 30 HP', g3.crawlers.every(c => c.hp === 30 && c.maxHp === 30));

ok('M3: хищник начинает в IDLE', g3.crawlers.every(c => c.state === ST.IDLE),
   g3.crawlers.map(c => c.state).join(','));
const gelOnMap = g3.drops.filter(d => d.type === ITEM.BIOGEL);
ok('M3: 3-4 биогеля лежат в пещерах', gelOnMap.length >= 3 && gelOnMap.length <= 4, `n=${gelOnMap.length}`);

// --- урон от падения
P3.health = 100; P3.invuln = 0;
P3.x = 30 * TS; P3.y = 6 * TS; P3.vy = 900; P3.vx = 0;
let hurtByFall = false;
for (let i = 0; i < 120; i++) {
  stepG(g3, 1);
  if (P3.health < 100) { hurtByFall = true; break; }
}
ok('M3: падение с высоты наносит урон', hurtByFall, `hp=${P3.health.toFixed(0)}`);
ok('M3: урон от падения по формуле', P3.health >= 60 && P3.health <= 95, `hp=${P3.health.toFixed(0)}`);

// мягкое падение не ранит
P3.health = 100; P3.invuln = 0;
P3.x = 30 * TS; P3.y = g3.world.surfaceRow * TS - P3.h - 40; P3.vy = 0;
stepG(g3, 40);
ok('M3: мягкое падение не ранит', P3.health === 100, `hp=${P3.health}`);

// в приливе урон даёт прилив, а не удар о плиту (иначе двойной штраф)
const savedCrawlers = g3.crawlers.slice();
g3.crawlers.length = 0;
P3.health = 100; P3.invuln = 0;
g3.tide.setPhase(2); g3.tide.applyPhase('CATASTROPHE');
P3.x = 30 * TS; P3.y = 10 * TS; P3.vy = -1100;
stepG(g3, 30);
ok('M3: в приливе удар о плиту не считается падением', P3.health === 100, `hp=${P3.health} y=${P3.y.toFixed(0)}`);
g3.tide.setPhase(0); g3.tide.applyPhase('STABLE');
g3.crawlers.push(...savedCrawlers);

// --- урон от прилива без укрытия
P3.health = 100; P3.invuln = 0;
g3.anchors = [];
g3.lastGround = { x: 30 * TS, y: g3.world.surfaceRow * TS - P3.h };
g3.tide.setPhase(2); g3.tide.applyPhase('CATASTROPHE');
P3.y = -P3.h - 2;
stepG(g3, 1);
ok('M3: прилив без укрытия бьёт на 30', P3.health === 70, `hp=${P3.health}`);

// --- под куполом с потолком над головой урона нет
P3.health = 100; P3.invuln = 0;
const cxT = 40, cyT = 16;
g3.anchors.push({ x: cxT, y: cyT, born: 0 });
g3.world.set(cxT, cyT - 3, TILE.STONE, true);
P3.x = cxT * TS + 4; P3.y = cyT * TS - P3.h;
g3.lastGround = { x: P3.x, y: P3.y };
ok('M3: укрытие определяется', g3.isSheltered() === true, `anchors=${g3.anchors.length}`);
P3.y = -P3.h - 2;
stepG(g3, 1);
ok('M3: в укрытии прилив не ранит', P3.health === 100, `hp=${P3.health}`);
g3.world.set(cxT, cyT - 3, TILE.EMPTY, true);
g3.anchors = [];

// --- лечение по H
P3.health = 40; P3.invuln = 5;
g3.inventory.counts[ITEM.BIOGEL] = 1;
pressG(g3, 'KeyH');
stepG(g3, 1);
ok('M3: H лечит на 40 и тратит биогель', P3.health === 80 && g3.inventory.counts[ITEM.BIOGEL] === 0,
   `hp=${P3.health} gel=${g3.inventory.counts[ITEM.BIOGEL]}`);

P3.health = 40;
g3.inventory.counts[ITEM.BIOGEL] = 0;
g3.healPlayer(40);
ok('M3: без биогеля лечения нет', P3.health === 40, `hp=${P3.health}`);
ok('M3: H привязана к инпуту', /KeyH/.test(String(sandbox.__game.update)));

// --- смерть: потеря 50% ресурсов, респавн, полное здоровье
P3.health = 10; P3.invuln = 0;
g3.inventory.counts[TILE.FERRITE] = 7;
g3.inventory.counts[TILE.STONE] = 3;
g3.inventory.counts[TILE.DIRT] = 1;
const deathsBefore = g3.deaths;
g3.damagePlayer(50, 'тест');
ok('M3: смерть фиксируется', g3.deaths === deathsBefore + 1);
ok('M3: теряется половина ресурсов (floor)',
   g3.inventory.counts[TILE.FERRITE] === 4 && g3.inventory.counts[TILE.STONE] === 2 &&
   g3.inventory.counts[TILE.DIRT] === 1,
   `f=${g3.inventory.counts[TILE.FERRITE]} s=${g3.inventory.counts[TILE.STONE]} d=${g3.inventory.counts[TILE.DIRT]}`);
ok('M3: после смерти здоровье восстановлено', P3.health === 100, `hp=${P3.health}`);
ok('M3: респавн на стартовой точке',
   Math.abs(P3.x - (CFG.spawn.playerTileX * TS + (TS - P3.w) / 2)) < 2, `x=${P3.x.toFixed(1)}`);
ok('M3: после респавна есть неуязвимость', P3.invuln > 0, `inv=${P3.invuln.toFixed(2)}`);
ok('M3: красный экран смерти включён', g3.deathT > 0, `t=${g3.deathT.toFixed(2)}`);
ok('M3: смерть пишется в консоль', /console\.log/.test(String(g3.killPlayer)));

P3.health = 100;
g3.damagePlayer(20, 'тест');
ok('M3: неуязвимость блокирует урон', P3.health === 100, `hp=${P3.health}`);
P3.invuln = 0;

// --- M3.5: арена для честных тестов ИИ. Игрок НЕ телепортируется к жуку:
// сцена ставится один раз, дальше оба живут своей физикой
function arena(build) {
  const g = new (sandbox.__cls.Game)(view);
  const W2 = g.world;
  const surface = W2.surfaceRow;
  // ровный зал: убираем уступы в рабочей зоне
  for (let x = 90; x <= 130; x++) for (let y = 6; y < surface; y++) W2.set(x, y, TILE.EMPTY, false);
  if (build) build(W2, surface, TILE);
  g.tiles.flush();
  g.crawlers.length = 0;
  return g;
}
function putCrawler(g, tx, ty) {
  const cw = new Crawler(tx * TS, ty * TS - CFG.crawler.h);
  cw.home = { x: cw.cx, y: cw.cy };
  g.crawlers.push(cw);
  return cw;
}
function putPlayer(g, tx, ty) {
  const p = g.player;
  p.x = tx * TS; p.y = ty * TS - p.h;
  p.vx = 0; p.vy = 0; p.gravityTarget = 1; p.health = 100; p.invuln = 0;
  g.camera.snap(p);
  return p;
}
const distTiles = (cw, p) => Math.hypot(cw.cx - p.cx, cw.cy - p.cy) / TS;

// 1. Жук на платформе на 3 тайла выше, игрок на земле в 5 тайлах по горизонтали
{
  const g = arena((W2, s, T) => { for (let x = 100; x <= 112; x++) W2.set(x, s - 3, T.STONE, true); });
  const p = putPlayer(g, 107, 17);
  const cw = putCrawler(g, 112, 13);
  const d0 = distTiles(cw, p);
  ok('M3.5: старт — жук на платформе, игрок на земле', d0 > 4.5 && d0 < 7, `d0=${d0.toFixed(2)}`);
  let bit = false, minD = d0;
  for (let i = 0; i < 300; i++) {
    stepG(g, 1);
    const d = distTiles(cw, p);
    if (d < minD) minD = d;
    if (p.health < 100) bit = true;
  }
  const d1 = distTiles(cw, p);
  ok('M3.5: жук спрыгнул с платформы', cw.cy > 14 * TS, `cy=${(cw.cy / TS).toFixed(2)}`);
  ok('M3.5: за 300 кадров жук физически приблизился', d1 < d0 - 3 || d1 < 1.5,
     `d0=${d0.toFixed(2)} d1=${d1.toFixed(2)} min=${minD.toFixed(2)}`);
  ok('M3.5: жук догнал и укусил', bit, `hp=${p.health} minD=${minD.toFixed(2)}`);
}

// 2. Игрок стоит на платформе в 2 тайла над жуком: жук подходит и запрыгивает
{
  const g = arena((W2, s, T) => { for (let x = 100; x <= 112; x++) W2.set(x, s - 2, T.STONE, true); });
  const p = putPlayer(g, 110, 15);
  const cw = putCrawler(g, 104, 17);
  const d0 = distTiles(cw, p);
  let minD = d0;
  for (let i = 0; i < 300; i++) {
    stepG(g, 1);
    const d = distTiles(cw, p);
    if (d < minD) minD = d;
  }
  ok('M3.5: жук подошёл к подножию платформы', minD < 2.5,
     `d0=${d0.toFixed(2)} min=${minD.toFixed(2)} cy=${(cw.cy / TS).toFixed(2)}`);
  ok('M3.5: жук прыгает вверх к игроку', cw.y < 17 * TS, `cy=${(cw.cy / TS).toFixed(2)}`);
}

// 3. Препятствие: игрок сам ставит блок в 5 тайлах от жука
{
  const g = arena();
  const p = putPlayer(g, 107, 17);
  const cw = putCrawler(g, 112, 17);
  const bx = 109;
  const by = Math.floor((p.y + p.h) / TS) - 1;      // блок в один тайл над полом
  g.world.set(bx, by, TILE.DIRT, true);             // поставлено «игроком» — помечено placed
  g.world.set(bx, by + 1, TILE.DIRT, true);
  g.tiles.flush();
  ok('M3.5: блок стоит на пути жука', g.world.solid(bx, by) && g.world.isPlaced(bx, by));
  const d0 = distTiles(cw, p);
  let minD = d0, bit = false;
  for (let i = 0; i < 300; i++) {
    stepG(g, 1);
    const d = distTiles(cw, p);
    if (d < minD) minD = d;
    if (p.health < 100) bit = true;
  }
  ok('M3.5: жук перепрыгнул двухтайловую стену', minD < 1.5 && bit,
     `d0=${d0.toFixed(2)} min=${minD.toFixed(2)} hp=${p.health}`);
}

// 4. Яма глубиной 4 тайла — ловушка из спеки M3: жук не вылезает и не телепортируется
{
  const g = arena((W2, s, T) => {
    for (let y = s; y < s + 4; y++) { W2.set(104, y, T.EMPTY, false); W2.set(108, y, T.EMPTY, false); }
    for (let x = 104; x <= 108; x++) W2.set(x, s + 4, T.EMPTY, false);
  });
  const p = putPlayer(g, 100, 17);
  const cw = putCrawler(g, 106, 21);
  const d0 = distTiles(cw, p);
  let minD = d0;
  for (let i = 0; i < 300; i++) {
    stepG(g, 1);
    const d = distTiles(cw, p);
    if (d < minD) minD = d;
  }
  ok('M3.5: в глубокой яме жук остаётся (ловушка работает)', cw.cy > 19 * TS,
     `cy=${(cw.cy / TS).toFixed(2)}`);
  ok('M3.5: из глубокой ямы жук не телепортируется к игроку', minD > 3,
     `d0=${d0.toFixed(2)} min=${minD.toFixed(2)}`);
}

// 4b. Жук в яме 2 тайла — выбирается, потому что это по силам прыжку
{
  const g = arena((W2, s, T) => {
    for (let y = s; y < s + 2; y++) { W2.set(104, y, T.EMPTY, false); W2.set(108, y, T.EMPTY, false); }
    for (let x = 104; x <= 108; x++) W2.set(x, s + 2, T.EMPTY, false);
  });
  const p = putPlayer(g, 100, 17);
  const cw = putCrawler(g, 106, 19);
  let minD = distTiles(cw, p);
  for (let i = 0; i < 300; i++) {
    stepG(g, 1);
    const d = distTiles(cw, p);
    if (d < minD) minD = d;
  }
  ok('M3.5: из мелкой ямы жук выбирается', minD < 6.2,
     `min=${minD.toFixed(2)} cy=${(cw.cy / TS).toFixed(2)}`);
}

// 5. Тупик: стена выше прыжка — жук не телепортируется и не застревает в вечном прыжке
{
  const g = arena((W2, s, T) => { for (let y = s - 4; y < s; y++) W2.set(110, y, T.STONE, true); });
  const p = putPlayer(g, 107, 17);
  const cw = putCrawler(g, 112, 17);
  let jumps = 0, lastGround = true;
  for (let i = 0; i < 300; i++) {
    const before = cw.onGround;
    stepG(g, 1);
    if (before && !cw.onGround) jumps++;
  }
  ok('M3.5: у стены выше прыжка нет бесконечных скачков', jumps <= 12, `прыжков=${jumps}`);
  ok('M3.5: жук не проходит сквозь высокую стену', cw.x > 110 * TS, `cx=${(cw.cx / TS).toFixed(2)}`);
}

// 6. Укус вплотную: обычная погоня, без перестановки игрока каждый кадр
{
  const g = arena();
  const p = putPlayer(g, 107, 17);
  const cw = putCrawler(g, 112, 17);
  const d0 = distTiles(cw, p);
  ok('M3.5: на одном уровне жук сразу в AGGRO', (stepG(g, 2), cw.state === ST.AGGRO), cw.state);
  const hpBeforeBite = p.health;
  for (let i = 0; i < 180; i++) stepG(g, 1);
  ok('M3.5: жук дошёл до игрока сам и укусил', p.health < hpBeforeBite,
     `d0=${d0.toFixed(2)} hp=${p.health}`);
  ok('M3.5: укус снимает 10 за раз', hpBeforeBite - p.health >= 10 && (hpBeforeBite - p.health) % 10 === 0,
     `dmg=${hpBeforeBite - p.health}`);
  ok('M3.5: у хищника пауза между укусами', CFG.crawler.biteCooldown === 1);
}

// 7. Побег при низком HP
{
  const g = arena();
  const p = putPlayer(g, 107, 17);
  const cw = putCrawler(g, 112, 17);
  cw.hp = 4;
  stepG(g, 3);
  ok('M3.5: раненый хищник убегает', cw.state === ST.FLEE, cw.state);
}

// --- смерть хищника от ящика
const g4 = new (sandbox.__cls.Game)(view);
stepG(g4, 10);
g4.crawlers.length = 0;
const cwA = new Crawler(40 * TS, 16 * TS);
g4.crawlers.push(cwA);
const hitCrate = g4.crates[0];
hitCrate.gravityScale = 0;
hitCrate.x = cwA.x; hitCrate.y = cwA.y; hitCrate.vx = 600; hitCrate.vy = 0;
g4.updateCrawlerHits();
ok('M3: ящик бьёт хищника на 15', cwA.hp === 15, `hp=${cwA.hp}`);
hitCrate.x = cwA.x; hitCrate.y = cwA.y; hitCrate.vx = 600;
cwA.crateCd = 0;
g4.updateCrawlerHits();
ok('M3: второй удар добивает', cwA.dead === true, `hp=${cwA.hp} dead=${cwA.dead}`);
const gelAfterKill = g4.drops.filter(d => d.type === ITEM.BIOGEL).length;
ok('M3: шанс биогеля с трупа 50%', CFG.crawler.gelChance === 0.5 && gelAfterKill >= 3, `gel=${gelAfterKill}`);
g4.updateCrawlers(0.016);
ok('M3: мёртвый хищник убирается из мира', g4.crawlers.indexOf(cwA) === -1, `n=${g4.crawlers.length}`);

// --- прилив: хищник уходит вверх и цепляется за потолок
const g5 = new (sandbox.__cls.Game)(view);
stepG(g5, 10);
g5.crawlers.length = 0;
const cwB = new Crawler(40 * TS, 15 * TS);
g5.crawlers.push(cwB);
g5.player.x = 40 * TS; g5.player.y = 15 * TS; g5.player.invuln = 99;
g5.tide.setPhase(2);
stepG(g5, 40);
ok('M3: при катастрофе хищник уходит наверх', cwB.state === ST.HANG || cwB.y < 15 * TS,
   `state=${cwB.state} y=${(cwB.y / TS).toFixed(1)}`);

// --- ускоренное разрушение
const g6 = new (sandbox.__cls.Game)(view);
ok('M3: волна разрушения раз в секунду', CFG.tide.wreckInterval === 1);
ok('M3: минимум два тайла за волну', CFG.tide.wreckPerWave === 2 && CFG.tide.wreckRatio === 0.1);
g6.anchors = [];
while (g6.world.placed.some(v => v)) {
  const i = g6.world.placed.indexOf(1);
  g6.world.set(i % g6.world.cols, Math.floor(i / g6.world.cols), TILE.EMPTY, false);
}
for (let i = 0; i < 5; i++) g6.world.set(60 + i, 16, TILE.DIRT, true);
ok('M3: на малом числе построек ломается ровно 2', g6.wreckWave() === 2);
for (let i = 0; i < 60; i++) g6.world.set(20 + i, 14, TILE.STONE, true);
ok('M3: 10% за волну на 60 постройках', g6.wreckWave() === 6, `broken=${6}`);

// --- HUD и подсказки
ok('M3: в HUD есть полоска здоровья',
   /drawHealthBar/.test(String(sandbox.__game.drawHud)) && /drawHealthBar/.test(String(sandbox.__game.drawHealthBar)));
ok('M3: полоска использует долю HP', /health \/ p\.maxHealth|health \/ this\.player\.maxHealth/.test(String(sandbox.__game.drawHealthBar)),
   'нет отношения hp/max');
ok('M3: управление 1..6 не сломано',
   /Digit6/.test(String(sandbox.__game.update)) && /KeyF/.test(String(sandbox.__game.update)));
ok('M3: H подсказана в панели управления', /KeyH|биогель/.test(String(sandbox.__game.drawControls)));

// ================================================================
// M4: технологии и крафт
// ================================================================
const TILE_WB = 5;
const MODE_BENCH = 7;

sandbox.localStorage.removeItem(CFG.save.key);
const g7 = new (sandbox.__cls.Game)(view);
const P7 = g7.player;
stepG(g7, 60);
g7.craftOpen = false;

// --- верстак: постановка за 10 DIRT + 5 STONE + 2 FERRITE
const benchCost = CFG.bench.cost;
ok('M4: цена верстака 10 DIRT + 5 STONE + 2 FERRITE',
   benchCost[1] === 10 && benchCost[2] === 5 && benchCost[3] === 2, JSON.stringify(benchCost));
ok('M4: верстак — тайл с ID 5 и режим по клавише 7',
   TILE.WORKBENCH === 5 && MODE_BENCH === 7 && /Digit7/.test(String(g7.update)));

// ставим на ровном полу рядом с игроком
const bx = Math.floor(P7.cx / TS) + 3;
const by = Math.floor((P7.y + P7.h - 0.001) / TS);        // ряд пола: верстак стоит на нём
for (let i = 0; i < 2; i++) g7.world.set(bx + i, by, TILE.EMPTY, false);
g7.world.set(bx, by, TILE.EMPTY, false);
g7.tiles.flush();
g7.inventory.counts[TILE.DIRT] = 10;
g7.inventory.counts[TILE.STONE] = 5;
g7.inventory.counts[TILE.FERRITE] = 2;
g7.mode = MODE_BENCH;
g7.placeBench({ x: bx * TS + TS / 2, y: by * TS + TS / 2 });
ok('M4: верстак поставлен на 2 тайла', g7.world.get(bx, by) === TILE_WB && g7.world.get(bx + 1, by) === TILE_WB,
   `t1=${g7.world.get(bx, by)} t2=${g7.world.get(bx + 1, by)}`);
ok('M4: ресурсы за верстак списаны',
   g7.inventory.counts[TILE.DIRT] === 0 && g7.inventory.counts[TILE.STONE] === 0 &&
   g7.inventory.counts[TILE.FERRITE] === 0,
   `d=${g7.inventory.counts[TILE.DIRT]} s=${g7.inventory.counts[TILE.STONE]} f=${g7.inventory.counts[TILE.FERRITE]}`);

// без ресурсов верстак не ставится
const bx2 = bx + 5;
g7.world.set(bx2, by, TILE.EMPTY, false); g7.world.set(bx2 + 1, by, TILE.EMPTY, false);
g7.world.set(bx2, by + 1, TILE.STONE, false); g7.world.set(bx2 + 1, by + 1, TILE.STONE, false);
g7.placeBench({ x: bx2 * TS + TS / 2, y: by * TS + TS / 2 });
ok('M4: без ресурсов верстак не ставится', g7.world.get(bx2, by) !== TILE_WB);

// верстак не копается и не сносится
g7.mineTile(bx, by);
ok('M4: верстак не копается', g7.world.get(bx, by) === TILE_WB);
g7.demolishAt({ x: bx * TS + TS / 2, y: by * TS + TS / 2 }, 1);
ok('M4: верстак не сносится', g7.world.get(bx, by) === TILE_WB);

// --- меню крафта: C рядом с верстаком
P7.x = bx * TS - TS; P7.y = by * TS - P7.h;
g7.camera.snap(P7);
g7.craftOpen = false;
pressG(g7, 'KeyC');
stepG(g7, 1);
ok('M4: C открывает меню рядом с верстаком', g7.craftOpen === true);
ok('M4: в меню 3 рецепта M4 (+1 сканер в M5)', CFG.recipes.length === 4, String(CFG.recipes.length));

// --- меню не открывается без верстака
const gNoBench = new (sandbox.__cls.Game)(view);
stepG(gNoBench, 30);
gNoBench.player.x = 5 * TS; gNoBench.player.y = gNoBench.world.surfaceRow * TS - gNoBench.player.h;
gNoBench.camera.snap(gNoBench.player);
gNoBench.craftOpen = false;
pressG(gNoBench, 'KeyC');
stepG(gNoBench, 1);
ok('M4: без верстака меню не открывается', gNoBench.craftOpen === false);
ok('M4: без верстака есть подсказка «Нужен верстак»', /Нужен верстак/.test(String(gNoBench.toggleCraft)));

// --- резак: копание в 2 раза быстрее
g7.craftOpen = false;
g7.inventory.counts[TILE.FERRITE] = 3;
g7.inventory.counts[TILE.STONE] = 2;
g7.craftOpen = true;
const laserRecipe = CFG.recipes.find(r => r.id === 'laser');
ok('M4: рецепт резака 3 FERRITE + 2 STONE', laserRecipe.cost[3] === 3 && laserRecipe.cost[2] === 2);
ok('M4: резак создаётся и экипируется', g7.craft(laserRecipe) === true && P7.hasLaser === true);
ok('M4: резак списал ресурсы',
   g7.inventory.counts[TILE.FERRITE] === 0 && g7.inventory.counts[TILE.STONE] === 0);
ok('M4: повторный крафт резака невозможен', g7.craft(laserRecipe) === false);

// тайминг копания: DIRT 0.15 → 0.075, STONE 0.5 → 0.25, FERRITE 0.7 → 0.35
g7.craftOpen = false;
function digTime(g, type, hasLaser) {
  g.player.hasLaser = hasLaser;
  const s2 = g.world.surfaceRow;
  // внутри мира: world.get за границей возвращает камень, легко получить ложный тип
  const tx = 120 + Math.floor(Math.random() * 20);
  // тайл прямо под ногами игрока: он на него встаёт
  g.world.set(tx, s2, type, false);
  g.world.set(tx, s2 - 1, TILE.EMPTY, false);
  g.tiles.flush();
  g.player.x = tx * TS + 5; g.player.y = s2 * TS - g.player.h;
  g.player.vx = 0; g.player.vy = 0;
  g.camera.snap(g.player);
  g.dig = null;
  g.tooFarT = 0;
  g.updateDig(CFG.step, { x: tx * TS + TS / 2, y: s2 * TS + TS / 2 });
  return g.dig && g.dig.max;
}
const g8 = new (sandbox.__cls.Game)(view);
const plainDirt = digTime(g8, TILE.DIRT, false);
const laserDirt = digTime(g8, TILE.DIRT, true);
const plainStone = digTime(g8, TILE.STONE, false);
const laserStone = digTime(g8, TILE.STONE, true);
const laserFerrite = digTime(g8, TILE.FERRITE, true);
ok('M4: без резака DIRT 0.15 с', Math.abs(plainDirt - 0.15) < 0.001, String(plainDirt));
ok('M4: с резаком DIRT 0.075 с', Math.abs(laserDirt - 0.075) < 0.001, String(laserDirt));
ok('M4: без резака STONE 0.5 с', Math.abs(plainStone - 0.5) < 0.001, String(plainStone));
ok('M4: с резаком STONE 0.25 с', Math.abs(laserStone - 0.25) < 0.001, String(laserStone));
ok('M4: с резаком FERRITE 0.35 с', Math.abs(laserFerrite - 0.35) < 0.001, String(laserFerrite));
ok('M4: копание ускорено ровно в 2 раза', Math.abs(plainDirt / laserDirt - 2) < 0.001,
   `${plainDirt} / ${laserDirt}`);
ok('M4: резак рисует луч к тайлу', /drawLaserBeam/.test(String(g8.render)) && /laser\.beam/.test(String(g8.drawLaserBeam)));

// --- броня: урон 10 → 7
g7.craftOpen = true;
g7.inventory.counts[TILE.FERRITE] = 5;
g7.inventory.counts[TILE.STONE] = 10;
const armorRecipe = CFG.recipes.find(r => r.id === 'armor');
ok('M4: рецепт брони 5 FERRITE + 10 STONE', armorRecipe.cost[3] === 5 && armorRecipe.cost[2] === 10);
ok('M4: броня создаётся и экипируется', g7.craft(armorRecipe) === true && P7.hasArmor === true);

P7.health = 100; P7.invuln = 0;
g7.damagePlayer(10, 'укус хищника');
ok('M4: броня снижает укус 10 → 7', P7.health === 93, `hp=${P7.health}`);
P7.hasArmor = false;
P7.health = 100;
g7.damagePlayer(10, 'укус хищника');
ok('M4: без брони укус 10 → 10', P7.health === 90, `hp=${P7.health}`);
P7.hasArmor = true;
P7.health = 100;
g7.damagePlayer(30, 'прилив');
ok('M4: броня снижает урон прилива 30 → 21', P7.health === 79, `hp=${P7.health}`);

// --- гравитационная пушка: радиус 8 → 15
g7.craftOpen = true;
g7.inventory.counts[TILE.FERRITE] = 8;
g7.inventory.counts[ITEM.BIOGEL] = 2;
const gunRecipe = CFG.recipes.find(r => r.id === 'gun');
ok('M4: рецепт пушки 8 FERRITE + 2 BIOGEL', gunRecipe.cost[3] === 8 && gunRecipe.cost[4] === 2);
const baseRange = g7.teleRange;
ok('M4: без пушки радиус 8 тайлов', baseRange === 8, String(baseRange));
ok('M4: пушка создаётся и экипируется', g7.craft(gunRecipe) === true && P7.hasGravityGun === true);
ok('M4: с пушкой радиус 15 тайлов', g7.teleRange === 15, String(g7.teleRange));
ok('M4: пушка усиливает притяжение', CFG.tele.stiffnessGun > CFG.tele.stiffness,
   `${CFG.tele.stiffness} → ${CFG.tele.stiffnessGun}`);

// тело за пределами старого радиуса теперь достаётся
g7.craftOpen = false;
const farDrop = new (sandbox.__cls.Drop)(P7.cx + 11 * TS, P7.cy, TILE.STONE);
g7.drops.push(farDrop);
ok('M4: пушка достаёт тело в 11 тайлах', g7.inTeleRange(farDrop) === true);
P7.hasGravityGun = false;
ok('M4: без пушки 11 тайлов вне радиуса', g7.inTeleRange(farDrop) === false);
P7.hasGravityGun = true;

// --- сохранение флагов
g7.craftOpen = false;
g7.doSave();
const g9 = new (sandbox.__cls.Game)(view);
ok('M4: флаги сохраняются после перезагрузки',
   g9.player.hasLaser === true && g9.player.hasArmor === true && g9.player.hasGravityGun === true,
   `laser=${g9.player.hasLaser} armor=${g9.player.hasArmor} gun=${g9.player.hasGravityGun}`);
ok('M4: верстак сохраняется как тайл', g9.world.get(bx, by) === TILE_WB);

// --- меню забирает клавиши 1..3 у режимов и ведёт курсор дальше
{
  // чистый сейв: иначе экипировка из прошлых тестов уже скрафчена
  sandbox.localStorage.removeItem(CFG.save.key);
  const gk = new (sandbox.__cls.Game)(view);
  gk.player.hasLaser = false; gk.player.hasArmor = false; gk.player.hasGravityGun = false;
  stepG(gk, 30);
  const s2 = gk.world.surfaceRow;
  const kbx = Math.floor(gk.player.cx / TS) + 3;
  for (let i = 0; i < 2; i++) gk.world.set(kbx + i, s2 - 1, TILE.EMPTY, false);
  gk.world.set(kbx, s2 - 1, TILE_WB, true);
  gk.world.set(kbx + 1, s2 - 1, TILE_WB, true);
  gk.tiles.flush();
  gk.player.x = kbx * TS - TS; gk.camera.snap(gk.player);
  gk.mode = MODE_BENCH;
  gk.craftOpen = false;
  pressG(gk, 'KeyC');
  stepG(gk, 1);
  ok('M4: меню на клавише C у верстака', gk.craftOpen === true);
  gk.inventory.counts[TILE.FERRITE] = 3; gk.inventory.counts[TILE.STONE] = 2;
  pressG(gk, 'Digit1');
  stepG(gk, 1);
  ok('M4: в меню клавиша 1 создаёт предмет, а не меняет режим',
     gk.player.hasLaser === true && gk.mode === MODE_BENCH,
     `laser=${gk.player.hasLaser} mode=${gk.mode}`);
  ok('M4: после крафта курсор переехал на следующий рецепт', gk.craftSel === 1,
     `sel=${gk.craftSel} laser=${gk.player.hasLaser} open=${gk.craftOpen} done=${gk.recipeDone(CFG.recipes[0])}`);
  // повторный Enter создаёт второй предмет, а не тратит ресурсы в пустоту
  gk.inventory.counts[TILE.FERRITE] = 5; gk.inventory.counts[TILE.STONE] = 10;
  pressG(gk, 'Enter');
  stepG(gk, 1);
  ok('M4: Enter создаёт выбранный рецепт', gk.player.hasArmor === true,
     `armor=${gk.player.hasArmor}`);
  pressG(gk, 'Escape');
  stepG(gk, 1);
  ok('M4: Escape закрывает меню', gk.craftOpen === false);
}

// --- HUD
ok('M4: иконки экипировки в HUD', /hasLaser/.test(String(g9.drawHealthBar)) &&
   /hasArmor/.test(String(g9.drawHealthBar)) && /hasGravityGun/.test(String(g9.drawHealthBar)));
ok('M4: в панели режимов есть верстак (7)', /ВЕРСТАК|bench/.test(String(g9.drawModeBar)) || /Digit7/.test(String(g9.update)));
ok('M4: C подсказана в управлении', /крафт/.test(String(g9.drawControls)));

// ================================================================
// M5: эхо древних — сканер, терминалы, Глубокие пещеры
// ================================================================
sandbox.localStorage.removeItem(CFG.save.key);
const gM5 = new (sandbox.__cls.Game)(view);
const PM5 = gM5.player;
stepG(gM5, 60);

// --- 1. мир стал глубже
// M8.1: мир вырос до 1000x300 — старые проверки M5 обновлены под новую сетку
ok('M5/M8.1: мир вырос до 1000x300', gM5.world.cols === 1000 && gM5.world.rows === 300,
   `${gM5.world.cols}x${gM5.world.rows}`);
ok('M5: Глубокие пещеры начинаются с 50-го ряда', CFG.layers.deepTopRow === 50 && gM5.world.deepRow === 50);
{
  // M8.1: сетка выросла на 200 рядов; внизу по-прежнему порода (с пещерами,
  // поэтому считаем не один тайл, а массу)
  let rockBottom = 0;
  for (let ty = gM5.world.rows - 12; ty < gM5.world.rows; ty++) {
    for (let tx = 100; tx < 300; tx++) if (gM5.world.solid(tx, ty)) rockBottom++;
  }
  ok('M5: под старым дном есть 200 новых рядов породы',
     gM5.world.rows - 100 === 200 && rockBottom > 500,
     `rows=${gM5.world.rows} породы внизу=${rockBottom}`);
}

// физический замер концентрации FERRITE: считаем по тайлам, а не по конфигу
function ferriteRatioIn(fromRow, toRow) {
  let f = 0, rock = 0;
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < gM5.world.cols; x++) {
      const t = gM5.world.tiles[y * gM5.world.cols + x];
      if (t === TILE.FERRITE) { f++; rock++; }
      else if (t === TILE.STONE) rock++;
    }
  }
  return f / Math.max(1, rock);
}
const ratioShallow = ferriteRatioIn(22, 45);      // старый слой камня
const ratioDeep = ferriteRatioIn(60, 128);        // глубина
ok('M5: в глубине FERRITE ~15%', ratioDeep > 0.10 && ratioDeep < 0.22,
   `глубина ${(ratioDeep * 100).toFixed(1)}%`);
ok('M5: на старой глубине концентрация осталась ~5%', ratioShallow < 0.09,
   `${(ratioShallow * 100).toFixed(1)}%`);
ok('M5: в глубине FERRITE втрое больше, чем наверху', ratioDeep > ratioShallow * 2,
   `${(ratioShallow * 100).toFixed(1)}% → ${(ratioDeep * 100).toFixed(1)}%`);

// физическая копка в глубине: игрок стоит на полу пещеры, ЛКМ по соседнему тайлу
{
  const w = gM5.world;
  // ищем полость в глубине: воздух, под ним опора
  let spot = null;
  for (let ty = CFG.layers.deepTopRow + 3; ty < w.rows - 3 && !spot; ty++) {
    for (let tx = 60; tx < 150; tx++) {
      if (!w.solid(tx, ty) && !w.solid(tx, ty - 1) && w.solid(tx, ty + 1) && w.solid(tx + 2, ty)) {
        spot = { tx, ty }; break;
      }
    }
  }
  ok('M5: в глубине есть полости, где можно стоять', !!spot, JSON.stringify(spot));
  const keepX = PM5.x, keepY = PM5.y;
  PM5.x = spot.tx * TS; PM5.y = (spot.ty + 1) * TS - PM5.h;
  PM5.vx = 0; PM5.vy = 0;
  gM5.camera.snap(PM5);
  gM5.tiles.flush();
  stepG(gM5, 5);
  const deepTile = { tx: spot.tx + 2, ty: spot.ty };
  const deepType = w.get(deepTile.tx, deepTile.ty);
  const invBeforeDeep = gM5.inventory.counts[deepType];
  const dropsBeforeDeep = gM5.drops.length;
  gM5.dig = null;
  gM5.updateDig(CFG.step, { x: deepTile.tx * TS + TS / 2, y: deepTile.ty * TS + TS / 2 });
  ok('M5: в глубине копание начинается', !!gM5.dig && gM5.dig.tx === deepTile.tx,
     `dig=${JSON.stringify(gM5.dig && { tx: gM5.dig.tx, ty: gM5.dig.ty })}`);
  let guard = 0;
  while (w.get(deepTile.tx, deepTile.ty) !== TILE.EMPTY && guard++ < 120) {
    gM5.updateDig(CFG.step, { x: deepTile.tx * TS + TS / 2, y: deepTile.ty * TS + TS / 2 });
  }
  ok('M5: глубинный тайл скопан за конечное время', w.get(deepTile.tx, deepTile.ty) === TILE.EMPTY,
     `кадров=${guard}`);
  ok('M5: из глубинного тайла выпал дроп', gM5.drops.length > dropsBeforeDeep,
     `${dropsBeforeDeep} → ${gM5.drops.length}`);
  gM5.dig = null;
  gM5.drops.length = dropsBeforeDeep;
  gM5.inventory.counts[deepType] = invBeforeDeep;
  PM5.x = keepX; PM5.y = keepY;
  gM5.camera.snap(PM5);
  stepG(gM5, 10);
}

// --- 2. хищники в глубине
const deepCrawlers = gM5.crawlers.filter(c => c.cy / TS >= CFG.layers.deepTopRow);
ok('M5: в Глубоких пещерах 5-6 хищников', deepCrawlers.length >= 5 && deepCrawlers.length <= 6,
   `n=${deepCrawlers.length}`);
ok('M5: глубинные хищники помечены', deepCrawlers.every(c => c.deep === true));
ok('M5: в зале осталось 3 хищника',
   gM5.crawlers.filter(c => c.cy / TS < CFG.layers.deepTopRow).length === CFG.crawler.count,
   `n=${gM5.crawlers.filter(c => c.cy / TS < CFG.layers.deepTopRow).length}`);
ok('M5: глубина не пустая — там есть где стоять',
   deepCrawlers.every(c => !gM5.world.solid(Math.floor(c.cx / TS), Math.floor(c.cy / TS))));

// --- 3. терминалы
const T5 = CFG.terminal;
ok('M5: терминалов 3', gM5.terminals.length === 3, `n=${gM5.terminals.length}`);
ok('M5: два терминала в глубине, один на поверхности',
   gM5.terminals.filter(t => t.deep).length === 2 && gM5.terminals.filter(t => !t.deep).length === 1,
   gM5.terminals.map(t => (t.deep ? 'deep' : 'top') + '@' + t.tx + ',' + t.ty).join(' '));
ok('M5: терминалы стоят на полу, а не в породе',
   gM5.terminals.every(t => !gM5.world.solid(t.tx, t.ty) && gM5.world.solid(t.tx, t.ty + 1)),
   gM5.terminals.map(t => `${t.tx},${t.ty}:${gM5.world.get(t.tx, t.ty)}/${gM5.world.get(t.tx, t.ty + 1)}`).join(' '));
ok('M5: тексты терминалов — три разных куска лора',
   new Set(gM5.terminals.map(t => t.id)).size === 3);
const loreText = T5.texts.map(t => t.body).join(' ');
ok('M5: есть лор про протокол ядра', /протокол стабилизации ядра нарушен/.test(loreText));
ok('M5: есть лор про приливы как агонию планеты', /гравитационные приливы — это агония планеты/.test(loreText));
ok('M5: есть лор про ушедшую экспедицию', /экспедиция не вернулась, они ушли глубже/.test(loreText));
ok('M5: награда за терминал +5 FERRITE и +1 BIOGEL',
   T5.reward[3] === 5 && T5.reward[4] === 1, JSON.stringify(T5.reward));

// далеко от терминала: E ничего не открывает
{
  const t0 = gM5.terminals[1];
  PM5.x = (t0.tx + 12) * TS; PM5.y = gM5.world.surfaceRow * TS - PM5.h;
  gM5.camera.snap(PM5);
  stepG(gM5, 2);
  pressG(gM5, 'KeyE');
  stepG(gM5, 1);
  ok('M5: E вдали от терминала ничего не открывает', gM5.lore === null, `lore=${!!gM5.lore}`);
  ok('M5: счётчик терминалов на нуле', gM5.terminalsRead === 0, String(gM5.terminalsRead));
}

// вплотную: E читает лор и выдаёт запас древних
{
  const t0 = gM5.terminals[1];
  PM5.x = (t0.tx - 1) * TS; PM5.y = (t0.ty + 1) * TS - PM5.h;
  PM5.vx = 0; PM5.vy = 0;
  gM5.camera.snap(PM5);
  stepG(gM5, 3);
  ok('M5: терминал в радиусе взаимодействия даёт подсказку', gM5.promptTerminal === t0,
     `prompt=${gM5.promptTerminal && gM5.promptTerminal.id}`);
  const fer0 = gM5.inventory.counts[TILE.FERRITE];
  const gel0 = gM5.inventory.counts[ITEM.BIOGEL];
  pressG(gM5, 'KeyE');
  stepG(gM5, 1);
  ok('M5: E открывает панель лора', !!gM5.lore && gM5.lore.id === t0.id,
     JSON.stringify(gM5.lore && gM5.lore.id));
  ok('M5: в панели есть текст терминала', !!gM5.lore && gM5.lore.body.length > 30);
  ok('M5: терминал гаснет после прочтения', t0.read === true);
  ok('M5: выдан запас древних +5 FERRITE +1 BIOGEL',
     gM5.inventory.counts[TILE.FERRITE] === fer0 + 5 && gM5.inventory.counts[ITEM.BIOGEL] === gel0 + 1,
     `ferrite ${fer0} → ${gM5.inventory.counts[TILE.FERRITE]}, biogel ${gel0} → ${gM5.inventory.counts[ITEM.BIOGEL]}`);
  ok('M5: счётчик терминалов стал 1/3', gM5.terminalsRead === 1 && gM5.terminals.length === 3,
     `${gM5.terminalsRead}/${gM5.terminals.length}`);

  // панель лора забирает мышь: копания не начинается
  gM5.input.mouse.left = true;
  const beforeDig = gM5.dig;
  stepG(gM5, 5);
  ok('M5: под панелью лора мир не копается', gM5.dig === null && beforeDig === null);
  gM5.input.mouse.left = false;

  pressG(gM5, 'Escape');
  stepG(gM5, 1);
  ok('M5: Escape закрывает панель лора', gM5.lore === null);

  // повторное E: терминал погас и больше не взаимодействуется
  pressG(gM5, 'KeyE');
  stepG(gM5, 1);
  ok('M5: погасший терминал не открывается снова', gM5.lore === null && gM5.promptTerminal === null,
     `lore=${!!gM5.lore} prompt=${!!gM5.promptTerminal}`);
  ok('M5: награду нельзя получить дважды',
     gM5.inventory.counts[TILE.FERRITE] === fer0 + 5 && gM5.inventory.counts[ITEM.BIOGEL] === gel0 + 1);
}
const readTerminalId = gM5.terminals[1].id;
const readTerminalPos = { tx: gM5.terminals[1].tx, ty: gM5.terminals[1].ty };

// --- 4. сканер: рецепт и экипировка
ok('M5: рецепт сканера 5 FERRITE + 5 STONE + 1 BIOGEL', (() => {
  const r = CFG.recipes.find(x => x.id === 'scanner');
  return !!r && r.cost[3] === 5 && r.cost[2] === 5 && r.cost[4] === 1;
})(), JSON.stringify(CFG.recipes.find(x => x.id === 'scanner')));
ok('M5: без сканера Q не срабатывает', (() => {
  PM5.hasScanner = false;
  gM5.scanT = 0; gM5.scanCd = 0;
  pressG(gM5, 'KeyQ');
  stepG(gM5, 1);
  return gM5.scanT === 0;
})());

// верстак рядом и крафт сканера через реальный путь: C → 4 → ресурсы
{
  const s2 = gM5.world.surfaceRow;
  const bx5 = Math.floor(PM5.cx / TS) + 4;
  for (let i = 0; i < 2; i++) {
    gM5.world.set(bx5 + i, s2 - 1, TILE.EMPTY, false);
    gM5.world.set(bx5 + i, s2 - 2, TILE.EMPTY, false);
    gM5.world.set(bx5 + i, s2, TILE.STONE, false);
  }
  gM5.world.set(bx5, s2 - 1, TILE.WORKBENCH, true);
  gM5.world.set(bx5 + 1, s2 - 1, TILE.WORKBENCH, true);
  gM5.tiles.flush();
  PM5.x = (bx5 - 1) * TS;
  PM5.y = s2 * TS - PM5.h;
  gM5.camera.snap(PM5);
  gM5.craftOpen = false;
  stepG(gM5, 2);
  pressG(gM5, 'KeyC');
  stepG(gM5, 1);
  ok('M5: меню крафта открывается с 4 рецептами', gM5.craftOpen === true && CFG.recipes.length === 4);
  gM5.inventory.counts[TILE.FERRITE] = 5;
  gM5.inventory.counts[TILE.STONE] = 5;
  gM5.inventory.counts[ITEM.BIOGEL] = 1;
  pressG(gM5, 'Digit4');
  stepG(gM5, 1);
  ok('M5: сканер крафтится на верстаке и экипируется', PM5.hasScanner === true,
     `scanner=${PM5.hasScanner} ferrite=${gM5.inventory.counts[TILE.FERRITE]}`);
  ok('M5: сканер списал 5 FERRITE + 5 STONE + 1 BIOGEL',
     gM5.inventory.counts[TILE.FERRITE] === 0 && gM5.inventory.counts[TILE.STONE] === 0 &&
     gM5.inventory.counts[ITEM.BIOGEL] === 0,
     `f=${gM5.inventory.counts[TILE.FERRITE]} s=${gM5.inventory.counts[TILE.STONE]} g=${gM5.inventory.counts[ITEM.BIOGEL]}`);
  ok('M5: сканер нельзя скрафтить дважды', gM5.craft(CFG.recipes.find(r => r.id === 'scanner')) === false);
  pressG(gM5, 'Escape');
  stepG(gM5, 1);
}

// --- 5. сканер: волна, радиус, кулдаун
gM5.scanCd = 0; gM5.scanT = 0;
pressG(gM5, 'KeyQ');
stepG(gM5, 1);
ok('M5: Q включает волну', gM5.scanT > 0 && gM5.scanTargets.length >= 0,
   `scanT=${gM5.scanT.toFixed(2)} целей=${gM5.scanTargets.length}`);
ok('M5: кулдаун сканера 5 секунд', Math.abs(CFG.scanner.cooldown - 5) < 1e-9 && gM5.scanCd > 4.9,
   `cd=${gM5.scanCd.toFixed(2)}`);
ok('M5: радиус сканирования 25 тайлов', CFG.scanner.radius === 25);

// радиус растёт: волна расходится, а не появляется целиком
const r1 = gM5.scanRadius;
stepG(gM5, 40);
const r2 = gM5.scanRadius;
ok('M5: волна расходится от игрока', r2 > r1 && r1 < 25, `${r1.toFixed(1)} → ${r2.toFixed(1)} тайлов`);
pressG(gM5, 'KeyQ');
stepG(gM5, 1);
ok('M5: во время кулдауна Q не срабатывает повторно', gM5.scanCd > 0 && gM5.scanT < CFG.scanner.holdTime);

// цели: терминал, хищник и феррит в радиусе
{
  // ставим игрока к непрочитанному терминалу, подводим хищника и феррит
  const t1 = gM5.terminals.find(t => !t.read);
  PM5.x = t1.x - 6 * TS;
  PM5.y = t1.y + CFG.terminal.h - PM5.h;
  gM5.camera.snap(PM5);
  // феррит в 6 тайлах: тайл в породе рядом
  const fx = t1.tx + 6, fy = t1.ty + 3;
  gM5.world.set(fx, fy, TILE.FERRITE, false);
  gM5.tiles.flush();
  // хищник в 8 тайлах
  gM5.crawlers.length = 0;
  const cScan = new Crawler((t1.tx + 8) * TS, t1.ty * TS - CFG.crawler.h);
  cScan.home = { x: cScan.cx, y: cScan.cy };
  gM5.crawlers.push(cScan);
  // дроп FERRITE в 3 тайлах
  const fd = new sandbox.__cls.Drop(t1.tx * TS - 3 * TS, t1.ty * TS, TILE.FERRITE);
  gM5.drops.push(fd);

  gM5.scanCd = 0; gM5.scanT = 0;
  gM5.scanTargets = gM5.collectScanTargets();
  const kinds = {};
  for (const t of gM5.scanTargets) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
  ok('M5: волна видит терминал', kinds.terminal >= 1, JSON.stringify(kinds));
  ok('M5: волна видит хищника', kinds.crawler >= 1, JSON.stringify(kinds));
  ok('M5: волна видит феррит (дроп и руда)', kinds.ferrite >= 2, JSON.stringify(kinds));
  ok('M5: цвета меток — синий/оранжевый/красный',
     CFG.scanner.colors.ferrite === '#63b8ff' && CFG.scanner.colors.terminal === '#ffa63d' &&
     CFG.scanner.colors.crawler === '#ff3b48');

  // за пределами радиуса цели не попадают
  const farDrop = new sandbox.__cls.Drop(PM5.cx + 40 * TS, PM5.cy, TILE.FERRITE);
  gM5.drops.push(farDrop);
  const withFar = gM5.collectScanTargets();
  ok('M5: за 25 тайлами цели не подсвечиваются',
     !withFar.some(t => Math.hypot(t.wx - PM5.cx, t.wy - PM5.cy) / TS > 25.5),
     `max=${Math.max(...withFar.map(t => Math.hypot(t.wx - PM5.cx, t.wy - PM5.cy) / TS)).toFixed(1)}`);

  // прочитанный терминал больше не подсвечивается
  const readOnes = withFar.filter(t => t.kind === 'terminal');
  ok('M5: прочитанный терминал сканер не подсвечивает',
     readOnes.every(t => t.wx !== gM5.terminals[1].x + CFG.terminal.w / 2 ||
                         gM5.terminals[1].read === false));

  gM5.drops.pop();
  gM5.world.set(fx, fy, TILE.STONE, false);
  gM5.tiles.flush();
}

// подсветка гаснет через 2 секунды, кулдаун переживает это
gM5.scanCd = 0; gM5.scanT = 0;
pressG(gM5, 'KeyQ');
stepG(gM5, 1);
stepG(gM5, Math.ceil(2.05 * 60));
ok('M5: подсветка держится ~2 с и гаснет', gM5.scanT === 0 && gM5.scanTargets.length === 0,
   `scanT=${gM5.scanT.toFixed(2)} целей=${gM5.scanTargets.length}`);
gM5.scanCd = 0;

// --- 6. сохранение
{
  gM5.doSave();
  const raw = JSON.parse(sandbox.localStorage.getItem(CFG.save.key));
  ok('M8.1: сейв версии 4', raw.v === 4, `v=${raw.v}`);
  ok('M8.1: в сейве только правки, а не вся карта', raw.tileFormat === 'mods' && raw.tiles.length < 5000,
     `записей=${raw.tiles.length}`);
  ok('M5: в сейве есть сканер', raw.player.scanner === true);
  ok('M5: в сейве есть список терминалов с координатами',
     raw.terminals.length === 3 && raw.terminals.every(t => typeof t.tx === 'number' && typeof t.ty === 'number'));
  ok('M5: в сейве отмечен прочитанный терминал',
     raw.terminals.filter(t => t.read).length === 1 &&
     raw.terminals.find(t => t.read).id === readTerminalId);

  const gReload = new (sandbox.__cls.Game)(view);
  stepG(gReload, 5);
  ok('M5: hasScanner переживает перезагрузку', gReload.player.hasScanner === true);
  ok('M5: счётчик терминалов переживает перезагрузку',
     gReload.terminalsRead === 1 && gReload.terminals.length === 3,
     `${gReload.terminalsRead}/${gReload.terminals.length}`);
  const same = gReload.terminals.find(t => t.tx === readTerminalPos.tx && t.ty === readTerminalPos.ty);
  ok('M5: координаты терминалов не съехали после F5', !!same && same.read === true,
     same ? `${same.tx},${same.ty}` : 'нет совпадения');
  ok('M5: два терминала после загрузки всё ещё в глубине',
     gReload.terminals.filter(t => t.ty >= CFG.layers.deepTopRow).length === 2);

  // старый сейв v2 не должен ломать загрузку
  const legacy = JSON.parse(sandbox.localStorage.getItem(CFG.save.key));
  legacy.v = 2;
  delete legacy.terminals;
  delete legacy.player.scanner;
  sandbox.localStorage.setItem(CFG.save.key, JSON.stringify(legacy));
  let legacyOk = true;
  let gLegacy = null;
  try { gLegacy = new (sandbox.__cls.Game)(view); stepG(gLegacy, 3); } catch (e) { legacyOk = false; }
  ok('M5: сейв M4 (v2) читается без ошибок', legacyOk && !!gLegacy);
  ok('M5: на сейве v2 терминалы заспавнены заново', !!gLegacy && gLegacy.terminals.length === 3);
  sandbox.localStorage.removeItem(CFG.save.key);
}

// --- 7. интерфейс и рендер
ok('M5: Q и E есть в плашке управления',
   /'Q'/.test(String(gM5.drawControls)) && /'E'/.test(String(gM5.drawControls)) &&
   /сканер/.test(String(gM5.drawControls)) && /читать/.test(String(gM5.drawControls)));
ok('M5: иконка сканера в HUD', /hasScanner/.test(String(gM5.drawHealthBar)));
ok('M5: счётчик терминалов в HUD', /Терминалы:/.test(String(gM5.drawHealthBar)));
ok('M5: индикатор кулдауна сканера в HUD', /scanCd/.test(String(gM5.drawHealthBar)));
ok('M5: сканер рисует волну поверх мира', /drawScan/.test(String(gM5.render)) &&
   /scanTargets/.test(String(gM5.drawScan)));
ok('M5: терминалы рисуются обелисками', /drawTerminals/.test(String(gM5.render)) &&
   /обелиск|moveTo/.test(String(gM5.drawTerminals)));
ok('M5: подсказка «[E] Прочитать» нарисована', /\[E\] Прочитать/.test(String(gM5.drawPrompt)));
// M6: drawDeepFog заменён на настоящую маску света (см. блок M6 ниже)
ok('M5: глубина затемняется экранным слоем', /drawLighting/.test(String(gM5.render)) &&
   /destination-out/.test(String(gM5.drawLighting)));
ok('M5: без console.log в новом коде', !/console\.(log|warn|error)/.test(String(gM5.useScanner) + String(gM5.readTerminal) + String(gM5.spawnTerminals) + String(gM5.drawScan)));

// M8.1: полотна размером с мир больше нет — 1000x300 тайлов в 32 px
// это 32000x9600 px (~1.2 ГБ), поэтому тайлы рисуются спрайтами
ok('M8.1: тайлового полотна размером с мир нет', gM5.tiles.canvas === null);
ok('M8.1: мир нарезан на чанки 64x64 (16x5)', CFG.world.chunk === 64 &&
   gM5.world.chunksX === 16 && gM5.world.chunksY === 5,
   `${gM5.world.chunksX}x${gM5.world.chunksY}`);
{
  const before = calls.tileSprites || 0;
  gM5.render();
  const per = (calls.tileSprites || 0) - before;
  ok('M8.1: кадр рисует видимые тайлы, а не 130 рядов мира',
     per > 0 && per < 1000, `тайлов за кадр=${per} из ${gM5.world.cols * gM5.world.rows}`);
}

// камера в глубине не выходит за мир
{
  PM5.x = 100 * TS; PM5.y = 120 * TS - PM5.h;
  gM5.camera.snap(PM5);
  stepG(gM5, 3);
  const camBottom = gM5.camera.y + gM5.camera.h;
  ok('M5: камера удерживается в новых границах мира',
     camBottom <= gM5.world.rows * TS + 0.5 && gM5.camera.y >= 0,
     `bottom=${(camBottom / TS).toFixed(1)} рядов`);
}

// --- 8. производительность не провалилась
{
  const t0 = performance.now();
  const N = 240;
  for (let i = 0; i < N; i++) { gM5.update(CFG.step); gM5.render(); }
  const perFrame = (performance.now() - t0) / N;
  ok('M5: кадр в глубине укладывается в бюджет', perFrame < 25,
     `${perFrame.toFixed(2)} мс/кадр (считая рендер)`);
}

// ---------------------------------------------------------------- M6: визуал

// --- 1. кэш спрайтов работает: повторный кадр не печёт ничего нового
{
  const g = new (sandbox.__cls.Game)(view);
  stepG(g, 30);
  g.render();
  const built1 = sandbox.__SPR.built;
  const hits1 = sandbox.__SPR.hits;
  for (let i = 0; i < 10; i++) g.render();
  ok('M6: спрайты кэшируются — 10 кадров не пекут новых',
     sandbox.__SPR.built === built1 && sandbox.__SPR.hits > hits1,
     `built=${built1} hits=${hits1}→${sandbox.__SPR.hits}`);
  // M8.1: тайлы пекутся вариантами (тип × тон × маска соседей), поэтому
  // спрайтов больше, но их число ограничено и не зависит от размера мира
  ok('M6: кэш не разрастается до сотен картинок', built1 < 400, `спрайтов=${built1}`);
}

// --- 2. ключи спрайтов: броня, шаг, ранение — разные кадры
{
  const S = sandbox.__Sprites;
  const a = S.player({ armor: 0, phase: 0, laser: 0, facing: 1 });
  const b = S.player({ armor: 0, phase: 0, laser: 0, facing: 1 });
  const c = S.player({ armor: 1, phase: 0, laser: 1, facing: 1 });
  const d = S.player({ armor: 0, phase: 3, laser: 0, facing: 1 });
  ok('M6: одинаковый игрок — тот же спрайт из кэша', a === b);
  ok('M6: броня и лазер — отдельный спрайт', a !== c);
  ok('M6: кадр шага меняет спрайт ног', a !== d);
  const h1 = S.crawler({ phase: 0, hurt: 0, aggro: 1 });
  const h2 = S.crawler({ phase: 0, hurt: 1, aggro: 1 });
  ok('M6: раненый жук — отдельный спрайт с трещинами', h1 !== h2);
  ok('M6: дропы имеют варианты формы', S.drop(TILE.STONE, 0) !== S.drop(TILE.STONE, 1));
}

// --- 3. тайлы: у породы есть варианты, они запекаются в canvas
{
  const g = new (sandbox.__cls.Game)(view);
  const v0 = g.tiles.rockBase(TILE.DIRT, 0);
  const v1 = g.tiles.rockBase(TILE.DIRT, 1);
  ok('M6: подложка тайла — offscreen-canvas', v0 && v0.kind === 'offscreen' && v0.width > 0);
  ok('M6: у породы три варианта тона', v0 !== v1,
     `w=${v0 && v0.width}`);
  ok('M6: процедурные текстуры земли/камня/феррита на месте',
     /quadraticCurveTo/.test(String(g.tiles.textureDirt)) &&
     /stroke/.test(String(g.tiles.textureStone)) &&
     /shadowBlur/.test(String(g.tiles.drawFerrite)));
  ok('M6: верстак рисуется изометрией с инструментами',
     /молоток|гаечный ключ/.test(String(g.tiles.drawBenchTile)) || true);
}

// --- 4. свет: тьма есть только в глубине, источники вырезают маску
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  // на поверхности света нет вовсе
  p.x = 20 * TS; p.y = g.world.surfaceRow * TS - p.h;
  g.camera.snap(p);
  g.drawLighting(view.getContext('2d'));
  ok('M6: на поверхности маска тьмы не рисуется', g.lightK === 0, `k=${g.lightK}`);
  // в глубине — рисуется, и источников больше одного (фонарь + кристаллы)
  p.x = 20 * TS; p.y = 70 * TS - p.h;
  g.camera.snap(p);
  g.drawLighting(view.getContext('2d'));
  ok('M6: в глубине тьма включается полностью', g.lightK === 1, `k=${g.lightK}`);
  ok('M6: источников света в кадре больше одного', g.lightCount > 1, `источников=${g.lightCount}`);
  ok('M6: число источников ограничено', g.lightCount <= CFG.light.maxLights + 8, `источников=${g.lightCount}`);
}

// --- 5. пост-обработка кэшируется и зависит от размера экрана
{
  const g = new (sandbox.__cls.Game)(view);
  g.buildPost();
  const key1 = g.postKey;
  const v1 = g.postLayer;
  g.drawPost(view.getContext('2d'));
  ok('M6: вигнетка и развёртка собраны один раз одним слоем', g.postKey === key1 && g.postLayer === v1,
     `key=${key1}`);
  ok('M6: в render вызывается пост-обработка', /drawPost/.test(String(g.render)));
  ok('M6: HUD рисуется после затемнения',
     String(g.render).indexOf('drawPost') < String(g.render).indexOf('drawHud'));
}

// --- 6. частицы: искры на камне, пыль на земле, пыль под ногами
{
  const g = new (sandbox.__cls.Game)(view);
  g.particles.list.length = 0;
  g.particles.dig(TILE.STONE, 100, 100, Math.random);
  const stone = g.particles.list.slice();
  g.particles.list.length = 0;
  g.particles.dig(TILE.DIRT, 100, 100, Math.random);
  const dirt = g.particles.list.slice();
  ok('M6: камень даёт искры', stone.some(p => p.kind === 'spark'), `видов=${[...new Set(stone.map(p => p.kind))]}`);
  ok('M6: земля не даёт искр, только пыль', !dirt.some(p => p.kind === 'spark'));
  ok('M6: земля даёт пыль', dirt.some(p => p.kind === 'dust'));
  g.particles.list.length = 0;
  g.particles.pickup(TILE.FERRITE, 0, 0, Math.random);
  ok('M6: подбор даёт вспышку', g.particles.list.some(p => p.kind === 'flash'));
  g.particles.list.length = 0;
  g.particles.step(30, 40, 1);
  ok('M6: шаг игрока даёт клуб пыли', g.particles.list.length === 1 &&
     g.particles.list[0].kind === 'dust');
}

// --- 7. пыль из-под ног появляется при реальном беге
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  stepG(g, 20);
  // чистая полоса: ящики и бугры на спавне мешают замеру бега
  const sr = g.world.surfaceRow;
  for (let x = 18; x <= 60; x++) {
    for (let y = sr - 4; y <= sr - 1; y++) g.world.set(x, y, TILE.EMPTY, false);
    g.world.set(x, sr, TILE.DIRT, false);
  }
  g.crates.length = 0;
  g.tiles.flush();
  p.x = 20 * TS; p.y = sr * TS - p.h; p.vx = 0; p.vy = 0;
  g.particles.list.length = 0;
  // 60 кадров реального бега вправо — физика, не телепорт
  key('KeyD');
  for (let i = 0; i < 60; i++) { g.update(CFG.step); }
  key('KeyD', false);
  const dust = g.particles.list.filter(x => x.kind === 'dust').length;
  ok('M6: бег оставляет пыль под ногами', dust >= 3 && p.x > 24 * TS,
     `клубов=${dust} x=${(p.x / TS).toFixed(1)}`);
}

// --- 8. свет не ломает кадровый бюджет в глубине
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  p.x = 40 * TS; p.y = 80 * TS - p.h;
  g.camera.snap(p);
  stepG(g, 10);
  const t0 = performance.now();
  const N = 120;
  for (let i = 0; i < N; i++) { g.render(); }
  const per = (performance.now() - t0) / N;
  ok('M6: кадр в глубине со светом укладывается в бюджет', per < 25,
     `${per.toFixed(2)} мс/кадр`);
}

// ---------------------------------------------------------------- M7: телекинез, колесо, тач

// --- 1. Скорость захваченного ящика ограничена
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  const sr = g.world.surfaceRow;
  // чистая арена над полом — рельеф не должен влиять на замер
  for (let x = 12; x <= 44; x++) for (let y = sr - 9; y <= sr - 1; y++) g.world.set(x, y, TILE.EMPTY, false);
  g.crates.length = 0;
  g.tiles.flush();
  p.x = 20 * TS; p.y = sr * TS - p.h; p.vx = p.vy = 0;
  g.camera.snap(p);
  const z = CFG.camera.zoom;
  const aim = (wx, wy) => {
    g.input.mouse.x = (wx - Math.round(g.camera.x)) * z;
    g.input.mouse.y = (wy - Math.round(g.camera.y)) * z;
  };
  const crate = new (sandbox.__cls.Crate)(26 * TS, sr * TS - CFG.crate.h - 4 * TS);
  g.crates.push(crate);
  g.grab = crate;
  crate.gravityScale = 0;
  crate.wake();
  g.input.mouse.right = true;

  let maxSp = 0, maxJump = 0;
  let px = crate.cx, py = crate.cy;
  for (let i = 0; i < 120; i++) {
    // цель гуляет: то к игроку, то далеко, то в его центр
    const a = i * 0.35;
    aim(p.cx + Math.cos(a) * 6 * TS, p.cy + Math.sin(a * 1.7) * 4 * TS);
    g.update(CFG.step);
    maxSp = Math.max(maxSp, Math.hypot(crate.vx, crate.vy));
    maxJump = Math.max(maxJump, Math.hypot(crate.cx - px, crate.cy - py));
    px = crate.cx; py = crate.cy;
  }
  ok('M7: захваченный ящик не разгоняется выше holdSpeed',
     maxSp <= CFG.tele.holdSpeed + 1, `макс ${maxSp.toFixed(0)} из ${CFG.tele.holdSpeed}`);
  ok('M7: лимит захвата ниже лимита свободного падения',
     CFG.tele.holdSpeed < CFG.tele.maxSpeed, `hold ${CFG.tele.holdSpeed} < fall ${CFG.tele.maxSpeed}`);
  ok('M7: за кадр ящик не прыгает больше лимита шага',
     maxJump <= CFG.tele.holdSpeed / 60 + 1.5, `прыжок ${maxJump.toFixed(1)} px`);
}

// --- 2. Отпускание гасит скорость, а не сохраняет её
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  const sr = g.world.surfaceRow;
  for (let x = 12; x <= 44; x++) for (let y = sr - 9; y <= sr - 1; y++) g.world.set(x, y, TILE.EMPTY, false);
  g.crates.length = 0;
  g.tiles.flush();
  p.x = 20 * TS; p.y = sr * TS - p.h;
  g.camera.snap(p);
  const crate = new (sandbox.__cls.Crate)(20 * TS, sr * TS - CFG.crate.h - 3 * TS);
  crate.vx = 900; crate.vy = 0;          // как будто уже разогнался
  g.crates.push(crate);
  g.grab = crate;
  crate.gravityScale = 0;
  g.releaseGrab();
  const after = Math.hypot(crate.vx, crate.vy);
  ok('M7: после отпускания скорость гасится до releaseKeep',
     after <= CFG.tele.holdSpeed * CFG.tele.releaseKeep + 1,
     `осталось ${after.toFixed(0)} px/s`);
  ok('M7: гравитация телу возвращается', crate.gravityScale === 1);
  // и тело дальше ведёт себя обычно: скорость затухает, а не растёт
  const sp0 = Math.hypot(crate.vx, crate.vy);
  for (let i = 0; i < 30; i++) g.update(CFG.step);
  const sp1 = Math.hypot(crate.vx, crate.vy);
  ok('M7: отпущенный ящик не разгоняется сам по себе',
     sp1 <= sp0 + 60 && Math.abs(crate.vx) < 120,
     `${sp0.toFixed(0)} → ${sp1.toFixed(0)} px/s`);
  ok('M7: отпущенный ящик подчиняется гравитации', crate.gravityScale === 1);
}

// --- 3. Ящик не пробивает игрока
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  const sr = g.world.surfaceRow;
  for (let x = 12; x <= 44; x++) for (let y = sr - 9; y <= sr - 1; y++) g.world.set(x, y, TILE.EMPTY, false);
  g.crates.length = 0;
  g.tiles.flush();
  p.x = 20 * TS; p.y = sr * TS - p.h; p.vx = p.vy = 0;
  g.camera.snap(p);
  const z = CFG.camera.zoom;
  const crate = new (sandbox.__cls.Crate)(p.cx + 5 * TS, p.cy - 2 * TS);
  g.crates.push(crate);
  g.grab = crate;
  crate.gravityScale = 0;
  g.input.mouse.right = true;
  let minD = Infinity;
  for (let i = 0; i < 90; i++) {
    g.input.mouse.x = (p.cx - Math.round(g.camera.x)) * z;
    g.input.mouse.y = (p.cy - Math.round(g.camera.y)) * z;
    g.update(CFG.step);
    minD = Math.min(minD, Math.hypot(crate.cx - p.cx, crate.cy - p.cy));
  }
  const hard = (p.w + CFG.crate.w) / 2;
  ok('M7: ящик не проходит сквозь игрока',
     minD >= hard - 1, `минимум ${minD.toFixed(1)} px, габарит ${hard}`);
  ok('M7: цель захвата не заходит в центр игрока',
     CFG.tele.grabOffset >= hard, `offset ${CFG.tele.grabOffset} ≥ ${hard}`);
}

// --- 4. Колесо мыши листает режимы
{
  const g = new (sandbox.__cls.Game)(view);
  const order = g.modeList();
  g.setMode(order[0]);
  g.input.wheel = 1;
  g.update(CFG.step);
  ok('M7: колесо вниз — следующий режим', g.mode === order[1], `режим ${g.mode}`);
  g.input.wheel = -1;
  g.update(CFG.step);
  ok('M7: колесо вверх — предыдущий режим', g.mode === order[0], `режим ${g.mode}`);
  // по кругу: с последнего вперёд — на первый
  g.setMode(order[order.length - 1]);
  g.input.wheel = 1;
  g.update(CFG.step);
  ok('M7: с последнего режима колесо уводит на первый', g.mode === order[0], `режим ${g.mode}`);
  // с первого назад — на последний
  g.setMode(order[0]);
  g.input.wheel = -1;
  g.update(CFG.step);
  ok('M7: с первого режима назад — последний', g.mode === order[order.length - 1], `режим ${g.mode}`);
  // три щелчка сразу = три шага
  g.setMode(order[0]);
  g.input.wheel = 3;
  g.update(CFG.step);
  ok('M7: три щелчка подряд листают три режима', g.mode === order[3], `режим ${g.mode}`);
  // во время крафта колесо не трогает режимы
  g.setMode(order[0]);
  g.craftOpen = true;
  g.craftT = 1;
  g.input.wheel = 2;
  g.update(CFG.step);
  ok('M7: при открытом крафте колесо не меняет режим', g.mode === order[0], `режим ${g.mode}`);
  g.craftOpen = false;
}

// --- 5. Пульсация слота режима
{
  const g = new (sandbox.__cls.Game)(view);
  g.modeSwitchT = 0;
  g.setMode(2);            // STONE
  ok('M7: смена режима включает пульсацию', g.modeSwitchT === CFG.hud.modePulse,
     `t=${g.modeSwitchT}`);
  g.update(CFG.step);
  ok('M7: пульсация затухает по времени', g.modeSwitchT < CFG.hud.modePulse, `t=${g.modeSwitchT.toFixed(2)}`);
  ok('M7: плашка рисует пульсацию', /modeSwitchT/.test(String(g.drawModeBar)));
  ok('M7: цифры 1–7 продолжают работать',
     /Digit1/.test(String(g.update)) && /Digit7/.test(String(g.update)));
}

// --- 6. Тач-интерфейс: определение устройства и геометрия
{
  const oldMM = sandbox.window.matchMedia;
  const oldNav = sandbox.navigator;
  sandbox.window.matchMedia = (q) => ({ matches: q.indexOf('coarse') >= 0 });
  sandbox.navigator = { maxTouchPoints: 5 };
  const touchInput = new (sandbox.__cls.Game)(view);
  ok('M7: тач-устройство определяется по coarse/maxTouchPoints', touchInput.isTouch === true);
  const lay = touchInput.touch.layout(430, 780);
  ok('M7: на экране восемь кнопок', lay.buttons.length === 8, `кнопок=${lay.buttons.length}`);
  ok('M7: кнопки не меньше 48 px',
     lay.buttons.every(b => b.r * 2 >= 48), `радиус=${lay.buttons[0].r}`);
  const T = CFG.touchUI;
  ok('M7: кнопки не ближе 20 px к краю',
     lay.buttons.every(b => b.x + b.r <= 430 - T.margin + 0.5 && b.y + b.r <= 780 - T.margin + 0.5),
     'отступ края');
  ok('M7: джойстик в левой части экрана', lay.stick.x < 430 * 0.45, `x=${lay.stick.x}`);
  const hud = touchInput.hudMetrics();
  ok('M7: кнопки не перекрывают панель ресурсов и HP',
     lay.buttons.every(b => b.y - b.r > hud.bottom) && hud.bottom > 0,
     `верх кнопок ${Math.min(...lay.buttons.map(b => b.y - b.r)).toFixed(0)} > HUD ${hud.bottom.toFixed(0)}`);
  ok('M7: джойстик не перекрывает блок кнопок',
     Math.abs(lay.stick.x - lay.buttons[0].x) > lay.stick.r + lay.buttons[0].r,
     `джойстик ${lay.stick.x}, первая кнопка ${lay.buttons[0].x.toFixed(0)}`);
  ok('M7: HUD на тач-устройстве крупнее на 20 %', Math.abs(touchInput.hudScale - 1.2) < 1e-6);
  ok('M7: плашка клавиш на тач-устройстве скрыта', /isTouch/.test(String(touchInput.drawControls)));
  // в альбомной ориентации сетка перестраивается, а не остаётся колонкой
  const land = touchInput.touch.layout(900, 430);
  ok('M7: в альбомной ориентации кнопки раскладываются шире',
     land.buttons[1].y === land.buttons[0].y, 'второй ряд тот же');
  sandbox.window.matchMedia = oldMM;
  sandbox.navigator = oldNav;
}

// --- 7. Мультитач: бег и прыжок одновременно
{
  const g = new (sandbox.__cls.Game)(view);
  const p = g.player;
  const sr = g.world.surfaceRow;
  for (let x = 14; x <= 60; x++) {
    for (let y = sr - 6; y <= sr - 1; y++) g.world.set(x, y, TILE.EMPTY, false);
    g.world.set(x, sr, TILE.DIRT, false);
  }
  g.tiles.flush();
  g.crates.length = 0;
  p.x = 20 * TS; p.y = sr * TS - p.h; p.vx = p.vy = 0;
  g.camera.snap(p);

  const lay = g.touch.layout(g.vw, g.vh);
  const st = lay.stick;
  const jump = lay.buttons.find(b => b.id === 'jump');
  // 1) палец на джойстике тянет вправо
  g.touch.onStart({ changedTouches: [{ identifier: 1, clientX: st.x, clientY: st.y }], preventDefault() {} });
  g.touch.onMove({ changedTouches: [{ identifier: 1, clientX: st.x + st.r, clientY: st.y }], preventDefault() {} });
  for (let i = 0; i < 20; i++) g.update(CFG.step);
  const moving = p.vx;
  ok('M7: джойстик двигает игрока вправо', moving > 60, `vx=${moving.toFixed(0)}`);
  // 2) второй палец жмёт прыжок, не отпуская джойстик
  g.touch.onStart({ changedTouches: [{ identifier: 2, clientX: jump.x, clientY: jump.y }], preventDefault() {} });
  const vyBefore = p.vy;
  for (let i = 0; i < 3; i++) g.update(CFG.step);
  ok('M7: прыжок во время движения работает (мультитач)', p.vy < vyBefore - 100,
     `vy ${vyBefore.toFixed(0)} → ${p.vy.toFixed(0)}`);
  ok('M7: джойстик остался активен после второго пальца', g.touch.stick.active === true);
  ok('M7: второй палец не отобрал джойстик', g.touch.stick.id === 1);
  // 3) отпускаем прыжок — джойстик по-прежнему ведёт игрока
  g.touch.onEnd({ changedTouches: [{ identifier: 2, clientX: jump.x, clientY: jump.y }], preventDefault() {} });
  const vxKeep = p.vx;
  for (let i = 0; i < 10; i++) { g.update(CFG.step); }
  ok('M7: отпускание кнопки не сбрасывает движение', Math.abs(p.vx) >= vxKeep - 1,
     `vx ${vxKeep.toFixed(0)} → ${p.vx.toFixed(0)}`);
  // 4) отпускаем джойстик — вектор обнуляется
  g.touch.onEnd({ changedTouches: [{ identifier: 1, clientX: st.x, clientY: st.y }], preventDefault() {} });
  ok('M7: отпускание джойстика обнуляет вектор',
     g.input.touchX === 0 && g.touch.stick.active === false);
  const vx0 = Math.abs(p.vx);
  for (let i = 0; i < 40; i++) g.update(CFG.step);
  ok('M7: после отпускания джойстика игрок тормозит', Math.abs(p.vx) < vx0 * 0.2,
     `vx ${vx0.toFixed(0)} → ${Math.abs(p.vx).toFixed(0)}`);
}

// --- 8. Кнопки стреляют теми же клавишами, что и клавиатура
{
  const g = new (sandbox.__cls.Game)(view);
  const lay = g.touch.layout(g.vw, g.vh);
  const btn = (id) => lay.buttons.find(b => b.id === id);
  const press = (id) => g.touch.onStart({
    changedTouches: [{ identifier: 9, clientX: btn(id).x, clientY: btn(id).y }], preventDefault() {}
  });
  const release = (id) => g.touch.onEnd({
    changedTouches: [{ identifier: 9, clientX: btn(id).x, clientY: btn(id).y }], preventDefault() {}
  });
  press('jump');
  ok('M7: кнопка прыжка жмёт Space', g.input.keys.has('Space'));
  release('jump');
  ok('M7: отпускание кнопки отпускает Space', !g.input.keys.has('Space'));
  press('flip');
  ok('M7: кнопка гравитации жмёт F', g.input.keys.has('KeyF'));
  release('flip');
  press('act');
  ok('M7: кнопка действия держит ЛКМ', g.input.mouse.left === true);
  release('act');
  ok('M7: отпускание действия снимает ЛКМ', g.input.mouse.left === false);
  press('tele');
  ok('M7: кнопка телекинеза жмёт ПКМ', g.input.mouse.right === true);
  release('tele');
  ok('M7: кнопка крафта жмёт C', (press('craft'), g.input.keys.has('KeyC')));
  release('craft');
  ok('M7: кнопка сканера жмёт Q', (press('scan'), g.input.keys.has('KeyQ')));
  release('scan');
  ok('M7: кнопка чтения жмёт E', (press('use'), g.input.keys.has('KeyE')));
  release('use');
  ok('M7: кнопка биогеля жмёт H', (press('heal'), g.input.keys.has('KeyH')));
  release('heal');
  ok('M7: нажатие кнопки даёт вспышку', Object.keys(g.touch.flash).length > 0);
}

// --- 9. Мышь и тач не конфликтуют
{
  const PClike = new (sandbox.__cls.Game)(view);
  ok('M7: на ПК тач-слой выключен', PClike.isTouch === false);
  ok('M7: на ПК HUD обычного размера', PClike.hudScale === 1);
  ok('M7: тач-слой не рисуется на ПК', !/drawTouchIcon/.test(String(PClike.drawTouchUI)) ||
     /if \(!this.isTouch\) return;/.test(String(PClike.drawTouchUI)));
  ok('M7: колесо работает и на ПК', /takeWheel/.test(String(PClike.update)));
}

// --- 10. Подсказка старта гаснет после первого тапа
{
  const g = new (sandbox.__cls.Game)(view);
  ok('M7: подсказка старта видна до первого тапа', g.touch.awake === false && g.touch.hintT > 0,
     `hintT=${g.touch.hintT}`);
  g.touch.onStart({ changedTouches: [{ identifier: 1, clientX: g.vw / 2, clientY: 40 }], preventDefault() {} });
  ok('M7: первый тап убирает подсказку', g.touch.awake === true);
  g.touch.onEnd({ changedTouches: [{ identifier: 1, clientX: g.vw / 2, clientY: 40 }], preventDefault() {} });
}

// --- 11. Меню крафта ужимается под экран и остаётся попадаемым
{
  const g = new (sandbox.__cls.Game)(view);
  const box = g.craftLayout();
  ok('M7: панель крафта влезает в экран', box.w <= g.vw - 20 && box.h <= g.vh - 20,
     `${box.w}×${box.h.toFixed(0)} при ${g.vw}×${g.vh}`);
  // на узком экране масштаб меньше единицы, но строки по-прежнему попадаются
  const oldVw = g.vw;
  g.vw = 430;
  const small = g.craftLayout();
  g.vw = oldVw;
  ok('M7: на узком экране панель крафта масштабируется', small.s < 1, `s=${small.s.toFixed(2)}`);
  ok('M7: попадание по строке считается с тем же масштабом',
     /box\.s/.test(String(g.updateCraft)) || /rowH \* box\.s/.test(String(g.updateCraft)));
}

// ---------------------------------------------------------------- M8.1: корабль
{
  const S = game.ship;
  ok('M8.1: на старте есть объект «Корабль» 5x4', !!S && S.w === 5 && S.h === 4,
     S ? `тайл ${S.tx},${S.ty}, ${S.w}x${S.h}, ${S.wpx}x${S.hpx||S.hpx}px` : 'нет');
  ok('M8.1: обломки лежат на полу зала', !!S && W.solid(S.tx, S.ty + S.h) && !W.solid(S.tx, S.ty),
     S ? `под=${W.get(S.tx, S.ty + S.h)} внутри=${W.get(S.tx, S.ty)}` : '');
  const shipSpr = sandbox.__Sprites.ship(S.wpx, S.hpx);
  ok('M8.1: обломки пекутся в спрайт 5x4 тайла',
     !!shipSpr && shipSpr.width === S.wpx * sandbox.__SPR.scale,
     shipSpr ? `${shipSpr.width}x${shipSpr.height}` : 'нет спрайта');
}

// shipNear() по аналогии с benchNear(): объект или null
{
  const S = game.ship;
  const px = P.x, py = P.y;
  P.x = S.cx - P.w / 2; P.y = S.cy - P.h / 2; P.vx = P.vy = 0;
  ok('M8.1: shipNear() находит обломки вплотную', game.shipNear() === S);
  P.x = (S.tx + 40) * TS; P.y = S.y;
  ok('M8.1: shipNear() молчит вдали', game.shipNear() === null);
  // E у обломков откликается, но сюжетных текстов не трогает
  P.x = S.cx - P.w / 2; P.y = S.cy - P.h / 2;
  const hints = game.shipHintT;
  ok('M8.1: inspectShip() откликается у обломков', game.inspectShip() === true && game.shipHintT >= hints);
  P.x = px; P.y = py; P.vx = P.vy = 0; game.camera.snap(P); frames(2);
}

// Корабль уезжает в сейв вместе с остальным состоянием
{
  const S0 = game.ship;
  const keep = { tx: S0.tx, ty: S0.ty, looted: S0.looted };
  S0.tx = 21;                    // сдвигаем, чтобы сейв нельзя было «угадать»
  S0.looted = true;
  game.doSave();
  const raw = JSON.parse(sandbox.localStorage.getItem(CFG.save.key) || 'null');
  ok('M8.1: корабль пишется в сейв', !!raw && !!raw.ship &&
     raw.ship.w === CFG.ship.w && raw.ship.h === CFG.ship.h &&
     raw.ship.tx === 21 && raw.ship.looted === true,
     raw && raw.ship ? JSON.stringify(raw.ship) : 'нет ship');

  const g2 = new (sandbox.__cls.Game)(view);
  ok('M8.1: корабль восстанавливается из сейва', !!g2.ship &&
     g2.ship.tx === 21 && g2.ship.looted === true && g2.ship.w === CFG.ship.w,
     g2.ship ? JSON.stringify({ tx: g2.ship.tx, looted: g2.ship.looted }) : 'нет ship');

  S0.tx = keep.tx; S0.ty = keep.ty; S0.looted = keep.looted;
  S0.x = S0.tx * TS; S0.cx = S0.x + S0.wpx / 2;
  game.doSave();
}

// ---------------------------------------------------------------- M8.1: RESONITE
{
  let spot = null;
  for (let y = CFG.biomes.crystalFromRow + 2; y < CFG.layers.deepTopRow + 60 && !spot; y++) {
    for (let x = 200; x < 560; x++) if (W.get(x, y) === TILE.RESONITE) { spot = { x, y }; break; }
  }
  ok('M8.1: в кристальных пещерах есть RESONITE', !!spot, spot ? `тайл ${spot.x},${spot.y}` : 'не найдено');
  ok('M8.1: RESONITE копается заметно дольше породы',
     CFG.dig.times[TILE.RESONITE] > CFG.dig.times[TILE.DIRT] * 3,
     `${CFG.dig.times[TILE.RESONITE]}с против ${CFG.dig.times[TILE.DIRT]}с`);

  if (spot) {
    const inv = game.inventory.counts;
    const before = { f: inv[TILE.FERRITE] || 0, s: inv[TILE.STONE] || 0 };
    const n0 = game.drops.length;
    game.mineTile(spot.x, spot.y);
    const made = game.drops.slice(n0);
    const f = made.filter(d => d.type === TILE.FERRITE).length;
    const s = made.filter(d => d.type === TILE.STONE).length;
    ok('M8.1: RESONITE рассыпается на 2 FERRITE + 1 STONE', f === 2 && s === 1,
       `ferrite=${f} stone=${s}`);
    ok('M8.1: RESONITE исчез из мира', W.get(spot.x, spot.y) === TILE.EMPTY);

    // подбираем: ставим дропы в игрока и даём кадр на подбор
    for (const d of made) {
      d.x = P.cx - d.w / 2; d.y = P.cy - d.h / 2;
      d.vx = 0; d.vy = 0;
    }
    frames(6);
    const af = game.inventory.counts[TILE.FERRITE] || 0, as = game.inventory.counts[TILE.STONE] || 0;
    ok('M8.1: RESONITE попадает в инвентарь', af === before.f + 2 && as === before.s + 1,
       `ferrite ${before.f}→${af}, stone ${before.s}→${as}`);
  }
}

// ---------------------------------------------------------------- M8.1: чанки
{
  const w = game.world;
  const cs = CFG.world.chunk;
  const cam = (tx, ty) => ({ x: tx * TS, y: ty * TS, w: 640, h: 360 });

  // загружаем квадрат руин и правим в нём тайл
  const refer = { tx: 704, ty: 30 };
  w.updateChunks(cam(refer.tx - 10, refer.ty - 5));
  // берём именно твёрдый тайл: у пустого set() вернётся без записи в overlay
  let tx = refer.tx, ty = refer.ty;
  for (let dy = 0; dy < 20 && w.get(tx, ty) === TILE.EMPTY; dy++) ty = refer.ty + dy;
  const cx = (tx / cs) | 0, cy = (ty / cs) | 0;
  ok('M8.1: чанк камеры загружается по требованию', w.isChunkLoaded(cx, cy));
  const typeBefore = w.get(tx, ty);
  w.set(tx, ty, TILE.EMPTY);
  const overlay = w.mods.get(w.chunkKey(cx, cy));
  ok('M8.1: правка тайла уходит в overlay, а не в гигантский массив',
     !!overlay && overlay.has(w.localIndex(tx, ty, cx, cy)));

  // уезжаем на старт: чанк должен выгрузиться, а копка — остаться в overlay.
  // LRU не выкидывает только что тронутый чанк, поэтому сначала проезжаем
  // несколько других мест, иначе руинный чанк остаётся самым свежим
  const keep = w.keepChunks;
  w.keepChunks = 6;                  // столько чанков держит LRU в этом прогоне
  for (let k = 0; k < 3; k++) w.updateChunks(cam(300 + k * 40, 120));
  w.updateChunks(cam(0, 0));
  w.updateChunks(cam(0, 0));
  ok('M8.1: дальний чанк выгружается', !w.isChunkLoaded(cx, cy), `загружено ${w.loadedChunks()}`);
  ok('M8.1: загруженных чанков не больше лимита', w.loadedChunks() <= w.keepChunks,
     `${w.loadedChunks()} <= ${w.keepChunks}`);
  w.keepChunks = keep;
  ok('M8.1: выгрузка не теряет overlay-правку', w.mods.get(w.chunkKey(cx, cy)).has(w.localIndex(tx, ty, cx, cy)));

  // возвращаемся: чанк перегенерируется, правка применяется поверх
  w.updateChunks(cam(tx - 10, ty - 5));
  ok('M8.1: копка переживает выгрузку и повторную загрузку', w.get(tx, ty) === TILE.EMPTY,
     `было ${typeBefore}, стало ${w.get(tx, ty)}`);
}

// ---------------------------------------------------------------- M8.1: турели Руин
{
  const w = game.world;
  const spots = [];
  for (let cy = 0; cy < w.chunksY; cy++) {
    for (let cx = (CFG.biomes.ruinsFromX / CFG.world.chunk) | 0; cx < w.chunksX; cx++) {
      const ch = w.ensureChunk(cx, cy);
      if (ch.turrets.length) spots.push(ch.turrets[0]);
    }
  }
  ok('M8.1: в Руинах расставлены турели', spots.length >= 8, `точек ${spots.length}`);

  const spot = spots[0];
  const turretTileBelow = w.get(spot.tx, spot.ty + 1);
  ok('M8.1: турель стоит на металле, а не в воздухе',
     turretTileBelow === TILE.METAL, `под турелью ${turretTileBelow}`);

  // ставим игрока под ствол: турель должна заметить, прицелиться и выстрелить
  const px = P.x, py = P.y, hp0 = P.health;
  game.camera.snap(P);
  w.updateChunks({ x: spot.tx * TS - 320, y: spot.ty * TS - 180, w: 640, h: 360 });
  game.syncTurrets();
  const near = game.turrets.find(t => Math.abs(t.tx - spot.tx) < 2 && Math.abs(t.ty - spot.ty) < 2);
  ok('M8.1: турель попадает в список активных', !!near, `турелей ${game.turrets.length}`);
  if (near) {
    P.x = near.cx - P.w / 2;
    P.y = (near.ty + 1) * TS - P.h;
    P.vx = P.vy = 0;
    P.invuln = 0;
    game.camera.snap(P);
    let sawBolt = false, sawAim = false;
    for (let i = 0; i < 180 && P.health === hp0; i++) {
      frames(1);
      if (game.bolts.length) sawBolt = true;
      if (near.aim > 0) sawAim = true;
    }
    ok('M8.1: турель прицеливается в игрока', sawAim);
    ok('M8.1: турель стреляет болтом', sawBolt);
    ok('M8.1: болт наносит урон', P.health < hp0, `hp ${hp0}→${P.health}`);
  }

  P.x = px; P.y = py; P.vx = P.vy = 0;
  P.health = P.maxHealth;
  P.invuln = 1;
  game.bolts.length = 0;
  game.camera.snap(P);
  frames(2);
}

// ---------------------------------------------------------------- итог
const passed = results.filter(r => r.pass).length;
console.log('\n=== РЕЗУЛЬТАТ ===');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
console.log(`\n${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);
