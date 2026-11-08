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
  addEventListener(t, fn) { (this._l ||= {})[t] = fn; }
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
  window: {
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
     + ';globalThis.__cls = { Drop, Crate, PhysBody, Player, World };';
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
  if (type === 'mousemove') view._l.mousemove({ clientX: x, clientY: y, preventDefault() {} });
  else if (type === 'down') view._l.mousedown({ clientX: x, clientY: y, button, preventDefault() {} });
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
mouse('down', crate.cx, crate.cy);
frames(2);
ok('ЛКМ по ящику — захват (не копание)', game.grab === crate && game.dig === null, `grab=${!!game.grab} action=${game.leftAction}`);
mouse('mousemove', crate.cx + 40, crate.cy - 60);
frames(30);
ok('ящик тянется за курсором', Math.abs(crate.cx - (crate.x + crate.w)) < 999 && (Math.abs(crate.x - beforeCrate.x) > 5 || Math.abs(crate.y - beforeCrate.y) > 5));
mouse('up', 0, 0);
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
mouse('down', tk.cx, tk.cy);
frames(2);
const grabbedDrop = game.grab === tk;
mouse('mousemove', tk.cx, tk.cy - 90);
frames(20);
ok('дроп можно тянуть телекинезом', grabbedDrop && tk.gravityScale === 0, `grab=${grabbedDrop} gs=${tk.gravityScale}`);
ok('дроп поднялся над полом', tk.y < P.y + P.h - 40, `y=${tk.y.toFixed(1)}`);
mouse('up', 0, 0);
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

// ---------------------------------------------------------------- дропы не улетают при перевороте
game.crates.length = 0;
game.drops.length = 0;
// игрок на ровном участке пола, подальше от ям
P.x = 330; P.y = FLOOR_Y; P.vx = 0; P.vy = 0;
frames(10);
const quiet = [];
for (let i = 0; i < 6; i++) {
  quiet.push(new sandbox.__cls.Drop(P.cx - 160 + i * 24, P.y + P.h - CFG.drop.size, TILE.STONE));
}
game.drops.push(...quiet);
frames(120);
ok('дропы лежат на полу и спят', quiet.filter(d => d.sleeping).length >= 5,
   `sleep=${quiet.filter(d => d.sleeping).length}/6`);
const sleepY = quiet.map(d => d.y);
const ceilingBottomPx = (CFG.layers.skyRows + CFG.layers.ceilingRows) * TS;

tapKey('KeyF');
frames(400);
const movedUp = quiet.filter((d, i) => d.y < sleepY[i] - 20).length;
ok('дропы падают вверх при перевёрнутой гравитации', movedUp >= 4, `улетело вверх: ${movedUp}/6` +
   ' y=' + quiet.map(d => d.y.toFixed(0)).join(','));
ok('ни один дроп не провалился сквозь потолок', quiet.every(d => d.y >= ceilingBottomPx - 2),
   'top=' + quiet.map(d => d.y.toFixed(0)).join(',') + ` низ потолка=${ceilingBottomPx}`);
ok('дропы не застряли в тайлах', quiet.every(d => !insideSolid(d)));
tapKey('KeyF');
frames(300);

// ---------------------------------------------------------------- HUD-состояние
ok('пульсация HUD затухает', Object.values(game.inventory.pulse).every(v => v >= 0 && v <= CFG.hud.pulse + 0.001));

// ---------------------------------------------------------------- итог
const passed = results.filter(r => r.pass).length;
console.log('\n=== РЕЗУЛЬТАТ ===');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
console.log(`\n${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);
