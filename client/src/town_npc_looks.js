/**
 * SebasPresent — Aspecto de cada NPC del pueblo (Sesión 50)
 *
 *   model: gente de la calle  f34…f46 (mujeres) · m33…m45 (hombres) · sheriff_n · sheriff_n_01
 *          caballeros         guardia1 (yelmo cerrado) · guardia2 (capacete)  ← tal cual vienen
 *          criaturas          warrok · zombi · zombi_chico · goblin2 · killer_08/09/10 · monster_06/07/08
 *   tint:  { hue: giro de tono 0..1 de la ropa (la piel se respeta), sat, val }
 *   armor: piezas procedurales (las del jugador): helm/body/legs/boots/gloves/shield_<metal>
 *   weapon: espada procedural en la mano derecha
 *   anims: 'mutant' → clips de Mixamo (criaturas); sin anims se animan por código
 *
 * Tonos: 0 rojo · 0.08 naranja · 0.13 oro · 0.3 verde · 0.5 turquesa · 0.6 azul · 0.72 morado · 0.88 rosa
 */
const FULL = (m, shield = true) => [`helm_${m}`, `body_${m}`, `legs_${m}`, `boots_${m}`, `gloves_${m}`, ...(shield ? [`shield_${m}`] : [])];
const BANKER = { model: 'm36' };

export const NPC_LOOKS = {
  // La Laguna
  guia_aldric:         { model: 'm41' },
  banquero_gerardo:    { model: 'm36' },
  lia_artesana:        { model: 'f45' },
  morgana_maga:        { model: 'f44', tint: { hue: 0.72, sat: 1.5 } },
  pregonero:           { model: 'm35' },
  guardia_concejo:     { model: 'guardia1' },                                        // el caballero tal cual
  tomas_pescador:      { model: 'm34' },
  brom_herrero:        { model: 'm37', armor: ['body_bronze', 'gloves_bronze'] },
  gus_minero:          { model: 'm33', armor: ['helm_hierro', 'gloves_hierro'] },
  alma_sacerdotisa:    { model: 'f39', tint: { sat: 0.2, val: 1.4 } },
  rosa_granjera:       { model: 'f35' },
  joaquin_lenador:     { model: 'm42' },
  bruno_cazador:       { model: 'm44', armor: ['legs_cuero'] },
  petra_abuela:        { model: 'f38' },
  irene_farera:        { model: 'f34' },
  nuria_herrera:       { model: 'f43', armor: ['body_acero', 'gloves_acero'] },
  sven_guardia:        { model: 'guardia2' },                                        // el otro caballero tal cual
  eldric_mago:         { model: 'm45', tint: { hue: 0.6, sat: 1.4 } },
  ramiro_capataz:      { model: 'sheriff_n_01', armor: ['helm_bronze'] },
  samir_mercader:      { model: 'm38', tint: { hue: 0.45, sat: 1.3 } },
  explorador_herido:   { model: 'killer_09' },
  kargath:             { model: 'warrok', anims: 'mutant' },
  carmita_aso:         { model: 'f40' },
  airam_forzudo:       { model: 'warrok', anims: 'mutant', tint: { hue: 0.05, sat: 1.3 }, style: { flexEvery: 7 } },
  yeray_pastor:        { model: 'm39' },
  banquera_dacil:      { model: 'f37' },
  banquero_acaymo:     { model: 'm40' },
  banquera_cathaysa:   { model: 'f37', tint: { hue: 0.88 } },
  cronista_elena:      { model: 'f36' },
  abuelo_guayre:       { model: 'm43' },
  ermitano_candelaria: { model: 'm33', tint: { hue: 0.08, sat: 0.6 } },
  abuela_lola:         { model: 'f38', tint: { hue: 0.85 } },
  maestro_rafael:      { model: 'm45' },
  dona_carmen:         { model: 'f39', tint: { hue: 0.3 } },
  alcalde_faustino:    { model: 'm36', tint: { sat: 0.0, val: 1.5 } },   // de blanco, como Arico
  tanausu_cuadra:      { model: 'sheriff_n' },
  nauzet_inmobiliaria: { model: 'm40', tint: { hue: 0.6, val: 0.7 } },
  // Mercaderes de los pueblos
  yaiza_comidas:       { model: 'f46' },
  echedey_armero:      { model: 'guardia1', armor: FULL('teiderio', false), weapon: 'sword_teiderio' },
  gara_pieles:         { model: 'f43', armor: ['body_cuero', 'legs_cuero'] },
  bentejui_ferretero:  { model: 'm41', tint: { hue: 0.55 } },
  guacimara_flechas:   { model: 'f42', armor: ['legs_cuero', 'boots_cuero'] },
  fayna_pescadera:     { model: 'f35', tint: { hue: 0.55 } },
  // Personajes nuevos por regiones (shared/town_npcs.js)
  chema_oso:           { model: 'killer_10' },
  visitante_izana:     { model: 'monster_06', tint: { hue: 0.5, sat: 1.3 } },
  bicho_canadas:       { model: 'monster_08', anims: 'mutant' },
  caballero_anaga:     { model: 'guardia1', tint: { hue: 0.33, sat: 1.2 }, armor: ['body_bronze', 'legs_bronze', 'shield_bronze'], weapon: 'sword_bronze' },
  caballera_teide:     { model: 'guardia2', armor: FULL('teiderio'), weapon: 'sword_teiderio' },
  caballero_abona:     { model: 'guardia1', tint: { hue: 0.6, sat: 1.3 }, armor: ['body_hierro', 'gloves_hierro'], weapon: 'sword_hierro' },
};

// Borrachos: el zombi chico con su botella, cada uno con la camisa de otro color
const DRUNK_HUES = [0, 0.1, 0.3, 0.45, 0.75, 0.9, 0.2, 0.62, 0.05, 0.38, 0.82, 0.55, 0.15];

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const CIVIL = ['m33', 'm35', 'm38', 'm39', 'm41', 'm42', 'm44', 'f34', 'f35', 'f36', 'f40', 'f45', 'f46'];

export function lookFor(n) {
  if (NPC_LOOKS[n.id]) return NPC_LOOKS[n.id];
  if (n.drunk) {
    const i = hash(n.id) % DRUNK_HUES.length;
    return { model: 'zombi_chico', tint: { hue: DRUNK_HUES[i], sat: 1.1 }, bottle: true };
  }
  if (/banquer/.test(n.id)) return BANKER;
  // Por defecto: un vecino de calle, estable por id
  const h = hash(n.id);
  return { model: CIVIL[h % CIVIL.length] };
}
