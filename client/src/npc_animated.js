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

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const ANIM_BASE = `${R2_BASE}/animations`;

// Qué tipos de NPC usan el pipeline animado. El resto sigue horneado.
export const ANIMATED_NPC_TYPES = new Set(['goblin']);

// Altura objetivo (debe coincidir con NPC_TARGET_HEIGHTS de npc_renderer).
const GOBLIN_TARGET_HEIGHT = 1.6;

// Fuentes de clips. 'embedded' = viene dentro del GLB. Lo demás = FBX en R2.
// loop:true  → locomoción (se repite). loop:false → one-shot (react).
// stripRoot:true → quita root motion (locomoción; mantiene pos del server).
const CLIP_SOURCES = {
  run:   { kind: 'embedded', loop: true,  stripRoot: true },
  walk:  { kind: 'fbx', file: 'Unarmed_Walk_Forward.fbx', loop: true,  stripRoot: true },
  react: { kind: 'fbx', file: 'Reaction.fbx',             loop: false, stripRoot: true },
  // Cuando subas un idle/attack del goblin, agregá acá:
  // idle:   { kind: 'fbx', file: 'Goblin_Idle.fbx',   loop: true,  stripRoot: true },
  // attack: { kind: 'fbx', file: 'Goblin_Attack.fbx', loop: false, stripRoot: true },
};

const REACT_TARGET_MS = 400;   // igual que el player: react acelerado a ~400ms

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
 * Normaliza los nombres de track para que liguen al rig clonado.
 * FBXLoader a veces prefija con el nombre del armature ("Armature|mixamorig:Hips").
 * Three liga por nombre de nodo, así que recortamos todo lo previo a "mixamorig:".
 */
function normalizeTrackNames(clip) {
  for (const track of clip.tracks) {
    const idx = track.name.indexOf('mixamorig:');
    if (idx > 0) track.name = track.name.slice(idx);
  }
  return clip;
}

/**
 * Elimina el track de POSICIÓN de las caderas (root motion horizontal).
 * El goblin anima en el sitio; su posición la controla el server.
 * Mantiene Y para no hundirlo si la anim tuviera offset vertical de bind.
 */
function stripRootMotion(clip) {
  clip.tracks = clip.tracks.filter(t => {
    // Quitar SOLO los tracks de position de Hips (root). Las rotaciones se
    // conservan (son las que hacen el movimiento de piernas/brazos).
    return !/mixamorig:Hips\.position$/i.test(t.name);
  });
  return clip;
}

