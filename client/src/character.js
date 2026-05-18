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
const ARMOR_BASE = `${CDN_BASE}/armor`;   // Sesión 26 — body, shield, helm, cape

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
// Sesión 25 — ATTACK_TICK_MS 600 → 900 (sincronizado con TICK_MS de
// combat_engine y combat.js). Anim de ataque se escala a este tiempo.
const ATTACK_TICK_MS = 900;
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
// Valores finales calibrados visualmente por el usuario con el panel
// `window.__weaponDebug()`. Si quieres recalibrar más adelante: equipa el arma,
// abre eruda, ejecuta __weaponDebug(), ajusta sliders, pulsa COPIAR, pégalos aquí.
const WEAPON_TRANSFORMS = {
  '1h_sword': {
    scale: 77.0,
    position: [-22.5, 12.0, 3.0],
    rotation: [1.658, 0.058, -1.692],
    hand: 'right',
  },
  '2h_sword': {
    // Sesión 26 — calibrado in-game con __weaponDebug() para sword_bronze_2h
    // (modelo Hyperion). Escala alta porque el modelo viene chiquito.
    scale: 600.0,
    position: [-9.5, 2.0, 2.0],
    rotation: [2.858, -2.592, -3.142],
    hand: 'left',
  },
  'bow': {
    scale: 116.0,
    position: [7.0, -30.0, 30.0],
    rotation: [0.458, 0.058, -1.292],
    hand: 'left',
  },
  'staff': {
    scale: 128.0,
    position: [-30.0, -23.5, -22.5],
    rotation: [-1.142, -0.892, 1.258],
    hand: 'left',
  },
  'default': {
    scale: 50.0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    hand: 'right',
  },
};

// Cache global de GLBs de armas para no descargar cada vez
const _weaponMeshCache = new Map();
const _gltfLoader = new GLTFLoader();

// ============================================================
// Sesión 26 — Armor transforms y cache
// ============================================================
// Cada slot (body/shield/helm/cape) tiene un transform default para que el
// armor aparezca CERCA del bone correcto. Después se calibra con
// __armorDebug('body'|'shield'|'helm'|'cape') y se mete el resultado aquí.
//
// scale: número, position: [x,y,z], rotation: [x,y,z] (radianes).
// bone: qué hueso del personaje usar de anclaje.
const ARMOR_TRANSFORMS = {
  body: {
    // Sesión 26 — calibrado in-game para chest_bronze (Pechera)
    scale: 39.0,
    position: [-2.0, -30.0, 5.5],
    rotation: [0.058, 0.058, -0.092],
    bone: 'spine',
  },
  shield: {
    // Sesión 26 — calibrado in-game para shield_bronze (Viking shield)
    scale: 39.0,
    position: [0.0, 3.0, -4.5],
    rotation: [0.208, 3.108, -3.142],
    bone: 'leftHand',
  },
  helm: {
    // Placeholder — sin calibrar (no hay helm bronce todavía)
    scale: 100.0,
    position: [0.0, 0.0, 0.0],
    rotation: [0.0, 0.0, 0.0],
    bone: 'head',
  },
  cape: {
    // Placeholder — sin calibrar
    scale: 100.0,
    position: [0.0, 0.0, 0.0],
    rotation: [0.0, 0.0, 0.0],
    bone: 'spine',
  },
};

