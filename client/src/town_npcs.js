/**
 * SebasPresent — Habitantes del mundo (cliente) · Sesión 50
 *
 * - Modelos low-poly procedurales (cada uno con su ropa, pelo y accesorio).
 * - Respiran, miran al jugador cuando se acerca y gesticulan al hablar.
 * - Encima de la cabeza: "!" amarillo = tiene misión para ti,
 *   "?" amarillo = puedes entregarle / terminar, "?" gris = misión en curso.
 * - Tap → caminar hasta él y hablar (cuadro de diálogo estilo OSRS).
 *   Pulsación larga → "Hablar / Examinar".
 *
 * Datos en shared/town_npcs.js y misiones en shared/quests.js (giver/offer/…).
 */

import { LORE } from './shared/lore.js';   // Sesión 50 — Crónicas de Achinech
import * as THREE from 'three';
import * as api from './api.js';
import { HOUSE_TIERS, HOUSE_TIER_LIST, upgradeCost } from './shared/houses.js';   // Sesión 50
import { MOUNTS, MOUNT_LIST } from './shared/mounts.js';   // Sesión 50
import * as inventory from './inventory.js';
import * as quests from './quests.js';
import * as audio from './audio.js';
import * as dialogue from './dialogue.js';
import { TOWN_NPCS, TOWN_NPCS_BY_ID, TALK_DIST_M } from './shared/town_npcs.js';
import { QUESTS, QUEST_ORDER, questsOfNpc } from './shared/quests.js';

const VIEW_DIST = 180;
const LOOK_DIST = 9;
const APPROACH = 1.6;

let scene = null, getPlayer = null, setPlayerTargetCb = null, feedLog = () => {}, onOpenBank = () => {}, onOpenShop = () => {}, onOpenGE = () => {};
let started = false;
let timeAcc = 0, syncTimer = 0, markTimer = 0;
const objs = new Map();
const pickMeshes = [];
let pending = null;
let talking = null;   // obj con el que hablas
const nameCache = {};

