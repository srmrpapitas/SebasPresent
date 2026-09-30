/**
 * SebasPresent — Combat Projectiles (Sesión 34 stub → Sesión 35 real)
 *
 * Sistema de proyectiles visuales para combate ranged (bow) y magic (cast).
 *
 * S34: STUB — dibujaba una línea verde del shooter al target con fade.
 * S35: REAL — carga arrow.glb una vez al start (cache), spawnea clones
 *      con recolor por arrow_item_id, lerp from→to con arc parabólico
 *      sutil, rotación apuntando en dirección de vuelo, fade-out al final.
 *
 * Mantiene exactamente la misma API pública que el stub (start/stop/
 * fireProjectile/update), así combat.js NO se modifica.
 *
 * ============================================================
 * INTERFAZ (sin cambios respecto a S34)
 * ============================================================
 *
 *   start({ scene })
 *     Inicializa el sistema y dispara la carga ASYNC de arrow.glb.
 *     Si fireProjectile se llama antes de que termine la carga, usa
 *     una línea verde como fallback temporal (gracefully degrades).
 *
 *   fireProjectile(fromVec3, toVec3, opts?)
 *     Dispara un proyectil visual de `fromVec3` al `toVec3` (mundo).
 *     opts:
 *       type:         'arrow' | 'spell' (default 'arrow'). 'spell' aún
 *                     no implementado — se reserva para Bloque 2 días 8-11.
 *       arrowItemId:  para color del mesh (default 'arrow_bronze').
 *       durationMs:   tiempo de vuelo (default 350ms).
 *
 *   stop()
 *     Limpia proyectiles vivos y libera cache. Llamado en cleanup de world.
 *
 *   update()
 *     Llamado cada frame por el render loop de world.js. Actualiza la
 *     posición/rotación de cada proyectil vivo y limpia los expirados.
 *
 * ============================================================
 * NOTAS PARA SESIONES FUTURAS
 * ============================================================
 *
 *  - Recolor: clonamos material por shot (no se reusa). Si esto se vuelve
 *    bottleneck con muchos arqueros simultáneos (PvP masivo), pool de
 *    materials por color sería el optimizer.
 *
 *  - Trayectoria: arc parabólico sutil (ARROW_ARC_HEIGHT). Se siente
 *    "balístico" sin exagerar. Para magic (Bloque 2 d.8-11) probablemente
 *    queremos trayectoria recta o más alta — agregar opts.arcHeight cuando
 *    haga falta.
 *
 *  - SFX: por ahora silencioso al disparar/impactar. Cuando lleguen
 *    'bow_release' y 'arrow_impact' a R2 (B-009 backlog), agregarlos en
 *    fireProjectile() y en el cleanup del update() respectivamente.
 *
 *  - Anims de bow (S36): Bow_Overdraw + Bow_Recoil integradas en character.js.
 *    opts.windupMs implementado — combat.js lo pasa con BOW_OVERDRAW_MS (200ms)
 *    para que la flecha aparezca en el frame de release del char, no al inicio.
 *    Si calibrás BOW_OVERDRAW_MS en character.js, actualizá también el call site
 *    en combat.js (hoy 200, hardcoded).
 *
 *  - Calibración: si la flecha vuela "de costado" o muy chica/grande,
 *    ajustar ARROW_BASE_SCALE y/o ARROW_YAW_OFFSET abajo. Si el GLB
 *    cambia, esto cambia también.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// Config
// ============================================================
const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const WEAPONS_BASE = `${CDN_BASE}/weapons`;

// Map de color por arrow_item_id (decisión S34, mantenida en S35).
const ARROW_COLORS = {
  arrow_bronze:  0xb06a3a,
  arrow_iron:    0x7a7a7a,
  arrow_steel:   0xc0c0c0,
  arrow_mithril: 0x6b96d6,
  arrow_adamant: 0x5fae67,
  arrow_rune:    0x4ecdc4,
  arrow_dragon:  0xc0392b,
};
const DEFAULT_ARROW_COLOR = ARROW_COLORS.arrow_bronze;

// Tunables de visual. Si la flecha se ve muy chica/grande/torcida, tocar acá.
//
//   ARROW_BASE_SCALE: scale uniforme del clone. Si el GLB exporta en metros
//     razonables, 1.0 está bien.
//
//   ARROW_ROT_OFFSET_{X,Y,Z}: corrección post-lookAt. Necesaria porque
//     lookAt() asume que -Z local apunta al target, y casi ningún GLB
//     respeta esa convención. arrow.glb fue exportado con la flecha
//     apuntando hacia +Y (típico de Blender), por eso por default
//     aplicamos rotX = -PI/2 (tumba 90° hacia adelante).
//
//     Si tu flecha sigue mal después de subir, prueba:
//        - flecha vuela vertical / "parada"   → rotX = -PI/2 (default actual)
//        - flecha vuela "al revés"            → rotX = +PI/2 ó rotZ = PI
//        - flecha vuela "de costado"          → rotY = PI/2 ó -PI/2
//        - punta hacia el shooter, no target  → rotZ = PI
//
//   ARROW_ARC_HEIGHT: altura del arc parabólico en metros. 0 = vuelo recto.
const ARROW_BASE_SCALE     = 1.0;
const ARROW_ROT_OFFSET_X   = -Math.PI / 2;
const ARROW_ROT_OFFSET_Y   = 0;
const ARROW_ROT_OFFSET_Z   = 0;
const ARROW_ARC_HEIGHT     = 0.6;

// Offset vertical desde el suelo del shooter y del target. Mantiene el
// "salir del pecho, llegar a la cabeza" del stub original — aproximación
// razonable hasta que tengamos la mano del char como origen (S36 con anims).
const SHOOTER_Y_OFFSET = 1.2;
const TARGET_Y_OFFSET  = 1.0;

// ============================================================
// Estado
// ============================================================
let scene = null;
let started = false;
let arrowBaseMesh = null;     // gltf.scene cacheado, base para todos los clones
let arrowLoadPromise = null;  // promise del load inicial (para esperar/race)

const _gltfLoader = new GLTFLoader();

// Cada proyectil vivo: { obj, spawnedAt, durationMs, from, to, isLine? }
const liveProjectiles = [];

// ============================================================
// API pública
// ============================================================

export function start(opts = {}) {
  if (started) return;
  scene = opts.scene;
  if (!scene) {
    console.warn('[combat_projectiles] start() sin scene — fireProjectile va a no-op');
    return;
  }
  started = true;

  // Carga del arrow.glb en background. No bloqueamos start() esperándolo
  // — si fireProjectile se llama antes de que termine, usa la línea verde
  // como fallback temporal (ver spawnFallbackLine abajo).
  arrowLoadPromise = _gltfLoader.loadAsync(`${WEAPONS_BASE}/arrow.glb`)
    .then(gltf => {
      arrowBaseMesh = gltf.scene;
      // Sanitización del base: side=FrontSide (idéntico a character._loadWeaponMesh).
      // El material original se mantiene; cada shot clona sus materials para recolor
      // sin afectar el base (otros shots usan el mismo base).
      arrowBaseMesh.traverse(o => {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (m.side !== undefined) m.side = THREE.FrontSide;
            }
          }
        }
      });
      console.log('[combat_projectiles] arrow.glb loaded');
    })
    .catch(err => {
      console.warn('[combat_projectiles] arrow.glb load failed:', err.message);
      arrowBaseMesh = null;
    });
}

export function stop() {
  if (!started) return;
  for (const p of liveProjectiles) cleanupProjectile(p);
  liveProjectiles.length = 0;
  scene = null;
  started = false;
  arrowBaseMesh = null;
  arrowLoadPromise = null;
}

export function fireProjectile(fromVec3, toVec3, opts = {}) {
  if (!started || !scene) return;
  if (!fromVec3 || !toVec3) return;

  // Sesión 36 — opts.windupMs: delay antes del spawn visual del proyectil.
  // Lo usa el path ranged (combat.js) para sincronizar la aparición de la
  // flecha con el frame de release de Bow_Recoil (200ms después del start
  // del attack tick). Sin esto, la flecha aparecía al inicio del windup,
  // como si saliera del arco antes de que el char la soltara.
  //
  // Implementación: re-llamar fireProjectile con windupMs=0 tras el setTimeout.
  // Es simple y deja la lógica del spawn intacta abajo. NO recursa al infinito
  // porque la 2da llamada tiene windupMs=0 → cae directo al spawn.
  const windupMs = (typeof opts.windupMs === 'number' && opts.windupMs > 0)
    ? opts.windupMs
    : 0;
  if (windupMs > 0) {
    const optsNoWindup = { ...opts, windupMs: 0 };
    setTimeout(() => {
      try { fireProjectile(fromVec3, toVec3, optsNoWindup); }
      catch (e) { console.warn('[combat_projectiles] delayed fire failed:', e?.message); }
    }, windupMs);
    return;
  }

  const durationMs  = opts.durationMs || 350;
  const arrowItemId = opts.arrowItemId || 'arrow_bronze';

  // Aproximación de altura: salir del pecho del shooter, llegar a altura del
  // target. Cuando integremos anims de bow (S36), el "from" debería venir
  // de la mano del char en vez de pos+offset.
  const fromAdj = new THREE.Vector3(fromVec3.x, (fromVec3.y || 0) + SHOOTER_Y_OFFSET, fromVec3.z);
  const toAdj   = new THREE.Vector3(toVec3.x,   (toVec3.y   || 0) + TARGET_Y_OFFSET,  toVec3.z);

  // Sesión 41 — Proyectil de HECHIZO: esfera brillante del color del hechizo
  // (procedural, sin GLB). Núcleo + halo translúcido + luz puntual. Reusa el
  // lerp de liveProjectiles (mismo arco que la flecha).
  if (opts.type === 'spell' || opts.type === 'dragonhead') {
    const fx = opts.type === 'dragonhead' ? buildDragonHead() : buildSpellFx(opts.spellId, opts.color);
    fx.obj.position.copy(fromAdj);
    scene.add(fx.obj);
    if (opts.type === 'spell') spawnCastCircle(fromVec3, fx.color);
    liveProjectiles.push({
      obj: fx.obj,
      spawnedAt: performance.now(),
      durationMs: opts.type === 'dragonhead' ? 520 : 420,
      from: fromAdj.clone(),
      to:   toAdj.clone(),
      isLine: false,
      fx,
      targetNpcId: (opts.targetNpcId != null) ? opts.targetNpcId : null,
      arcHeight: (typeof opts.arcHeight === 'number') ? opts.arcHeight : (opts.type === 'dragonhead' ? 0.5 : 0.15),
    });
    return;
  }

  // Si el mesh aún no cargó, fallback temporal (línea verde como el stub).
  if (!arrowBaseMesh) {
    spawnFallbackLine(fromAdj, toAdj, durationMs);
    return;
  }

  // Clone profundo del base. clone(true) clona la jerarquía pero las
  // geometries y materials quedan compartidos con el base por default.
  // Para no contaminar el base con nuestro recolor, applyArrowColor clona
  // explícitamente los materials del clone — quedan independientes.
  const mesh = arrowBaseMesh.clone(true);
  const color = ARROW_COLORS[arrowItemId] ?? DEFAULT_ARROW_COLOR;
  applyArrowColor(mesh, color);
  mesh.scale.setScalar(ARROW_BASE_SCALE);
  mesh.position.copy(fromAdj);
  scene.add(mesh);

  liveProjectiles.push({
    obj: mesh,
    spawnedAt: performance.now(),
    durationMs,
    from: fromAdj.clone(),
    to:   toAdj.clone(),
    isLine: false,
  });
}

export function update() {
  if (!started) return;
  if (liveProjectiles.length === 0) { if (particles.length) updateParticles(performance.now()); return; }
  const now = performance.now();
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i];
    const t = (now - p.spawnedAt) / p.durationMs;

    if (t >= 1) {
      if (p.fx) { try { spawnImpact(p.obj.position, p.fx); } catch {} }
      cleanupProjectile(p);
      liveProjectiles.splice(i, 1);
      continue;
    }

    if (p.isLine) {
      // Fallback line: solo fade lineal.
      if (p.fallbackMaterial) p.fallbackMaterial.opacity = 0.9 * (1 - t);
      continue;
    }

    // Sesión 41 — HOMING: si el proyectil tiene un NPC objetivo, refrescamos
    // `to` a su posición viva cada frame, así va directo aunque el NPC camine.
    if (p.targetNpcId != null && typeof window !== 'undefined' && typeof window.__getNpcPosition === 'function') {
      try {
        const live = window.__getNpcPosition(p.targetNpcId);
        if (live) { p.to.x = live.x; p.to.z = live.z; }
      } catch {}
    }

    // Posición: lerp lineal en XZ + arc parabólico sutil en Y.
    // sin(t*PI) va de 0 → 1 → 0 a lo largo de t∈[0,1].
    const arcH = (typeof p.arcHeight === 'number') ? p.arcHeight : ARROW_ARC_HEIGHT;
    const x = p.from.x + (p.to.x - p.from.x) * t;
    const z = p.from.z + (p.to.z - p.from.z) * t;
    const yLinear = p.from.y + (p.to.y - p.from.y) * t;
    const arc = arcH * Math.sin(t * Math.PI);
    p.obj.position.set(x, yLinear + arc, z);

    // Rotación: la flecha apunta "hacia donde va a estar 0.01 de t más
    // adelante". Esto sigue el arco naturalmente (sube cuando sube, baja
    // cuando baja), sin necesidad de calcular derivadas a mano.
    // lookAt() orienta -Z local hacia el target. Los ARROW_ROT_OFFSET_*
    // corrigen la orientación local del GLB después (ver arriba).
    const tNext = Math.min(1, t + 0.01);
    const nx = p.from.x + (p.to.x - p.from.x) * tNext;
    const nz = p.from.z + (p.to.z - p.from.z) * tNext;
    const nyLin = p.from.y + (p.to.y - p.from.y) * tNext;
    const nyArc = arcH * Math.sin(tNext * Math.PI);
    p.obj.lookAt(nx, nyLin + nyArc, nz);
    if (p.fx) {
      // (Object3D.lookAt apunta +Z al objetivo: los efectos miran hacia +Z)
      try { p.fx.tick?.(t, now); } catch {}
      emitTrail(p);
    } else {
      if (ARROW_ROT_OFFSET_X !== 0) p.obj.rotateX(ARROW_ROT_OFFSET_X);
      if (ARROW_ROT_OFFSET_Y !== 0) p.obj.rotateY(ARROW_ROT_OFFSET_Y);
      if (ARROW_ROT_OFFSET_Z !== 0) p.obj.rotateZ(ARROW_ROT_OFFSET_Z);
    }
  }
  updateParticles(now);
}

// ============================================================
// Helpers
// ============================================================

function spawnFallbackLine(from, to, durationMs) {
  // Stub original mantenido como fallback mientras arrow.glb se carga
  // (típicamente los primeros ~500ms post-login si disparás de una).
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: 0x55ff66,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  liveProjectiles.push({
    obj: line,
    spawnedAt: performance.now(),
    durationMs,
    isLine: true,
    fallbackMaterial: material,
    fallbackGeometry: geometry,
  });
}

function applyArrowColor(mesh, hexColor) {
  // Clona materials del clone (no del base) y settea el color. Así cada
  // proyectil tiene su material propio que puede ser disposed sin afectar
  // al base ni a otros proyectiles.
  mesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const cloned = mats.map(m => {
      const c = m.clone();
      if (c.color) c.color.setHex(hexColor);
      return c;
    });
    o.material = wasArray ? cloned : cloned[0];
  });
}

function cleanupProjectile(p) {
  if (!p) return;
  if (p.obj && scene) scene.remove(p.obj);
  if (p.fx) {
    p.obj.traverse(o => { if (o.isMesh || o.isSprite) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
    return;
  }
  if (p.isLine) {
    // Fallback line: dispose explícito de su geometry+material (no compartidos).
    p.fallbackMaterial?.dispose?.();
    p.fallbackGeometry?.dispose?.();
    return;
  }
  // Mesh GLB clone: dispose SOLO los materials (clonados en applyArrowColor).
  // Las geometries quedan compartidas con arrowBaseMesh, NO dispose'arlas
  // o reventamos el cache.
  if (p.obj) {
    p.obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    });
  }
}


// ============================================================
// Sesión 50 — Efectos de hechizos y del Aliento del dragón
// ============================================================
// Cada hechizo tiene su propio proyectil + estela de partículas + impacto:
//   fire_strike  → bola de fuego con llamas y chispas
//   ice_spear    → lanza de cristal con escarcha
//   thunderbolt  → rayo en zigzag que parpadea
//   entangle     → orbe verde con lianas en espiral
//   dragonhead   → cabeza de dragón en llamas (especial del arco de dragón)
// Sin PointLights nuevas (caras en móvil): todo aditivo + emissive.

let SOFT_TEX = null;
function softTex() {
  if (SOFT_TEX) return SOFT_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  SOFT_TEX = new THREE.CanvasTexture(c);
  return SOFT_TEX;
}
const addMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

const SPELL_STYLE = {
  fire_strike: { color: 0xff6a1a, trail: [0xffc040, 0xff5010, 0x802000], rate: 3, spread: 0.12, rise: 0.8 },
  ice_spear:   { color: 0x7fd8ff, trail: [0xe8fbff, 0x9fe3ff, 0x4aa8e8], rate: 2, spread: 0.08, rise: -0.3 },
  thunderbolt: { color: 0xfff27a, trail: [0xffffff, 0xfff27a, 0x9fb8ff], rate: 2, spread: 0.2, rise: 0 },
  entangle:    { color: 0x59d34a, trail: [0xb8ff8a, 0x59d34a, 0x2a7a20], rate: 2, spread: 0.1, rise: 0.1 },
  stone:       { color: 0x8a8070, trail: [0xb0a890, 0x8a8070], rate: 1, spread: 0.05, rise: 0 },   // Sesión 50 — honda guanche
  sunbolt:     { color: 0xffd040, trail: [0xfff4b0, 0xffd040, 0xff9a20], rate: 2, spread: 0.1, rise: 0.3 },   // Sesión 50 — faycán (Magec)
};

function buildSpellFx(spellId, colorOverride) {
  const st = SPELL_STYLE[spellId] || { ...SPELL_STYLE.fire_strike, color: colorOverride ?? 0xff6622 };
  const root = new THREE.Group();
  const fx = { obj: root, color: st.color, style: st, spellId, trailAcc: 0 };
  if (spellId === 'stone') {
    root.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), new THREE.MeshLambertMaterial({ color: 0x7a7266, flatShading: true })));
    fx.tick = (t) => { root.children[0].rotation.set(t * 20, t * 14, 0); };
    return fx;
  }
  if (spellId === 'sunbolt') {
    root.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c0 })));
    root.add(glowSprite(0xffc030, 0.9, 0.9));
    return fx;
  }
  if (spellId === 'ice_spear') {
    const spear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xcff4ff }));
    spear.rotation.x = Math.PI / 2;   // punta hacia +Z
    root.add(spear);
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.05, 6), addMat(0x6fc8ff, 0.35));
    shell.rotation.x = Math.PI / 2;
    root.add(shell);
    for (let k = 0; k < 3; k++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), addMat(0xe8fbff, 0.9));
      shard.userData.k = k;
      root.add(shard);
    }
    root.add(glowSprite(0x7fd8ff, 0.9, 0.7));
    fx.tick = (t) => {
      root.children.forEach(c => { if (c.userData.k != null) {
        const a = t * 18 + c.userData.k * 2.1;
        c.position.set(Math.cos(a) * 0.22, Math.sin(a) * 0.22, -0.2);
        c.rotation.set(a, a, 0);
      } });
    };
  } else if (spellId === 'thunderbolt') {
    const core = glowSprite(0xffffff, 0.55, 1);
    root.add(core, glowSprite(0xfff27a, 1.2, 0.8));
    // rayo: línea en zigzag detrás del proyectil, se regenera cada frame
    const N = 8;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfffbd0, transparent: true, blending: THREE.AdditiveBlending }));
    line.frustumCulled = false;
    root.add(line);
    fx.tick = () => {
      const a = geo.attributes.position.array;
      for (let k = 0; k < N; k++) {
        a[k * 3] = (Math.random() - 0.5) * 0.35;
        a[k * 3 + 1] = (Math.random() - 0.5) * 0.35;
        a[k * 3 + 2] = -k * 0.28;
      }
      geo.attributes.position.needsUpdate = true;
      core.material.opacity = 0.6 + Math.random() * 0.4;
    };
  } else if (spellId === 'entangle') {
    root.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshBasicMaterial({ color: 0x3aa030 })));
    root.add(glowSprite(0x59d34a, 0.9, 0.8));
    const vines = [];
    for (let k = 0; k < 3; k++) {
      const v = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 4, 16, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: 0x2f8a24 }));
      v.userData.k = k; vines.push(v); root.add(v);
    }
    fx.tick = (t) => { vines.forEach(v => { v.rotation.set(t * 9 + v.userData.k, t * 7 + v.userData.k * 2, 0); }); };
  } else {
    // bola de fuego
    root.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe6a0 })));
    const halo = glowSprite(0xff7a1a, 1.0, 0.95);
    const outer = glowSprite(0xff3a00, 1.6, 0.45);
    root.add(halo, outer);
    fx.tick = (t) => { const k = 1 + Math.sin(t * 40) * 0.12; halo.scale.set(k, k, 1); };
  }
  return fx;
}

function buildDragonHead() {
  const root = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb01a10, emissive: 0x5a0800, emissiveIntensity: 0.8, roughness: 0.5, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a0a06, roughness: 0.6, flatShading: true });
  const horn = new THREE.MeshStandardMaterial({ color: 0xe8d8b0, roughness: 0.5, flatShading: true });
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffe040 });
  const S = 0.55;
  // cráneo
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S * 2, 0.26 * S * 2, 0.4 * S * 2), red);
  root.add(skull);
  // hocico (hacia +Z)
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.26 * S * 2, 0.16 * S * 2, 0.36 * S * 2), red);
  snout.position.set(0, 0.03 * S * 2, 0.34 * S * 2);
  root.add(snout);
  // mandíbula abierta
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.24 * S * 2, 0.06 * S * 2, 0.34 * S * 2), dark);
  jaw.position.set(0, -0.14 * S * 2, 0.3 * S * 2);
  jaw.rotation.x = 0.35;
  root.add(jaw);
  // dientes
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.025 * S * 2, 0.09 * S * 2, 4), horn);
    f.position.set(sx * 0.08 * S * 2, -0.06 * S * 2, 0.48 * S * 2); f.rotation.x = Math.PI;
    root.add(f);
  }
  // cuernos hacia atrás
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.05 * S * 2, 0.34 * S * 2, 5), horn);
    h.position.set(sx * 0.13 * S * 2, 0.16 * S * 2, -0.2 * S * 2);
    h.rotation.set(-2.1, 0, sx * 0.35);
    root.add(h);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.035 * S * 2, 6, 6), eyeM);
    e.position.set(sx * 0.16 * S * 2, 0.07 * S * 2, 0.12 * S * 2);
    root.add(e);
  }
  // cresta
  for (let k = 0; k < 3; k++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03 * S * 2, 0.12 * S * 2, 4), dark);
    sp.position.set(0, 0.16 * S * 2, (0.05 - k * 0.12) * S * 2);
    sp.rotation.x = -0.5;
    root.add(sp);
  }
  // fuego de la boca + halo
  const mouth = glowSprite(0xffa020, 0.7, 1);
  mouth.position.set(0, -0.08, 0.55);
  root.add(mouth, glowSprite(0xff3a00, 1.6, 0.35));
  return {
    obj: root, color: 0xff5010, dragon: true, trailAcc: 0,
    style: { trail: [0xffd040, 0xff6010, 0x701000], rate: 4, spread: 0.25, rise: 0.9 },
    tick: (t) => { jaw.rotation.x = 0.25 + Math.sin(t * 30) * 0.15; mouth.scale.setScalar(0.6 + Math.random() * 0.3); },
  };
}

// ---------------- Partículas ----------------
const particles = [];
const MAX_PARTICLES = 260;
function spawnParticle(pos, color, size, life, vel, grow = 1.6) {
  if (!scene) return;
  if (particles.length >= MAX_PARTICLES) { const old = particles.shift(); scene.remove(old.s); old.s.material.dispose(); }
  const sp = glowSprite(color, size, 1);
  sp.position.copy(pos);
  scene.add(sp);
  particles.push({ s: sp, born: performance.now(), life, vel, size, grow });
}
function emitTrail(p) {
  const st = p.fx.style;
  if (!st) return;
  for (let k = 0; k < st.rate; k++) {
    const c = st.trail[(Math.random() * st.trail.length) | 0];
    const pos = p.obj.position.clone();
    pos.x += (Math.random() - 0.5) * st.spread; pos.y += (Math.random() - 0.5) * st.spread; pos.z += (Math.random() - 0.5) * st.spread;
    spawnParticle(pos, c, 0.22 + Math.random() * 0.25, 260 + Math.random() * 260,
      new THREE.Vector3((Math.random() - 0.5) * 0.4, st.rise * (0.5 + Math.random()), (Math.random() - 0.5) * 0.4));
  }
}
function updateParticles(now) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    const k = (now - q.born) / q.life;
    if (k >= 1) { scene?.remove(q.s); q.s.material.dispose(); particles.splice(i, 1); continue; }
    const dt = 1 / 60;
    q.s.position.addScaledVector(q.vel, dt);
    const sc = q.size * (1 + k * q.grow);
    q.s.scale.set(sc, sc, 1);
    q.s.material.opacity = (1 - k) * (1 - k);
  }
}
function spawnImpact(pos, fx) {
  const st = fx.style || {};
  const cols = st.trail || [fx.color];
  const n = fx.dragon ? 28 : 18;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.4;
    const sp = 1.5 + Math.random() * 2.5;
    spawnParticle(pos.clone(), cols[k % cols.length], 0.25 + Math.random() * 0.3, 350 + Math.random() * 300,
      new THREE.Vector3(Math.cos(a) * sp, Math.abs(e) * sp * 0.8, Math.sin(a) * sp), 2);
  }
  // onda en el suelo
  if (!scene) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.35, 28), addMat(fx.color, 0.9));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.06, pos.z);
  scene.add(ring);
  const born = performance.now();
  const tick = () => {
    const k = (performance.now() - born) / 450;
    if (k >= 1 || !scene) { scene?.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return; }
    ring.scale.setScalar(1 + k * (fx.dragon ? 7 : 4));
    ring.material.opacity = 0.9 * (1 - k);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// Círculo rúnico bajo los pies al lanzar un hechizo
function spawnCastCircle(pos, color) {
  if (!scene || !pos) return;
  const g = new THREE.Group();
  g.position.set(pos.x, 0.05, pos.z);
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 32), addMat(color, 0.9));
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.38, 6), addMat(color, 0.8));
  r1.rotation.x = r2.rotation.x = -Math.PI / 2;
  g.add(r1, r2);
  scene.add(g);
  const born = performance.now();
  const tick = () => {
    const k = (performance.now() - born) / 600;
    if (k >= 1 || !scene) { scene?.remove(g); r1.geometry.dispose(); r2.geometry.dispose(); r1.material.dispose(); r2.material.dispose(); return; }
    g.rotation.y = k * 3;
    const sc = 0.8 + k * 0.5;
    g.scale.set(sc, 1, sc);
    r1.material.opacity = r2.material.opacity = 0.9 * Math.sin(Math.min(1, k * 1.2) * Math.PI);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
