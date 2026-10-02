/**
 * SebasPresent — Efectos de los ataques especiales (Sesión 51)
 *
 * Todo procedural (sin texturas externas): ondas de choque, columna de luz,
 * círculo rúnico, chispas, cascotes, grietas, estela del arma y temblor de
 * cámara. Pensado para el "Juicio del Teide" (salto con giro + golpe al suelo
 * estilo espadón de Armadyl) y el resto de especiales.
 *
 * API:
 *   start({ scene })
 *   update(dt)                        — cada frame
 *   applyShake(camera)                — después de actualizar la cámara
 *   slam(pos, palette)                — golpe al suelo
 *   trail(getSeg, ms, palette)        — estela; getSeg() → [base, punta] (mundo)
 *   slashes(pos, n, palette, yaw)     — zarpazos/tajos en el objetivo
 *   heal(getPos, palette)             — chispas que suben alrededor
 *   burst(pos, palette)               — estallido mágico (bastones)
 *   PALETTES[...]
 */
import * as THREE from 'three';

let _scene = null;
const _live = [];          // { t, dur, update(t, dt) → false para terminar, dispose() }
let _shake = 0, _shakeT = 0;
const _tmp = new THREE.Vector3();

export const PALETTES = {
  teiderio:  { core: 0xffffff, main: 0x6fffe6, glow: 0x1fd8c0, spark: 0xfff2a0, light: 0x9ffff0, crack: 0x40ffe0 },
  obsidiana: { core: 0xf0e0ff, main: 0xa36bff, glow: 0x5a20c0, spark: 0xd8b0ff, light: 0xb080ff, crack: 0x9a50ff },
  basaltita: { core: 0xfff0c0, main: 0xff7a2a, glow: 0xc02a00, spark: 0xffd060, light: 0xff9040, crack: 0xff5010 },
  oro:       { core: 0xffffff, main: 0xffd050, glow: 0xd09010, spark: 0xfff0a0, light: 0xffe080, crack: 0xffc030 },
  dragon:    { core: 0xfff0c0, main: 0xff5a10, glow: 0xa01008, spark: 0xffb040, light: 0xff6020, crack: 0xff3000 },
  heal:      { core: 0xffffff, main: 0x70ff90, glow: 0x20c050, spark: 0xd0ffd0, light: 0x80ff90, crack: 0x40ff60 },
  arcane:    { core: 0xffffff, main: 0x7ab0ff, glow: 0x3050ff, spark: 0xc0d8ff, light: 0x8ab0ff, crack: 0x5080ff },
  // Sesión 51 — armas legendarias y bastón de Dragomante
  achaman:   { core: 0xffffff, main: 0x9ad8ff, glow: 0x3a8aff, spark: 0xfff4c0, light: 0xbfe6ff, crack: 0xffe080 },
  tibicena:  { core: 0xfff0d0, main: 0xd09040, glow: 0x6a3a10, spark: 0xffd090, light: 0xffb060, crack: 0xc06010 },
  magec:     { core: 0xffffff, main: 0xffc030, glow: 0xff7a00, spark: 0xfff0a0, light: 0xffd060, crack: 0xffa020 },
  guayota:   { core: 0xffe0c0, main: 0xff3a10, glow: 0x600400, spark: 0xff8040, light: 0xff4a1a, crack: 0xff2a00 },
  tindaya:   { core: 0xffffff, main: 0x90f0b0, glow: 0x208050, spark: 0xd0ffe0, light: 0xa0ffc0, crack: 0x50d080 },
  dragomante:{ core: 0xffd0d0, main: 0xd01020, glow: 0x500008, spark: 0xff6060, light: 0xff2030, crack: 0xa00010 },
  guayotaCube: { core: 0xff9050, main: 0x2a0c14, glow: 0xc02000, spark: 0xff6020, light: 0xff4a1a, crack: 0xff3000 },   // bloque de obsidiana
  entangle:  { core: 0xe0ffd0, main: 0x50c040, glow: 0x205a10, spark: 0xb0ff90, light: 0x80ff60, crack: 0x40a030 },
};

export function start({ scene }) { _scene = scene; }

/** Paleta según el material del arma (sword_teiderio_2h → teiderio). */
export function paletteFor(itemId) {
  const mat = String(itemId || '').replace(/_2h$/, '').split('_').pop();
  return PALETTES[mat] || PALETTES.oro;
}

/** Punto de impacto: delante del jugador, hacia el objetivo. */
export function impactPoint(p, target) {
  if (!p) return null;
  if (!target || !Number.isFinite(target.x)) return { x: p.x, y: 0, z: p.z };
  const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz) || 1;
  const k = Math.min(1.3, d * 0.6);
  return { x: p.x + dx / d * k, y: 0, z: p.z + dz / d * k };
}

/**
 * Especial de espadón de OTRO jugador: giro + salto procedural sobre su
 * modelo y golpe al suelo al llegar a impactMs.
 */
export function peerSlam(group, palette, target, impactMs = 1046, noSlam = false) {
  if (!group) return;
  let model = null;
  for (const c of group.children) { let sk = false; c.traverse(o => { if (o.isSkinnedMesh) sk = true; }); if (sk) { model = c; break; } }
  const by = model ? model.position.y : 0, br = model ? model.rotation.y : 0;
  const T = impactMs / 1000;
  add({
    t: 0, dur: T,
    update(t) {
      if (!model) return;
      const k = Math.min(1, t / T);
      const hk = Math.max(0, (k - 0.3) / 0.7);
      model.position.y = by + Math.sin(Math.PI * hk) * 0.6;
      model.rotation.y = br + Math.min(1, k / 0.8) * Math.PI * 2;
    },
    dispose() {
      if (model) { model.position.y = by; model.rotation.y = br; }
      if (!noSlam) slam(impactPoint(group.position, target), palette);
    },
  });
}

function add(fx) { _live.push(fx); return fx; }

export function update(dt) {
  for (let i = _live.length - 1; i >= 0; i--) {
    const fx = _live[i];
    fx.t += dt;
    let alive = true;
    try { alive = fx.update(fx.t, dt) !== false && fx.t < fx.dur; } catch { alive = false; }
    if (!alive) { try { fx.dispose(); } catch {} _live.splice(i, 1); }
  }
  if (_shakeT > 0) _shakeT = Math.max(0, _shakeT - dt);
}

export function shake(amount = 0.25, secs = 0.4) { _shake = Math.max(_shake * (_shakeT > 0 ? 1 : 0), amount); _shakeT = Math.max(_shakeT, secs); }
export function applyShake(camera) {
  if (_shakeT <= 0 || !camera) return;
  const k = _shake * Math.min(1, _shakeT / 0.3);
  camera.position.x += (Math.random() - 0.5) * k;
  camera.position.y += (Math.random() - 0.5) * k * 0.6;
  camera.position.z += (Math.random() - 0.5) * k;
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
const addMat = (color, opacity = 1, extra = {}) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, ...extra,
});
function disposeObj(o) {
  o.traverse?.(c => { c.geometry?.dispose?.(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); } });
  o.parent?.remove(o);
}

// Textura de círculo rúnico (canvas, cacheada)
let _runeTex = null;
function runeTexture() {
  if (_runeTex) return _runeTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(248, 6); ring(232, 2); ring(170, 4); ring(150, 2); ring(60, 3);
  // hexagrama
  g.lineWidth = 3;
  for (const off of [0, Math.PI / 3]) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) { const a = off + i * (Math.PI * 2 / 3) - Math.PI / 2; const x = Math.cos(a) * 168, y = Math.sin(a) * 168; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // runas en el anillo exterior
  g.font = 'bold 26px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    g.save(); g.rotate(a); g.fillText(RUNES[i % RUNES.length], 0, -201); g.restore();
  }
  // marcas
  g.lineWidth = 2;
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; const r0 = i % 6 ? 236 : 226; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * 246, Math.sin(a) * 246); g.stroke(); }
  _runeTex = new THREE.CanvasTexture(c);
  _runeTex.colorSpace = THREE.SRGBColorSpace;
  return _runeTex;
}

// Textura de chispa (punto suave)
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

