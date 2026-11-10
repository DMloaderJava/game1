// Скриншоты реального рендера через @napi-rs/canvas
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

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
SRC += '\n;globalThis.__game = game; globalThis.__CFG = CFG; globalThis.__TILE = TILE; globalThis.__cls = { Drop, Crate }; globalThis.__clsM3 = { Crawler, Drop }; globalThis.__ITEM = ITEM;';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });

const game = sandbox.__game;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const ITEM = sandbox.__ITEM;
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
// ---------- M2: якорь и купол ----------
game.resetWorld();
frames(30);
game.inventory.counts[TILE.FERRITE] = 9;
game.inventory.counts[TILE.STONE] = 9;
game.inventory.counts[TILE.DIRT] = 6;
const aTx = Math.floor(P.cx / TS) + 3;
const aTy = Math.floor((P.y + P.h - 0.001) / TS) - 1;
game.anchors.push({ x: aTx, y: aTy, born: 0 });
for (let i = 0; i < 6; i++) game.world.set(aTx - 2 + i, aTy, TILE.STONE, true);
game.world.set(aTx, aTy - 1, TILE.STONE, true);
game.world.set(aTx + 1, aTy - 1, TILE.STONE, true);
game.tiles.flush();
game.mode = 6;
game.camera.snap(P);
frames(40);
shot('09-anchor');

// вид с куполом и защищёнными постройками
game.mode = 2;
game.inventory.counts[TILE.STONE] = 9;
for (let i = 0; i < 4; i++) game.world.set(aTx - 3 + i, aTy - 3, TILE.STONE, true);
game.tiles.flush();
frames(20);
shot('09b-dome');
game.mode = 6;

// ---------- M2: WARNING ----------
game.tide.setPhase(1);
game.tide.applyPhase('WARNING');
for (let i = 0; i < 90; i++) { game.skyWarn = Math.min(1, game.skyWarn + 0.04); frames(1); }
shot('10-warning');

// ---------- M2: CATASTROPHE ----------
game.tide.setPhase(2);
game.tide.applyPhase('CATASTROPHE');
game.onPhaseChanged('CATASTROPHE');
for (let i = 0; i < 120; i++) { game.skyCat = Math.min(1, game.skyCat + 0.05); frames(1); }
shot('11-catastrophe');

// ---------- M2: AFTERMATH ----------
game.tide.setPhase(3);
game.tide.applyPhase('AFTERMATH');
game.rewardGiven = false;
frames(30);
game.skyCat = 0.15;
shot('12-aftermath');

// ---------- M3: здоровье, хищник, биогель ----------
game.resetWorld();
frames(40);
// раненый игрок: полоска здоровья в HUD
P.health = 55;
P.hurtT = 0.4;
game.hurtScreen = 0.3;
game.inventory.counts[4] = 2;
frames(2);
shot('13-hud-health');

// хищник вблизи, агрится: двое, один раненый
game.crawlers.length = 0;
const cm = new sandbox.__clsM3.Crawler(P.x + 120, P.y + P.h - 24);
cm.state = 'AGGRO'; cm.dir = -1;
const cm2 = new sandbox.__clsM3.Crawler(P.x - 150, P.y + P.h - 24);
cm2.state = 'FLEE'; cm2.dir = 1; cm2.hp = 5; cm2.dir = -1;
game.crawlers.push(cm, cm2);
P.health = 80;
frames(6);
game.camera.snap(P);
frames(1);
shot('13b-crawler');

// пещера: хищник и биогель там, где они живут
const cavePy = (CFG.layers.skyRows + CFG.layers.ceilingRows + 6) * TS;
P.x = 60 * TS; P.y = cavePy - P.h; P.vx = 0; P.vy = 0;
game.crawlers.length = 0;
const cCave = new sandbox.__clsM3.Crawler(61 * TS, cavePy - 24);
cCave.state = 'AGGRO';
game.crawlers.push(cCave);
const gel2 = new sandbox.__clsM3.Drop(58 * TS, cavePy - 14, 4);
gel2.sleeping = true;
game.drops.push(gel2);
P.gravityTarget = 1;
game.camera.snap(P);
frames(1);
shot('13d-cave-crawler');

