// Скриншоты реального рендера через @napi-rs/canvas
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*)<\/script>/)[1];

const W = 1280, H = 720;
const view = createCanvas(W, H);
// события на canvas: napi-canvas не умеет addEventListener — подкладываем реестр
view._l = {};
view.addEventListener = (t, fn) => { view._l[t] = fn; };
view.style = {};
view.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
const listeners = {};
const rafQueue = [];
let nowMs = 0;

// подменяем создание offscreen-канвасов на настоящие
const realCreateElement = (tag) => createCanvas(1, 1);

const sandbox = {
  console, performance, Math, Date, JSON, Uint8Array, Float32Array,
  document: {
    createElement: () => realCreateElement('canvas'),
    getElementById: () => view
  },
  window: {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    devicePixelRatio: 1, innerWidth: W, innerHeight: H
  },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return 1; },
  devicePixelRatio: 1, innerWidth: W, innerHeight: H,
  setTimeout, clearTimeout
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
SRC += '\n;globalThis.__game = game; globalThis.__CFG = CFG; globalThis.__TILE = TILE; globalThis.__cls = { Drop, Crate };';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });

const game = sandbox.__game;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const TS = CFG.tile;
const P = game.player;

// view.getBoundingClientRect есть у napi-canvas? Если нет — подложим


function frames(n) {
  for (let i = 0; i < n; i++) {
    nowMs += 1000 / 60;
    const cb = rafQueue.shift();
    cb(nowMs);
  }
}
function key(code, down = true) { listeners[down ? 'keydown' : 'keyup']({ code, repeat: false, preventDefault() {} }); }
function mouseMove(x, y) { view._l.mousemove({ clientX: x, clientY: y, preventDefault() {} }); }
function mouseDown(x, y, button = 0) { view._l.mousedown({ clientX: x, clientY: y, button, preventDefault() {} }); }
function mouseUp(button = 0) { listeners.mouseup({ button }); }
function mouseToTile(tx, ty) {
  const x = (tx * TS + TS / 2 - game.camera.x) * CFG.camera.zoom;
  const y = (ty * TS + TS / 2 - game.camera.y) * CFG.camera.zoom;
  mouseMove(x, y);
  return { x, y };
}
function shot(name) {
  fs.writeFileSync(new URL('../screenshots/' + name + '.png', import.meta.url), view.toBuffer('image/png'));
  console.log('saved', name);
}
fs.mkdirSync(new URL('../screenshots/', import.meta.url), { recursive: true });

// сцена 1: старт
frames(45);
shot('01-start');

// сцена 2: копание в процессе (виден прогресс-бар и трещины), крупный план
frames(2);
const dt = { tx: Math.floor(P.cx / TS), ty: Math.floor((P.y + P.h) / TS) + 1 };
let mp = mouseToTile(dt.tx, dt.ty);
mouseDown(mp.x, mp.y);
frames(6);       // ~0.1с, прогресс DIRT
shot('02-digging');
// крупный план места копания
{
  const z = CFG.camera.zoom;
  const sx = (dt.tx * TS - game.camera.x) * z - 60;
  const sy = (dt.ty * TS - game.camera.y) * z - 60;
  const c2 = createCanvas(300, 240);
  const x2 = c2.getContext('2d');
  x2.imageSmoothingEnabled = false;
  x2.drawImage(view, Math.max(0, sx), Math.max(0, sy), 300, 240, 0, 0, 600, 480);
  fs.writeFileSync(new URL('../screenshots/02b-digging-crop.png', import.meta.url), c2.toBuffer('image/png'));
}

mouseUp();
frames(30);
game.inventory.add(TILE.DIRT, 12);
game.inventory.add(TILE.STONE, 6);
game.inventory.add(TILE.FERRITE, 2);
frames(3);
shot('03-hud');

// сцена 4: куча дропов на полу (худший кадр по нагрузке)
const { Drop, Crate } = sandbox.__cls;
for (let i = 0; i < 60; i++) {
  game.drops.push(new Drop(P.cx - 300 + (i % 15) * 24, P.y - 20 - Math.floor(i / 15) * 26,
                            [TILE.DIRT, TILE.STONE, TILE.FERRITE][i % 3]));
}
frames(90);
shot('04-drops');

// сцена 5: захват ящика телекинезом
const crate = game.crates[0];
const crx = (crate.cx - game.camera.x) * CFG.camera.zoom, cry = (crate.cy - game.camera.y) * CFG.camera.zoom;
mouseMove(crx, cry);
mouseDown(crx, cry);
frames(4);
mouseMove(crx + 30, cry - 40);
frames(10);
shot('05-telekinesis');
mouseUp();
frames(20);

// сцена 6: перевёрнутая гравитация, игрок на потолке
key('KeyF');
frames(120);
shot('06-ceiling');

// сцена 7: курсор вне радиуса копания
key('KeyF');
frames(120);
mouseMove(W / 2 + 260, H / 2);
mouseDown(W / 2 + 260, H / 2);
frames(6);
shot('07-too-far');
mouseUp();

// сцена 8: подземная пещера после раскопок
for (let i = 0; i < 40; i++) {
  const tx = Math.floor(P.cx / TS) + (i % 8) - 4;
  const ty = Math.floor(P.cy / TS) + Math.floor(i / 8) + 1;
  game.world.set(tx, ty, TILE.EMPTY);
  game.tiles.flush();
}
frames(10);
shot('08-cave');
console.log('done');
