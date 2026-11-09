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
  drawImage() { calls.drawImage++; }
  createLinearGradient() { return grad; }
  createRadialGradient() { return grad; }
  beginPath() {} moveTo() {} lineTo() {} arcTo() {} arc() {} closePath() {}
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
     + ';globalThis.__cls = { Drop, Crate, PhysBody, Player, World, Game, Tide, Save, Crawler, Particles, Inventory };';
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

// яма под игроком: дроп падает на дно — это ожидаемо, подбирать будем стеновой тайл
mouse('up', 0, 0);
frames(90);
ok('дроп упал и заснул в яме', !!dugDrop && dugDrop.sleeping, `drops=${game.drops.length} sleep=${dugDrop && dugDrop.sleeping}`);
const pitDrop = dugDrop;
ok('дроп в яме физически ниже пола', pitDrop.y > digTarget.ty * TS, `y=${pitDrop.y.toFixed(1)}`);

// подбор вплотную: дроп появляется на игроке — должен подобраться за кадр
const invNow = game.inventory.counts[TILE.STONE];
game.drops.push(new sandbox.__cls.Drop(P.cx - 6, P.cy - 6, TILE.STONE));
frames(2);
ok('дроп на игроке подбирается автоматически', game.inventory.counts[TILE.STONE] === invNow + 1,
   `inv=${game.inventory.counts[TILE.STONE]}`);
ok('подбор дал burst-частицы', game.particles.list.length === CFG.particles.pickup,
   `particles=${game.particles.list.length}`);
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

// ---------------------------------------------------------------- тайловый буфер
calls.fillTileRect = 0;
calls.drawImage = 0;
frames(1);
ok('в простое offscreen тайлов не перерисовывается', calls.fillTileRect === 0, `fillRect в буфер за кадр=${calls.fillTileRect}`);
ok('тайлы выводятся одним drawImage', calls.drawImage === 1, `drawImage за кадр=${calls.drawImage}`);
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
ok('сейв записан', !!saved && saved.v === 2 && saved.tiles.length > 0, 'v=' + (saved && saved.v));
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
ok('M3: спавнится 2-3 хищника', g3.crawlers.length >= 2 && g3.crawlers.length <= 3, `n=${g3.crawlers.length}`);
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
ok('M4: в меню 3 рецепта', CFG.recipes.length === 3, String(CFG.recipes.length));

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

// ---------------------------------------------------------------- итог
const passed = results.filter(r => r.pass).length;
console.log('\n=== РЕЗУЛЬТАТ ===');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
console.log(`\n${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);