// прилив: хищник висит на потолке, игрок внизу
P.x = 60 * TS; P.y = (CFG.layers.skyRows + CFG.layers.ceilingRows + 6) * TS - P.h;
game.crawlers.length = 0;
const ch = new sandbox.__clsM3.Crawler(P.x + 60, P.y - 150);
ch.state = 'HANG';
game.crawlers.push(ch);
game.tide.setPhase(2); game.tide.applyPhase('CATASTROPHE');
game.skyCat = 1;
P.health = 40; P.invuln = 99;
frames(2);
game.camera.snap(P);
frames(1);
shot('13c-tide-hang');

// смерть: красный экран и потеря ресурсов
game.tide.setPhase(0); game.tide.applyPhase('STABLE');
game.inventory.counts[TILE.FERRITE] = 9;
game.inventory.counts[TILE.STONE] = 6;
P.health = 5; P.invuln = 0;
game.damagePlayer(20, 'тест');
frames(3);
shot('14-death');
// ---------- M3.5: навигация хищника ----------
game.resetWorld();
frames(20);
{
  const Wr = game.world, s2 = Wr.surfaceRow;
  for (let x = 96; x <= 124; x++) for (let y = 6; y < s2; y++) Wr.set(x, y, sandbox.__TILE.EMPTY, false);
  for (let x = 100; x <= 112; x++) Wr.set(x, s2 - 3, sandbox.__TILE.STONE, true);
  game.tiles.flush();
  P.x = 107 * 32; P.y = s2 * 32 - P.h; P.vx = P.vy = 0; P.gravityTarget = 1; P.health = 100;
  game.crawlers.length = 0;
  const cw = new sandbox.__clsM3.Crawler(112 * 32, (s2 - 3) * 32 - 24);
  cw.home = { x: cw.cx, y: cw.cy };
  game.crawlers.push(cw);
  game.camera.snap(P);
  frames(40);
  game.camera.snap(P);
  frames(1);
  shot('15-crawler-platform');
}
{
  const Wr = game.world, s2 = Wr.surfaceRow;
  for (let x = 96; x <= 124; x++) for (let y = 6; y < s2; y++) Wr.set(x, y, sandbox.__TILE.EMPTY, false);
  const bx = 110;
  Wr.set(bx, s2 - 1, sandbox.__TILE.DIRT, true);
  Wr.set(bx, s2 - 2, sandbox.__TILE.DIRT, true);
  game.tiles.flush();
  P.x = 106 * 32; P.y = s2 * 32 - P.h; P.vx = P.vy = 0; P.health = 100;
  game.crawlers.length = 0;
  const cw = new sandbox.__clsM3.Crawler(114 * 32, s2 * 32 - 24);
  cw.home = { x: cw.cx, y: cw.cy };
  game.crawlers.push(cw);
  game.camera.snap(P);
  frames(26);
  game.camera.snap(P);
  frames(1);
  shot('15b-crawler-jump');
}
// ---------- M4: верстак, крафт, инструменты ----------
game.resetWorld();
frames(30);
{
  const Wr = game.world, s2 = Wr.surfaceRow;
  const bx = Math.floor(P.cx / 32) + 3;
  const by = s2 - 1;                       // верстак стоит НА полу, а не в нём
  for (let i = 0; i < 2; i++) Wr.set(bx + i, by, 5, true);
  game.tiles.flush();
  game.inventory.counts[1] = 12; game.inventory.counts[2] = 9;
  game.inventory.counts[3] = 8; game.inventory.counts[4] = 2;
  game.mode = 7;
  P.x = bx * 32 - 40;
  game.camera.snap(P);
  frames(4);
  shot('16-workbench');

  // меню крафта
  game.craftOpen = false;
  game.toggleCraft();
  game.craftT = 1;
  game.craftSel = 0;
  frames(2);
  shot('16b-craft-menu');

  // резак: луч при копании + броня
  game.craftOpen = false;
  game.player.hasLaser = true;
  game.player.hasArmor = true;
  game.player.hasGravityGun = true;
  game.mode = 4;
  // Для кадра ставим состояние копания напрямую: луч рисуется по нему
  const dtx = Math.floor(P.cx / 32) + 2;
  const dty = game.world.surfaceRow;
  game.world.set(dtx, dty, 2, false);
  game.tiles.flush();
  game.dig = { tx: dtx, ty: dty, type: 2, progress: 0.12, max: 0.25 };
  game.camera.snap(P);
  game.render();          // кадр без update: иначе отпущенная ЛКМ сбрасывает копание
  shot('16c-laser-armor');
  game.input.mouse.left = false;
}
// ---------- M5: терминалы, сканер, Глубокие пещеры ----------
game.resetWorld();
frames(30);

