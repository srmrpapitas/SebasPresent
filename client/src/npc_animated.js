/**
 * SebasPresent — NPC animado (Sesión 39 · pipeline esquelético para goblin)
 *
 * Hasta ahora los NPCs se renderizaban como GEOMETRÍA HORNEADA (bakeGlbModel):
 * sin esqueleto, sin animación. Perfecto para gallinas/vacas estáticas, pero
 * el goblin necesita moverse.
 *
 * Este módulo añade el camino ANIMADO, siguiendo la FORMA A (la misma que usa
 * el jugador en character.js y los peers en multiplayer.js):
 *   - La MALLA + esqueleto salen del GLB del goblin (npcs/goblin.glb), que
 *     además trae embebida la animación "run".
 *   - Los demás clips (walk, react) se cargan como FBX SUELTOS desde R2
 *     (animations/*.fbx) y se aplican al mismo rig mixamo. Modular: una anim
 *     nueva = subir el FBX + una línea en CLIP_SOURCES.
 *   - Cada instancia de goblin = SkeletonUtils.clone (esqueleto propio) +
 *     AnimationMixer propio. Los CLIPS se comparten (se cargan una vez).
 *     Idéntico a cómo multiplayer.js clona a cada peer.
 *
 * DESYNC (la preocupación de Nico): a los clips de locomoción se les ELIMINA
 * el track de posición de las caderas (root motion). Así el goblin anima las
 * piernas EN EL SITIO y su posición la sigue mandando el server vía la
 * interpolación de npc_renderer.js. La hit-box visual = la del server. Si NO
 * stripeáramos el root motion, el goblin "caminaría" alejándose de donde el
 * server cree que está → exactamente el bug "se ve acá pero está allá".
 *
 * FALLBACK: si el GLB o los clips fallan al cargar, isReady() devuelve false
 * y npc_renderer.js usa el camino horneado de siempre. Un asset roto NO puede
 * romper el juego.
 *
 * NO toca CSS ni móvil. Es lógica de render pura.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { measureSkinnedBbox } from './terrain.js';   // Sesión 39 fix flotar

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const ANIM_BASE = `${R2_BASE}/animations`;

// Qué tipos de NPC usan el pipeline animado. El resto sigue horneado.
export const ANIMATED_NPC_TYPES = new Set(['goblin']);

// Altura objetivo (debe coincidir con NPC_TARGET_HEIGHTS de npc_renderer).
const GOBLIN_TARGET_HEIGHT = 1.6;

// Sesión 39/40 — AJUSTE FINO del grounding (grosor de suela). El sistema
// AUTO-GROUND (Sesión 40, ver groundToFeet) planta el HUESO de pie más bajo en
// y=0 CADA FRAME, así que ningún pose puede flotar ni hundirse. Este número solo
// sube/baja TODO un pelín si hace falta (suela). Live-tuneable en el móvil:
//   window.__goblinY(0.05)   // sube 5cm     window.__goblinY()  // ver actual
let GOBLIN_Y_TWEAK = 0;
// Auto-ground: plantar el pie más bajo en el suelo cada frame. ON por defecto.
// Apagar para depurar con: window.__goblinAutoGround(false)
let GOBLIN_AUTOGROUND = true;

// Fuentes de clips. 'embedded' = viene dentro del GLB. Lo demás = FBX en R2.
// Sesión 39 FIX v6 (el correcto): aunque ahora todos los clips están en el
// MISMO goblin.glb, la fusión copió las posiciones de hueso TAL CUAL del FBX
// original — y walk/react/idle vienen en escala ~200 mientras el esqueleto
// del goblin (= run) está en escala ~100. Por eso walk/react seguían flotando.
// Como ahora comparten nombres de nodo exactos, el fix definitivo es:
//   - run  → 'native': conserva posiciones (es la escala del esqueleto, 100).
//   - resto → 'rot_only': se les quitan TODAS las posiciones de hueso; solo
//             rotaciones. Las longitudes de hueso las pone el esqueleto (100).
//             Así no se infla ni flota, sin importar la escala original del clip.
const CLIP_SOURCES = {
  run:   { kind: 'embedded', clip: 'run',   loop: true,  strip: 'native'   },
  walk:  { kind: 'embedded', clip: 'walk',  loop: true,  strip: 'rot_only' },
  react: { kind: 'embedded', clip: 'react', loop: false, strip: 'rot_only' },
  idle:  { kind: 'embedded', clip: 'idle',  loop: true,  strip: 'rot_only' },
};

const REACT_TARGET_MS = 550;   // Sesión 40 — react del goblin un pelín más
                               // largo (era 400). A 400ms + persecución encima
                               // el flinch se "comía" y parecía que no reaccionaba.
                               // 550ms lo hace claramente visible sin estorbar.

// ============================================================
// Estado del módulo (template compartido)
// ============================================================
let _template = null;     // { mesh, clips: {name: AnimationClip} }
let _xform = null;        // { rotX, scaleFactor, groundOffsetY } — Sesión 39 fix flotar
let _ready = false;
let _loading = null;      // promesa en vuelo (evita doble carga)

export function isReady() { return _ready; }

// ============================================================
// Helpers de clip
// ============================================================

/**
 * Sesión 39 FIX v4 (DEFINITIVO, con diagnóstico medido sobre los FBX).
 *
 * Causa real del flote: cada clip Mixamo trae un track de POSICIÓN por hueso
 * (no solo caderas). El esqueleto del goblin sale del GLB (convertido con
 * assimp, escala ~100). Los clips walk/react son FBX sueltos (FBXLoader,
 * escala ~200) → sus posiciones de hueso están al ~doble. Al aplicarlas sobre
 * el esqueleto del GLB, TODOS los huesos se estiran/desplazan → el goblin se
 * infla y flota. Anclar solo las caderas no alcanzaba.
 *
 * Solución estándar de retargeting: en los clips FORÁNEOS (FBX sueltos) se
 * quitan TODOS los tracks de posición y se dejan solo las ROTACIONES. Las
 * longitudes/offsets de hueso las define el esqueleto del GLB (bind pose); la
 * animación solo rota. En el clip NATIVO (run, embebido en el mismo GLB) las
 * posiciones SÍ coinciden, así que se conservan y solo se neutraliza el
 * desplazamiento horizontal de las caderas (root motion → lo manda el server).
 *
 * @param native  true = clip del propio GLB (run); false = FBX suelto (walk/react)
 */
