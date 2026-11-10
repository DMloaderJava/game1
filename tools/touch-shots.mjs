// M7: скриншоты мобильного интерфейса. Отдельный скрипт: тач включается флагом,
// поэтому ПК-набор кадров не меняется
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

const W = Number(process.env.TW || 430), H = Number(process.env.TH || 780);
const view = createCanvas(W, H);
view._l = {};
view.style = {};
view.addEventListener = (t, fn) => { (view._l[t] ||= []).push(fn); };
view.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });

const listeners = {};
const rafQueue = [];
let now = 0;
const sandbox = {
  console, performance, Math, Date, JSON, Uint8Array, Float32Array,
  document: { createElement: () => createCanvas(1, 1), getElementById: () => view },
  // Тач-устройство: грубый указатель + точки касания + маленький экран
  window: {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    matchMedia: (q) => ({ matches: q.indexOf('coarse') >= 0, media: q, addListener() {}, removeListener() {} }),
    devicePixelRatio: 1, innerWidth: W, innerHeight: H
  },
  navigator: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return 1; },
  devicePixelRatio: 1, innerWidth: W, innerHeight: H,
  setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
const html = SRC.replace('let game = null;', 'globalThis.__g = null; let game = null;');
SRC = html.replace('game = new Game(document.getElementById(\'view\'));',
                   'game = new Game(document.getElementById(\'view\')); globalThis.__g = game;');
SRC += '\n;globalThis.__CFG = CFG; globalThis.__TILE = TILE; globalThis.__MODE = MODE;';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });

const game = sandbox.__g || sandbox.game_;
if (!game) throw new Error('игра не создалась');
const CFG = sandbox.__CFG;
const TS = CFG.tile;
const P = game.player;

function frames(n) {
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    const cb = rafQueue.shift();
    if (cb) cb(now);
  }
}
function shot(name) {
  fs.writeFileSync(new URL('../screenshots/' + name + (process.env.SUF || '') + '.png', import.meta.url), view.toBuffer('image/png'));
  console.log('saved', name);
}
function touch(type, list) {
  const fn = view._l['touch' + type];
  if (!fn) throw new Error('нет обработчика touch' + type);
  const touches = list.map(t => ({
    identifier: t.id, clientX: t.x, clientY: t.y, pageX: t.x, pageY: t.y,
    target: view, radiusX: 12, radiusY: 12, force: 1
  }));
  for (const f of fn) {
    f({
      changedTouches: touches, touches, targetTouches: touches,
      preventDefault() {}, stopPropagation() {}
    });
  }
}

console.log('тач включён:', game.isTouch, '| HUD x' + game.hudScale);
frames(30);
shot('25-touch-hint');          // «Тапните для старта»

// Первый тап мимо кнопок — снимаем подсказку и начинаем игру
touch('start', [{ id: 1, x: W / 2, y: H / 2 - 200 }]);
touch('end', [{ id: 1, x: W / 2, y: H / 2 - 200 }]);
frames(20);
console.log('hudBottom=%s, кнопки высота=%s, vh=%s', game.hudBottomY, game.touchButtonsHeight(), game.vh);
shot('26-touch-idle');          // джойстик и кнопки в покое

// Мультитач: палец на джойстике тянет вправо, второй палец жмёт прыжок
const lay = game.touch.layout(game.vw, game.vh);
const sx = lay.stick.x, sy = lay.stick.y;
touch('start', [{ id: 2, x: sx, y: sy }]);
frames(1);
touch('move', [{ id: 2, x: sx + lay.stick.r * 0.95, y: sy }]);
frames(12);
const jumpBtn = lay.buttons.find(b => b.id === 'jump');
frames(30);                     // разбегаемся: камера должна догнать игрока
touch('start', [{ id: 3, x: jumpBtn.x, y: jumpBtn.y }]);
frames(1);
shot('27-touch-multitouch');    // бег + прыжок одновременно
console.log('после мультитача: vx=%s, vy=%s, палец на джойстике=%s',
  P.vx.toFixed(0), P.vy.toFixed(0), game.touch.stick.active);
touch('end', [{ id: 3, x: jumpBtn.x, y: jumpBtn.y }]);
frames(4);

// Переключение режима колесом (на ПК-эмуляции доступно так же)
const before = game.mode;
game.input.wheel = 1;
frames(2);
console.log('колесо: режим %s -> %s, пульсация %s', before, game.mode, game.modeSwitchT.toFixed(2));
shot('28-touch-modes');

// Копание: свободный палец в правой части экрана ставит курсор и держит ЛКМ
game.setMode(4);              // режим «копать»
const digX = W * 0.66, digY = H * 0.42;
touch('start', [{ id: 4, x: digX, y: digY }]);
frames(8);
shot('29-touch-dig');
touch('end', [{ id: 4, x: digX, y: digY }]);
touch('end', [{ id: 2, x: sx, y: sy }]);
frames(4);

// Телекинез кнопкой: захватываем ящик
{
  const crate = game.crates[0];
  if (crate) {
    game.camera.snap(P);
    const z = CFG.camera.zoom;
    const sc = { x: (crate.cx - Math.round(game.camera.x)) * z, y: (crate.cy - Math.round(game.camera.y)) * z };
    // палец по курсору, потом кнопка телекинеза
    touch('start', [{ id: 5, x: sc.x, y: sc.y }]);
    frames(2);
    game.input.mouse.x = sc.x; game.input.mouse.y = sc.y;
    game.startGrab(game.mouseW);
    const teleBtn = lay.buttons.find(b => b.id === 'tele');
    touch('start', [{ id: 6, x: teleBtn.x, y: teleBtn.y }]);
    game.input.mouse.x = sc.x; game.input.mouse.y = sc.y;
    frames(10);
    shot('30-touch-telekinesis');
    console.log('телекинез кнопкой: захвачено=%s, скорость ящика=%s',
      !!game.grab, Math.hypot(crate.vx, crate.vy).toFixed(0));
    touch('end', [{ id: 6, x: teleBtn.x, y: teleBtn.y }]);
    touch('end', [{ id: 5, x: sc.x, y: sc.y }]);
  }
}
frames(6);

// Меню крафта на телефоне: открывается кнопкой, панель ужимается под экран
{
  const Wr = game.world;
  const bx = Math.floor(P.cx / 32);
  // верстак ставится в воздушный ряд над полом, рядом с игроком
  Wr.set(bx + 1, Math.floor(P.cy / 32), 5, true);
  Wr.set(bx + 2, Math.floor(P.cy / 32), 5, true);
  game.tiles.flush();
  const craftBtn = lay.buttons.find(b => b.id === 'craft');
  touch('start', [{ id: 7, x: craftBtn.x, y: craftBtn.y }]);
  touch('end', [{ id: 7, x: craftBtn.x, y: craftBtn.y }]);
  frames(12);
  console.log('крафт открыт кнопкой:', game.craftOpen, '| масштаб панели', game.craftLayout().s.toFixed(2));
  shot('31-touch-craft');
  game.craftOpen = false;
}

console.log('done');
