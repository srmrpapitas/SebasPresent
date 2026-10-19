// Sesión 53 (19 oct) — Monstruos a lo largo de los caminos.
// El mapa es enorme y los monstruos vivían solo en las zonas de caza: andando
// de un pueblo a otro no te cruzabas con nada. Esto pone grupitos de 2–3 cada
// ~180 m a los lados de cada camino, con nivel según lo lejos que estén de
// La Laguna (y del terreno: nieve en Las Cañadas, desierto en Güímar).
//
// uso (desde la raíz):  node scripts/gen_caminos53.mjs  → server/seeds/030_caminos_vivos_s53.sql
// Determinista y re-ejecutable: borra primero exactamente los mismos puntos.
import fs from 'node:fs';
import { getRoads, ROAD_NODES } from '../client/src/shared/roads.js';
import { HUNTING_ZONES } from '../client/src/shared/hunting_zones.js';
import { PONDS } from '../client/src/shared/fishing.js';
import { CASONAS } from '../client/src/shared/casonas.js';
import { BOSSES } from '../client/src/shared/bosses.js';
import { FOSA } from '../client/src/shared/fosa.js';
import { TOWN_BUILDINGS } from '../client/src/shared/town_buildings.js';
import { HOUSE_PORTALS } from '../client/src/shared/houses.js';

let seed = 190053;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Qué sale según la distancia a La Laguna y el terreno
function mobsFor(x, z) {
  const d = Math.hypot(x, z);
  const snow = z < -1350;                                  // Las Cañadas / Guajara
  const desert = x > 1150 && z > -450 && z < 350;          // Malpaís de Güímar
  const wild = x < -1024;                                  // zona salvaje (PvP)
  if (snow) return [['yeti', 2], ['golem', 2], ['zombi_igneo', 1]];
  if (desert) return [['scorpion', 3], ['bandido', 2]];
  if (wild) return [['bandido', 2], ['skeleton', 2], ['zombi', 1]];
  if (d < 380) return [['rat', 3], ['goblin', 3], ['cabra', 1]];
  if (d < 750) return [['goblin', 2], ['spider', 2], ['boar', 2], ['cabra', 1]];
  if (d < 1150) return [['wolf', 3], ['boar', 1], ['spider', 1]];
  if (d < 1500) return [['wolf', 2], ['tibicena', 2], ['bandido', 1], ['scorpion', 1]];
  return [['bandido', 2], ['zombi', 2], ['tibicena', 1], ['ogro_anaga', 1]];
}
function weighted(list) {
  const tot = list.reduce((n, [, w]) => n + w, 0); let r = rnd() * tot;
  for (const [id, w] of list) { if ((r -= w) <= 0) return id; }
  return list[0][0];
}

// Sitios donde NO poner monstruos
const blocked = [];
for (const n of Object.values(ROAD_NODES)) blocked.push([n.x, n.z, 140]);     // pueblos
for (const z of HUNTING_ZONES) blocked.push([z.x, z.z, z.r + 25]);           // ya hay zona de caza
for (const p of PONDS) blocked.push([p.x, p.z, p.r + 8]);
for (const c of CASONAS) blocked.push([c.x, c.z, 40]);
for (const h of HOUSE_PORTALS) blocked.push([h.x, h.z, 35]);
for (const b of TOWN_BUILDINGS) blocked.push([b.x, b.z, Math.max(b.w, b.d) / 2 + 20]);
for (const b of Object.values(BOSSES)) blocked.push([b.x, b.z, (b.lairR || 12) + 40]);
blocked.push([FOSA.x, FOSA.z, FOSA.r + 40]);
const isBlocked = (x, z) => blocked.some(([bx, bz, r]) => Math.hypot(x - bx, z - bz) < r);
const ISLAND = 2050;   // fuera de esto suele ser mar

const rows = [];
const taken = [];
let side = 1;
for (const road of getRoads()) {
  const pts = road.pts;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    acc += seg;
    if (acc < 140) continue;
    acc = 0;
    // perpendicular al camino, alternando lado
    const nx = -(z1 - z0) / seg, nz = (x1 - x0) / seg;
    side = -side;
    const off = 18 + rnd() * 20;
    const cx = x1 + nx * off * side, cz = z1 + nz * off * side;
    if (Math.abs(cx) > ISLAND || Math.abs(cz) > ISLAND) continue;
    if (isBlocked(cx, cz)) continue;
    if (taken.some(([tx, tz]) => Math.hypot(cx - tx, cz - tz) < 90)) continue;   // caminos que se cruzan
    taken.push([cx, cz]);
    const def = weighted(mobsFor(cx, cz));
    const n = def === 'ogro_anaga' || def === 'yeti' ? 2 : 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, r = 1.5 + rnd() * 5;
      const x = Math.round((cx + Math.cos(a) * r) * 10) / 10, z = Math.round((cz + Math.sin(a) * r) * 10) / 10;
      rows.push([def, x, z]);
    }
  }
}

const vals = rows.map(([d, x, z]) => `('${d}',-1,${x},${z},0,${x},${z})`).join(',\n');
const keys = rows.map(([, x, z]) => `(${x},${z})`).join(',');
let out = `-- Sesión 53 (19 oct) — Monstruos a lo largo de los caminos (generado por scripts/gen_caminos53.mjs).\n`;
out += `-- ${rows.length} monstruos en ${taken.length} grupos. Re-ejecutable: borra antes los mismos puntos.\n`;
out += `DELETE FROM npc_instances WHERE owner_user_id IS NULL AND (spawn_x, spawn_z) IN (VALUES ${keys});\n`;
out += `INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z) VALUES\n${vals};\n`;
out += `UPDATE npc_instances SET hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id) WHERE hp_current = -1 AND def_id IN (SELECT id FROM npc_defs);\n`;
fs.writeFileSync(new URL('../server/seeds/030_caminos_vivos_s53.sql', import.meta.url), out);
const count = {}; for (const [d] of rows) count[d] = (count[d] || 0) + 1;
console.log('monstruos', rows.length, 'grupos', taken.length, count);
