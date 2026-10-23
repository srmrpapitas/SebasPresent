/**
 * SebasPresent — Aventureros (23 oct, punto 9 de PENDIENTE)
 *
 * «Jugadores» simulados que dan vida a la isla: andan entre pueblos, talan,
 * pescan, pelean un rato en las zonas de caza, van al banco, hablan con los
 * vecinos y de vez en cuando dicen algo (solo el bocadillo, no el chat).
 *
 * Reglas (las del pedido del usuario):
 *   - TODO en el cliente: cero peticiones, cero escrituras, cero coste de servidor.
 *   - Deterministas por hora: el horario de cada aventurero sale de un hash de
 *     (hora UTC, hueco). Dos jugadores en el mismo sitio ven lo mismo (la hora
 *     se toma del servidor vía el snapshot, así que los relojes no importan).
 *   - No bloquean ni roban nada: no chocan, no tocan monstruos ni botín, nadie
 *     puede atacarles ni comerciar con ellos (el menú solo deja Seguir/Examinar).
 *   - Nunca en el Malpaís (zona PvP).
 *
 * Se pintan con el mismo código que los jugadores de verdad (multiplayer.js:
 * upsertBot / removeBot, ids negativos) y solo los más cercanos al jugador.
 */
import { ROAD_NODES, roadsFrom } from './shared/roads.js';
import { TOWN_NPCS } from './shared/town_npcs.js';
import { BANK_CHESTS } from './shared/banks.js';
import { PONDS } from './shared/fishing.js';
import { HUNTING_ZONES } from './shared/hunting_zones.js';
import { WILDERNESS_X } from './terrain.js';
import * as multiplayer from './multiplayer.js';
import * as worldSnapshot from './world_snapshot.js';

const HOUR_MS = 3600_000;
const SLOTS = 40;                 // aventureros por hora en toda la isla
const SHOW_R = 110;               // m: solo se pintan los que estén cerca
const MAX_SHOWN = 7;              // como mucho a la vez (rendimiento en móvil)
const RUN_MPS = 7;                // m/s: lo mismo que un jugador sin «correr» (así se le puede seguir)
const ID_BASE = -1000;            // ids negativos: nunca chocan con un user_id real

// Nombres de usuario inventados (canarios genéricos; ninguno es de un vecino del juego)
const NAMES = [
  'Acaymo_tf', 'Dacil92', 'Cathaysa_lpgc', 'IdairaGG', 'ithaisa07', 'Zebensui_tnf', 'Himar_LL', 'Acerina',
  'Gazmira_x', 'Arminda22', 'Atteneri', 'JuanmaTNF', 'PepeElCanario', 'Carmela_88', 'ToñoGuagua', 'SergioDeTaco',
  'Kevin_Moya', 'LauraLaLagunera', 'Barraquito99', 'GofioWarrior', 'MojoPicon', 'Lagartija_tf', 'Tamadaba',
  'ChachoQuePasa', 'PapasArrugadas', 'Guanchito07', 'MariCarmen_tf', 'Taburiente', 'Alisios', 'Tajinaste',
  'Fran_Candelaria', 'NataliaSurf', 'CumbreVieja', 'Bubango', 'Escaldon', 'Rapadura', 'Sancocho_gc', 'ElTimple',
  'Chiringo', 'Cardon_77',
];

const SAY = {
  general: ['buenas!', 'jajaja', 'qué pasó, mi niño', 'alguien de La Laguna?', 'me voy a cenar, ahora vengo',
    'ayer subí 3 niveles', 'alguien para ir al Teide?', 'quién vende tiburones?', 'bueno, me piro al banco',
    'chacho qué calor', 'ñoos', 'alguien sabe dónde está el herrero?', 'hola!!', 'buah, qué bonito el atardecer'],
  chop: ['estos robles no se acaban nunca', 'alguien compra troncos?', 'ya casi tengo 30 de tala', 'un tronco más y al banco'],
  fish: ['no pican ni a la de tres', 'otra sardina…', 'me falta poco para el arpón', 'hoy pican bien'],
  fight: ['uff casi me matan', 'este bicho pega fuerte', 'una más y me voy', 'qué mala suerte con el botín'],
  move: ['voy pa\'llá', 'qué lejos está todo', 'alguien me presta una montura? jaja'],
};