// Columna de luz: shader con degradado vertical y ondas
function pillarMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uT: { value: 0 }, uA: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uT; uniform float uA; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.06, vUv.y + 0.02);
        float bands = 0.65 + 0.35 * sin(vUv.y * 40.0 - uT * 18.0) * sin(vUv.x * 6.2831 * 3.0 + uT * 4.0);
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0) * 0.0;
        gl_FragColor = vec4(uColor * (1.15 * bands), fade * uA * edge);
      }`,
  });
}

// ------------------------------------------------------------
// GOLPE AL SUELO (espadones)
// ------------------------------------------------------------
export function slam(pos, palette = PALETTES.teiderio, power = 1) {
  if (!_scene) return;
  const P = palette;
  const root = new THREE.Group();
  root.position.set(pos.x, (pos.y || 0) + 0.04, pos.z);
  _scene.add(root);

  // Destello de luz
  const light = new THREE.PointLight(P.light, 0, 16 * power, 1.6);
  light.position.y = 1.2;
  root.add(light);

  // Columna de luz (núcleo + halo)
  const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.85, 16, 32, 1, true).translate(0, 8, 0), pillarMaterial(P.main));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 16, 20, 1, true).translate(0, 8, 0), pillarMaterial(P.core));
  root.add(pil, core);

  // Ondas de choque
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 96), addMat(i === 1 ? P.core : P.main, 1));
    r.rotation.x = -Math.PI / 2; r.position.y = 0.03 + i * 0.01; r.scale.setScalar(0.01);
    root.add(r); rings.push({ m: r, delay: i * 0.1, max: (5.5 - i * 1.2) * power });
  }
  // Disco de destello en el suelo
  const flash = new THREE.Mesh(new THREE.CircleGeometry(2.4 * power, 48), addMat(P.glow, 0.6));
  flash.rotation.x = -Math.PI / 2; flash.position.y = 0.02;
  root.add(flash);

  // Círculo rúnico que gira
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(5.2 * power, 5.2 * power), addMat(P.main, 0, { map: runeTexture() }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.05;
  root.add(rune);

  // Grietas en el suelo (líneas quebradas que brillan)
  const cracks = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * Math.PI * 2 + Math.random() * 0.3;
    let x = 0, z = 0, a = a0;
    const segs = 4 + (Math.random() * 3 | 0);
    for (let k = 0; k < segs; k++) {
      const len = (0.35 + Math.random() * 0.35) * power;
      a += (Math.random() - 0.5) * 0.7;
      const nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
      const w = 0.07 * (1 - k / segs) + 0.015;
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.05, w), addMat(P.crack, 1));
      seg.rotation.x = -Math.PI / 2; seg.rotation.z = -a;
      seg.position.set((x + nx) / 2, 0.035, (z + nz) / 2);
      cracks.add(seg);
      x = nx; z = nz;
    }
  }
  root.add(cracks);

  // Chispas (Points)
  const N = Math.round(90 * power);
  const sp = new Float32Array(N * 3), sv = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
    sp.set([0, 0.2, 0], i * 3);
    sv.push(new THREE.Vector3(Math.cos(a) * s * 0.6, 3 + Math.random() * 7, Math.sin(a) * s * 0.6));
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: P.spark, size: 0.22, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  root.add(sparks);

  // Motas que suben por la columna
  const M = 40;
  const mp = new Float32Array(M * 3), mv = [];
  for (let i = 0; i < M; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 1.1; mp.set([Math.cos(a) * r, Math.random() * 0.5, Math.sin(a) * r], i * 3); mv.push(2 + Math.random() * 5); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: P.core, size: 0.16, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  root.add(motes);

  // Cascotes
  const rocks = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a3e34, roughness: 0.9, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(0.09, 0);
  for (let i = 0; i < Math.round(22 * power); i++) {
    const m = new THREE.Mesh(rockGeo, rockMat);
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
    m.position.set(Math.cos(a) * 0.4, 0.1, Math.sin(a) * 0.4);
    m.scale.setScalar(0.6 + Math.random() * 1.4);
    root.add(m);
    rocks.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }

  shake(0.32 * power, 0.5);

  add({
    t: 0, dur: 2.6,
    update(t, dt) {
      // luz
      light.intensity = t < 0.06 ? (t / 0.06) * 26 * power : 26 * power * Math.exp(-(t - 0.06) * 5);
      // columna
      const pa = t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.9);
      pil.material.uniforms.uT.value = t; core.material.uniforms.uT.value = t;
      pil.material.uniforms.uA.value = pa * 0.6; core.material.uniforms.uA.value = pa * 0.85;
      const wq = t < 0.1 ? 0.3 + t * 7 : Math.max(0.05, 1 - (t - 0.1) * 0.9);
      pil.scale.set(wq, Math.min(1, t * 9), wq); core.scale.set(wq, Math.min(1, t * 12), wq);
      // ondas
      for (const r of rings) {
        const k = Math.max(0, t - r.delay) / 0.6;
        if (k <= 0) continue;
        const e = 1 - Math.pow(1 - Math.min(1, k), 3);
        r.m.scale.setScalar(0.2 + e * r.max);
        r.m.material.opacity = Math.max(0, 1 - k);
      }
      flash.material.opacity = Math.max(0, 0.6 - t * 1.6);
      flash.scale.setScalar(1 + t * 1.5);
      // runas
      rune.rotation.z += dt * 1.2;
      rune.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 1.3);
      const rs = 0.85 + Math.min(1, t * 3) * 0.15; rune.scale.setScalar(rs);
      // grietas
      cracks.children.forEach(c => { c.material.opacity = t < 1.2 ? 1 : Math.max(0, 1 - (t - 1.2) / 1.2); });
      // chispas
      const p = sg.attributes.position;
      for (let i = 0; i < N; i++) {
        const v = sv[i]; v.y -= 14 * dt; v.multiplyScalar(0.985);
        let y = p.getY(i) + v.y * dt; if (y < 0.03) { y = 0.03; v.y *= -0.3; }
        p.setXYZ(i, p.getX(i) + v.x * dt, y, p.getZ(i) + v.z * dt);
      }
      p.needsUpdate = true;
      sparks.material.opacity = Math.max(0, 1 - Math.max(0, t - 0.9) / 1.0);
      // motas
      const q = mg.attributes.position;
      for (let i = 0; i < M; i++) { q.setY(i, q.getY(i) + mv[i] * dt); }
      q.needsUpdate = true;
      motes.material.opacity = Math.max(0, 1 - t / 1.8);
      // cascotes
      for (const r of rocks) {
        r.v.y -= 16 * dt;
        r.m.position.addScaledVector(r.v, dt);
        if (r.m.position.y < 0.05) { r.m.position.y = 0.05; r.v.y *= -0.35; r.v.x *= 0.6; r.v.z *= 0.6; r.w.multiplyScalar(0.6); }
        r.m.rotation.x += r.w.x * dt; r.m.rotation.y += r.w.y * dt;
        if (t > 1.6) r.m.scale.multiplyScalar(0.94);
      }
    },
    dispose() { disposeObj(root); rockMat.dispose(); rockGeo.dispose(); },
  });
}

// ------------------------------------------------------------
// ESTELA DEL ARMA (cinta que sigue a la hoja)
// ------------------------------------------------------------
export function trail(getSeg, ms = 800, palette = PALETTES.teiderio) {
  if (!_scene) return;
  const N = 28;
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 4);
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  _scene.add(mesh);
  const hist = [];
  const cMain = new THREE.Color(palette.main), cCore = new THREE.Color(palette.core);
  add({
    t: 0, dur: ms / 1000 + 0.35,
    update(t) {
      const seg = t < ms / 1000 ? getSeg?.() : null;
      if (seg) hist.unshift([seg[0].clone(), seg[1].clone()]);
      else if (hist.length) hist.pop();
      if (hist.length > N) hist.length = N;
      if (hist.length < 2) { mesh.visible = false; return; }
      mesh.visible = true;
      for (let i = 0; i < N; i++) {
        const h = hist[Math.min(i, hist.length - 1)];
        const k = i / (N - 1);
        const a = Math.max(0, 1 - k) * (i < hist.length ? 1 : 0);
        pos.set(h[0].toArray(), i * 6); pos.set(h[1].toArray(), i * 6 + 3);
        const c = cCore.clone().lerp(cMain, Math.min(1, k * 2));
        col.set([c.r, c.g, c.b, a * 0.25], i * 8); col.set([c.r, c.g, c.b, a * 0.95], i * 8 + 4);
      }
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      g.computeBoundingSphere();
    },
    dispose() { disposeObj(mesh); },
  });
}

// ------------------------------------------------------------
// TAJOS / ZARPAZOS sobre el objetivo
// ------------------------------------------------------------
let _slashGeo = null;
function slashGeo() {
  if (_slashGeo) return _slashGeo;
  // media luna: anillo parcial que adelgaza en las puntas
  const g = new THREE.RingGeometry(0.75, 1, 40, 1, -1.1, 2.2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i); const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const w = Math.cos(a / 1.1 * Math.PI / 2);   // 1 en el centro, 0 en las puntas
    const nr = 1 - (1 - r) * Math.max(0.05, w);
    p.setXY(i, Math.cos(a) * nr, Math.sin(a) * nr);
  }
  _slashGeo = g;
  return g;
}
export function slashes(pos, n = 2, palette = PALETTES.dragon, yaw = 0) {
  if (!_scene) return;
  const root = new THREE.Group();
  root.position.set(pos.x, (pos.y || 0) + 1.1, pos.z);
  root.rotation.y = yaw;
  _scene.add(root);
  const items = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(slashGeo(), addMat(i % 2 ? palette.core : palette.main, 0));
    m.rotation.z = (i % 2 ? 1 : -1) * (0.5 + i * 0.25) + Math.PI / 2;
    m.position.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4, 0.2);
    m.scale.setScalar(0.01);
    root.add(m);
    items.push({ m, delay: i * 0.12 });
  }
  add({
    t: 0, dur: 0.4 + n * 0.12 + 0.2,
    update(t) {
      for (const it of items) {
        const k = (t - it.delay) / 0.28;
        if (k < 0) continue;
        it.m.scale.setScalar(0.5 + Math.min(1, k) * 0.9);
        it.m.material.opacity = k < 0.2 ? k / 0.2 : Math.max(0, 1 - (k - 0.2) / 0.8);
        it.m.rotation.z += 0.08;
      }
    },
    dispose() { disposeObj(root); },
  });
  shake(0.08 * n, 0.25);
}

// ------------------------------------------------------------
// CURACIÓN: chispas verdes que suben en espiral alrededor del jugador
// ------------------------------------------------------------
export function heal(getPos, palette = PALETTES.heal) {
  if (!_scene) return;
  const N = 46;
  const p = new Float32Array(N * 3), seed = [];
  for (let i = 0; i < N; i++) seed.push({ a: Math.random() * Math.PI * 2, r: 0.4 + Math.random() * 0.4, s: 0.8 + Math.random() * 1.4, d: Math.random() * 0.5 });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: palette.main, size: 0.18, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  _scene.add(pts);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 48), addMat(palette.main, 0.8));
  ring.rotation.x = -Math.PI / 2;
  _scene.add(ring);
  add({
    t: 0, dur: 1.6,
    update(t) {
      const c = getPos?.() || _tmp.set(0, 0, 0);
      for (let i = 0; i < N; i++) {
        const s = seed[i]; const k = Math.max(0, t - s.d);
        const a = s.a + k * 3;
        p[i * 3] = c.x + Math.cos(a) * s.r; p[i * 3 + 1] = (c.y || 0) + 0.1 + k * s.s; p[i * 3 + 2] = c.z + Math.sin(a) * s.r;
      }
      g.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - Math.max(0, t - 0.8) / 0.8);
      ring.position.set(c.x, (c.y || 0) + 0.05 + t * 1.2, c.z);
      ring.scale.setScalar(1 + t * 0.3);
      ring.material.opacity = Math.max(0, 0.8 - t * 0.6);
    },
    dispose() { disposeObj(pts); disposeObj(ring); },
  });
}

// ------------------------------------------------------------
// ESTALLIDO MÁGICO (bastones): círculo rúnico vertical + esfera que revienta
// ------------------------------------------------------------
export function burst(pos, palette = PALETTES.arcane, delayMs = 0) {
  if (!_scene) return;
  const go = () => {
    const root = new THREE.Group();
    root.position.set(pos.x, (pos.y || 0) + 1.0, pos.z);
    _scene.add(root);
    const sph = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 3), addMat(palette.main, 0.9));
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), addMat(palette.core, 1));
    root.add(sph, core);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), addMat(palette.main, 0, { map: runeTexture() }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = -0.95;
    root.add(rune);
    const light = new THREE.PointLight(palette.light, 25, 10, 1.6);
    root.add(light);
    add({
      t: 0, dur: 1.0,
      update(t, dt) {
        const k = Math.min(1, t / 0.35);
        sph.scale.setScalar(0.3 + k * 2.4); sph.material.opacity = Math.max(0, 0.9 * (1 - k));
        core.scale.setScalar(0.5 + k * 1.2); core.material.opacity = Math.max(0, 1 - k * 1.2);
        rune.rotation.z += dt * 2.5; rune.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.8);
        light.intensity = 25 * Math.exp(-t * 6);
      },
      dispose() { disposeObj(root); },
    });
    shake(0.12, 0.25);
  };
  if (delayMs > 0) setTimeout(go, delayMs); else go();
}


// ------------------------------------------------------------
// Sesión 51 — BLOQUE DE HIELO / SANGRE / OBSIDIANA (congelación)
//   getPos() → posición actual del objetivo (o un objeto {x,z} fijo)
// ------------------------------------------------------------
export function iceCube(getPos, ms = 8000, palette = PALETTES.dragomante, size = 1) {
  if (!_scene) return;
  const pos0 = typeof getPos === 'function' ? getPos() : getPos;
  if (!pos0) return;
  const root = new THREE.Group();
  _scene.add(root);
  const W = 1.25 * size, H = 2.1 * size;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, W, 2, 3, 2).translate(0, H / 2, 0), new THREE.MeshStandardMaterial({
    color: palette.main, emissive: palette.glow, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
  }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, W).translate(0, H / 2, 0)), new THREE.LineBasicMaterial({ color: palette.core, transparent: true, opacity: 0.9 }));
  root.add(body, edges);
  // Cristales que salen de las caras y del suelo
  const crystMat = new THREE.MeshStandardMaterial({ color: palette.main, emissive: palette.glow, emissiveIntensity: 0.8, roughness: 0.1, transparent: true, opacity: 0.75 });
  const crystals = [];
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.09 + Math.random() * 0.1, 0.4 + Math.random() * 0.6, 5), crystMat);
    const a = Math.random() * Math.PI * 2, r = W * (0.5 + Math.random() * 0.25);
    c.position.set(Math.cos(a) * r, Math.random() * 0.4, Math.sin(a) * r);
    c.rotation.set((Math.random() - 0.5) * 0.9, 0, Math.cos(a) * 0.6 * (Math.random() > 0.5 ? 1 : -1));
    c.scale.setScalar(0.01);
    root.add(c); crystals.push(c);
  }
  const light = new THREE.PointLight(palette.light, 0, 5, 1.6);
  light.position.y = H * 0.5;
  root.add(light);
  const T = ms / 1000;
  const shards = [];
  let shattered = false;
  add({
    t: 0, dur: T + 0.9,
    update(t, dt) {
      const p = (typeof getPos === 'function' ? getPos() : getPos) || pos0;
      root.position.set(p.x, (p.y || 0), p.z);
      const grow = Math.min(1, t / 0.25);
      body.scale.set(1, grow, 1); edges.scale.set(1, grow, 1);
      crystals.forEach((c, i) => c.scale.setScalar(Math.min(1, Math.max(0.01, (t - i * 0.015) / 0.2))));
      light.intensity = t < T ? 3 + Math.sin(t * 6) * 0.8 : 0;
      body.material.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.15;
      if (t >= T && !shattered) {
        shattered = true;
        body.visible = false; edges.visible = false; crystals.forEach(c => (c.visible = false));
        const g = new THREE.TetrahedronGeometry(0.16, 0);
        for (let i = 0; i < 22; i++) {
          const m = new THREE.Mesh(g, crystMat);
          m.position.set((Math.random() - 0.5) * W, Math.random() * H, (Math.random() - 0.5) * W);
          root.add(m);
          shards.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5) });
        }
        shake(0.06, 0.15);
      }
      for (const sh of shards) {
        sh.v.y -= 12 * dt; sh.m.position.addScaledVector(sh.v, dt);
        sh.m.rotation.x += dt * 8; sh.m.scale.multiplyScalar(0.96);
      }
    },
    dispose() { disposeObj(root); crystMat.dispose(); },
  });
}

// ------------------------------------------------------------
// Sesión 51 — ORBES DE DRENAJE: del objetivo al jugador (curación por daño)
// ------------------------------------------------------------
export function drainOrbs(from, getTo, palette = PALETTES.dragomante, n = 10, delayMs = 0) {
  if (!_scene || !from) return;
  const N = n;
  const p = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: palette.main, size: 0.32, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  const seeds = Array.from({ length: N }, () => ({ d: Math.random() * 0.35, h: 0.6 + Math.random() * 1.2, w: (Math.random() - 0.5) * 1.6 }));
  const D = delayMs / 1000;
  _scene.add(pts);
  add({
    t: 0, dur: D + 1.4,
    update(t) {
      const to = (typeof getTo === 'function' ? getTo() : getTo) || from;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        const k = Math.min(1, Math.max(0, (t - D - s.d) / 0.8));
        const e = k * k * (3 - 2 * k);
        const x = from.x + (to.x - from.x) * e + Math.sin(e * Math.PI) * s.w;
        const z = from.z + (to.z - from.z) * e + Math.cos(e * Math.PI) * s.w * 0.5;
        const y = 1.0 + Math.sin(e * Math.PI) * s.h;
        p.set([x, k <= 0 ? -100 : y, z], i * 3);
      }
      g.attributes.position.needsUpdate = true;
      pts.material.opacity = t > D + 1.0 ? Math.max(0, 1 - (t - D - 1.0) / 0.4) : 1;
    },
    dispose() { disposeObj(pts); },
  });
}

// ============================================================
// Sesión 51 — Especiales propios de cada arma legendaria
// ============================================================
PALETTES.vesta = { core: 0xfff0ff, main: 0xb050ff, glow: 0x5a10b0, spark: 0xe0a0ff, light: 0xa040ff, crack: 0x9a40ff };

/** Rayo quebrado (lista de puntos) entre a y b, con desvío `j`. */
function zigzag(a, b, segs, j) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const p = new THREE.Vector3().lerpVectors(a, b, k);
    if (i > 0 && i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
    pts.push(p);
  }
  return pts;
}
/** Tubo fino a lo largo de puntos (para rayos). */
function boltMesh(pts, radius, color, opacity = 1) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 3, radius, 6, false), addMat(color, opacity));
}
function points(n, color, size, blending = THREE.AdditiveBlending, opacity = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dotTexture(), transparent: true, depthWrite: false, blending, opacity }));
  m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------
// DESCENSO (Espadón de Tibicena): un espadón gigante de sombra y bronce
// cae del cielo sobre el objetivo y lo aplasta (llega en `ms`).
// ------------------------------------------------------------
export function descend(getPos, P = PALETTES.tibicena, ms = 1046) {
  if (!_scene) return;
  const T = ms / 1000;
  const root = new THREE.Group();
  _scene.add(root);
  // Hoja gigante (rombo alargado) apuntando hacia abajo
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(0.55, 1.4); shape.lineTo(0.42, 6.5); shape.lineTo(0, 7.2); shape.lineTo(-0.42, 6.5); shape.lineTo(-0.55, 1.4); shape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 }).translate(0, 0, -0.09);
  const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: P.glow, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0 }));
  const edge = new THREE.Mesh(bladeGeo, addMat(P.main, 0)); edge.scale.setScalar(1.08);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.7, roughness: 0.3, emissive: P.glow, emissiveIntensity: 0.6, transparent: true, opacity: 0 }));
  guard.position.y = 7.35;
  const sword = new THREE.Group(); sword.add(blade, edge, guard);
  root.add(sword);
  // Sombra que se agranda en el suelo
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; root.add(shadow);
  // Estela de humo oscuro detrás de la hoja
  const smoke = points(40, 0x1a0e06, 0.9, THREE.NormalBlending, 0.6); root.add(smoke);
  const sp = smoke.geometry.attributes.position;
  let landed = false;
  add({
    t: 0, dur: T + 0.9,
    update(t) {
      const c = getPos?.() || _tmp.set(0, 0, 0);
      root.position.set(c.x, (c.y || 0), c.z);
      const k = Math.min(1, t / T);
      const fall = k * k * k;                       // acelera al caer
      const y = 16 * (1 - fall);
      sword.position.set(0, y - 1.2 * fall, 0);
      sword.rotation.y = (1 - k) * 2.5;
      const op = Math.min(1, t / 0.25);
      blade.material.opacity = op; guard.material.opacity = op; edge.material.opacity = 0.5 * op;
      shadow.material.opacity = 0.15 + 0.45 * k; shadow.scale.setScalar(0.4 + k * 0.9);
      for (let i = 0; i < 40; i++) sp.setXYZ(i, (Math.random() - 0.5) * 0.8, sword.position.y + 7 + Math.random() * 4 * (1 - k), (Math.random() - 0.5) * 0.8);
      sp.needsUpdate = true; smoke.material.opacity = 0.6 * (1 - k);
      if (!landed && k >= 1) {
        landed = true;
        slam({ x: c.x, y: 0, z: c.z }, P, 1.35);
        shake(0.6, 0.6);
      }
      if (landed) {
        const f = Math.max(0, 1 - (t - T) / 0.9);
        blade.material.opacity = f; guard.material.opacity = f; edge.material.opacity = 0.5 * f; shadow.material.opacity = 0.6 * f;
      }
    },
    dispose() { disposeObj(root); },
  });
}

// ------------------------------------------------------------
// SÚPER RAYO (Espada de Tindaya): rayo morado que sale del arma al objetivo,
// crepita y se rehace cada instante, con llamas NEGRAS a lo largo y en el impacto.
// ------------------------------------------------------------
export function beam(getFrom, getTo, P = PALETTES.vesta, ms = 900) {
  if (!_scene) return;
  const root = new THREE.Group(); _scene.add(root);
  const light = new THREE.PointLight(P.light, 30, 12, 1.4); root.add(light);
  const bolts = new THREE.Group(); root.add(bolts);
  // Llamas negras (humo denso) + ascuas moradas
  const NB = 160, black = points(NB, 0x08000c, 0.8, THREE.NormalBlending, 0.9);
  const NE = 60, embers = points(NE, P.spark, 0.16);
  root.add(black, embers);
  const bs = [], es = [];
  for (let i = 0; i < NB; i++) bs.push({ k: Math.random(), life: Math.random(), v: 0.6 + Math.random() * 1.4, off: new THREE.Vector3() });
  for (let i = 0; i < NE; i++) es.push({ k: Math.random(), life: Math.random(), v: 1 + Math.random() * 2 });
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  let nextZap = 0, burstDone = false;
  shake(0.15, 0.5);
  const T = ms / 1000;
  add({
    t: 0, dur: T + 0.6,
    update(t, dt) {
      const f = getFrom?.(), to = getTo?.();
      if (f) A.set(f.x, (f.y || 0) + 1.3, f.z);
      if (to) B.set(to.x, (to.y || 0) + 1.0, to.z);
      const on = t < T;
      light.position.lerpVectors(A, B, 0.5); light.intensity = on ? 22 + Math.random() * 18 : Math.max(0, 22 * (1 - (t - T) / 0.4));
      if (on && t >= nextZap) {
        nextZap = t + 0.05;
        for (const b of [...bolts.children]) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); }
        const segs = Math.max(8, Math.round(A.distanceTo(B) * 2.2));
        bolts.add(boltMesh(zigzag(A, B, segs, 0.6), 0.32, P.glow, 0.55));
        bolts.add(boltMesh(zigzag(A, B, segs, 0.5), 0.17, P.main, 0.85));
        bolts.add(boltMesh(zigzag(A, B, segs, 0.3), 0.07, P.core, 1));
        for (let i = 0; i < 2; i++) {           // ramas
          const k = 0.2 + Math.random() * 0.6, s = new THREE.Vector3().lerpVectors(A, B, k);
          const e = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.3) * 1.8, (Math.random() - 0.5) * 2.4));
          bolts.add(boltMesh(zigzag(s, e, 5, 0.5), 0.03, P.spark, 0.9));
        }
      }
      if (!on && bolts.children.length) for (const b of [...bolts.children]) { b.material.opacity *= 0.7; if (b.material.opacity < 0.05) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); } }
      if (!burstDone && t > T * 0.35 && to) { burstDone = true; burst(to, P, 0); }
      // llamas negras: nacen a lo largo del rayo y suben ondulando
      const bp = black.geometry.attributes.position;
      for (let i = 0; i < NB; i++) {
        const s = bs[i]; s.life += dt * s.v;
        if (s.life >= 1) { s.life = 0; s.k = Math.random() < 0.35 ? 0.85 + Math.random() * 0.15 : Math.random(); s.off.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5); }
        const p = _tmp.lerpVectors(A, B, s.k).add(s.off);
        bp.setXYZ(i, p.x + Math.sin(t * 9 + i) * 0.15, p.y - 0.2 + s.life * 1.6, p.z + Math.cos(t * 7 + i) * 0.15);
      }
      bp.needsUpdate = true;
      black.material.opacity = on ? 0.85 : Math.max(0, 0.85 * (1 - (t - T) / 0.6));
      black.material.size = 0.6 + 0.3 * Math.sin(t * 20);
      const ep = embers.geometry.attributes.position;
      for (let i = 0; i < NE; i++) {
        const s = es[i]; s.life += dt * s.v; if (s.life >= 1) { s.life = 0; s.k = Math.random(); }
        const p = _tmp.lerpVectors(A, B, s.k);
        ep.setXYZ(i, p.x + (Math.random() - 0.5) * 0.2, p.y + s.life * 1.6, p.z + (Math.random() - 0.5) * 0.2);
      }
      ep.needsUpdate = true;
      embers.material.opacity = on ? 1 : Math.max(0, 1 - (t - T) / 0.6);
    },
    dispose() { disposeObj(root); },
  });
}

// ------------------------------------------------------------
// FRENESÍ DE GARRAS: cuatro zarpazos alternando mano izquierda y derecha
// (en X), cada uno más rápido, y un desgarro final en cruz con salpicadura.
// ------------------------------------------------------------
export function clawFrenzy(pos, yaw = 0, P = PALETTES.dragon) {
  if (!_scene) return;
  const root = new THREE.Group();
  root.position.set(pos.x, (pos.y || 0) + 1.1, pos.z);
  root.rotation.y = yaw;
  _scene.add(root);
  const marks = [];
  const times = [0, 0.13, 0.24, 0.33];
  times.forEach((d, i) => {
    const g = new THREE.Group();
    const side = i % 2 ? 1 : -1;
    for (let k = 0; k < 4; k++) {               // 4 uñas por zarpazo
      const m = new THREE.Mesh(slashGeo(), addMat(k === 1 || k === 2 ? P.core : P.main, 0));
      m.scale.set(0.9, 0.9, 1); m.position.set((k - 1.5) * 0.11, 0, 0.25);
      g.add(m);
    }
    g.rotation.z = side * 0.75 + Math.PI / 2;
    g.userData.base = 1.5;
    root.add(g);
    marks.push({ g, d, side });
  });
  // Cruz final + salpicadura de chispas rojas
  const cross = new THREE.Group();
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.22), addMat(P.core, 0)); m.rotation.z = s * Math.PI / 4; cross.add(m); const h = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.6), addMat(P.main, 0)); h.rotation.z = s * Math.PI / 4; cross.add(h); }
  cross.position.z = 0.3; root.add(cross);
  const N = 60, sp = points(N, 0xff2a10, 0.2); root.add(sp);
  const sv = []; for (let i = 0; i < N; i++) { const a = Math.random() * 6.28; sv.push(new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 3), Math.random() * 3, 1 + Math.random() * 3)); }
  const light = new THREE.PointLight(P.light, 0, 8, 1.5); root.add(light);
  add({
    t: 0, dur: 1.3,
    update(t, dt) {
      for (const it of marks) {
        const k = (t - it.d) / 0.22;
        if (k < 0) continue;
        if (!it.hit) { it.hit = true; shake(0.12, 0.15); }
        it.g.children.forEach(m => { m.material.opacity = k < 0.25 ? k / 0.25 : Math.max(0, 1 - (k - 0.25) / 1.2); });
        it.g.scale.setScalar((0.6 + Math.min(1, k) * 0.8) * 1.5);
        it.g.rotation.z += it.side * 0.05;
      }
      const ck = (t - 0.45) / 0.3;
      if (ck > 0) {
        cross.children.forEach(m => { m.material.opacity = ck < 0.2 ? ck / 0.2 : Math.max(0, 1 - (ck - 0.2) / 1.6); });
        cross.scale.setScalar(0.5 + Math.min(1, ck) * 0.8);
        light.intensity = Math.max(0, 18 * (1 - (ck - 0.1)));
        const p = sp.geometry.attributes.position;
        for (let i = 0; i < N; i++) { const v = sv[i]; v.y -= 9 * dt; p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt); }
        p.needsUpdate = true; sp.material.opacity = Math.max(0, 1 - ck / 2.5);
        if (!cross.userData.shook) { cross.userData.shook = true; shake(0.3, 0.3); }
      } else sp.material.opacity = 0;
    },
    dispose() { disposeObj(root); },
  });
}

// ============================================================
// Sesión 51 (b) — UN EFECTO PROPIO PARA CADA ESPECIAL
// ============================================================

/** Ruido determinista (mismas costuras en geometrías con vértices repetidos). */
function hash3(x, y, z) { const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return h - Math.floor(h); }
function jitterGeo(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (hash3(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100)) - 0.5) * 2 * amt;
    const r = Math.hypot(x, z);
    if (r > 1e-4) { p.setX(i, x * (1 + k / Math.max(r, 0.3))); p.setZ(i, z * (1 + k / Math.max(r, 0.3))); }
  }
  geo.computeVertexNormals();
  return geo;
}
const easeOut = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeBack = (k) => { k = Math.min(1, Math.max(0, k)); const c = 2.2; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

/** Destello de pantalla (DOM) — color css, opacidad máxima, duración. */
export function screenFlash(color = 'rgba(220,170,255,1)', peak = 0.6, ms = 260, rampMs = 30) {
  if (typeof document === 'undefined') return;
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:40;background:${color};opacity:0;transition:opacity ${rampMs}ms linear`;
  document.body.appendChild(d);
  requestAnimationFrame(() => {
    d.style.opacity = String(peak);
    setTimeout(() => { d.style.transition = `opacity ${ms}ms ease-out`; d.style.opacity = '0'; }, rampMs + 10);
    setTimeout(() => d.remove(), rampMs + ms + 80);
  });
}