const _armorMeshCache = new Map();

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
    this._leftHandBone = null;
    this._equippedWeaponMesh = null;
    this._equippedWeaponId = null;
    this._equippedWeaponHand = null;  // 'right' | 'left' para saber de qué bone removerla

    // Sesión 26 — Armor attach state (body, shield, helm, cape)
    this._spineBone = null;
    this._headBone = null;
    this._neckBone = null;
    this._equippedArmor = {};  // slotId → { mesh, bone, itemId }
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

    // Sesión 24 — Buscar bones de manos y guardar referencias.
    // Soporta los esquemas comunes: mixamorig:Right/LeftHand, mixamorigRight/LeftHand, Right/LeftHand.
    this._rightHandBone = this._findBone(['mixamorig:RightHand', 'mixamorigRightHand', 'RightHand']);
    this._leftHandBone  = this._findBone(['mixamorig:LeftHand',  'mixamorigLeftHand',  'LeftHand']);
    if (this._rightHandBone) {
      console.log('[character] right hand bone:', this._rightHandBone.name);
    } else {
      console.warn('[character] right hand bone NOT FOUND. Bones disponibles:',
        [...this._boneNames].filter(n => /hand|wrist/i.test(n)));
    }
    if (this._leftHandBone) {
      console.log('[character] left hand bone:', this._leftHandBone.name);
    }

    // Sesión 26 — Bones del cuerpo para attach de armor (pechera, casco, capa).
    // Spine2 es el torso alto, ideal para pechera. Spine es el medio (cape).
    // Head/Neck para casco. Si no encuentra el específico, usa fallback más cercano.
    this._spineBone = this._findBone([
      'mixamorig:Spine2', 'mixamorigSpine2', 'Spine2',
      'mixamorig:Spine1', 'mixamorigSpine1', 'Spine1',
      'mixamorig:Spine',  'mixamorigSpine',  'Spine',
    ]);
    this._headBone = this._findBone(['mixamorig:Head', 'mixamorigHead', 'Head']);
    this._neckBone = this._findBone(['mixamorig:Neck', 'mixamorigNeck', 'Neck']);
    if (this._spineBone) console.log('[character] spine bone:', this._spineBone.name);
    if (this._headBone) console.log('[character] head bone:', this._headBone.name);
    if (this._neckBone) console.log('[character] neck bone:', this._neckBone.name);

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
    // Determinar mano según el tipo (default 'right')
    const tf = WEAPON_TRANSFORMS[weaponType] || WEAPON_TRANSFORMS.default;
    const handName = tf.hand || 'right';
    const bone = handName === 'left' ? this._leftHandBone : this._rightHandBone;
    if (!bone) {
      console.warn(`[character] attachWeapon: no hay ${handName} hand bone, no se puede equipar`);
      return;
    }
    // Si ya hay un arma equipada, quitarla primero (del bone correcto)
    if (this._equippedWeaponMesh) {
      this.detachWeapon();
    }
    if (!weaponId) return;

    try {
      const mesh = await this._loadWeaponMesh(weaponId);

      mesh.scale.setScalar(tf.scale);
      mesh.position.set(tf.position[0], tf.position[1], tf.position[2]);
      mesh.rotation.set(tf.rotation[0], tf.rotation[1], tf.rotation[2]);

      bone.add(mesh);
      this._equippedWeaponMesh = mesh;
      this._equippedWeaponId = weaponId;
      this._equippedWeaponHand = handName;

      // Exponer globalmente para que window.__weaponDebug() pueda acceder.
      window.__character = this;
    } catch (err) {
      console.warn(`[character] attachWeapon failed:`, err.message);
    }
  }

  /**
   * Quita el arma actualmente equipada del bone donde se attachó.
   */
  detachWeapon() {
    if (!this._equippedWeaponMesh) return;
    const bone = this._equippedWeaponHand === 'left' ? this._leftHandBone : this._rightHandBone;
    if (bone) bone.remove(this._equippedWeaponMesh);
    this._equippedWeaponMesh = null;
    this._equippedWeaponId = null;
    this._equippedWeaponHand = null;
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

  // ============================================================
  // Sesión 26 — Armor attach/detach
  // ============================================================
  /**
   * Equipa una armadura (body, shield, helm, cape) anclándola al hueso
   * correspondiente. NO usa skinning, así que el armor sigue al bone
   * pero no se deforma con la animación. Suficiente para pechera/casco
   * porque el torso/cabeza se mueven poco.
   *
   * @param {string} itemId - id del item (ej. 'chest_bronze'). Carga
   *   GLB desde R2/armor/<id>.glb.
   * @param {string} slotId - 'body' | 'shield' | 'helm' | 'cape'.
   */
  async attachArmor(itemId, slotId) {
    if (!this.loaded) return;
    const tf = ARMOR_TRANSFORMS[slotId];
    if (!tf) {
      console.warn(`[character] attachArmor: slot desconocido '${slotId}'`);
      return;
    }
    const bone = this._getBoneForArmorSlot(slotId);
    if (!bone) {
      console.warn(`[character] attachArmor: no hay bone para slot '${slotId}'`);
      return;
    }
    // Si ya hay armor en ese slot, quitarlo primero
    if (this._equippedArmor[slotId]) {
      this.detachArmor(slotId);
    }
    if (!itemId) return;

    try {
      const mesh = await this._loadArmorMesh(itemId);
      mesh.scale.setScalar(tf.scale);
      mesh.position.set(tf.position[0], tf.position[1], tf.position[2]);
      mesh.rotation.set(tf.rotation[0], tf.rotation[1], tf.rotation[2]);
      bone.add(mesh);
      this._equippedArmor[slotId] = { mesh, bone, itemId };
      window.__character = this;
    } catch (err) {
      console.warn(`[character] attachArmor failed for ${slotId}:`, err.message);
    }
  }

  /**
   * Quita la armadura de un slot del personaje.
   */
  detachArmor(slotId) {
    const cur = this._equippedArmor[slotId];
    if (!cur) return;
    if (cur.bone && cur.mesh) cur.bone.remove(cur.mesh);
    delete this._equippedArmor[slotId];
  }

  /**
   * Resuelve el hueso del personaje al que se ancla cada slot de armor.
   */
  _getBoneForArmorSlot(slotId) {
    switch (slotId) {
      case 'body':   return this._spineBone;
      case 'helm':   return this._headBone;
      case 'shield': return this._leftHandBone;
      case 'cape':   return this._neckBone || this._spineBone;
      default: return null;
    }
  }

  /**
   * Carga (con cache) el mesh de armor desde R2/armor/<id>.glb. Devuelve
   * un clone para que cada player tenga su instancia.
   */
  async _loadArmorMesh(itemId) {
    if (_armorMeshCache.has(itemId)) {
      return _armorMeshCache.get(itemId).clone(true);
    }
    const url = `${ARMOR_BASE}/${itemId}.glb`;
    const gltf = await _gltfLoader.loadAsync(url);
    const base = gltf.scene;
    base.traverse(o => {
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
    _armorMeshCache.set(itemId, base);
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
      // Sesión 26 — bug fix:
      // Para ataques/punching/draw/sheath/drink/death usamos modo 'all'
      // (fija Y al valor inicial del frame 0). Antes usaban 'horizontal'
      // que dejaba Y libre → el root bone bajaba durante la animación
      // y el personaje se hundía/T-poseaba parcialmente bajo el suelo.
      // Solo locomoción (walk/run) sigue con 'horizontal' para preservar
      // micro-rebotes de paso si la anim los tuviera.
      let mode;
      if (name === 'death' || name === 'sword_death') mode = 'all';
      else if (name.startsWith('attack_') || name === 'punching'
            || name === 'draw' || name === 'sheath' || name === 'drink') {
        mode = 'all';
      } else {
        mode = 'horizontal';
      }
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

  /**
   * Sesión 26 — playAttack(stanceKey, weaponType, cooldownMs)
   *
   * Decide qué anim usar según el ARMA equipada, no solo el stance:
   *   - 1H sword     → Punching.fbx siempre (con escudo+espada se ve bien)
   *   - 2H sword     → Sword_Attack_N según stance:
   *                      chop=1, slash=2, smash=3, block=4
   *   - Staff / Bow  → cycle automático sword_attack_1..4
   *   - Unarmed      → Punching.fbx
   *
   * cooldownMs: cuánto tiene que durar la anim (escala a ese tiempo).
   * Si no se pasa, usa ATTACK_TICK_MS por defecto.
   */
  playAttack(stanceKey, weaponType, cooldownMs) {
    if (!this.loaded || this.isDead) return;
    if (this.isAttacking || this.isInTransition) return;

    const animMs = (typeof cooldownMs === 'number' && cooldownMs > 0)
      ? cooldownMs
      : ATTACK_TICK_MS;

    let action = null;

    // 1H sword o unarmed → SIEMPRE punching
    if (weaponType === '1h_sword' || weaponType === 'unarmed' || !weaponType) {
      action = this.actions.punching;
    }
    // 2H sword → mapping específico por stance
    else if (weaponType === '2h_sword') {
      const stanceToAnim = { chop: 1, slash: 2, smash: 3, block: 4 };
      const animNum = stanceToAnim[stanceKey];
      if (animNum) {
        action = this.actions[`attack_${animNum}`] || this.actions.attack_1;
      } else {
        // Sin stance: cycle automático
        this.attackCycle = (this.attackCycle % 4) + 1;
        action = this.actions[`attack_${this.attackCycle}`] || this.actions.attack_1;
      }
    }
    // Staff o bow → cycle automático sword_attack (no hay anim específica)
    else if (weaponType === 'staff' || weaponType === 'bow') {
      this.attackCycle = (this.attackCycle % 4) + 1;
      action = this.actions[`attack_${this.attackCycle}`] || this.actions.attack_1;
    }
    // Fallback
    if (!action) action = this.actions.punching || this.actions.attack_1;
    if (!action) return;

    this._scaleOneShot(action, animMs);
    this._crossFadeTo(action, 0.08);
    this.isAttacking = true;

    // Sesión 26 — al terminar la animación, hacer crossfade explícito a
    // la anim de retorno (sword_idle si está en combat stance, idle si no).
    // Antes solo se ponía current=null y el world.js play loop tardaba
    // 1+ frame en llamar a play('idle') → se veía T-pose breve.
    setTimeout(() => {
      this.isAttacking = false;
      if (this.isDead) { this.current = null; return; }
      const next = this.combatStance
        ? (this.actions.sword_idle || this.actions.idle)
        : (this.actions.idle || this.actions.sword_idle);
      if (next) {
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = false;
        next.setEffectiveTimeScale(1);
        next.setEffectiveWeight(1);
        this._crossFadeTo(next, 0.12);
      } else {
        this.current = null;
      }
    }, animMs + 20);
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
    // Sesión 26 — bug fix: antes era false, lo cual hacía que al terminar
    // la animación de ataque, el mixer dejara de aplicar transformaciones
    // a los huesos y la mesh se viera durante 1-2 frames en BIND POSE
    // (T-pose con cintura hundida). Con true, el último frame del clip
    // se mantiene hasta que la siguiente animación tome el relevo, sin
    // saltos.
    action.clampWhenFinished = true;
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
    // Sesión 26 — Fuerza el cálculo del primer sample del clip antes de
    // que se renderice el siguiente frame. Sin esto, durante 1-2 frames
    // se ve la bind pose (T-pose) porque el mixer aún no ha aplicado
    // ninguna transformación a los huesos.
    if (this.mixer) this.mixer.update(0);
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
    this._leftHandBone = null;

    // Sesión 26 — limpiar armaduras equipadas
    for (const slotId of Object.keys(this._equippedArmor || {})) {
      this.detachArmor(slotId);
    }
    this._spineBone = null;
    this._headBone = null;
    this._neckBone = null;

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

// ============================================================
// DEBUG: weapon offset live tuner (sesión 24 / iteración 5)
// ============================================================
//
// El user ejecuta en eruda console:  window.__weaponDebug()
//
// Aparece un panel con sliders para scale / position / rotation / hand del
// arma actualmente equipada. Mueve los sliders y el arma se ajusta EN VIVO.
// Cuando esté perfecto, pulsa "Copiar valores" y comparte el resultado.
//
// Es solo herramienta de desarrollo, no afecta gameplay.
//
// Para abrir:  window.__weaponDebug()
// Para cerrar: tap fuera del panel o botón ×
//
window.__weaponDebug = function () {
  // Cerrar panel si ya existe
  const existing = document.getElementById('weaponDebugPanel');
  if (existing) { existing.remove(); return; }

  // Buscar el character con arma equipada
  const ch = window.character || window.__character;
  if (!ch || !ch._equippedWeaponMesh) {
    console.warn('[weapon-debug] no hay arma equipada. Equipa un arma desde el inventario antes de abrir el panel.');
    return;
  }
  const mesh = ch._equippedWeaponMesh;
  const weaponId = ch._equippedWeaponId;
  const currentHand = ch._equippedWeaponHand || 'right';

  const panel = document.createElement('div');
  panel.id = 'weaponDebugPanel';
  panel.style.cssText = `
    position: fixed; right: 6px; top: 60px; z-index: 9999;
    width: 165px; max-height: 65vh; overflow-y: auto;
    background: rgba(15,10,5,0.78); color: #f0e0b0;
    border: 1px solid #c8a043; border-radius: 5px;
    padding: 5px 6px; font-family: monospace; font-size: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.6);
    backdrop-filter: blur(3px);
  `;

  function row(label, min, max, step, value, onChange, fmt) {
    fmt = fmt || (v => v.toFixed(2));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin: 3px 0; display: flex; align-items: center; gap: 4px;';
    wrap.innerHTML = `
      <span style="width:20px; color:#c8a043; font-size:10px;">${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}"
             style="flex:1; min-width:0; height: 14px;">
      <span class="val" style="width:48px; text-align:right; font-size:9px;">${fmt(value)}</span>
    `;
    const range = wrap.querySelector('input');
    const valEl = wrap.querySelector('.val');
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      valEl.textContent = fmt(v);
      onChange(v);
    });
    return wrap;
  }

  // Estado minimizado
  let minimized = false;
  const body = document.createElement('div');
  body.id = 'weaponDebugBody';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight: bold; color: #e8c560; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 10px;';
  title.innerHTML = `
    <span id="wpDebugTitle" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100px;">🔧 ${weaponId}</span>
    <span>
      <button id="wpDebugMin" style="background: transparent; border: 1px solid #c8a043; color: #f0e0b0; padding: 0 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">−</button>
      <button id="wpDebugClose" style="background: transparent; border: 1px solid #c8a043; color: #f0e0b0; padding: 0 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">×</button>
    </span>
  `;
  panel.appendChild(title);

  body.appendChild(row('Scl', 1, 600, 1, mesh.scale.x, v => mesh.scale.setScalar(v), v => v.toFixed(0)));

  const sepP = document.createElement('div');
  sepP.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepP.textContent = '─ POSITION';
  body.appendChild(sepP);
  body.appendChild(row('X', -30, 30, 0.5, mesh.position.x, v => { mesh.position.x = v; }));
  body.appendChild(row('Y', -30, 30, 0.5, mesh.position.y, v => { mesh.position.y = v; }));
  body.appendChild(row('Z', -30, 30, 0.5, mesh.position.z, v => { mesh.position.z = v; }));

  const sepR = document.createElement('div');
  sepR.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepR.textContent = '─ ROTATION';
  body.appendChild(sepR);
  const PI = Math.PI;
  body.appendChild(row('rX', -PI, PI, 0.05, mesh.rotation.x, v => { mesh.rotation.x = v; }, v => `${Math.round(v*180/PI)}°`));
  body.appendChild(row('rY', -PI, PI, 0.05, mesh.rotation.y, v => { mesh.rotation.y = v; }, v => `${Math.round(v*180/PI)}°`));
  body.appendChild(row('rZ', -PI, PI, 0.05, mesh.rotation.z, v => { mesh.rotation.z = v; }, v => `${Math.round(v*180/PI)}°`));

  // Switch hand button
  const handBtn = document.createElement('button');
  handBtn.style.cssText = 'margin-top: 6px; width: 100%; padding: 4px; background: #4a3520; color: #e8c560; border: 1px solid #c8a043; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 10px;';
  handBtn.textContent = `→ mano ${currentHand === 'right' ? 'IZQ' : 'DCHA'}`;
  handBtn.addEventListener('click', () => {
    const newHand = ch._equippedWeaponHand === 'right' ? 'left' : 'right';
    const newBone = newHand === 'left' ? ch._leftHandBone : ch._rightHandBone;
    if (!newBone) { console.warn('[weapon-debug] no se encontró el bone destino'); return; }
    mesh.parent?.remove(mesh);
    newBone.add(mesh);
    ch._equippedWeaponHand = newHand;
    handBtn.textContent = `→ mano ${newHand === 'right' ? 'IZQ' : 'DCHA'}`;
    document.getElementById('wpDebugTitle').textContent = `🔧 ${weaponId} (${newHand[0]})`;
  });
  body.appendChild(handBtn);

  // Copiar valores button
  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'margin-top: 4px; width: 100%; padding: 5px; background: #8a6230; color: #fff; border: 1px solid #e8c560; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 10px; font-weight: bold;';
  copyBtn.textContent = '📋 COPIAR';
  copyBtn.addEventListener('click', () => {
    const out = `'${guessTypeKey(weaponId)}': {
  scale: ${mesh.scale.x.toFixed(1)},
  position: [${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)}],
  rotation: [${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)}],
  hand: '${ch._equippedWeaponHand}',
},`;
    navigator.clipboard?.writeText(out).then(() => {
      copyBtn.textContent = '✅ COPIADO';
      setTimeout(() => copyBtn.textContent = '📋 COPIAR', 1500);
    });
    console.log('[weapon-debug] valores:\n' + out);
  });
  body.appendChild(copyBtn);

  panel.appendChild(body);

  // Listeners para botones de la cabecera
  panel.querySelector('#wpDebugClose').addEventListener('click', () => panel.remove());
  panel.querySelector('#wpDebugMin').addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : 'block';
    panel.querySelector('#wpDebugMin').textContent = minimized ? '+' : '−';
    panel.style.width = minimized ? 'auto' : '165px';
  });

  document.body.appendChild(panel);
  console.log('[weapon-debug] panel abierto. − minimiza, × cierra. Mueve sliders y pulsa COPIAR.');

  function guessTypeKey(id) {
    if (/sword.*2h|2h.*sword/.test(id)) return '2h_sword';
    if (/sword|dagger/.test(id)) return '1h_sword';
    if (/bow/.test(id)) return 'bow';
    if (/staff/.test(id)) return 'staff';
    return 'default';
  }
};


// ============================================================
// Sesión 26 — __armorDebug(slotId) panel para calibrar armor
// ============================================================
//
// Uso:  window.__armorDebug('body')  → panel para la pechera
//       window.__armorDebug('shield') → panel para el escudo
//       window.__armorDebug('helm')   → casco
//       window.__armorDebug('cape')   → capa
//
// Equipa el armor primero. Después ejecuta __armorDebug('<slot>').
// Mueve los sliders hasta que quede bien. Pulsa COPIAR y pégame el
// resultado para que lo deje fijo en ARMOR_TRANSFORMS.
//
window.__armorDebug = function (slotId) {
  if (!slotId) {
    console.warn('[armor-debug] uso: __armorDebug("body" | "shield" | "helm" | "cape")');
    return;
  }
  const existing = document.getElementById('armorDebugPanel');
  if (existing) existing.remove();

  const ch = window.character || window.__character;
  if (!ch) {
    console.warn('[armor-debug] no hay character cargado.');
    return;
  }
  const armorState = ch._equippedArmor?.[slotId];
  if (!armorState || !armorState.mesh) {
    console.warn(`[armor-debug] no hay armor equipado en slot '${slotId}'. Equipa primero.`);
    return;
  }
  const mesh = armorState.mesh;
  const itemId = armorState.itemId;

  const panel = document.createElement('div');
  panel.id = 'armorDebugPanel';
  panel.style.cssText = `
    position: fixed; right: 6px; top: 60px; z-index: 9999;
    width: 165px; max-height: 65vh; overflow-y: auto;
    background: rgba(15,10,5,0.78); color: #f0e0b0;
    border: 1px solid #c8a043; border-radius: 5px;
    padding: 5px 6px; font-family: monospace; font-size: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.6);
    backdrop-filter: blur(3px);
  `;

  function row(label, min, max, step, value, onChange, fmt) {
    fmt = fmt || (v => v.toFixed(2));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin: 3px 0; display: flex; align-items: center; gap: 4px;';
    wrap.innerHTML = `
      <span style="width:20px; color:#c8a043; font-size:10px;">${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}"
             style="flex:1; min-width:0; height: 14px;">
      <span class="val" style="width:48px; text-align:right; font-size:9px;">${fmt(value)}</span>
    `;
    const inp = wrap.querySelector('input');
    const val = wrap.querySelector('.val');
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      val.textContent = fmt(v);
      onChange(v);
    });
    return wrap;
  }

  const body = document.createElement('div');

  let minimized = false;
  const title = document.createElement('div');
  title.style.cssText = 'font-weight: bold; color: #e8c560; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 10px;';
  title.innerHTML = `
    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100px;">🛡 ${slotId}: ${itemId}</span>
    <span>
      <button id="arDebugMin" style="background: transparent; border: 1px solid #c8a043; color: #f0e0b0; padding: 0 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">−</button>
      <button id="arDebugClose" style="background: transparent; border: 1px solid #c8a043; color: #f0e0b0; padding: 0 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">×</button>
    </span>
  `;
  panel.appendChild(title);

  body.appendChild(row('Scl', 1, 600, 1, mesh.scale.x, v => mesh.scale.setScalar(v), v => v.toFixed(0)));

  const sepP = document.createElement('div');
  sepP.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepP.textContent = '─ POSITION';
  body.appendChild(sepP);
  body.appendChild(row('X', -30, 30, 0.5, mesh.position.x, v => { mesh.position.x = v; }));
  body.appendChild(row('Y', -30, 30, 0.5, mesh.position.y, v => { mesh.position.y = v; }));
  body.appendChild(row('Z', -30, 30, 0.5, mesh.position.z, v => { mesh.position.z = v; }));

  const sepR = document.createElement('div');
  sepR.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepR.textContent = '─ ROTATION';
  body.appendChild(sepR);
  const PI = Math.PI;
  body.appendChild(row('rX', -PI, PI, 0.05, mesh.rotation.x, v => { mesh.rotation.x = v; }, v => `${Math.round(v*180/PI)}°`));
  body.appendChild(row('rY', -PI, PI, 0.05, mesh.rotation.y, v => { mesh.rotation.y = v; }, v => `${Math.round(v*180/PI)}°`));
  body.appendChild(row('rZ', -PI, PI, 0.05, mesh.rotation.z, v => { mesh.rotation.z = v; }, v => `${Math.round(v*180/PI)}°`));

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'margin-top: 6px; width: 100%; padding: 5px; background: #8a6230; color: #fff; border: 1px solid #e8c560; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 10px; font-weight: bold;';
  copyBtn.textContent = '📋 COPIAR';
  copyBtn.addEventListener('click', () => {
    const out = `${slotId}: {
  scale: ${mesh.scale.x.toFixed(1)},
  position: [${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)}],
  rotation: [${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)}],
  bone: '${{body:'spine',helm:'head',shield:'leftHand',cape:'spine'}[slotId]}',
},`;
    navigator.clipboard?.writeText(out).then(() => {
      copyBtn.textContent = '✅ COPIADO';
      setTimeout(() => copyBtn.textContent = '📋 COPIAR', 1500);
    });
    console.log('[armor-debug] valores:\n' + out);
  });
  body.appendChild(copyBtn);

  panel.appendChild(body);

  panel.querySelector('#arDebugClose').addEventListener('click', () => panel.remove());
  panel.querySelector('#arDebugMin').addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : 'block';
    panel.querySelector('#arDebugMin').textContent = minimized ? '+' : '−';
    panel.style.width = minimized ? 'auto' : '165px';
  });

  document.body.appendChild(panel);
  console.log(`[armor-debug] panel para ${slotId} abierto. Ajusta sliders y COPIA.`);
};