// ============================================================
// Modelo
// ============================================================
const MATS = new Map();
function mat(color) {
  if (!MATS.has(color)) MATS.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return MATS.get(color);
}
const shade = (c, f) => new THREE.Color(c).multiplyScalar(f).getHex();

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function buildModel(n) {
  const L = n.look || {};
  const skin = L.skin ?? 0xe0b08a, shirt = L.shirt ?? 0x6a5a3a, pants = L.pants ?? 0x3a3226, hair = L.hair ?? 0x3a2a1a;
  const root = new THREE.Group();

  // Piernas + zapatos
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.12, 0.82, 0);
    leg.add(box(0.19, 0.74, 0.21, pants, 0, -0.37, 0));
    leg.add(box(0.21, 0.1, 0.3, 0x2a1a10, 0, -0.77, 0.04));
    root.add(leg); legs.push(leg);
  }
  // Torso
  const torso = new THREE.Group();
  torso.position.y = 0.82;
  torso.add(box(0.52, 0.62, 0.3, shirt, 0, 0.33, 0));
  torso.add(box(0.54, 0.08, 0.32, shade(pants, 0.7), 0, 0.04, 0));   // cinturón
  if (L.acc === 'apron') torso.add(box(0.42, 0.62, 0.02, 0xcfc3a8, 0, 0.2, 0.17));
  root.add(torso);
  // Brazos (pivote en el hombro)
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.34, 0.6, 0);
    arm.add(box(0.14, 0.52, 0.16, shirt, 0, -0.26, 0));
    arm.add(box(0.12, 0.12, 0.13, skin, 0, -0.57, 0));
    torso.add(arm); arms.push(arm);
  }
  // Cabeza
  const head = new THREE.Group();
  head.position.y = 0.68;
  head.add(box(0.1, 0.08, 0.1, skin, 0, 0.02, 0));                        // cuello
  head.add(box(0.3, 0.32, 0.28, skin, 0, 0.22, 0));
  head.add(box(0.05, 0.05, 0.02, 0x1a1a1a, -0.07, 0.25, 0.145));           // ojos
  head.add(box(0.05, 0.05, 0.02, 0x1a1a1a, 0.07, 0.25, 0.145));
  head.add(box(0.05, 0.07, 0.05, shade(skin, 0.9), 0, 0.19, 0.16));        // nariz
  head.add(box(0.1, 0.02, 0.02, shade(skin, 0.6), 0, 0.11, 0.145));        // boca
  // Pelo (atrás y arriba)
  if (L.acc !== 'helm' && L.acc !== 'hood' && L.acc !== 'wizard') {
    head.add(box(0.32, 0.1, 0.3, hair, 0, 0.41, -0.01));
    head.add(box(0.32, 0.26, 0.06, hair, 0, 0.26, -0.14));
  }
  // Accesorio
  if (L.acc === 'hat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), mat(shade(shirt, 0.6)));
    brim.position.y = 0.42; head.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 10), mat(shade(shirt, 0.6)));
    crown.position.y = 0.52; head.add(crown);
  } else if (L.acc === 'hood') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(shade(shirt, 0.85)));
    hood.position.set(0, 0.26, -0.03); hood.scale.set(1.05, 1.1, 1.05); head.add(hood);
  } else if (L.acc === 'helm') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.7, roughness: 0.35, flatShading: true }));
    helm.position.y = 0.3; helm.scale.set(1.0, 1.05, 1.0); head.add(helm);
    head.add(box(0.04, 0.14, 0.03, 0x9aa2aa, 0, 0.26, 0.16));
  } else if (L.acc === 'wizard') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10), mat(shade(shirt, 1.1)));
    hat.position.y = 0.66; hat.rotation.z = 0.12; head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), mat(shade(shirt, 1.1)));
    brim.position.y = 0.4; head.add(brim);
    head.add(box(0.2, 0.18, 0.08, hair, 0, 0.06, 0.15));   // barba
  } else if (L.acc === 'crown') {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
    ring.position.y = 0.44; head.add(ring);
  } else if (L.acc === 'bandana') {
    head.add(box(0.32, 0.07, 0.3, 0xa02a2a, 0, 0.36, 0));
  } else if (L.acc === 'glasses') {   // Sesión 50 — Nauzet
    head.add(box(0.1, 0.07, 0.02, 0x101010, -0.075, 0.25, 0.16));
    head.add(box(0.1, 0.07, 0.02, 0x101010, 0.075, 0.25, 0.16));
    head.add(box(0.06, 0.02, 0.02, 0x101010, 0, 0.26, 0.16));
  }
  torso.add(head);

  // Hitbox
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 1.05;
  root.add(hit);

  return { root, torso, head, arms, legs, hit };
}

// Sprite de texto (marca de misión / nombre)
function textSprite(text, color, size = 64, font = 'bold 52px sans-serif') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#000'; g.strokeText(text, size / 2, size / 2 + 2);
  g.fillStyle = color; g.fillText(text, size / 2, size / 2 + 2);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.renderOrder = 10;
  return sp;
}
function nameSprite(n) {
  if (nameCache[n.id]) return nameCache[n.id].clone();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText(n.name, 128, 24);
  g.fillStyle = '#ffff66'; g.fillText(n.name, 128, 24);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.set(1.6, 0.3, 1);
  sp.renderOrder = 9;
  nameCache[n.id] = sp;
  return sp.clone();
}

