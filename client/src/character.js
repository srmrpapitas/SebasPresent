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

  // Sesión 30 — Gathering anims (woodcutting + firemaking)
  woodcut:  'Woodcut.fbx',
  kneel:    'Kneel.fbx',

  // Sesión 32 — Hit reaction (cuando recibes un hit de peer/NPC)
  react:    'Reaction.fbx',

  // Sesión 36 — Bow anims (Bloque 2 día 6). Las 7 que están en R2:
  //   - bow_draw_arrow: anim ONE-SHOT al entrar combate (char saca y prepara
  //     la flecha). Clamp al último frame → pose "drawn" para idle.
  //   - bow_overdraw:   ONE-SHOT windup del ataque (~200ms). Antes del release.
  //   - bow_recoil:     ONE-SHOT release del ataque (~150ms). Tras el recoil
  //     volvemos al held pose de bow_draw_arrow vía _holdBowDrawnPose().
  //   - bow_walk_*:     LOOP 4-direccional para locomoción en combate ranged.
  //     No hay bow_run_* todavía — corriendo cae a run_* normal (polish S37).
  bow_draw_arrow:    'Bow_Draw_Arrow.fbx',
  bow_overdraw:      'Bow_Overdraw.fbx',
  bow_recoil:        'Bow_Recoil.fbx',
  bow_walk_forward:  'Bow_Walk_Forward.fbx',
  bow_walk_back:     'Bow_Walk_Back.fbx',
  bow_walk_left:     'Bow_Walk_Left.fbx',
  bow_walk_right:    'Bow_Walk_Right.fbx',

  // Sesión 42 — Anims de mago (staff). Estos FBX ya estaban en R2 desde S41
  // pero NUNCA se enchufaron acá: el staff caía al cycle de Sword_Attack_N.
  // Mapeo hechizo→clip vía SPELL_ANIM (abajo). One-shots como los de bow
  // (sin sheath → clamp=true).
  //   fire_strike → staff_attack_1 (fuego)
  //   ice_spear   → staff_attack_3 (hielo)
  //   thunderbolt → staff_attack_5 (rayo)
  //   entangle    → staff_cast
  staff_attack_1: 'staff_attack_1.fbx',
  staff_attack_3: 'staff_attack_3.fbx',
  staff_attack_5: 'staff_attack_5.fbx',
  staff_cast:     'staff_cast.fbx',
};

// Sesión 42 — Mapa spell_id → clave de anim en ANIM_FILES. El server manda el
// spell_id (combat_engine.js → combat.js → __playerPlayAttack → playAttack).
// Si un spell_id no está acá (o el clip no cargó), playAttack cae al fallback
// de sword cycle igual que el staff sin hechizo.
const SPELL_ANIM = {
  fire_strike: 'staff_attack_1',
  ice_spear:   'staff_attack_3',
  thunderbolt: 'staff_attack_5',
  entangle:    'staff_cast',
};

const CRITICAL_ANIMS = ['idle', 'walk_forward', 'run_forward'];

const CLIPS_TO_STRIP_ROOT = new Set([
  'attack_1', 'attack_2', 'attack_3', 'attack_4',
  'punching',
  'draw', 'sheath',
  'death', 'sword_death',
  'drink',
  'react',          // Sesión 32 — la anim de react puede tener drift
  'walk_back', 'walk_left', 'walk_right',
  'run_back', 'run_left', 'run_right',
  'sword_run_forward',
  'sword_run_back',
  'sword_run_left',
  'sword_run_right',
  // Sesión 30 — gathering anims también tienen root motion
  'woodcut',
  'kneel',
  // Sesión 36 — bow anims también traen drift (regla de oro: si no está
  // en la lista "in-place" del comment de INVARIANTS sección 2.3, asumimos
  // que tiene root motion y la incluimos acá).
  'bow_draw_arrow', 'bow_overdraw', 'bow_recoil',
  'bow_walk_forward', 'bow_walk_back', 'bow_walk_left', 'bow_walk_right',
  // Sesión 42 — anims de mago: misma regla de oro, asumimos drift y las
  // dejamos in-place (la capa de movimiento llega después con el layered blend).
  'staff_attack_1', 'staff_attack_3', 'staff_attack_5', 'staff_cast',
]);

const CHARACTER_SCALE = 0.01;
const CROSSFADE = 0.22;
// Sesión 25 — ATTACK_TICK_MS 600 → 900 (sincronizado con TICK_MS de
// combat_engine y combat.js). Anim de ataque se escala a este tiempo.
const ATTACK_TICK_MS = 900;
const DRAW_MS = 700;
const SHEATH_MS = 700;

// Sesión 36 — Bow attack es una secuencia (no una anim sola). El cooldown
// total sigue siendo el del server (cooldown_ms del response, típ. 900ms
// para bow). Estas dos partes son fijas — el char termina la anim antes
// del cooldown total y se queda en held pose el resto del tiempo.
//   - BOW_OVERDRAW_MS: tiempo del windup antes de soltar la flecha.
//   - BOW_RECOIL_MS:   tiempo del release después de soltar.
//   - BOW_DRAW_MS:     duración del Bow_Draw_Arrow al entrar combate.
// El proyectil visual se sincroniza con BOW_OVERDRAW_MS vía opts.windupMs
// en combat.js (ver __worldFireProjectile call).
const BOW_OVERDRAW_MS = 200;
const BOW_RECOIL_MS = 150;
const BOW_DRAW_MS = 500;

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
    // Sesión 27 — recalibrado por Nico con __weaponDebug() para sword_bronze_2h.
    // Ahora en mano derecha (antes left). Posición frente al pecho, ligeramente
    // alta para que la animación de Sword_Attack_N se vea bien sin chocar con
    // el cuerpo. Si quieres recalibrar: equipa la 2H, __weaponDebug(), ajusta,
    // pulsa COPIAR y pégalos aquí otra vez.
    scale: 600.0,
    position: [2.0, 12.0, 8.5],
    rotation: [1.158, 0.458, -3.142],
    hand: 'right',
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
  // Sesión 30 — Hacha de talar. item_id='axe_bronze' (renombrado en S32),
  // weapon_type='axe'. Calibrado in-game con __weaponDebug() por Nico.
  // WEAPON_TRANSFORMS está indexado por weapon_type (no item_id), por eso
  // la key 'axe' queda igual aunque el item_id cambió a 'axe_bronze'.
  'axe': {
    scale: 7.0,
    position: [-7.0, 18.5, 17.0],
    rotation: [2.458, -1.542, -0.192],
    hand: 'right',
  },
  // Sesión 30 — Pico de minería (item_id='pickaxe_bronze', weapon_type='pickaxe').
  // Calibrado in-game con __weaponDebug() por Nico. scale ajustado a 0.7
  // (el slider del panel arrancaba en 1 pero seguía grande).
  'pickaxe': {
    scale: 0.7,
    position: [8.5, 12.0, 4.5],
    rotation: [-0.992, 0.058, -1.392],
    hand: 'right',
  },
  'default': {
    scale: 50.0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    hand: 'right',
  },
};

// ============================================================
// Sesión 34 — Override por item_id (Bloque 2)
// ============================================================
// WEAPON_TRANSFORMS está indexado por weapon_type (ej. 'bow'), pero algunos
// items del mismo tipo tienen geometría/escala distinta y necesitan su propia
// calibración. Ejemplo: bow_normal (madera básica) y bow_oak (roble) son
// ambos weapon_type='bow' pero los GLB son modelos distintos.
//
// Para resolver eso, WEAPON_TRANSFORMS_BY_ITEM_ID guarda overrides por
// item_id específico. Si un item_id tiene entrada acá, gana sobre la
// entrada por weapon_type. Si no, fallback al lookup por weapon_type.
//
// CÓMO CALIBRAR UN ARMA NUEVA:
//   1. Equipala en el juego con __weaponDebug()
//   2. Ajustá scale/position/rotation con los sliders
//   3. Tap COPIAR
//   4. Pegá la entrada acá usando el item_id (no el weapon_type)
//
// Hoy (S34) está vacío — la primera entrada va a ser 'bow_oak' cuando
// Nico la calibre in-game.
const WEAPON_TRANSFORMS_BY_ITEM_ID = {
  // Sesión 35 — bow_oak: calibración FINAL (refinada in-game con sliders
  // re-centrados sobre la base + micro-ajustes encadenados al fit a la mano).
  'bow_oak': {
    scale: 179.0,
    position: [-82.5, 1.0, 70.5],
    rotation: [-0.192, -2.492, 1.158],
    hand: 'left',
  },
};

