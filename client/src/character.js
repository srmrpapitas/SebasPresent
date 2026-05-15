/**
 * SebasPresent — Character module (Slice 5d — Full anim set)
 *
 * Carga el Mixamo Remy + un set completo de animaciones desde R2:
 *
 *   Locomoción no-combate:
 *     idle, walk_forward, walk_back, walk_left, walk_right,
 *     run_forward, run_back, run_left, run_right
 *
 *   Locomoción combate (con espada en mano):
 *     sword_idle, sword_run_forward, sword_run_back, sword_run_left, sword_run_right
 *
 *   One-shots:
 *     attack_1..4 (sword), punching (unarmed), draw, sheath, death, sword_death, drink
 *
 * API pública:
 *   load(onProgress) — carga FBX + todas las animaciones
 *   play(state, direction='forward')    — locomoción/idle. state: 'idle'|'walk'|'run'.
 *   setCombatStance(on)                 — modo armado/desarmado. Re-mapea idle/walk/run.
 *   playDraw() / playSheath()           — one-shot al entrar/salir de combate. setCombatStance se hace solo.
 *   playAttack()                        — random sword_1..4 si stance on, punching si off
 *   playDeath()                         — sword_death si armed, death si no. Clampea al final.
 *   playDrink()                         — one-shot drinking (food/potions futuro)
 *   revive()                            — limpia flag de muerte tras respawn
 *   update(dt), dispose()
 *
 * Compatibilidad hacia atrás: play('idle'), play('walk'), play('run') sin
 * segundo arg siguen funcionando (default 'forward').
 *
 * Los assets viven en R2 fuera del deploy de Pages porque el FBX del
 * character pesa más del límite de 25 MiB de Cloudflare Pages.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const ANIM_BASE = `${CDN_BASE}/animations`;

// ============================================================
// Mapeo nombre lógico -> filename en R2/animations/
// ============================================================
const ANIM_FILES = {
  // Locomoción no-combate
  idle:         'Idle.fbx',
  walk_forward: 'Walking.fbx',
  walk_back:    'Walk_Back.fbx',
  walk_left:    'Walk_Left.fbx',
  walk_right:   'Walk_Right.fbx',
  run_forward:  'Running.fbx',
  run_back:     'Run_Back.fbx',
  run_left:     'Run_Left.fbx',
  run_right:    'Run_Right.fbx',

  // Locomoción combate
  sword_idle:        'Sword_Idle.fbx',
  sword_run_forward: 'Sword_Run.fbx',
  sword_run_back:    'Run_Back.fbx',     // no hay sword version, fallback
  sword_run_left:    'Sword_Strafe.fbx',
  sword_run_right:   'Sword_Strafe_2.fbx',

  // One-shots de combate
  attack_1:    'Sword_Attack_1.fbx',
  attack_2:    'Sword_Attack_2.fbx',
  attack_3:    'Sword_Attack_3.fbx',
  attack_4:    'Sword_Attack_4.fbx',
  draw:        'Sword_Draw.fbx',
  sheath:      'Sword_Sheath.fbx',
  sword_death: 'Sword_Death.fbx',

  // One-shots genéricos
  punching: 'Punching.fbx',
  death:    'Death_Backward.fbx',
  drink:    'Drinking.fbx',
};

// Anims que SI fallan, el juego se rompe. El resto, soft-fail con warning.
const CRITICAL_ANIMS = ['idle', 'walk_forward', 'run_forward'];

// Slice 5d FIX — One-shots con root motion problemático que hay que strippear.
// Sword_Attack_1/2/3 desplazan Hips 5-7m por swing.
// Sword_Death y Death_Backward llevan Hips a 1.5m bajo suelo.
// Sword_Draw/Sheath tienen drift pequeño pero acumulan si los repites.
// Para idle/walk/run NO strippeamos porque su bob vertical (Y) hace
// que el char se vea natural, y NO tienen drift horizontal (verificado).
const CLIPS_TO_STRIP_ROOT = new Set([
  'attack_1', 'attack_2', 'attack_3', 'attack_4',
  'punching',
  'draw', 'sheath',
  'death', 'sword_death',
  'drink',
]);

const CHARACTER_SCALE = 0.01;  // FBX en cm, escena en m
const CROSSFADE = 0.22;
const ATTACK_TICK_MS = 600;    // duración objetivo del swing — coincide con TICK_MS server
const DRAW_MS = 700;
const SHEATH_MS = 700;

export class Character {
  constructor() {
    this.group = null;
    this.mesh = null;
    this.mixer = null;
    this.actions = {};   // name -> AnimationAction
    this.clips = {};     // name -> AnimationClip (para clonar a peers)
    this.current = null;
    this.loaded = false;

    // Estado lógico
    this.combatStance = false;     // ¿espada en mano?
    this.isAttacking = false;
    this.isInTransition = false;   // draw/sheath/drink en curso
    this.isDead = false;
    this.attackCycle = 0;          // qué sword_attack toca (1..4 round-robin)
  }

  // ============================================================
  // LOAD
  // ============================================================
  async load(onProgress) {
    const loader = new FBXLoader();

    onProgress?.(0, 'Descargando personaje…');
    const characterFBX = await loadFBXWithProgress(
      loader,
      `${CDN_BASE}/character.fbx`,
      p => onProgress?.(p * 0.55, `Descargando personaje… ${Math.round(p * 100)}%`)
    );

    normalizeBones(characterFBX);
    characterFBX.scale.setScalar(CHARACTER_SCALE);
    characterFBX.traverse(obj => {
      if (obj.isMesh) {
        if (Array.isArray(obj.material)) obj.material.forEach(prepMaterial);
        else if (obj.material) prepMaterial(obj.material);
        obj.frustumCulled = false;
      }
    });

    this.group = new THREE.Group();
    this.group.add(characterFBX);
    this.mesh = characterFBX;
    this.mixer = new THREE.AnimationMixer(characterFBX);

    // Slice 5d FIX — colectar nombres de bones del character DESPUÉS de
    // que pase por FBXLoader (que limpia el ':' del naming) y normalizeBones.
    // Los usaremos para adaptar dinámicamente los track names de cada clip,
    // que pueden venir con/sin ':' según el FBX origen.
    this._boneNames = new Set();
    characterFBX.traverse(o => {
      if (o.isBone && o.name) this._boneNames.add(o.name);
    });
    // Log discreto para debug — sirve para confirmar el esquema en consola
    const sample = [...this._boneNames].filter(n => /hips|spine|head/i.test(n)).slice(0, 4);
    if (sample.length) console.log('[character] bone scheme sample:', sample);

    // ---- Animaciones críticas (throw si fallan) ----
    onProgress?.(0.55, 'Cargando animaciones críticas…');
    const criticalEntries = CRITICAL_ANIMS.map(name => [name, ANIM_FILES[name]]);
    const criticalFBXs = await Promise.all(
      criticalEntries.map(([_, file]) => loader.loadAsync(`${ANIM_BASE}/${file}`))
    );
    for (let i = 0; i < criticalEntries.length; i++) {
      const [name] = criticalEntries[i];
      if (!this._registerClip(criticalFBXs[i], name)) {
        throw new Error(`Animación crítica sin clip dentro del FBX: ${name}`);
      }
    }

    // ---- Resto en paralelo, soft-fail. Dedupe por filename (sword_run_back -> Run_Back.fbx).
    onProgress?.(0.72, 'Cargando animaciones de combate…');
    const optionalEntries = Object.entries(ANIM_FILES)
      .filter(([name]) => !CRITICAL_ANIMS.includes(name));

    const fileToNames = new Map();
    for (const [name, file] of optionalEntries) {
      if (!fileToNames.has(file)) fileToNames.set(file, []);
      fileToNames.get(file).push(name);
    }
    const files = [...fileToNames.keys()];
    const optResults = await Promise.allSettled(
      files.map(file => loader.loadAsync(`${ANIM_BASE}/${file}`))
    );
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const names = fileToNames.get(file);
      const res = optResults[i];
      if (res.status !== 'fulfilled') {
        console.warn(`[character] anim file failed: ${file} (${names.join(', ')})`, res.reason?.message);
        continue;
      }
      // Si varios nombres apuntan al mismo file, clonamos el clip por nombre
      // para que cada uno tenga su propio AnimationAction independiente.
      for (const name of names) {
        const ok = this._registerClip(res.value, name, /*cloneClip*/ names.length > 1);
        if (!ok) console.warn(`[character] anim ${name} (${file}) sin clip dentro del FBX`);
      }
    }

    // One-shots: LoopOnce, no clamp (vuelven a current al terminar)
    for (const name of ['attack_1','attack_2','attack_3','attack_4','punching','draw','sheath','drink']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
    }
    // Deaths: LoopOnce + clamp (queda tumbado)
    for (const name of ['death','sword_death']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }

    // Arranca en idle
    this.actions.idle.play();
    this.current = this.actions.idle;
    this.loaded = true;
    onProgress?.(1, 'Listo');
    return this.group;
  }

  _registerClip(fbx, name, cloneClip = false) {
    if (!fbx.animations || fbx.animations.length === 0) return false;
    let clip = fbx.animations[0];
    if (cloneClip) clip = clip.clone();
    clip.name = name;
    // Slice 5d FIX: adaptar nombres de tracks al esquema de bones real del
    // character. FBXLoader devuelve tracks tipo "mixamorigHips.position" (sin
    // ':'), pero el character puede tener bones "mixamorig:Hips" (con ':'),
    // "mixamorigHips" (sin ':'), o "Hips" (bare). Sin esta adaptación, los
    // tracks no encuentran bones y el clip "ejecuta" sin animar nada → T-pose.
    adaptTrackNamesToSkeleton(clip, this._boneNames);
    // Slice 5d FIX: strip de root motion para clips one-shot.
    // Sword_Attack_1/2/3 mueven los Hips 5-7m hacia adelante por swing.
    // Sword_Death/Death_Backward mueven Hips a Y=24 (1.5m bajo el suelo).
    // Si no eliminamos esa traslación, el player se desplaza/entierra cada
    // vez que se reproduce. La rotación de hombros/codos/muñecas (que SÍ
    // hace el swing visible) se mantiene. Para locomoción (idle/walk/run)
    // NO strippeamos, porque su Hips.position aporta el bob vertical natural.
    if (CLIPS_TO_STRIP_ROOT.has(name)) {
      stripHipsPositionTrack(clip);
    }
    this.clips[name] = clip;
    const action = this.mixer.clipAction(clip);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    this.actions[name] = action;
    return true;
  }

  // ============================================================
  // PUBLIC: locomoción + idle
  // ============================================================
  /**
   * state: 'idle' | 'walk' | 'run'
   * direction: 'forward' | 'back' | 'left' | 'right' (default 'forward')
   *
   * Si combatStance=true, se re-mapea a versiones sword_*.
   */
  play(state, direction = 'forward') {
    if (!this.loaded) return;
    if (this.isAttacking || this.isInTransition || this.isDead) return;

    const name = this._resolveLocomotion(state, direction);
    const next = this.actions[name] || this.actions[this._fallbackLocomotion(state)];
    if (!next || next === this.current) return;
    this._crossFadeTo(next, CROSSFADE);
  }

  _resolveLocomotion(state, direction) {
    if (state === 'idle') {
      return this.combatStance ? 'sword_idle' : 'idle';
    }
    if (this.combatStance) {
      // walk y run en combate: ambos van a sword_run_*
      const key = `sword_run_${direction}`;
      if (this.actions[key]) return key;
      return 'sword_run_forward';
    }
    const key = `${state}_${direction}`;
    if (this.actions[key]) return key;
    return `${state}_forward`;
  }

  _fallbackLocomotion(state) {
    if (state === 'idle') return 'idle';
    return state === 'run' ? 'run_forward' : 'walk_forward';
  }

  // ============================================================
  // PUBLIC: stance (entrar/salir de modo combate)
  // ============================================================
  setCombatStance(on) {
    this.combatStance = !!on;
  }

  /** Saca la espada. One-shot. Al terminar combatStance=true. */
  playDraw() {
    if (!this.loaded || this.isDead) return;
    const action = this.actions.draw;
    if (!action) {
      this.combatStance = true;
      return;
    }
    if (this.isInTransition) return;

    this._scaleOneShot(action, DRAW_MS);
    this._crossFadeTo(action, 0.08);
    this.isInTransition = true;

    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    setTimeout(() => {
      this.combatStance = true;
      this.isInTransition = false;
      this.current = null;
    }, dur + 20);
  }

  /** Guarda la espada. One-shot. Al terminar combatStance=false. */
  playSheath() {
    if (!this.loaded || this.isDead) return;
    const action = this.actions.sheath;
    if (!action) {
      this.combatStance = false;
      return;
    }
    if (this.isInTransition) return;

    this._scaleOneShot(action, SHEATH_MS);
    this._crossFadeTo(action, 0.08);
    this.isInTransition = true;

    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    setTimeout(() => {
      this.combatStance = false;
      this.isInTransition = false;
      this.current = null;
    }, dur + 20);
  }

  // ============================================================
  // PUBLIC: swing de ataque (one-shot por combat tick)
  // ============================================================
  /**
   * En modo armed: round-robin sword_attack_1..4 (cycle, no random, para
   * que se vea variedad sin repetir). En unarmed: punching.
   * Comprime el clip a ATTACK_TICK_MS para que coincida con el tick server.
   */
  playAttack() {
    if (!this.loaded || this.isDead) return;
    if (this.isAttacking || this.isInTransition) return;

    let action;
    if (this.combatStance) {
      this.attackCycle = (this.attackCycle % 4) + 1;
      action = this.actions[`attack_${this.attackCycle}`]
            || this.actions.attack_1
            || this.actions.punching;
    } else {
      action = this.actions.punching;
    }
    if (!action) return;

    this._scaleOneShot(action, ATTACK_TICK_MS);
    this._crossFadeTo(action, 0.08);
    this.isAttacking = true;

    setTimeout(() => {
      this.isAttacking = false;
      this.current = null;
    }, ATTACK_TICK_MS + 20);
  }

  // ============================================================
  // PUBLIC: death + revive
  // ============================================================
  playDeath() {
    if (!this.loaded || this.isDead) return;
    const action = this.combatStance
      ? (this.actions.sword_death || this.actions.death)
      : (this.actions.death || this.actions.sword_death);
    if (!action) {
      this.isDead = true;
      return;
    }
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    if (this.current) action.crossFadeFrom(this.current, 0.15, true);
    action.play();
    this.current = action;
    this.isDead = true;
    this.isAttacking = false;
    this.isInTransition = false;
  }

  /** Tras respawn: limpia muerte, vuelve a idle no-combat. */
  revive() {
    this.isDead = false;
    this.isAttacking = false;
    this.isInTransition = false;
    this.combatStance = false;
    if (this.mixer) this.mixer.stopAllAction();
    const idle = this.actions.idle;
    if (idle) {
      idle.reset();
      idle.setEffectiveTimeScale(1);
      idle.setEffectiveWeight(1);
      idle.play();
      this.current = idle;
    }
  }

  // ============================================================
  // PUBLIC: drinking (food/potions futuro)
  // ============================================================
  playDrink() {
    if (!this.loaded || this.isDead) return;
    if (this.isAttacking || this.isInTransition) return;
    const action = this.actions.drink;
    if (!action) return;

    this._scaleOneShot(action, 900);
    this._crossFadeTo(action, 0.1);
    this.isInTransition = true;
    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    setTimeout(() => {
      this.isInTransition = false;
      this.current = null;
    }, dur + 20);
  }

  // ============================================================
  // PRIVATE helpers
  // ============================================================
  _scaleOneShot(action, targetMs) {
    // Configurar parámetros de la action ANTES de _crossFadeTo (que hace
    // el reset/play). reset() es benigno aquí; los efectos (setLoop, timeScale)
    // persisten al reset.
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    const clipMs = action.getClip().duration * 1000;
    const timeScale = clipMs > targetMs ? clipMs / targetMs : 1;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
  }

  _crossFadeTo(next, fadeMs) {
    // Orden correcto Three.js: reset → play → crossFadeFrom.
    // Si llamas crossFadeFrom antes de play(), la action destino no está
    // activa y el blend falla (T-pose durante la transición).
    next.reset();
    next.play();
    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, fadeMs, true);
    }
    this.current = next;
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================
  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }

  dispose() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.actions = {};
    this.clips = {};
    this.current = null;
    this.isAttacking = false;
    this.isInTransition = false;
    this.isDead = false;
    this.combatStance = false;
    if (this.group) {
      this.group.traverse(o => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
          else o.material.dispose?.();
        }
      });
      this.group = null;
    }
    this.mesh = null;
    this.loaded = false;
  }
}