// Sesión 50 — Puesto con toldo y cartel (La ASO: hierbas y viales)
function buildStall(n) {
  const g = new THREE.Group();
  g.position.set(n.x, 0, n.z);
  g.rotation.y = n.rotY || 0;
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a3018, flatShading: true });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.7), wood);
  counter.position.set(0, 0.5, 0.9);
  g.add(counter);
  for (const sx of [-1.25, 1.25]) for (const sz of [0.55, -0.9]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), dark);
    post.position.set(sx, 1.3, sz);
    g.add(post);
  }
  // Toldo a rayas verdes y blancas
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f4f0e0' : '#2f8a3a'; x.fillRect(i * 16, 0, 16, 32); }
  const tex = new THREE.CanvasTexture(c);
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.7), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  awning.position.set(0, 2.55, 0.0);
  awning.rotation.x = -Math.PI / 2 + 0.35;
  g.add(awning);
  // Cartel
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 64;
  const sx = sc.getContext('2d');
  sx.fillStyle = '#2a4a1a'; sx.fillRect(0, 0, 256, 64);
  sx.strokeStyle = '#d8c070'; sx.lineWidth = 4; sx.strokeRect(3, 3, 250, 58);
  sx.fillStyle = '#f4e8b0'; sx.font = 'bold 34px serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle';
  sx.fillText(n.stall.sign || 'LA ASO', 128, 34);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide }));
  sign.position.set(0, 2.95, 0.62);
  g.add(sign);
  // Macetas de hierbas y frascos sobre el mostrador
  const pot = new THREE.MeshLambertMaterial({ color: 0xa0522d, flatShading: true });
  const leaf = [0x3a8a2a, 0x7ab040, 0xc03030, 0xe0c040];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.18, 7), pot);
    p.position.set(-0.9 + i * 0.3, 1.09, 0.85);
    g.add(p);
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshLambertMaterial({ color: leaf[i], flatShading: true }));
    l.position.set(-0.9 + i * 0.3, 1.27, 0.85);
    g.add(l);
  }
  const glass = [0x60c0ff, 0xff6040, 0x60ff80];
  for (let i = 0; i < 3; i++) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 8),
      new THREE.MeshLambertMaterial({ color: glass[i], emissive: glass[i], emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }));
    v.position.set(0.35 + i * 0.25, 1.11, 0.95);
    g.add(v);
  }
  return g;
}

function build(n) {
  const m = buildModel(n);
  m.root.position.set(n.x, 0, n.z);
  m.root.rotation.y = n.rotY || 0;
  m.hit.userData = { kind: 'town_npc', npcId: n.id };
  const name = nameSprite(n);
  name.position.y = 2.25;
  m.root.add(name);
  const markY = 2.65;
  const bang = textSprite('!', '#ffd24a'); bang.scale.set(0.7, 0.7, 1); bang.position.y = markY; bang.visible = false;
  const qGold = textSprite('?', '#ffd24a'); qGold.scale.set(0.7, 0.7, 1); qGold.position.y = markY; qGold.visible = false;
  const qGray = textSprite('?', '#b8b8b8'); qGray.scale.set(0.6, 0.6, 1); qGray.position.y = markY; qGray.visible = false;
  m.root.add(bang, qGold, qGray);
  scene.add(m.root);
  pickMeshes.push(m.hit);
  const o = { n, ...m, name, bang, qGold, qGray, mark: null, baseYaw: n.rotY || 0, phase: Math.random() * 6, gestureT: 0 };
  if (n.stall) { o.stall = buildStall(n); scene.add(o.stall); }   // Sesión 50 — puesto (La ASO)
  objs.set(n.id, o);
  updateMark(o);
  return o;
}

function dispose(o) {
  scene?.remove(o.root);
  if (o.stall) scene?.remove(o.stall);
  const i = pickMeshes.indexOf(o.hit);
  if (i >= 0) pickMeshes.splice(i, 1);
  objs.delete(o.n.id);
}

// ============================================================
// Estado de misiones del NPC
// ============================================================
function invCount(id) {
  let c = 0;
  for (const s of inventory.getState?.() || []) if (s && s.item_id === id) c += s.quantity || 1;
  return c;
}

/** Qué puede hacer el jugador con este NPC ahora mismo. */
function npcQuestInfo(npcId) {
  const offer = [], turnIn = [], doing = [];
  for (const id of QUEST_ORDER) {
    const q = QUESTS[id];
    const s = quests.getQuestState(id);
    if (!s) { if (q.giver === npcId) offer.push(q); continue; }
    if (s.status !== 0) continue;
    const step = q.steps[s.step];
    if (!step) continue;
    if (step.event === 'talk' && step.match === npcId) turnIn.push({ q, step });
    else if (step.event === 'deliver' && step.npc === npcId) {
      const ok = step.items.every(([it, k]) => invCount(it) >= k);
      (ok ? turnIn : doing).push({ q, step, deliver: true, ok });
    } else if (q.giver === npcId) doing.push({ q, step });
  }
  return { offer, turnIn, doing };
}

