/**
 * SebasPresent — Arico, el pueblo blanco (Sesión 50)
 *
 * En el desierto del sur. Su alcalde, Don Faustino, dictó una norma: todas
 * las casas blancas, carpintería verde (o azul, junto al mar del este) y
 * zócalo de piedra volcánica negra; tejados planos con su chimenea redonda,
 * jardines de cactus y palmeras. Arte y paisaje juntos, como en Lanzarote.
 * Posiciones deterministas: fuera de los caminos y sin pisarse.
 */
import { roadDist } from './roads.js';
import { BANK_CHESTS } from './banks.js';

export const PUEBLO_BLANCO = { name: 'Arico', x: 1100, z: 600, r: 70 };
export const ALCALDE_NPC = 'alcalde_faustino';

function rnd(i, k) { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); }

let _houses = null;
/** [{ x, z, dir, w, d, twoFloors, trim }] */
export function puebloHouses() {
  if (_houses) return _houses;
  const P = PUEBLO_BLANCO, out = [];
  for (let i = 0; i < 120 && out.length < 16; i++) {
    const ang = rnd(i, 1) * Math.PI * 2, rad = 20 + rnd(i, 2) * 42;
    const x = P.x + Math.cos(ang) * rad, z = P.z + Math.sin(ang) * rad;
    const w = 6 + Math.round(rnd(i, 3) * 3), d = 5.5 + Math.round(rnd(i, 4) * 2);
    const R = Math.hypot(w, d) / 2 + 1;
    if (roadDist(x, z) < R + 4) continue;
    if (BANK_CHESTS.some(b => Math.hypot(b.x - x, b.z - z) < R + 4)) continue;
    if (Math.hypot(1088 - x, 612 - z) < R + 4) continue;   // el alcalde
    if (out.some(h => Math.hypot(h.x - x, h.z - z) < R + Math.hypot(h.w, h.d) / 2 + 3)) continue;
    // la fachada mira al centro del pueblo
    const dir = Math.atan2(P.x - x, P.z - z);
    out.push({ x, z, dir, w, d, twoFloors: rnd(i, 5) < 0.3, trim: rnd(i, 6) < 0.3 ? 'blue' : 'green' });
  }
  _houses = out;
  return out;
}
