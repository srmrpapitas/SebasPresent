/**
 * SebasPresent — Capas procedurales (Sesión 51)
 *
 *  - cape_fuego  (Capa de fuego): lava que FLUYE hacia abajo por la tela.
 *  - cape_magma  (Capa de magma): costra de obsidiana con ríos de magma que
 *    fluyen, borde incandescente y GOTAS de magma que caen del bajo.
 *  - Capas de mago: cape_achaman (cielo estrellado), cape_magec (sol),
 *    cape_chaxiraxi (tierra y luna).
 *
 * La tela ondea con el tiempo (desplazamiento en el vertex shader) y las
 * texturas de lava se desplazan con onBeforeRender (sin bucle propio).
 *
 * API: CAPE_IDS, buildCape(itemId, H, root) → [{ bone, mesh }] | null
 */
import * as THREE from 'three';

export const CAPE_IDS = new Set(['cape_fuego', 'cape_magma', 'cape_achaman', 'cape_magec', 'cape_chaxiraxi']);

const now = () => performance.now() / 1000;

// ------------------------------------------------------------
// Texturas (canvas, cacheadas, repetibles en vertical)
// ------------------------------------------------------------
const _tex = new Map();
function canvasTex(key, w, h, draw, repeat = true) {
  if (_tex.has(key)) return _tex.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  _tex.set(key, t);
  return t;
}
function seeded(n) { let s = n; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/** Ríos de lava verticales que se repiten en altura (para que el scroll no corte). */
function lavaRivers(g, w, h, { n, wMin, wMax, colors, seed, blur = 6, wobble = 0.12 }) {
  const R = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x0 = R() * w, width = wMin + R() * (wMax - wMin);
    const f1 = 1 + Math.floor(R() * 3), f2 = 2 + Math.floor(R() * 3), ph = R() * 6.28;
    const grad = g.createLinearGradient(0, 0, w, 0);
    g.save();
    g.filter = `blur(${blur}px)`;
    for (const [col, k] of colors) {
      g.strokeStyle = col; g.lineWidth = width * k; g.lineCap = 'round';
      g.beginPath();
      for (let y = -10; y <= h + 10; y += 6) {
        const x = x0 + Math.sin((y / h) * Math.PI * 2 * f1 + ph) * w * wobble + Math.sin((y / h) * Math.PI * 2 * f2 + ph * 2) * w * wobble * 0.4;
        y === -10 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      // copia desplazada en X para que también repita a los lados
      g.save(); g.translate(x0 > w / 2 ? -w : w, 0); g.stroke(); g.restore();
    }
    g.restore();
    void grad;
  }
}

/** Manchas de lava blandas y alargadas (repetibles en vertical). */
function lavaBlobs(g, w, h, { n, seed, cols, rMin, rMax, stretch = 2.2, blur = 4 }) {
  const R = seeded(seed);
  g.save(); g.filter = `blur(${blur}px)`;
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rMin + R() * (rMax - rMin), col = cols[(R() * cols.length) | 0];
    g.fillStyle = col;
    for (const dy of [-h, 0, h]) for (const dx of [-w, 0, w]) {
      g.beginPath(); g.ellipse(x + dx, y + dy, r, r * stretch, (R() - 0.5) * 0.4, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}
/** Grietas finas y ramificadas (repetibles). */
function cracks(g, w, h, { n, seed, cols, width }) {
  const R = seeded(seed);
  for (const [col, k, blur] of cols) {
    g.save(); g.filter = `blur(${blur}px)`; g.strokeStyle = col; g.lineWidth = width * k; g.lineCap = 'round'; g.lineJoin = 'round';
    const R2 = seeded(seed);
    for (let i = 0; i < n; i++) {
      let x = R2() * w, y = R2() * h;
      const segs = 6 + ((R2() * 6) | 0);
      g.beginPath(); g.moveTo(x, y);
      for (let k2 = 0; k2 < segs; k2++) {
        x += (R2() - 0.5) * 22; y += 8 + R2() * 18;
        g.lineTo(x, y);
        if (R2() < 0.3) { const bx = x + (R2() - 0.5) * 30, by = y + R2() * 16; g.moveTo(bx, by); g.lineTo(x, y); }
      }
      g.stroke();
      g.save(); g.translate(0, -h); g.stroke(); g.restore();
    }
    g.restore();
  }
  void R;
}
function fireTex() {
  return canvasTex('fire_map2', 128, 512, (g, w, h) => {
    g.fillStyle = '#6a0c04'; g.fillRect(0, 0, w, h);
    lavaBlobs(g, w, h, { n: 34, seed: 5, cols: ['#9a1a06', '#c83008', '#e85a10'], rMin: 8, rMax: 18, stretch: 2.4, blur: 5 });
    lavaBlobs(g, w, h, { n: 26, seed: 9, cols: ['#ff8a1a', '#ffb030', '#ffd860'], rMin: 4, rMax: 9, stretch: 2.8, blur: 3 });
  });
}
function fireGlow() {
  return canvasTex('fire_glow2', 128, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    lavaBlobs(g, w, h, { n: 26, seed: 9, cols: ['#ff6a10', '#ffb030', '#ffe080'], rMin: 4, rMax: 9, stretch: 2.8, blur: 4 });
  });
}
function magmaTex() {
  return canvasTex('magma_map2', 128, 512, (g, w, h) => {
    g.fillStyle = '#0c0708'; g.fillRect(0, 0, w, h);
    const R = seeded(7);
    for (let i = 0; i < 110; i++) {
      const x = R() * w, y = R() * h, r = 7 + R() * 14;
      for (const dy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x - r * 0.3, y + dy - r * 0.3, 1, x, y + dy, r);
        gr.addColorStop(0, '#3a2c36'); gr.addColorStop(0.55, '#18101a'); gr.addColorStop(1, 'rgba(8,4,6,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y + dy, r, 0, Math.PI * 2); g.fill();
      }
    }
    cracks(g, w, h, { n: 11, seed: 31, width: 2.2, cols: [['#7a1404', 2.4, 2], ['#ff5a0a', 1.0, 0.6], ['#ffe070', 0.35, 0]] });
  });
}
function magmaGlow() {
  return canvasTex('magma_glow2', 128, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    cracks(g, w, h, { n: 11, seed: 31, width: 2.2, cols: [['#ff3a00', 2.0, 2.5], ['#ffd060', 0.6, 0.5]] });
  });
}
/** Capas de mago: tela con degradado, ribete dorado y emblema (no se repite). */
function mageTex(id) {
  return canvasTex('mage_' + id, 256, 512, (g, w, h) => {
    const C = {
      cape_achaman:   ['#0e2a6a', '#2a62c8', '#e8f2ff'],
      cape_magec:     ['#8a3a04', '#e8a020', '#fff4c0'],
      cape_chaxiraxi: ['#14401c', '#3a8a3a', '#e8f0d0'],
    }[id];
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, C[0]); bg.addColorStop(0.55, C[1]); bg.addColorStop(1, C[0]);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // pliegues
    for (let i = 0; i < 9; i++) { const x = (i + 0.5) * w / 9; const gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 14, 0, 28, h); }
    // ribete dorado
    g.strokeStyle = '#d8a83a'; g.lineWidth = 10; g.strokeRect(8, -10, w - 16, h - 2);
    g.strokeStyle = '#fff1a8'; g.lineWidth = 2; g.strokeRect(16, -10, w - 32, h - 18);
    for (let x = 24; x < w - 20; x += 22) { g.fillStyle = '#d8a83a'; g.beginPath(); g.moveTo(x, h - 14); g.lineTo(x + 11, h - 30); g.lineTo(x + 22, h - 14); g.fill(); }
    // emblema
    g.save(); g.translate(w / 2, h * 0.42);
    g.fillStyle = C[2]; g.strokeStyle = '#d8a83a'; g.lineWidth = 4;
    if (id === 'cape_achaman') {
      for (let i = 0; i < 40; i++) { const R = seeded(i + 3); g.globalAlpha = 0.6; g.fillRect((R() - 0.5) * w * 0.9, (R() - 0.6) * h * 0.8, 2.5, 2.5); }
      g.globalAlpha = 1;
      g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 22 : 62; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
    } else if (id === 'cape_magec') {
      g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill(); g.stroke();
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 42, Math.sin(a) * 42); g.lineTo(Math.cos(a) * (i % 2 ? 58 : 72), Math.sin(a) * (i % 2 ? 58 : 72)); g.lineWidth = i % 2 ? 4 : 7; g.strokeStyle = C[2]; g.stroke(); }
    } else {
      g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = C[1]; g.beginPath(); g.arc(18, -10, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = C[2];
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-26 + i * 12, 50 + i * 4, 4, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }, false);
}