function updateMark(o) {
  const info = npcQuestInfo(o.n.id);
  const mark = info.turnIn.length ? 'turnin' : info.offer.length ? 'offer' : info.doing.length ? 'doing' : null;
  o.mark = mark;
  o.bang.visible = mark === 'offer';
  o.qGold.visible = mark === 'turnin';
  o.qGray.visible = mark === 'doing';
}

// ============================================================
// Diálogo
// ============================================================
const ITEM_NAMES = {
  shrimp: 'gambas cocinadas', cooked_beef: 'ternera cocinada', oak_logs: 'troncos de roble', bar_hierro: 'lingotes de hierro',
  bones: 'huesos', feather: 'plumas',
};
const itemName = (id) => ITEM_NAMES[id] || id.replace(/_/g, ' ');

async function talkTo(o) {
  const n = o.n;
  talking = o;
  o.gestureT = 1.2;
  try { audio.sfx?.('book_open'); } catch {}
  const d = dialogue.begin(n);
  const info0 = npcQuestInfo(n.id);

  // 1) Lo más urgente primero: terminar / entregar
  for (const t of info0.turnIn) {
    if (d.closed) break;
    if (t.deliver) {
      await d.npc(`¿Me traes lo que te pedí?`);
      const pick = await d.choose([`Entregar: ${t.step.items.map(([i, k]) => `${k} ${itemName(i)}`).join(', ')}`, 'Todavía no.']);
      if (pick !== 0) continue;
      try {
        const r = await api.npcDeliver(n.id);
        quests.applyServerRows(r?.quests);
        await afterProgress(d, t.q);
      } catch (err) {
        await d.npc(err?.code === 'missing_items' ? 'Te falta algo… revisa tu mochila.' : 'Acércate un poco más.');
      }
    } else {
      try {
        const r = await api.npcTalk(n.id);
        quests.applyServerRows(r?.quests);
        await afterProgress(d, t.q);
      } catch {
        await d.npc('Acércate un poco más, que no te oigo.');
      }
    }
  }
  if (d.closed) { talking = null; return; }

  // 2) Menú de temas
  let greeted = false;
  while (!d.closed) {
    const info = npcQuestInfo(n.id);
    if (!greeted) {
      greeted = true;
      await d.npc(n.lines?.[0] || '¿Qué quieres?');
      if (d.closed) break;
    }
    const opts = [];
    for (const q of info.offer) opts.push({ label: `❗ ${q.name}`, run: () => offerQuest(d, n, q) });
    for (const t of info.doing) opts.push({ label: `📜 ${t.q.name}`, run: () => aboutQuest(d, t) });
    // Sesión 50 — Lore: Crónicas de Achinech
    if (LORE[n.id]) {
      const L = LORE[n.id];
      opts.push({ label: L.label, run: async () => {
        for (const page of L.pages) { await d.npc(page); if (d.closed) return; }
      } });
    }
    if (n.actions?.includes('mounts')) opts.push({ label: '🐎 Quiero una montura', run: () => stableAgent(d) });   // Sesión 50
    if (n.actions?.includes('house')) opts.push({ label: '🏠 Quiero una casa', run: () => houseAgent(d) });   // Sesión 50
    if (n.actions?.includes('bank')) opts.push({ label: '🏦 Quiero usar el banco', run: async () => { d.end(); onOpenBank(); } });
    if (n.actions?.includes('ge')) opts.push({ label: '🏛️ Mercado (GE)', run: async () => { d.end(); onOpenGE(); } });   // Sesión 50
    // Sesión 50 — La Fosa de Guayota
    if (n.actions?.includes('fosa')) {
      opts.push({ label: '🔥 Quiero bajar a la Fosa', run: async () => {
        await d.npc('¿Seguro? Lleva comida y plegaria. Doce rondas… y si llegas, Guayota.');
        if (d.closed) return;
        const k = await d.choose(['¡Vamos allá!', 'Mejor otro día.'], 'La Fosa de Guayota');
        if (k !== 0) return;
        d.end();
        try { window.__fosa?.enter?.(); } catch (e) { console.warn(e); }
      } });
      opts.push({ label: '❓ ¿Cómo funciona la Fosa?', run: async () => { for (const l of n.lines.slice(1)) { await d.npc(l); if (d.closed) return; } } });
    }
    for (const a of n.actions || []) {
      if (!a.startsWith('shop:')) continue;
      const shopId = a.slice(5);
      opts.push({ label: shopId === 'magic_store' ? '🔮 Ver la tienda de magia' : shopId === 'aso' ? '🌿 Ver las hierbas' : '🛒 Ver la tienda', run: async () => {
        if (shopId === 'aso' && !(await asoDoor(d))) return;   // Sesión 50 — solo socios
        d.end(); onOpenShop(shopId);
      } });
    }
    if ((n.lines?.length || 0) > 1) opts.push({ label: '💬 ¿Qué me cuentas?', run: () => d.npc(n.lines[1 + Math.floor(Math.random() * (n.lines.length - 1))]) });
    opts.push({ label: '👋 Adiós', run: async () => { await d.player('Adiós.'); d.end(); } });
    const i = await d.choose(opts.map(x => x.label), `Hablando con ${n.name}`);
    if (i < 0 || d.closed) break;
    await opts[i].run();
  }
  talking = null;
  for (const obj of objs.values()) updateMark(obj);
}

