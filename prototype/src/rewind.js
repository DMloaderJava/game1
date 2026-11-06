/* Реестр того, что мир помнит: история состояний и её откат. */
import { S } from './state.js';

export const rewindables = [];

export function addRewindable(kind, obj, get, apply, anchor, onDead) {
  const r = {
    kind, obj, get, apply,
    anchor: anchor || obj.position,
    onDead: onDead || null,
    hist: [], lastT: -99, touched: false, dead: false
  };
  rewindables.push(r);
  return r;
}

export function removeRewindable(r) {
  if (!r) return;
  r.dead = true;
  const i = rewindables.indexOf(r);
  if (i >= 0) rewindables.splice(i, 1);
}

export function clearRewindables() {
  rewindables.length = 0;
}

/* запись состояний ~25 раз в секунду */
export function recordHistory(t) {
  for (let i = 0; i < rewindables.length; i++) {
    const r = rewindables[i];
    if (r.dead || r.kind === 'prop') continue;
    if (t - r.lastT < 0.04) continue;
    r.lastT = t;
    r.hist.push({ t, s: r.get() });
    if (r.hist.length > 340) r.hist.shift();
  }
}

export function sampleAt(r, t) {
  const h = r.hist;
  if (!h.length || h[0].t > t) return null;
  let lo = 0, hi = h.length - 1, best = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (h[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return h[best];
}

export function sampleValue(arr, t) {
  if (!arr.length || arr[0].t > t) return null;
  let lo = 0, hi = arr.length - 1, best = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return arr[best];
}

/* один проход перемотки: применяем состояние из прошлого ко всему в пузыре */
export function applyZone(target, center, radius, stitchFn, rwElapsed) {
  for (let i = 0; i < rewindables.length; i++) {
    const r = rewindables[i];
    if (r.dead) continue;
    if (r.anchor.distanceTo(center) > radius) continue;
    if (stitchFn && stitchFn(r.anchor)) continue;
    if (r.kind === 'prop') {
      r.apply({ v: rwElapsed >= 4.2 });
      continue;
    }
    const snap = sampleAt(r, target);
    if (snap) { r.apply(snap.s); r.touched = true; }
    else if (r.kind !== 'enemy') { r.apply(null); r.touched = true; }
  }
}

/* фиксируем новое «сейчас»: всё, что старше — забыто */
export function commitRewind(target) {
  for (let i = rewindables.length - 1; i >= 0; i--) {
    const r = rewindables[i];
    if (r.kind === 'prop' || !r.touched) continue;
    r.touched = false;
    r.hist = r.hist.filter((h) => h.t <= target + 0.0001);
    if (!r.hist.length) {
      r.dead = true;
      if (r.onDead) r.onDead(r);
      rewindables.splice(i, 1);
    }
  }
}