// ------------------------------------------------------------
// ALAS DE LUZ (Achamán): mientras saltas se abren dos alas enormes de
// plumas de luz a tu espalda; al golpear baten y se deshacen en plumas.
// ------------------------------------------------------------
let _featherGeo = null;
function featherGeo() {
  if (_featherGeo) return _featherGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.quadraticCurveTo(0.12, 0.25, 0.08, 0.8); sh.quadraticCurveTo(0.05, 0.97, 0, 1);
  sh.quadraticCurveTo(-0.05, 0.97, -0.08, 0.8); sh.quadraticCurveTo(-0.12, 0.25, 0, 0);
  _featherGeo = new THREE.ShapeGeometry(sh, 6);
  return _featherGeo;
}
export function wings(getPos, yaw = 0, ms = 1046, P = PALETTES.achaman) {
  if (!_scene) return;
  const root = new THREE.Group(); _scene.add(root);
  const light = new THREE.PointLight(P.light, 0, 9, 1.4); light.position.set(0, 1.6, -0.4); root.add(light);
  const sides = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * 0.22, 1.5, -0.3); w.rotation.y = -sx * 0.45; root.add(w);
    const fs = [];
    const N = 11;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const L = 0.9 + 1.9 * Math.sin(Math.PI * (0.15 + k * 0.7)) + k * 0.4;
      const m = new THREE.Mesh(featherGeo(), addMat(i % 3 === 0 ? P.core : (i % 3 === 1 ? P.main : P.light), 0));
      m.scale.set(1.3 + k * 0.6, L, 1);
      w.add(m);
      fs.push({ m, k, target: sx * (-0.12 - k * 1.95) });   // de casi vertical a casi horizontal hacia abajo
    }
    sides.push({ w, fs, sx });
  }
  const loose = points(60, P.core, 0.2); root.add(loose);
  const lv = []; for (let i = 0; i < 60; i++) lv.push(new THREE.Vector3());
  const T = ms / 1000;
  let flapped = false;
  add({
    t: 0, dur: T + 1.0,
    update(t, dt) {
      const c = getPos?.(); if (c) root.position.set(c.x, (c.y || 0), c.z);
      root.rotation.y = yaw;
      const open = easeBack(t / 0.38);
      const after = Math.max(0, t - T);
      for (const s of sides) {
        for (const f of s.fs) {
          let ang = f.target * open;
          if (after > 0) ang += -s.sx * Math.min(1, after / 0.18) * 0.9 * (1 - f.k * 0.4);   // batida
          f.m.rotation.z = ang;
          const o = t < 0.3 ? t / 0.3 : (after > 0 ? Math.max(0, 1 - after / 0.45) : 0.75 + 0.2 * Math.sin(t * 9 + f.k * 4));
          f.m.material.opacity = o * (0.55 + 0.45 * (1 - f.k * 0.5));
        }
        s.w.position.y = 1.5 + Math.sin(Math.min(1, t / T) * Math.PI) * 0.25;
      }
      light.intensity = t < T ? Math.min(1, t / 0.3) * 7 : Math.max(0, 7 * (1 - after / 0.5));
      if (!flapped && t >= T) {
        flapped = true;
        const p = loose.geometry.attributes.position;
        for (let i = 0; i < 60; i++) {
          const sx = i % 2 ? 1 : -1, a = Math.random();
          p.setXYZ(i, sx * (0.3 + a * 2.2), 1.2 + Math.random() * 2, -0.4 - Math.random() * 0.6);
          lv[i].set(sx * (1 + Math.random() * 2), 2 + Math.random() * 3, -Math.random() * 2);
        }
      }
      if (flapped) {
        const p = loose.geometry.attributes.position;
        for (let i = 0; i < 60; i++) { lv[i].multiplyScalar(0.97); p.setXYZ(i, p.getX(i) + lv[i].x * dt, p.getY(i) + lv[i].y * dt, p.getZ(i) + lv[i].z * dt); }
        p.needsUpdate = true;
        loose.material.opacity = Math.max(0, 1 - after / 1.0);
      } else loose.material.opacity = 0;
    },
    dispose() { disposeObj(root); },
  });
}