// Сканер: волна расходится, метки ресурсов и хищника сквозь стены
{
  const cx = Math.floor(P.cx / 32) + 4, cy = game.world.surfaceRow - 3;
  P.x = cx * 32; P.y = game.world.surfaceRow * 32 - P.h;
  P.vx = P.vy = 0;
  game.camera.snap(P);
  // насыпаем феррита в породу рядом и за стеной: сканер должен его найти
  for (let i = 0; i < 14; i++) {
    const fx = cx + 4 + (i % 5), fy = cy + 1 + Math.floor(i / 5);
    game.world.set(fx, fy, 3, false);
    if (i % 3 === 0) game.world.set(fx + 2, cy - 1 - Math.floor(i / 5), 3, false);
  }
  game.tiles.flush();
  // хищник за стеной: сканер должен подсветить его красным
  game.crawlers.length = 0;
  const sc = new sandbox.__clsM3.Crawler(P.cx + 9 * 32, cy * 32 - CFG.crawler.h);
  sc.home = { x: sc.cx, y: sc.cy };
  game.crawlers.push(sc);
  game.scanCd = 0;
  game.useScanner();
  game.scanTick = 0;
  // Волна растянута по кадрам, а для кадра нужен готовый радиус:
  // ~10 тайлов радиуса: фронт волны ещё в кадре (камера видит ~10 тайлов)
  game.scanT = 1.66;
  game.scanTick = 0;
  game.scanTargets = game.collectScanTargets();
  game.noticeT = 0;
  game.camera.snap(P);
  game.render();                  // кадр без update: таймер не должен съесть волну
  shot('18-scanner');
}

// Глубокие пещеры: темнота и хищник
{
  game.scanT = 0;
  game.scanTargets = [];
  const Wr = game.world;
  // точка в глубине: воздух с полом под ним (терминалов в M8.3 больше нет)
  let t = null;
  for (let y = CFG.layers.deepTopRow + 6; y < CFG.layers.deepTopRow + 40 && !t; y++) {
    for (let x = 300; x < 420; x++) {
      if (!Wr.solid(x, y) && !Wr.solid(x, y - 1) && Wr.solid(x, y + 1)) { t = { tx: x, ty: y }; break; }
    }
  }
  // расчищаем пятачок — как будто сюда докопались
  for (let y = t.ty - 2; y <= t.ty + 1; y++) {
    for (let x = t.tx - 6; x <= t.tx + 7; x++) Wr.set(x, y, 0, false);
  }
  Wr.set(t.tx, t.ty + 1, 2, false);
  game.tiles.flush();
  P.x = (t.tx - 5) * 32;
  P.y = (t.ty + 1) * 32 - P.h;
  P.vx = P.vy = 0;
  game.camera.snap(P);
  game.crawlers.length = 0;
  const dc = new sandbox.__clsM3.Crawler((t.tx + 4) * 32, (t.ty + 1) * 32 - CFG.crawler.h);
  dc.home = { x: dc.cx, y: dc.cy };
  game.crawlers.push(dc);
  frames(20);
  game.camera.snap(P);
  frames(2);
  shot('19-deep-caves');
}

// Меню крафта: четыре рецепта, курсор на сканере
{
  const bx = Math.floor(P.cx / 32);
  game.world.set(bx, P.y < 0 ? 0 : Math.floor(P.cy / 32), 5, true);
  game.craftOpen = true;
  game.craftT = 1;
  game.craftSel = 3;
  game.player.hasLaser = false;
  game.player.hasArmor = false;
  game.player.hasGravityGun = false;
  game.player.hasScanner = false;
  game.inventory.counts[3] = 9; game.inventory.counts[2] = 7; game.inventory.counts[4] = 2;
  frames(2);
  shot('20-craft-scanner');
  game.craftOpen = false;
}
// ---------- M6: визуал ----------

