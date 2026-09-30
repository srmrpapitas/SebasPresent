/**
 * SebasPresent — Pesca (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor (puro).
 *   - Estanques/lagos y costa donde hay bancos de peces (spots).
 *   - Los bancos se MUEVEN: cada spot está activo o no según un "turno" de
 *     5 min calculado igual en cliente y server (como en OSRS, que cambian de sitio).
 *   - Qué pez sale en cada tipo de spot, con qué herramienta y a qué nivel.
 */

export const TOOLS = {
  net:     { item: 'small_net',    name: 'Red pequeña' },
  rod:     { item: 'fishing_rod',  name: 'Caña de pescar', bait: 'feather', baitName: 'plumas' },
  harpoon: { item: 'harpoon',      name: 'Arpón' },
};

// Peces: nivel de Pesca, XP, y datos de cocina (nivel, XP, curación).
export const FISH = {
  raw_shrimp:    { name: 'Gambas',     level: 1,  xp: 10,  cooked: 'shrimp',    cookLevel: 1,  cookXp: 30,  heal: 3 },
  raw_sardine:   { name: 'Sardina',    level: 5,  xp: 20,  cooked: 'sardine',   cookLevel: 1,  cookXp: 40,  heal: 4 },
  raw_herring:   { name: 'Arenque',    level: 10, xp: 30,  cooked: 'herring',   cookLevel: 5,  cookXp: 50,  heal: 5 },
  raw_trout:     { name: 'Trucha',     level: 20, xp: 50,  cooked: 'trout',     cookLevel: 15, cookXp: 70,  heal: 7 },
  raw_salmon:    { name: 'Salmón',     level: 30, xp: 70,  cooked: 'salmon',    cookLevel: 25, cookXp: 90,  heal: 9 },
  raw_tuna:      { name: 'Atún',       level: 35, xp: 80,  cooked: 'tuna',      cookLevel: 30, cookXp: 100, heal: 10 },
  raw_swordfish: { name: 'Pez espada', level: 50, xp: 100, cooked: 'swordfish', cookLevel: 45, cookXp: 140, heal: 14 },
  raw_shark:     { name: 'Tiburón',    level: 76, xp: 110, cooked: 'shark',     cookLevel: 80, cookXp: 210, heal: 20 },
};

// Tipos de spot: herramienta + peces posibles (de mejor a peor).
export const SPOT_TYPES = {
  net:     { name: 'Banco de gambas',        tool: 'net',     fish: ['raw_shrimp'],                          color: '#bfe8ff' },
  rod:     { name: 'Banco de peces de río',  tool: 'rod',     fish: ['raw_salmon', 'raw_trout', 'raw_herring', 'raw_sardine'], color: '#d8ffd0' },
  harpoon: { name: 'Banco de peces grandes', tool: 'harpoon', fish: ['raw_swordfish', 'raw_tuna'],           color: '#ffe6b0' },
  deep:    { name: 'Aguas profundas',        tool: 'harpoon', fish: ['raw_shark', 'raw_swordfish'],          color: '#ffb0b0' },
};

export function spotMinLevel(type) {
  return Math.min(...SPOT_TYPES[type].fish.map(f => FISH[f].level));
}

/** Probabilidad de pescar un pez concreto en un intento. */
export function catchRate(fishId, level) {
  const f = FISH[fishId];
  if (!f || level < f.level) return 0;
  const p = Math.min(1, (level - f.level) / 40);
  return 0.30 + 0.45 * p;
}

// ------------------------------------------------------------
// Agua: estanques y lagos (el cliente los dibuja; el server solo usa los spots)
// ------------------------------------------------------------
export const PONDS = [
  { id: 'concejo', name: 'Laguna de Aguere', x: -70,  z: -150,  r: 9,  types: ['net', 'rod'], frozen: false },
  { id: 'pantano', name: 'Laguna del Pantano',   x: -500, z: 600,   r: 14, types: ['net', 'rod'], frozen: false },
  { id: 'selva',   name: 'Lago de Adeje',       x: 820,  z: 880,   r: 13, types: ['rod', 'harpoon'], frozen: false },
  { id: 'helado',  name: 'Lago Helado',          x: 500,  z: -1500, r: 12, types: ['harpoon'], frozen: true },
];

// Costa (el océano empieza en el borde del mundo, ±2048)
const COAST = [
  // Costa del Sur (playa): gambas y peces grandes
  ...Array.from({ length: 12 }, (_, i) => ({ x: -950 + i * 150, z: 2050, type: i % 3 === 2 ? 'harpoon' : 'net', coast: 'sur' })),
  // Costa del Malpaís (wilderness, oeste): aguas profundas
  ...Array.from({ length: 8 }, (_, i) => ({ x: -2050, z: -840 + i * 240, type: i % 2 ? 'deep' : 'harpoon', coast: 'oeste' })),
];

export const SPOT_USE_DIST_M = 5.5;   // desde la orilla
const BUCKET_MS = 5 * 60 * 1000;       // los bancos cambian de sitio cada 5 min

function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Lista fija de spots candidatos (activos o no).
export const SPOTS = (() => {
  const out = [];
  for (const p of PONDS) {
    const n = Math.max(4, Math.round(p.r / 2.5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      out.push({
        id: `p_${p.id}_${i}`, pond: p.id, type: p.types[i % p.types.length],
        x: Math.round((p.x + Math.cos(a) * (p.r - 1.6)) * 100) / 100,
        z: Math.round((p.z + Math.sin(a) * (p.r - 1.6)) * 100) / 100,
        seed: i + p.x * 3 + p.z * 7,
      });
    }
  }
  COAST.forEach((c, i) => out.push({ id: `c_${c.coast}_${i}`, pond: null, type: c.type, x: c.x, z: c.z, seed: 1000 + i * 13 }));
  return out;
})();

export const SPOTS_BY_ID = Object.fromEntries(SPOTS.map(s => [s.id, s]));

/** ¿Está este banco de peces activo ahora? (~60 % lo están en cada turno) */
export function isSpotActive(spot, now) {
  const bucket = Math.floor(now / BUCKET_MS);
  return hash2(spot.seed | 0, bucket) < 0.6;
}

/** ms hasta que cambie el turno (para avisar "los peces se mueven"). */
export function msToNextShift(now) { return BUCKET_MS - (now % BUCKET_MS); }