// ------------------------------------------------------------
// JUICIO DE ACHAMÁN (ascendente): una lanza de luz sale disparada del suelo
// hasta el cielo, un ciclón de anillos de viento sube girando, plumas en
// espiral y relámpagos que suben; arriba, un halo solar.
// ------------------------------------------------------------
export function ascend(pos, P = PALETTES.achaman) {
  if (!_scene) return;
  const root = new THREE.Group();
  root.position.set(pos.x, (pos.y || 0) + 0.04, pos.z);
  _scene.add(root);
  const light = new THREE.PointLight(P.light, 0, 26, 1.3); light.position.y = 4; root.add(light);
  // Lanza de luz al cielo
  const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 60, 20, 1, true).translate(0, 30, 0), pillarMaterial(P.core));
  const spearHalo = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 60, 24, 1, true).translate(0, 30, 0), pillarMaterial(P.main));
  root.add(spear, spearHalo);
  // Ciclón: anillos de viento que suben, se abren y giran
  const rings = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03 + (i % 2) * 0.02, 6, 72, Math.PI * 1.6), addMat(i % 2 ? P.core : P.main, 0));
    m.rotation.x = Math.PI / 2; root.add(m);
    rings.push({ m, d: i * 0.07, v: 6 + i * 0.7, spin: (i % 2 ? 1 : -1) * (5 + i) });
  }
  // Plumas en espiral
  const feathers = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(featherGeo(), addMat(i % 3 ? P.main : P.core, 0));
    m.scale.set(1.6, 0.5, 1);
    m.userData.s = { a: Math.random() * 6.28, r: 0.4 + Math.random() * 1.6, v: 3 + Math.random() * 6, d: Math.random() * 0.4, spin: (Math.random() - 0.5) * 8 };
    root.add(m); feathers.push(m);
  }
  // Polvo que entra en espiral hacia el centro
  const ND = 90, dust = points(ND, 0xe8e2d0, 0.22, THREE.NormalBlending, 0.7); root.add(dust);
  const dd = []; for (let i = 0; i < ND; i++) dd.push({ a: Math.random() * 6.28, r: 2 + Math.random() * 3, h: Math.random() * 0.3 });
  // Halo solar arriba
  const halo = new THREE.Group(); halo.position.y = 5.5; root.add(halo);
  const h1 = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 64), addMat(P.core, 0)); h1.rotation.x = -Math.PI / 2; halo.add(h1);
  const h2 = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.42, 64), addMat(P.spark, 0)); h2.rotation.x = -Math.PI / 2; halo.add(h2);
  for (let i = 0; i < 16; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.7).translate(0, 1.85, 0), addMat(P.spark, 0));
    ray.rotation.set(-Math.PI / 2, 0, (i / 16) * Math.PI * 2); h2.add(ray);
  }
  const bolts = new THREE.Group(); root.add(bolts);
  let nextBolt = 0;
  shake(0.35, 0.5);
  add({
    t: 0, dur: 2.6,
    update(t, dt) {
      light.intensity = t < 0.08 ? t * 600 : 48 * Math.exp(-(t - 0.08) * 2.4);
      // lanza: sube en 0.15 s, se ensancha y se apaga
      const g = Math.min(1, t / 0.15);
      const wv = 1 + Math.max(0, t - 0.15) * 2.2;
      const sa = t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.9);
      spear.scale.set(1 / wv * 1.4, g, 1 / wv * 1.4); spearHalo.scale.set(wv, g, wv);
      spear.material.uniforms.uT.value = -t * 2; spearHalo.material.uniforms.uT.value = -t * 2;
      spear.material.uniforms.uA.value = sa; spearHalo.material.uniforms.uA.value = sa * 0.45;
      for (const r of rings) {
        const k = t - r.d; if (k < 0) continue;
        r.m.position.y = 0.2 + k * r.v * Math.max(0.3, 1 - k * 0.35);
        const sc = 0.5 + k * 2.4; r.m.scale.set(sc, sc, 1);
        r.m.rotation.z += r.spin * dt;
        r.m.material.opacity = Math.min(1, k * 8) * Math.max(0, 1 - k / 1.3);
      }
      for (const m of feathers) {
        const s = m.userData.s, k = Math.max(0, t - s.d);
        const a = s.a + k * 3.4, r = s.r * (1 + k * 0.5);
        m.position.set(Math.cos(a) * r, k * s.v, Math.sin(a) * r);
        m.rotation.set(0.3, -a + s.spin * k, 0.5);
        m.material.opacity = k <= 0 ? 0 : Math.min(1, k * 6) * Math.max(0, 1 - k / 1.9);
      }
      const dp = dust.geometry.attributes.position;
      for (let i = 0; i < ND; i++) { const d = dd[i]; const r = Math.max(0.1, d.r - t * 2.6); const a = d.a + t * 4 / (0.4 + r * 0.3); dp.setXYZ(i, Math.cos(a) * r, d.h + Math.max(0, 2.5 - r) * t * 2.5, Math.sin(a) * r); }
      dp.needsUpdate = true; dust.material.opacity = 0.7 * Math.max(0, 1 - t / 1.6);
      if (t < 1.0 && t >= nextBolt) {
        nextBolt = t + 0.07;
        const a = Math.random() * 6.28, r = Math.random() * 1.4;
        const from = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 10 + Math.random() * 8, (Math.random() - 0.5) * 2.5));
        const b = boltMesh(zigzag(from, to, 10, 1.2), 0.045, P.core, 1); b.userData.born = t; bolts.add(b);
      }
      for (const b of [...bolts.children]) { const age = t - b.userData.born; b.material.opacity = Math.max(0, 1 - age / 0.22); if (age > 0.22) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); } }
      const hk = Math.max(0, t - 0.2);
      const ho = hk <= 0 ? 0 : Math.min(1, hk * 4) * Math.max(0, 1 - Math.max(0, hk - 1.2) / 0.8);
      halo.children.forEach(m => { m.material.opacity = ho; m.children.forEach(c => { c.material.opacity = ho * 0.8; }); });
      halo.position.y = 5.5 + hk * 0.6; h1.rotation.z += dt * 0.8; h2.rotation.z -= dt * 0.5;
      halo.scale.setScalar(0.6 + easeOut(hk / 0.5) * 0.6);
    },
    dispose() { disposeObj(root); },
  });
}

