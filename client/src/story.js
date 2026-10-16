/**
 * SebasPresent — Escenas de la historia (Sesión 52)
 *
 * Reproduce las escenas de los pasos de misión (shared/quests.js):
 *   - líneas de varios personajes, del jugador y del narrador;
 *   - variantes según tus decisiones (sceneBy);
 *   - pasos "ve a tal sitio" (visit): al llegar se completa y se ve la escena;
 *   - decisiones (choice): se elige, se guarda en el servidor y se ve la respuesta.
 * También dibuja los lugares de la historia en el mundo (grieta humeante,
 * reja del sótano, campamento de Tibiabin, Boca del Teide).
 */
import * as THREE from 'three';
import * as api from './api.js';
import * as dialogue from './dialogue.js';
import * as audio from './audio.js';
import { TOWN_NPCS_BY_ID } from './shared/town_npcs.js';
import { STORY_PLACES } from './shared/quests.js';
import { isNightAt, minutesToNight } from './shared/daytime.js';

const SPEAKERS = {
  guayota: { id: 'guayota', name: 'Guayota', title: 'el Señor del Fuego', role: '🔥', look: { shirt: 0xb02800 } },
  voz:     { id: 'voz', name: 'Una voz', title: '', role: '❔', look: { shirt: 0x3a1020 } },
};
const NARRATOR = { id: '_story', name: '', title: '', role: '📜', look: { shirt: 0x4a3a20 } };

export function speaker(who) {
  return SPEAKERS[who] || TOWN_NPCS_BY_ID[who] || { id: who, name: who, role: '🙂' };
}

/** Líneas de un paso: scene + variante por decisión + sceneAfter. */
export function stepLines(step, flags = {}) {
  const v = step?.sceneBy ? (step.sceneBy.values?.[flags[step.sceneBy.flag]] || []) : [];
  return [...(step?.scene || []), ...v, ...(step?.sceneAfter || [])];
}

/** Reproduce líneas en un diálogo abierto. Texto suelto = habla `defaultSpeaker`. */
export async function play(d, lines, defaultSpeaker) {
  for (const l of lines || []) {
    if (d.closed) return false;
    if (typeof l === 'string') {
      if (defaultSpeaker && defaultSpeaker !== NARRATOR) await d.as(defaultSpeaker, l);
      else await d.narr(l);
    } else if (l.who === 'player') await d.player(l.text);
    else if (l.who === 'narr') await d.narr(l.text);
    else {
      if (l.who === 'guayota') { try { audio.synth?.('mine_ore', { volume: 0.5, pitch: 0.5 }); } catch {} }
      await d.as(speaker(l.who), l.text);
    }
  }
  return !d.closed;
}

let busy = false;
let quietUntil = 0;
export function isBusy() { return busy || dialogue.isOpen(); }

/**
 * Paso "ve a…": primero lo valida el servidor (posición, noche) y luego se ve la escena.
 * Devuelve true si se completó.
 */
export async function runVisit(q, step, ctx) {
  if (busy || Date.now() < quietUntil) return false;
  if (step.night) {
    const sn = ctx.serverNow?.() || Date.now();
    if (!isNightAt(sn)) {
      quietUntil = Date.now() + 45_000;
      const d = dialogue.begin(NARRATOR);
      await d.narr(`Todo está en silencio. Aquí no se oye nada de día… Vuelve de noche (en unos ${minutesToNight(sn)} minutos).`);
      d.end();
      return false;
    }
  }
  busy = true;
  try {
    let r;
    try { r = await api.questsVisit(q.id); }
    catch (err) {
      quietUntil = Date.now() + (err?.code === 'not_night' ? 45_000 : 8_000);
      if (err?.code === 'not_night') { const d = dialogue.begin(NARRATOR); await d.narr(err.message || 'Vuelve de noche.'); d.end(); }
      return false;
    }
    ctx.applyRows?.(r?.quests, r?.flags);
    ctx.track?.(q.id);
    const d = dialogue.begin(NARRATOR);
    await play(d, stepLines(step, ctx.flags?.() || {}), NARRATOR);
    d.end();
    return true;
  } finally { busy = false; }
}

/**
 * Decisión: escena, opciones, se guarda en el servidor y se ve la respuesta.
 * `d` = diálogo ya abierto (con el NPC) o null para abrir uno de narrador.
 */
export async function runChoice(q, step, ctx, d = null, npc = null) {
  if (busy) return false;
  busy = true;
  const own = !d;
  if (!d) d = dialogue.begin(npc || NARRATOR);
  try {
    const def = npc || (step.npc ? speaker(step.npc) : NARRATOR);
    if (!(await play(d, stepLines(step, ctx.flags?.() || {}), def))) return false;
    const opts = step.options || [];
    const k = await d.choose(opts.map(o => o.label), step.prompt || 'Decide');
    if (k < 0 || d.closed) return false;
    const opt = opts[k];
    let r;
    try { r = await api.questsChoose(q.id, opt.id); }
    catch (err) {
      await d.narr(err?.code === 'too_far' ? 'Tienes que estar a su lado para decidirlo.' : 'Algo ha fallado. Inténtalo otra vez.');
      return false;
    }
    ctx.applyRows?.(r?.quests, r?.flags);
    ctx.track?.(q.id);
    await play(d, opt.reply || [], def);
    return true;
  } finally {
    busy = false;
    if (own) d.end();
  }
}