// 21: копание камня — искры на месте слома (сцена на поверхности, там свет есть)
{
  game.craftOpen = false;
  const Wr = game.world;
  const surf = Wr.surfaceRow;
  for (let y = surf - 3; y <= surf + 6; y++) {
    for (let x = 30; x <= 50; x++) Wr.set(x, y, TILE.EMPTY, false);
  }
  for (let y = surf + 7; y <= surf + 12; y++) {
    for (let x = 30; x <= 50; x++) Wr.set(x, y, TILE.STONE, false);
  }
  Wr.set(38, surf + 7, TILE.FERRITE, false);
  game.tiles.flush();
  P.x = 38 * TS; P.y = (surf + 7) * TS - P.h;
  P.vx = P.vy = 0;
  game.camera.snap(P);
  frames(2);
  const dtx = 38, dty = surf + 7;
  const mt = mouseToTile(dtx, dty);
  mouseDown(mt.x, mt.y);
  frames(4);
  // искры и пыль рождаются в момент слома — фиксируем кадр сразу после него
  game.particles.list.length = 0;
  game.particles.dig(TILE.STONE, dtx * TS + 16, dty * TS + 16, Math.random);
  game.particles.dig(TILE.STONE, (dtx + 1) * TS + 12, dty * TS + 18, Math.random);
  // два шага частиц: искры должны разлететься, иначе в кадре одна белая клякса
  game.particles.update(0.05, 1);
  game.particles.update(0.05, 1);
  game.render();
  shot('21-dig-sparks');
  {
    const z = CFG.camera.zoom;
    const sx = (dtx * TS - game.camera.x) * z - 70;
    const sy = (dty * TS - game.camera.y) * z - 70;
    const c2 = createCanvas(300, 240);
    const x2 = c2.getContext('2d');
    x2.imageSmoothingEnabled = false;
    x2.drawImage(view, Math.max(0, sx), Math.max(0, sy), 300, 240, 0, 0, 600, 480);
    fs.writeFileSync(new URL('../screenshots/21b-sparks-crop.png', import.meta.url), c2.toBuffer('image/png'));
  }
  mouseUp();
  frames(20);
}

// 22: раненый хищник — трещины на панцире, полоска здоровья
{
  game.crawlers.length = 0;
  const cx = P.cx + 5 * 32;
  const cr = new sandbox.__clsM3.Crawler(cx, P.y - 4 + P.h - CFG.crawler.h);
  cr.home = { x: cr.cx, y: cr.cy };
  cr.hp = 20;
  cr.hurtFlash = 0.2;
  game.crawlers.push(cr);
  game.camera.snap(P);
  frames(1);
  game.crawlers[0].hurtFlash = 0.2;
  game.render();
  shot('22-crawler-hurt');
  game.crawlers.length = 0;
}

// 23: подбор осколка — вспышка и искры
{
  const { Drop } = sandbox.__cls;
  game.particles.list.length = 0;
  game.drops.push(new Drop(P.cx + 4, P.cy, TILE.FERRITE));
  frames(1);
  game.particles.pickup(TILE.FERRITE, P.cx, P.cy, Math.random);
  game.render();
  shot('23-pickup-burst');
  game.drops.length = 0;
  game.particles.list.length = 0;
}

// 24: свет в глубине — фонарь и кристаллы в одном кадре
{
  const Wr = game.world;
  // ищем жилу RESONITE в кристальной зоне: кадр про свет, а не про руду
  let t = null;
  for (let y = CFG.biomes.crystalFromRow + 4; y < CFG.layers.deepTopRow + 60 && !t; y++) {
    for (let x = 240; x < 560; x++) {
      if (Wr.get(x, y) === TILE.RESONITE) { t = { tx: x, ty: y }; break; }
    }
  }
  for (let y = t.ty - 3; y <= t.ty + 1; y++) {
    for (let x = t.tx - 7; x <= t.tx + 6; x++) Wr.set(x, y, TILE.EMPTY, false);
  }
  for (let x = t.tx - 7; x <= t.tx + 6; x++) {
    Wr.set(x, t.ty + 2, TILE.STONE, false);
    Wr.set(x, t.ty + 3, TILE.STONE, false);
  }
  Wr.set(t.tx - 4, t.ty + 2, TILE.FERRITE, false);
  Wr.set(t.tx + 3, t.ty + 2, TILE.FERRITE, false);
  Wr.set(t.tx - 6, t.ty + 3, TILE.FERRITE, false);
  game.tiles.flush();
  P.x = (t.tx - 2) * 32;
  P.y = (t.ty + 2) * 32 - P.h;
  P.vx = P.vy = 0;
  game.camera.snap(P);
  frames(20);
  game.camera.snap(P);
  game.render();
  shot('24-light-sources');
}