// ------------------------------------------------------------
// PRISIÓN DE GUAYOTA: el suelo se raja en grietas de lava, brotan pinchos
// de obsidiana en círculo que se cierran sobre el enemigo como una jaula,
// lenguas de fuego y humo negro.
// ------------------------------------------------------------
export function guayotaPrison(getPos, P = PALETTES.guayota) {
  if (!_scene) return;
  const root = new THREE.Group(); _scene.add(root);
  const place = () => { const c = typeof getPos === 'function' ? getPos() : getPos; if (c) root.position.set(c.x, (c.y || 0) + 0.03, c.z); };
  place();
  const light = new THREE.PointLight(0xff3a10, 0, 14, 1.4); light.position.y = 1.2; root.add(light);
  // Grietas de lava (anchas, con brillo)
  const cracks = new THREE.Group(); root.add(cracks);
  const crackPts = [];
  for (let i = 0; i < 8; i++) {
    let x = 0, z = 0, a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const segs = 5 + (Math.random() * 3 | 0);
    for (let k = 0; k < segs; k++) {
      const len = 0.35 + Math.random() * 0.4;
      a += (Math.random() - 0.5) * 0.8;
      const nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
      const w = 0.2 * (1 - k / segs) + 0.04;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.1, w * 2.6), addMat(0xff3000, 0));
      const core = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.05, w), addMat(0xffd060, 0));
      for (const m of [glow, core]) { m.rotation.x = -Math.PI / 2; m.rotation.z = -a; m.position.set((x + nx) / 2, 0.02 + (m === core ? 0.01 : 0), (z + nz) / 2); m.userData.d = k * 0.035; cracks.add(m); }
      crackPts.push(new THREE.Vector3(nx, 0, nz));
      x = nx; z = nz;
    }
  }
  // Pinchos de obsidiana en círculo, inclinados hacia dentro
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x140a10, emissive: 0x3a0400, emissiveIntensity: 1, metalness: 0.35, roughness: 0.18, flatShading: true });
  const rimMat = addMat(0xff2a00, 0.0);
  const spikes = [];
  const NS = 10;
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    const hgt = 2.2 + Math.random() * 1.0;
    const geo = jitterGeo(new THREE.ConeGeometry(0.3, hgt, 5, 2).translate(0, hgt / 2, 0), 0.05);
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
    piv.rotation.y = -a; // mirar al centro
    const spike = new THREE.Mesh(geo, spikeMat);
    const rim = new THREE.Mesh(geo, rimMat); rim.scale.setScalar(1.07);
    const tilt = new THREE.Group(); tilt.rotation.z = 0.42 + Math.random() * 0.12;   // hacia dentro
    tilt.add(spike, rim); piv.add(tilt); root.add(piv);
    spikes.push({ tilt, d: 0.04 + i * 0.025, hgt });
  }
  // Fuego (aditivo) y humo (normal)
  const NF = 150, fire = points(NF, 0xff6a20, 0.5); root.add(fire);
  const ff = []; for (let i = 0; i < NF; i++) ff.push({ life: Math.random(), v: 2 + Math.random() * 3, p: new THREE.Vector3() });
  const NK = 50, smoke = points(NK, 0x120808, 1.3, THREE.NormalBlending, 0.0); root.add(smoke);
  const kk = []; for (let i = 0; i < NK; i++) kk.push({ life: Math.random(), v: 0.6 + Math.random() * 0.8, a: Math.random() * 6.28, r: Math.random() * 1.4 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), addMat(0xc02000, 0)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.015; root.add(disc);
  shake(0.5, 0.6);
  try { screenFlash('rgba(255,60,10,1)', 0.25, 300); } catch {}
  const END = 2.6;
  add({
    t: 0, dur: END + 0.6,
    update(t, dt) {
      place();
      const out = Math.max(0, t - END);                     // se hunden al final
      light.intensity = (t < 0.1 ? t * 300 : 30) * (0.75 + Math.random() * 0.35) * Math.max(0, 1 - out / 0.5);
      cracks.children.forEach(m => { const k = t - m.userData.d; m.material.opacity = k <= 0 ? 0 : Math.min(1, k * 10) * (0.8 + 0.2 * Math.sin(t * 13 + m.position.x * 7)) * Math.max(0, 1 - Math.max(0, t - END + 0.4) / 0.8); });
      disc.material.opacity = Math.min(0.45, t * 3) * Math.max(0, 1 - Math.max(0, t - 1.2) / 1.6);
      for (const s of spikes) {
        const k = (t - s.d) / 0.16;
        const up = k <= 0 ? 0 : easeBack(k);
        s.tilt.position.y = -s.hgt * (1 - up) - out * s.hgt * 1.6;
        s.tilt.children[1].material.opacity = Math.max(0, 0.35 - Math.max(0, t - 0.4) * 0.12);
      }
      const fp = fire.geometry.attributes.position;
      for (let i = 0; i < NF; i++) {
        const f = ff[i]; f.life += dt * f.v * 0.6;
        if (f.life >= 1) { f.life = 0; const c = crackPts[(Math.random() * crackPts.length) | 0]; f.p.set(c.x * Math.random(), 0.05, c.z * Math.random()); }
        fp.setXYZ(i, f.p.x + Math.sin(t * 8 + i) * 0.08, f.p.y + f.life * 2.2, f.p.z + Math.cos(t * 7 + i) * 0.08);
      }
      fp.needsUpdate = true;
      fire.material.opacity = Math.min(1, t * 6) * Math.max(0, 1 - Math.max(0, t - END + 0.6) / 0.8);
      fire.material.size = 0.42 + 0.12 * Math.sin(t * 25);
      const kp = smoke.geometry.attributes.position;
      for (let i = 0; i < NK; i++) { const k = kk[i]; k.life += dt * k.v * 0.4; if (k.life >= 1) k.life = 0; kp.setXYZ(i, Math.cos(k.a) * k.r * (1 + k.life), 0.6 + k.life * 4.5, Math.sin(k.a) * k.r * (1 + k.life)); }
      kp.needsUpdate = true;
      smoke.material.opacity = Math.min(0.7, t * 2) * Math.max(0, 1 - Math.max(0, t - END + 0.6) / 1.0);
    },
    dispose() { disposeObj(root); spikeMat.dispose(); },
  });
}

