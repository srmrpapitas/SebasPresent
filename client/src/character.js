/**
 * SebasPresent — Character module (Slice 5d — Full anim set + Sesión 24: weapon attach)
 *
 * Carga el Mixamo Remy + un set completo de animaciones desde R2.
 *
 * Sesión 24 — Equipment Nivel B (weapon 3D en mano):
 *   - attachWeapon(weaponId, weaponType): carga GLB desde R2/weapons/<id>.glb
 *     y lo añade al bone "mixamorig:RightHand". Si había arma previa, swap.
 *   - detachWeapon(): elimina el arma equipada.
 *   - Tabla WEAPON_TRANSFORMS con scale/rotation/offset por tipo.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const ANIM_BASE = `${CDN_BASE}/animations`;
const WEAPONS_BASE = `${CDN_BASE}/weapons`;

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
  sword_run_back:    'Run_Back.fbx',
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

const CRITICAL_ANIMS = ['idle', 'walk_forward', 'run_forward'];

const CLIPS_TO_STRIP_ROOT = new Set([
  'attack_1', 'attack_2', 'attack_3', 'attack_4',
  'punching',
  'draw', 'sheath',
  'death', 'sword_death',
  'drink',
  'walk_back', 'walk_left', 'walk_right',
  'run_back', 'run_left', 'run_right',
  'sword_run_forward',
  'sword_run_back',
  'sword_run_left',
  'sword_run_right',
]);

const CHARACTER_SCALE = 0.01;
const CROSSFADE = 0.22;
const ATTACK_TICK_MS = 600;
const DRAW_MS = 700;
const SHEATH_MS = 700;

// ============================================================
// Sesión 24 — Weapon attach config
// ============================================================
//
// Cada arma GLB tiene orientación/escala arbitrarias del autor 3D. Estos
// son OFFSETS por tipo de arma para que encajen bien en la mano derecha.
// Empezamos con valores razonables — si quedan torcidos/grandes, ajustamos
// los números aquí y subes el archivo otra vez.
//
// Las transformaciones se aplican AL MESH del arma, dentro del bone de la
// mano. El bone ya tiene la rotación correcta de la mano según anim.
//
// scale:  factor de escala uniforme (sobre el mesh sin escalar)
// position: offset XYZ desde el origen del bone (en metros)
// rotation: rotación XYZ en radianes (orden XYZ)
//
// CHARACTER_SCALE = 0.01 (cm→m), pero el bone ya está dentro de ese scale,
// así que los offsets aquí están en "espacio bone" que es ~cm. Por eso los
// numeritos son grandes.
const WEAPON_TRANSFORMS = {
  '1h_sword': {
    scale: 50.0,
    position: [3, 3, 0],
    rotation: [0, 0, Math.PI / 2],
  },
  '2h_sword': {
    scale: 60.0,
    position: [4, 4, 0],
    rotation: [0, 0, Math.PI / 2],
  },
  'bow': {
    scale: 100.0,
    position: [0, 5, 0],
    rotation: [Math.PI / 2, 0, 0],
  },
  'staff': {
    scale: 80.0,
    position: [2, 0, 0],
    rotation: [0, 0, 0],
  },
  'default': {
    scale: 50.0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  },
};

// Cache global de GLBs de armas para no descargar cada vez
const _weaponMeshCache = new Map();
const _gltfLoader = new GLTFLoader();

export class Character {
  constructor() {
    this.group = null;
    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.clips = {};
    this.current = null;
    this.loaded = false;

    this.combatStance = false;
    this.isAttacking = false;
    this.isInTransition = false;
    this.isDead = false;
    this.attackCycle = 0;

    // Sesión 24 — Weapon attach state
    this._rightHandBone = null;
    this._equippedWeaponMesh = null;
    this._equippedWeaponId = null;
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

    this._boneNames = new Set();
    characterFBX.traverse(o => {
      if (o.isBone && o.name) this._boneNames.add(o.name);
    });
    const sample = [...this._boneNames].filter(n => /hips|spine|head/i.test(n)).slice(0, 4);
    if (sample.length) console.log('[character] bone scheme sample:', sample);

    // Sesión 24 — Buscar bone de mano derecha y guardar referencia.
    // Soporta los esquemas comunes: mixamorig:RightHand, mixamorigRightHand, RightHand.
    this._rightHandBone = this._findBone(['mixamorig:RightHand', 'mixamorigRightHand', 'RightHand']);
    if (this._rightHandBone) {
      console.log('[character] right hand bone:', this._rightHandBone.name);
    } else {
      console.warn('[character] right hand bone NOT FOUND. Weapons will not be visible. Bones disponibles:',
        [...this._boneNames].filter(n => /hand|wrist/i.test(n)));
    }

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
      for (const name of names) {
        const ok = this._registerClip(res.value, name, names.length > 1);
        if (!ok) console.warn(`[character] anim ${name} (${file}) sin clip dentro del FBX`);
      }
    }

    for (const name of ['attack_1','attack_2','attack_3','attack_4','punching','draw','sheath','drink']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
    }
    for (const name of ['death','sword_death']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }

    this.actions.idle.play();
    this.current = this.actions.idle;
    this.loaded = true;
    onProgress?.(1, 'Listo');
    return this.group;
  }

  // ============================================================
  // Sesión 24 — Weapon attach/detach API
  // ============================================================
  /**
   * Equipa un arma 3D en la mano derecha del personaje.
   *
   * @param {string} weaponId - id del item (ej. 'sword_bronze'). Se usa
   *   para cargar el GLB desde R2/weapons/{weaponId}.glb.
   * @param {string} weaponType - tipo (1h_sword|2h_sword|bow|staff) para
   *   elegir las transformaciones de la tabla WEAPON_TRANSFORMS.
   */
  async attachWeapon(weaponId, weaponType) {
    if (!this.loaded) return;
    if (!this._rightHandBone) {
      console.warn('[character] attachWeapon: no hay right hand bone, no se puede equipar');
      return;
    }
    // Si ya hay un arma equipada, quitarla primero
    if (this._equippedWeaponMesh) {
      this.detachWeapon();
    }
    if (!weaponId) return;

    try {
      const mesh = await this._loadWeaponMesh(weaponId);
      const tf = WEAPON_TRANSFORMS[weaponType] || WEAPON_TRANSFORMS.default;

      mesh.scale.setScalar(tf.scale);
      mesh.position.set(tf.position[0], tf.position[1], tf.position[2]);
      mesh.rotation.set(tf.rotation[0], tf.rotation[1], tf.rotation[2]);

      this._rightHandBone.add(mesh);
      this._equippedWeaponMesh = mesh;
      this._equippedWeaponId = weaponId;
      console.log(`[character] arma "${weaponId}" (${weaponType}) attached`);
    } catch (err) {
      console.warn(`[character] attachWeapon failed:`, err.message);
    }
  }

  /**
   * Quita el arma actualmente equipada del bone (la libera para el siguiente
   * attachWeapon). El GLB queda en cache para reuso.
   */
  detachWeapon() {
    if (!this._equippedWeaponMesh || !this._rightHandBone) return;
    this._rightHandBone.remove(this._equippedWeaponMesh);
    this._equippedWeaponMesh = null;
    this._equippedWeaponId = null;
  }

  /**
   * Carga (con cache) el mesh del arma desde R2. Devuelve un clone para
   * que cada instancia tenga su propio mesh (necesario para multiplayer
   * cuando peers equipen las mismas armas).
   */
  async _loadWeaponMesh(weaponId) {
    if (_weaponMeshCache.has(weaponId)) {
      // Clone para que cada player tenga su instancia
      return _weaponMeshCache.get(weaponId).clone(true);
    }
    const url = `${WEAPONS_BASE}/${weaponId}.glb`;
    const gltf = await _gltfLoader.loadAsync(url);
    const base = gltf.scene;
    base.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (o.material) {
          // Material a FrontSide para no doblar gasto en mesh con interiores
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.side !== undefined) m.side = THREE.FrontSide;
          }
        }
      }
    });
    _weaponMeshCache.set(weaponId, base);
    return base.clone(true);
  }

  /**
   * Buscar bone por lista de candidatos. Devuelve el primero que matchea.
   */
  _findBone(candidates) {
    if (!this.mesh) return null;
    let found = null;
    this.mesh.traverse(o => {
      if (found || !o.isBone) return;
      if (candidates.includes(o.name)) found = o;
    });
    return found;
  }

  _registerClip(fbx, name, cloneClip = false) {
    if (!fbx.animations || fbx.animations.length === 0) return false;
    let clip = fbx.animations[0];
    if (cloneClip) clip = clip.clone();
    clip.name = name;
    adaptTrackNamesToSkeleton(clip, this._boneNames);
    if (CLIPS_TO_STRIP_ROOT.has(name)) {
      const mode = (name === 'death' || name === 'sword_death') ? 'all' : 'horizontal';
      stripHipsPositionTrack(clip, mode);
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

  setCombatStance(on) {
    this.combatStance = !!on;
  }

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

  revive() {
    this.isDead = false;
    this.isAttacking = false;
    this.isInTransition = false;
    this.combatStance = false;
    for (const name of ['death', 'sword_death']) {
      const a = this.actions[name];
      if (!a) continue;
      a.clampWhenFinished = false;
      a.stop();
      a.reset();
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.setTime(0);
    }
    const idle = this.actions.idle;
    if (idle) {
      idle.reset();
      idle.setEffectiveTimeScale(1);
      idle.setEffectiveWeight(1);
      idle.enabled = true;
      idle.play();
      this.current = idle;
    }
  }

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

  _scaleOneShot(action, targetMs) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    const clipMs = action.getClip().duration * 1000;
    const timeScale = clipMs > targetMs ? clipMs / targetMs : 1;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
  }

  _crossFadeTo(next, fadeMs) {
    next.reset();
    next.play();
    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, fadeMs, true);
    }
    this.current = next;
  }

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

    // Sesión 24 — limpiar arma equipada
    this.detachWeapon();
    this._rightHandBone = null;

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