// 33: M8.1 — Руины: металлические стены, балки и турель на палубе
{
  const Wr = game.world;
  const cs = CFG.world.chunk;
  let spot = null;
  for (let cy = 0; cy < Wr.chunksY && !spot; cy++) {
    for (let cx = (CFG.biomes.ruinsFromX / cs) | 0; cx < Wr.chunksX && !spot; cx++) {
      const ch = Wr.ensureChunk(cx, cy);
      if (ch.turrets.length) spot = ch.turrets[0];
    }
  }
  if (spot) {
    Wr.updateChunks({ x: spot.tx * TS - 320, y: spot.ty * TS - 180, w: 640, h: 360 });
    game.syncTurrets();
    P.x = (spot.tx - 3) * TS; P.y = (spot.ty + 1) * TS - P.h; P.vx = P.vy = 0;
    game.camera.snap(P);
    frames(90);                 // турель успевает прицелиться и выстрелить
    game.camera.snap(P);
    // турель бьёт по игроку — для кадра гасим красную вспышку урона
    game.hurtScreen = 0; P.hurtT = 0; game.camera.shake(0);
    game.render();
    shot('33-ruins-turret');
  }
}

// 34: M8.1 — RESONITE в кристальных пещерах (глубина 50+)
{
  game.tide.setPhase(0); game.tide.applyPhase('STABLE');
  game.skyWarn = 0; game.skyCat = 0; game.hurtScreen = 0;
  P.health = P.maxHealth; P.invuln = 0;
  const Wr = game.world;
  // ищем не одну жилу, а гроздь: в кадр должно попасть 3+ кристалла
  let spot = null, best = 0;
  for (let y = CFG.biomes.crystalFromRow + 4; y < CFG.layers.deepTopRow + 60; y++) {
    for (let x = 200; x < 580; x++) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (Wr.get(x + dx, y + dy) === TILE.RESONITE) n++;
      }
      if (n > best && Wr.solid(x, y + 1) && !Wr.solid(x, y) && !Wr.solid(x, y - 1)) {
        best = n; spot = { x, y };
      }
    }
  }
  if (spot) {
    P.x = (spot.x - 5) * TS; P.y = (spot.y + 1) * TS - P.h; P.vx = P.vy = 0;
    game.camera.snap(P);
    frames(30);
    game.camera.snap(P);
    game.crawlers.length = 0;    // хищники в глубине оставили красную вспышку урона
    game.hurtScreen = 0; P.hurtT = 0; P.health = P.maxHealth;
    game.render();
    shot('34-resonite');
  }
}

// 35: M9 — лазерный пистолет: луч, вспышка, попадание в жука
{
  game.tide.setPhase(0); game.tide.applyPhase('STABLE');
  game.hurtScreen = 0; P.hurtT = 0; P.health = P.maxHealth; P.invuln = 0;
  P.hasLaserPistol = true;
  game.setWeapon('pistol', true);
  game.setMode(4);
  game.craftOpen = false; game.lore = null;

  const row = game.world.surfaceRow;
  const ptx = Math.floor(P.cx / TS);
  for (let tx = ptx - 2; tx <= ptx + 7; tx++) {
    for (let ty = row - 3; ty <= row - 1; ty++) game.world.set(tx, ty, TILE.EMPTY, false);
    game.world.set(tx, row, TILE.STONE, false);
  }
  game.tiles.flush();
  P.y = row * TS - P.h; P.vx = P.vy = 0;
  game.camera.snap(P);

  const { Crawler } = sandbox.__clsM3;
  const bug = new Crawler(P.cx + 96, P.cy - 6);
  bug.hp = bug.maxHp = 60;        // один выстрел не убивает — жук остаётся в кадре
  bug.state = 'AGGRO';
  bug.vx = bug.vy = 0;
  game.crawlers = [bug];
  frames(6);
  bug.x = P.cx + 96; bug.vx = 0;

  game.player.fireCd = 0;
  game.fireWeapon({ x: bug.cx, y: bug.cy });
  frames(1);
  shot('35-laser-beam');
}