// ------------------------------------------------------------
// JUICIO DEL TEIDE: una hilera de cristales de teiderio brota del suelo
// desde tu golpe hasta el enemigo y, bajo él, se alza un volcán en miniatura
// con vetas brillantes que ENTRA EN ERUPCIÓN.
// ------------------------------------------------------------
export function teideEruption(from, getTo, P = PALETTES.teiderio) {
  if (!_scene) return;
  const to0 = (typeof getTo === 'function' ? getTo() : getTo) || from;
  const root = new THREE.Group(); _scene.add(root);
  root.position.set(from.x, (from.y || 0), from.z);
  const dx = to0.x - from.x, dz = to0.z - from.z, dist = Math.hypot(dx, dz);
  const ux = dist > 0.01 ? dx / dist : 0, uz = dist > 0.01 ? dz / dist : 1;
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x40f0e0, emissive: 0x10b0a0, emissiveIntensity: 1.3, metalness: 0.1, roughness: 0.12, flatShading: true, transparent: true, opacity: 0.93 });
  const cGeo = new THREE.ConeGeometry(0.16, 1, 6).translate(0, 0.5, 0);
  // Hilera de cristales
  const crystals = [];
  const steps = Math.max(3, Math.round(dist / 0.42));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps * Math.max(0.2, (dist - 1.1) / Math.max(dist, 0.01));
    for (let j = 0; j < 3; j++) {
      const m = new THREE.Mesh(cGeo, crystalMat);
      const off = (Math.random() - 0.5) * 0.5;
      m.position.set(ux * dist * k - uz * off, 0, uz * dist * k + ux * off);
      m.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * 6, (Math.random() - 0.5) * 0.9);
      const hs = 0.5 + Math.random() * 0.9 + k * 0.5;
      m.scale.set(0.8 + Math.random() * 0.6, 0.001, 0.8 + Math.random() * 0.6);
      root.add(m);
      crystals.push({ m, d: i * 0.032 + j * 0.01, hs });
    }
  }
  const tReach = steps * 0.032 + 0.04;
  // Volcán en miniatura bajo el enemigo
  const vol = new THREE.Group(); vol.position.set(dx, 0, dz); root.add(vol);
  const coneGeo = jitterGeo(new THREE.ConeGeometry(1.7, 2.3, 10, 4, true).translate(0, 1.15, 0), 0.12);
  // boca del cráter: cortar la punta
  const cp = coneGeo.attributes.position; for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 1.9) cp.setY(i, 1.9);
  coneGeo.computeVertexNormals();
  const rock = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
  const veins = new THREE.Mesh(coneGeo, addMat(P.main, 0, { wireframe: true })); veins.scale.setScalar(1.012);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), addMat(P.core, 0)); mouth.rotation.x = -Math.PI / 2; mouth.position.y = 1.92;
  const volIn = new THREE.Group(); volIn.add(rock, veins, mouth); volIn.position.y = -2.4; vol.add(volIn);
  // Erupción: chorro de luz, fuente de chispas y bombas de cristal
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 12, 20, 1, true).translate(0, 6, 0), pillarMaterial(P.main)); jet.position.y = 1.9; vol.add(jet);
  const NF = 120, fount = points(NF, P.spark, 0.2); vol.add(fount);
  const fv = []; for (let i = 0; i < NF; i++) fv.push(new THREE.Vector3());
  const bombs = [];
  const bGeo = new THREE.DodecahedronGeometry(0.13, 0);
  for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(bGeo, crystalMat); m.visible = false; vol.add(m); bombs.push({ m, v: new THREE.Vector3() }); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 80), addMat(P.core, 0)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; vol.add(ring);
  const light = new THREE.PointLight(P.light, 0, 16, 1.4); light.position.y = 2.6; vol.add(light);
  const dust = points(60, 0x8a7a66, 0.45, THREE.NormalBlending, 0); root.add(dust);
  let erupted = false, shookLine = false;
  const tErupt = tReach + 0.32;
  add({
    t: 0, dur: tErupt + 2.4,
    update(t, dt) {
      const to = typeof getTo === 'function' ? getTo() : null;
      if (to) vol.position.set(to.x - from.x, 0, to.z - from.z);
      if (!shookLine && t > 0.02) { shookLine = true; shake(0.2, Math.max(0.3, tReach)); }
      const fade = Math.max(0, t - tErupt - 1.4);
      for (const c of crystals) {
        const k = (t - c.d) / 0.12;
        c.m.scale.y = k <= 0 ? 0.001 : c.hs * easeBack(k) * Math.max(0.001, 1 - fade / 0.7);
      }
      // volcán sube
      const vk = (t - tReach) / 0.22;
      volIn.position.y = vk <= 0 ? -2.4 : -2.4 * (1 - easeBack(vk)) - fade * 2.2;
      veins.material.opacity = vk <= 0 ? 0 : Math.min(0.4, vk) * (0.6 + 0.4 * Math.sin(t * 18));
      mouth.material.opacity = vk <= 0 ? 0 : Math.min(1, vk * 2);
      if (!erupted && t >= tErupt) {
        erupted = true; shake(0.55, 0.55);
        try { screenFlash('rgba(150,255,240,1)', 0.22, 260); } catch {}
        const p = fount.geometry.attributes.position;
        for (let i = 0; i < NF; i++) { p.setXYZ(i, 0, 2, 0); const a = Math.random() * 6.28, s = Math.random() * 2.6; fv[i].set(Math.cos(a) * s, 6 + Math.random() * 7, Math.sin(a) * s); }
        for (const b of bombs) { b.m.visible = true; b.m.position.set(0, 2, 0); const a = Math.random() * 6.28, s = 2 + Math.random() * 3.5; b.v.set(Math.cos(a) * s, 5 + Math.random() * 5, Math.sin(a) * s); b.m.scale.setScalar(0.8 + Math.random() * 1.6); }
      }
      const ek = erupted ? t - tErupt : -1;
      light.intensity = ek < 0 ? (vk > 0 ? 8 : 0) : (ek < 0.06 ? 60 : 60 * Math.exp(-(ek - 0.06) * 2.6));
      jet.material.uniforms.uT.value = -t * 2;
      jet.material.uniforms.uA.value = ek < 0 ? 0 : Math.max(0, 1 - ek / 0.9) * 0.9;
      jet.scale.set(1 + Math.max(0, ek) * 0.8, Math.min(1, Math.max(0, ek) / 0.12), 1 + Math.max(0, ek) * 0.8);
      if (erupted) {
        const p = fount.geometry.attributes.position;
        for (let i = 0; i < NF; i++) { const v = fv[i]; v.y -= 13 * dt; p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.05, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt); }
        p.needsUpdate = true; fount.material.opacity = Math.max(0, 1 - ek / 1.6);
        for (const b of bombs) { b.v.y -= 14 * dt; b.m.position.addScaledVector(b.v, dt); if (b.m.position.y < 0.08) { b.m.position.y = 0.08; b.v.multiplyScalar(0.3); } b.m.rotation.x += dt * 6; b.m.rotation.z += dt * 5; }
        ring.scale.setScalar(0.5 + easeOut(ek / 0.6) * 6.5); ring.material.opacity = Math.max(0, 1 - ek / 0.7);
      } else fount.material.opacity = 0;
      const dp = dust.geometry.attributes.position;
      if (t < 0.05) for (let i = 0; i < 60; i++) { const k = Math.random(); dp.setXYZ(i, ux * dist * k + (Math.random() - 0.5) * 0.8, 0.2, uz * dist * k + (Math.random() - 0.5) * 0.8); }
      for (let i = 0; i < 60; i++) dp.setY(i, dp.getY(i) + dt * 0.8);
      dp.needsUpdate = true; dust.material.opacity = Math.min(0.55, t * 3) * Math.max(0, 1 - t / 1.8);
    },
    dispose() { disposeObj(root); crystalMat.dispose(); cGeo.dispose(); bGeo.dispose(); },
  });
}

