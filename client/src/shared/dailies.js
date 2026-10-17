/**
 * SebasPresent — Tareas diarias (Sesión 53)
 *
 * Cada día (medianoche de Canarias) hay 3 tareas, LAS MISMAS PARA TODOS
 * (así se puede hablar de "las diarias de hoy"). Se eligen con el número de
 * día, sin guardar nada en la base de datos.
 *
 * Se guardan dentro de user_quests (cero lecturas extra: questEvent y el
 * snapshot ya leen esa tabla):
 *   quest_id 'daily_1' | 'daily_2' | 'daily_3' → step = día, progress, status (0 en curso, 1 hecha)
 *   quest_id 'daily_racha'                     → step = último día con las 3 hechas, progress = racha, status = 2
 */

export const DAILY_SLOTS = ['daily_1', 'daily_2', 'daily_3'];
export const DAILY_STREAK_ID = 'daily_racha';
export const isDailyId = (id) => typeof id === 'string' && id.startsWith('daily_');

// Plantillas. `event` = el mismo evento que usan las misiones (questEvent).
// Sin `match`: vale cualquier cosa de ese tipo, para que sirva a todos los niveles.
export const DAILY_POOL = [
  { id: 'kill',   event: 'kill',  count: 20, skill: 'hitpoints',   icon: '⚔️', text: 'Derrota a 20 monstruos',            coins: 500, cat: 'combate' },
  { id: 'kill2',  event: 'kill',  count: 35, skill: 'attack',      icon: '🗡️', text: 'Derrota a 35 monstruos',            coins: 700, cat: 'combate' },
  { id: 'bury',   event: 'bury',  count: 15, skill: 'prayer',      icon: '🦴', text: 'Entierra 15 huesos',                coins: 350, cat: 'combate' },
  { id: 'chop',   event: 'chop',  count: 25, skill: 'woodcutting', icon: '🪓', text: 'Tala 25 troncos',                   coins: 400, cat: 'recoger' },
  { id: 'fish',   event: 'fish',  count: 20, skill: 'fishing',     icon: '🎣', text: 'Pesca 20 peces',                    coins: 400, cat: 'recoger' },
  { id: 'mine',   event: 'mine',  count: 20, skill: 'mining',      icon: '⛏️', text: 'Saca 20 minerales',                 coins: 400, cat: 'recoger' },
  { id: 'steal',  event: 'steal', count: 12, skill: 'thieving',    icon: '🫳', text: 'Roba con éxito 12 veces',           coins: 450, cat: 'recoger' },
  { id: 'cook',   event: 'cook',  count: 15, skill: 'cooking',     icon: '🍳', text: 'Cocina 15 comidas sin quemarlas',   coins: 400, cat: 'oficio' },
  { id: 'fire',   event: 'fire',  count: 10, skill: 'firemaking',  icon: '🔥', text: 'Enciende 10 hogueras',              coins: 350, cat: 'oficio' },
  { id: 'smelt',  event: 'smelt', count: 10, skill: 'smithing',    icon: '🧱', text: 'Funde 10 lingotes',                 coins: 450, cat: 'oficio' },
  { id: 'smith',  event: 'smith', count: 6,  skill: 'smithing',    icon: '🔨', text: 'Forja 6 piezas en el yunque',       coins: 500, cat: 'oficio' },
  { id: 'fletch', event: 'fletch', count: 10, skill: 'fletching',  icon: '🏹', text: 'Haz 10 cosas de flechería',         coins: 450, cat: 'oficio' },
  { id: 'craft',  event: 'craft', count: 8,  skill: 'crafting',    icon: '🧵', text: 'Haz 8 cosas de artesanía',          coins: 450, cat: 'oficio' },
];
export const DAILY_BY_ID = Object.fromEntries(DAILY_POOL.map(t => [t.id, t]));

// Una de cada categoría: combate, recoger y oficio.
const CATS = ['combate', 'recoger', 'oficio'];

/** XP de recompensa según tu nivel en esa habilidad (sube contigo). */
export function dailyXp(level) {
  const lv = Math.max(1, Math.min(99, level | 0));
  return Math.max(150, lv * 30);
}

/** Premio por hacer las 3: más monedas cuanto más larga la racha (tope 7 días). */
export function dailyBonus(streak) {
  const s = Math.max(1, Math.min(7, streak | 0));
  return {
    coins: 1000 + 250 * (s - 1),
    items: (streak > 0 && streak % 7 === 0) ? [['pocion_plegaria_3', 3]] : [],
  };
}

// ------------------------------------------------------------
// Día de Canarias (horario de Europa occidental: UTC+0, verano UTC+1)
// ------------------------------------------------------------
const DAY_MS = 86_400_000;
function lastSundayUtc(year, month) {   // month 0-based
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
export function canaryOffsetMs(t) {
  const y = new Date(t).getUTCFullYear();
  const start = lastSundayUtc(y, 2).getTime() + 3_600_000;   // último domingo de marzo, 01:00 UTC
  const end = lastSundayUtc(y, 9).getTime() + 3_600_000;     // último domingo de octubre, 01:00 UTC
  return (t >= start && t < end) ? 3_600_000 : 0;
}
/** Número de día (en Canarias). */
export function dayNumber(t = Date.now()) {
  return Math.floor((t + canaryOffsetMs(t)) / DAY_MS);
}
/** Milisegundos que faltan para el cambio de día. */
export function msToNextDay(t = Date.now()) {
  const off = canaryOffsetMs(t);
  return (dayNumber(t) + 1) * DAY_MS - (t + off);
}

function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Las 3 tareas del día `day`: [{ slot, ...plantilla }] */
export function dailiesFor(day) {
  const r = rng(day + 7919);
  const out = [];
  CATS.forEach((cat, i) => {
    const opts = DAILY_POOL.filter(t => t.cat === cat);
    const t = opts[Math.floor(r() * opts.length)];
    out.push({ slot: DAILY_SLOTS[i], ...t });
  });
  return out;
}
export function dailyForSlot(day, slot) {
  return dailiesFor(day).find(t => t.slot === slot) || null;
}
