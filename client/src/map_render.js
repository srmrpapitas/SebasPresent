/**
 * SebasPresent — Pintor del mapa (minimapa + mapa grande) · Sesión 50
 *
 * Genera imágenes del terreno a partir del mismo generador del mundo:
 *   - biomas con bordes suaves (mezcla de 5 muestras),
 *   - textura de "suelo" (ruido suave claro/oscuro, como el terreno 3D),
 *   - mar fuera de la isla con espuma en la costa,
 *   - estanques/lagos (shared/fishing.js), plazas empedradas en las ciudades,
 *   - tinte rojizo del Malpaís.
 * Y dibuja iconos estilo OSRS (banco, yunque, altar, pesca, misión…).
 */
import { roadDist, ROAD_HALF_W } from './shared/roads.js';   // Sesión 50
import { BIOMES, WORLD_HALF, WILDERNESS_X, PLACES, biomeAt } from './terrain.js';
import { PONDS } from './shared/fishing.js';

// ------------------------------------------------------------
// Ruido suave (value noise) para la textura del suelo
// ------------------------------------------------------------
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const BIOME_RGB = {};
for (const [id, b] of Object.entries(BIOMES)) BIOME_RGB[id] = { base: rgb(b.base), light: rgb(b.light), dark: rgb(b.dark) };

const SEA = [58, 104, 140], SEA_DEEP = [38, 74, 110], FOAM = [206, 226, 236];
const WATER = [58, 127, 176], ICE = [207, 230, 242], SAND = [214, 196, 150];
const COBBLE = [168, 156, 136];

const CITY_R = { city: 26, village: 16 };

/** Color [r,g,b] del mapa en (x, z). */
export function colorAt(x, z) {
  // Mar alrededor de la isla
  const edge = Math.max(Math.abs(x), Math.abs(z)) - WORLD_HALF;
  if (edge > 0) {
    if (edge < 5) return FOAM;
    const k = Math.min(1, edge / 120);
    const n = vnoise(x * 0.02, z * 0.02) * 0.12;
    return [
      SEA[0] + (SEA_DEEP[0] - SEA[0]) * k - n * 30,
      SEA[1] + (SEA_DEEP[1] - SEA[1]) * k - n * 30,
      SEA[2] + (SEA_DEEP[2] - SEA[2]) * k - n * 20,
    ];
  }
  // Sesión 50 — caminos
  const rd = roadDist(x, z);
  if (rd < ROAD_HALF_W + 1.2) {
    const n = vnoise(x * 0.3, z * 0.3) * 10;
    return rd < ROAD_HALF_W ? [176 + n, 146 + n, 100 + n] : [120 + n, 96 + n, 66 + n];
  }
  // Agua de estanques/lagos
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 3) {
      if (d < p.r - 0.5) {
        const deep = 1 - d / p.r;
        const c = p.frozen ? ICE : WATER;
        return [c[0] - deep * 25, c[1] - deep * 20, c[2] - deep * 10];
      }
      if (d < p.r + 1.5) return p.frozen ? [235, 243, 248] : SAND;
    }
  }
  // Biomas con borde suave: 5 muestras
  const S = 7;
  let r = 0, g = 0, b = 0;
  const pts = [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]];
  let wild = 0, first = null, mixed = false;
  for (const [ox, oz] of pts) {
    const bi = biomeAt(x + ox, z + oz);
    if (first === null) first = bi.id; else if (bi.id !== first) mixed = true;
    const c = BIOME_RGB[bi.id] || BIOME_RGB.plains;
    r += c.base[0]; g += c.base[1]; b += c.base[2];
    if (bi.id === 'wilderness') wild++;
  }
  r /= 5; g /= 5; b /= 5;
  // Textura del suelo: ruido a dos escalas (manchas grandes + grano)
  const n = (vnoise(x * 0.011, z * 0.011) - 0.5) * 0.9 + (vnoise(x * 0.07 + 31, z * 0.07 + 17) - 0.5) * 0.45;
  const f = (1 + n * 0.22) * (mixed ? 0.9 : 1);   // borde de bioma algo más oscuro
  r *= f; g *= f; b *= f;
  // Plazas empedradas de ciudades/pueblos
  for (const p of PLACES) {
    const R = CITY_R[p.type];
    if (!R) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < R) {
      const k = d < R - 5 ? 1 : (R - d) / 5;
      const tile = ((Math.floor(x / 3) + Math.floor(z / 3)) & 1) ? 0.95 : 1.04;
      r += (COBBLE[0] * tile - r) * k * 0.85; g += (COBBLE[1] * tile - g) * k * 0.85; b += (COBBLE[2] * tile - b) * k * 0.85;
    }
  }
  // Malpaís: rojizo y más oscuro
  if (x < WILDERNESS_X + 10) {
    const k = Math.min(1, (WILDERNESS_X + 10 - x) / 40) * 0.25;
    r = r + (120 - r) * k; g = g * (1 - k * 0.8); b = b * (1 - k * 0.8);
  }
  return [r, g, b];
}