// ------------------------------------------------------------
// RAYO DEL CIELO (Tindaya) — ÉPICO: se forma una tormenta morada girando
// sobre el enemigo y cae un relámpago COLOSAL (tres latigazos), con destello
// de pantalla, cúpula de energía, columna de fuego negro y llamas moradas.
// El primer latigazo llega a SKYBOLT_STRIKE_MS.
// ------------------------------------------------------------
export const SKYBOLT_STRIKE_MS = 480;
let _swirlTex = null;
function swirlTexture() {
  if (_swirlTex) return _swirlTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const arm = 0.5 + 0.5 * Math.sin(a * 3 + r * 9);
    const noise = hash3(x * 0.37 | 0, y * 0.37 | 0, 1);
    const alpha = Math.max(0, 1 - r) ** 0.7 * (0.55 + 0.45 * arm) * (0.85 + 0.15 * noise);
    const v = 0.15 + 0.6 * arm * (1 - r);
    const i = (y * S + x) * 4;
    img.data[i] = 40 + 120 * v; img.data[i + 1] = 10 + 30 * v; img.data[i + 2] = 70 + 160 * v; img.data[i + 3] = Math.min(255, alpha * 255);
  }
  g.putImageData(img, 0, 0);
  _swirlTex = new THREE.CanvasTexture(c);
  _swirlTex.colorSpace = THREE.SRGBColorSpace;
  return _swirlTex;
}
export function skyBolt(getPos, P = PALETTES.vesta) {
  if (!_scene) return;
  const root = new THREE.Group(); _scene.add(root);
  const H = 30;
  const STRIKE = SKYBOLT_STRIKE_MS / 1000;
  // Tormenta girando arriba
  const storm = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: swirlTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  storm.rotation.x = Math.PI / 2; storm.position.y = H; root.add(storm);
  const storm2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: swirlTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, color: P.main }));
  storm2.rotation.x = Math.PI / 2; storm2.position.y = H - 0.5; root.add(storm2);
  const cloudLight = new THREE.PointLight(P.light, 0, 50, 1.2); cloudLight.position.y = H - 3; root.add(cloudLight);
  const light = new THREE.PointLight(P.light, 0, 70, 1.1); light.position.y = 4; root.add(light);
  const bolts = new THREE.Group(); root.add(bolts);
  const cloudBolts = new THREE.Group(); root.add(cloudBolts);
  // Impacto
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), addMat(P.main, 0));
  root.add(dome);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 120), addMat(P.core, 0)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; root.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 120), addMat(P.main, 0)); ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.045; root.add(ring2);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshBasicMaterial({ color: 0x0a0010, transparent: true, opacity: 0, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.025; root.add(scorch);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(5, 48), addMat(P.main, 0)); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; root.add(glow);
  const N = 140, sp = points(N, P.spark, 0.28); root.add(sp);
  const sv = []; for (let i = 0; i < N; i++) sv.push(new THREE.Vector3());
  const NB = 150, bk = points(NB, 0x07000c, 0.9, THREE.NormalBlending, 0); root.add(bk);
  const bv = []; for (let i = 0; i < NB; i++) bv.push({ a: Math.random() * 6.28, r: 0.2 + Math.random() * 1.3, v: 1.5 + Math.random() * 3, life: Math.random() });
  const NP = 80, pf = points(NP, P.main, 0.45); root.add(pf);
  const pv = []; for (let i = 0; i < NP; i++) pv.push({ x: (Math.random() - 0.5) * 4.5, z: (Math.random() - 0.5) * 4.5, life: Math.random(), v: 1 + Math.random() * 1.5 });
  const strikes = [STRIKE, STRIKE + 0.13, STRIKE + 0.3];
  let si = 0, lastStrike = -9, nextCloud = 0;
  const base = new THREE.Vector3();
  const zap = (big) => {
    for (const b of [...bolts.children]) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); }
    const top = new THREE.Vector3((Math.random() - 0.5) * 2, H, (Math.random() - 0.5) * 2);
    const bot = new THREE.Vector3(0, 0, 0);
    const j = big ? 3.2 : 2.4;
    bolts.add(boltMesh(zigzag(top, bot, 32, j * 1.1), big ? 1.5 : 1.0, P.glow, 0.42));
    bolts.add(boltMesh(zigzag(top, bot, 32, j * 0.85), big ? 0.7 : 0.45, P.main, 0.85));
    bolts.add(boltMesh(zigzag(top, bot, 32, j * 0.55), big ? 0.3 : 0.2, P.core, 1));
    for (let k = 0; k < 8; k++) {
      const t0 = 0.1 + Math.random() * 0.75, s = new THREE.Vector3().lerpVectors(top, bot, t0);
      const e = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, -3 - Math.random() * 9, (Math.random() - 0.5) * 14));
      bolts.add(boltMesh(zigzag(s, e, 10, 1.6), 0.1, P.spark, 0.9));
    }
    // rayos secundarios que caen alrededor
    for (let k = 0; k < (big ? 3 : 1); k++) {
      const a = Math.random() * 6.28, r = 3 + Math.random() * 5;
      const g0 = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      bolts.add(boltMesh(zigzag(new THREE.Vector3(g0.x * 0.4, H - 1, g0.z * 0.4), g0, 20, 2), 0.18, P.main, 0.8));
    }
    shake(big ? 1.0 : 0.6, 0.45);
    try { screenFlash(big ? 'rgba(235,200,255,1)' : 'rgba(190,120,255,1)', big ? 0.75 : 0.45, big ? 380 : 220); } catch {}
  };
  add({
    t: 0, dur: STRIKE + 2.6,
    update(t, dt) {
      const c = getPos?.(); if (c) { base.set(c.x, c.y || 0, c.z); root.position.copy(base); }
      // tormenta: aparece girando y se va al final
      const so = Math.min(1, t / STRIKE) * Math.max(0, 1 - Math.max(0, t - STRIKE - 1.2) / 1.0);
      storm.material.opacity = 0.95 * so; storm2.material.opacity = 0.55 * so;
      storm.rotation.z += dt * (1.2 + so * 1.5); storm2.rotation.z -= dt * 2.2;
      storm.scale.setScalar(0.5 + so * 0.5);
      cloudLight.intensity = t < STRIKE ? (Math.random() < 0.25 ? 40 + Math.random() * 60 : 6) : Math.max(0, cloudLight.intensity - dt * 120);
      if (t < STRIKE + 0.6 && t >= nextCloud) {
        nextCloud = t + 0.06;
        for (const b of [...cloudBolts.children]) { b.geometry.dispose(); b.material.dispose(); cloudBolts.remove(b); }
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * 6.28, r = 2 + Math.random() * 8;
          const s = new THREE.Vector3(Math.cos(a) * r, H - 0.6, Math.sin(a) * r);
          const e = new THREE.Vector3(Math.cos(a + 1) * r * 0.5, H - 1 - Math.random() * 2, Math.sin(a + 1) * r * 0.5);
          cloudBolts.add(boltMesh(zigzag(s, e, 8, 1.4), 0.08, P.spark, 0.9));
        }
      }
      if (t > STRIKE + 0.6 && cloudBolts.children.length) for (const b of [...cloudBolts.children]) { b.geometry.dispose(); b.material.dispose(); cloudBolts.remove(b); }
      if (si < strikes.length && t >= strikes[si]) {
        zap(si === 0); lastStrike = t; si++;
        if (si === 1) {
          for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 9; sv[i].set(Math.cos(a) * s, 4 + Math.random() * 10, Math.sin(a) * s); }
          const p = sp.geometry.attributes.position; for (let i = 0; i < N; i++) p.setXYZ(i, 0, 0.3, 0);
        }
      }
      const since = t - lastStrike;
      const on = si > 0 && since < 0.1;
      bolts.children.forEach(b => { const o = (b.material.userData.o ??= b.material.opacity); b.material.opacity = on ? o * (0.75 + Math.random() * 0.25) : Math.max(0, b.material.opacity - dt * 5); });
      light.intensity = on ? 300 + Math.random() * 200 : Math.max(0, light.intensity - dt * 900);
      const ik = si > 0 ? t - STRIKE : -1;
      if (ik >= 0) {
        dome.scale.set(0.5 + easeOut(ik / 0.55) * 7, 0.5 + easeOut(ik / 0.55) * 5, 0.5 + easeOut(ik / 0.55) * 7);
        dome.material.opacity = Math.max(0, 0.55 * (1 - ik / 0.6));
        ring.scale.setScalar(0.3 + easeOut(ik / 0.7) * 11); ring.material.opacity = Math.max(0, 1 - ik / 0.8);
        ring2.scale.setScalar(0.3 + easeOut(ik / 1.0) * 7); ring2.material.opacity = Math.max(0, 0.8 - ik / 1.1);
        glow.material.opacity = Math.max(0, 0.75 - ik * 0.7);
        scorch.material.opacity = Math.min(0.8, ik * 5) * Math.max(0, 1 - Math.max(0, ik - 1.6) / 0.8);
        const p = sp.geometry.attributes.position;
        for (let i = 0; i < N; i++) { const v = sv[i]; v.y -= 15 * dt; p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.03, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt); }
        p.needsUpdate = true; sp.material.opacity = Math.max(0, 1 - ik / 1.6);
        // columna de fuego negro en espiral
        const q = bk.geometry.attributes.position;
        for (let i = 0; i < NB; i++) { const b = bv[i]; b.life += dt * b.v * 0.35; if (b.life >= 1) b.life = 0; const h = b.life * 7, a = b.a + h * 1.3 + t * 2; q.setXYZ(i, Math.cos(a) * (b.r + h * 0.12), h, Math.sin(a) * (b.r + h * 0.12)); }
        q.needsUpdate = true; bk.material.opacity = Math.min(0.9, ik * 4) * Math.max(0, 1 - Math.max(0, ik - 1.3) / 0.8);
        bk.material.size = 0.8 + 0.25 * Math.sin(t * 17);
        // llamas moradas por el suelo
        const r = pf.geometry.attributes.position;
        for (let i = 0; i < NP; i++) { const f = pv[i]; f.life += dt * f.v; if (f.life >= 1) { f.life = 0; f.x = (Math.random() - 0.5) * 4.5; f.z = (Math.random() - 0.5) * 4.5; } r.setXYZ(i, f.x, f.life * 1.4, f.z); }
        r.needsUpdate = true; pf.material.opacity = Math.min(1, ik * 4) * Math.max(0, 1 - Math.max(0, ik - 1.2) / 0.9);
      } else { sp.material.opacity = 0; bk.material.opacity = 0; pf.material.opacity = 0; }
    },
    dispose() { disposeObj(root); },
  });
}