function adaptTrackNamesToSkeleton(clip, boneNames) {
  if (!boneNames || boneNames.size === 0) return;
  let adapted = 0;
  let dropped = 0;
  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const original = track.name.slice(0, dotIdx);
    const property = track.name.slice(dotIdx);
    if (boneNames.has(original)) continue;
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

function generateBoneCandidates(name) {
  const out = [];
  let core = name;
  const prefixes = ['mixamorig1:', 'mixamorig:', 'mixamorig1', 'mixamorig'];
  for (const p of prefixes) {
    if (core.startsWith(p)) { core = core.slice(p.length); break; }
  }
  if (core.startsWith(':')) core = core.slice(1);
  out.push(name);
  out.push('mixamorig:' + core);
  out.push('mixamorig' + core);
  out.push('mixamorig1:' + core);
  out.push('mixamorig1' + core);
  out.push(core);
  return out;
}

function stripHipsPositionTrack(clip, mode = 'horizontal') {
  let count = 0;
  for (const t of clip.tracks) {
    const dotIdx = t.name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const property = t.name.slice(dotIdx + 1);
    if (property !== 'position') continue;
    let core = t.name.slice(0, dotIdx);
    const prefixes = ['mixamorig1:', 'mixamorig:', 'mixamorig1', 'mixamorig'];
    for (const p of prefixes) {
      if (core.startsWith(p)) { core = core.slice(p.length); break; }
    }
    if (core.startsWith(':')) core = core.slice(1);
    if (core !== 'Hips') continue;
    const v = t.values;
    const nFrames = v.length / 3;
    if (mode === 'horizontal') {
      for (let i = 0; i < nFrames; i++) {
        v[i * 3 + 0] = 0;
        v[i * 3 + 2] = 0;
      }
    } else if (mode === 'all') {
      const y0 = v[1];
      for (let i = 0; i < nFrames; i++) {
        v[i * 3 + 0] = 0;
        v[i * 3 + 1] = y0;
        v[i * 3 + 2] = 0;
      }
    }
    count++;
  }
  if (count > 0) {
    console.log(`[character] clip "${clip.name}": neutralized Hips.position (mode=${mode})`);
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
