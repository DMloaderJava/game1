// Нагрузка: 2 полных цикла прилива + тела + постройки, ищем просадки и утечки
import fs from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const src = fs.readFileSync(new URL('../gravity-void.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const W = 1280, H = 720;
const view = createCanvas(W, H);
view.addEventListener = () => {}; view.style = {};
view.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
const listeners = {}; const raf = []; let now = 0;
const mem = new Map();
const sb = {
  console, performance, Math, Date, JSON, Uint8Array,
  localStorage: { getItem: (k) => (mem.get(k) ?? null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  document: { createElement: () => createCanvas(1, 1), getElementById: () => view },
  window: { addEventListener: (t, f) => { listeners[t] = f; }, devicePixelRatio: 1, innerWidth: W, innerHeight: H, focus() {} },
  requestAnimationFrame: (cb) => raf.push(cb),
  devicePixelRatio: 1, innerWidth: W, innerHeight: H
};
sb.globalThis = sb;
let code = src + '\n;globalThis.__g = game; globalThis.__cls = { Drop, Crate, Game };';
vm.runInNewContext(code, sb);
const game = sb.__g;
const CFG = game.constructor;
const floorY = game.world.surfaceRow * 32 - 28;

// ускорим прилив, чтобы прогнать два цикла
vm.runInNewContext('', sb);

function frames(n) { for (let i = 0; i < n; i++) { now += 1000 / 60; const cb = raf.shift(); cb(now); } }

// нагрузка: 120 построек, 40 дропов, 20 ящиков
for (let i = 0; i < 120; i++) {
  const tx = 40 + (i % 20), ty = game.world.surfaceRow - 2 - Math.floor(i / 20);
  game.world.set(tx, ty, i % 3 === 0 ? 1 : 2, true);
}
game.tiles.flush();
for (let i = 0; i < 40; i++) {
  game.drops.push(new sb.__cls.Drop(game.player.cx - 200 + (i % 20) * 20, floorY - 40, 2));
}
for (let i = 0; i < 20; i++) {
  game.crates.push(new sb.__cls.Crate(game.player.cx - 300 + i * 30, floorY - 200));
}
frames(30);

// замер подозрительных мест
for (const m of ['spawnAftermathLoot', 'doSave', 'onPhaseChanged', 'wreckWave']) {
  const orig = game[m].bind(game);
  game[m] = (...a) => { const t0 = performance.now(); const r = orig(...a); const d = performance.now() - t0; if (d > 8) console.log('SLOW', m, d.toFixed(1), 'мс'); return r; };
}

const times = [];
let maxDrops = 0, maxAnchors = 0;
// два цикла: CATASTROPHE → AFTERMATH → STABLE, сжимаем фазы
for (let cycle = 0; cycle < 2; cycle++) {
  for (const idx of [2, 3, 0, 1]) {
    game.tide.setPhase(idx);
    game.tide.applyPhase(game.tide.id);
    game.onPhaseChanged(game.tide.id);
    const framesInPhase = idx === 2 ? 25 * 60 : idx === 3 ? 35 * 60 : 60;
    for (let f = 0; f < framesInPhase; f++) {
      const t0 = process.hrtime.bigint();
      frames(1);
      const t1 = process.hrtime.bigint();
      const dtms = Number(t1 - t0) / 1e6;
      if (dtms > 25) {
        console.log('SPIKE', 'cycle', cycle, 'phase', game.tide.id, 'ms', dtms.toFixed(1),
          'heapMB', (process.memoryUsage().heapUsed / 1048576).toFixed(1),
          'tilesDirty', game.world.dirty.length,
          'detailed', game.tiles.detailed.reduce((a, b) => a + (b ? 1 : 0), 0));
      }
      times.push(dtms);
      if (cycle === 1 && f > 25 * 60 - 12 && idx === 2) {
        console.log('TAIL', 'phase', game.tide.id, 'f', f, 'ms', dtms.toFixed(1),
          'drops', game.drops.length, 'crates', game.crates.length, 'part', game.particles.list.length,
          'dirty', game.world.dirty.length, 'pop', game.popAnims.length);
      }
      maxDrops = Math.max(maxDrops, game.drops.length);
      maxAnchors = Math.max(maxAnchors, game.anchors.length);
    }
  }
}
times.sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];
const p99 = times[Math.floor(times.length * 0.99)];
const slow = times.map((t, i) => [i, t]).filter(([i, t]) => t > 20).slice(0, 10);
console.log('медленные кадры (>20мс):', JSON.stringify(slow.map(([i, t]) => [i, +t.toFixed(1)])));
console.log('кадров:', times.length, '| p50', p50.toFixed(2), 'мс | p95', p95.toFixed(2), 'мс | p99', p99.toFixed(2), 'мс | max', times[times.length - 1].toFixed(2), 'мс');
console.log('макс дропов:', maxDrops, '| частиц сейчас:', game.particles.list.length, '| постройки осталось:',
  (() => { let n = 0; for (let i = 0; i < game.world.placed.length; i++) if (game.world.placed[i]) n++; return n; })());
console.log('память (bodies):', game.drops.length + game.crates.length, '| popAnims:', game.popAnims.length);
