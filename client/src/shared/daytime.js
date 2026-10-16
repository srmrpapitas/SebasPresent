/**
 * SebasPresent — Hora del día compartida cliente + servidor (Sesión 52)
 *
 * Ciclo de 40 min reales (28 de día, 12 de noche) a partir de la hora del
 * servidor (Date.now() en el worker). El cliente dibuja el cielo con esto
 * (daynight.js) y el servidor lo usa para pasos de misión "de noche".
 */
export const CYCLE_MS = 40 * 60 * 1000;
export const DAY_FRAC = 0.7;

/** 0..1 del ciclo (0 = amanecer, DAY_FRAC = atardecer). */
export function phaseAt(t) {
  return ((t % CYCLE_MS) / CYCLE_MS + 1) % 1;
}

/** Elevación del sol (>0 de día, <0 de noche) y luz 0..1 para una fase. */
export function lightAt(p) {
  const day = p < DAY_FRAC;
  const ang = day ? (p / DAY_FRAC) * Math.PI : ((p - DAY_FRAC) / (1 - DAY_FRAC)) * Math.PI;
  const elev = day ? Math.sin(ang) : -0.6 * Math.sin(ang);
  const x = Math.max(0, Math.min(1, (elev + 0.12) / 0.44));
  return { day, ang, elev, light: x * x * (3 - 2 * x) };
}

export function isNightAt(t) { return lightAt(phaseAt(t)).light < 0.5; }

/** Minutos reales que faltan para que se haga de noche (0 si ya lo es). */
export function minutesToNight(t) {
  if (isNightAt(t)) return 0;
  for (let m = 1; m <= 40; m++) if (isNightAt(t + m * 60000)) return m;
  return 40;
}
