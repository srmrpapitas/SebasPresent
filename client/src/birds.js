/**
 * SebasPresent — Pájaros en el cielo (Sesión 52)
 *
 * Vida alrededor del jugador, sin servidor:
 *   - Gaviotas planeando en círculos cerca de la costa (de día).
 *   - Bandadas de pajarillos sobre el campo y el monte (de día).
 *   - Murciélagos revoloteando de noche (monte, charcas, Malpaís).
 *
 * Mallas instanciadas: 3 llamadas de dibujo por especie (cuerpo y dos
 * alas), sin luces nuevas. Fuera de casas y cuevas.
 *   birds.start({ scene, getPlayer, biomeAt, isNight, isIndoors, isCave })
 *   birds.update(dt)   birds.stop()
 */
import * as THREE from 'three';
import { WORLD_HALF } from './terrain.js';

const SPECIES = {
  gull:    { n: 7,  span: 1.8,  body: 0xf4f4f0, wing: 0xdfe3e8, tip: 0x2a2a2a, flapHz: 1.6, glide: true },
  sparrow: { n: 10, span: 0.8,  body: 0x5a4632, wing: 0x6e5840, tip: 0x3a2a1a, flapHz: 7,   glide: false },
  bat:     { n: 7,  span: 0.75, body: 0x1c1618, wing: 0x2a2024, tip: 0x120e10, flapHz: 9,   glide: false },
};

let scene = null, opts = null, started = false;
const groups = {};      // especie → { body, wl, wr, birds: [] }
let t = 0, envAcc = 0;
let env = { coast: 0, biome: 'plains', night: false, hidden: true };
const dummy = new THREE.Object3D();
const mat4 = new THREE.Matrix4(), wingM = new THREE.Matrix4(), rotM = new THREE.Matrix4();

function wingGeometry(span, flip) {
  // triángulo-ala con el borde de ataque recto; el eje de giro es el lado del cuerpo (x = 0)
  const s = flip ? -1 : 1, w = span / 2;
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.14 * span,   s * w, 0, 0.02 * span,   0, 0, -0.1 * span,
    s * w, 0, 0.02 * span,   s * w * 0.78, 0, -0.12 * span,   0, 0, -0.1 * span,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function build(kind) {
  const S = SPECIES[kind];
  const bodyG = new THREE.ConeGeometry(0.07 * S.span, 0.42 * S.span, 5);
  bodyG.rotateX(Math.PI / 2);                    // punta hacia +Z (delante)
  const bm = new THREE.MeshLambertMaterial({ color: S.body, flatShading: true });
  const wm = new THREE.MeshLambertMaterial({ color: S.wing, flatShading: true, side: THREE.DoubleSide });
  const mk = (geo, m) => { const im = new THREE.InstancedMesh(geo, m, S.n); im.frustumCulled = false; im.visible = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; };
  const g = { body: mk(bodyG, bm), wl: mk(wingGeometry(S.span, false), wm), wr: mk(wingGeometry(S.span, true), wm), birds: [], kind };
  for (let i = 0; i < S.n; i++) g.birds.push({ cx: 0, cz: 0, r: 10, h: 10, a: Math.random() * 6.28, w: 0.3, ph: Math.random() * 6.28, lead: i, off: [0, 0, 0], placed: false });
  groups[kind] = g;
}

export function start(o) {
  opts = o; scene = o.scene;
  for (const k of Object.keys(SPECIES)) build(k);
  started = true;
}

export function stop() {
  if (!started) return;
  started = false;
  for (const g of Object.values(groups)) for (const im of [g.body, g.wl, g.wr]) { scene?.remove(im); im.geometry.dispose(); im.material.dispose(); }
  for (const k of Object.keys(groups)) delete groups[k];
}

function sampleEnv() {
  const p = opts.getPlayer?.();
  env.hidden = !p || !!opts.isIndoors?.() || !!opts.isCave?.();
  env.night = !!opts.isNight?.();
  if (!p) return;
  const x = p.position.x, z = p.position.z;
  const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));
  env.coast = Math.max(0, Math.min(1, 1 - (edge - 30) / 220));
  try { env.biome = opts.biomeAt?.(x, z)?.id || 'plains'; } catch { env.biome = 'plains'; }
}

function wanted(kind) {
  if (env.hidden) return 0;
  const b = env.biome;
  if (kind === 'gull') return env.night ? 0 : (env.coast > 0.05 ? SPECIES.gull.n : 0);
  if (kind === 'sparrow') return env.night ? 0 : (['plains', 'forest', 'jungle', 'swamp', 'plaza', 'beach'].includes(b) ? SPECIES.sparrow.n : 0);
  if (kind === 'bat') return env.night && ['forest', 'swamp', 'wilderness', 'jungle', 'plains'].includes(b) ? SPECIES.bat.n : 0;
  return 0;
}