// 36: M9 — сломанная турель: искры, дым, лут на палубе
{
  const Wr = game.world;
  const cs = CFG.world.chunk;
  let spot = null;
  for (let cy = 0; cy < Wr.chunksY && !spot; cy++) {
    for (let cx = (CFG.biomes.ruinsFromX / cs) | 0; cx < Wr.chunksX && !spot; cx++) {
      const ch = Wr.ensureChunk(cx, cy);
      if (ch.turrets.length) spot = ch.turrets[0];
    }
  }
  if (spot) {
    game.deadTurrets.clear();
    if (game.turretMap) game.turretMap.clear();
    Wr.updateChunks({ x: spot.tx * TS - 320, y: spot.ty * TS - 180, w: 640, h: 360 });
    game.syncTurrets(true);
    const t = game.turrets.find(x => x.tx === spot.tx && x.ty === spot.ty);
    P.x = (spot.tx - 4) * TS; P.y = (spot.ty + 1) * TS - P.h; P.vx = P.vy = 0;
    P.health = P.maxHealth; P.invuln = 1;
    game.camera.snap(P);
    if (t) {
      P.x = t.cx - 92;              // ближе к стволу: попадаем в кроп
      game.camera.snap(P);
      game.damageTurret(t, t.hp, P.cx);
      frames(40);                   // лут падает на палубу, дым поднимается
      game.camera.snap(P);
      game.hurtScreen = 0; P.hurtT = 0;
      game.render();
      // кроп вокруг турели: сломанное тело, искры и лут видно крупно
      const z = CFG.camera.zoom || 1;
      const cx0 = Math.max(0, (t.cx - game.camera.x) * z - 200);
      const cy0 = Math.max(0, (t.cy - game.camera.y) * z - 150);
      const cw = Math.min(W - cx0, 400), ch = Math.min(H - cy0, 280);
      const c = createCanvas(cw * 2, ch * 2);
      const cc = c.getContext('2d');
      cc.imageSmoothingEnabled = false;
      cc.drawImage(view, cx0, cy0, cw, ch, 0, 0, cw * 2, ch * 2);
      fs.writeFileSync(new URL('../screenshots/36-turret-broken.png', import.meta.url), c.toBuffer('image/png'));
      console.log('saved 36-turret-broken', 'лут:',
        game.drops.map(d => d.type + '@' + Math.round(d.x) + ',' + Math.round(d.y)).join(' '));
    }
  }
}

// 37: M9 — меню крафта с пистолетом: строка по карману
{
  // Menu открывается только у верстака: ставим его рядом с игроком
  const feet = Math.floor((P.y + P.h) / TS);
  const btx = Math.floor(P.cx / TS) - 3;
  for (let i = 0; i < 2; i++) {
    game.world.set(btx + i, feet - 1, TILE.WORKBENCH, true);
    game.world.set(btx + i, feet - 2, TILE.EMPTY, false);
    game.world.set(btx + i, feet - 3, TILE.EMPTY, false);
  }
  game.tiles.flush();
  P.health = P.maxHealth; P.invuln = 1;
  frames(2);

  game.inventory.counts[TILE.FERRITE] = 10;
  game.inventory.counts[ITEM.RESONITE] = 5;
  game.inventory.counts[TILE.STONE] = 15;
  const bIdx = CFG.recipes.findIndex(r => r.id === 'pistol');
  game.player.hasLaserPistol = false;      // показываем ещё не скрафченную строку
  key('KeyC'); frames(1); key('KeyC', false);
  game.noticeT = 0;
  frames(2);
  // выделение ставим после кадров: updateCraft тянет выбор за мышью
  game.craftSel = bIdx;
  mouseMove(640, 400);           // курсор-призрак прячется за панелью
  game.noticeT = 0; game.tooFarT = 0; game.denyT = 0;
  game.craftT = 1;
  game.render();
  console.log('меню крафта открыто:', game.craftOpen, '| строк:', CFG.recipes.length);
  shot('37-craft-pistol');
  game.craftOpen = false;
  game.player.hasLaserPistol = true;
}

// 38: M9 — индикатор оружия в правом нижнем углу (кроп)
{
  game.player.hasGravityGun = true;
  game.setWeapon('grav', true);
  P.hasLaserPistol = true;
  frames(2);
  const m = game.weaponPanelMetrics();
  const zf = CFG.camera.zoom || 1;
  const sx = Math.max(0, m.x - 20), sy = Math.max(0, m.y - 24);
  const cw = Math.min(W - sx, m.w + 60), ch = Math.min(H - sy, m.h + 110);
  const c = createCanvas(cw * 2, ch * 2);
  const cc = c.getContext('2d');
  cc.imageSmoothingEnabled = false;
  cc.drawImage(view, sx, sy, cw, ch, 0, 0, cw * 2, ch * 2);
  fs.writeFileSync(new URL('../screenshots/38-weapon-indicator.png', import.meta.url), c.toBuffer('image/png'));
  console.log('saved 38-weapon-indicator');
  game.setWeapon('pistol', true);
}

console.log('done');