// ------------------------------------------------------------
// Material con tela que ondea (uTime en el vertex shader)
// ------------------------------------------------------------
function swayMaterial(opts, amp, len = 1) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.userData.uTime = { value: 0 };
  m.userData.uBlow = { value: 0 };   // Sesión 51 — curva de la tela al moverse
  // Sesión 51 — choque con brazos y muslos (cápsulas en el espacio de la capa):
  // la tela se aparta alrededor del brazo en vez de dejar que lo atraviese.
  m.userData.uSegA = { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -999, 0)) };
  m.userData.uSegB = { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -999, 0)) };
  m.userData.uSegR = { value: new Array(6).fill(0) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = m.userData.uTime;
    sh.uniforms.uBlow = m.userData.uBlow;
    sh.uniforms.uSegA = m.userData.uSegA; sh.uniforms.uSegB = m.userData.uSegB; sh.uniforms.uSegR = m.userData.uSegR;
    sh.uniforms.uAmp = { value: amp };
    sh.uniforms.uLen = { value: len };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;\nuniform float uBlow;\nuniform float uLen;\nuniform vec3 uSegA[6];\nuniform vec3 uSegB[6];\nuniform float uSegR[6];\nattribute float hang;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = sin(uTime * 2.1 + hang * 5.0 + position.x * 0.04) * 0.6 + sin(uTime * 3.3 + hang * 9.0) * 0.4;
        transformed += objectNormal * sw * uAmp * hang * hang;
        transformed.y += hang * hang * uAmp * 0.25 * sin(uTime * 1.7);
        // Al moverse: la parte de ARRIBA sigue pegada a la espalda y solo el
        // vuelo de abajo se curva hacia atrás (como tela, no como una tabla)
        float hb = hang * hang;
        transformed.z -= uBlow * uLen * hb * 0.5;
        transformed.y += uBlow * uBlow * uLen * hb * hang * 0.17;
        // Brazos / muslos dentro de la tela → se aparta (hacia fuera y atrás)
        for (int i = 0; i < 6; i++) {
          float r = uSegR[i];
          if (r <= 0.0) continue;
          vec3 sa = uSegA[i], ab = uSegB[i] - sa;
          float st = clamp(dot(transformed - sa, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          vec3 cpt = sa + ab * st;
          vec3 dv = transformed - cpt;
          float dl = length(dv);
          if (dl < r) {
            vec3 dir = dl > 1e-4 ? dv / dl : vec3(0.0, 0.0, -1.0);
            if (dir.z > 0.2) dir = normalize(dir + vec3(0.0, 0.0, -1.4));
            transformed = cpt + dir * mix(r, dl, smoothstep(0.0, r, dl) * 0.15);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'sway' + amp.toFixed(4);
  return m;
}

// ------------------------------------------------------------
// Gotas de magma (mundo), creadas desde el onBeforeRender de la capa
// ------------------------------------------------------------
let _dotTex = null;
function dotTex() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.35, 'rgba(255,120,20,0.95)'); gr.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}
function makeDrips(cape, hemPts) {
  const N = 40;
  const pos = new Float32Array(N * 3).fill(-9999);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, map: dotTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
  pts.frustumCulled = false;
  const drops = Array.from({ length: N }, () => ({ life: 0, v: 0, y0: 0 }));
  let last = now(), spawnAcc = 0, idx = 0;
  const tmp = new THREE.Vector3();
  pts.onBeforeRender = () => {
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    // la capa ya no se pinta (quitada / jugador fuera) → retirar
    if (t - (cape.userData.lastFrame || 0) > 1.0) { pts.parent?.remove(pts); g.dispose(); pts.material.dispose(); cape.userData.drips = null; return; }
    spawnAcc += dt * 9;
    while (spawnAcc > 1) {
      spawnAcc -= 1;
      const d = drops[idx], p = hemPts[(Math.random() * hemPts.length) | 0];
      const bl = cape.material?.userData?.uBlow?.value || 0, L = cape.userData.len || 0;
      tmp.copy(p); tmp.z -= bl * L * 0.5; tmp.y += bl * bl * L * 0.17;   // sigue la curva al moverse
      tmp.applyMatrix4(cape.matrixWorld);
      pos[idx * 3] = tmp.x; pos[idx * 3 + 1] = tmp.y; pos[idx * 3 + 2] = tmp.z;
      d.life = 0.9 + Math.random() * 0.4; d.v = 0; d.y0 = tmp.y;
      idx = (idx + 1) % N;
    }
    for (let i = 0; i < N; i++) {
      const d = drops[i];
      if (d.life <= 0) { pos[i * 3 + 1] = -9999; continue; }
      d.life -= dt; d.v += 9.8 * dt;
      pos[i * 3 + 1] -= d.v * dt;
      if (d.y0 - pos[i * 3 + 1] > 2.2) d.life = 0;
    }
    g.attributes.position.needsUpdate = true;
  };
  return pts;
}

// ------------------------------------------------------------
// Constructor
// ------------------------------------------------------------
/**
 * Sesión 51 — Caja de la armadura del torso (piezas con userData.armorSlot
 * 'body') en el marco de la capa (hueso Spine2 + basis), solo la franja de
 * alturas [y0, y1]. null si no lleva armadura.
 */
function armorBounds(root, sp2, basis, y0, y1) {
  const objs = [];
  // solo lo que va pegado al tronco y hombros (los brazos se mueven y la ensancharían)
  root.traverse(o => { if (o.userData?.armorSlot === 'body' && /(Spine|Neck|Shoulder|Hips)\d*$/.test(o.parent?.name || '')) objs.push(o); });
  if (!objs.length) return null;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().multiplyMatrices(sp2.matrixWorld, basis).invert();
  const pts = [];
  const v = new THREE.Vector3(), bb = new THREE.Box3(), m = new THREE.Matrix4();
  for (const o of objs) o.traverse(c => {
    if (!c.isMesh || !c.geometry) return;
    if (c.isInstancedMesh) { c.computeBoundingBox(); bb.copy(c.boundingBox); }
    else { if (!c.geometry.boundingBox) c.geometry.computeBoundingBox(); bb.copy(c.geometry.boundingBox); }
    if (bb.isEmpty()) return;
    m.multiplyMatrices(inv, c.matrixWorld);
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m);
      if (v.y >= y0 && v.y <= y1) pts.push(v.clone());
    }
  });
  if (!pts.length) return null;
  return {
    minZ: Math.min(...pts.map(p => p.z)),
    halfW: (cx) => Math.max(...pts.map(p => Math.abs(p.x - cx))),
    maxYBack: (cz) => { const b = pts.filter(p => p.z < cz); return b.length ? Math.max(...b.map(p => p.y)) : -Infinity; },
  };
}

