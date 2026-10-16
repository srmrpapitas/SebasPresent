/**
 * SebasPresent — Sonidos de ambiente (Sesión 52)
 *
 * Todo sintetizado con Web Audio (sin archivos ni peticiones):
 *   - Mar: oleaje cerca de la costa (borde del mundo) y chapoteo junto a las lagunas.
 *   - Viento: más fuerte en las Cañadas (nieve), el desierto y el Malpaís.
 *   - De día: pájaros en el campo y el monte; gaviotas en la costa.
 *   - De noche: grillos (y algún búho en el monte).
 *   - Cueva: gotas y un rumor grave. Dentro de casas: silencio.
 *
 * Volumen propio ("Ambiente" en ⚙ Ajustes) separado de la música.
 *   ambience.start({ getPlayer, biomeAt, isNight, isIndoors, isCave, isAsleep })
 *   ambience.update(dt)   ambience.stop()
 */
import * as audio from './audio.js';
import { WORLD_HALF } from './terrain.js';
import { PONDS } from './shared/fishing.js';

let ctx = null, out = null;
let sea = null, wind = null, rumble = null;
let opts = null;
let started = false;
let t = 0, sampleAcc = 0;
let level = { sea: 0, wind: 0, rumble: 0 };
let timers = { bird: 2, gull: 4, cricket: 1, owl: 25, drip: 1.5, frog: 3 };
let env = { coast: 0, pond: 0, biome: 'plains', night: false, indoors: false, cave: false, wild: false, asleep: false };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const rnd = (a, b) => a + Math.random() * (b - a);

export function start(o) {
  opts = o;
  started = true;
}

export function stop() {
  started = false;
  try { out?.disconnect(); } catch {}
  for (const l of [sea, wind, rumble]) { try { l?.src.stop(); } catch {} }
  ctx = out = sea = wind = rumble = null;
}

function noiseBuffer(c, seconds, brown) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function loopLayer(buf, type, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(out);
  src.start();
  return { src, f, g };
}

function ensureGraph() {
  if (ctx) return true;
  const c = audio.getContext?.();
  if (!c || c.state !== 'running') return false;   // hasta el primer toque (Safari/Chrome)
  ctx = c;
  out = ctx.createGain(); out.gain.value = 0;
  out.connect(ctx.destination);
  const brown = noiseBuffer(ctx, 6, true), white = noiseBuffer(ctx, 4, false);
  sea = loopLayer(brown, 'lowpass', 700, 0.4);
  wind = loopLayer(white, 'bandpass', 500, 0.7);
  rumble = loopLayer(brown, 'lowpass', 140, 0.5);
  return true;
}

function sampleEnv() {
  const p = opts.getPlayer?.();
  env.indoors = !!opts.isIndoors?.();
  env.cave = !!opts.isCave?.();
  env.night = !!opts.isNight?.();
  env.asleep = !!opts.isAsleep?.();
  if (!p) return;
  const x = p.position.x, z = p.position.z;
  const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));      // metros hasta el mar
  env.coast = clamp01(1 - (edge - 15) / 170);
  let pond = 0;
  for (const P of PONDS) {
    if (P.frozen) continue;
    const d = Math.hypot(P.x - x, P.z - z) - P.r;
    pond = Math.max(pond, clamp01(1 - d / 35));
  }
  env.pond = pond;
  try { env.biome = opts.biomeAt?.(x, z)?.id || 'plains'; } catch { env.biome = 'plains'; }
  env.wild = env.biome === 'wilderness';
}

export function update(dt) {
  if (!started || !opts) return;
  if (!ensureGraph()) return;
  t += dt;
  sampleAcc += dt;
  if (sampleAcc > 0.5) { sampleAcc = 0; sampleEnv(); }

  const vol = audio.getAmbientVolume?.() ?? 0.3;
  const silent = env.indoors || env.asleep;
  const now = ctx.currentTime;
  out.gain.setTargetAtTime(silent ? 0 : vol, now, 0.6);
  if (silent) return;

  // Niveles de las capas continuas
  const b = env.biome;
  const outdoor = env.cave ? 0 : 1;
  const seaL = outdoor * Math.max(env.coast * 0.55, env.pond * 0.12);
  let windL = 0.06 + (b === 'snow' ? 0.32 : b === 'desert' ? 0.18 : 0) + (env.wild ? 0.16 : 0) + env.coast * 0.08 + (env.night ? 0.04 : 0);
  windL *= outdoor;
  const rumbleL = env.cave ? 0.35 : 0;
  level.sea += (seaL - level.sea) * Math.min(1, dt * 0.8);
  level.wind += (windL - level.wind) * Math.min(1, dt * 0.8);
  level.rumble += (rumbleL - level.rumble) * Math.min(1, dt * 0.8);
  // oleaje: sube y baja como olas que rompen
  const swell = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1), 1.6);
  sea.g.gain.setTargetAtTime(level.sea * swell, now, 0.25);
  sea.f.frequency.setTargetAtTime(420 + 520 * swell, now, 0.3);
  const gust = 0.6 + 0.4 * Math.sin(t * 0.33) * Math.sin(t * 0.13 + 2);
  wind.g.gain.setTargetAtTime(level.wind * gust, now, 0.5);
  wind.f.frequency.setTargetAtTime(320 + 520 * gust, now, 0.6);
  rumble.g.gain.setTargetAtTime(level.rumble, now, 0.8);

  // Sonidos sueltos
  const landBirds = !env.cave && !env.night && ['plains', 'forest', 'jungle', 'swamp', 'plaza'].includes(b);
  tick('bird', dt, landBirds, () => (b === 'forest' || b === 'jungle') ? rnd(1.5, 5) : rnd(3.5, 9), bird);
  tick('gull', dt, !env.cave && !env.night && env.coast > 0.25, () => rnd(4, 11), gull);
  tick('cricket', dt, !env.cave && env.night && b !== 'snow' && b !== 'wilderness', () => rnd(0.35, 1.1), cricket);
  tick('owl', dt, !env.cave && env.night && (b === 'forest' || b === 'swamp'), () => rnd(18, 45), owl);
  tick('frog', dt, !env.cave && env.night && (env.pond > 0.3 || b === 'swamp'), () => rnd(1.2, 4), frog);
  tick('drip', dt, env.cave, () => rnd(0.8, 3.2), drip);
}