/**
 * Resuelve el transform para un arma. Prioridad:
 *   1. WEAPON_TRANSFORMS_BY_ITEM_ID[itemId]  — override específico
 *   2. WEAPON_TRANSFORMS[weaponType]         — fallback por tipo
 *   3. WEAPON_TRANSFORMS.default             — último recurso
 */
function resolveWeaponTransform(itemId, weaponType) {
  return (
    WEAPON_TRANSFORMS_BY_ITEM_ID[itemId] ||
    WEAPON_TRANSFORMS[weaponType] ||
    WEAPON_TRANSFORMS.default
  );
}

// ============================================================
// Sesión 34 — Standalone loaders/attachers (Bloque 2, B-001b)
// ============================================================
// Estos exports permiten que multiplayer.js attachee armas REALES a los
// peers (cada peer ve el arma que tiene equipada el otro player, no la
// del local player heredada por SkeletonUtils.clone).
//
// Notar que duplican un poco a Character._loadWeaponMesh y _doAttachWeapon:
// es intencional. Las methods de instance manejan side effects del local
// player (_equippedWeaponMesh, _equippedWeaponHand, etc) que NO existen
// para peers. Las funciones standalone son puras → no tocan estado.
// Próxima sesión polish: deduplicar (los methods delegan a las funciones).

/**
 * Carga el GLB del arma desde R2 con cache. Devuelve un mesh CLON listo
 * para ser attached a algún bone. No modifica el cache original.
 *
 * @param {string} weaponId — item_id (ej. 'bow_oak', 'sword_bronze')
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadWeaponMeshFromR2(weaponId) {
  if (_weaponMeshCache.has(weaponId)) {
    return _weaponMeshCache.get(weaponId).clone(true);
  }
  const url = `${WEAPONS_BASE}/${weaponId}.glb`;
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
  _weaponMeshCache.set(weaponId, base);
  return base.clone(true);
}

/**
 * Carga el GLB del weapon, aplica el transform (override por item_id o
 * fallback por weapon_type) y lo agrega al bone provisto. Devuelve el
 * mesh attached (para que el caller pueda guardarlo y removerlo después).
 *
 * Usado por:
 *   - Character._doAttachWeapon (vía similar logic — TODO dedup)
 *   - multiplayer.js createPeer (peers)
 *
 * @returns {Promise<THREE.Object3D|null>} el mesh attached, o null si falló.
 */
export async function attachWeaponMeshToBone(bone, weaponId, weaponType) {
  if (!bone || !weaponId) return null;
  const tf = resolveWeaponTransform(weaponId, weaponType);
  try {
    const mesh = await loadWeaponMeshFromR2(weaponId);
    mesh.scale.setScalar(tf.scale);
    mesh.position.set(tf.position[0], tf.position[1], tf.position[2]);
    mesh.rotation.set(tf.rotation[0], tf.rotation[1], tf.rotation[2]);
    bone.add(mesh);
    return mesh;
  } catch (err) {
    console.warn(`[character] attachWeaponMeshToBone failed (${weaponId}):`, err.message);
    return null;
  }
}

/**
 * Devuelve la mano ('left' | 'right') donde un arma específica debería ir.
 * Útil para que multiplayer.js encuentre el bone correcto del peer.
 */