/** Ancestro directo de la escena (el objeto que el juego mueve y gira). */
function topOf(o) {
  let t = o;
  while (t.parent && !t.parent.isScene) t = t.parent;
  return t.parent ? t : null;
}

/**
 * Geometría de capa: rejilla u (izq→der) × v (arriba→abajo).
 * Sección = arco de elipse que envuelve la espalda; arriba abraza los
 * hombros (±100°) y abajo cae por detrás (±74°) y se abre.
 */
function clothGeometry(R, len, itemId) {
  const NU = 34, NV = 26;
  const magma = itemId === 'cape_magma';
  const pos = [], uv = [], hang = [], idx = [];
  const hemPts = [];
  const lerp = (a, b, k) => a + (b - a) * k;
  const at = (u, v, out) => {
    const sgn = u * 2 - 1;                                  // -1 … 1
    const ve = Math.pow(v, 0.8);
    const th = sgn * lerp(1.74, 1.29, Math.pow(v, 0.6));    // ±100° → ±74°
    const a = R * lerp(0.98, 1.28, ve);                     // ancho
    const b = R * lerp(0.95, 1.2, ve);                     // fondo
    // pliegues: nada arriba, profundos abajo
    const fold = 1 + 0.1 * Math.pow(v, 1.1) * Math.sin(th * 7.5 + 0.6) + 0.035 * Math.pow(v, 1.4) * Math.sin(th * 13 + 1.7);
    const x = Math.sin(th) * a * fold;
    const z = -Math.cos(th) * b * fold;
    // arriba: cae sobre los hombros (esquinas redondeadas); abajo: esquinas redondeadas
    const yTop = len / 2 - len * 0.11 * Math.pow(Math.abs(sgn), 2.2);
    let yBot = -len / 2 + len * 0.2 * Math.pow(Math.abs(sgn), 4);
    if (magma) yBot -= len * 0.05 * Math.abs(Math.sin(th * 9));
    else yBot -= len * 0.012 * Math.sin(th * 14);
    const y = lerp(yTop, yBot, v);
    return (out || new THREE.Vector3()).set(x, y, z);
  };
  const tmp = new THREE.Vector3();
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      at(u, v, tmp);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(u, 1 - v);
      hang.push(v);
      if (j === NV && i % 3 === 0) hemPts.push(tmp.clone());
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + NU + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('hang', new THREE.Float32BufferAttribute(hang, 1));
  geo.setIndex(idx);
  return { geo, hem: hemPts, topAt: (sgn) => at((sgn + 1) / 2, 0) };
}