function place(g, b, i, px, py, pz) {
  const kind = g.kind;
  const ang = Math.random() * Math.PI * 2, d = kind === 'bat' ? 5 + Math.random() * 12 : 14 + Math.random() * 34;
  if (kind === 'sparrow' && i % 5 !== 0) {         // bandada: siguen al primero de cada grupo de 5
    b.lead = i - (i % 5);
    b.off = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3];
  } else b.lead = i;
  b.cx = px + Math.cos(ang) * d; b.cz = pz + Math.sin(ang) * d;
  if (kind === 'gull') {                           // hacia el mar
    const sx = Math.sign(px) || 1, sz = Math.sign(pz) || 1;
    if (Math.abs(px) > Math.abs(pz)) b.cx += sx * 20; else b.cz += sz * 20;
  }
  b.r = kind === 'gull' ? 10 + Math.random() * 16 : kind === 'bat' ? 2.5 + Math.random() * 4 : 8 + Math.random() * 10;
  b.h = py + (kind === 'gull' ? 6 + Math.random() * 7 : kind === 'bat' ? 2.5 + Math.random() * 3 : 3 + Math.random() * 4);   // a la altura que se ve con la cámara del juego
  b.w = (kind === 'bat' ? 1.4 : kind === 'gull' ? 0.25 : 0.55) * (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.4);
  b.placed = true;
}

export function update(dt) {
  if (!started) return;
  t += dt; envAcc += dt;
  if (envAcc > 0.5) { envAcc = 0; sampleEnv(); }
  const p = opts.getPlayer?.();
  if (!p) return;
  const px = p.position.x, py = Math.max(0, p.position.y), pz = p.position.z;
  for (const g of Object.values(groups)) {
    const S = SPECIES[g.kind];
    const n = wanted(g.kind);
    for (const im of [g.body, g.wl, g.wr]) { im.visible = n > 0; im.count = n; }
    if (!n) { for (const b of g.birds) b.placed = false; continue; }
    for (let i = 0; i < n; i++) {
      const b = g.birds[i];
      if (!b.placed || Math.hypot(b.cx - px, b.cz - pz) > 140) place(g, b, i, px, py, pz);
      b.a += b.w * dt;
      const L = g.birds[b.lead];
      let x, y, z, yaw;
      if (L !== b && L.placed) {
        // seguir al líder de la bandada con su desfase
        x = L.cx + Math.cos(L.a) * L.r + b.off[0]; z = L.cz + Math.sin(L.a) * L.r + b.off[2];
        y = L.h + Math.sin(t * 2 + i) * 0.4 + b.off[1];
        yaw = Math.atan2(-Math.sin(L.a) * Math.sign(L.w), Math.cos(L.a) * Math.sign(L.w));
      } else {
        const wob = g.kind === 'bat' ? Math.sin(t * 5 + i) * 1.2 : Math.sin(t * 0.7 + i) * 1.5;
        x = b.cx + Math.cos(b.a) * (b.r + wob); z = b.cz + Math.sin(b.a) * (b.r + wob);
        y = b.h + Math.sin(t * (g.kind === 'bat' ? 3 : 0.8) + i * 1.7) * (g.kind === 'bat' ? 1.2 : 0.8);
        // rumbo = tangente del círculo
        yaw = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
      }
      // aleteo (las gaviotas planean y aletean a ratos)
      let amp = 0.75;
      if (S.glide) amp = (Math.sin(t * 0.5 + i * 2.3) > 0.3) ? 0.6 : 0.08;
      const flap = Math.sin(t * S.flapHz * Math.PI * 2 + b.ph) * amp;
      const bank = -Math.sign(b.w) * (g.kind === 'gull' ? 0.35 : 0.2);
      dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, bank); dummy.updateMatrix();
      g.body.setMatrixAt(i, dummy.matrix);
      rotM.makeRotationZ(flap); wingM.multiplyMatrices(dummy.matrix, rotM); g.wl.setMatrixAt(i, wingM);
      rotM.makeRotationZ(-flap); mat4.multiplyMatrices(dummy.matrix, rotM); g.wr.setMatrixAt(i, mat4);
    }
    g.body.instanceMatrix.needsUpdate = true; g.wl.instanceMatrix.needsUpdate = true; g.wr.instanceMatrix.needsUpdate = true;
  }
}

/** Depuración: cuántos hay por especie y la posición del primero. */
export function debugState() {
  const out = { env: { ...env } };
  for (const [k, g] of Object.entries(groups)) {
    const m = new THREE.Matrix4(); const v = new THREE.Vector3();
    if (g.body.count) { g.body.getMatrixAt(0, m); v.setFromMatrixPosition(m); }
    out[k] = { count: g.body.count, visible: g.body.visible, first: v.toArray().map(n => +n.toFixed(1)) };
  }
  return out;
}
