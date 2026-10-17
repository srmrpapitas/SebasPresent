/**
 * SebasPresent — Logros (Sesión 53). Compartido cliente + servidor.
 *
 * Cada logro mira un "contexto" que el servidor arma con datos que ya existen
 * (niveles, misiones, contador de muertes, Fosa, colección, racha, decisiones):
 *   ctx = { lv:{skill:nivel}, total, combat, done:Set, kc:{def:n}, kills,
 *           bossKills, bossesKilled, fosaBest, col, streak, flags }
 * Al cumplirse se guarda (user_achievements) y se paga una sola vez.
 */
import { BOSSES } from './bosses.js';
import { QUESTS, QUEST_ORDER, SAGA } from './quests.js';

export const TIERS = {
  1: { name: 'Fácil',   coins: 500,    pts: 1, color: '#9fd69f' },
  2: { name: 'Media',   coins: 2000,   pts: 2, color: '#8fc3ff' },
  3: { name: 'Difícil', coins: 8000,   pts: 3, color: '#e3a3ff' },
  4: { name: 'Élite',   coins: 25000,  pts: 5, color: '#ffcf5a' },
};

export const ACH_CATS = [
  { id: 'combate',  name: 'Combate',   icon: '⚔️' },
  { id: 'jefes',    name: 'Jefes',     icon: '👑' },
  { id: 'fosa',     name: 'La Fosa',   icon: '🔥' },
  { id: 'oficios',  name: 'Oficios',   icon: '🛠️' },
  { id: 'misiones', name: 'Misiones',  icon: '📜' },
  { id: 'coleccion', name: 'Colección', icon: '📒' },
  { id: 'diarias',  name: 'Diarias',   icon: '📅' },
  { id: 'exploracion', name: 'Exploración', icon: '🧭' },   // Sesión 53 — tesoros
];

const SKILL_NAMES = {
  attack: 'Ataque', strength: 'Fuerza', defence: 'Defensa', hitpoints: 'Vitalidad', ranged: 'Distancia',
  magic: 'Magia', prayer: 'Plegaria', woodcutting: 'Tala', fishing: 'Pesca', mining: 'Minería',
  cooking: 'Cocina', firemaking: 'Fuego', smithing: 'Herrería', fletching: 'Flechería',
  herblore: 'Herbología', crafting: 'Artesanía', thieving: 'Robo',
};
export const ALL_SKILLS = Object.keys(SKILL_NAMES);
const TRADE_SKILLS = ['woodcutting', 'fishing', 'mining', 'cooking', 'firemaking', 'smithing', 'fletching', 'herblore', 'crafting', 'thieving'];
const SIDE_QUESTS = () => QUEST_ORDER.filter(id => !QUESTS[id]?.saga);
const minLevel = (c) => Math.min(...ALL_SKILLS.map(s => c.lv[s] || (s === 'hitpoints' ? 10 : 1)));

// Progreso: { have, need } para enseñar barras ("3/5").
const P = (have, need) => ({ have: Math.min(have, need), need });

const A = [];
const add = (id, cat, tier, icon, name, desc, prog) => A.push({ id, cat, tier, icon, name, desc, prog });

// --- Combate ---
add('primera_sangre', 'combate', 1, '🩸', 'Primera sangre', 'Derrota a tu primer monstruo.', c => P(c.kills, 1));
add('cazador_100',  'combate', 2, '🗡️', 'Cazador', 'Derrota a 100 monstruos.', c => P(c.kills, 100));
add('cazador_1000', 'combate', 3, '⚔️', 'Azote de la isla', 'Derrota a 1.000 monstruos.', c => P(c.kills, 1000));
add('cazador_5000', 'combate', 4, '☠️', 'Leyenda de Achinech', 'Derrota a 5.000 monstruos.', c => P(c.kills, 5000));
add('combate_30',  'combate', 1, '🛡️', 'Aprendiz de guerrero', 'Llega a nivel de combate 30.', c => P(c.combat, 30));
add('combate_60',  'combate', 2, '🛡️', 'Guerrero', 'Llega a nivel de combate 60.', c => P(c.combat, 60));
add('combate_90',  'combate', 3, '🛡️', 'Campeón', 'Llega a nivel de combate 90.', c => P(c.combat, 90));
add('combate_110', 'combate', 4, '🏆', 'Mencey de la guerra', 'Llega a nivel de combate 110.', c => P(c.combat, 110));

