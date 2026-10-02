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
// ASCENSO (Espadón de Achamán): todo SUBE — tornado de viento y plumas de
// luz que se elevan girando, rayos que salen del suelo hacia el cielo y una
// columna que crece hacia arriba.
// ------------------------------------------------------------
export function ascend(pos, P = PALETTES.achaman) {
  if (!_scene) return;
  const root = new THREE.Group();
  root.position.set(pos.x, (pos.y || 0) + 0.04, pos.z);
  _scene.add(root);
  const light = new THREE.PointLight(P.light, 0, 18, 1.5); light.position.y = 2; root.add(light);
  // Columna que crece de abajo arriba
  const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 22, 32, 1, true).translate(0, 11, 0), pillarMaterial(P.main));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 22, 16, 1, true).translate(0, 11, 0), pillarMaterial(P.core));
  root.add(pil, core);
  // Tornado: 3 hélices de cinta que giran y suben
  const helices = [];
  for (let h = 0; h < 3; h++) {
    const pts = [];
    for (let i = 0; i <= 60; i++) { const k = i / 60, a = h * 2.094 + k * 9; const r = 0.4 + k * 1.6; pts.push(new THREE.Vector3(Math.cos(a) * r, k * 9, Math.sin(a) * r)); }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.05, 5, false), addMat(h === 1 ? P.core : P.main, 0.9));
    m.scale.y = 0.01; root.add(m); helices.push(m);
  }
  // Plumas de luz que suben en espiral
  const N = 70, feathers = [];
  const fGeo = new THREE.PlaneGeometry(0.12, 0.42);
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(fGeo, addMat(i % 3 ? P.main : P.core, 0));
    const s = { a: Math.random() * 6.28, r: 0.3 + Math.random() * 1.8, v: 3 + Math.random() * 6, d: Math.random() * 0.5, spin: (Math.random() - 0.5) * 8 };
    m.userData.s = s; root.add(m); feathers.push(m);
  }
  // Rayos del suelo al cielo
  const bolts = new THREE.Group(); root.add(bolts);
  let nextBolt = 0;
  // Anillo en el suelo
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 80), addMat(P.core, 1));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring);
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), addMat(P.main, 0, { map: runeTexture() }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.05; root.add(rune);
  shake(0.22, 0.4);
  add({
    t: 0, dur: 2.4,
    update(t, dt) {
      light.intensity = t < 0.1 ? t * 260 : 26 * Math.exp(-(t - 0.1) * 2.2);
      const grow = Math.min(1, t / 0.45);                 // crece hacia arriba
      pil.scale.set(1, grow, 1); core.scale.set(1, grow, 1);
      const pa = t < 1.2 ? 1 : Math.max(0, 1 - (t - 1.2) / 1.0);
      pil.material.uniforms.uT.value = -t; core.material.uniforms.uT.value = -t;   // bandas que suben
      pil.material.uniforms.uA.value = pa * 0.55; core.material.uniforms.uA.value = pa * 0.9;
      helices.forEach((m, i) => { m.scale.y = Math.min(1, t / 0.6); m.rotation.y = t * (4 + i); m.position.y = Math.max(0, t - 0.6) * 4; m.material.opacity = 0.9 * pa; });
      for (const m of feathers) {
        const s = m.userData.s, k = Math.max(0, t - s.d);
        const a = s.a + k * 3.2, r = s.r * (1 + k * 0.4);
        m.position.set(Math.cos(a) * r, k * s.v, Math.sin(a) * r);
        m.rotation.set(0, -a + s.spin * k, 0.4);
        m.material.opacity = k <= 0 ? 0 : Math.min(1, k * 6) * Math.max(0, 1 - k / 1.8);
      }
      if (t < 1.1 && t >= nextBolt) {
        nextBolt = t + 0.08;
        const a = Math.random() * 6.28, r = Math.random() * 1.2;
        const from = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 12 + Math.random() * 6, (Math.random() - 0.5) * 2));
        const b = boltMesh(zigzag(from, to, 10, 1.2), 0.04, P.core, 1);
        b.userData.born = t; bolts.add(b);
      }
      for (const b of [...bolts.children]) { const age = t - b.userData.born; b.material.opacity = Math.max(0, 1 - age / 0.25); if (age > 0.25) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); } }
      ring.scale.setScalar(0.3 + Math.min(1, t / 0.5) * 4.5); ring.material.opacity = Math.max(0, 1 - t / 0.7);
      rune.rotation.z -= dt * 2; rune.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 1.4);
    },
    dispose() { disposeObj(root); fGeo.dispose(); },
  });
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