// Sesión 50 — Tanausú vende monturas
async function stableAgent(d) {
  let st;
  try { st = await api.mountsGet(); } catch { await d.npc('Los animales están comiendo. Vuelve en un ratito.'); return; }
  const owned = new Set(st?.owned || []);
  const lvl = st?.combat_level || 3;
  const avail = MOUNT_LIST.filter(id => !owned.has(id));
  if (!avail.length) { await d.npc('Ya tienes el caballo y la pardela. ¡Más que el mencey!'); return; }
  await d.npc(owned.size ? '¿Otra montura? Tú sí que sabes.' : 'Tengo dos animales buenos. Tú eliges.');
  if (d.closed) return;
  const labels = [...avail.map(id => {
    const M = MOUNTS[id];
    return `${M.icon} ${M.name} — ${M.price.toLocaleString('es-ES')} monedas (nivel ${M.level})${lvl < M.level ? ' 🔒' : ''}`;
  }), '📋 ¿Cómo es cada uno?', 'Ahora no'];
  while (!d.closed) {
    const k = await d.choose(labels, 'La cuadra de Tanausú');
    if (k < 0 || d.closed || k === labels.length - 1) return;
    if (k === labels.length - 2) {
      for (const id of MOUNT_LIST) { await d.npc(`${MOUNTS[id].icon} ${MOUNTS[id].name}: ${MOUNTS[id].blurb}`); if (d.closed) return; }
      continue;
    }
    const M = MOUNTS[avail[k]];
    if (lvl < M.level) { await d.npc(`Tú todavía eres muy flojito pa'l ${M.name}, mi niño. Vuelve con nivel de combate ${M.level} (tienes ${lvl}).`); continue; }
    await d.player(`Me llevo ${M.id === 'pardela' ? 'la' : 'el'} ${M.name}.`);
    try {
      await api.mountsBuy(M.id);
      try { audio.synth?.('craft_done', { volume: 0.7 }); } catch {}
      feedLog('info', `${M.icon} ¡Ya tienes ${M.name}! Pulsa el botón ${M.icon} junto a la vida para montar.`);
      await d.npc(M.fly ? `¡Cuídamela! Por tierra ya la puedes usar; con nivel de combate ${M.flyLevel} vuela. Pero si te pegan, al suelo.` : '¡Todo tuyo! Pulsa el botón de la montura y a correr por los caminos.');
      try { window.__mounts?.refresh?.(); } catch {}
    } catch (err) {
      await d.npc(err?.code === 'not_enough_coins' ? '¿Y las perras? Sin monedas no hay animal, mi niño.'
        : err?.code === 'low_level' ? 'Todavía no estás preparado pa\' ese animal.'
        : err?.code === 'too_far' ? 'Arrímate, que no te oigo.' : 'Algo ha fallado. Prueba otra vez.');
    }
    return;
  }
}