// --- Jefes ---
const BOSS_TIER = { dragon_rojo: 3, dragon_negro: 3, guayota: 4, magister_cabildo: 2 };
for (const [id, b] of Object.entries(BOSSES)) {
  add(`jefe_${id}`, 'jefes', BOSS_TIER[id] || 2, '👑', `Vence a ${b.name}`, `${b.name}${b.title ? `, ${b.title}` : ''}. Primera victoria.`, c => P(c.kc[id] || 0, 1));
}
add('jefes_todos', 'jefes', 4, '🌋', 'Cazador de reyes', 'Vence al menos una vez a todos los jefes.', c => P(c.bossesKilled, Object.keys(BOSSES).length));
add('jefes_50',    'jefes', 3, '💀', 'Pesadilla de los jefes', 'Suma 50 victorias contra jefes.', c => P(c.bossKills, 50));
add('jefes_250',   'jefes', 4, '💀', 'Fin de los tiranos', 'Suma 250 victorias contra jefes.', c => P(c.bossKills, 250));

// --- La Fosa ---
add('fosa_3',  'fosa', 1, '🔥', 'Calor', 'Supera la oleada 3 de la Fosa de Fuego.', c => P(c.fosaBest, 3));
add('fosa_6',  'fosa', 2, '🔥', 'Brasas', 'Supera la oleada 6 de la Fosa de Fuego.', c => P(c.fosaBest, 6));
add('fosa_9',  'fosa', 3, '🔥', 'Lava', 'Supera la oleada 9 de la Fosa de Fuego.', c => P(c.fosaBest, 9));
add('fosa_12', 'fosa', 4, '🌋', 'Hijo del volcán', 'Supera las 12 oleadas y gana la Capa de fuego.', c => P(c.fosaBest, 12));

// --- Oficios ---
add('total_100',  'oficios', 1, '📊', 'Nivel total 100', 'Suma 100 niveles entre todas las habilidades.', c => P(c.total, 100));
add('total_300',  'oficios', 2, '📊', 'Nivel total 300', 'Suma 300 niveles.', c => P(c.total, 300));
add('total_600',  'oficios', 3, '📊', 'Nivel total 600', 'Suma 600 niveles.', c => P(c.total, 600));
add('total_1000', 'oficios', 4, '📊', 'Nivel total 1.000', 'Suma 1.000 niveles.', c => P(c.total, 1000));
add('todo_10', 'oficios', 1, '🌱', 'De todo un poco', 'Nivel 10 en todas las habilidades.', c => P(minLevel(c), 10));
add('todo_30', 'oficios', 2, '🌿', 'Manitas', 'Nivel 30 en todas las habilidades.', c => P(minLevel(c), 30));
add('todo_50', 'oficios', 3, '🌳', 'Sabio de la isla', 'Nivel 50 en todas las habilidades.', c => P(minLevel(c), 50));
add('primer_99', 'oficios', 4, '⭐', 'Maestría', 'Llega a nivel 99 en cualquier habilidad.', c => P(Math.max(...ALL_SKILLS.map(s => c.lv[s] || 1)), 99));
for (const s of TRADE_SKILLS) {
  add(`oficio_${s}_60`, 'oficios', 2, '🛠️', `${SKILL_NAMES[s]} 60`, `Llega a nivel 60 de ${SKILL_NAMES[s]}.`, c => P(c.lv[s] || 1, 60));
}