function tick(name, dt, active, next, fn) {
  if (!active) { timers[name] = Math.min(timers[name], 2); return; }
  timers[name] -= dt;
  if (timers[name] <= 0) { timers[name] = next(); try { fn(); } catch {} }
}

// ------------------------------------------------------------
// Voces sintetizadas
// ------------------------------------------------------------
function voiceOut(gain, pan = rnd(-0.8, 0.8)) {
  const g = ctx.createGain(); g.gain.value = gain;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(out); }
  else g.connect(out);
  return g;
}
function note(dst, t0, dur, f0, f1, peak, type = 'sine') {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dst);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** Pájaros: canario (trino rápido), mirlo (frase melódica) o capirote (silbos). */
function bird() {
  const dst = voiceOut(rnd(0.05, 0.11));
  const t0 = ctx.currentTime + 0.02;
  const kind = Math.random();
  if (kind < 0.4) {                     // canario: trino
    const base = rnd(2600, 3600), n = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) { const st = t0 + i * 0.055; note(dst, st, 0.045, base * (i % 2 ? 1.12 : 1), base * (i % 2 ? 0.95 : 1.18), 0.6); }
  } else if (kind < 0.75) {             // mirlo: 3-5 notas que suben y bajan
    let f = rnd(1400, 2100); let st = t0;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const d = rnd(0.09, 0.18); const f1 = f * rnd(0.85, 1.25); note(dst, st, d, f, f1, 0.55); st += d + rnd(0.02, 0.07); f = f1 * rnd(0.9, 1.15); }
  } else {                              // silbo de dos notas
    const f = rnd(2200, 3000);
    note(dst, t0, 0.22, f, f * 1.25, 0.45); note(dst, t0 + 0.3, 0.25, f * 1.2, f * 0.9, 0.45);
  }
}

/** Gaviota: "kyaaa" que baja, 2-3 veces. */
function gull() {
  const dst = voiceOut(rnd(0.035, 0.07));
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 2.2;
  bp.connect(dst);
  const t0 = ctx.currentTime + 0.02, n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) { const st = t0 + i * rnd(0.38, 0.5); note(bp, st, 0.34, rnd(1500, 1750), rnd(750, 950), 0.9, 'sawtooth'); }
}

/** Grillo: grupos de 3 pulsos agudos. */
function cricket() {
  const dst = voiceOut(rnd(0.012, 0.025));
  const f = rnd(4200, 4800), t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) note(dst, t0 + i * 0.05, 0.03, f, f * 0.98, 0.8);
}

/** Búho: "uu-uuu" grave. */
function owl() {
  const dst = voiceOut(rnd(0.05, 0.08));
  const t0 = ctx.currentTime + 0.02, f = rnd(360, 420);
  note(dst, t0, 0.32, f, f * 0.94, 0.7); note(dst, t0 + 0.55, 0.5, f * 1.02, f * 0.9, 0.7);
}

/** Rana: croar corto y ronco. */
function frog() {
  const dst = voiceOut(rnd(0.025, 0.045));
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(dst);
  const t0 = ctx.currentTime + 0.02, f = rnd(180, 260);
  for (let i = 0; i < 2; i++) note(lp, t0 + i * 0.13, 0.1, f, f * 1.3, 0.9, 'square');
}

/** Gota en la cueva. */
function drip() {
  const dst = voiceOut(rnd(0.04, 0.08));
  const t0 = ctx.currentTime + 0.02, f = rnd(900, 1600);
  note(dst, t0, 0.07, f * 1.6, f * 0.6, 0.8);
}

/** Estado para depurar (consola): niveles y entorno. */
export function debugState() {
  return { running: !!ctx, ctxState: ctx?.state, out: out?.gain.value, level: { ...level }, env: { ...env } };
}