function normalizeTrackNames(clip) {
  for (const track of clip.tracks) {
    const idx = track.name.indexOf('mixamorig:');
    if (idx > 0) track.name = track.name.slice(idx);
  }
  return clip;
}

function stripRootMotion(clip, mode = 'rot_only') {
  if (mode === 'native') {
    // Clip nativo (run): conservar posiciones; solo neutralizar X/Z de caderas.
    for (const t of clip.tracks) {
      if (/mixamorig:Hips\.position$/i.test(t.name) && t.values && t.values.length >= 3) {
        const x0 = t.values[0], z0 = t.values[2];
        for (let i = 0; i < t.values.length; i += 3) {
          t.values[i] = x0;       // X fijo (sin deriva horizontal)
          t.values[i + 2] = z0;   // Z fijo
          // Y se conserva (es la del propio esqueleto, escala correcta)
        }
      }
    }
  } else {
    // 'rot_only': QUITAR todos los tracks de posición. Solo rotaciones. El
    // esqueleto (escala nativa del run) define las longitudes de hueso → no
    // importa la escala original del clip, no se infla ni flota.
    clip.tracks = clip.tracks.filter(t => !/\.position$/i.test(t.name));
  }
  return clip;
}

function prepClip(clip, name, cfg) {
  clip = clip.clone();
  clip.name = name;
  normalizeTrackNames(clip);
  // strip: 'native' (run, conserva posiciones) | 'rot_only' (resto, solo rota).
  if (cfg.strip) stripRootMotion(clip, cfg.strip);
  return clip;
}

