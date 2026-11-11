/* ============================================================
   narrative.js — сюжетный слой GRAVITY: VOID (M8.3)

   ЗАГЛУШКА. Файл нужен только для того, чтобы <script src="narrative.js">
   в gravity-void.html не давал 404, пока сюжетный агент не закоммитил свой
   вариант. Ничего не рисует, не трогает мир и не подменяет HUD.

   Заменяется один-в-один: удали это содержимое и положи свой файл.

   Что игра оставляет для сюжета:
     game.lore          — панель лора (объект { title, body }), рисуется сама
     game.closeLore()   — закрыть панель
     game.notice(...)   — всплывающее уведомление
     game.doSave()      — записать сейв (формат v4, без ship/terminals)
     game.world         — чанковый мир: get/set/solid/forEachPlaced
     game.turrets       — турели Руин, game.bolts — их снаряды
   ============================================================ */
(function () {
  'use strict';
  var GV = window.GV || (window.GV = {});
  GV.narrative = { version: 0, stub: true, ready: true };
})();
