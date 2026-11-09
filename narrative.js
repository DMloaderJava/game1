/* ============================================================
   GRAVITY: VOID — M8.2 «Сюжет и Ремонт»
   narrative.js — сюжетный слой: корабль, журнал квестов, терминалы, фрагменты ядра.

   Файл самостоятельный: он ничего не знает о внутренностях gravity-void.html,
   а цепляется к уже созданному экземпляру игры через его публичные поля
   (player, world, inventory, input, camera, notice, particles) и пять обёрток
   над методами Game. Поэтому сама игра остаётся нетронутой — подключение
   это одна строчка <script src="narrative.js"></script> после игры.

   Всё нарисовано в том же Canvas и тем же стилем, что и остальная игра.
   Только Vanilla JS, только классы, никаких зависимостей.
   ============================================================ */

(function (global) {
  "use strict";

  /* ------------------------------------------------------------
     Данные сюжета. Координаты — фиксированные: мир генерируется
     одним и тем же сидом (CFG.seed), поэтому точки стабильны.
     Каждая точка проверена на «есть пол и два тайла воздуха».
     ------------------------------------------------------------ */

  // Резонит — сюжетный ресурс. В игре id 0..5 заняты, поэтому берём 8.
  // Он живёт в инвентаре рядом с остальными, но в HUD игры не попадает:
  // свой счётчик рисует журнал (иначе пришлось бы править gravity-void.html).
  var RESONITE = 8;

  // Корабль: 10 тайлов корпуса на поверхности, у самого старта игрока
  var SHIP = {
    tx0: 38,            // левый борт
    tx1: 47,            // правый борт
    floorRow: 17,       // рядов ниже — твёрдый пол (surfaceRow)
    h: 4,               // высота корпуса в тайлах
    doorTile: 42,       // где «люк»: отсюда считается радиус взаимодействия
    radius: 3.6         // тайлов до люка, чтобы открыть меню ремонта
  };

  // Три фрагмента ядра — по одному на каждую треть карты.
  // Лежат на поверхности, в зале, на виду: их ищут глазами, а не сканером.
  var FRAGMENT_SPOTS = [
    { tx: 59, ty: 13 },
    { tx: 103, ty: 13 },
    { tx: 167, ty: 13 }
  ];

  // Резонит: три жилы в Глубоких пещерах. В сумме 6 единиц при нужде в 5 —
  // в игре всегда должен оставаться запас на ошибку.
  var RESONITE_NODES = [
    { tx: 51, ty: 76, amount: 2 },
    { tx: 95, ty: 82, amount: 2 },
    { tx: 147, ty: 65, amount: 2 }
  ];

  // Пять терминалов «Архива экспедиции». Тексты — сюжет: от дневника капитана
  // до финального аккорда. Первые строки — те, что заданы в задании, дословно;
  // ниже — то, что делает из них историю, а не список фактов.
  var ARCHIVES = [
    {
      id: 'captain',
      tx: 27, ty: 12,
      title: 'АРХИВ 01 · ДНЕВНИК КАПИТАНА',
      short: 'дневник капитана',
      body: [
        'Дневник капитана. Мы разорвали оболочку ядра. Гравитация сошла с ума.',
        'Третьи сутки небо идёт вверх. То, что мы приняли за крылья, — оторванные плиты.',
        'Если кто-то это читает: ядро не выключено, оно обижено.'
      ]
    },
    {
      id: 'expedition',
      tx: 119, ty: 11,
      title: 'АРХИВ 02 · ЭКСПЕДИЦИЯ',
      short: 'экспедиция',
      body: [
        'Экспедиция ушла вглубь. Мы нашли проход.',
        'Пятый ряд породы — ловушка, пятидесятый — дверь. Дальше начинаются пещеры,',
        'которых нет ни на одной карте. Мы спускаемся. Не ждите нас раньше прилива.'
      ]
    },
    {
      id: 'appropriation',
      tx: 76, ty: 53,
      title: 'АРХИВ 03 · ПРОТОКОЛ «ПРИСВОЕНИЕ»',
      short: 'протокол «Присвоение»',
      body: [
        'Протокол «Присвоение». Планета должна стать нашим активом.',
        'Пункт 4: местное население — ресурс. Пункт 7: гравитационные приливы',
        'списывать на амортизацию. Пункт 12: ядро транспортируется в разобранном виде.',
        'Подпись: Совет. Печать. Дата — за три дня до первого разрыва.'
      ]
    },
    {
      id: 'assembly',
      tx: 55, ty: 67,
      title: 'АРХИВ 04 · ИНСТРУКЦИЯ ПО СБОРКЕ',
      short: 'инструкция по сборке',
      body: [
        'Инструкция по сборке. Нужны 3 фрагмента.',
        'Фрагмент — это не деталь. Это кусок поля, который держит ядро в узде.',
        'Первый нашли у борта, второй ушёл вглубь вместе с экспедицией, третий —',
        'там, где прилив выворачивает породу наизнанку. Резонит — в жилах, под ними.'
      ]
    },
    {
      id: 'finale',
      tx: 143, ty: 93,
      title: 'АРХИВ 05 · ФИНАЛЬНЫЙ АККОРД',
      short: 'финальный аккорд',
      body: [
        'Финальный аккорд. Активация ядра.',
        'Соберите три фрагмента, замените привод, разбудите двигатель.',
        'Ядро отвечает не на команду, а на приглашение. Мы так и не научились',
        'отличать одно от другого — и потому оставили это вам.'
      ]
    }
  ];

  /* ------------------------------------------------------------
     Журнал квестов. Знает про фрагменты ядра, терминалы, очки
     и открытые рецепты; умеет отдать строку для HUD.
     ------------------------------------------------------------ */

  class QuestLog {
    constructor() {
      this.fragmentsTotal = FRAGMENT_SPOTS.length;
      this.fragments = 0;
      this.archivesTotal = ARCHIVES.length;
      this.archives = 0;
      this.score = 0;
      this.blueprints = [];      // открытые рецепты — строки для меню корабля
      this.started = false;      // игрок уже видел вступление
    }

    get coreDone() { return this.fragments >= this.fragmentsTotal; }

    addFragment(n) {
      this.fragments = Math.min(this.fragmentsTotal, this.fragments + (n === undefined ? 1 : n));
      return this.fragments;
    }

    addArchive() {
      this.archives = Math.min(this.archivesTotal, this.archives + 1);
      return this.archives;
    }

    addScore(n) {
      this.score = Math.max(0, this.score + (n || 0));
      return this.score;
    }

    unlock(name) {
      if (this.blueprints.indexOf(name) === -1) this.blueprints.push(name);
      return this.blueprints.length;
    }

    // Строка для HUD — ровно та, что просили в задании
    text() {
      return 'Ядро: ' + this.fragments + '/' + this.fragmentsTotal;
    }

    reset() {
      this.fragments = 0;
      this.archives = 0;
      this.score = 0;
      this.blueprints = [];
      this.started = false;
    }

    state() {
      return {
        fragments: this.fragments,
        archives: this.archives,
        score: this.score,
        blueprints: this.blueprints.slice(),
        started: this.started
      };
    }

    load(s) {
      if (!s) return this;
      this.fragments = s.fragments || 0;
      this.archives = s.archives || 0;
      this.score = s.score || 0;
      this.blueprints = (s.blueprints || []).slice();
      this.started = !!s.started;
      return this;
    }
  }

  /* ------------------------------------------------------------
     Фрагмент ядра: висит в воздухе, светится, собирается по E.
     ------------------------------------------------------------ */

  class Fragment {
    constructor(spot, index) {
      this.index = index;
      this.tx = spot.tx;
      this.ty = spot.ty;
      this.taken = false;
      this.phase = index * 1.7;     // у каждого своё время покачивания
    }

    get x() { return this.tx * 32 + 16; }
    get y() { return this.ty * 32 + 22; }

    collect(game) {
      if (this.taken) return false;
      this.taken = true;
      return true;
    }
  }

  /* ------------------------------------------------------------
     Терминал «Архива экспедиции». Отдельный от терминалов игры:
     те — про ядро и приливы, эти — про людей, которые это начали.
     ------------------------------------------------------------ */

  class Archive {
    constructor(def, index) {
      this.id = def.id;
      this.index = index;
      this.tx = def.tx;
      this.ty = def.ty;
      this.title = def.title;
      this.short = def.short;
      this.lines = def.body.slice();
      this.read = false;
    }

    get x() { return this.tx * 32 + 16; }
    get y() { return (this.ty + 1) * 32; }     // низ обелиска — на полу

    get body() { return this.lines.join('\n'); }

    read_(game) {
      var first = !this.read;
      this.read = true;
      return first;
    }
  }

  /* ------------------------------------------------------------
     Жила резонита. Кристалл в породе: подходишь, жмёшь E, забираешь.
     ------------------------------------------------------------ */

  class ResoniteNode {
    constructor(def, index) {
      this.index = index;
      this.tx = def.tx;
      this.ty = def.ty;
      this.amount = def.amount;
      this.taken = false;
      this.phase = index * 2.3;
    }

    get x() { return this.tx * 32 + 16; }
    get y() { return this.ty * 32 + 24; }
  }

  /* ------------------------------------------------------------
     Корабль. Три стадии ремонта, каждая со своей ценой, и финальный
     аккорд, который открывается только с тремя фрагментами ядра.
     ------------------------------------------------------------ */

  var REPAIR_STAGES = [
    {
      id: 0,
      name: 'АВАРИЙНОЕ ПИТАНИЕ',
      done: 'Питание есть',
      cost: { 3: 20, 2: 10 },                       // 20 FERRITE + 10 STONE
      costText: '20 FERRITE · 10 STONE',
      reward: { blueprint: 'АВАРИЙНЫЙ РЕЗАК', score: 500 },
      hint: 'реактор держит заряд — резак снова режет'
    },
    {
      id: 1,
      name: 'ЗАЛАТАТЬ КОРПУС',
      done: 'Корпус цел',
      cost: { 2: 30, 3: 10 },                       // 30 STONE + 10 FERRITE
      costText: '30 STONE · 10 FERRITE',
      reward: { blueprint: 'ПРИВОД КОРПУСА', score: 750 },
      hint: 'пластины встают на место — костюм крепче'
    },
    {
      id: 2,
      name: 'ДВИГАТЕЛЬ',
      done: 'Двигатель жив',
      cost: { 8: 5 },                               // 5 RESONITE
      costText: '5 RESONITE',
      reward: { blueprint: 'РЕЗОНАТОР', score: 1000 },
      hint: 'резонанс в норме — гравитационная пушка в руках'
    }
  ];

  class Ship {
    constructor() {
      this.repairStage = 0;        // 0, 1, 2, 3 — как в задании
      this.lastStage = 0;          // с какой стадией уже расплатились наградой
      this.coreActive = false;     // финальный аккорд уже сыгран
      this.anim = 0;               // время для анимации
      this.lastReward = null;
      this.tx0 = SHIP.tx0;
      this.tx1 = SHIP.tx1;
      this.floorRow = SHIP.floorRow;
      this.h = SHIP.h;
    }

    get doorX() { return SHIP.doorTile * 32 + 16; }
    get bottomY() { return this.floorRow * 32; }
    get topY() { return this.bottomY - this.h * 32; }
    get finished() { return this.repairStage >= REPAIR_STAGES.length; }

    // Следующая стадия: что именно нужно прямо сейчас
    get current() {
      return this.repairStage < REPAIR_STAGES.length ? REPAIR_STAGES[this.repairStage] : null;
    }

    // Открыть меню ремонта. Именно метод interact(game) — по заданию
    interact(game) {
      if (!game || !game.narrative) return false;
      if (game.player && game.player.dead) return false;
      game.narrative.menu = 'ship';
      game.narrative.menuSel = Math.min(this.repairStage, REPAIR_STAGES.length);
      game.narrative.menuT = 0;
      return true;
    }

    canAfford(game) {
      var st = this.current;
      if (!st) return false;
      for (var id in st.cost) {
        if (!game.inventory.has(Number(id), st.cost[id])) return false;
      }
      return true;
    }

    // Сколько чего не хватает — для честной подсказки в меню
    missing(game) {
      var st = this.current;
      if (!st) return [];
      var out = [];
      for (var id in st.cost) {
        var need = st.cost[id] - (game.inventory.counts[Number(id)] || 0);
        if (need > 0) out.push(need + ' × ' + Narrative.resName(Number(id)));
      }
      return out;
    }

    // Собрать текущую стадию: списать ресурсы и сдвинуть repairStage.
    // Награду выдаёт update() — стадия меняется здесь, а платим за неё там.
    build(game) {
      var st = this.current;
      if (!st) { game.notice('корабль в порядке', '#9bf7b4'); return false; }
      if (!this.canAfford(game)) {
        var miss = this.missing(game);
        game.notice('нужно: ' + (miss.length ? miss.join(', ') : st.costText), '#ffb0b0');
        return false;
      }
      for (var id in st.cost) game.inventory.spend(Number(id), st.cost[id]);
      this.repairStage = Math.min(REPAIR_STAGES.length, this.repairStage + 1);
      game.particles.place(this.doorX, this.bottomY - 40);
      if (game.camera) game.camera.shake(0.45);
      return true;
    }

    // Если стадия изменилась — выдать награду: рецепт, очки и конкретный эффект.
    // Вызывается каждый кадр, поэтому срабатывает ровно один раз на стадию.
    update(game) {
      this.anim += 1 / 60;
      if (this.repairStage === this.lastStage) return null;
      var reward = null;
      // Проходим все пропущенные стадии: загрузка сейва или щедрый билд
      while (this.lastStage < this.repairStage) {
        var st = REPAIR_STAGES[this.lastStage];
        if (st && game) {
          var q = game.narrative ? game.narrative.log : null;
          if (q) {
            q.unlock(st.reward.blueprint);
            q.addScore(st.reward.score);
          }
          // Рецепт — не строчка в списке, а реальная вещь в руках
          var p = game.player;
          if (p) {
            if (this.lastStage === 0) p.hasLaser = true;
            else if (this.lastStage === 1) p.hasArmor = true;
            else if (this.lastStage === 2) p.hasGravityGun = true;
          }
          if (game.notice) {
            game.notice(st.reward.blueprint + ' — рецепт открыт, +' + st.reward.score + ' очков', '#9bf7b4');
          }
          reward = { stage: this.lastStage + 1, blueprint: st.reward.blueprint, score: st.reward.score };
        }
        this.lastStage++;
      }
      this.lastReward = reward;
      return reward;
    }

    // Финальное взаимодействие: двигатель жив И собраны три фрагмента
    canActivateCore(game) {
      var q = game.narrative ? game.narrative.log : null;
      return this.finished && !this.coreActive && !!q && q.coreDone;
    }

    activateCore(game) {
      if (!this.canActivateCore(game)) {
        var q = game.narrative ? game.narrative.log : null;
        if (!this.finished) game.notice('сначала отремонтируйте двигатель', '#ffb0b0');
        else if (q && !q.coreDone) game.notice('ядро не собрано: ' + q.text(), '#ffb0b0');
        return false;
      }
      this.coreActive = true;
      if (game.narrative) {
        game.narrative.log.addScore(2000);
        game.narrative.ending = true;
        game.narrative.endingT = 0;
        game.narrative.menu = null;
      }
      game.particles.place(game.player.cx, game.player.cy);
      if (game.camera) game.camera.shake(1);
      return true;
    }

    state() {
      return { stage: this.repairStage, last: this.lastStage, core: this.coreActive };
    }

    load(s) {
      if (!s) return this;
      this.repairStage = Math.max(0, Math.min(REPAIR_STAGES.length, s.stage || 0));
      this.lastStage = typeof s.last === 'number' ? s.last : this.repairStage;
      this.coreActive = !!s.core;
      return this;
    }
  }

  /* ------------------------------------------------------------
     Сюжетный слой целиком: объекты, ввод, отрисовка, сохранение.
     Один экземпляр на игру, лежит в game.narrative.
     ------------------------------------------------------------ */

  class Narrative {
    constructor(game) {
      this.game = game;
      this.log = new QuestLog();
      this.ship = new Ship();
      this.fragments = FRAGMENT_SPOTS.map(function (s, i) { return new Fragment(s, i); });
      this.archives = ARCHIVES.map(function (a, i) { return new Archive(a, i); });
      this.nodes = RESONITE_NODES.map(function (n, i) { return new ResoniteNode(n, i); });

      this.menu = null;          // 'ship' — открытое меню ремонта
      this.reading = null;       // открытая панель архива
      this.readT = 0;
      this.firstRead = false;
      this.menuSel = 0;
      this.menuT = 0;
      this.ending = false;       // финальная панель
      this.endingT = 0;
      this.near = null;          // ближайший сюжетный объект для подсказки
      this.prevLeft = false;
      this.toast = '';

      // Резонит — новый ключ инвентаря: без нуля Inventory.add(8, n) даёт NaN
      if (game && game.inventory && game.inventory.counts[RESONITE] === undefined) {
        game.inventory.counts[RESONITE] = 0;
        game.inventory.pulse[RESONITE] = 0;
      }

      this.load();
      this.settle(game);
    }

    /* ---------- навигация по миру ---------- */

    // Тайловое расстояние от игрока до точки
    dist(tx, ty) {
      var p = this.game.player;
      if (!p) return 1e9;
      var dx = tx * 32 + 16 - p.cx, dy = ty * 32 + 16 - p.cy;
      return Math.hypot(dx, dy) / 32;
    }

    // Ближайший объект, с которым можно что-то сделать по E.
    // Приоритет: корабль → фрагмент → терминал → резонит.
    nearest() {
      var self = this;
      var g = this.game;
      if (!g || !g.player || g.player.dead) return null;
      var best = null;

      function consider(obj, radius) {
        var d = self.dist(obj.tx, obj.ty);
        if (d > radius) return;
        if (!best || d < best.d) best = { kind: obj.kind, obj: obj, d: d };
      }

      var shipD = Math.abs(g.player.cx - this.ship.doorX) / 32;
      if (shipD <= SHIP.radius) best = { kind: 'ship', obj: this.ship, d: shipD };

      for (var i = 0; i < this.fragments.length; i++) {
        var f = this.fragments[i];
        if (f.taken) continue;
        consider({ kind: 'fragment', tx: f.tx, ty: f.ty, ref: f }, 2.4);
      }
      for (var j = 0; j < this.archives.length; j++) {
        var a = this.archives[j];
        consider({ kind: 'archive', tx: a.tx, ty: a.ty, ref: a }, 2.4);
      }
      for (var k = 0; k < this.nodes.length; k++) {
        var n = this.nodes[k];
        if (n.taken) continue;
        consider({ kind: 'resonite', tx: n.tx, ty: n.ty, ref: n }, 2.4);
      }
      return best;
    }

    /* ---------- действия ---------- */

    // Собрать фрагмент. Возвращает true, если что-то произошло.
    takeFragment(f) {
      var g = this.game;
      if (!f || f.taken || !f.collect(g)) return false;
      this.log.addFragment(1);
      this.log.addScore(250);
      g.particles.place(f.x, f.y);
      g.notice('фрагмент ядра: ' + this.log.text() + (this.log.coreDone ? ' — ядро собрано' : ''), '#8fe0ff');
      this.save();
      return true;
    }

    takeResonite(n) {
      var g = this.game;
      if (!n || n.taken) return false;
      n.taken = true;
      g.inventory.add(RESONITE, n.amount);
      // Своя вспышка: Particles.pickup красит искры по RES[type], а резонита
      // в таблице ресурсов игры нет — id 8 живёт только в сюжете
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2;
        g.particles.add(n.x, n.y, Math.cos(a) * 90, Math.sin(a) * 90, 2.4,
                        i % 2 ? '#d9c9ff' : '#b98bff', 0.5, false, 'spark');
      }
      g.particles.place(n.x, n.y);
      g.notice('+' + n.amount + ' RESONITE', '#d7b3ff');
      this.save();
      return true;
    }

    // Панель архива своя, а не панель лора игры: та всегда дописывает
    // «запас древних: +5 FERRITE» — для архива это была бы ложь
    openArchive(a) {
      if (!a) return false;
      var first = !a.read;
      a.read = true;
      this.reading = a;
      this.readT = 0;
      this.firstRead = first;
      if (first) {
        this.log.addArchive();
        this.log.addScore(100);
        this.save();
      }
      return true;
    }

    closeArchive() {
      this.reading = null;
      this.firstRead = false;
    }

    save() {
      var ls = Narrative.storage();
      if (!ls) return false;
      try {
        ls.setItem(Narrative.KEY, JSON.stringify(this.state()));
        return true;
      } catch (e) { return false; }   // приватный режим — играем без сохранения
    }

    load() {
      var raw = null;
      var ls = Narrative.storage();
      try { raw = ls ? ls.getItem(Narrative.KEY) : null; } catch (e) { raw = null; }
      if (!raw) return false;
      var d = null;
      try { d = JSON.parse(raw); } catch (e) { return false; }
      if (!d) return false;
      this.log.load(d.log);
      this.ship.load(d.ship);
      if (d.fragments) {
        for (var i = 0; i < this.fragments.length; i++) this.fragments[i].taken = !!d.fragments[i];
      }
      if (d.archives) {
        for (var j = 0; j < this.archives.length; j++) this.archives[j].read = !!d.archives[j];
      }
      if (d.nodes) {
        for (var k = 0; k < this.nodes.length; k++) this.nodes[k].taken = !!d.nodes[k];
      }
      // Резонит живёт в инвентаре игры, но переживает F5 только здесь:
      // штатный сейв сохраняет все ключи, а восстанавливает лишь ресурсы CFG
      if (typeof d.resonite === 'number' && this.game && this.game.inventory) {
        this.game.inventory.counts[RESONITE] = d.resonite;
      }
      return true;
    }

    state() {
      return {
        v: 1,
        resonite: this.game && this.game.inventory ? (this.game.inventory.counts[RESONITE] || 0) : 0,
        log: this.log.state(),
        ship: this.ship.state(),
        fragments: this.fragments.map(function (f) { return f.taken ? 1 : 0; }),
        archives: this.archives.map(function (a) { return a.read ? 1 : 0; }),
        nodes: this.nodes.map(function (n) { return n.taken ? 1 : 0; })
      };
    }

    // Сброс мира (Backspace) — сюжет тоже начинается заново
    reset(game) {
      this.log.reset();
      this.ship = new Ship();
      this.fragments = FRAGMENT_SPOTS.map(function (s, i) { return new Fragment(s, i); });
      this.archives = ARCHIVES.map(function (a, i) { return new Archive(a, i); });
      this.nodes = RESONITE_NODES.map(function (n, i) { return new ResoniteNode(n, i); });
      this.menu = null;
      this.reading = null;
      this.ending = false;
      this.near = null;
      if (game && game.inventory) game.inventory.counts[RESONITE] = 0;
      var ls = Narrative.storage();
      try { if (ls) ls.removeItem(Narrative.KEY); } catch (e) { /* пусто */ }
    }

    /* ---------- сдвиг объектов, если карта другая ---------- */

    // Точки заданы под штатный мир, но после загрузки чужого сейва они могут
    // оказаться в породе. Ищем ближайшее «место на полу» рядом — объект должен
    // быть достижим при любой карте, а не только при дефолтном сиде.
    findStand(tx, ty, radius) {
      var w = this.game.world;
      if (!w) return { tx: tx, ty: ty };
      function ok(x, y) {
        return w.get(x, y) === 0 && w.get(x, y - 1) === 0 && w.solid(x, y + 1);
      }
      if (ok(tx, ty)) return { tx: tx, ty: ty };
      for (var r = 1; r <= radius; r++) {
        for (var dx = -r; dx <= r; dx++) {
          for (var dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (ok(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
          }
        }
      }
      return { tx: tx, ty: ty };
    }

    // Точки могли попасть в породу: ищем рядом место на полу.
    // settle вызывается из конструктора, когда game.narrative ещё нет,
    // поэтому findStand берём у this, а не через game.narrative
    settle(game) {
      var self = this;
      var stand = function (obj, radius) {
        if (!obj) return;
        var s = self.findStand(obj.tx, obj.ty, radius);
        obj.tx = s.tx; obj.ty = s.ty;
      };
      for (var i = 0; i < this.fragments.length; i++) stand(this.fragments[i], 6);
      for (var j = 0; j < this.archives.length; j++) stand(this.archives[j], 8);
      for (var k = 0; k < this.nodes.length; k++) stand(this.nodes[k], 8);
    }

    /* ---------- ввод: вызывается ДО update самой игры ---------- */

    // Возвращает true, если событие забрали себе: тогда игра его не увидит.
    preUpdate(game) {
      var inp = game.input;
      var dt = game.dtFrame || 1 / 60;

      if (this.ending) {
        this.endingT += dt;
        if (inp.consume('Escape') || inp.consume('Enter') || inp.consume('KeyE')) this.ending = false;
        return true;
      }

      if (this.reading) {
        this.readT = Math.min(1, this.readT + dt * 6);
        if (inp.consume('Escape') || inp.consume('Enter') || inp.consume('KeyE')) this.closeArchive();
        return true;
      }

      if (this.menu === 'ship') {
        this.menuT = Math.min(1, this.menuT + dt * 6);
        return this.shipMenuInput(game);
      }

      // Панель лора игры открыта — E и Esc принадлежат ей
      if (game.lore) return false;

      this.near = this.nearest();
      if (!this.near) return false;

      if (inp.consume('KeyE')) {
        this.act(game);
        return true;
      }
      return false;
    }

    act(game) {
      var n = this.near;
      if (!n) return false;
      if (n.kind === 'ship') return this.ship.interact(game);
      if (n.kind === 'fragment') return this.takeFragment(n.obj.ref);
      if (n.kind === 'archive') return this.openArchive(n.obj.ref);
      if (n.kind === 'resonite') return this.takeResonite(n.obj.ref);
      return false;
    }

    // Меню ремонта: мышь/тап по строке, Enter — собрать, 1..4 — строка, Esc — закрыть
    shipMenuInput(game) {
      var inp = game.input;
      var rows = REPAIR_STAGES.length + 1;

      if (inp.consume('Escape') || inp.consume('KeyE')) { this.menu = null; return true; }

      for (var i = 0; i < rows; i++) {
        if (inp.consume('Digit' + (i + 1))) {
          this.menuSel = i;
          this.shipMenuAct(game);
          return true;
        }
      }
      if (inp.consume('Enter') || inp.consume('NumpadEnter')) {
        this.shipMenuAct(game);
        return true;
      }

      // Попадание мышью: геометрия считается той же функцией, что и отрисовка
      var box = this.menuLayout(game);
      var m = inp.mouse;
      var head = box.headH * box.s;
      var rowH = box.rowH * box.s;
      if (m.x > box.x && m.x < box.x + box.w && m.y > box.y + head && m.y < box.y + box.h) {
        var idx = Math.floor((m.y - box.y - head) / rowH);
        if (idx >= 0 && idx < rows) {
          this.menuSel = idx;
          var pressed = inp.consume('MouseLeft') || (m.left && !this.prevLeft);
          if (pressed) this.shipMenuAct(game);
        }
      }
      this.prevLeft = m.left;
      return true;
    }

    shipMenuAct(game) {
      var idx = this.menuSel;
      if (idx < REPAIR_STAGES.length) {
        if (idx < this.ship.repairStage) { game.notice('эта стадия уже готова', '#9bf7b4'); return false; }
        if (idx > this.ship.repairStage) { game.notice('сначала предыдущая стадия', '#ffb0b0'); return false; }
        var ok = this.ship.build(game);
        if (ok) { this.menu = null; this.save(); }
        return ok;
      }
      // Четвёртая строка — финальный аккорд
      var done = this.ship.activateCore(game);
      if (done) this.save();
      return done;
    }

    /* ---------- шаг мира ---------- */

    update(game, dt) {
      this.ship.update(game);
      if (!this.log.started) this.log.started = true;
      this.near = this.menu || this.ending || this.reading ? null : this.nearest();
      if (this.ending) this.endingT += dt;
      // Короткий автосейв сюжета: реже, чем игра, но и потери минимальны
      this.saveT = (this.saveT || 0) + dt;
      if (this.saveT > 5) { this.saveT = 0; this.save(); }
    }

    /* ---------- геометрия панели ремонта ---------- */

    menuLayout(game) {
      var dw = 520, rowH = 64, headH = 56;
      var dh = headH + rowH * (REPAIR_STAGES.length + 1) + 14;
      var vw = game.vw, vh = game.vh;
      var s = Math.min(1, (vw - 24) / dw, (vh - 24) / dh);
      var w = dw * s, h = dh * s;
      return {
        x: (vw - w) / 2, y: (vh - h) / 2, w: w, h: h,
        dw: dw, dh: dh, rowH: rowH, headH: headH, s: s
      };
    }

    // Карточка журнала в углу. На ПК — над подсказками клавиш, на тач —
    // над джойстиком: там оба угла заняты, но эти две зоны свободны всегда.
    cardLayout(game) {
      var touch = !!game.isTouch;
      var w = 178 * (game.hudScale || 1);
      var h = 76 * (game.hudScale || 1);
      var x = 14;
      var y;
      if (touch) {
        var lay = game.touch ? game.touch.layout(game.vw, game.vh) : null;
        y = lay ? lay.stick.y - lay.stick.r - 10 - h : 96;
      } else {
        y = game.vh - 16 - 18 - 10 - h;
        if (game.isTouch === false && game.craftOpen) y = game.vh - 16 - 18 - 10 - h;
      }
      return { x: x, y: Math.max(8, y), w: w, h: h };
    }

    /* ---------- отрисовка: мир ---------- */

    // Вызывается внутри мирового трансформа, сразу после терминалов игры
    drawWorld(ctx, game) {
      this.drawShip(ctx, game);
      this.drawFragments(ctx, game);
      this.drawNodes(ctx, game);
      this.drawArchives(ctx, game);
      this.drawPrompt(ctx, game);
    }

    drawShip(ctx, game) {
      var s = this.ship;
      var t = game.time || 0;
      var x0 = s.tx0 * 32, x1 = (s.tx1 + 1) * 32;
      var bottom = s.bottomY, top = s.topY;
      var stage = s.repairStage;

      // --- тень под кораблём: он не «стоит на картинке», а лежит на грунте
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#04070c';
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse((x0 + x1) / 2, bottom + 2, (x1 - x0) * 0.46, 7, 0, 0, Math.PI * 2)
                  : ctx.arc((x0 + x1) / 2, bottom + 2, (x1 - x0) * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // --- опоры: две стойки, левая и правая
      ctx.fillStyle = '#2a3442';
      ctx.fillRect(x0 + 30, bottom - 26, 10, 26);
      ctx.fillRect(x1 - 44, bottom - 26, 10, 26);
      ctx.fillStyle = '#151b24';
      ctx.fillRect(x0 + 22, bottom - 8, 26, 8);
      ctx.fillRect(x1 - 52, bottom - 8, 26, 8);

      // --- корпус: скруглённый силуэт с наклонным носом
      var bx = x0 + 6, bw = (x1 - x0) - 12, by = top + 26, bh = (bottom - 34) - (top + 26);
      ctx.fillStyle = stage >= 2 ? '#3d4a5c' : '#333e4d';
      rr(ctx, bx, by, bw, bh, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,185,225,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // --- обшивка: панели и швы. Чем меньше стадий — тем больше «ран»
      ctx.strokeStyle = 'rgba(120,150,190,0.22)';
      ctx.lineWidth = 1;
      for (var i = 1; i < 6; i++) {
        var px = bx + (bw / 6) * i;
        ctx.beginPath();
        ctx.moveTo(px, by + 6);
        ctx.lineTo(px, by + bh - 6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(bx + 8, by + bh * 0.5);
      ctx.lineTo(bx + bw - 8, by + bh * 0.5);
      ctx.stroke();

      // --- кабина: купол над носом, свет внутри появляется со стадии 1
      var cxx = bx + bw * 0.24, cyy = by + 8;
      var dome = ctx.createLinearGradient(cxx, cyy - 22, cxx, cyy + 10);
      dome.addColorStop(0, stage >= 1 ? 'rgba(120,220,255,0.42)' : 'rgba(70,92,116,0.35)');
      dome.addColorStop(1, 'rgba(18,28,40,0.9)');
      ctx.fillStyle = dome;
      ctx.beginPath();
      ctx.arc(cxx, cyy, 20, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = stage >= 1 ? 'rgba(140,230,255,0.7)' : 'rgba(120,150,180,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // --- надпись на борту: индекс с борта, «VOID-7»
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#cfe4ff';
      ctx.font = 'bold 10px ' + (Narrative.font || 'monospace');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VOID-7', bx + bw * 0.55, by + bh * 0.72);
      ctx.restore();

      // --- двигатель справа: пока не починен — искры и провал
      var ex = bx + bw - 34, ey = by + bh * 0.34;
      ctx.fillStyle = '#212a36';
      rr(ctx, ex - 10, ey, 44, 26, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,170,205,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (stage >= 3) {
        // живой двигатель: пульсирующее ядро резонанса
        var pulse = 0.6 + 0.4 * Math.sin(t * 4);
        ctx.globalCompositeOperation = 'lighter';
        var gg = ctx.createRadialGradient(ex + 12, ey + 13, 2, ex + 12, ey + 13, 30);
        gg.addColorStop(0, 'rgba(180,150,255,' + (0.55 * pulse).toFixed(3) + ')');
        gg.addColorStop(1, 'rgba(120,90,255,0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(ex + 12, ey + 13, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#d9c9ff';
        ctx.beginPath();
        ctx.arc(ex + 12, ey + 13, 5 + pulse * 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // провал в двигателе и искры из него
        ctx.fillStyle = '#0a0f16';
        ctx.beginPath();
        ctx.arc(ex + 12, ey + 13, 9, 0, Math.PI * 2);
        ctx.fill();
        for (var k = 0; k < 3; k++) {
          var a = t * 5 + k * 2.1;
          var sx = ex + 12 + Math.cos(a) * (10 + 6 * Math.sin(t * 7 + k));
          var sy = ey + 13 + Math.sin(a) * (7 + 4 * Math.cos(t * 5 + k));
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12 + k);
          ctx.fillStyle = k === 0 ? '#ffd27a' : '#ff8a4a';
          ctx.fillRect(sx, sy, 2, 2);
        }
        ctx.globalAlpha = 1;
      }

      // --- заплатки на корпусе: их прибавляется со стадией 2
      if (stage >= 2) {
        ctx.fillStyle = 'rgba(150,180,215,0.5)';
        ctx.fillRect(bx + 18, by + bh * 0.62, 34, 10);
        ctx.fillRect(bx + bw * 0.62, by + bh * 0.2, 26, 8);
        ctx.strokeStyle = 'rgba(210,230,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 18, by + bh * 0.62, 34, 10);
        ctx.strokeRect(bx + bw * 0.62, by + bh * 0.2, 26, 8);
      } else {
        // рваные пробоины
        ctx.fillStyle = '#0b1017';
        ctx.beginPath();
        ctx.moveTo(bx + 26, by + bh * 0.55);
        ctx.lineTo(bx + 44, by + bh * 0.48);
        ctx.lineTo(bx + 40, by + bh * 0.66);
        ctx.lineTo(bx + 24, by + bh * 0.7);
        ctx.closePath();
        ctx.fill();
      }

      // --- люк: подсвечен, когда есть чем заняться
      var doorX = this.ship.doorX - 11, doorY = bottom - 52;
      var doorGlow = this.near && this.near.kind === 'ship' ? 0.55 + 0.45 * Math.sin(t * 6) : 0.3;
      ctx.globalAlpha = doorGlow;
      ctx.fillStyle = stage >= 1 ? '#7fd4ff' : '#5b7a95';
      rr(ctx, doorX, doorY, 22, 40, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(190,225,255,0.55)';
      ctx.lineWidth = 1.5;
      rr(ctx, doorX, doorY, 22, 40, 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(10,18,28,0.65)';
      ctx.fillRect(doorX + 10, doorY + 18, 3, 3);

      // --- индикатор стадий над кораблём: три точки
      for (var s2 = 0; s2 < 3; s2++) {
        var on = stage > s2;
        ctx.fillStyle = on ? '#7fd4ff' : 'rgba(120,150,190,0.28)';
        ctx.beginPath();
        ctx.arc(x0 + 24 + s2 * 12, top + 12, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawFragments(ctx, game) {
      var t = game.time || 0;
      for (var i = 0; i < this.fragments.length; i++) {
        var f = this.fragments[i];
        if (f.taken) continue;
        var bob = Math.sin(t * 1.8 + f.phase) * 3;
        var x = f.x, y = f.y + bob;
        var pulse = 0.6 + 0.4 * Math.sin(t * 3 + f.phase);

        // ореол: фрагмент должен читаться издалека
        ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createRadialGradient(x, y, 2, x, y, 26);
        g.addColorStop(0, 'rgba(160,220,255,' + (0.5 * pulse).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(90,160,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // сам осколок: двойная пирамида, как у кристаллов феррита
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(t * 1.2 + f.phase) * 0.25);
        var grad = ctx.createLinearGradient(0, -12, 0, 12);
        grad.addColorStop(0, '#eaf8ff');
        grad.addColorStop(0.5, '#8fd8ff');
        grad.addColorStop(1, '#3b7fd8');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(7, -2);
        ctx.lineTo(0, 13);
        ctx.lineTo(-7, -2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(230,248,255,0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        // «2/3» рядом — чтобы счёт был виден и в мире
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#cfe8ff';
        ctx.font = '9px ' + (Narrative.font || 'monospace');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((i + 1) + '/3', x, y + 20);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
    }

    drawNodes(ctx, game) {
      var t = game.time || 0;
      for (var i = 0; i < this.nodes.length; i++) {
        var n = this.nodes[i];
        if (n.taken) continue;
        var pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + n.phase);
        var x = n.x, y = n.y;

        ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createRadialGradient(x, y, 2, x, y, 22);
        g.addColorStop(0, 'rgba(190,150,255,' + (0.35 + 0.2 * pulse).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(140,90,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // три кристалла разной высоты
        var shards = [[-7, 16, 6], [1, 24, 8], [9, 13, 5]];
        for (var k = 0; k < shards.length; k++) {
          var sx = x + shards[k][0], hgt = shards[k][1], wid = shards[k][2];
          var gr = ctx.createLinearGradient(sx, y - hgt, sx, y + 4);
          gr.addColorStop(0, '#f0e6ff');
          gr.addColorStop(0.6, '#b98bff');
          gr.addColorStop(1, '#6b3fb8');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.moveTo(sx, y - hgt);
          ctx.lineTo(sx + wid, y - hgt * 0.35);
          ctx.lineTo(sx + wid * 0.5, y + 4);
          ctx.lineTo(sx - wid * 0.5, y + 4);
          ctx.lineTo(sx - wid, y - hgt * 0.35);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    drawArchives(ctx, game) {
      var t = game.time || 0;
      for (var i = 0; i < this.archives.length; i++) {
        var a = this.archives[i];
        var x = a.x - 10, y = a.y - 26;       // корпус 20×26, низ на полу
        var pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.9);
        var lit = !a.read;

        if (lit) {
          ctx.globalCompositeOperation = 'lighter';
          var g = ctx.createRadialGradient(x + 10, y + 13, 3, x + 10, y + 13, 30);
          g.addColorStop(0, 'rgba(255,186,110,' + (0.18 + 0.1 * pulse).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(255,140,60,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + 10, y + 13, 30, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }

        // обелиск: сужается кверху, чуть иначе, чем терминалы игры
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 26);
        ctx.lineTo(x + 17, y + 26);
        ctx.lineTo(x + 14, y);
        ctx.lineTo(x + 6, y);
        ctx.closePath();
        ctx.fillStyle = a.read ? '#181410' : '#221a12';
        ctx.fill();
        ctx.strokeStyle = a.read ? 'rgba(110,90,70,0.8)' : 'rgba(255,186,110,0.7)';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // руны: три чёрточки, гаснут после прочтения
        ctx.globalAlpha = a.read ? 0.18 : 0.5 + 0.45 * pulse;
        ctx.fillStyle = a.read ? '#3a2a1a' : '#ffcf8a';
        for (var k = 0; k < 3; k++) ctx.fillRect(x + 7, y + 7 + k * 6, 6, 2);
        ctx.globalAlpha = 1;

        // подставка
        ctx.fillStyle = a.read ? '#1b1710' : '#2a2116';
        ctx.fillRect(x + 1, y + 22, 18, 4);
      }
    }

    // Подсказка над ближайшим объектом: та же плашка, что у терминалов игры
    drawPrompt(ctx, game) {
      var n = this.near;
      if (!n || this.menu || this.ending || this.reading || game.lore) return;
      var t = game.time || 0;
      var label, cx, cy, color;

      // На тач-устройстве клавиши E нет: подсказка называет действие,
      // а не горячую клавишу — на экране за это отвечает кнопка «читать»
      var e = game.isTouch ? '' : '[E] ';
      if (n.kind === 'ship') {
        cx = this.ship.doorX;
        cy = this.ship.bottomY - 78;
        label = this.ship.finished
          ? (this.ship.canActivateCore(game) ? e + 'Активировать ядро' : e + 'Корабль')
          : e + 'Ремонт корабля';
        color = 'rgba(127,212,255,0.75)';
      } else if (n.kind === 'fragment') {
        cx = n.obj.ref.x;
        cy = n.obj.ref.y - 26;
        label = e + 'Взять фрагмент';
        color = 'rgba(143,216,255,0.75)';
      } else if (n.kind === 'archive') {
        cx = n.obj.ref.x;
        cy = n.obj.ref.y - 40;
        label = e + (n.obj.ref.read ? 'Перечитать архив' : 'Прочитать архив');
        color = 'rgba(255,186,110,0.75)';
      } else {
        cx = n.obj.ref.x;
        cy = n.obj.ref.y - 34;
        label = e + 'Добыть резонит';
        color = 'rgba(185,139,255,0.75)';
      }

      var bob = Math.sin(t * 3) * 1.5;
      ctx.font = 'bold 9px ' + (Narrative.font || 'monospace');
      var w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(6,12,18,0.85)';
      rr(ctx, cx - w / 2, cy - 9 + bob, w, 18, 5);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#eaf6ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 0.5 + bob);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    /* ---------- отрисовка: HUD ---------- */

    drawHud(ctx, game) {
      this.drawQuestCard(ctx, game);
      if (this.reading) this.drawArchive(ctx, game);
      if (this.menu === 'ship') this.drawShipMenu(ctx, game);
      if (this.ending) this.drawEnding(ctx, game);
    }

    drawQuestCard(ctx, game) {
      var b = this.cardLayout(game);
      var fs = function (n) { return game.fs ? game.fs(n) : Math.round(n * (game.hudScale || 1)) + 'px monospace'; };
      var q = this.log;

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(9,13,21,0.78)';
      rr(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.strokeStyle = q.coreDone ? 'rgba(127,212,255,0.55)' : 'rgba(150,180,220,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // полоска-акцент слева, как у рунических панелей игры
      ctx.fillStyle = q.coreDone ? '#7fd4ff' : 'rgba(127,212,255,0.55)';
      ctx.fillRect(b.x + 2, b.y + 10, 2, b.h - 20);

      // Три строки, каждая на своём уровне: шапка 14, «Ядро» 34, корабль 55.
      // Высота карточки (72) посчитана под это; раньше строка корабля
      // и очки стояли на одном Y и наезжали друг на друга
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = 'bold ' + fs(9);
      ctx.fillStyle = 'rgba(143,216,255,0.9)';
      ctx.fillText('МИССИЯ · ЯДРО', b.x + 12, b.y + 14);

      ctx.font = 'bold ' + fs(13);
      ctx.fillStyle = q.coreDone ? '#bff2ff' : '#e8f2ff';
      ctx.fillText(q.text(), b.x + 12, b.y + 35);

      // Три ромбика фрагментов — состояние читается без цифр
      for (var i = 0; i < q.fragmentsTotal; i++) {
        var fx = b.x + b.w - 15 - i * 13, fy = b.y + 35;
        ctx.beginPath();
        ctx.moveTo(fx, fy - 5);
        ctx.lineTo(fx + 4.5, fy);
        ctx.lineTo(fx, fy + 5);
        ctx.lineTo(fx - 4.5, fy);
        ctx.closePath();
        if (i < q.fragments) { ctx.fillStyle = '#8fe0ff'; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(140,175,215,0.4)'; ctx.lineWidth = 1; ctx.stroke(); }
      }

      // Нижняя строка: стадия корабля слева, очки справа
      ctx.font = fs(9);
      var shipLine = this.ship.coreActive ? 'кораблю ядро' : 'корабль ' + this.ship.repairStage + '/3';
      ctx.fillStyle = 'rgba(196,214,236,0.7)';
      ctx.fillText(shipLine, b.x + 12, b.y + 57);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,192,122,0.85)';
      ctx.fillText(q.score + ' очк.', b.x + b.w - 12, b.y + 57);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    // Панель архива: тот же визуальный язык, что у лора игры, но со своей
    // наградой и без ложных строк. Текст переносится по словам: на телефоне
    // строка архива в 70 символов шире экрана
    drawArchive(ctx, game) {
      var a = this.reading;
      if (!a) return;
      var t = clamp01(this.readT);
      var fs = function (n) { return game.fs ? game.fs(n) : n + 'px monospace'; };
      var w = Math.min(560, game.vw - 40);
      var left = 30, right = 24;
      var innerW = w - left - right;

      ctx.font = fs(13);
      var lines = [];
      for (var li = 0; li < a.lines.length; li++) {
        var parts = wrapLines(ctx, a.lines[li], innerW);
        for (var pi = 0; pi < parts.length; pi++) lines.push(parts[pi]);
      }
      var lineH = 22;
      var h = 50 + lines.length * lineH + 56;
      h = Math.min(h, game.vh - 40);
      var x = (game.vw - w) / 2, y = (game.vh - h) / 2;

      ctx.globalAlpha = t;
      ctx.fillStyle = 'rgba(3,6,11,0.72)';
      ctx.fillRect(0, 0, game.vw, game.vh);
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(16,12,8,0.97)';
      rr(ctx, x, y, w, h, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,186,110,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // руническая полоса слева — «это находка, а не меню»
      ctx.fillStyle = 'rgba(255,186,110,0.6)';
      ctx.fillRect(x + 14, y + 22, 3, h - 44);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold ' + fs(11);
      ctx.fillStyle = '#ffcf8a';
      ctx.fillText(a.title, x + 30, y + 22);

      ctx.font = fs(13);
      ctx.fillStyle = 'rgba(238,240,246,0.94)';
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x + left, y + 50 + i * lineH);
      }

      // подвал: на узком экране подсказка и награда идут в две строки,
      // иначе «Esc / Enter / E» наезжает на «+100 очков»
      var narrow = w < 470;
      ctx.font = fs(10);
      ctx.fillStyle = 'rgba(150,180,215,0.7)';
      var hint = game.isTouch ? 'закрыть — ещё раз «читать»' : 'Esc / Enter / E — закрыть';
      var reward = this.firstRead ? 'архив открыт: +100 очков' : 'архив уже прочитан';
      if (narrow) {
        ctx.fillText(hint, x + left, y + h - 40);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,192,122,0.9)';
        ctx.fillText(reward, x + w - right, y + h - 22);
      } else {
        ctx.fillText(hint, x + left, y + h - 28);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,192,122,0.9)';
        ctx.fillText(reward, x + w - right, y + h - 28);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    drawShipMenu(ctx, game) {
      var box = this.menuLayout(game);
      var s = box.s;
      var t = clamp01(this.menuT);
      var rows = REPAIR_STAGES.length + 1;

      ctx.globalAlpha = t;
      ctx.fillStyle = 'rgba(3,6,11,0.72)';
      ctx.fillRect(0, 0, game.vw, game.vh);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.translate(box.x, box.y);
      ctx.scale(s, s);

      var dw = box.dw, dh = box.dh, headH = box.headH, rowH = box.rowH;

      ctx.fillStyle = 'rgba(8,16,24,0.97)';
      rr(ctx, 0, 0, dw, dh, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,212,255,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // шапка
      ctx.fillStyle = 'rgba(127,212,255,0.6)';
      ctx.fillRect(18, 16, 3, headH - 24);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = '#8fd8ff';
      ctx.fillText('РЕМОНТ КОРАБЛЯ · VOID-7', 32, 28);
      ctx.font = '11px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = 'rgba(190,210,235,0.75)';
      ctx.fillText('стадия ' + this.ship.repairStage + ' из ' + REPAIR_STAGES.length + ' · ' + this.log.text(), 32, 46);

      // кнопка закрытия справа
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(150,180,215,0.65)';
      ctx.font = '10px ' + (Narrative.font || 'monospace');
      // На телефоне Esc и Enter нет: подсказки называют действие, а не клавишу
      var touch = !!game.isTouch;
      ctx.fillText(touch ? 'закрыть — ещё раз ⚙' : 'Esc — закрыть', dw - 18, 30);
      ctx.textAlign = 'left';

      var y = headH;
      for (var i = 0; i < rows; i++) {
        var sel = this.menuSel === i;
        var rowY = y + i * rowH;

        // фон строки
        if (sel) {
          ctx.fillStyle = 'rgba(120,190,255,0.12)';
          rr(ctx, 10, rowY + 4, dw - 20, rowH - 8, 9);
          ctx.fill();
          ctx.strokeStyle = 'rgba(127,212,255,0.6)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          rr(ctx, 10, rowY + 4, dw - 20, rowH - 8, 9);
          ctx.fill();
        }

        if (i < REPAIR_STAGES.length) {
          var st = REPAIR_STAGES[i];
          var done = this.ship.repairStage > i;
          var active = this.ship.repairStage === i;

          // номер / галочка
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 12px ' + (Narrative.font || 'monospace');
          ctx.fillStyle = done ? '#56d18f' : active ? '#8fd8ff' : 'rgba(150,175,205,0.5)';
          ctx.fillText(done ? '✓' : String(i + 1), 26, rowY + rowH / 2);

          ctx.font = 'bold 13px ' + (Narrative.font || 'monospace');
          ctx.fillStyle = done ? 'rgba(160,220,190,0.85)' : active ? '#eaf6ff' : 'rgba(170,190,215,0.55)';
          ctx.fillText(done ? st.done : st.name, 50, rowY + rowH / 2 - 9);

          ctx.font = '11px ' + (Narrative.font || 'monospace');
          ctx.fillStyle = 'rgba(170,195,225,0.72)';
          ctx.fillText(st.costText, 50, rowY + rowH / 2 + 10);

          // справа: состояние
          ctx.textAlign = 'right';
          if (done) {
            ctx.fillStyle = 'rgba(86,209,143,0.8)';
            ctx.fillText('готово', dw - 24, rowY + rowH / 2);
          } else if (active) {
            var can = this.ship.canAfford(game);
            ctx.fillStyle = can ? '#9bf7b4' : '#ffb0b0';
            ctx.fillText(can ? (touch ? 'нажмите, чтобы собрать' : 'Enter — собрать') : 'не хватает',
                         dw - 24, rowY + rowH / 2 - 8);
            if (!can) {
              ctx.font = '10px ' + (Narrative.font || 'monospace');
              ctx.fillStyle = 'rgba(255,176,176,0.8)';
              var miss = this.ship.missing(game);
              ctx.fillText(miss.slice(0, 2).join(', '), dw - 24, rowY + rowH / 2 + 10);
            }
          } else {
            ctx.fillStyle = 'rgba(150,175,205,0.45)';
            ctx.fillText('закрыто', dw - 24, rowY + rowH / 2);
          }
          ctx.textAlign = 'left';
        } else {
          // Финальная строка: активация ядра
          var ready = this.ship.canActivateCore(game);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 13px ' + (Narrative.font || 'monospace');
          ctx.fillStyle = ready ? '#ffd27a' : 'rgba(170,190,215,0.5)';
          ctx.fillText(this.ship.coreActive ? 'ЯДРО АКТИВНО' : 'ФИНАЛЬНЫЙ АККОРД', 50, rowY + rowH / 2 - 9);
          ctx.font = '11px ' + (Narrative.font || 'monospace');
          ctx.fillStyle = 'rgba(170,195,225,0.72)';
          var sub = this.ship.coreActive ? 'корабль готов к отлёту'
            : !this.ship.finished ? 'сначала двигатель'
            : this.log.text() + ' · нужно 3/3';
          ctx.fillText(sub, 50, rowY + rowH / 2 + 10);
          ctx.textAlign = 'right';
          ctx.fillStyle = ready ? '#9bf7b4' : 'rgba(150,175,205,0.45)';
          ctx.fillText(ready ? (touch ? 'нажмите' : 'Enter — активировать') : 'закрыто',
                       dw - 24, rowY + rowH / 2);
          ctx.textAlign = 'left';
        }
      }

      // подвал: подсказка и открытые рецепты
      ctx.font = '10px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = 'rgba(150,180,215,0.6)';
      var bp = this.log.blueprints.length ? 'рецепты: ' + this.log.blueprints.join(' · ') : 'рецептов пока нет';
      ctx.fillText(bp, 20, dh - 10);

      ctx.restore();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    drawEnding(ctx, game) {
      var t = clamp01(this.endingT / 0.5);
      ctx.globalAlpha = t;
      ctx.fillStyle = 'rgba(2,4,9,0.82)';
      ctx.fillRect(0, 0, game.vw, game.vh);
      ctx.globalAlpha = 1;

      var w = Math.min(620, game.vw - 60);
      var h = Math.min(340, game.vh - 80);
      var x = (game.vw - w) / 2, y = (game.vh - h) / 2;

      ctx.fillStyle = 'rgba(8,14,24,0.97)';
      rr(ctx, x, y, w, h, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,122,0.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,210,122,0.6)';
      ctx.fillRect(x + 18, y + 26, 3, h - 70);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 12px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = '#ffd27a';
      ctx.fillText('ФИНАЛЬНЫЙ АККОРД', x + 34, y + 26);

      ctx.font = 'bold 20px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = '#eaf6ff';
      ctx.fillText('Ядро собрано. Корабль слушает.', x + 34, y + 52);

      ctx.font = '13px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = 'rgba(214,232,250,0.9)';
      var raw = [
        'Три фрагмента встали в гнёзда, двигатель держит резонанс.',
        'Планета больше не разрывает оболочку — она выдыхает ровно.',
        'Протокол «Присвоение» остался строкой в архиве. Ядро — нет.',
        '',
        'Совет так и не узнает, чем закончилась экспедиция.'
      ];
      var lines = [];
      for (var k = 0; k < raw.length; k++) {
        if (!raw[k]) { lines.push(''); continue; }
        var parts = wrapLines(ctx, raw[k], w - 68);
        for (var q = 0; q < parts.length; q++) lines.push(parts[q]);
      }
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x + 34, y + 92 + i * 22);
      }

      ctx.font = 'bold 13px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = '#9bf7b4';
      ctx.fillText('очки: ' + this.log.score, x + 34, y + h - 54);

      ctx.font = '11px ' + (Narrative.font || 'monospace');
      ctx.fillStyle = 'rgba(150,180,215,0.7)';
      ctx.fillText('Esc / Enter — продолжить', x + 34, y + h - 30);
      ctx.textAlign = 'left';
    }

    /* ---------- вспомогательное ---------- */

    // Название ресурса по id — для подсказок «не хватает»
    static resName(id) {
      var map = { 1: 'DIRT', 2: 'STONE', 3: 'FERRITE', 4: 'BIOGEL', 8: 'RESONITE' };
      return map[id] || ('#' + id);
    }
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Перенос по словам: canvas сам не переносит, а панели должны влезать
  // в экран телефона. Длинное слово режем по символам — иначе не влезет
  function wrapLines(ctx, text, maxW) {
    var out = [];
    var words = String(text).split(' ');
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !line) {
        line = test;
        // слово само длиннее строки — режем
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          var cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        out.push(line);
        line = words[i];
      }
    }
    if (line) out.push(line);
    return out;
  }

  /* ------------------------------------------------------------
     Подключение к игре: пять обёрток над Game.prototype.
     Ни одна строчка gravity-void.html не меняется — обёртки
     вызывают оригинальные методы и добавляют своё до/после.
     ------------------------------------------------------------ */

  // localStorage бывает и на window, и на глобальном объекте (так делает
  // headless-песочница в tools/verify-narrative.mjs). Берём то, что найдётся,
  // и не падаем, если хранилища нет вовсе — приватный режим
  Narrative.storage = function () {
    try {
      if (global && global.localStorage) return global.localStorage;
    } catch (e) { /* заблокировано политикой */ }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* заблокировано политикой */ }
    return null;
  };

  Narrative.KEY = 'gravity-void-narrative-v1';
  Narrative.RESONITE = RESONITE;
  Narrative.SHIP = SHIP;
  Narrative.FRAGMENT_SPOTS = FRAGMENT_SPOTS;
  Narrative.ARCHIVES = ARCHIVES;
  Narrative.RESONITE_NODES = RESONITE_NODES;
  Narrative.REPAIR_STAGES = REPAIR_STAGES;
  Narrative._patched = false;

  Narrative.patch = function (GameClass) {
    if (Narrative._patched || !GameClass || !GameClass.prototype) return false;
    var P = GameClass.prototype;

    var origUpdate = P.update;
    P.update = function (dt) {
      // Любой экземпляр Game получает сюжет сам: так он подключается и к игре,
      // запущенной до загрузки narrative.js, и к новой (тесты, перезапуск)
      if (!this.narrative) Narrative.attach(this);
      var n = this.narrative;
      if (!n) return origUpdate.call(this, dt);
      this.dtFrame = dt;
      // Сюжетный ввод идёт ПЕРВЫМ: если объект под рукой, E принадлежит ему,
      // а не терминалам игры или меню крафта
      n.preUpdate(this);
      origUpdate.call(this, dt);
      if (this.narrative) this.narrative.update(this, dt);
    };

    var origDrawTerminals = P.drawTerminals;
    P.drawTerminals = function (ctx) {
      origDrawTerminals.call(this, ctx);
      if (this.narrative) this.narrative.drawWorld(ctx, this);
    };

    var origDrawHud = P.drawHud;
    P.drawHud = function (ctx) {
      origDrawHud.call(this, ctx);
      if (this.narrative) this.narrative.drawHud(ctx, this);
    };

    var origUpdateMouse = P.updateMouse;
    P.updateMouse = function (dt) {
      // В меню ремонта мышь принадлежит меню: иначе клик по строке ещё и копал бы
      if (this.narrative && (this.narrative.menu || this.narrative.ending)) return origUpdateMouse.call(this, dt * 0);
      return origUpdateMouse.call(this, dt);
    };

    var origReset = P.resetWorld;
    P.resetWorld = function () {
      origReset.call(this);
      if (this.narrative) this.narrative.reset(this);
    };

    Narrative._patched = true;
    return true;
  };

  // Прицепить сюжет к уже созданному экземпляру игры
  Narrative.attach = function (game) {
    if (!game || game.narrative) return game && game.narrative;
    game.narrative = new Narrative(game);
    return game.narrative;
  };

  /* ------------------------------------------------------------
     Автозапуск. narrative.js подключается ПОСЛЕ игры, поэтому
     переменная game уже существует (это let верхнего уровня,
     он виден всем следующим скриптам той же страницы).
     ------------------------------------------------------------ */

  function boot(tries) {
    var g = null;
    try { g = typeof game !== 'undefined' ? game : null; } catch (e) { g = null; }
    if (!g) {
      if ((tries || 0) < 40) {
        setTimeout(function () { boot((tries || 0) + 1); }, 50);
      }
      return;
    }
    try {
      Narrative.patch(global.Game || (typeof Game !== 'undefined' ? Game : null));
      Narrative.attach(g);
      global.__narrative = g.narrative;
    } catch (e) {
      // Сюжет не должен ронять игру: любая ошибка — только в консоль
      if (global.console) global.console.warn('[narrative] не подключился:', e && e.message);
    }
  }

  global.Narrative = Narrative;
  global.QuestLog = QuestLog;
  global.Ship = Ship;
  global.Fragment = Fragment;
  global.Archive = Archive;
  global.ResoniteNode = ResoniteNode;
  global.RESONITE = RESONITE;

  // Шрифт игры: если он доступен, берём его — интерфейс должен быть один
  try {
    Narrative.font = (typeof CFG !== 'undefined' && CFG.render && CFG.render.font) || 'monospace';
  } catch (e) {
    Narrative.font = 'monospace';
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { boot(0); });
    } else {
      boot(0);
    }
  } else {
    boot(0);
  }
})(typeof window !== 'undefined' ? window : this);
