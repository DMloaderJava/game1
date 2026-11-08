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
     + ';globalThis.__cls = { Drop, Crate, PhysBody, Player, World, Game, Tide, Save };';
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
ok('появился физический дроп', game.drops.length === 1, `drops=${game.drops.length}`);
ok('дроп нужного типа', game.drops[0] && game.drops[0].type === TILE.DIRT, `type=${game.drops[0] && game.drops[0].type}`);

// яма под игроком: дроп падает на дно — это ожидаемо, подбирать будем стеновой тайл
mouse('up', 0, 0);
frames(90);
ok('дроп упал и заснул в яме', game.drops.length === 1 && game.drops[0].sleeping, `drops=${game.drops.length} sleep=${game.drops[0] && game.drops[0].sleeping}`);
const pitDrop = game.drops[0];
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
frames(200);
const movedUp = quiet.filter((d, i) => d.y < sleepY[i] - 20).length;
ok('в катастрофе дропы летят вверх', movedUp >= 4, `улетело: ${movedUp}/6`);
ok('игрок тоже улетел вверх без F', P.y < FLOOR_Y - 40, `y=${P.y.toFixed(1)} было ${FLOOR_Y.toFixed(1)}`);

// контр-манипуляция: F прижимает обратно
tapKey('KeyF');
frames(120);
ok('F при катастрофе меняет личную гравитацию', P.gravityTarget === 1, `target=${P.gravityTarget}`);

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

// ---------------------------------------------------------------- итог
const passed = results.filter(r => r.pass).length;
console.log('\n=== РЕЗУЛЬТАТ ===');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
console.log(`\n${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);
