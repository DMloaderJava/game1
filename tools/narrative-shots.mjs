// Скриншоты сюжетного слоя M8.2 через @napi-rs/canvas.
// Игра загружается как обычно, затем тем же способом, что и в браузере,
// подключается narrative.js — второй «script» в том же скоупе.
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
const NARR = fs.readFileSync(new URL('../narrative.js', import.meta.url), 'utf8');

const W = 1280, H = 720;
const view = createCanvas(W, H);
view._l = {};
view.addEventListener = (t, fn) => { view._l[t] = fn; };
view.style = {};
view.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });

const listeners = {};
const rafQueue = [];
let nowMs = 0;

const mem = new Map();
const sandbox = {
  console, performance, Math, Date, JSON, Uint8Array, Float32Array,
  document: {
    createElement: () => createCanvas(1, 1),
    getElementById: () => view,
    addEventListener: () => {},
    readyState: 'complete'
  },
  window: {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    devicePixelRatio: 1, innerWidth: W, innerHeight: H
  },
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }
  },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return 1; },
  devicePixelRatio: 1, innerWidth: W, innerHeight: H,
  setTimeout, clearTimeout
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(SRC + '\n;globalThis.__game = game; globalThis.Game = Game; globalThis.__CFG = CFG;'
  + 'globalThis.__TILE = TILE;', ctx, { filename: 'gravity-void.html' });
vm.runInContext(NARR, ctx, { filename: 'narrative.js' });

const game = sandbox.__game;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const TS = CFG.tile;
const P = game.player;
const N = game.narrative;

function frames(n) {
  for (let i = 0; i < n; i++) {
    nowMs += 1000 / 60;
    const cb = rafQueue.shift();
    if (cb) cb(nowMs); else game.update(CFG.step) || game.render();
  }
}
function shot(name) {
  fs.writeFileSync(new URL('../screenshots/' + name + '.png', import.meta.url), view.toBuffer('image/png'));
  console.log('saved', name);
}
function put(tx, ty, hp) {
  P.x = tx * TS; P.y = (ty + 1) * TS - P.h; P.vx = P.vy = 0; P.gravityTarget = 1;
  if (hp) P.health = hp;
  game.camera.snap(P);
  game.rid = null;
  game.update(CFG.step);
  game.camera.snap(P);
  game.render();
}
fs.mkdirSync(new URL('../screenshots/', import.meta.url), { recursive: true });

// ---------- старт: журнал и корабль в кадре ----------
frames(30);
game.camera.snap(P);
frames(2);
shot('32-quest-start');

// ---------- корабль вблизи: подсказка «Ремонт корабля» ----------
put(N.ship.doorX / TS - 0.5, N.ship.floorRow - 1);
frames(2);
shot('33-ship');

// ---------- меню ремонта: часть стадий, ресурсов не хватает ----------
game.inventory.counts[TILE.FERRITE] = 14;
game.inventory.counts[TILE.STONE] = 8;
N.ship.interact(game);
N.menuT = 1;
N.menuSel = 0;
game.render();
shot('34-ship-menu');

// ---------- меню ремонта: ресурсы есть, вторая стадия собрана ----------
// M9: ремонт выдаёт оружие — ставим те же флаги, что выдал бы Ship.update
N.ship.repairStage = 2;
N.ship.lastStage = 2;
P.hasLaser = true;
P.hasLaserPistol = true;
P.hasArmor = true;
N.log.blueprints = ['АВАРИЙНЫЙ РЕЗАК', 'ЛАЗЕРНЫЙ ПИСТОЛЕТ'];
N.log.score = 1250;
game.inventory.counts[TILE.FERRITE] = 30;
game.inventory.counts[TILE.STONE] = 46;
game.inventory.counts[8] = 3;
N.menuSel = 2;
game.render();
shot('35-ship-menu-ready');
N.menu = null;

// ---------- фрагмент ядра на уступе ----------
const f1 = N.fragments[1];
put(f1.tx, f1.ty + 1);
game.time = 1.4;
frames(2);
shot('36-fragment');

// ---------- фрагмент собран: счётчик 2/3 ----------
N.takeFragment(f1);
N.takeFragment(N.fragments[0]);
frames(4);
game.render();
shot('37-core-2of3');

// ---------- архив: терминал и панель лора ----------
const a = N.archives[2];
put(a.tx - 1, a.ty + 1);
frames(2);
shot('38-archive-near');
N.openArchive(a);
N.readT = 1;
game.render();
shot('39-archive-lore');
// закрываем панель архива, а не только лор игры: иначе она останется
// висеть на всех следующих кадрах
N.closeArchive();
N.reading = null;
game.render();

// ---------- резонит в глубине ----------
const node = N.nodes[0];
put(node.tx, node.ty + 1);
game.time = 2.2;
frames(2);
shot('40-resonite');

// ---------- финал: ядро собрано, аккорд открыт ----------
N.log.fragments = 3;
N.ship.repairStage = 3;
N.ship.lastStage = 3;
P.hasGravityGun = true;
put(N.ship.doorX / TS, N.ship.floorRow - 1);
frames(2);
shot('41-ship-repaired');

N.ship.activateCore(game);
N.endingT = 1;
// уведомление о последнем фрагменте живёт пару секунд и просвечивало
// сквозь финальную панель — гасим его для чистого кадра
game.noticeT = 0;
game.noticeText = '';
game.render();
shot('42-ending');

console.log('done');