function prepClip(clip, name, cfg) {
  clip = clip.clone();
  clip.name = name;
  normalizeTrackNames(clip);
  if (cfg.stripRoot) stripRootMotion(clip);
  return clip;
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
    const fbxLoader = new FBXLoader();

    // 1) Malla + esqueleto + clip "run" embebido
    const gltf = await gltfLoader.loadAsync(goblinGlbUrl);
    const mesh = gltf.scene;

    // ----------------------------------------------------------------
    // Sesión 39 FIX (goblin flotando/acostado): replicamos lo que hace
    // bakeGlbModel con los NPCs horneados, que mi pipeline animado se
    // había saltado:
    //   (a) corregir orientación si el modelo viene Z-up (acostado),
    //   (b) escalar a la altura objetivo,
    //   (c) GROUNDING: bajar el modelo para que los pies queden en Y=0
    //       (sin esto FLOTA, que es justo el bug del screenshot).
    // Lo importante: en el pipeline animado NO horneamos geometría (la malla
    // está viva con su esqueleto), así que estos ajustes van al transform del
    // objeto root y se guardan para aplicarlos a CADA clon de instancia.
    // ----------------------------------------------------------------

    // (a) Orientación: si la dimensión vertical real no es Y (viene acostado
    // en Z, típico de FBX Z-up mal convertidos), rotamos -90° en X.
    mesh.updateMatrixWorld(true);
    let probe = new THREE.Box3().setFromObject(mesh);
    let szX = probe.max.x - probe.min.x;
    let szY = probe.max.y - probe.min.y;
    let szZ = probe.max.z - probe.min.z;
    let rotX = 0;
    if (szZ > szY && szZ > szX * 0.6) {
      // El eje "largo" es Z → está acostado boca arriba/abajo. Lo paramos.
      rotX = -Math.PI / 2;
      mesh.rotation.x = rotX;
      mesh.updateMatrixWorld(true);
      probe = new THREE.Box3().setFromObject(mesh);
    }

    // (b) Escala a la altura objetivo, medida sobre el eje vertical ya correcto.
    const sizeY = probe.max.y - probe.min.y;
    let scaleFactor = sizeY > 0.001 ? GOBLIN_TARGET_HEIGHT / sizeY : 1.0;
    // Clamp defensivo (Mixamo a veces viene en cm → escalas minúsculas).
    if (!(scaleFactor > 0) || scaleFactor > 1000 || scaleFactor < 0.00001) scaleFactor = 1.0;
    mesh.scale.setScalar(scaleFactor);
    mesh.updateMatrixWorld(true);

    // (c) Grounding: tras escalar, medir de nuevo y bajar para que min.y = 0.
    const groundedBox = new THREE.Box3().setFromObject(mesh);
    const groundOffsetY = -groundedBox.min.y;

    mesh.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
      }
    });

    // Guardamos los transforms calculados para aplicarlos a cada instancia.
    _xform = { rotX, scaleFactor, groundOffsetY };
    console.log(`[npc_animated] transform: rotX=${rotX.toFixed(2)} scale=${scaleFactor.toFixed(4)} groundY=${groundOffsetY.toFixed(3)}`);

    const clips = {};

    // 2) Clip embebido (run)
    for (const [name, cfg] of Object.entries(CLIP_SOURCES)) {
      if (cfg.kind !== 'embedded') continue;
      const src = (gltf.animations || [])[0];
      if (src) clips[name] = prepClip(src, name, cfg);
      else console.warn(`[npc_animated] '${name}' embebido no encontrado en GLB`);
    }

    // 3) Clips FBX sueltos (walk, react). Carga tolerante: si uno falla,
    //    seguimos sin él (no-op para ese estado).
    await Promise.all(
      Object.entries(CLIP_SOURCES)
        .filter(([, cfg]) => cfg.kind === 'fbx')
        .map(async ([name, cfg]) => {
          try {
            const fbx = await fbxLoader.loadAsync(`${ANIM_BASE}/${cfg.file}`);
            const src = (fbx.animations || [])[0];
            if (src) clips[name] = prepClip(src, name, cfg);
            else console.warn(`[npc_animated] '${cfg.file}' sin animaciones`);
          } catch (err) {
            console.warn(`[npc_animated] no se pudo cargar '${cfg.file}':`, err.message);
          }
        })
    );

    if (!clips.walk && !clips.run) {
      throw new Error('sin clips de locomoción (walk/run) — abortando pipeline animado');
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

  const inst = { root, mixer, actions, bodyMaterials, state: null, isReacting: false, _reactTimer: 0 };

  // Estado inicial: quieto. Sin idle propio → pose congelada neutra (frame 0
  // del walk/run), nunca T-pose.
  setLocomotion(inst, false, 0);
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
  let want;
  if (moving) {
    want = (speed > 0.12 && inst.actions.run) ? 'run' : 'walk';
    if (!inst.actions[want]) want = inst.actions.walk ? 'walk' : 'run';
  } else {
    // Sin idle real: usar idle si existe, si no, congelar locomoción en frame 0.
    want = inst.actions.idle ? 'idle' : (inst.actions.walk ? 'walk' : 'run');
  }
  if (!want || !inst.actions[want]) return;

  if (inst.state === (moving ? want : '__still')) return;

  if (!moving && !inst.actions.idle) {
    // Congelar: reproducir el clip de locomoción pero pausado en frame 0.
    const a = inst.actions[want];
    fadeTo(inst, want, 0.1);
    a.paused = true;
    a.time = 0;
    inst.state = '__still';
  } else {
    const a = inst.actions[want];
    a.paused = false;
    fadeTo(inst, want, 0.15);
    inst.state = moving ? want : '__still';
  }
}

/** Dispara la animación React como one-shot (cuando lo golpean). */
export function triggerReact(inst) {
  if (!inst) return false;
  const a = inst.actions.react;
  if (!a) return false;            // sin clip react → no-op (caller hace flash igual)
  if (inst.isReacting) return false;

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
 * Avanza el mixer. Llamar cada frame desde npc_renderer.updateInterpolation.
 * @param {number} dtSec  delta en segundos
 */
export function updateAnimatedInstance(inst, dtSec) {
  if (!inst || !inst.mixer) return;
  inst.mixer.update(dtSec);
  if (inst.isReacting) {
    inst._reactTimer -= dtSec * 1000;
    if (inst._reactTimer <= 0) {
      inst.isReacting = false;
      inst._reactTimer = 0;
      if (inst.actions.react) inst.actions.react.setEffectiveTimeScale(1);
      // Forzar re-selección de locomoción en el próximo setLocomotion
      inst.state = null;
      inst._current = null;
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