/**
 * Mide dimensiones X/Y/Z robustas (corners de geometry.boundingBox aplicando
 * matrixWorld), para detectar orientación Z-up sin depender de setFromObject.
 */
function measureDims(root) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const v = new THREE.Vector3();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (!bb) return;
    const corners = [
      [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
      [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
      [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
      [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z],
    ];
    for (const c of corners) {
      v.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
      for (let i = 0; i < 3; i++) {
        const val = v.getComponent(i);
        if (val < min[i]) min[i] = val;
        if (val > max[i]) max[i] = val;
      }
    }
    found = true;
  });
  if (!found) return null;
  return { szX: max[0] - min[0], szY: max[1] - min[1], szZ: max[2] - min[2] };
}

// ============================================================
// Carga (una sola vez)
// ============================================================

/**
 * Carga el GLB del goblin + los FBX de animación y arma el template.
 * Idempotente: múltiples llamadas comparten la misma promesa.
 * @param {string} goblinGlbUrl  URL del goblin.glb (se la pasa npc_renderer).
 */
export async function loadAnimatedTemplate(goblinGlbUrl) {
  if (_ready) return _template;
  if (_loading) return _loading;

  _loading = (async () => {
    const gltfLoader = new GLTFLoader();

    // 1) Malla + esqueleto + TODOS los clips embebidos (run/walk/react/idle)
    const gltf = await gltfLoader.loadAsync(goblinGlbUrl);
    const mesh = gltf.scene;

    // ----------------------------------------------------------------
    // Sesión 39 FIX v2 (goblin flotaba a la altura del cuello):
    // El fix anterior usaba THREE.Box3().setFromObject() que para SkinnedMesh
    // devuelve una caja ERRÓNEA (no tiene en cuenta el esqueleto) → calculaba
    // mal el grounding y lo empujaba para arriba. Ahora medimos con el método
    // robusto measureSkinnedBbox() (el mismo que usa terrain.js para los NPCs
    // horneados, que SÍ se plantan bien): recorre cada mesh y aplica su
    // matrixWorld a la bounding box de la geometría.
    // ----------------------------------------------------------------

    // Asegurar matrices y bounding boxes de geometría calculadas.
    mesh.traverse(o => {
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.update?.();
      if (o.isMesh && o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.updateMatrix?.();
    });
    mesh.updateMatrixWorld(true);

    // (a) Orientación: medir ejes con el método robusto para detectar Z-up.
    let m = measureSkinnedBbox(mesh);
    // Medimos también X y Z robustos para el chequeo de orientación.
    let dims = measureDims(mesh);
    let rotX = 0;
    if (dims && dims.szZ > dims.szY && dims.szZ > dims.szX * 0.6) {
      rotX = -Math.PI / 2;
      mesh.rotation.x = rotX;
      mesh.updateMatrixWorld(true);
      m = measureSkinnedBbox(mesh);
    }

    // (b) Escala a la altura objetivo (sobre el eje vertical ya correcto).
    const sizeY = m ? m.sizeY : 0;
    let scaleFactor = sizeY > 0.001 ? GOBLIN_TARGET_HEIGHT / sizeY : 1.0;
    if (!(scaleFactor > 0) || scaleFactor > 1000 || scaleFactor < 0.00001) scaleFactor = 1.0;

    // (c) Grounding: el pie del modelo está en m.minY (en unidades sin escalar).
    // Tras escalar, ese punto cae en minY*scaleFactor; lo subimos a 0.
    const groundOffsetY = (m ? -m.minY * scaleFactor : 0) + GOBLIN_Y_TWEAK;

    mesh.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
      }
    });

    _xform = { rotX, scaleFactor, groundOffsetY };
    console.log(`[npc_animated] transform: rotX=${rotX.toFixed(2)} scale=${scaleFactor.toFixed(4)} groundY=${groundOffsetY.toFixed(3)} (minY=${m?m.minY.toFixed(3):'?'} sizeY=${sizeY.toFixed(3)})`);

    const clips = {};

    // Sesión 39 FIX v5 — TODOS los clips vienen embebidos en el goblin.glb.
    // Los matcheamos por nombre (run/walk/react/idle). assimp nombra las anims;
    // matcheamos por nombre exacto y, si no, por orden como fallback.
    const glbAnims = gltf.animations || [];
    const byName = new Map();
    for (const a of glbAnims) if (a && a.name) byName.set(a.name, a);

    for (const [name, cfg] of Object.entries(CLIP_SOURCES)) {
      if (cfg.kind !== 'embedded') continue;
      const wanted = cfg.clip || name;
      let src = byName.get(wanted) || byName.get(name);
      if (!src) {
        console.warn(`[npc_animated] clip '${wanted}' no está en el GLB (anims: ${[...byName.keys()].join(', ')})`);
        continue;
      }
      clips[name] = prepClip(src, name, cfg);
    }

    if (!clips.walk && !clips.run) {
      throw new Error('sin clips de locomoción (walk/run) en el GLB — abortando pipeline animado');
    }

    _template = { mesh, clips };
    _ready = true;
    console.log(`[npc_animated] template listo. clips: ${Object.keys(clips).join(', ')}`);
    return _template;
  })().catch(err => {
    console.warn('[npc_animated] carga falló, se usará geometría horneada:', err.message);
    _ready = false;
    _template = null;
    return null;
  });

  return _loading;
}