// Sesión 50 — Nauzet vende casas
async function houseAgent(d) {
  let st;
  try { st = await api.houseGet(); } catch { await d.npc('Uy, se me colgó el ordenador. Vuelve en un ratito.'); return; }
  const cur = st?.tier ? HOUSE_TIERS[st.tier] : null;
  await d.npc(cur ? `Ya tienes tu ${cur.name}. ¿Quieres algo más grande? Te descuento lo que ya pagaste, que yo soy legal.`
                  : 'Tres opciones, mi niño. Todas con vistas… a algo.');
  if (d.closed) return;
  const opts = [];
  for (const id of HOUSE_TIER_LIST) {
    const T = HOUSE_TIERS[id];
    const cost = upgradeCost(st?.tier || null, id);
    if (cost == null) continue;
    opts.push({ id, label: `${T.name} — ${cost.toLocaleString('es-ES')} monedas` });
  }
  if (!opts.length) { await d.npc('Ya tienes la mejor casa de la isla. Ni el presidente del Cabildo vive así.'); return; }
  const labels = [...opts.map(o => o.label), '📋 ¿Qué tiene cada casa?', 'Ahora no'];
  while (!d.closed) {
    const k = await d.choose(labels, 'Inmobiliaria Achinech');
    if (k < 0 || d.closed || k === labels.length - 1) return;
    if (k === labels.length - 2) {
      for (const id of HOUSE_TIER_LIST) { await d.npc(`${HOUSE_TIERS[id].name}: ${HOUSE_TIERS[id].blurb}`); if (d.closed) return; }
      continue;
    }
    const o = opts[k];
    await d.player(`Me quedo la ${HOUSE_TIERS[o.id].name}.`);
    try {
      await api.houseBuy(o.id);
      try { audio.synth?.('craft_done', { volume: 0.7 }); } catch {}
      feedLog('info', `🏠 ¡Ya tienes tu ${HOUSE_TIERS[o.id].name}! Entra desde cualquier urbanización (🏠 en el mapa).`);
      await d.npc('¡Firmado! Aquí tienes la llave. Entras por la puerta verde de cualquier urbanización de la isla. La de aquí está al lado.');
      try { window.__houses?.refresh?.(); } catch {}
    } catch (err) {
      await d.npc(err?.code === 'not_enough_coins' ? 'Mmm… con eso no te llega ni pa\' la fianza. Vuelve cuando tengas las perras.'
        : err?.code === 'too_far' ? 'Arrímate, que no te oigo.'
        : 'Algo ha fallado con el papeleo. Inténtalo otra vez.');
    }
    return;
  }
}

// Sesión 50 — La ASO: pa' comprar hay que ser socio
async function asoDoor(d) {
  let st;
  try { st = await api.asoStatus(); } catch { await d.npc('Espérate un momentito, muyayo, que se me cayó el sistema.'); return false; }
  if (st?.socio) return true;
  await d.npc('Ey, ey, ey, muyayo. ¿Tú dónde vas tan ligero?');
  if (d.closed) return false;
  await d.npc('Esto es La ASO, mi niño. Pa\' entrar aquí tienes que ser local y venir con uno que ya sea socio.');
  if (d.closed) return false;
  await d.npc('Si no… me das 5 pavos y puedes comprar. Así de fácil.');
  while (!d.closed) {
    const k = await d.choose(['🤝 Vengo con un socio', '💶 Toma, 5 pavos', '❓ ¿Pavos? ¿Qué es eso?', '🚶 Paso, gracias'], 'La ASO · solo socios');
    if (k < 0 || d.closed) return false;
    if (k === 2) {
      await d.npc('¿Pavos? ¡Pavos, muyayo, PAVOS! Chacho, se nota que tú eres godo…');
      if (d.closed) return false;
      await d.npc('Mira, pa\' que me entiendas: cinco pavos son quinientas monedas. ¿Estamos?');
      continue;
    }
    if (k === 3) { await d.npc('Tú verás, mi niño. Aquí te espero.'); return false; }
    const via = k === 0 ? 'socio' : 'pavos';
    await d.player(k === 0 ? 'Vengo con un socio.' : 'Toma, 5 pavos.');
    try {
      await api.asoJoin(via);
      try { audio.synth?.('craft_done', { volume: 0.6 }); } catch {}
      feedLog('info', via === 'socio' ? '🌿 Ya eres socio de La ASO (te avaló un socio).' : '🌿 Ya eres socio de La ASO (−5 pavos).');
      await d.npc(via === 'socio' ? '¡Ah, que vienes con este! Haberlo dicho, muyayo. Pasa, pasa, que ya eres de la casa.' : '¡Eso es! Ya eres socio, mi niño. Bienvenido a La ASO.');
      return !d.closed;
    } catch (err) {
      const c = err?.code;
      await d.npc(c === 'no_sponsor' ? '¿Con un socio? Yo aquí no veo a nadie, muyayo. Tráetelo pa\'cá, que lo vea yo.'
        : c === 'not_enough_coins' ? '¿Y los pavos, mi niño? Tú no tienes ni pa\' un barraquito.'
        : c === 'too_far' ? 'Arrímate, que no te escucho.'
        : 'Ahora no puedo, vuelve luego.');
    }
  }
  return false;
}