// Equipo por nivel y estilo (mismos objetos que llevan los jugadores)
const MELEE_TIERS = [[1, 'bronze', 'chest_bronze'], [15, 'hierro'], [25, 'acero'], [35, 'oro'], [45, 'obsidiana'], [55, 'basaltita'], [65, 'teiderio']];
const RANGE_TIERS = [[1, 'cuero', 'bow_normal'], [20, 'lobo', 'bow_willow'], [35, 'escorpion', 'bow_maple'], [50, 'yeti', 'bow_yew'], [70, 'escama', 'bow_magic']];
const MAGE_TIERS = [[1, 'algodon'], [25, 'lino'], [45, 'seda'], [60, 'cabildo']];
const CAPES = ['cape_cotton', 'cape_linen', 'cape_silk', 'cape_polyester', 'cape_lava', 'cape_ice', 'cape_earth'];

// ------------------------------------------------------------ azar determinista
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const pickW = (r, list) => { const tot = list.reduce((s, x) => s + x[1], 0); let v = r() * tot; for (const [it, w] of list) { if ((v -= w) <= 0) return it; } return list[list.length - 1][0]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ------------------------------------------------------------ sitios
const TOWNS = Object.entries(ROAD_NODES)
  .filter(([, n]) => n.x > WILDERNESS_X + 60)
  .map(([id, n]) => ({ id, x: n.x, z: n.z, w: id === 'laguna' ? 8 : ['orotava', 'santacruz', 'cristianos', 'adeje', 'guimar', 'icod', 'vilaflor'].includes(id) ? 2 : 1 }));
const TOWN_IDS = new Set(TOWNS.map(t => t.id));
const OUT_NPCS = TOWN_NPCS.filter(n => Number.isFinite(n.x) && Number.isFinite(n.z) && !n.door && !n.wander && n.x > WILDERNESS_X);
const SAFE_ZONES = HUNTING_ZONES.filter(z => z.x - z.r > WILDERNESS_X);

function near(list, x, z, r) { return list.filter(o => Math.hypot(o.x - x, o.z - z) <= r); }

// ------------------------------------------------------------ aspecto
function looksFor(name) {
  const r = mulberry(hashStr(name));
  const lvl = 3 + Math.floor(Math.pow(r(), 1.3) * 88);
  const style = pickW(r, [['melee', 5], ['range', 3], ['mage', 2]]);
  const main = pickW(r, [['chop', 3], ['fish', 3], ['fight', 4], ['social', 2]]);
  const tierOf = (tiers) => { let t = tiers[0]; for (const x of tiers) if (lvl >= x[0]) t = x; return t; };
  const eq = [];
  let weapon = null, wtype = null;
  if (style === 'melee') {
    const [, m, body] = tierOf(MELEE_TIERS);
    eq.push(`helm:helm_${m}`, `body:${body || 'body_' + m}`, `legs:legs_${m}`, `boots:boots_${m}`);
    if (r() < 0.6) eq.push(`shield:shield_${m}`);
    const two = r() < 0.35;
    weapon = two ? `sword_${m}_2h` : `sword_${m}`; wtype = two ? '2h_sword' : '1h_sword';
  } else if (style === 'range') {
    const [, m, bow] = tierOf(RANGE_TIERS);
    eq.push(`helm:helm_${m}`, `body:body_${m}`, `legs:legs_${m}`, `boots:boots_${m}`);
    weapon = bow; wtype = 'bow';
  } else {
    const [, m] = tierOf(MAGE_TIERS);
    eq.push(`helm:helm_${m}`, `body:body_${m}`, `legs:legs_${m}`, `boots:boots_${m}`);
    weapon = 'staff_normal'; wtype = 'staff';
  }
  if (r() < 0.45) eq.push(`cape:${pick(r, CAPES)}`);
  if (r() < 0.25) eq.splice(0, 1);   // algunos sin casco
  return { lvl, style, main, equip: eq.join(','), weapon, wtype, hp: 10 + Math.floor(lvl * 0.9) };
}

// ------------------------------------------------------------ horario de una hora
// Segmentos: { t0, t1, move: [[x,z],…] + cum }  ó  { t0, t1, act, x, z, yaw, … }
function buildPlan(H, slot) {
  const r = mulberry(hashStr(`adv:${H}:${slot}`));
  // nombres sin repetir dentro de la hora: barajado por hora
  const order = NAMES.map((n, i) => [n, mulberry(hashStr(`n:${H}:${i}`))()]).sort((a, b) => a[1] - b[1]);
  const name = order[slot % order.length][0];
  const look = looksFor(name);
  const segs = [];
  const T_END = HOUR_MS / 1000;
  let t = 0;
  let home = pickW(r, TOWNS.map(tw => [tw, tw.w]));
  let pos = [home.x + (r() - 0.5) * 16, home.z + (r() - 0.5) * 16];
  const traveler = r() < 0.3;

  const moveTo = (pts) => {
    const path = [pos, ...pts];
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
    const L = cum[cum.length - 1];
    if (L < 0.5) return;
    const dur = L / RUN_MPS;
    segs.push({ t0: t, t1: t + dur, move: path, cum, L });
    t += dur; pos = path[path.length - 1];
  };
  const stay = (act, x, z, dur, extra = {}) => {
    const p = [x, z];
    // por el centro del pueblo si el sitio está en el pueblo (las plazas están despejadas)
    if (dist(pos, p) > 25 && Math.hypot(home.x - x, home.z - z) < 70 && dist(pos, [home.x, home.z]) < 70) moveTo([[home.x, home.z], p]);
    else moveTo([p]);
    segs.push({ t0: t, t1: t + dur, act, x, z, ...extra });
    t += dur;
  };

  const localActivity = () => {
    const kind = pickW(r, [
      ['chop', look.main === 'chop' ? 5 : 1], ['fish', look.main === 'fish' ? 5 : 1],
      ['fight', look.main === 'fight' ? 5 : 1], ['talk', look.main === 'social' ? 4 : 1.5],
      ['bank', 1.5], ['idle', 1],
    ]);
    if (kind === 'talk') {
      const ns = near(OUT_NPCS, home.x, home.z, 120);
      if (ns.length) {
        const n = pick(r, ns), a = r() * Math.PI * 2;
        return stay('talk', n.x + Math.sin(a) * 2, n.z + Math.cos(a) * 2, 12 + r() * 30, { fx: n.x, fz: n.z });
      }
    }
    if (kind === 'bank') {
      const bs = near(BANK_CHESTS, home.x, home.z, 250);
      if (bs.length) {
        const b = pick(r, bs), a = r() * Math.PI * 2;
        return stay('bank', b.x + Math.sin(a) * 1.8, b.z + Math.cos(a) * 1.8, 6 + r() * 14, { fx: b.x, fz: b.z });
      }
    }
    if (kind === 'fish') {
      const ps = near(PONDS.filter(p => !p.frozen || look.lvl > 35), home.x, home.z, 500);
      if (ps.length) {
        const p = pick(r, ps), a = r() * Math.PI * 2;
        return stay('fish', p.x + Math.sin(a) * (p.r + 1.4), p.z + Math.cos(a) * (p.r + 1.4), 60 + r() * 200, { fx: p.x, fz: p.z });
      }
    }
    if (kind === 'fight') {
      const zs = near(SAFE_ZONES, home.x, home.z, 550);
      if (zs.length) {
        const zn = pick(r, zs), a = r() * Math.PI * 2, d = Math.sqrt(r()) * zn.r * 0.7;
        return stay('fight', zn.x + Math.sin(a) * d, zn.z + Math.cos(a) * d, 60 + r() * 180, { zr: Math.min(14, zn.r * 0.5) });
      }
    }
    if (kind === 'chop') {
      const a = r() * Math.PI * 2, d = 55 + r() * 70;
      return stay('chop', home.x + Math.sin(a) * d, home.z + Math.cos(a) * d, 60 + r() * 200);
    }
    const a = r() * Math.PI * 2, d = 4 + r() * 10;
    return stay('idle', home.x + Math.sin(a) * d, home.z + Math.cos(a) * d, 15 + r() * 45, { fx: home.x, fz: home.z });
  };

  let guard = 0;
  while (t < T_END && guard++ < 200) {
    if (traveler && r() < 0.35) {
      const outs = roadsFrom(home.id).filter(rd => TOWN_IDS.has(rd.to));
      if (outs.length) {
        const rd = pick(r, outs);
        const to = TOWNS.find(tw => tw.id === rd.to);
        moveTo([[home.x, home.z], ...rd.pts.map(p => [p[0], p[1]]), [to.x + (r() - 0.5) * 10, to.z + (r() - 0.5) * 10]]);
        home = to;
        continue;
      }
    }
    localActivity();
  }

  // Frases: ~1 cada 5–8 min, en momentos fijos de la hora
  const says = [];
  for (let k = 0; k < 10; k++) {
    if (r() < 0.55) says.push({ t: k * 360 + r() * 300, i: Math.floor(r() * 1000) });
  }
  return { H, slot, id: ID_BASE - slot, name, look, segs, says };
}

// Posición del aventurero en el segundo `s` de su hora
function stateAt(plan, s) {
  const segs = plan.segs;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].t0 <= s) lo = m; else hi = m - 1; }
  const g = segs[lo];
  if (!g) return null;
  if (g.move) {
    const d = Math.min(g.L, Math.max(0, (s - g.t0) * RUN_MPS));
    let i = 1; while (i < g.cum.length - 1 && g.cum[i] < d) i++;
    const a = g.move[i - 1], b = g.move[i], k = (d - g.cum[i - 1]) / Math.max(1e-6, g.cum[i] - g.cum[i - 1]);
    return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), moving: true, seg: g };
  }
  return { x: g.x, z: g.z, yaw: g.fx != null ? Math.atan2(g.fx - g.x, g.fz - g.z) : 0, moving: false, seg: g };
}