// ============================================================
// Instancia por goblin
// ============================================================

/**
 * Crea una instancia animada (clon + mixer + actions). Devuelve null si el
 * template no está listo (el caller cae al pipeline horneado).
 * @returns {null | { root, mixer, actions, state, isReacting }}
 */
export function createAnimatedInstance() {
  if (!_ready || !_template) return null;

  // SkeletonUtils.clone: esqueleto propio (no compartido) — clave para que
  // cada goblin se anime independiente. Igual que multiplayer.js con peers.
  const root = SkeletonUtils.clone(_template.mesh);
  // Sesión 39 FIX: aplicar EXPLÍCITAMENTE orientación + escala + grounding
  // calculados en loadAnimatedTemplate. El clone copia transforms del template,
  // pero el grounding (position.y) lo guardamos aparte para no contaminar la
  // medición del bbox; lo aplicamos acá. Sin esto el goblin FLOTA.
  if (_xform) {
    root.rotation.x = _xform.rotX;
    root.scale.setScalar(_xform.scaleFactor);
    root.position.y = _xform.groundOffsetY;
  } else {
    root.scale.copy(_template.mesh.scale);
  }

  // Materiales propios por instancia (para el flash sin afectar a los demás).
  const bodyMaterials = [];
  root.traverse(o => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.emissive) bodyMaterials.push(m); }
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const [name, clip] of Object.entries(_template.clips)) {
    const a = mixer.clipAction(clip);
    a.setEffectiveWeight(1);
    a.setEffectiveTimeScale(1);
    actions[name] = a;
  }

  // Sesión 40 v2 — AUTO-GROUND POR MALLA. La versión v1 medía HUESOS de pie,
  // pero en este esqueleto los huesos toe/foot reportan Y que NO sigue a la
  // malla visible (medido: el toe daba y~158 cuando el pie visible estaba
  // abajo). Por eso "plantar el hueso" hundía el goblin. La medición CORRECTA
  // es el vértice MÁS BAJO de la malla skinneada real (lo que se ve). Probado
  // sobre el GLB: planta idle/walk/run/react en y=0.000 exacto.
  const skinnedMeshes = [];
  root.traverse(o => {
    if (o.isSkinnedMesh && o.geometry && o.geometry.attributes.position) {
      skinnedMeshes.push(o);
    }
  });

  const inst = {
    root, mixer, actions, bodyMaterials,
    state: null, isReacting: false, _reactTimer: 0,
    _skinnedMeshes: skinnedMeshes,
    _gtmp: new THREE.Vector3(),
    _baseY: _xform ? _xform.groundOffsetY : 0,
  };
  if (skinnedMeshes.length === 0) {
    console.warn('[npc_animated] sin mallas skinneadas → auto-ground OFF, uso offset estático');
  } else {
    console.log(`[npc_animated] auto-ground por malla (${skinnedMeshes.length} mesh)`);
  }

  // Estado inicial: quieto → idle. Forzamos un sample del mixer YA para que el
  // primer frame visible sea idle, no la bind pose (T). Sesión 40.
  setLocomotion(inst, false, 0);
  try {
    inst.mixer.update(0);   // evaluar pose inicial (idle frame 0) sin avanzar
    groundToFeet(inst);     // y plantarlo de una
  } catch {}
  return inst;
}