// ============================================================
// Helpers fuera de la clase
// ============================================================
function normalizeBones(root) {
  root.traverse(child => {
    if (child.name && typeof child.name === 'string') {
      if (child.name.startsWith('mixamorig1:')) {
        child.name = 'mixamorig:' + child.name.slice('mixamorig1:'.length);
      }
    }
  });
}

/**
 * Slice 5d — Adapter universal de track names.
 *
 * Three.js FBXLoader produce tracks tipo "mixamorigHips.position" (limpia
 * los ':' porque rompen el split nombre.propiedad). Pero el character.fbx
 * puede tener bones llamados "mixamorig:Hips", "mixamorigHips" o "Hips"
 * según cómo fue exportado.
 *
 * Sin matchear, el clip se "reproduce" pero ningún PropertyBinding encuentra
 * su bone → la pose no cambia → T-pose.
 *
 * Este adapter detecta automáticamente el esquema del target skeleton
 * (boneNames) y renombra cada track para que matchee.
 *
 * Soporta los esquemas comunes:
 *   - "mixamorig:Hips"   (Mixamo standard, con dos puntos)
 *   - "mixamorigHips"    (FBXLoader-cleaned, sin dos puntos)
 *   - "mixamorig1:Hips"  (Mixamo dup con sufijo 1)
 *   - "Hips"             (bare)
 */