export function buildCape(itemId, H, root) {
  const sp2 = H.findBone(root, 'Spine2');
  if (!sp2) return null;
  const basis = H.spineFrame(root, sp2, 'Neck');
  const box = H.fitBox(H.boneVerts(root, [sp2], sp2), basis);
  if (!box) return null;
  const tn = H.tune('cape');
  const h = box.max.y - box.min.y;
  const rz = (box.max.z - box.min.z) / 2;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const isMage = itemId === 'cape_achaman' || itemId === 'cape_magec' || itemId === 'cape_chaxiraxi';
  // Medidas SIN armadura (como antes)
  let R = (box.max.x - box.min.x) / 2 * 1.22 * tn.s * 1.08;      // radio arriba
  let axisZ = cz + rz * 0.15;
  let top = box.max.y + h * 0.05;
  // Sesión 51 — CON armadura: la capa cuelga por fuera de ella (hombreras,
  // escamas de la espalda…). Se mide la armadura del torso en este marco.
  const arm = armorBounds(root, sp2, basis, top - h * 1.3, top + h * 0.6);
  if (arm) {
    const halfW = Math.min(R * 0.95 * 1.7, Math.max(R * 0.95, arm.halfW(cx) * 1.06));
    const backZ = Math.max(axisZ - R - h * 0.9, Math.min(axisZ - R, arm.minZ - h * 0.05));
    R = halfW / 0.95;
    axisZ = Math.min(axisZ, backZ + R);
    top = Math.max(top, Math.min(arm.maxYBack(cz), top + h * 0.45));
  }
  const len = h * (itemId === 'cape_magma' ? 4.4 : 4.0) * tn.s;   // S51: más cortas (×2)
  const rx = R / 1.08;   // (para las piezas de abajo: broches, gotas)
  // Sesión 51 — forma de TELA (ya no medio tubo, que parecía un escudo):
  // nace estrecha en el cuello, cae sobre los hombros con las esquinas de
  // arriba redondeadas, se abre hacia abajo con pliegues y el bajo tiene las
  // esquinas redondeadas (magma: en picos).
  const { geo, hem, topAt } = clothGeometry(R, len, itemId);
  const p = geo.attributes.position;
  const hang = geo.attributes.hang.array;
  geo.computeVertexNormals();
  const amp = len * 0.035;
  let mat;
  if (itemId === 'cape_fuego') {
    const map = fireTex(), em = fireGlow();
    mat = swayMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.75 }, amp, len);
  } else if (itemId === 'cape_magma') {
    const map = magmaTex(), em = magmaGlow();
    mat = swayMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.7, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.2 }, amp * 0.8, len);
  } else {
    mat = swayMaterial({ map: mageTex(itemId), side: THREE.DoubleSide, roughness: 0.85 }, amp * 1.1, len);
  }
  const cape = new THREE.Mesh(geo, mat);
  cape.userData.len = len;
  // Pivote en la línea de hombros: la capa CUELGA (gravedad) aunque el torso se incline
  const pivot = new THREE.Group();
  pivot.position.set(cx, top, axisZ + (tn.z || 0) * h);
  cape.position.set(0, -len / 2, 0);
  pivot.add(cape);
  const _q = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _d = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  // Sesión 51 — la capa ya no sigue los giros del torso (en combate el pecho
  // gira y la capa quedaba de lado): cuelga siempre recta hacia ABAJO y por
  // DETRÁS del personaje según hacia dónde mira el cuerpo entero (root), y
  // se va hacia atrás al correr.
  const _rq = new THREE.Quaternion(), _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _x = new THREE.Vector3();
  // Sesión 51 — cápsulas de brazos y muslos (radio en metros de mundo, medido ya)
  const segs = [];
  {
    const bw = (n) => H.findBone(root, n);
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    root.updateMatrixWorld(true);
    const armored = !!arm;
    for (const side of ['Left', 'Right']) {
      const A = bw(side + 'Arm'), F = bw(side + 'ForeArm'), Hd = bw(side + 'Hand');
      const U = bw(side + 'UpLeg'), L = bw(side + 'Leg');
      if (A && F) {
        const la = wp(A).distanceTo(wp(F));
        segs.push({ a: A, b: F, r: la * (armored ? 0.42 : 0.32) });
        if (Hd) segs.push({ a: F, b: Hd, r: la * (armored ? 0.36 : 0.26) });
      }
      if (U && L) segs.push({ a: U, b: L, r: wp(U).distanceTo(wp(L)) * (armored ? 0.3 : 0.24) });
    }
  }
  const _inv = new THREE.Matrix4(), _sv = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0), _rp = new THREE.Vector3(), _tilt = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);
  let frontRoot = null, lastRootPos = null, speedS = 0;
  cape.frustumCulled = false; cape.castShadow = true;
  // Animación: tiempo del ondeo + scroll de la lava (map lento, brillo rápido)
  const hemPts = itemId === 'cape_magma' ? hem : [];
  cape.onBeforeRender = (renderer, scene) => {
    const t = now();
    const dtC = Math.min(0.1, t - (cape.userData.lastFrame || t));
    cape.userData.lastFrame = t;
    if (pivot.parent && root) {
      // "Delante" del cuerpo en coordenadas del root (se calcula una vez)
      // El modelo mira hacia +Z de su root (igual que asume la armadura)
      // "Delante" = el +Z del objeto del personaje que el juego gira al andar
      // (player.rotation.y = atan2(dx, dz)), así los giros del torso o de las
      // caderas en las posturas de combate no tuercen la capa.
      if (!frontRoot) {
        const top = topOf(root);
        if (top) { frontRoot = new THREE.Vector3(0, 0, 1); frontRoot.userData = top; }
      }
      if (!frontRoot) return;
      frontRoot.userData.getWorldQuaternion(_rq);
      _f.copy(frontRoot).applyQuaternion(_rq);
      _f.y = 0;
      if (_f.lengthSq() > 1e-6) {
        _f.normalize();
        _x.crossVectors(_up, _f).normalize();
        _m.makeBasis(_x, _up, _f);
        _qt.setFromRotationMatrix(_m);                 // marco "recto" mirando al frente
        // Al correr la capa se va hacia atrás
        root.getWorldPosition(_rp);
        if (lastRootPos && dtC > 0) {
          const v = Math.hypot(_rp.x - lastRootPos.x, _rp.z - lastRootPos.z) / dtC;
          speedS += (Math.min(v, 8) - speedS) * Math.min(1, dtC * 4);
        }
        lastRootPos = (lastRootPos || new THREE.Vector3()).copy(_rp);
        // Si el torso se inclina hacia delante (posturas de combate, correr),
        // la capa sigue la línea de la espalda en vez de meterse en el cuerpo.
        pivot.parent.getWorldQuaternion(_q);
        const spUp = _d.set(0, 1, 0).applyQuaternion(_q);
        const lean = Math.asin(Math.max(-1, Math.min(1, spUp.dot(_f))));
        // S51 — solo un poco rígida (sigue la espalda); el resto es curva (uBlow)
        const tilt = Math.max(0.06 + Math.min(0.1, speedS * 0.015), lean + 0.1);
        _tilt.setFromAxisAngle(_ax, Math.min(0.85, tilt));
        mat.userData.uBlow.value = Math.min(0.42, speedS * 0.06);
        _qt.multiply(_tilt);
        // Pasar al espacio del padre del pivote
        pivot.parent.getWorldQuaternion(_q);
        _qt.premultiply(_q.invert());
        pivot.quaternion.slerp(_qt, Math.min(1, dtC * 8));   // con un poco de retraso, como la tela
      }
    }
    mat.userData.uTime.value = t;
    if (segs.length) {
      _inv.copy(cape.matrixWorld).invert();
      const sc = cape.matrixWorld.getMaxScaleOnAxis() || 1;
      const A = mat.userData.uSegA.value, B = mat.userData.uSegB.value, Rr = mat.userData.uSegR.value;
      for (let i = 0; i < 6; i++) {
        const sg = segs[i];
        if (!sg) { Rr[i] = 0; continue; }
        A[i].copy(sg.a.getWorldPosition(_sv)).applyMatrix4(_inv);
        B[i].copy(sg.b.getWorldPosition(_sv)).applyMatrix4(_inv);
        Rr[i] = sg.r / sc;
      }
    }
    if (mat.map && mat.map.wrapT === THREE.RepeatWrapping) {
      const speed = itemId === 'cape_magma' ? 0.05 : 0.08;
      mat.map.offset.y = (t * speed) % 1;
      if (mat.emissiveMap) mat.emissiveMap.offset.y = (t * speed * 1.9) % 1;
      mat.emissiveIntensity = (itemId === 'cape_magma' ? 1.5 : 0.9) + Math.sin(t * 2.3) * 0.25;
    }
    if (itemId === 'cape_magma' && !cape.userData.drips && scene) {
      cape.userData.drips = makeDrips(cape, hemPts);
      scene.add(cape.userData.drips);
    }
  };
  const g = H.framed(basis);
  g.add(pivot);
  // Broches en los hombros (gema según la capa)
  const gemCol = { cape_fuego: 0xffa030, cape_magma: 0xff4a10, cape_achaman: 0x7ab8ff, cape_magec: 0xffd040, cape_chaxiraxi: 0x80e080 }[itemId];
  const gemMat = new THREE.MeshStandardMaterial({ color: gemCol, emissive: gemCol, emissiveIntensity: 1.4, roughness: 0.2 });
  const ringMat = new THREE.MeshStandardMaterial({ color: isMage ? 0xd8a83a : 0x2a0c08, metalness: 0.6, roughness: 0.35 });
  // Broches donde la tela se sujeta (las puntas de arriba de la capa)
  for (const sx of [-1, 1]) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(rx * 0.14, 1), gemMat);
    gem.position.copy(topAt(sx * 0.9)); gem.position.y -= len / 2; gem.position.z += rx * 0.05;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rx * 0.17, rx * 0.04, 8, 20), ringMat);
    ring.position.copy(gem.position);
    pivot.add(gem, ring);
  }
  return [{ bone: sp2, mesh: g }];
}