async function offerQuest(d, n, q) {
  for (const line of q.offer || []) { await d.npc(line); if (d.closed) return; }
  const pick = await d.choose([q.accept || 'Acepto.', 'Ahora no, gracias.'], q.name);
  if (pick !== 0) { if (pick === 1) await d.npc('Si cambias de idea, aquí estaré.'); return; }
  await d.player(q.accept || 'Acepto.');
  try {
    const r = await api.questsStart(q.id);
    quests.applyServerRows(r?.quests);
    quests.track(q.id);
    try { audio.synth?.('craft_done', { volume: 0.6 }); } catch {}
    feedLog('info', `📜 Nueva misión: ${q.name}. ${q.steps[0]?.text || ''}`);
    await d.npc(q.steps[0]?.text ? `Perfecto. ${q.steps[0].text}` : '¡Perfecto!');
  } catch (err) {
    await d.npc(err?.code === 'too_far' ? 'Acércate, que no te oigo bien.' : 'Mmm… ahora mismo no puedo. Vuelve luego.');
  }
}

async function aboutQuest(d, t) {
  if (t.deliver && !t.ok) {
    const miss = t.step.items.map(([i, k]) => `${Math.max(0, k - invCount(i))} ${itemName(i)}`).filter(s => !s.startsWith('0 '));
    await d.npc(`${t.q.doing || t.step.text} Todavía te falta: ${miss.join(', ')}.`);
  } else {
    await d.npc(t.q.doing || t.step.text);
  }
}

async function afterProgress(d, q) {
  const s = quests.getQuestState(q.id);
  if (s?.status === 1) {
    await d.npc(q.thanks || '¡Gracias!');
    if (!d.closed && q.reward?.text) await d.npc(`(Recibes: ${q.reward.text})`);
  } else if (s) {
    const step = q.steps[s.step];
    if (step) await d.npc(step.text);
  }
}

// ============================================================
// API pública
// ============================================================
export function registerKeepouts(terrain) {
  for (const n of TOWN_NPCS) { try { terrain.addKeepout?.(n.x, n.z, 2); terrain.clearTreesNear?.(n.x, n.z, 2); } catch {} }
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer;
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  onOpenBank = opts.onOpenBank || (() => {});
  onOpenShop = opts.onOpenShop || (() => {});
  onOpenGE = opts.onOpenGE || (() => {});
  started = true;
  syncTimer = 99;
  if (typeof window !== 'undefined') window.__townNpcs = () => [...objs.values()].map(o => ({ id: o.n.id, mark: o.mark }));
}

export function stop() {
  for (const o of Array.from(objs.values())) dispose(o);
  pending = null;
  dialogue.close();
  started = false;
}

function underRay(raycaster) {
  if (!started || !pickMeshes.length) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  return objs.get(hits[0].object.userData?.npcId) || null;
}