// ------------------------------------------------------------
// Lugares de la historia en el mundo (sin luces: materiales que brillan)
// ------------------------------------------------------------
let scene = null, props = [], t = 0, isNightFn = () => false;

export function start(opts) {
  scene = opts.scene;
  isNightFn = opts.isNight || (() => false);
  buildProps();
}
export function stop() {
  for (const p of props) { scene?.remove(p.g); p.g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  props = [];
}

function buildProps() {
  if (!scene || props.length) return;
  // Grieta humeante de Las Cañadas
  {
    const P = STORY_PLACES.grieta, g = new THREE.Group();
    g.position.set(P.x, 0, P.z);
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.1), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }));
    crack.rotation.x = -Math.PI / 2; crack.position.y = 0.05; g.add(crack);
    const sulf = new THREE.MeshLambertMaterial({ color: 0xd8c040, flatShading: true });
    for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + (i % 3) * 0.15, 0), sulf); r.position.set(-3 + i, 0.2, (i % 2 ? 0.9 : -0.9)); g.add(r); }
    const steam = [];
    const sm = new THREE.MeshBasicMaterial({ color: 0xf0f0d0, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), sm.clone()); g.add(s); steam.push({ s, ph: i / 9, x: -3 + (i % 5) * 1.5 }); }
    scene.add(g);
    props.push({ g, update: (dt) => {
      for (const st of steam) {
        const k = (t * 0.25 + st.ph) % 1;
        st.s.position.set(st.x + Math.sin(k * 6 + st.ph * 9) * 0.4, 0.4 + k * 6, Math.cos(k * 5) * 0.3);
        st.s.scale.setScalar(0.6 + k * 2.2);
        st.s.material.opacity = 0.35 * (1 - k);
      }
      crack.material.opacity = 0.75 + Math.sin(t * 3) * 0.2;
    } });
  }
  // Reja del sótano del Cabildo (de noche sale luz roja)
  {
    const P = STORY_PLACES.reja, g = new THREE.Group();
    g.position.set(P.x, 0, P.z);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.2), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
    frame.position.y = 0.05; g.add(frame);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.0 }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.07; g.add(glow);
    const barM = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), barM); b.position.set(-0.65 + i * 0.26, 0.12, 0); g.add(b); }
    scene.add(g);
    props.push({ g, update: () => {
      const night = isNightFn();
      glow.material.opacity = night ? 0.55 + Math.sin(t * 2.2) * 0.25 : 0.0;
    } });
  }
  // Campamento de Tibiabin: círculo de piedras y hoguera de retama
  {
    const P = STORY_PLACES.campamento, g = new THREE.Group();
    g.position.set(P.x + 2.5, 0, P.z + 1.5);
    const stone = new THREE.MeshLambertMaterial({ color: 0x6a6258, flatShading: true });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stone); s.position.set(Math.cos(a) * 1.1, 0.15, Math.sin(a) * 1.1); g.add(s); }
    const flames = [];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.35 - i * 0.08, 1.1 - i * 0.2, 6), new THREE.MeshBasicMaterial({ color: [0xff6a1a, 0xffa030, 0xffe070][i], transparent: true, opacity: 0.85 }));
      f.position.y = 0.5; g.add(f); flames.push(f);
    }
    scene.add(g);
    props.push({ g, update: () => flames.forEach((f, i) => { f.scale.y = 0.85 + Math.sin(t * (8 + i * 3) + i) * 0.2; f.rotation.y = t * (1 + i); }) });
  }
  // Boca del Teide: grietas de lava alrededor de la guarida de Guayota
  {
    const P = STORY_PLACES.boca, g = new THREE.Group();
    g.position.set(P.x, 0, P.z);
    const lava = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.85 });
    const lavas = [];
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2 + (i % 2) * 0.2, r = 22 + (i % 3) * 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5 + (i % 4), 0.6 + (i % 3) * 0.3), lava.clone());
      m.rotation.x = -Math.PI / 2; m.rotation.z = a + 1.3;
      m.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
      g.add(m); lavas.push(m);
    }
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshBasicMaterial({ color: 0xff3a00, transparent: true, opacity: 0.8 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; g.add(pool);
    scene.add(g);
    props.push({ g, update: () => {
      lavas.forEach((m, i) => { m.material.opacity = 0.6 + Math.sin(t * 1.5 + i) * 0.25; });
      pool.material.opacity = 0.7 + Math.sin(t * 2) * 0.15;
    } });
  }
}

export function update(dt) {
  t += dt;
  for (const p of props) { try { p.update(dt); } catch {} }
}