// ------------------------------------------------------------
// GARRAS DE MAGMA: cuatro zarpazos de lava (cada uno más grande, en X)
// que dejan surcos incandescentes y gotean magma; al final las marcas
// estallan y el enemigo ARDE unos segundos (la quemadura del 20 %).
// ------------------------------------------------------------
export function magmaClaws(getPos, yaw = 0) {
  if (!_scene) return;
  const P = PALETTES.basaltita;
  const root = new THREE.Group(); _scene.add(root);
  const front = new THREE.Group(); front.rotation.y = yaw; front.position.y = 1.1; root.add(front);
  const place = () => { const c = typeof getPos === 'function' ? getPos() : getPos; if (c) root.position.set(c.x, c.y || 0, c.z); };
  place();
  const light = new THREE.PointLight(0xff6a10, 0, 9, 1.4); light.position.y = 1.2; root.add(light);
  const times = [0, 0.14, 0.27, 0.38];
  const marks = times.map((d, i) => {
    const g = new THREE.Group();
    const side = i % 2 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const crust = new THREE.Mesh(slashGeo(), new THREE.MeshBasicMaterial({ color: 0x1a0602, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      crust.scale.set(1.05, 1.35, 1); crust.position.set((k - 1) * 0.17, 0, 0.27);
      const lava = new THREE.Mesh(slashGeo(), addMat(0xff4a08, 0)); lava.position.copy(crust.position); lava.position.z += 0.01;
      const core = new THREE.Mesh(slashGeo(), addMat(0xffe070, 0)); core.scale.set(0.95, 0.45, 1); core.position.copy(lava.position); core.position.z += 0.01;
      g.add(crust, lava, core);
    }
    g.rotation.z = side * 0.8 + Math.PI / 2;
    front.add(g);
    return { g, d, side, size: 1.25 + i * 0.25 };
  });
  // gotas de magma que caen de los surcos + ascuas
  const ND = 70, drips = points(ND, 0xff7a20, 0.16); root.add(drips);
  const dv = []; for (let i = 0; i < ND; i++) dv.push({ v: new THREE.Vector3(), born: -1 });
  let di = 0;
  // llamas sobre el enemigo (quemadura)
  const NF = 90, fl = points(NF, 0xff6a18, 0.42); root.add(fl);
  const ff = []; for (let i = 0; i < NF; i++) ff.push({ a: Math.random() * 6.28, r: 0.15 + Math.random() * 0.45, life: Math.random(), v: 1.2 + Math.random() * 1.6 });
  const NS = 30, sm = points(NS, 0x1a0c08, 0.9, THREE.NormalBlending, 0); root.add(sm);
  // estallido final (cruz de lava)
  const cross = new THREE.Group(); cross.position.set(0, 0, 0.32); front.add(cross);
  for (const sgn of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), addMat(0xff5a10, 0)); m.rotation.z = sgn * Math.PI / 4; cross.add(m); const c2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.16), addMat(0xfff0a0, 0)); c2.rotation.z = sgn * Math.PI / 4; cross.add(c2); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.8, 40), addMat(0xc02a00, 0)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03; root.add(disc);
  const BURN = 2.6;
  const tmp = new THREE.Vector3();
  add({
    t: 0, dur: 0.6 + BURN,
    update(t, dt) {
      place();
      for (const it of marks) {
        const k = (t - it.d) / 0.2;
        if (k < 0) continue;
        if (!it.hit) {
          it.hit = true; shake(0.14, 0.15);
          // soltar gotas desde el surco
          for (let n = 0; n < 14; n++) {
            const o = dv[di]; o.born = t;
            tmp.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            drips.geometry.attributes.position.setXYZ(di, tmp.x, 1.1 + tmp.y, tmp.z);
            o.v.set(tmp.x * 1.5, 1 + Math.random() * 2, tmp.z * 1.5);
            di = (di + 1) % ND;
          }
        }
        const op = k < 0.2 ? k / 0.2 : Math.max(0, 1 - (k - 0.2) / 2.2);
        it.g.children.forEach((m, j) => { m.material.opacity = (j % 3 === 0 ? 0.85 : 1) * op * (j % 3 === 2 ? 0.8 + 0.2 * Math.sin(t * 30) : 1); });
        it.g.scale.setScalar((0.55 + Math.min(1, k) * 0.45) * it.size);
      }
      // gotas
      const p = drips.geometry.attributes.position;
      for (let i = 0; i < ND; i++) { const o = dv[i]; if (o.born < 0) { p.setY(i, -99); continue; } o.v.y -= 10 * dt; p.setXYZ(i, p.getX(i) + o.v.x * dt, Math.max(0.04, p.getY(i) + o.v.y * dt), p.getZ(i) + o.v.z * dt); }
      p.needsUpdate = true; drips.material.opacity = Math.max(0, 1 - Math.max(0, t - 1.6) / 0.8);
      // estallido
      const ck = (t - 0.5) / 0.25;
      if (ck > 0) {
        if (!cross.userData.done) { cross.userData.done = true; shake(0.35, 0.3); try { screenFlash('rgba(255,90,20,1)', 0.2, 220); } catch {} }
        cross.children.forEach(m => { m.material.opacity = ck < 0.2 ? ck / 0.2 : Math.max(0, 1 - (ck - 0.2) / 1.4); });
        cross.scale.setScalar(0.6 + Math.min(1, ck) * 0.7);
        disc.material.opacity = Math.min(0.4, ck) * Math.max(0, 1 - Math.max(0, t - 0.5 - BURN + 0.6) / 0.6);
      }
      // quemadura: llamas y humo sobre el enemigo
      const bt = t - 0.5;
      const bo = bt <= 0 ? 0 : Math.min(1, bt * 4) * Math.max(0, 1 - Math.max(0, bt - BURN + 0.6) / 0.6);
      const fp = fl.geometry.attributes.position;
      for (let i = 0; i < NF; i++) { const f = ff[i]; f.life += dt * f.v; if (f.life >= 1) f.life = 0; const a = f.a + t * 2; fp.setXYZ(i, Math.cos(a) * f.r * (1 - f.life * 0.5), 0.2 + f.life * 2.2, Math.sin(a) * f.r * (1 - f.life * 0.5)); }
      fp.needsUpdate = true; fl.material.opacity = bo; fl.material.size = 0.36 + 0.1 * Math.sin(t * 24);
      const sp2 = sm.geometry.attributes.position;
      for (let i = 0; i < NS; i++) { const f = ff[i]; sp2.setXYZ(i, Math.cos(f.a) * 0.4, 1.8 + f.life * 1.8, Math.sin(f.a) * 0.4); }
      sp2.needsUpdate = true; sm.material.opacity = bo * 0.55;
      light.intensity = (t < 0.5 ? Math.min(1, t * 5) * 14 : 10 * bo + (ck > 0 && ck < 0.4 ? 30 : 0)) * (0.8 + Math.random() * 0.3);
    },
    dispose() { disposeObj(root); },
  });
}