export function resolveWeaponHand(weaponId, weaponType) {
  const tf = resolveWeaponTransform(weaponId, weaponType);
  return tf.hand || 'right';
}

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

    // Sesión 30 — flag para forzar Y=0 mientras hace anim de gathering
    // (woodcut/kneel). Algunas anims FBX traen root motion vertical que
    // hunde al char en el suelo; con este flag pinneamos la pos local Y
    // del mesh a 0 cada frame durante esas anims.
    this._gatheringActive = false;

    // Sesión 24 — Weapon attach state
    this._rightHandBone = null;
    this._leftHandBone = null;
    this._equippedWeaponMesh = null;
    this._equippedWeaponId = null;
    this._equippedWeaponHand = null;  // 'right' | 'left' para saber de qué bone removerla
    // Sesión 33 — guardamos también el weaponType para poder restaurar tras
    // un override por tool (B-001). attachWeapon() lo setea, detachWeapon() lo limpia.
    this._equippedWeaponType = null;

    // Sesión 33 (B-001) — Tool override durante gathering.
    // Cuando empieza la tala, swappeamos visualmente al hacha y guardamos
    // el arma original acá. Al terminar (depleted/cancel/death/etc) o cuando
    // entra combate, restoreWeapon() vuelve al arma original.
    // Invalidación: si attachWeapon() externo se llama con un arma distinta
    // mientras el override está activo (jugador equipa otra cosa desde el
    // menú), se considera intencional y se descarta el saved state.
    this._toolOverrideActive = false;
    this._savedWeaponId = null;
    this._savedWeaponType = null;

    // Sesión 33 (B-002) — Cleanup pendiente de draw/sheath.
    // Cuando playDraw/playSheath arrancan, agendan un setTimeout para
    // setear combatStance y limpiar isInTransition. Si en el medio se llama
    // a la operación opuesta (ej. draw seguido inmediatamente de sheath),
    // el setTimeout pendiente pisa el flag con el valor incorrecto.
    // Guardamos el id acá para poder cancelarlo desde la nueva llamada.
    this._drawSheathTimeoutId = null;

    // Sesión 36 — Bow combat state.
    //
    // _combatStanceMode distingue qué anim set usa play()/_resolveLocomotion
    // mientras combatStance=true:
    //   - 'sword': sword_idle, sword_run_* (default histórico — sirve para
    //              espadas Y herramientas Y unarmed-in-combat).
    //   - 'bow':   bow_draw_arrow (held), bow_walk_*, fallback run_* para correr.
    //   - 'staff': reservado para Bloque 2 días 8-11. Hoy se trata como 'sword'.
    // setCombatStance(false) lo resetea a 'sword'. playBowDraw lo setea a 'bow'.
    //
    // _bowAttackTimeoutId guarda el id de la secuencia Overdraw→Recoil en
    // curso para poder cancelarla si el player sale de combate / muere /
    // cambia de arma a mitad de un attack tick.
    this._combatStanceMode = 'sword';
    this._bowAttackTimeoutId = null;

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
    // Sesión 30 — Bug fix: algunos FBX importados por Three.js no marcan
    // los huesos con isBone=true (quedan como Object3D plano). Si capturamos
    // solo bones reales, el Set queda VACÍO y adaptTrackNamesToSkeleton
    // dropea TODOS los tracks porque ningún candidato matchea contra Set vacío.
    // Resultado anterior: char acostado durante Woodcut/Kneel.
    // Fix: capturar TODOS los nodos con nombre (no solo isBone).
    characterFBX.traverse(o => {
      if (o.name && typeof o.name === 'string' && o.name.length > 0) {
        this._boneNames.add(o.name);
      }
    });
    console.log('[character] boneNames capturadas:', this._boneNames.size);
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

    // Sesión 30 — Hips bone para anti-hundido en gathering.
    // Guardamos el Y inicial (bind pose) para pinearlo cada frame durante
    // las anims de woodcut/kneel.
    this._hipsBone = this._findBone([
      'mixamorig:Hips', 'mixamorigHips', 'Hips',
      'mixamorig:Spine', 'Spine',  // fallback
    ]);
    if (this._hipsBone) {
      this._hipsInitialY = this._hipsBone.position.y;
      console.log('[character] hips bone:', this._hipsBone.name, 'Y0=', this._hipsInitialY.toFixed(3));
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
    // Sesión 36 — Bow one-shots: LoopOnce + clampWhenFinished=true.
    // Diferencia con sword: las anims de sword tienen su Sheath dedicada que
    // limpia el mixer al salir de combate, por eso clamp=false. Las de bow
    // NO tienen sheath — al terminar Bow_Draw_Arrow / Bow_Recoil, el char
    // queda en pose drawn (clamped) y la siguiente acción (otro attack o
    // setCombatStance(false)) decide qué hacer. Sin clamp=true vuelve a
    // bind pose por 1-2 frames (mismo bug de S26 que llevó a clamp=true en
    // _scaleOneShot).
    for (const name of ['bow_draw_arrow', 'bow_overdraw', 'bow_recoil']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    // Sesión 42 — anims de mago: one-shots sin sheath (igual que bow). Clamp al
    // último frame para no caer en bind pose; world.js vuelve a idle después.
    for (const name of ['staff_attack_1', 'staff_attack_3', 'staff_attack_5', 'staff_cast']) {
      const a = this.actions[name];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }

    // Sesión 42c — Layered blend (piernas + torso por separado). PASO 1:
    // construir los clips partidos. ADITIVO: no toca las actions existentes
    // ni play(); solo crea actions extra `<name>__legs` / `<name>__torso`.
    this._buildLayeredClips();

    // Hook de prueba para validar EN EL JUEGO que el rig no se rompe con una
    // combinación piernas+torso, sin cablear nada al loop principal todavía.
    //   window.__testLayered('walk_forward','attack_1')  → piernas caminan, torso ataca
    //   window.__testLayeredOff()                        → vuelve a idle normal
    if (typeof window !== 'undefined') {
      window.__testLayered = (legs = 'walk_forward', torso = 'attack_1') => {
        const ch = window.__character;
        if (!ch || !ch.mixer) return 'no character';
        const la = ch.actions[legs + '__legs'];
        const ta = ch.actions[torso + '__torso'];
        if (!la || !ta) {
          return 'falta: ' + (!la ? legs + '__legs ' : '') + (!ta ? torso + '__torso' : '');
        }
        ch.mixer.stopAllAction();
        ch.isAttacking = false;
        ch.isInTransition = false;
        la.reset(); la.setLoop(THREE.LoopRepeat, Infinity); la.setEffectiveWeight(1); la.setEffectiveTimeScale(1); la.play();
        ta.reset(); ta.setLoop(THREE.LoopRepeat, Infinity); ta.setEffectiveWeight(1); ta.setEffectiveTimeScale(1); ta.play();
        ch.current = null;
        return 'reproduciendo ' + legs + '__legs + ' + torso + '__torso';
      };
      window.__testLayeredOff = () => {
        const ch = window.__character;
        if (!ch || !ch.mixer) return 'no character';
        ch.mixer.stopAllAction();
        ch.current = null;
        ch.play('idle');
        return 'idle';
      };
      window.__layeredList = () => {
        const ch = window.__character;
        return Object.keys(ch?.actions || {}).filter(k => k.endsWith('__legs') || k.endsWith('__torso'));
      };
    }

    this.actions.idle.play();
    this.current = this.actions.idle;
    this.loaded = true;
    onProgress?.(1, 'Listo');
    return this.group;
  }

  // ============================================================
  // Sesión 24 — Weapon attach/detach API
  // (Sesión 33 — refactor: público invalida tool override; _doAttachWeapon
  //  es el internal que también usan attachToolForGather/restoreWeapon
  //  sin tocar el saved state. Ver B-001 INVARIANTS 3.x.)
  // ============================================================
  /**
   * Equipa un arma 3D en la mano del personaje.
   *
   * Punto de entrada PÚBLICO. Si hay un tool override activo (por gathering)
   * y la llamada pide un arma DISTINTA a la actual, descarta el saved state
   * — interpretamos que el jugador o el equipment menu cambió el arma a
   * propósito, así que ya no queremos restaurar la anterior.
   *
   * @param {string} weaponId - id del item (ej. 'sword_bronze'). Se usa
   *   para cargar el GLB desde R2/weapons/{weaponId}.glb.
   * @param {string} weaponType - tipo (1h_sword|2h_sword|bow|staff|axe|...) para
   *   elegir las transformaciones de la tabla WEAPON_TRANSFORMS.
   */
  async attachWeapon(weaponId, weaponType) {
    // Sesión 33 (B-001) — Invalidación del tool override.
    // Si el override está activo y nos piden cambiar a algo que NO es la
    // tool actual, asumimos cambio intencional y descartamos el saved.
    if (this._toolOverrideActive && weaponId !== this._equippedWeaponId) {
      this._toolOverrideActive = false;
      this._savedWeaponId = null;
      this._savedWeaponType = null;
    }
    return this._doAttachWeapon(weaponId, weaponType);
  }

  /**
   * Internal: ejecuta el attach sin tocar el saved state del tool override.
   * Usado por attachWeapon (público) y por attachToolForGather/restoreWeapon.
   */
  async _doAttachWeapon(weaponId, weaponType) {
    if (!this.loaded) return;
    // S34 — lookup que prioriza override por item_id sobre la entrada por
    // weapon_type. Ver WEAPON_TRANSFORMS_BY_ITEM_ID arriba.
    const tf = resolveWeaponTransform(weaponId, weaponType);
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
      this._equippedWeaponType = weaponType;  // S33 — necesario para restoreWeapon

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
    this._equippedWeaponType = null;
  }

  // ============================================================
  // Sesión 33 (B-001) — Tool override durante gathering
  // ============================================================
  /**
   * Swappea visualmente al hacha/pico para una actividad de gathering (tala/
   * minería), guardando el arma original. Cuando termine el gather, restoreWeapon()
   * vuelve al arma original.
   *
   * - Idempotente: si la tool pedida ya está equipada, no hace nada (caso "ya
   *   tenés el hacha equipada"). Tampoco activa el saved state — así no hay
   *   restore que hacer.
   * - Si ya hay un override activo (no debería pasar — startChop es serial),
   *   no pisa el saved state para no perder el arma "real".
   * - Si attachWeapon() externo se llama durante el override con un arma
   *   distinta a la tool, invalida el saved (ver attachWeapon).
   *
   * @param {string} toolItemId    - ej. 'axe_bronze', 'pickaxe_bronze'
   * @param {string} toolWeaponType - ej. 'axe', 'pickaxe'
   */
  async attachToolForGather(toolItemId, toolWeaponType) {
    if (!this.loaded) return;
    if (!toolItemId) return;
    // Idempotente: la tool ya está en mano → no hay nada que swappear ni guardar
    if (this._equippedWeaponId === toolItemId) return;
    if (!this._toolOverrideActive) {
      this._savedWeaponId = this._equippedWeaponId;
      this._savedWeaponType = this._equippedWeaponType;
      this._toolOverrideActive = true;
    }
    await this._doAttachWeapon(toolItemId, toolWeaponType);
  }

  /**
   * Restaura el arma original si hay un override activo. Noop si no hay.
   * Si el saved era "ninguna" (mano vacía), detacha la tool.
   *
   * Safe de llamar múltiples veces: el flag se limpia tras el primer call.
   */
  async restoreWeapon() {
    if (!this._toolOverrideActive) return;
    const savedId = this._savedWeaponId;
    const savedType = this._savedWeaponType;
    this._toolOverrideActive = false;
    this._savedWeaponId = null;
    this._savedWeaponType = null;
    if (savedId) {
      await this._doAttachWeapon(savedId, savedType);
    } else {
      this.detachWeapon();
    }
  }

  /** True si hay un tool override activo (debug / tests). */
  isToolOverrideActive() {
    return this._toolOverrideActive;
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
    // Sesión 30 — Bug fix: no filtrar por isBone porque algunos FBX importados
    // por Three.js no marcan los huesos como Bone (quedan como Object3D).
    this.mesh.traverse(o => {
      if (found || !o.name) return;
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
      }
      // Sesión 30 — gathering anims también necesitan mode='all' porque
      // tienen root motion vertical (kneel baja las caderas, woodcut puede
      // bajar mucho el centro). Sin esto, char se hunde en el suelo.
      else if (name === 'woodcut' || name === 'kneel') {
        mode = 'all';
      }
      else {
        mode = 'horizontal';
      }
      stripHipsPositionTrack(clip, mode);
      // Sesión 30 — Anti-hundido ULTRA: para gathering anims, neutralizar
      // TODOS los tracks de position de TODOS los bones (no solo Hips).
      // Algunos rigs tienen el root motion en bone Pelvis/Armature/Root en
      // lugar de Hips. Esto lo cubre todo de un saque.
      if (name === 'woodcut' || name === 'kneel') {
        stripAllRootPositionTracks(clip);
        // Sesión 30 — Anti-ACOSTADO: las anims Woodcut/Kneel de Mixamo
        // pueden traer rotaciones del torso (Hips/Spine/Neck) que vienen
        // mal aplicadas al rig si los nombres difieren. Resultado: char
        // acostado. Solución: ELIMINAR esos tracks de rotación. El torso
        // queda en bind pose (parado), y los brazos hacen el movimiento.
        stripTorsoRotationTracks(clip);
      }
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
   * Reproduce una animación de locomoción (idle/walk/run) en cierta dirección.
   * Es la API principal para mover el char visualmente. No-op si está atacando,
   * en transición, muerto o no cargado.
   *
   * Comportamiento según combatStance:
   *   - false → usa anims normales (idle, walk_forward, run_forward, etc).
   *   - true  → usa anims con espada (sword_idle, sword_run_forward, etc).
   *
   * Direcciones soportadas:
   *   - 'forward' (default) — siempre disponible
   *   - 'back', 'left', 'right' — fallback a 'forward' si no existe la anim
   *
   * @param {'idle'|'walk'|'run'} state
   * @param {'forward'|'back'|'left'|'right'} [direction='forward']
   *
   * @example
   *   character.play('walk');                 // walk_forward
   *   character.play('run', 'left');          // run_left si existe, sino run_forward
   *   character.setCombatStance(true);
   *   character.play('run', 'back');          // sword_run_back si existe
   */
  play(state, direction = 'forward') {
    if (!this.loaded) return;
    if (this.isAttacking || this.isInTransition || this.isDead) return;

    // Sesión 36 — Bow idle: NO usar crossFade normal porque reseteamos el
    // tiempo de bow_draw_arrow y replayearíamos la anim de "sacar la flecha"
    // cada vez que el player se detiene. _holdBowDrawnPose() posiciona la
    // action en su último frame sin re-disparar el clip.
    if (state === 'idle'
        && this.combatStance
        && this._combatStanceMode === 'bow'
        && this.actions.bow_draw_arrow) {
      if (this.current !== this.actions.bow_draw_arrow) {
        this._holdBowDrawnPose();
      }
      return;
    }

    const name = this._resolveLocomotion(state, direction);
    const next = this.actions[name] || this.actions[this._fallbackLocomotion(state)];
    if (!next || next === this.current) return;
    this._crossFadeTo(next, CROSSFADE);
  }

  _resolveLocomotion(state, direction) {
    if (state === 'idle') {
      if (!this.combatStance) return 'idle';
      // Bow idle ya se maneja en play() arriba (early return). Si llegamos
      // acá con bow + idle es porque bow_draw_arrow no cargó — fallback safe.
      return 'sword_idle';
    }
    if (this.combatStance) {
      // Sesión 36 — bow stance: locomoción con anims de bow (4-dir walk).
      // Running con bow cae a run_* normal (no hay bow_run_*).
      if (this._combatStanceMode === 'bow') {
        if (state === 'walk') {
          const key = `bow_walk_${direction}`;
          if (this.actions[key]) return key;
          if (this.actions.bow_walk_forward) return 'bow_walk_forward';
          return 'walk_forward';  // fallback final
        }
        // 'run' — sin bow_run_*, usamos run_* genérico.
        const rkey = `run_${direction}`;
        if (this.actions[rkey]) return rkey;
        return 'run_forward';
      }
      // Sword stance (default histórico — sword/axe/pickaxe/unarmed).
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

  /**
   * Activa/desactiva la pose de combate. Cambia qué anims se usan en `play()`:
   *
   *   - true  → idle = sword_idle (o bow held si modo='bow'), walk/run = sword_* o bow_*
   *   - false → idle = idle normal, walk/run = anims normales
   *
   * Llamado por combat_hooks.js al entrar/salir de combate. Para armas que
   * tienen anim de draw (1h_sword, 2h_sword) `playDraw()` lo activa solo.
   * Para bow: `playBowDraw()` lo activa + setea _combatStanceMode='bow'.
   * Para herramientas (axe/pickaxe) y staff, hay que llamar este método
   * manualmente porque no hay anim de draw.
   *
   * Sesión 36 — al salir de combate (on=false):
   *   - Reseteamos _combatStanceMode a 'sword' (default).
   *   - Cancelamos cualquier secuencia de bow attack pendiente (sino el
   *     setTimeout dispararía Recoil/holdPose después de que el char ya
   *     no esté en combate ranged → pose inconsistente).
   *
   * @param {boolean} on
   */
  setCombatStance(on) {
    this.combatStance = !!on;
    if (!on) {
      this._combatStanceMode = 'sword';
      // Sesión 36 — Si el player sale de combate mid-attack (NPC muere
      // durante un Overdraw, disengage, switch de arma, etc.), liberamos
      // isAttacking acá para que el siguiente combate / acción no quede
      // bloqueado hasta que la setTimeout que estaba pendiente se cancele.
      this.isAttacking = false;
      if (this._bowAttackTimeoutId !== null) {
        clearTimeout(this._bowAttackTimeoutId);
        this._bowAttackTimeoutId = null;
      }
    }
  }

  /**
   * Reproduce la anim de desenvainar espada + activa combatStance al terminar.
   * Solo para weapon_type '1h_sword' o '2h_sword'. Para otras armas usar
   * `setCombatStance(true)` directamente.
   *
   * Duración escalada a DRAW_MS (~600ms).
   * No-op si está muerto, no cargado, o ya en transición.
   */
  /**
   * Reproduce la anim de desenvainar espada + activa combatStance al terminar.
   * Solo para weapon_type '1h_sword' o '2h_sword'. Para otras armas usar
   * `setCombatStance(true)` directamente.
   *
   * Duración escalada a DRAW_MS (~600ms).
   * No-op si está muerto o no cargado.
   *
   * Sesión 33 (B-002):
   * - Cancela cualquier setTimeout pendiente de draw/sheath previo, así el
   *   flag combatStance no queda pisado por un timer viejo.
   * - Si `isInTransition` estaba pegado, igual procede (no abortamos — eso
   *   dejaba combatStance pegado en true si playSheath se llamaba antes de
   *   que terminara playDraw).
   */
  playDraw() {
    if (!this.loaded || this.isDead) return;

    // Sesión 33 (B-002) — cancelar timeout pendiente de draw/sheath anterior
    if (this._drawSheathTimeoutId !== null) {
      clearTimeout(this._drawSheathTimeoutId);
      this._drawSheathTimeoutId = null;
    }

    const action = this.actions.draw;
    if (!action) {
      this.combatStance = true;
      this.isInTransition = false;
      return;
    }

    this._scaleOneShot(action, DRAW_MS);
    this._crossFadeTo(action, 0.08);
    this.isInTransition = true;

    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    this._drawSheathTimeoutId = setTimeout(() => {
      this._drawSheathTimeoutId = null;
      this.combatStance = true;
      this.isInTransition = false;
      this.current = null;
    }, dur + 20);
  }

  /**
   * Reproduce la anim de envainar espada + desactiva combatStance al terminar.
   * Solo para weapon_type '1h_sword' o '2h_sword'. Para otras armas usar
   * `setCombatStance(false)` directamente.
   *
   * Sesión 33 (B-002) — Fix de pose residual:
   * - SIEMPRE setea `combatStance=false` y limpia `isInTransition`,
   *   independiente de si la anim de sheath se reproduce o no. Antes hacíamos
   *   `if (isInTransition) return;` y eso dejaba el flag pegado en true para
   *   siempre si el usuario mataba al NPC rápido (mientras la anim de draw
   *   todavía estaba corriendo).
   * - Cancela cualquier setTimeout pendiente del playDraw previo, para que su
   *   timer no pise el `combatStance=false` con `combatStance=true` después.
   * - Al terminar el sheath (o si lo saltamos), resetea el mixer y vuelve a
   *   `idle` explícitamente — estilo kneel-fix de S31 (mixer.stopAllAction +
   *   setTime(0)) para que no quede residuo de la anim de combate.
   */
  playSheath() {
    if (!this.loaded || this.isDead) return;

    // Sesión 33 (B-002) — cancelar timeout pendiente de draw/sheath anterior
    if (this._drawSheathTimeoutId !== null) {
      clearTimeout(this._drawSheathTimeoutId);
      this._drawSheathTimeoutId = null;
    }

    const action = this.actions.sheath;

    // Caso 1: no hay action de sheath, o veníamos en transición → saltamos
    // la anim de envainar y reseteamos el mixer a idle directo.
    if (!action || this.isInTransition) {
      this.combatStance = false;
      this.isInTransition = false;
      this._forceIdleReset();
      return;
    }

    // Caso 2: anim normal de sheath. Reproducirla y al terminar resetear.
    this._scaleOneShot(action, SHEATH_MS);
    this._crossFadeTo(action, 0.08);
    this.isInTransition = true;

    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    this._drawSheathTimeoutId = setTimeout(() => {
      this._drawSheathTimeoutId = null;
      this.combatStance = false;
      this.isInTransition = false;
      this.current = null;
      // Forzar reset del mixer para que no quede el sword_idle/sword_run
      // como current. El próximo play('idle') de world.js hará el crossfade
      // limpio desde idle, no desde una pose de combate stale.
      this._forceIdleReset();
    }, dur + 20);
  }

  /**
   * Sesión 36 — Equivalente a playDraw() pero para weapon_type='bow'.
   *
   * Reproduce Bow_Draw_Arrow una vez (clampWhenFinished=true) — el char
   * saca y prepara la flecha — y deja el último frame como held pose.
   * Setea combatStance=true Y _combatStanceMode='bow' para que play()/
   * _resolveLocomotion enruten a las anims correctas mientras dure combate.
   *
   * Diferencia clave vs playDraw (sword):
   *   - NO hay anim de "guardar el arco" (no existe Bow_Sheath.fbx). Al
   *     salir de combate, RangedStyle.onExitCombat llama setCombatStance(false)
   *     + _forceIdleReset directo, sin transición animada. OSRS-style.
   *
   * Si bow_draw_arrow no cargó (warning del FBX validator, R2 falló, etc.),
   * cae a setCombatStance(true) básico — el char queda en pose sword_idle
   * con arco equipado, visualmente raro pero funcional.
   */
  playBowDraw() {
    if (!this.loaded || this.isDead) return;

    // Cancelar timeout pendiente de draw/sheath anterior (B-002 pattern).
    if (this._drawSheathTimeoutId !== null) {
      clearTimeout(this._drawSheathTimeoutId);
      this._drawSheathTimeoutId = null;
    }

    const action = this.actions.bow_draw_arrow;
    if (!action) {
      // Fallback: solo setea stance, sin anim.
      this.combatStance = true;
      this._combatStanceMode = 'bow';
      this.isInTransition = false;
      return;
    }

    this._scaleOneShot(action, BOW_DRAW_MS);
    this._crossFadeTo(action, 0.1);
    this.combatStance = true;
    this._combatStanceMode = 'bow';
    this.isInTransition = true;

    const dur = Math.max(120, action.getClip().duration * 1000 / action.timeScale);
    this._drawSheathTimeoutId = setTimeout(() => {
      this._drawSheathTimeoutId = null;
      this.isInTransition = false;
      // action queda clampeada en último frame (clampWhenFinished=true).
      // play('idle') siguiente verá _combatStanceMode='bow' y enrutará por
      // _holdBowDrawnPose, que detectará current === bow_draw_arrow y será no-op.
    }, dur + 20);
  }

  /**
   * Sesión 36 — Helper para "saltar" a la pose drawn del bow sin replayear
   * la anim de sacar la flecha desde frame 0.
   *
   * Por qué existe: bow_draw_arrow es una anim ONE-SHOT (LoopOnce + clamp).
   * Si la crossfadeamos con _crossFadeTo, este hace `action.reset()` que
   * pone time=0 → el char vuelve a hacer toda la anim de sacar la flecha
   * cada vez que vuelve a idle (después de caminar, después de un attack).
   *
   * Lo que hacemos acá: posicionamos la action en su último frame (con un
   * epsilon antes de duration para que clampWhenFinished agarre el frame
   * final, no quede flotando en el "after" del LoopOnce), la marcamos como
   * current, y dejamos que el mixer congele esa pose.
   *
   * Llamado desde:
   *   - play('idle') cuando bow stance + bow_draw_arrow existe + current !== bow_draw_arrow.
   *   - _playBowAttack() al terminar la secuencia Overdraw→Recoil para
   *     volver al held pose entre disparos.
   */
  _holdBowDrawnPose() {
    const action = this.actions.bow_draw_arrow;
    if (!action) return;
    const clip = action.getClip();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    // Epsilon antes de duration: garantiza que estemos DENTRO del rango del
    // clip (no en el "after-end" donde el LoopOnce puede comportarse raro).
    action.time = Math.max(0, clip.duration - 0.01);
    action.play();
    if (this.current && this.current !== action) {
      action.crossFadeFrom(this.current, 0.1, true);
    }
    this.current = action;
    // Forzar evaluación del sample para evitar 1 frame de bind pose (S26 pattern).
    if (this.mixer) this.mixer.update(0);
  }

  /**
   * Sesión 33 (B-002) — Helper para forzar reset del mixer a idle limpio.
   * Inspirado en el kneel-fix de S31. Limpia cualquier action residual del
   * mixer y arranca idle desde t=0. Usar SOLO cuando combatStance ya está
   * en false (sino vas a romper la pose de combate).
   *
   * Idempotente y safe — si el mixer no está listo o no hay idle, no-op.
   */
  _forceIdleReset() {
    if (!this.mixer) return;
    const idle = this.actions.idle;
    if (!idle) return;
    try {
      this.mixer.stopAllAction();
      this.mixer.setTime(0);
      idle.reset();
      idle.setEffectiveTimeScale(1);
      idle.setEffectiveWeight(1);
      idle.enabled = true;
      idle.play();
      this.current = idle;
    } catch (err) {
      console.warn('[character] _forceIdleReset failed:', err?.message);
    }
  }

  /**
   * Reproduce una animación de ataque. Llamado por combat.js cada tick (600ms)
   * vía `window.__playerPlayAttack`.
   *
   * Decide qué anim usar según el ARMA equipada, no solo el stance:
   *   - 1H sword / unarmed → `Punching.fbx` siempre (con escudo+espada se ve bien)
   *   - 2H sword           → `Sword_Attack_N` según stance: chop=1, slash=2, smash=3, block=4
   *   - Staff / Bow        → cycle automático attack_1..4
   *
   * Escala la anim a `cooldownMs` con `setEffectiveTimeScale`. Si la anim
   * natural es más larga que el cooldown, se acelera; si es más corta, se
   * deja en velocidad natural (no se ralentiza para no verse fake).
   *
   * Setea `isAttacking = true` durante la duración. world.js no llama play()
   * mientras eso es true → la anim corre completa sin interrupción.
   *
   * No-op si está muerto, atacando ya, o en transición.
   *
   * @param {'chop'|'slash'|'smash'|'block'|undefined} stanceKey   Solo se usa para 2h_sword.
   * @param {'1h_sword'|'2h_sword'|'bow'|'staff'|'axe'|'pickaxe'|'unarmed'} weaponType
   * @param {number} [cooldownMs=ATTACK_TICK_MS]    Duración objetivo (default 600ms).
   *
   * @example
   *   // Desde combat.js:
   *   window.__playerPlayAttack('slash', '2h_sword', 600);
   *   //   → reproduce Sword_Attack_2.fbx escalada a 600ms
   */
  playAttack(stanceKey, weaponType, cooldownMs, spellId) {
    if (!this.loaded || this.isDead) return 'not_loaded_or_dead';
    if (this.isAttacking || this.isInTransition) return this.isAttacking ? 'busy_attacking' : 'busy_transition';

    const animMs = (typeof cooldownMs === 'number' && cooldownMs > 0)
      ? cooldownMs
      : ATTACK_TICK_MS;

    // Sesión 36 — Bow es una SECUENCIA (Overdraw windup → Recoil release),
    // no una anim sola. Si tenemos los clips cargados, delegamos al helper.
    // Si no cargaron (warning del FBX validator), caemos al cycle de sword
    // (degrade gracefully: el char ataca con anim de espada mientras dispara
    // flechas — funcional aunque visualmente raro, mismo comportamiento que
    // pre-S36).
    if (weaponType === 'bow'
        && this.actions.bow_overdraw
        && this.actions.bow_recoil) {
      this._playBowAttack(animMs);
      return 'bow_sequence';
    }

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
    // Sesión 42 — Staff CON hechizo → anim de casteo según el spell_id.
    // El server manda el spell_id por el 4º arg. Si el clip no cargó (warning
    // del loader), caemos abajo al cycle de sword para no quedarnos sin anim.
    else if (weaponType === 'staff' && spellId && SPELL_ANIM[spellId] && this.actions[SPELL_ANIM[spellId]]) {
      action = this.actions[SPELL_ANIM[spellId]];
    }
    // Staff SIN hechizo (golpe con el palo = melé) o bow fallback → cycle sword
    else if (weaponType === 'staff' || weaponType === 'bow') {
      this.attackCycle = (this.attackCycle % 4) + 1;
      action = this.actions[`attack_${this.attackCycle}`] || this.actions.attack_1;
    }
    // Fallback
    if (!action) action = this.actions.punching || this.actions.attack_1;
    if (!action) return 'no_action_clip';

    this._scaleOneShot(action, animMs);
    this._crossFadeTo(action, 0.08);
    this.isAttacking = true;

    // Sesión 26 — al terminar, solo desbloqueamos isAttacking. La anim
    // de ataque queda en su ÚLTIMO frame (clampWhenFinished=true puesto
    // por _scaleOneShot), así NO hay T-pose. world.js detectará
    // isAttacking=false y llamará play("idle") o play("sword_idle") en
    // el siguiente update, lo que hace un _crossFadeTo natural desde
    // el último frame del ataque hacia idle (la transición la maneja
    // crossFadeFrom). Antes hacíamos un crossfade explícito aquí mismo
    // pero eso CORTABA el giro de las anims attack_2/attack_3 que
    // necesitan ejecutarse hasta el final para verse completas.
    setTimeout(() => {
      this.isAttacking = false;
    }, animMs + 20);
    return 'played';
  }

  /**
   * Sesión 36 — Secuencia de ataque del bow.
   *
   * Timing fijo (no escalado al cooldown del server):
   *   t=0:                    Bow_Overdraw arranca (windup, 200ms).
   *   t=BOW_OVERDRAW_MS:      Bow_Recoil arranca (release, 150ms). En este
   *                           mismo instante, combat.js dispara el proyectil
   *                           visual con opts.windupMs=BOW_OVERDRAW_MS, así
   *                           la flecha sale visualmente al soltar.
   *   t=200+150:              _holdBowDrawnPose() vuelve al held pose Y
   *                           isAttacking=false. A partir de acá, si el
   *                           player se está moviendo, world.js crossfadea
   *                           a bow_walk_* (kiting OSRS-style: te alejás
   *                           del NPC mientras seguís disparando). Si no se
   *                           mueve, el held pose se mantiene hasta el
   *                           próximo attack tick del server.
   *   t=cooldownMs:           combat.js manda el próximo __playerPlayAttack
   *                           y arranca otra secuencia.
   *
   * Por qué libero isAttacking a los 350ms y no al cooldown completo
   * (~900ms para bow): las anims de Bow_Overdraw/Recoil son SOLO upper-body
   * (el char tensa y suelta, las piernas no se animan). Si bloqueamos
   * locomoción durante todo el cooldown, las piernas quedan estáticas y el
   * char "patina" al moverse. Liberando a los 350ms, los 550ms restantes
   * del cooldown quedan disponibles para bow_walk_* o el held pose.
   *
   * Cancelación: si el player sale de combate / muere / pierde el target
   * mientras la secuencia está en curso, setCombatStance(false) cancela
   * _bowAttackTimeoutId Y limpia isAttacking. Los guards internos cubren
   * el caso por las dudas.
   */
  _playBowAttack(cooldownMs) {
    // cooldownMs llega por compat de signature pero no se usa — el lockout
    // visual de bow es la duración de la anim (350ms), no el cooldown del
    // server (~900ms). Ver doc arriba.
    void cooldownMs;

    const overdraw = this.actions.bow_overdraw;
    const recoil   = this.actions.bow_recoil;

    // Cancelar secuencia previa si quedó algún timeout vivo.
    if (this._bowAttackTimeoutId !== null) {
      clearTimeout(this._bowAttackTimeoutId);
      this._bowAttackTimeoutId = null;
    }

    this._scaleOneShot(overdraw, BOW_OVERDRAW_MS);
    this._crossFadeTo(overdraw, 0.06);
    this.isAttacking = true;

    // Fase 2: al terminar el windup, disparar Bow_Recoil.
    this._bowAttackTimeoutId = setTimeout(() => {
      this._bowAttackTimeoutId = null;
      if (this.isDead) { this.isAttacking = false; return; }
      // Guard: player salió de combat / cambió de arma mid-attack.
      if (!this.combatStance || this._combatStanceMode !== 'bow') {
        this.isAttacking = false;
        return;
      }

      this._scaleOneShot(recoil, BOW_RECOIL_MS);
      this._crossFadeTo(recoil, 0.06);

      // Fase 3: al terminar Recoil, volver al held pose Y liberar isAttacking.
      // El orden importa: held pose primero (define current), después
      // isAttacking=false (permite que world.js tome el control si hay movimiento).
      this._bowAttackTimeoutId = setTimeout(() => {
        this._bowAttackTimeoutId = null;
        if (this.isDead) { this.isAttacking = false; return; }
        if (this.combatStance && this._combatStanceMode === 'bow') {
          this._holdBowDrawnPose();
        }
        this.isAttacking = false;
      }, BOW_RECOIL_MS + 20);
    }, BOW_OVERDRAW_MS);
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

  /**
   * Restaura al char desde el estado `isDead = true` a idle limpio.
   * Llamado por combat_hooks.js en `window.__playerRevive()` después de
   * respawnear.
   *
   * Pasos críticos (no cambiar el orden — ver INVARIANTS 2.5):
   *   1. Reset de flags (isDead, isAttacking, isInTransition, combatStance).
   *   2. Desactivar `clampWhenFinished` de las death anims (sino se queda en
   *      pose de muerte aunque cambiemos a idle).
   *   3. `stop() + reset()` explícitos de las death anims.
   *   4. `mixer.stopAllAction() + setTime(0)` — limpia poses residuales.
   *   5. Arrancar idle desde cero con `reset() + play()` y `setEffectiveTimeScale(1)`.
   *
   * Sin estos 5 pasos, el char puede quedar visualmente "muerto pero moviéndose"
   * o en T-pose. Es el mismo patrón que usa playGather (el mixer hard reset).
   */
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

  /**
   * Reproduce una animación one-shot de gathering (tala, encender fuego, minar
   * futuro). Patrón estándar para skills que arrodillan/agachan al char.
   *
   * `animKey` debe existir en `ANIM_FILES` (ej: 'punching', 'kneel', 'mining').
   *
   * Comportamiento clave:
   *   - Marca `_gatheringActive = true` y `_gatherAnimName = animKey` para que
   *     world.js (updatePlayer) aplique el Y offset por anim
   *     (`window.__gatherY = { kneel: -0.6 }` etc).
   *   - Suspende combatStance durante la anim → entre swings no vuelve a
   *     sword_idle (que muestra la espada).
   *   - Marca `isInTransition` → el player no puede cambiar a walk/idle
   *     visualmente mientras dura.
   *
   * Al terminar la anim hace **un cleanup duro** (S31 fix del kneel hundido):
   *   1. Reset de flags (`_gatheringActive = false`, `combatStance` restaurado).
   *   2. `action.setEffectiveTimeScale(1)` — sin esto idle hereda timeScale
   *      corrupto y corre a la mitad de velocidad por 5s (bug fixed S31).
   *   3. `mixer.stopAllAction() + setTime(0)` — limpia pose residual del
   *      gather, sin esto el char queda "hundido visualmente" hasta que el
   *      ciclo de idle complete (bug fixed S31).
   *   4. `play('idle')` — vuelve a estado normal.
   *
   * Ver INVARIANTS sección 3.2 para los 5 pasos del cleanup.
   *
   * @param {'punching'|'kneel'|'mining'|string} animKey  clip name en ANIM_FILES
   * @param {number} [durationMs]
   *   - `0` / `undefined` / `null` → usa duración natural del clip.
   *     **Recomendado** para anims que se ven mejor a velocidad normal (woodcut).
   *   - `> 0` → escala el clip a esa duración. Si la anim natural es más larga,
   *     se acelera. Si es más corta, se deja natural (no se ralentiza).
   *     Usado en kneel con 1800ms.
   *
   * @returns {number} Duración real (ms) de la anim. 0 si no pudo arrancar
   *   (char muerto, atacando, en transición, o anim no existe).
   *
   * @example
   *   // Encender fuego (firemaking.js):
   *   const dur = character.playGather('kneel', 1800);
   *   setTimeout(() => spawnFireSprite(), dur);
   *
   *   // Tala (woodcutting.js):
   *   character.playGather('punching', 0);  // natural duration
   */
  playGather(animKey, durationMs) {
    if (!this.loaded || this.isDead) return 0;
    if (this.isAttacking || this.isInTransition) return 0;
    const action = this.actions[animKey];
    if (!action) {
      console.warn('[character] playGather: anim no encontrada:', animKey);
      return 0;
    }

    const clipMs = action.getClip().duration * 1000;
    const useNatural = !durationMs || durationMs <= 0 || clipMs <= durationMs;
    const dur = useNatural ? clipMs : durationMs;

    // Suspender combat stance: que entre swings no vea "sword_idle".
    const wasCombatStance = this.combatStance;
    this.combatStance = false;

    // Sesión 30 — flag indicador para que world.js sepa que estamos en
    // anim de gathering (woodcut/kneel) y aplique offset Y extra.
    // _gatherAnimName indica cuál anim para distinguir offsets.
    this._gatheringActive = true;
    this._gatherAnimName = animKey;

    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    const timeScale = useNatural ? 1 : (clipMs / durationMs);
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    this._crossFadeTo(action, 0.12);
    this.isInTransition = true;

    // Antes de terminar, bajar clampWhenFinished para no quedarse en
    // último frame al hacer la transición.
    const exitMs = Math.max(60, dur - 100);
    setTimeout(() => {
      try {
        action.clampWhenFinished = false;
      } catch {}
    }, exitMs);

    setTimeout(() => {
      this.isInTransition = false;
      this.current = null;
      this.combatStance = wasCombatStance;
      this._gatheringActive = false;
      this._gatherAnimName = null;
      // Sesión 31 fix kneel — resetear timeScale del action que acabamos
      // de usar Y del idle al que vamos a transicionar. Sin esto, idle
      // hereda un timeScale ~0.47 → corre a la mitad de velocidad durante
      // ~10s, el char queda "anatómicamente entre poses" con los pies
      // hundidos, hasta que el ciclo de idle termina y se resetea.
      try {
        action.setEffectiveTimeScale(1);
        const idleAction = this.actions.idle;
        if (idleAction) idleAction.setEffectiveTimeScale(1);
      } catch {}
      // Sesión 31 fix kneel #2 — el kneel deja escrita en los bones la
      // pose "arrodillado" (rodillas dobladas, pies hacia adentro). Three.js
      // no resetea esos valores aunque empecemos el idle. Crossfade gradual
      // mantiene 50% de la pose vieja durante el primer ciclo del idle (5s)
      // → char hundido visualmente aunque pos.y sea correcto.
      // Fix: stopAllAction + setTime(0) limpia los valores residuales del
      // mixer ANTES de arrancar idle fresh.
      try {
        if (this.mixer) {
          this.mixer.stopAllAction();
          this.mixer.setTime(0);
        }
        if (action) {
          action.stop();
          action.reset();
        }
      } catch {}
      try { this.play('idle'); } catch {}
    }, dur + 20);

    return dur;
  }

  /**
   * Sesión 32 — Reacción visual al recibir un hit (PvP / NPC).
   *
   * Reproduce una anim corta de "flinch" cuando te pegan. NO interrumpe:
   *   - Anim de attack en curso (tu attack es prioridad — se ve fluido)
   *   - Gather (talar/encender fuego — no se rompe la acción)
   *   - Transiciones (draw/sheath)
   *   - Muerte
   *
   * Si nada de eso bloquea, reproduce 'react' como one-shot acelerado
   * (~400ms) y vuelve al estado anterior (idle/sword_idle/walk/run).
   *
   * @returns {boolean} true si reprodujo la anim, false si fue ignorada.
   */
  playHitReaction() {
    if (!this.loaded || this.isDead) return false;
    if (this.isAttacking) return false;       // No interrumpe attack
    if (this.isInTransition) return false;    // No durante draw/sheath
    if (this._gatheringActive) return false;  // No durante gather

    const action = this.actions.react;
    if (!action) {
      // Anim no cargada (Reaction.fbx no subida o falló). No-op silencioso.
      return false;
    }

    // Si ya estamos reproduciendo react, ignorar (evita stack de reacciones
    // si recibís 2 hits casi simultáneos).
    if (this._isReacting) return false;

    // Target de la anim: 400ms. Si la natural es más corta, usa la natural
    // (no la ralentizamos). Si es más larga, la acelera.
    const TARGET_MS = 400;
    const clipMs = action.getClip().duration * 1000;
    const useNatural = clipMs <= TARGET_MS;
    const dur = useNatural ? clipMs : TARGET_MS;
    const timeScale = useNatural ? 1 : (clipMs / TARGET_MS);

    // Recordar el estado actual para volver después
    const wasCombatStance = this.combatStance;
    this._isReacting = true;

    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;  // Que no se quede en último frame
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.play();
    if (this.current) {
      action.crossFadeFrom(this.current, 0.08, true);
    }
    this.current = action;

    // Al terminar, volver al estado anterior (idle/sword_idle según stance)
    setTimeout(() => {
      this._isReacting = false;
      try {
        action.setEffectiveTimeScale(1);
        this.current = null;
        this.combatStance = wasCombatStance;
        this.play('idle');
      } catch {}
    }, dur + 20);

    return true;
  }

  // ============================================================
  // Sesión 42c — Layered blend: parte cada clip en versión PIERNAS y TORSO.
  // Piernas = Hips + UpLeg/Leg/Foot/Toe (izq+der). Torso = el resto
  // (Spine*, Neck, Head, Shoulder/Arm/ForeArm/Hand + dedos). Hips va a la
  // capa PIERNAS (el torso hereda la cadera del walk → se ve natural).
  // El root motion ya está stripeado en _registerClip, así que las piernas
  // quedan in-place. ADITIVO: crea actions `<name>__legs` / `<name>__torso`
  // sin tocar las existentes.
  // ============================================================
  _buildLayeredClips() {
    const LEG_RE = /(Hips|UpLeg|Leg|Foot|Toe)/i;
    const isLeg = (trackName) => LEG_RE.test(String(trackName).split('.')[0]);
    let built = 0;
    const sourceNames = Object.keys(this.clips);
    for (const name of sourceNames) {
      const clip = this.clips[name];
      if (!clip || !Array.isArray(clip.tracks)) continue;
      const legTracks = clip.tracks.filter(t => isLeg(t.name)).map(t => t.clone());
      const torsoTracks = clip.tracks.filter(t => !isLeg(t.name)).map(t => t.clone());
      if (legTracks.length) {
        const legClip = new THREE.AnimationClip(name + '__legs', clip.duration, legTracks);
        this.actions[name + '__legs'] = this.mixer.clipAction(legClip);
        this.clips[name + '__legs'] = legClip;
      }
      if (torsoTracks.length) {
        const torsoClip = new THREE.AnimationClip(name + '__torso', clip.duration, torsoTracks);
        this.actions[name + '__torso'] = this.mixer.clipAction(torsoClip);
        this.clips[name + '__torso'] = torsoClip;
      }
      built++;
    }
    console.log('[character] layered clips construidos para', built, 'clips');
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

    // Sesión 33 / 36 — cancelar timeouts pendientes para que no operen sobre
    // un mixer ya descartado.
    if (this._drawSheathTimeoutId !== null) {
      clearTimeout(this._drawSheathTimeoutId);
      this._drawSheathTimeoutId = null;
    }
    if (this._bowAttackTimeoutId !== null) {
      clearTimeout(this._bowAttackTimeoutId);
      this._bowAttackTimeoutId = null;
    }
    this._combatStanceMode = 'sword';

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
  // Sesión 31 — guardamos cuántos matcheaban *de entrada* (sin adaptar) para
  // distinguir "todo OK desde el principio" de "adaptamos a otro esquema".
  let alreadyOk = 0;
  const total = clip.tracks.length;
  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const original = track.name.slice(0, dotIdx);
    const property = track.name.slice(dotIdx);
    if (boneNames.has(original)) { alreadyOk++; continue; }
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
  // Sesión 31 — validador FBX. Reporta match% para detectar anims rotas
  // antes de que se vean rotas en pantalla. Ataca el problema #3 del retro
  // de S30: "no hay validador de anims FBX al cargar".
  const matched = alreadyOk + adapted;
  const pct = total > 0 ? Math.round((matched / total) * 100) : 100;
  const tag = '[character/fbx-validator]';
  if (total === 0) {
    console.warn(tag, 'clip "' + clip.name + '" sin tracks — anim vacía o rota');
  } else if (pct < 60) {
    // Match bajo: la anim se va a ver MAL (huesos sin animar quedan en
    // bind pose, T-pose parcial, etc). Avisar fuerte.
    console.warn(tag, '⚠️ LOW MATCH ' + pct + '% — clip "' + clip.name +
      '": ' + matched + '/' + total + ' tracks (' + alreadyOk + ' direct + ' +
      adapted + ' adapted, ' + dropped + ' dropped). La anim puede verse ROTA.');
    // Marcar el clip como "unstable" para que diag/health puedan reportarlo.
    clip.userData = clip.userData || {};
    clip.userData.fbxMatchPct = pct;
    clip.userData.fbxUnstable = true;
  } else if (adapted > 0 || dropped > 0) {
    // Match decente pero hubo trabajo: log informativo.
    console.log(tag, 'clip "' + clip.name + '": ' + pct + '% match (' +
      alreadyOk + ' direct + ' + adapted + ' adapted, ' + dropped + ' dropped)');
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
  // Original name + variantes de prefijo
  out.push(name);
  out.push('mixamorig:' + core);
  out.push('mixamorig' + core);
  out.push('mixamorig1:' + core);
  out.push('mixamorig1' + core);
  out.push(core);

  // Sesión 30 — Strip de sufijo numérico (Mixamo a veces nombra como
  // "Neck1", "Spine1", "Spine2" cuando el skeleton base solo tiene
  // "Neck", "Spine"). Sin esto, Woodcut/Kneel no aplicaba la rotación
  // del cuello/columna y el char quedaba en bind pose (T-pose acostado).
  // Generamos variantes SIN el sufijo si lo tiene.
  const stripped = core.replace(/[12]$/, '');
  if (stripped !== core && stripped.length > 0) {
    out.push('mixamorig:' + stripped);
    out.push('mixamorig' + stripped);
    out.push('mixamorig1:' + stripped);
    out.push('mixamorig1' + stripped);
    out.push(stripped);
  }
  // También probar AGREGANDO sufijo numérico (caso inverso)
  out.push('mixamorig:' + core + '1');
  out.push('mixamorig' + core + '1');
  out.push(core + '1');

  return out;
}

function stripHipsPositionTrack(clip, mode = 'horizontal') {  let count = 0;
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

function stripAllRootPositionTracks(clip) {
  let count = 0;
  const boneNamesAffected = [];
  for (const t of clip.tracks) {
    const dotIdx = t.name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const property = t.name.slice(dotIdx + 1);
    if (property !== 'position') continue;
    // Capturar valores iniciales (frame 0) y replicarlos en TODOS los frames.
    const v = t.values;
    const nFrames = v.length / 3;
    const x0 = v[0];
    const y0 = v[1];
    const z0 = v[2];
    for (let i = 0; i < nFrames; i++) {
      v[i * 3 + 0] = x0;
      v[i * 3 + 1] = y0;
      v[i * 3 + 2] = z0;
    }
    boneNamesAffected.push(t.name.slice(0, dotIdx));
    count++;
  }
  if (count > 0) {
    console.log(`[character] clip "${clip.name}": stripped ALL position tracks (${count}) bones=`, boneNamesAffected);
  }
}

// ============================================================
// Sesión 30 — Anti-ACOSTADO
// ============================================================
// Para gathering anims (woodcut/kneel), eliminar tracks de rotación
// de los huesos del TORSO (Hips, Spine, Spine1, Spine2, Neck, Neck1,
// Head). Estos huesos quedan en su pose default del rig (parado).
// La animación de tala sigue funcionando porque mueve hombros, brazos,
// y manos — que NO son del torso.
//
// Cubre los nombres con cualquier prefijo: "Hips", "mixamorigHips",
// "mixamorig:Hips", "mixamorig1:Hips", etc.
function stripTorsoRotationTracks(clip) {
  const TORSO_NAMES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Neck1', 'Head'];
  let removed = 0;
  const removedNames = [];
  clip.tracks = clip.tracks.filter(t => {
    const dotIdx = t.name.lastIndexOf('.');
    if (dotIdx < 0) return true;
    const property = t.name.slice(dotIdx + 1);
    if (property !== 'quaternion') return true; // solo quitamos rotaciones
    // Extraer el nombre del bone (sin prefijo mixamorig)
    let core = t.name.slice(0, dotIdx);
    const prefixes = ['mixamorig1:', 'mixamorig:', 'mixamorig1', 'mixamorig'];
    for (const p of prefixes) {
      if (core.startsWith(p)) { core = core.slice(p.length); break; }
    }
    if (core.startsWith(':')) core = core.slice(1);
    if (TORSO_NAMES.includes(core)) {
      removed++;
      removedNames.push(t.name);
      return false; // drop
    }
    return true; // keep
  });
  if (removed > 0) {
    console.log(`[character] clip "${clip.name}": removed ${removed} torso rotation tracks =`, removedNames);
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

  function row(label, min, max, step, value, onChange, fmt, opts) {
    fmt = fmt || (v => v.toFixed(2));
    opts = opts || {};
    // Sesión 35 — Re-center on release: cuando soltás el slider, el rango se
    // recentra alrededor del nuevo valor (manteniendo el mismo halfWidth).
    // Permite mover del extremo, soltar, y volver a arrastrar del extremo sin
    // cerrar/reabrir el panel. Para rotation (circular) pasamos recenter:false.
    const recenter = opts.recenter !== false;
    const absMin = opts.absMin != null ? opts.absMin : -Infinity;
    const halfWidth = (max - min) / 2;

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
    if (recenter) {
      range.addEventListener('change', () => {
        const v = parseFloat(range.value);
        range.min = Math.max(absMin, v - halfWidth);
        range.max = v + halfWidth;
        range.value = v;
      });
    }
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

  // Sesión 35 — Rangos de sliders CENTRADOS en el valor actual del mesh,
  // con re-center on release (ver row() arriba).
  //   - Position: ±50 desde current, step 0.5 (movimiento ágil + re-center
  //     permite "encadenar" arrastres del extremo sin reabrir el panel).
  //   - Scale:    ±max(100, current*0.7) desde current, step 1.
  //   - Rotation: ±PI siempre (sin recenter, es circular).
  const sclCur = mesh.scale.x;
  const sclHalf = Math.max(100, sclCur * 0.7);
  body.appendChild(row('Scl', Math.max(1, sclCur - sclHalf), sclCur + sclHalf, 1, sclCur, v => mesh.scale.setScalar(v), v => v.toFixed(0), { absMin: 1 }));

  const sepP = document.createElement('div');
  sepP.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepP.textContent = '─ POSITION';
  body.appendChild(sepP);
  const posHalf = 50;
  const pxCur = mesh.position.x, pyCur = mesh.position.y, pzCur = mesh.position.z;
  body.appendChild(row('X', pxCur - posHalf, pxCur + posHalf, 0.5, pxCur, v => { mesh.position.x = v; }));
  body.appendChild(row('Y', pyCur - posHalf, pyCur + posHalf, 0.5, pyCur, v => { mesh.position.y = v; }));
  body.appendChild(row('Z', pzCur - posHalf, pzCur + posHalf, 0.5, pzCur, v => { mesh.position.z = v; }));

  const sepR = document.createElement('div');
  sepR.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepR.textContent = '─ ROTATION';
  body.appendChild(sepR);
  // Rotación queda ±PI sin re-center (es circular, no tiene sentido extender).
  const PI = Math.PI;
  body.appendChild(row('rX', -PI, PI, 0.05, mesh.rotation.x, v => { mesh.rotation.x = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));
  body.appendChild(row('rY', -PI, PI, 0.05, mesh.rotation.y, v => { mesh.rotation.y = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));
  body.appendChild(row('rZ', -PI, PI, 0.05, mesh.rotation.z, v => { mesh.rotation.z = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));

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
    // Sesión 34 — Output formateado para pegar en WEAPON_TRANSFORMS_BY_ITEM_ID
    // (override por item_id). Mantenemos también el bloque legacy por
    // weapon_type comentado abajo por si querés actualizar la entrada genérica.
    const typeKey = guessTypeKey(weaponId);
    const out = `// → Pegar en WEAPON_TRANSFORMS_BY_ITEM_ID (recomendado para items específicos):
'${weaponId}': {
  scale: ${mesh.scale.x.toFixed(1)},
  position: [${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)}],
  rotation: [${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)}],
  hand: '${ch._equippedWeaponHand}',
},

// → O en WEAPON_TRANSFORMS (afecta TODOS los items del mismo weapon_type):
'${typeKey}': {
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

  function row(label, min, max, step, value, onChange, fmt, opts) {
    fmt = fmt || (v => v.toFixed(2));
    opts = opts || {};
    // Sesión 35 — Re-center on release (mismo patrón que weaponDebug).
    const recenter = opts.recenter !== false;
    const absMin = opts.absMin != null ? opts.absMin : -Infinity;
    const halfWidth = (max - min) / 2;

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
    if (recenter) {
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        inp.min = Math.max(absMin, v - halfWidth);
        inp.max = v + halfWidth;
        inp.value = v;
      });
    }
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

  // Sesión 35 — Mismo patrón que weaponDebug (rangos centrados + step grueso + re-center).
  const sclCur = mesh.scale.x;
  const sclHalf = Math.max(100, sclCur * 0.7);
  body.appendChild(row('Scl', Math.max(1, sclCur - sclHalf), sclCur + sclHalf, 1, sclCur, v => mesh.scale.setScalar(v), v => v.toFixed(0), { absMin: 1 }));

  const sepP = document.createElement('div');
  sepP.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepP.textContent = '─ POSITION';
  body.appendChild(sepP);
  const posHalf = 50;
  const pxCur = mesh.position.x, pyCur = mesh.position.y, pzCur = mesh.position.z;
  body.appendChild(row('X', pxCur - posHalf, pxCur + posHalf, 0.5, pxCur, v => { mesh.position.x = v; }));
  body.appendChild(row('Y', pyCur - posHalf, pyCur + posHalf, 0.5, pyCur, v => { mesh.position.y = v; }));
  body.appendChild(row('Z', pzCur - posHalf, pzCur + posHalf, 0.5, pzCur, v => { mesh.position.z = v; }));

  const sepR = document.createElement('div');
  sepR.style.cssText = 'margin: 4px 0 1px; color: #c8a043; font-size: 9px;';
  sepR.textContent = '─ ROTATION';
  body.appendChild(sepR);
  const PI = Math.PI;
  body.appendChild(row('rX', -PI, PI, 0.05, mesh.rotation.x, v => { mesh.rotation.x = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));
  body.appendChild(row('rY', -PI, PI, 0.05, mesh.rotation.y, v => { mesh.rotation.y = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));
  body.appendChild(row('rZ', -PI, PI, 0.05, mesh.rotation.z, v => { mesh.rotation.z = v; }, v => `${Math.round(v*180/PI)}°`, { recenter: false }));

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
