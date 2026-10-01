/**
 * SebasPresent — Cuevas (Sesión 50) · MÓDULO COMPARTIDO cliente + servidor
 *
 * Como en OSRS: la boca de la cueva está en una montaña del mapa; al entrar,
 * el server te teletransporta a la cueva, que es otra zona del mundo FUERA del
 * mapa de la isla (x > 2048, donde no hay terreno). Ahí dentro todo funciona
 * igual: posición real, enemigos (npc_instances), vetas de mineral, combate.
 *
 * Forma de cada cueva: salas (círculos) unidas por túneles (segmentos con
 * anchura). Coordenadas RELATIVAS a `base`. Lo andable es la unión de todo.
 */
export const CAVE_ZONE = { x0: 2300, x1: 4200, z0: -400, z1: 400 };
export const CAVE_ENTER_DIST_M = 12;   // server: distancia a la boca para poder entrar

export const CAVES = {
  viento: {
    id: 'viento', name: 'Cueva del Viento', theme: 'lava_tube',
    blurb: 'El tubo volcánico más largo de Europa. Dicen que el viento que sale de dentro habla.',
    mouth: { x: -742, z: -298, rot: 0.6 },          // en la montaña junto a Icod
    base: { x: 2600, z: 0 },
    rooms: [[0, 0, 9], [0, 50, 14], [38, 85, 16], [-45, 75, 11]],
    tunnels: [[0, 0, 0, 50, 5], [0, 50, 38, 85, 4.5], [0, 50, -45, 75, 4]],
    npcs: [['spider', 0, 52, 3], ['spider', 38, 85, 3], ['zombi', -45, 75, 3], ['zombi', 40, 90, 2]],
    veins: [['hierro', -6, 58], ['hierro', 6, 46], ['acero', 46, 92], ['acero', 30, 94], ['oro', 44, 78], ['oro', -50, 80]],
    light: 0xff7a30,
  },
  hielo: {
    id: 'hielo', name: 'Cueva del Hielo', theme: 'ice',
    blurb: 'En lo alto de Las Cañadas, donde los antiguos guardaban hielo para el verano. Ahora lo guardan los yetis.',
    mouth: { x: 268, z: -1590, rot: -0.4 },
    base: { x: 3000, z: 0 },
    rooms: [[0, 0, 9], [28, 40, 18], [-2, 86, 15]],
    tunnels: [[0, 0, 28, 40, 5], [28, 40, 0, 80, 5]],
    npcs: [['yeti', 28, 42, 3], ['yeti', -2, 88, 2]],
    veins: [['obsidiana', 38, 30], ['obsidiana', 18, 50], ['basaltita', -8, 94], ['basaltita', 6, 96], ['obsidiana', 2, 78]],
    light: 0x7fd4ff,
  },
  echeyde: {
    id: 'echeyde', name: 'Cueva de Echeyde', theme: 'fire', wild: true,
    blurb: 'Echeyde, el infierno de los guanches. Bajo el Malpaís arde algo que no es de este mundo.',
    mouth: { x: -1452, z: -1088, rot: 1.2 },        // wilderness
    base: { x: 3400, z: 0 },
    rooms: [[0, 0, 9], [-22, 46, 15], [18, 92, 20]],
    tunnels: [[0, 0, -22, 46, 5], [-22, 46, 15, 85, 5]],
    npcs: [['zombi_igneo', -22, 48, 3], ['zombi_igneo', 12, 88, 2], ['bruto_echeyde', 22, 98, 1]],
    veins: [['basaltita', -30, 54], ['basaltita', -14, 38], ['teiderio', 30, 104], ['teiderio', 6, 104], ['basaltita', 28, 84]],
    light: 0xff4a10,
  },
};
export const CAVE_LIST = Object.values(CAVES);

export function inCaveZone(x, z) {
  return x >= CAVE_ZONE.x0 && x <= CAVE_ZONE.x1 && z >= CAVE_ZONE.z0 && z <= CAVE_ZONE.z1;
}

/** La cueva en la que está (x,z), o null. */
export function caveAt(x, z) {
  if (!inCaveZone(x, z)) return null;
  let best = null, bd = Infinity;
  for (const c of CAVE_LIST) {
    const d = Math.abs(x - (c.base.x + 20));
    if (d < bd) { bd = d; best = c; }
  }
  return bd < 200 ? best : null;
}

/** Dónde apareces al entrar (dentro de la primera sala) y dónde sales (delante de la boca). */
export function caveSpawn(c) { return { x: c.base.x, z: c.base.z + 2 }; }
export function caveExitMarker(c) { return { x: c.base.x, z: c.base.z - 6 }; }
export function mouthOutside(c) {
  const m = c.mouth;
  return { x: m.x + Math.sin(m.rot) * 5, z: m.z + Math.cos(m.rot) * 5 };
}

function segDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L2));
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

/** Holgura (m) del punto dentro de lo andable: >0 dentro, <0 fuera. Coordenadas del mundo. */
export function caveClearance(c, x, z) {
  const lx = x - c.base.x, lz = z - c.base.z;
  let best = -Infinity;
  for (const [cx, cz, r] of c.rooms) best = Math.max(best, r - Math.hypot(lx - cx, lz - cz));
  for (const [x1, z1, x2, z2, w] of c.tunnels) best = Math.max(best, w - segDist(lx, lz, x1, z1, x2, z2));
  return best;
}

/** Puntos del mundo para las vetas de las cuevas (los usa shared/ore_veins.js). */
export function caveVeins() {
  const out = [];
  for (const c of CAVE_LIST) for (const [tier, x, z] of c.veins) out.push([tier, c.base.x + x, c.base.z + z]);
  return out;
}