/** Pinta una región en un canvas nuevo. mpp = metros por píxel. */
export function renderRegion(x0, z0, w, h, mpp) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const z = z0 + (j + 0.5) * mpp;
    for (let i = 0; i < w; i++) {
      const col = colorAt(x0 + (i + 0.5) * mpp, z);
      const k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Mapa del mundo completo (con un margen de mar), generado por trozos para
 * no congelar el juego. Devuelve una promesa con { canvas, x0, z0, mpp }.
 */
let worldPromise = null;
export const WORLD_MAP_MARGIN = 160;
export function getWorldBase(size = 900) {
  if (worldPromise) return worldPromise;
  worldPromise = new Promise((resolve) => {
    const span = (WORLD_HALF + WORLD_MAP_MARGIN) * 2;
    const mpp = span / size;
    const x0 = -WORLD_HALF - WORLD_MAP_MARGIN, z0 = x0;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const ROWS = 36;
    let row = 0;
    const step = () => {
      const h = Math.min(ROWS, size - row);
      const img = g.createImageData(size, h);
      const d = img.data;
      for (let j = 0; j < h; j++) {
        const z = z0 + (row + j + 0.5) * mpp;
        for (let i = 0; i < size; i++) {
          const col = colorAt(x0 + (i + 0.5) * mpp, z);
          const k = (j * size + i) * 4;
          d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, row);
      row += h;
      if (row < size) setTimeout(step, 0);
      else {
        // Frontera del Malpaís (línea discontinua roja)
        const wx = (WILDERNESS_X - x0) / mpp;
        g.save();
        g.strokeStyle = 'rgba(200,40,30,0.85)'; g.lineWidth = 2; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(wx, (-WORLD_HALF - z0) / mpp); g.lineTo(wx, (WORLD_HALF - z0) / mpp); g.stroke();
        g.restore();
        resolve({ canvas: c, x0, z0, mpp });
      }
    };
    step();
  });
  return worldPromise;
}

// ------------------------------------------------------------
// Iconos (estilo OSRS: círculo con borde negro y símbolo)
// ------------------------------------------------------------
function disc(ctx, x, y, r, fill, stroke = '#000') {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18); ctx.strokeStyle = stroke; ctx.stroke();
}

/** Dibuja un icono de tipo `kind` centrado en (x, y) con radio r. */
export function drawIcon(ctx, kind, x, y, r = 6, extra = {}) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  switch (kind) {
    case 'bank': {
      disc(ctx, x, y, r, '#f2c230', '#4a3000');
      ctx.fillStyle = '#4a3000'; ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
      ctx.fillText('$', x, y + r * 0.08);
      break;
    }
    case 'anvil': {
      disc(ctx, x, y, r, '#3c4048');
      ctx.fillStyle = '#c8ccd4';
      ctx.fillRect(x - r * 0.6, y - r * 0.3, r * 1.2, r * 0.3);
      ctx.fillRect(x - r * 0.2, y, r * 0.4, r * 0.35);
      ctx.fillRect(x - r * 0.45, y + r * 0.35, r * 0.9, r * 0.2);
      break;
    }
    case 'furnace': {
      disc(ctx, x, y, r, '#5a2a18');
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath(); ctx.moveTo(x, y - r * 0.6); ctx.quadraticCurveTo(x + r * 0.55, y, x, y + r * 0.5);
      ctx.quadraticCurveTo(x - r * 0.55, y, x, y - r * 0.6); ctx.fill();
      break;
    }
    case 'altar': {
      disc(ctx, x, y, r, '#e8e2ff', '#2a1a4a');
      ctx.fillStyle = '#5a3aa0';
      ctx.fillRect(x - r * 0.12, y - r * 0.6, r * 0.24, r * 1.2);
      ctx.fillRect(x - r * 0.45, y - r * 0.3, r * 0.9, r * 0.22);
      break;
    }
    case 'fish': {
      disc(ctx, x, y, r, '#2f78c0', '#0a2440');
      ctx.fillStyle = '#d8f0ff';
      ctx.beginPath(); ctx.ellipse(x - r * 0.1, y, r * 0.45, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + r * 0.3, y); ctx.lineTo(x + r * 0.65, y - r * 0.3); ctx.lineTo(x + r * 0.65, y + r * 0.3); ctx.fill();
      break;
    }
    case 'mine': {
      disc(ctx, x, y, r, '#6a6a6a');
      ctx.strokeStyle = '#e0d8c0'; ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.beginPath(); ctx.moveTo(x - r * 0.5, y + r * 0.5); ctx.lineTo(x + r * 0.35, y - r * 0.35); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + r * 0.25, y - r * 0.25, r * 0.45, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
      break;
    }
    case 'quest': {
      const t = extra.mark === 'turnin' ? '?' : '!';
      ctx.font = `900 ${Math.round(r * 2.1)}px sans-serif`;
      ctx.lineWidth = Math.max(2, r * 0.45); ctx.strokeStyle = '#000';
      ctx.strokeText(t, x, y); ctx.fillStyle = '#ffd24a'; ctx.fillText(t, x, y);
      break;
    }
    case 'city': {
      disc(ctx, x, y, r, '#ffd060');
      ctx.fillStyle = '#5a3c00';
      const w = r * 1.1;
      ctx.fillRect(x - w / 2, y - r * 0.15, w, r * 0.6);
      for (let k = -1; k <= 1; k++) ctx.fillRect(x + k * w * 0.38 - r * 0.1, y - r * 0.45, r * 0.2, r * 0.3);
      break;
    }
    case 'village': {
      disc(ctx, x, y, r, '#c8a043');
      ctx.fillStyle = '#3a2410';
      ctx.beginPath(); ctx.moveTo(x - r * 0.55, y); ctx.lineTo(x, y - r * 0.55); ctx.lineTo(x + r * 0.55, y); ctx.fill();
      ctx.fillRect(x - r * 0.38, y, r * 0.76, r * 0.45);
      break;
    }
    case 'boss': {
      disc(ctx, x, y, r, '#b01818', '#000');
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y - r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b01818';
      ctx.fillRect(x - r * 0.28, y - r * 0.2, r * 0.18, r * 0.18);
      ctx.fillRect(x + r * 0.1, y - r * 0.2, r * 0.18, r * 0.18);
      ctx.fillStyle = '#fff'; ctx.fillRect(x - r * 0.25, y + r * 0.3, r * 0.5, r * 0.2);
      break;
    }
    case 'minigame': {
      disc(ctx, x, y, r, '#ff7a1a', '#3a1000');
      ctx.fillStyle = '#ffe070';
      ctx.beginPath(); ctx.moveTo(x, y - r * 0.6); ctx.quadraticCurveTo(x + r * 0.6, y + r * 0.1, x, y + r * 0.55);
      ctx.quadraticCurveTo(x - r * 0.6, y + r * 0.1, x, y - r * 0.6); ctx.fill();
      break;
    }
    case 'house': {    // Sesión 50 — urbanización: casita blanca, tejado rojo
      disc(ctx, x, y, r, '#2f6a3a', '#0f200f');
      ctx.fillStyle = '#f4f0e6'; ctx.fillRect(x - r * 0.5, y - r * 0.05, r, r * 0.6);
      ctx.fillStyle = '#c0502e'; ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y); ctx.lineTo(x, y - r * 0.65); ctx.lineTo(x + r * 0.7, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2f6a3a'; ctx.fillRect(x - r * 0.13, y + r * 0.2, r * 0.26, r * 0.35);
      break;
    }
    case 'cave': {     // Sesión 50 — boca de cueva: montaña gris con arco negro
      disc(ctx, x, y, r, '#5a5048', '#1a1410');
      ctx.fillStyle = '#8a7e70'; ctx.beginPath();
      ctx.moveTo(x - r * 0.8, y + r * 0.45); ctx.lineTo(x - r * 0.15, y - r * 0.7); ctx.lineTo(x + r * 0.8, y + r * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0a0806'; ctx.beginPath();
      ctx.arc(x, y + r * 0.45, r * 0.32, Math.PI, 0); ctx.closePath(); ctx.fill();
      break;
    }
    case 'hunt': {     // Sesión 51 — zona de caza: dos espadas cruzadas (Malpaís: disco rojo)
      disc(ctx, x, y, r, extra.wild ? '#7a1a12' : '#5a3a14', '#140800');
      const blade = (dir) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(dir * Math.PI / 4);
        ctx.fillStyle = '#e8e8f0';
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.78); ctx.lineTo(r * 0.11, -r * 0.6); ctx.lineTo(r * 0.11, r * 0.28);
        ctx.lineTo(-r * 0.11, r * 0.28); ctx.lineTo(-r * 0.11, -r * 0.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e0b040';
        ctx.fillRect(-r * 0.32, r * 0.28, r * 0.64, r * 0.13);
        ctx.fillStyle = '#7a4a1a';
        ctx.fillRect(-r * 0.08, r * 0.41, r * 0.16, r * 0.3);
        ctx.restore();
      };
      blade(1); blade(-1);
      break;
    }
    case 'landmark': default: {
      disc(ctx, x, y, r, extra.color || '#9090c0');
      break;
    }
  }
  ctx.restore();
}

/** Tipo de icono para un PLACE. */
export function placeIconKind(p) {
  if (p.type === 'city' || p.type === 'village' || p.type === 'boss') return p.type;
  if (p.type === 'poblado') return 'village';
  if (p.type === 'mine') return 'mine';
  if (p.type === 'temple' || p.type === 'altar') return 'altar';
  return 'landmark';
}

/** Flecha del jugador (apunta hacia `ang`, rotación Y del modelo). */
export function drawPlayerArrow(ctx, x, y, ang, s = 7, fill = '#fff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-ang + Math.PI);   // rot.y = 0 mira hacia +Z (abajo en el mapa)
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.8); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.7, s * 0.8); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}

/** Texto con contorno (etiquetas legibles sobre cualquier fondo). */
export function label(ctx, text, x, y, size = 11, color = '#fff8d0', bold = false) {
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${size}px "IM Fell English", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.28); ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.restore();
}