// --- Misiones e historia ---
add('tutorial', 'misiones', 1, '🎓', 'Recién llegado', 'Termina «Primeros pasos».', c => P(c.done.has('tutorial') ? 1 : 0, 1));
add('misiones_5',  'misiones', 1, '📜', 'Recadero', 'Completa 5 misiones secundarias.', c => P(SIDE_QUESTS().filter(id => c.done.has(id)).length, 5));
add('misiones_15', 'misiones', 2, '📜', 'Aventurero', 'Completa 15 misiones secundarias.', c => P(SIDE_QUESTS().filter(id => c.done.has(id)).length, 15));
add('misiones_todas', 'misiones', 4, '📜', 'Héroe de Tenerife', 'Completa todas las misiones secundarias.', c => P(SIDE_QUESTS().filter(id => c.done.has(id)).length, SIDE_QUESTS().length));
add('saga_1', 'misiones', 1, '📖', 'La tierra tiembla', 'Termina el capítulo 1 de la historia principal.', c => P(c.done.has(SAGA.chapters[0]) ? 1 : 0, 1));
add('saga_3', 'misiones', 2, '📖', 'Las tres llaves', 'Termina el capítulo 3 de la historia principal.', c => P(c.done.has(SAGA.chapters[2]) ? 1 : 0, 1));
add('saga_6', 'misiones', 4, '🌞', 'El Sello de Achamán', 'Termina la historia principal.', c => P(SAGA.chapters.filter(id => c.done.has(id)).length, SAGA.chapters.length));
add('final_sello', 'misiones', 3, '🌞', 'Guardián del Sello', 'Devuelve a Guayota a su encierro.', c => P(c.flags.final === 'sello' ? 1 : 0, 1));
add('final_pacto', 'misiones', 3, '🔥', 'Heraldo del fuego', 'Quédate con el corazón de Guayota.', c => P(c.flags.final === 'pacto' ? 1 : 0, 1));

// --- Colección ---
add('col_1',  'coleccion', 1, '📒', 'Coleccionista', 'Consigue tu primer objeto del registro de colección.', c => P(c.col, 1));
add('col_10', 'coleccion', 2, '📒', 'Buscador de tesoros', '10 objetos distintos en el registro.', c => P(c.col, 10));
add('col_25', 'coleccion', 3, '📒', 'Cazatesoros', '25 objetos distintos en el registro.', c => P(c.col, 25));
add('col_50', 'coleccion', 4, '📒', 'El gran museo', '50 objetos distintos en el registro.', c => P(c.col, 50));

// --- Diarias ---
add('racha_1',  'diarias', 1, '📅', 'Buen día', 'Haz las 3 tareas diarias de un día.', c => P(c.streak, 1));
add('racha_3',  'diarias', 1, '📅', 'Constante', 'Racha de 3 días con las tareas diarias.', c => P(c.streak, 3));
add('racha_7',  'diarias', 2, '🔥', 'Una semana entera', 'Racha de 7 días.', c => P(c.streak, 7));
add('racha_30', 'diarias', 4, '🔥', 'Fiel a la isla', 'Racha de 30 días.', c => P(c.streak, 30));

// --- Exploración (tesoros escondidos) ---
add('tesoro_1',  'exploracion', 1, '🧭', 'Buscatesoros', 'Encuentra tu primer cofre escondido.', c => P(c.treasures || 0, 1));
add('tesoro_8',  'exploracion', 2, '🗺️', 'Explorador', 'Encuentra 8 cofres escondidos distintos.', c => P(c.treasures || 0, 8));
add('tesoro_16', 'exploracion', 4, '🏴‍☠️', 'Conozco cada rincón', 'Encuentra los 16 cofres escondidos de la isla.', c => P(c.treasures || 0, 16));

export const ACHIEVEMENTS = A;
export const ACH_BY_ID = Object.fromEntries(A.map(a => [a.id, a]));
export const MAX_POINTS = A.reduce((s, a) => s + TIERS[a.tier].pts, 0);

export function achProgress(a, ctx) {
  try { return a.prog(ctx); } catch { return { have: 0, need: 1 }; }
}
export function achMet(a, ctx) {
  const p = achProgress(a, ctx);
  return p.need > 0 && p.have >= p.need;
}
