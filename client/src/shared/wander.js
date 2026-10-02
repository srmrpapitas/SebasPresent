/**
 * SebasPresent — Deambular de NPC pasivos SIN escribir en la base de datos
 * (Sesión 51, optimización).
 *
 * Antes cada snapshot movía un pasito a cada pollo/vaca cercano y lo escribía
 * en D1 (miles de escrituras por minuto). Ahora la posición es una FUNCIÓN DEL
 * TIEMPO: mismo id + misma hora → mismo sitio, en el servidor y en el cliente.
 * El servidor la usa para el snapshot y para el rango de ataque; el cliente la
 * calcula cada frame (movimiento suave sin depender de la red).
 */
export const WANDER_SPEED_MPS = 0.8;
export const WANDER_RADIUS_M = 5.0;
export const WANDER_BUCKET_MS = 10000;

function rnd(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function point(id, hx, hz, b) {
  const s = Math.imul(id | 0, 73856093) ^ (b | 0);
  const a = rnd(s) * Math.PI * 2, r = Math.sqrt(rnd(s + 1)) * WANDER_RADIUS_M;
  return [hx + Math.cos(a) * r, hz + Math.sin(a) * r];
}

/** Posición del NPC pasivo `id` (casa hx,hz) en el instante `now` (ms). */
export function wanderPos(id, hx, hz, now) {
  const B = WANDER_BUCKET_MS;
  const b = Math.floor(now / B);
  const [ax, az] = point(id, hx, hz, b - 1);
  const [bx, bz] = point(id, hx, hz, b);
  const d = Math.hypot(bx - ax, bz - az);
  const moveMs = Math.min(B * 0.85, (d / WANDER_SPEED_MPS) * 1000);
  const delay = rnd(Math.imul(id | 0, 19349663) ^ (b | 0)) * Math.max(0, B - moveMs);   // no arrancan todos a la vez
  const t = moveMs > 0 ? Math.min(1, Math.max(0, (now - b * B - delay) / moveMs)) : 1;
  const e = t * t * (3 - 2 * t);
  return { x: ax + (bx - ax) * e, z: az + (bz - az) * e };
}

/** ¿Este NPC deambula? (pasivo, vivo y sin combate) */
export function isWanderer(behavior, inCombatWith) {
  return !inCombatWith && !['aggressive', 'boss', 'minigame'].includes(behavior || '');
}