function adaptTrackNamesToSkeleton(clip, boneNames) {
  if (!boneNames || boneNames.size === 0) return;

  let adapted = 0;
  let dropped = 0;
  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const original = track.name.slice(0, dotIdx);
    const property = track.name.slice(dotIdx);   // incluye el "."

    // Si ya matchea exactamente, listo.
    if (boneNames.has(original)) continue;

    // Intentar todas las variantes posibles del bone name
    const candidates = generateBoneCandidates(original);
    let found = null;
    for (const c of candidates) {
      if (boneNames.has(c)) { found = c; break; }
    }
    if (found) {
      track.name = found + property;
      adapted++;
    } else {
      dropped++;
    }
  }
  if (adapted > 0 || dropped > 0) {
    console.log(`[character] clip "${clip.name}": ${adapted} tracks adaptados, ${dropped} sin match`);
  }
}

/**
 * Dado un track-bone-name como "mixamorigHips", devuelve una lista de
 * candidatos a probar contra el skeleton del character.
 */
function generateBoneCandidates(name) {
  const out = [];

  // Extraer la parte "core" (Hips, Spine, LeftArm...) quitando prefijos
  let core = name;
  const prefixes = ['mixamorig1:', 'mixamorig:', 'mixamorig1', 'mixamorig'];
  for (const p of prefixes) {
    if (core.startsWith(p)) { core = core.slice(p.length); break; }
  }
  // El : a veces queda como sufijo del prefijo, removerlo defensivamente
  if (core.startsWith(':')) core = core.slice(1);

  // Todas las variantes posibles
  out.push(name);                       // exacto
  out.push('mixamorig:' + core);        // con prefijo y :
  out.push('mixamorig' + core);         // con prefijo sin :
  out.push('mixamorig1:' + core);       // dup con :
  out.push('mixamorig1' + core);        // dup sin :
  out.push(core);                       // bare
  return out;
}