// ------------------------------------------------------------
// RAYO DEL CIELO (Tindaya): un relámpago morado gigante cae sobre el
// objetivo — tres latigazos, destello que lo ilumina todo, anillo en el
// suelo, quemadura y chispas negras y moradas.
// ------------------------------------------------------------
export function skyBolt(getPos, P = PALETTES.vesta) {
  if (!_scene) return;
  const root = new THREE.Group(); _scene.add(root);
  const light = new THREE.PointLight(P.light, 0, 40, 1.2); root.add(light);
  const bolts = new THREE.Group(); root.add(bolts);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 96), addMat(P.core, 0));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; root.add(ring);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(1.8, 40), new THREE.MeshBasicMaterial({ color: 0x0a0010, transparent: true, opacity: 0, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.025; root.add(scorch);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), addMat(P.main, 0));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; root.add(glow);
  const N = 80, sp = points(N, P.spark, 0.24), bk = points(50, 0x0a0010, 0.6, THREE.NormalBlending, 0.9);
  root.add(sp, bk);
  const sv = [], bv = [];
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 7; sv.push(new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 8, Math.sin(a) * s)); }
  for (let i = 0; i < 50; i++) { const a = Math.random() * 6.28; bv.push({ a, r: Math.random() * 1.2, v: 1 + Math.random() * 2.5 }); }
  const strikes = [0, 0.16, 0.34];
  let si = 0;
  const base = new THREE.Vector3();
  const zap = () => {
    for (const b of [...bolts.children]) { b.geometry.dispose(); b.material.dispose(); bolts.remove(b); }
    const top = new THREE.Vector3((Math.random() - 0.5) * 4, 34, (Math.random() - 0.5) * 4);
    const bot = new THREE.Vector3(0, 0, 0);
    bolts.add(boltMesh(zigzag(top, bot, 26, 2.6), 0.55, P.glow, 0.5));
    bolts.add(boltMesh(zigzag(top, bot, 26, 2.0), 0.28, P.main, 0.9));
    bolts.add(boltMesh(zigzag(top, bot, 26, 1.4), 0.11, P.core, 1));
    for (let k = 0; k < 5; k++) {                       // ramas
      const t0 = 0.15 + Math.random() * 0.6, s = new THREE.Vector3().lerpVectors(top, bot, t0);
      const e = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, -2 - Math.random() * 6, (Math.random() - 0.5) * 9));
      bolts.add(boltMesh(zigzag(s, e, 8, 1.2), 0.06, P.spark, 0.9));
    }
    shake(0.55, 0.35);
  };
  add({
    t: 0, dur: 1.8,
    update(t, dt) {
      const c = getPos?.(); if (c) { base.set(c.x, c.y || 0, c.z); root.position.copy(base); }
      if (si < strikes.length && t >= strikes[si]) { zap(); si++; }
      const since = t - strikes[Math.max(0, si - 1)];
      const on = si > 0 && since < 0.12;
      bolts.children.forEach(b => { b.material.opacity = on ? (b.material.userData.o ??= b.material.opacity) * (0.7 + Math.random() * 0.3) : Math.max(0, b.material.opacity - dt * 6); });
      light.intensity = on ? 120 + Math.random() * 80 : Math.max(0, light.intensity - dt * 400);
      light.position.y = 3;
      const k = Math.min(1, t / 0.5);
      ring.scale.setScalar(0.3 + k * 7); ring.material.opacity = Math.max(0, 1 - t / 0.7);
      glow.material.opacity = Math.max(0, 0.7 - t * 0.9);
      scorch.material.opacity = Math.min(0.75, t * 4) * Math.max(0, 1 - Math.max(0, t - 1.1) / 0.7);
      const p = sp.geometry.attributes.position;
      for (let i = 0; i < N; i++) { const v = sv[i]; v.y -= 15 * dt; p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.03, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt); }
      p.needsUpdate = true; sp.material.opacity = Math.max(0, 1 - t / 1.4);
      const q = bk.geometry.attributes.position;
      for (let i = 0; i < 50; i++) { const b = bv[i], h = t * b.v; q.setXYZ(i, Math.cos(b.a + h) * (b.r + h * 0.3), h * 1.4, Math.sin(b.a + h) * (b.r + h * 0.3)); }
      q.needsUpdate = true; bk.material.opacity = 0.9 * Math.max(0, 1 - t / 1.6);
    },
    dispose() { disposeObj(root); },
  });
}