// ------------------------------------------------------------ escena
let started = false;
let getPlayer = () => null;
let getTrees = () => [];          // [{x,z}] árboles dibujados cerca
let plans = [], plansHour = -1;
let clockOffset = 0, lastSnapNow = 0;
const shown = new Map();          // id → { vx, vz, vyaw, plan, lastAtk, saidUpTo, chopTree, fightNpc }
let acc = 0;

export function start(opts = {}) {
  getPlayer = opts.getPlayer || getPlayer;
  getTrees = opts.getTrees || getTrees;
  started = true;
  if (typeof window !== 'undefined') {
    window.__adventurers = () => ({ hour: plansHour, shown: [...shown.values()].map(b => ({ id: b.plan.id, name: b.plan.name, x: Math.round(b.vx), z: Math.round(b.vz), act: b.act })) });
  }
}
export function stop() {
  started = false;
  for (const id of shown.keys()) multiplayer.removeBot?.(id);
  shown.clear();
}

function serverNow() {
  const sn = worldSnapshot.getServerNow?.();
  if (sn && sn !== lastSnapNow) { lastSnapNow = sn; clockOffset = sn - Date.now(); }
  return Date.now() + clockOffset;
}

function nearestTree(x, z, maxD) {
  let best = null, bd = maxD;
  for (const t of getTrees(x, z, maxD)) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
  return best;
}
function nearestMonster(x, z, maxD) {
  const snap = worldSnapshot.getSnapshot?.();
  let best = null, bd = maxD;
  for (const n of snap?.npcs || []) {
    if (!n || n.hp_current <= 0 || n.status || n.in_combat_with) continue;   // nunca uno con el que pelea un jugador
    const p = window.__getNpcPosition?.(n.id) || n;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = { id: n.id, x: p.x, z: p.z }; }
  }
  return best;
}

