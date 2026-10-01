/**
 * SebasPresent — Velocidades máximas (Sesión 50). Las usa el Realm para
 * rechazar movimientos imposibles (speed hack). Mismos números que world.js.
 */
import { MOUNTS, MOUNT_RUN_MULT } from './mounts.js';

export const RUN_SPEED = 7.0 * 1.6;          // PLAYER_RUN × PLAYER_RUN_BOOST (m/s)
export const SPEED_TOLERANCE = 1.15;         // margen por redondeos y frames
export const BURST_MAX_M = 15;               // margen de tirones de red
export const WARP_WINDOW_MS = 60_000;
export const WARP_NEAR_M = 15;
export const LOGIN_NEAR_M = 30;

/** m/s máximos con esa montura (null = a pie). flying: si puede volar. */
export function maxSpeed(mountId, flying) {
  const M = mountId ? MOUNTS[mountId] : null;
  if (!M) return RUN_SPEED;
  // el server no sabe si llevas el botón de correr: siempre admite el galope
  return RUN_SPEED * (M.fly && flying ? M.flySpeed : M.speed) * MOUNT_RUN_MULT;
}
