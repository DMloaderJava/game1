// M8.2: сюжет на телефоне. Копия подхода touch-shots.mjs, но с подключённым
// narrative.js — журнал, меню ремонта и панель архива проверяются на узком экране.
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const NARR = fs.readFileSync(new URL('../narrative.js', import.meta.url), 'utf8');

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
  document: { createElement: () => createCanvas(1, 1), getElementById: () => view, addEventListener() {}, readyState: 'complete' },
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
SRC = SRC.replace("game = new Game(document.getElementById('view'));",
                  "game = new Game(document.getElementById('view')); globalThis.__g = game; globalThis.Game = Game;");
SRC += '\n;globalThis.__CFG = CFG; globalThis.__TILE = TILE;';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });
vm.runInContext(NARR, ctx, { filename: 'narrative.js' });

const game = sandbox.__g;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const TS = CFG.tile;
const P = game.player;
const N = game.narrative;

function frames(n) {
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    const cb = rafQueue.shift();
    if (cb) cb(now);
  }
}
function shot(name) {
  fs.writeFileSync(new URL('../screenshots/' + name + (process.env.SUF || '') + '.png', import.meta.url),
                   view.toBuffer('image/png'));
  console.log('saved', name);
}
function put(tx, ty) {
  P.x = tx * TS; P.y = (ty + 1) * TS - P.h; P.vx = P.vy = 0; P.gravityTarget = 1;
  game.camera.snap(P);
  frames(2);
  game.camera.snap(P);
  game.render();
}

// первый тап будит игру: без него рисуется «Тапните для старта»
game.touch.onStart({ changedTouches: [{ identifier: 1, clientX: W / 2, clientY: 40 }], preventDefault() {} });
game.touch.onEnd({ changedTouches: [{ identifier: 1, clientX: W / 2, clientY: 40 }], preventDefault() {} });
frames(6);

// ---------- корабль и журнал ----------
put(N.ship.doorX / TS, N.ship.floorRow - 1);
game.render();
shot('43-touch-quest');

// ---------- меню ремонта на узком экране ----------
game.inventory.counts[TILE.FERRITE] = 24;
game.inventory.counts[TILE.STONE] = 22;
N.ship.interact(game);
N.menuT = 1;
N.menuSel = 0;
game.render();
const box = N.menuLayout(game);
console.log('панель ремонта: ' + box.w.toFixed(0) + '×' + box.h.toFixed(0) +
            ' при ' + W + '×' + H + ' | масштаб ' + box.s.toFixed(2) +
            ' | влезает: ' + (box.w <= W && box.h <= H && box.y >= 0));
shot('44-touch-ship-menu');
N.menu = null;

// ---------- фрагмент и архив ----------
put(N.fragments[0].tx, N.fragments[0].ty + 1);
game.render();
shot('45-touch-fragment');

N.openArchive(N.archives[0]);
N.readT = 1;
game.render();
shot('46-touch-archive');

// журнал не должен пересекаться ни с кнопками, ни с джойстиком:
// сравниваем прямоугольники, а не только Y — кнопки живут справа
const card = N.cardLayout(game);
const lay = game.touch.layout(W, H);
function hit(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
const btnBox = {
  x: Math.min(...lay.buttons.map(b => b.x - b.r)), y: Math.min(...lay.buttons.map(b => b.y - b.r)),
  w: 0, h: 0
};
btnBox.w = Math.max(...lay.buttons.map(b => b.x + b.r)) - btnBox.x;
btnBox.h = Math.max(...lay.buttons.map(b => b.y + b.r)) - btnBox.y;
const stickBox = { x: lay.stick.x - lay.stick.r, y: lay.stick.y - lay.stick.r,
                   w: lay.stick.r * 2, h: lay.stick.r * 2 };
console.log('карточка журнала: ' + card.x.toFixed(0) + ',' + card.y.toFixed(0) + ' ' +
            card.w.toFixed(0) + '×' + card.h.toFixed(0) +
            ' | кнопки: ' + (hit(card, btnBox) ? 'ПЕРЕКРЫВАЕТ' : 'ок') +
            ' | джойстик: ' + (hit(card, stickBox) ? 'ПЕРЕКРЫВАЕТ' : 'ок'));
console.log('done');