function fadeTo(inst, name, fade = 0.15) {
  const next = inst.actions[name];
  if (!next) return false;
  if (inst._current === next) return true;
  next.reset();
  next.setEffectiveWeight(1);
  next.play();
  if (inst._current) next.crossFadeFrom(inst._current, fade, true);
  inst._current = next;
  return true;
}

/**
 * Selecciona walk/run/idle según si el goblin se mueve.
 * @param {boolean} moving  ¿se desplaza este frame?
 * @param {number}  speed   magnitud aprox del desplazamiento (para walk vs run)
 */
export function setLocomotion(inst, moving, speed = 0) {
  if (!inst || inst.isReacting) return; // react manda mientras dura

  if (moving) {
    let want = (speed > 0.12 && inst.actions.run) ? 'run' : 'walk';
    if (!inst.actions[want]) want = inst.actions.walk ? 'walk' : 'run';
    if (!want || !inst.actions[want]) return;
    if (inst.state === want) return;
    const a = inst.actions[want];
    a.paused = false;
    fadeTo(inst, want, 0.15);
    inst.state = want;
    return;
  }

  // QUIETO. Preferencia: idle real > walk pausado en un frame plantado > bind
  // pose (T). Sesión 40: si el GLB trae 'idle' (debería), se reproduce y el
  // goblin respira parado. Si NO está (GLB viejo / merge sin idle), en vez de
  // caer a la T-pose (brazos en cruz, feo) congelamos un frame de WALK: piernas
  // juntas-ish, brazos a los lados, mucho más presentable. El auto-ground lo
  // mantiene a ras de suelo en cualquier caso.
  if (inst.state === '__still') return;
  if (inst.actions.idle) {
    const a = inst.actions.idle;
    a.paused = false;
    fadeTo(inst, 'idle', 0.2);
  } else if (inst.actions.walk || inst.actions.run) {
    const name = inst.actions.walk ? 'walk' : 'run';
    fadeTo(inst, name, 0.2);
    // Pausar en un frame "de apoyo" (ambos pies cerca del suelo) en vez de T.
    const a = inst.actions[name];
    if (a) { a.time = a.getClip().duration * 0.5; a.paused = true; }
  } else {
    // Sin clips de locomoción tampoco: último recurso, bind pose.
    try { inst.mixer.stopAllAction(); } catch {}
    inst._current = null;
  }
  inst.state = '__still';
}