/**
 * Slice 5d FIX — Strip de root motion.
 *
 * Elimina las tracks que mueven los Hips (posición), preservando las
 * rotaciones de todos los huesos. Esto:
 *   - Mantiene visible la animación del swing/death/etc.
 *   - Pero impide que el clip empuje el esqueleto a 7m fuera de su origin
 *     o lo entierre 1.5m bajo el suelo.
 *
 * Los Hips quedan en el bind pose (su posición natural del skeleton del
 * character). El resto del cuerpo se anima sobre esa posición fija.
 */
function stripHipsPositionTrack(clip) {
  const before = clip.tracks.length;
  clip.tracks = clip.tracks.filter(t => {
    // Buscar tracks que muevan los Hips. El nombre puede ser cualquiera de
    // los esquemas: "mixamorig:Hips.position", "mixamorigHips.position", "Hips.position".
    const dotIdx = t.name.lastIndexOf('.');
    if (dotIdx < 0) return true;
    const boneName = t.name.slice(0, dotIdx);
    const property = t.name.slice(dotIdx + 1);
    if (property !== 'position') return true;
    // ¿Es el bone Hips (sin sub-bones)? Tras quitar prefix, debe ser "Hips" exacto.
    let core = boneName;
    const prefixes = ['mixamorig1:', 'mixamorig:', 'mixamorig1', 'mixamorig'];
    for (const p of prefixes) {
      if (core.startsWith(p)) { core = core.slice(p.length); break; }
    }
    if (core.startsWith(':')) core = core.slice(1);
    if (core === 'Hips') return false;   // drop
    return true;
  });
  const dropped = before - clip.tracks.length;
  if (dropped > 0) {
    console.log(`[character] clip "${clip.name}": stripped ${dropped} Hips.position track(s)`);
  }
}

function prepMaterial(mat) {
  if (mat.shininess !== undefined) mat.shininess = 0;
  if (mat.specular !== undefined && mat.specular.setHex) mat.specular.setHex(0x000000);
  mat.side = THREE.FrontSide;
  if (mat.alphaTest !== undefined) mat.alphaTest = 0.01;
}

function loadFBXWithProgress(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      evt => {
        if (evt.lengthComputable && evt.total > 0) onProgress(evt.loaded / evt.total);
      },
      reject
    );
  });
}