export function update(dt) {
  if (!started) return;
  const pl = getPlayer();
  if (!pl) return;
  const now = serverNow();
  const H = Math.floor(now / HOUR_MS);
  if (H !== plansHour) {
    plansHour = H;
    plans = [];
    for (let s = 0; s < SLOTS; s++) { try { plans.push(buildPlan(H, s)); } catch (e) { console.warn('[adventurers] plan', e); } }
    for (const id of shown.keys()) multiplayer.removeBot?.(id);
    shown.clear();
  }
  const sec = (now - H * HOUR_MS) / 1000;
  const px = pl.position.x, pz = pl.position.z;

  // Quién se ve (cada ~0,5 s)
  acc += dt;
  if (acc > 0.5 || shown.size === 0) {
    acc = 0;
    const cand = [];
    for (const plan of plans) {
      const st = stateAt(plan, sec);
      if (!st) continue;
      const d = Math.hypot(st.x - px, st.z - pz);
      if (d < SHOW_R || (shown.has(plan.id) && d < SHOW_R + 25)) cand.push([d, plan]);
    }
    // los que ya se ven aguantan hasta SHOW_R + 25 m (así no aparecen y desaparecen en el borde)
    cand.sort((a, b) => (a[0] - (shown.has(a[1].id) ? 25 : 0)) - (b[0] - (shown.has(b[1].id) ? 25 : 0)));
    const want = new Set(cand.slice(0, MAX_SHOWN).map(c => c[1].id));
    for (const id of [...shown.keys()]) if (!want.has(id)) { multiplayer.removeBot?.(id); shown.delete(id); }
    for (const [, plan] of cand.slice(0, MAX_SHOWN)) {
      if (!shown.has(plan.id)) shown.set(plan.id, { plan, vx: NaN, vz: NaN, vyaw: 0, lastAtk: 0, saidUpTo: sec, seg: null });
    }
  }

  for (const b of shown.values()) {
    const st = stateAt(b.plan, sec);
    if (!st) continue;
    let tx = st.x, tz = st.z, yaw = st.yaw, state = st.moving ? 'run' : 'idle';
    const g = st.seg;
    let weapon = b.plan.look.weapon, wtype = b.plan.look.wtype;
    if (g !== b.seg) { b.seg = g; b.tree = undefined; b.mob = null; b.mobAt = 0; }
    b.act = g.act || 'move';
    if (!st.moving) {
      if (g.act === 'chop') {
        if (b.tree === undefined) b.tree = nearestTree(g.x, g.z, 30) || null;
        weapon = 'axe_bronze'; wtype = 'axe';
        if (b.tree) {
          const a = Math.atan2(g.x - b.tree.x, g.z - b.tree.z);
          tx = b.tree.x + Math.sin(a) * 1.3; tz = b.tree.z + Math.cos(a) * 1.3;
          yaw = Math.atan2(b.tree.x - tx, b.tree.z - tz);
          state = 'chop';
        }
      } else if (g.act === 'fish') {
        weapon = null; wtype = null; state = 'idle';
      } else if (g.act === 'fight') {
        // cada ~10 s busca el monstruo más cercano; se pone al lado y "pelea" un rato
        if (!b.mob || sec - b.mobAt > 10) { b.mob = nearestMonster(g.x, g.z, g.zr || 12); b.mobAt = sec; }
        if (b.mob) {
          const mp = window.__getNpcPosition?.(b.mob.id) || b.mob;
          const d = Math.hypot(mp.x - g.x, mp.z - g.z) || 1;
          const reach = wtype === 'bow' || wtype === 'staff' ? 6 : 1.6;
          tx = mp.x + (g.x - mp.x) / d * reach; tz = mp.z + (g.z - mp.z) / d * reach;
          yaw = Math.atan2(mp.x - tx, mp.z - tz);
          if (Math.hypot(b.vx - tx, b.vz - tz) < 1.5 && sec - b.lastAtk > 2.4) {
            b.lastAtk = sec;
            multiplayer.botAttack?.(b.plan.id);
          }
        }
      }
    }
    // Movimiento suave hacia el punto calculado (sin teletransportes)
    if (!Number.isFinite(b.vx) || Math.hypot(tx - b.vx, tz - b.vz) > 40) { b.vx = tx; b.vz = tz; }
    else {
      const dx = tx - b.vx, dz = tz - b.vz, d = Math.hypot(dx, dz), step = RUN_MPS * 1.4 * dt;
      if (d > step) { b.vx += dx / d * step; b.vz += dz / d * step; if (!st.moving) { state = 'run'; yaw = Math.atan2(dx, dz); } }
      else { b.vx = tx; b.vz = tz; }
    }
    b.vyaw = yaw;
    multiplayer.upsertBot?.({
      user_id: b.plan.id, username: b.plan.name, x: b.vx, z: b.vz, yaw, state,
      weapon_item_id: weapon, weapon_type: wtype, equip: b.plan.look.equip,
      combat_lvl: b.plan.look.lvl, hp_current: b.plan.look.hp, hp_max: b.plan.look.hp,
    });
    // Bocadillos (solo los que tocan mientras se le ve)
    for (const sy of b.plan.says) {
      if (sy.t > b.saidUpTo && sy.t <= sec && sec - sy.t < 5) {
        const pool = g.act === 'chop' || g.act === 'fish' || g.act === 'fight' ? (sy.i % 2 ? SAY[g.act] : SAY.general) : (st.moving && sy.i % 3 === 0 ? SAY.move : SAY.general);
        try { window.__chatBotSay?.(b.plan.id, pool[sy.i % pool.length]); } catch {}
      }
    }
    b.saidUpTo = sec;
  }
}

// Para pruebas
export const _test = { buildPlan, stateAt, looksFor };
