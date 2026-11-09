// Headless-проверка narrative.js: сюжет прогоняется поверх настоящей игры.
// Ни одна строка gravity-void.html не меняется — подключаем файл так же,
// как это сделает браузер: следующим <script> на той же странице.
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8');
let SRC = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const NARR = fs.readFileSync(new URL('../narrative.js', import.meta.url), 'utf8');

const grad = { addColorStop() {} };
const calls = { fillText: 0 };

class FakeCtx {
  constructor(c) { this.canvas = c; }
  fillRect() {} clearRect() {} drawImage() {}
  createLinearGradient() { return grad; } createRadialGradient() { return grad; }
  beginPath() {} moveTo() {} lineTo() {} arcTo() {} arc() {} closePath() {}
  quadraticCurveTo() {} bezierCurveTo() {} ellipse() {} createPattern() { return null; }
  fill() {} stroke() {} strokeRect() {} save() {} restore() {}
  translate() {} scale() {} rotate() {} setTransform() {} setLineDash() {} clip() {} rect() {}
  measureText(t) { return { width: t.length * 6 }; }
  fillText() { calls.fillText++; }
}

class FakeCanvas {
  constructor(kind = 'offscreen') { this.kind = kind; this.width = 1280; this.height = 720; this.style = {}; }
  getContext() { if (!this._ctx) this._ctx = new FakeCtx(this); return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(t, fn) { if (!this._l) this._l = {}; (this._l[t] = this._l[t] || []).push(fn); }
}

const view = new FakeCanvas('view');
const listeners = {};

const sandbox = {
  console, Math, Date, JSON, Uint8Array, Float32Array,
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  requestAnimationFrame: () => 1,
  document: {
    createElement: () => new FakeCanvas(),
    getElementById: () => view,
    addEventListener: () => {},
    readyState: 'complete'
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
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720
  },
  setTimeout, clearTimeout
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

// 1) игра ровно так, как её видит браузер
SRC += '\n;globalThis.__game = game; globalThis.__CFG = CFG; globalThis.__TILE = TILE;'
     + ';globalThis.Game = Game;';
vm.runInContext(SRC, ctx, { filename: 'gravity-void.html' });

const game = sandbox.__game;
const CFG = sandbox.__CFG;
const TILE = sandbox.__TILE;
const TS = CFG.tile;

// 2) сюжет: тот же скоуп верхнего уровня, что и у игры — как второй <script>
vm.runInContext(NARR, ctx, { filename: 'narrative.js' });
vm.runInContext('globalThis.__narrative = game.narrative;', ctx);

const narrative = game.narrative;
const N = sandbox.window.Narrative;

const results = [];
const ok = (name, cond, info = '') => {
  results.push({ name, pass: !!cond, info });
  if (!cond) console.log('FAIL:', name, info);
};

function key(code, down = true) {
  listeners[down ? 'keydown' : 'keyup']({ code, repeat: false, preventDefault() {} });
}
function tapKey(code) { key(code, true); game.update(CFG.step); key(code, false); }
function frames(n) { for (let i = 0; i < n; i++) game.update(CFG.step); }

// ---------------------------------------------------------------- подключение
ok('M8.2: narrative.js подключился к игре', !!narrative, 'game.narrative');
ok('M8.2: игра не изменилась — терминалы на месте', game.terminals.length === 3);
ok('M8.2: классы сюжета доступны', typeof N === 'function' &&
   typeof sandbox.window.QuestLog === 'function' && typeof sandbox.window.Ship === 'function' &&
   typeof sandbox.window.Fragment === 'function');
ok('M8.2: корабль — экземпляр Ship', narrative.ship instanceof sandbox.window.Ship);
ok('M8.2: журнал — экземпляр QuestLog', narrative.log instanceof sandbox.window.QuestLog);

// ---------------------------------------------------------------- корабль на карте
{
  const s = narrative.ship;
  const w = game.world;
  let clear = true;
  for (let tx = s.tx0; tx <= s.tx1; tx++) {
    for (let ty = s.floorRow - s.h; ty <= s.floorRow - 1; ty++) {
      if (w.solid(tx, ty)) clear = false;
    }
  }
  ok('M8.2: под кораблём ровная площадка без породы', clear,
     `${s.tx0}..${s.tx1}, ряды ${s.floorRow - s.h}..${s.floorRow - 1}`);
  ok('M8.2: корабль стоит на поверхности, рядом со стартом',
     s.floorRow === w.surfaceRow && s.tx0 > CFG.spawn.playerTileX && s.tx1 < 60,
     `старт ${CFG.spawn.playerTileX}, корабль ${s.tx0}..${s.tx1}`);
}

// ---------------------------------------------------------------- меню ремонта
{
  const p = game.player;
  const s = narrative.ship;
  p.x = s.doorX - p.w / 2;
  p.y = s.floorRow * TS - p.h;
  p.vx = p.vy = 0;
  p.gravityTarget = 1;
  game.camera.snap(p);
  frames(4);

  ok('M8.2: у люка подсказка «Ремонт корабля»',
     narrative.near && narrative.near.kind === 'ship', narrative.near && narrative.near.kind);

  // E открывает меню ровно через interact(game)
  tapKey('KeyE');
  ok('M8.2: E у корабля открывает меню ремонта', narrative.menu === 'ship', `menu=${narrative.menu}`);
  ok('M8.2: меню ремонта — четыре строки', N.REPAIR_STAGES.length + 1 === 4);

  // без ресурсов стадия не собирается
  for (const r of CFG.resources) game.inventory.counts[r.id] = 0;
  narrative.menuSel = 0;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  ok('M8.2: без ресурсов стадия 0 не собирается',
     s.repairStage === 0 && narrative.menu === 'ship', `stage=${s.repairStage}`);

  // цены ровно как в задании
  ok('M8.2: стадия 0 — 20 FERRITE + 10 STONE',
     N.REPAIR_STAGES[0].cost[3] === 20 && N.REPAIR_STAGES[0].cost[2] === 10);
  ok('M8.2: стадия 1 — 30 STONE + 10 FERRITE',
     N.REPAIR_STAGES[1].cost[2] === 30 && N.REPAIR_STAGES[1].cost[3] === 10);
  ok('M8.2: стадия 2 — 5 RESONITE',
     N.REPAIR_STAGES[2].cost[8] === 5);
}

// ---------------------------------------------------------------- три стадии и награды
{
  const s = narrative.ship;
  const p = game.player;

  game.inventory.counts[TILE.FERRITE] = 40;
  game.inventory.counts[TILE.STONE] = 50;
  const fer0 = game.inventory.counts[TILE.FERRITE];
  const st0 = game.inventory.counts[TILE.STONE];

  narrative.menuSel = 0;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  frames(2);
  ok('M8.2: стадия 0 собрана — питание', s.repairStage === 1, `stage=${s.repairStage}`);
  ok('M8.2: списано 20 FERRITE и 10 STONE',
     game.inventory.counts[TILE.FERRITE] === fer0 - 20 && game.inventory.counts[TILE.STONE] === st0 - 10,
     `${fer0}→${game.inventory.counts[TILE.FERRITE]}, ${st0}→${game.inventory.counts[TILE.STONE]}`);
  ok('M8.2: награда стадии 0 — рецепт в журнале',
     narrative.log.blueprints.indexOf('АВАРИЙНЫЙ РЕЗАК') >= 0, narrative.log.blueprints.join(','));
  ok('M8.2: награда стадии 0 — очки', narrative.log.score >= 500, `score=${narrative.log.score}`);
  ok('M8.2: награда стадии 0 — резак в руках', p.hasLaser === true);

  // стадии идут по порядку: пытаемся перескочить
  narrative.menu = 'ship';
  narrative.menuSel = 2;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  ok('M8.2: стадию нельзя перескочить', s.repairStage === 1, `stage=${s.repairStage}`);

  // стадия 1
  narrative.menuSel = 1;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  frames(2);
  ok('M8.2: стадия 1 собрана — корпус', s.repairStage === 2, `stage=${s.repairStage}`);
  ok('M8.2: броня выдана наградой', p.hasArmor === true);

  // стадия 2 требует резонит: без него не собирается
  narrative.menu = 'ship';
  narrative.menuSel = 2;
  game.inventory.counts[8] = 0;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  ok('M8.2: без резонита двигатель не собрать', s.repairStage === 2, `stage=${s.repairStage}`);

  // меню после неудачной сборки остаётся открытым — закрываем перед походом
  ok('M8.2: после неудачи меню остаётся открытым (видно, чего не хватает)',
     narrative.menu === 'ship');
  tapKey('Escape');
  ok('M8.2: Esc закрывает меню ремонта', narrative.menu === null);

  // ---------------------------------------------------------------- резонит
  const node = narrative.nodes[0];
  p.x = node.tx * TS; p.y = (node.ty + 1) * TS - p.h;
  p.vx = p.vy = 0;
  game.camera.snap(p);
  frames(3);
  ok('M8.2: у жилы резонита есть подсказка',
     narrative.near && narrative.near.kind === 'resonite', narrative.near && narrative.near.kind);
  tapKey('KeyE');
  ok('M8.2: резонит добывается по E', game.inventory.counts[8] === node.amount,
     `резонит=${game.inventory.counts[8]}`);

  // добираем резонит с двух других жил
  for (const n of narrative.nodes) {
    if (n.taken) continue;
    p.x = n.tx * TS; p.y = (n.ty + 1) * TS - p.h;
    game.camera.snap(p);
    frames(2);
    tapKey('KeyE');
  }
  ok('M8.2: в жилах лежит запас резонита (6 при нужде 5)',
     game.inventory.counts[8] >= 5, `резонит=${game.inventory.counts[8]}`);

  // теперь двигатель
  p.x = s.doorX - p.w / 2; p.y = s.floorRow * TS - p.h;
  game.camera.snap(p);
  frames(2);
  narrative.menu = 'ship';
  narrative.menuSel = 2;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  frames(2);
  ok('M8.2: двигатель собран — стадия 3', s.repairStage === 3, `stage=${s.repairStage}`);
  ok('M8.2: ремонт закончен, рецептов три',
     narrative.log.blueprints.length === 3, narrative.log.blueprints.join(' · '));
  ok('M8.2: пушка выдана наградой', p.hasGravityGun === true);
}

// ---------------------------------------------------------------- фрагменты ядра
{
  const p = game.player;
  const s = narrative.ship;

  ok('M8.2: без фрагментов финальный аккорд закрыт',
     s.canActivateCore(game) === false);
  narrative.menu = 'ship';
  narrative.menuSel = 3;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  ok('M8.2: активация без ядра не срабатывает', s.coreActive === false);
  tapKey('Escape');
  ok('M8.2: после неудачной активации меню закрывается', narrative.menu === null);

  ok('M8.2: строкa журнала — «Ядро: 0/3»', narrative.log.text() === 'Ядро: 0/3', narrative.log.text());

  // первый фрагмент
  const f0 = narrative.fragments[0];
  p.x = f0.tx * TS; p.y = (f0.ty + 1) * TS - p.h;
  p.vx = p.vy = 0;
  game.camera.snap(p);
  frames(3);
  ok('M8.2: фрагмент виден под рукой',
     narrative.near && narrative.near.kind === 'fragment', narrative.near && narrative.near.kind);
  tapKey('KeyE');
  ok('M8.2: фрагмент собирается по E', f0.taken === true);
  ok('M8.2: счётчик стал «Ядро: 1/3»', narrative.log.text() === 'Ядро: 1/3', narrative.log.text());

  // второй E по тому же месту ничего не добавляет
  tapKey('KeyE');
  ok('M8.2: повторный сбор не накручивает счётчик', narrative.log.fragments === 1,
     `фрагментов=${narrative.log.fragments}`);

  // все три
  for (const f of narrative.fragments) {
    if (f.taken) continue;
    p.x = f.tx * TS; p.y = (f.ty + 1) * TS - p.h;
    game.camera.snap(p);
    frames(2);
    tapKey('KeyE');
  }
  ok('M8.2: собраны все три фрагмента', narrative.log.fragments === 3);
  ok('M8.2: журнал показывает 3/3', narrative.log.text() === 'Ядро: 3/3', narrative.log.text());
  ok('M8.2: с ядром финальный аккорд открыт', s.canActivateCore(game) === true);

  // финальный аккорд
  p.x = s.doorX - p.w / 2; p.y = s.floorRow * TS - p.h;
  game.camera.snap(p);
  frames(2);
  narrative.menu = 'ship';
  narrative.menuSel = 3;
  key('Enter', true); game.update(CFG.step); key('Enter', false);
  ok('M8.2: финальный аккорд срабатывает', s.coreActive === true);
  ok('M8.2: показана финальная панель', narrative.ending === true);
  ok('M8.2: за финал дают очки', narrative.log.score >= 2000, `score=${narrative.log.score}`);
  frames(10);
  tapKey('Escape');
  ok('M8.2: финальную панель можно закрыть', narrative.ending === false);
}

// ---------------------------------------------------------------- терминалы-архивы
{
  const a = narrative.archives[2];         // протокол «Присвоение»
  const p = game.player;
  p.x = a.tx * TS; p.y = (a.ty + 1) * TS - p.h;
  p.vx = p.vy = 0;
  game.camera.snap(p);
  frames(3);
  ok('M8.2: у архива есть подсказка',
     narrative.near && narrative.near.kind === 'archive', narrative.near && narrative.near.kind);
  const before = narrative.log.archives;
  tapKey('KeyE');
  ok('M8.2: E открывает панель архива', !!narrative.reading && narrative.reading === a);
  ok('M8.2: заголовок архива — протокол «Присвоение»', /ПРИСВОЕНИЕ/.test(a.title), a.title);
  ok('M8.2: текст терминала 3 — протокол «Присвоение»',
     /Планета должна стать нашим активом/.test(a.body));
  ok('M8.2: архив не открывает чужую панель лора игры', game.lore === null);
  ok('M8.2: прочитанный архив учтён в журнале', narrative.log.archives === before + 1);
  tapKey('Escape');
  ok('M8.2: панель архива закрывается Esc', narrative.reading === null);

  ok('M8.2: текстов пять, и они про сюжет',
     N.ARCHIVES.length === 5 &&
     /разорвали оболочку ядра/.test(N.ARCHIVES[0].body.join(' ')) &&
     /Экспедиция ушла вглубь/.test(N.ARCHIVES[1].body.join(' ')) &&
     /Планета должна стать нашим активом/.test(N.ARCHIVES[2].body.join(' ')) &&
     /Нужны 3 фрагмента/.test(N.ARCHIVES[3].body.join(' ')) &&
     /Финальный аккорд/.test(N.ARCHIVES[4].body.join(' ')));
}

// ---------------------------------------------------------------- E не конфликтует с игрой
{
  // терминал игры читается по E, если сюжетного объекта рядом нет
  const t = game.terminals.find(x => !x.read) || game.terminals[0];
  const p = game.player;
  t.read = false;
  p.x = t.x + CFG.terminal.w / 2 - p.w / 2;
  p.y = (t.ty + 1) * TS - p.h;
  p.vx = p.vy = 0;
  game.camera.snap(p);
  frames(2);
  tapKey('KeyE');
  ok('M8.2: E у терминала игры по-прежнему работает',
     !!game.lore || t.read === true, `lore=${!!game.lore} read=${t.read}`);
  if (game.lore) tapKey('Escape');
}

// ---------------------------------------------------------------- сохранение прогресса
{
  const raw = sandbox.localStorage.getItem(N.KEY);
  ok('M8.2: прогресс сюжета пишется в localStorage', !!raw);
  const d = JSON.parse(raw);
  ok('M8.2: в сейве есть стадия корабля и фрагменты', d.ship.stage === 3 && d.log.fragments === 3);
  // новая игра подхватывает сейв
  // В песочнице window хранит только один обработчик на тип: новая игра
  // перетирает keydown первой. Запоминаем и возвращаем — иначе все
  // последующие нажатия уходили бы в g2, а не в игру под тестом
  const savedKeydown = listeners.keydown;
  const g2 = new sandbox.Game(view);
  g2.update(CFG.step);            // первый кадр сам подключает сюжет
  listeners.keydown = savedKeydown;
  ok('M8.2: новая игра читает сюжет из сейва',
     g2.narrative.ship.repairStage === 3 && g2.narrative.log.fragments === 3,
     `stage=${g2.narrative.ship.repairStage}, ядро=${g2.narrative.log.fragments}`);
}

// ---------------------------------------------------------------- сброс мира
{
  const p = game.player;
  p.x = narrative.ship.doorX;
  game.camera.snap(p);
  frames(2);
  narrative.menu = 'ship';
  key('Backspace', true); game.update(CFG.step); key('Backspace', false);
  frames(3);
  ok('M8.2: Backspace сбрасывает и сюжет',
     narrative.ship.repairStage === 0 && narrative.log.fragments === 0 && narrative.menu === null,
     `stage=${narrative.ship.repairStage}, ядро=${narrative.log.fragments}`);
}

// ---------------------------------------------------------------- отрисовка
{
  try { narrative.save(); console.log('[dbg] после narrative.save:', [...sandbox.localStorage._mem.keys()].join(',')); }
  catch (e) { console.log('[dbg] save threw:', e.message); }
  const before = calls.fillText;
  frames(3);
  game.render();
  ok('M8.2: сюжет рисуется и не падает', calls.fillText > before,
     `fillText ${before} → ${calls.fillText}`);

  // меню ремонта влезает в экран и на узком экране масштабируется
  const box = narrative.menuLayout(game);
  ok('M8.2: панель ремонта влезает в экран', box.w <= game.vw && box.h <= game.vh,
     `${box.w.toFixed(0)}×${box.h.toFixed(0)}`);
  const oldVw = game.vw;
  game.vw = 430;
  const small = narrative.menuLayout(game);
  game.vw = oldVw;
  ok('M8.2: на телефоне панель ремонта сжимается', small.s < 1, `s=${small.s.toFixed(2)}`);
}

// ---------------------------------------------------------------- итог
const passed = results.filter(r => r.pass).length;
console.log('\n=== РЕЗУЛЬТАТ ===');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
console.log(`\n${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);
