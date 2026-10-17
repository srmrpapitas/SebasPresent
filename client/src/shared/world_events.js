/**
 * SebasPresent — Evento de la isla: «¡El Teide ruge!» (Sesión 53)
 * Compartido cliente + servidor.
 *
 * Cada 2 horas (a las horas impares UTC: 21:00 / 22:00 en Canarias según la
 * época del año, etc.) despierta la TIBICENA MAYOR, el perro más grande de
 * Guayota, junto al Observatorio de Izaña. Dura 15 minutos. Se avisa 5 minutos antes.
 *
 * Todos los que le peguen al menos una vez se llevan su PROPIO premio cuando
 * muere (monedas + una tirada de su botín directo a la mochila o al banco).
 * El horario sale del reloj: no hay nada que guardar y todos lo ven igual.
 */
export const WORLD_EVENT = {
  boss: 'tibicena_mayor',
  name: 'la Tibicena Mayor',
  place: 'los llanos junto al Observatorio de Izaña',
  x: 465, z: -835, r: 32,
};
export const EVENT_EVERY_MS = 2 * 3_600_000;
export const EVENT_OFFSET_MS = 3_600_000;      // empieza en las horas impares (UTC)
export const EVENT_DURATION_MS = 15 * 60_000;
export const EVENT_WARN_MS = 5 * 60_000;
export const EVENT_REWARD = { coinsMin: 1500, coinsMax: 4000 };

/** Ventana del evento para el instante t. */
export function eventWindow(t = Date.now()) {
  const k = Math.floor((t - EVENT_OFFSET_MS) / EVENT_EVERY_MS);
  const start = k * EVENT_EVERY_MS + EVENT_OFFSET_MS;
  const end = start + EVENT_DURATION_MS;
  const next = start + EVENT_EVERY_MS;
  const active = t >= start && t < end;
  const warning = !active && t >= next - EVENT_WARN_MS;
  return { start, end, next, active, warning, msLeft: active ? end - t : 0, msToNext: next - t };
}

const DIRS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
/** "a 640 m al noreste" desde (x,z). Norte = -z (como el minimapa). */
export function directionTo(x, z) {
  const dx = WORLD_EVENT.x - x, dz = WORLD_EVENT.z - z;
  const d = Math.hypot(dx, dz);
  if (d < WORLD_EVENT.r) return 'aquí mismo';
  const ang = Math.atan2(dx, -dz);   // 0 = norte, horario
  const i = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  return `a ${d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(d / 10) * 10 + ' m'} al ${DIRS[i]}`;
}