/** Dispara la animación React como one-shot (cuando lo golpean). */
export function triggerReact(inst) {
  if (!inst) return false;
  const a = inst.actions.react;
  if (!a) return false;            // sin clip react → no-op (caller hace flash igual)
  // Sesión 40 — si YA está reaccionando y le pegan otra vez, REINICIAMOS el
  // react (no lo ignoramos). Antes con isReacting se descartaba el 2º golpe y
  // parecía que "no reaccionaba" al pegarle rápido.

  const clipMs = a.getClip().duration * 1000;
  const useNatural = clipMs <= REACT_TARGET_MS;
  const timeScale = useNatural ? 1 : (clipMs / REACT_TARGET_MS);
  const dur = useNatural ? clipMs : REACT_TARGET_MS;

  inst.isReacting = true;
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = false;
  a.setEffectiveTimeScale(timeScale);
  a.setEffectiveWeight(1);
  a.play();
  if (inst._current) a.crossFadeFrom(inst._current, 0.08, true);
  inst._current = a;
  inst._reactTimer = dur;
  return true;
}

/**
 * Sesión 40 — AUTO-GROUND. Planta el hueso de pie más bajo en y=0 (+tweak)
 * ajustando root.position.y. Se llama CADA FRAME tras avanzar el mixer, así
 * que funciona para CUALQUIER pose (quieto/walk/run/react) sin un offset por
 * animación. Mata el flote Y el hundido de una: medimos dónde está el pie de
 * verdad y lo apoyamos. Es el equivalente esquelético al horneado de los NPCs
 * estáticos (que plantan los pies en y=0 al hornear).
 *
 * Por qué un solo paso basta: el group del goblin está en y=0 y la rotación es
 * solo en Y → mover root.position.y en `delta` mueve el Y mundial de TODOS los
 * huesos exactamente `delta`. Medimos el pie, calculamos delta = 0 - pieY, lo
 * aplicamos. Exacto, sin iterar.
 */
/**
 * Sesión 40 v2 — AUTO-GROUND POR MALLA. Planta el vértice MÁS BAJO de la malla
 * skinneada en y=0 (+tweak) ajustando root.position.y, CADA FRAME. Funciona para
 * cualquier pose sin offset por animación. Probado sobre el GLB real: idle, walk,
 * run y react quedan en y=0.000.
 *
 * Por qué la malla y no los huesos: en este esqueleto los huesos toe/foot
 * reportan una Y que NO corresponde al pie visible (artefacto del rig). Medir el
 * vértice skinneado real es lo que se ve y nunca miente.
 *
 * Rendimiento (móvil): NO recorremos todos los vértices cada frame. Muestreamos
 * con paso (stride) — para detectar el punto más bajo alcanza con una muestra
 * densa. STRIDE ajustable; con ~120 muestras por goblin el costo es trivial.
 *
 * Un solo paso basta: el group está en y=0 y solo rota en Y → mover
 * root.position.y en delta mueve la malla entera ese delta. Medimos, corregimos.
 */
const _GROUND_SAMPLES_TARGET = 120;  // muestras de vértice por mesh (suficiente p/ el mínimo)

function groundToFeet(inst) {
  if (!GOBLIN_AUTOGROUND) return;
  const meshes = inst._skinnedMeshes;
  if (!meshes || meshes.length === 0) return;
  inst.root.updateMatrixWorld(true);
  const v = inst._gtmp;
  let minY = Infinity;
  for (const sm of meshes) {
    const pos = sm.geometry.attributes.position;
    if (!pos) continue;
    const count = pos.count;
    // stride para tocar ~_GROUND_SAMPLES_TARGET vértices (mínimo 1).
    const stride = Math.max(1, Math.floor(count / _GROUND_SAMPLES_TARGET));
    for (let i = 0; i < count; i += stride) {
      v.fromBufferAttribute(pos, i);
      sm.applyBoneTransform ? sm.applyBoneTransform(i, v) : sm.boneTransform?.(i, v);
      v.applyMatrix4(sm.matrixWorld);
      if (v.y < minY) minY = v.y;
    }
  }
  if (!Number.isFinite(minY)) return;
  const target = GOBLIN_Y_TWEAK;          // suelo (0) + ajuste de suela
  const delta = target - minY;
  inst.root.position.y += Math.max(-3, Math.min(3, delta));
}

