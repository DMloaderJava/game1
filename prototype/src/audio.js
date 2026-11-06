/* Процедурный саундтрек: 4 слоя, реагирующие на Индекс разлома. */
import { S, clamp } from './state.js';

let A = null;
let zoneBase = 55;

export function initAudio() {
  if (A) {
    if (A.ctx.state === 'suspended') A.ctx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 5;
  filter.connect(master);

  const oscs = [];
  [1, 1.5, 2, 3, 4].forEach((mul, i) => {
    const o = ctx.createOscillator();
    o.type = i % 2 ? 'sawtooth' : 'triangle';
    o.frequency.value = zoneBase * mul;
    const g = ctx.createGain();
    g.gain.value = 0.15 / (i + 1);
    o.connect(g); g.connect(filter); o.start();
    oscs.push({ o, g, mul });
  });

  const choir = [];
  [6, 7.5, 9].forEach((mul) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = zoneBase * mul;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(master); o.start();
    choir.push({ o, g, mul });
  });

  A = { ctx, master, filter, oscs, choir };
  master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime);
  setTimeout(() => { try { master.gain.linearRampToValueAtTime(S.settings.vol * 0.35, ctx.currentTime + 2); } catch (e) {} }, 50);
}

export function setZoneTone(i) {
  zoneBase = [55, 46.25, 61.7, 73.4, 41.2][i] || 55;
  if (!A) return;
  for (const x of A.oscs) x.o.frequency.setTargetAtTime(zoneBase * x.mul, A.ctx.currentTime, 0.6);
  for (const x of A.choir) x.o.frequency.setTargetAtTime(zoneBase * x.mul, A.ctx.currentTime, 0.6);
}

export function setVolume(v) {
  S.settings.vol = v;
  if (A) {
    try { A.master.gain.setTargetAtTime(v * 0.35, A.ctx.currentTime, 0.2); } catch (e) {}
  }
}

export function updateAudio() {
  if (!A) return;
  const t = clamp(S.rift / 100, 0, 1);
  const now = A.ctx.currentTime;
  A.filter.frequency.setTargetAtTime(320 + t * 2600, now, 0.25);
  for (let i = 0; i < A.oscs.length; i++) {
    const x = A.oscs[i];
    x.o.detune.setTargetAtTime((i - 2) * t * 34, now, 0.3);
  }
  for (let i = 0; i < A.choir.length; i++) {
    const x = A.choir[i];
    x.g.gain.setTargetAtTime(0.004 + t * 0.03, now, 0.4);
    x.o.detune.setTargetAtTime(-t * 60 + Math.sin(S.time * 0.3 + i) * 6, now, 0.4);
  }
}

function tone(freq, dur, type, vol, slideTo) {
  if (!A) return;
  const now = A.ctx.currentTime;
  const o = A.ctx.createOscillator();
  const g = A.ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, now);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(vol || 0.12, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(A.master);
  o.start(now); o.stop(now + dur + 0.03);
}

export function sfx(name) {
  if (!A) return;
  switch (name) {
    case 'jump': tone(220, 0.1, 'sine', 0.05); break;
    case 'dash': tone(520, 0.14, 'triangle', 0.07, 300); break;
    case 'echo': tone(660, 0.35, 'sine', 0.06); tone(990, 0.3, 'sine', 0.03); break;
    case 'sculpt': tone(150, 0.12, 'triangle', 0.05); break;
    case 'block': tone(95, 0.16, 'sine', 0.07, 70); break;
    case 'condense': tone(420, 0.14, 'square', 0.06, 620); break;
    case 'rewindStart': tone(320, 0.4, 'sine', 0.07, 90); break;
    case 'rewindEnd': tone(90, 0.3, 'sine', 0.05, 320); break;
    case 'collapse': tone(110, 0.5, 'sawtooth', 0.15, 34); tone(70, 0.45, 'square', 0.08, 28); break;
    case 'hurt': tone(140, 0.18, 'square', 0.08, 90); break;
    case 'kill': tone(160, 0.3, 'sawtooth', 0.1, 50); break;
    case 'paradox':
      tone(1200, 0.55, 'sine', 0.14, 300);
      tone(70, 0.6, 'sawtooth', 0.12, 40);
      break;
    case 'node': tone(440, 0.5, 'sine', 0.1, 880); tone(660, 0.6, 'sine', 0.06, 1320); break;
    case 'portal': tone(220, 1.2, 'sine', 0.1, 660); break;
    case 'death': tone(180, 0.9, 'sawtooth', 0.14, 40); break;
    case 'boss': tone(60, 1.4, 'sawtooth', 0.16, 42); break;
    case 'phase': tone(320, 0.8, 'square', 0.1, 640); break;
    case 'buy': tone(520, 0.2, 'sine', 0.08, 780); break;
  }
}