function goTalk(o) {
  const p = getPlayer?.();
  if (!p) return;
  const dx = p.position.x - o.n.x, dz = p.position.z - o.n.z;
  const d = Math.hypot(dx, dz);
  if (d > TALK_DIST_M) {
    setPlayerTargetCb(o.n.x + (dx / (d || 1)) * APPROACH, o.n.z + (dz / (d || 1)) * APPROACH);
    pending = o;
  } else {
    talkTo(o);
  }
}

export function tryHandleTap(raycaster) {
  const o = underRay(raycaster);
  if (!o) return false;
  goTalk(o);
  return true;
}

export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const o = underRay(raycaster);
  if (!o) return false;
  openMenu(`${o.n.name} — ${o.n.title || ''}`, [
    { label: '💬 Hablar', onPick: () => goTalk(o) },
    { label: '🔍 Examinar', onPick: () => feedLog('info', `${o.n.name}, ${(o.n.title || 'habitante').toLowerCase()}.${o.mark === 'offer' ? ' Parece que tiene trabajo para ti.' : ''}`) },
  ], cx, cy);
  return true;
}

export function cancel() { pending = null; }

/** Para el minimapa: [{ x, z, mark }] */
export function getMinimapMarks() {
  return TOWN_NPCS.map(n => ({ x: n.x, z: n.z, mark: objs.get(n.id)?.mark || markFor(n.id) }));
}
function markFor(id) {
  const info = npcQuestInfo(id);
  return info.turnIn.length ? 'turnin' : info.offer.length ? 'offer' : info.doing.length ? 'doing' : null;
}

export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  const p = getPlayer?.();

  syncTimer += dt;
  if (p && syncTimer >= 1) {
    syncTimer = 0;
    for (const n of TOWN_NPCS) {
      const near = Math.hypot(n.x - p.position.x, n.z - p.position.z) < VIEW_DIST;
      const o = objs.get(n.id);
      if (near && !o) build(n);
      else if (!near && o) dispose(o);
    }
  }
  markTimer += dt;
  if (markTimer >= 0.6) { markTimer = 0; for (const o of objs.values()) updateMark(o); }

  for (const o of objs.values()) {
    const t = timeAcc + o.phase;
    // Respirar + brazos sueltos
    o.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
    o.arms[0].rotation.x = Math.sin(t * 1.3) * 0.05;
    o.arms[1].rotation.x = -Math.sin(t * 1.3) * 0.05;
    // Gesto al hablar (levanta el brazo derecho)
    if (o.gestureT > 0) {
      o.gestureT -= dt;
      o.arms[1].rotation.x = -1.1 + Math.sin(t * 9) * 0.25;
      o.arms[1].rotation.z = 0.25;
    } else {
      o.arms[1].rotation.z = 0;
    }
    // Mirar al jugador si está cerca (cabeza; y el cuerpo si estáis hablando)
    let targetYaw = 0, bodyYaw = o.baseYaw;
    if (p) {
      const dx = p.position.x - o.n.x, dz = p.position.z - o.n.z;
      const dist = Math.hypot(dx, dz);
      if (dist < LOOK_DIST) {
        const want = Math.atan2(dx, dz);
        if (talking === o) bodyYaw = want;
        let rel = want - (talking === o ? want : o.baseYaw);
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        targetYaw = Math.max(-1.1, Math.min(1.1, rel));
      }
      o.name.visible = dist < 22;
    }
    o.head.rotation.y += (targetYaw - o.head.rotation.y) * Math.min(1, dt * 5);
    let dy = bodyYaw - o.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    o.root.rotation.y += dy * Math.min(1, dt * 4);
    // Marcas que flotan
    const bob = Math.sin(timeAcc * 3 + o.phase) * 0.08;
    for (const m of [o.bang, o.qGold, o.qGray]) m.position.y = 2.65 + bob;
  }

  // Llegar al NPC → hablar
  if (p && pending && Math.hypot(p.position.x - pending.n.x, p.position.z - pending.n.z) <= TALK_DIST_M) {
    const o = pending; pending = null; talkTo(o);
  }
  // Te alejas → se cierra el diálogo
  if (p && talking && dialogue.isOpen() && Math.hypot(p.position.x - talking.n.x, p.position.z - talking.n.z) > TALK_DIST_M + 5) {
    dialogue.close();
    talking = null;
  }
}
