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
export function peerSlam(group, palette, target, impactMs = 1046) {
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
      slam(impactPoint(group.position, target), palette);
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