/**
 * Avanza el mixer. Llamar cada frame desde npc_renderer.updateInterpolation.
 * @param {number} dtSec  delta en segundos
 */
export function updateAnimatedInstance(inst, dtSec) {
  if (!inst || !inst.mixer) return;
  inst.mixer.update(dtSec);
  groundToFeet(inst);   // Sesión 40 — plantar pies tras animar (anti-flote/hundido)
  if (inst.isReacting) {
    inst._reactTimer -= dtSec * 1000;
    if (inst._reactTimer <= 0) {
      inst.isReacting = false;
      inst._reactTimer = 0;
      // Sesión 40 — al terminar el React, NO forzar bind pose (T). Limpiamos el
      // estado y dejamos que setLocomotion vuelva a elegir la pose de reposo
      // (idle real, o walk pausado como fallback). Así no queda en T tras pegarle.
      try {
        if (inst.actions.react) {
          inst.actions.react.setEffectiveTimeScale(1);
        }
      } catch {}
      inst.state = null;        // forzar re-evaluación
      inst._current = inst.actions.react || inst._current;
      setLocomotion(inst, false, 0);   // vuelve a idle/walk-pausado, nunca T
    }
  }
}

/** Libera recursos de una instancia (al despawnear el goblin). */
export function disposeAnimatedInstance(inst) {
  if (!inst) return;
  try { inst.mixer?.stopAllAction(); } catch {}
  try {
    inst.root?.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });
  } catch {}
}

// ============================================================
// Sesión 40 — Herramientas de debug live (Eruda en el móvil)
// ============================================================
// Setters para tunear sin recompilar. Devuelven el valor actual si no se pasa
// argumento. El estado del template/clips lo lee window.__goblinDebug (en
// npc_renderer, que tiene acceso a las instancias vivas).
export function setYTweak(v) {
  if (typeof v === 'number' && Number.isFinite(v)) GOBLIN_Y_TWEAK = v;
  return GOBLIN_Y_TWEAK;
}
export function setAutoGround(on) {
  if (typeof on === 'boolean') GOBLIN_AUTOGROUND = on;
  return GOBLIN_AUTOGROUND;
}
export function getGroundState() {
  return {
    autoGround: GOBLIN_AUTOGROUND,
    yTweak: GOBLIN_Y_TWEAK,
    templateReady: _ready,
    clips: _template ? Object.keys(_template.clips) : [],
    xform: _xform,
  };
}

/** Lee el estado de grounding de UNA instancia viva (para el probe). */
export function probeInstance(inst) {
  if (!inst) return null;
  let minMeshY = Infinity;
  if (inst._skinnedMeshes && inst._skinnedMeshes.length) {
    inst.root.updateMatrixWorld(true);
    const v = inst._gtmp || new THREE.Vector3();
    for (const sm of inst._skinnedMeshes) {
      const pos = sm.geometry.attributes.position;
      if (!pos) continue;
      const stride = Math.max(1, Math.floor(pos.count / 120));
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i);
        sm.applyBoneTransform ? sm.applyBoneTransform(i, v) : sm.boneTransform?.(i, v);
        v.applyMatrix4(sm.matrixWorld);
        if (v.y < minMeshY) minMeshY = v.y;
      }
    }
  }
  return {
    state: inst.state,
    isReacting: inst.isReacting,
    currentAction: inst._current ? inst._current.getClip()?.name : null,
    rootY: +inst.root.position.y.toFixed(3),
    lowestMeshWorldY: Number.isFinite(minMeshY) ? +minMeshY.toFixed(3) : null,
    isAnimatedMesh: !!(inst._skinnedMeshes && inst._skinnedMeshes.length),
  };
}

if (typeof window !== 'undefined') {
  window.__goblinY = (v) => setYTweak(v);
  window.__goblinAutoGround = (on) => setAutoGround(on);
  window.__goblinState = () => getGroundState();
}
