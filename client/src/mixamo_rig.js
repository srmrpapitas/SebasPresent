/**
 * SebasPresent — Personajes Mixamo para NPCs (Sesión 50)
 *
 * Carga los GLB de client/assets/npcs/ (convertidos de los FBX de Mixamo) y los
 * anima POR CÓDIGO: los FBX vienen en pose T sin clips, así que movemos los
 * huesos (brazos abajo, respirar, andar, gesticular, tambalearse, atacar).
 *
 *   const rig = await mixamoRig.create('guardia1', { tint, armor, height, bottle })
 *   rig.root            → Object3D para añadir a la escena
 *   rig.update(dt, st)  → st = { moving, speed, talk, drunk, attack, lookYaw, hurt }
 *   rig.dispose()
 *
 * Tintes (shader, sobre la textura original):
 *   { hue: 0.3, sat: 1.2, val: 0.9 }     gira el tono de lo que tiene color (tabardos, ropa)
 *   { fire: true }                        ser de fuego: negro → rojo → naranja → amarillo, brilla
 *   { mul: 0x88aaff }                     multiplica (pátinas, fantasmas)
 *
 * Ejes Mixamo (espacio del modelo): +Y arriba, +Z delante, +X a SU izquierda.
 * Cada rotación se expresa en ese espacio sobre la pose de reposo y se convierte
 * a local del hueso (q = qRest · Qw⁻¹ · R · Qw), así no hace falta saber cómo
 * vienen orientados los huesos de cada modelo.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildProceduralArmor, buildProceduralWeapon } from './armor_procedural.js';

const BASE = 'assets/npcs/';
export const RIG_MODELS = {
  guardia1:    { file: 'guardia1.glb',    height: 1.85 },
  guardia2:    { file: 'guardia2.glb',    height: 1.82 },
  goblin2:     { file: 'goblin2.glb',     height: 1.45 },
  zombi:       { file: 'zombi.glb',       height: 1.9 },
  zombi_chico: { file: 'zombi_chico.glb', height: 1.6 },
  warrok:      { file: 'warrok.glb',      height: 2.3 },
  // Pack «Characters Extras» (gente de la calle, en pose A)
  killer_08: { file: 'killer_08.glb', height: 1.82 },   // máscara de cerdo
  killer_09: { file: 'killer_09.glb', height: 1.75 },
  killer_10: { file: 'killer_10.glb', height: 1.95 },   // disfraz de oso
  monster_06: { file: 'monster_06.glb', height: 1.9 },  // alien
  monster_07: { file: 'monster_07.glb', height: 2.0 },
  monster_08: { file: 'monster_08.glb', height: 2.5 },  // bigfoot
  sheriff_n: { file: 'sheriff_n.glb', height: 1.78 },
  sheriff_n_01: { file: 'sheriff_n_01.glb', height: 1.78 },
};
for (const n of [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]) RIG_MODELS['f' + n] = { file: `f${n}.glb`, height: 1.64 };
for (const n of [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]) RIG_MODELS['m' + n] = { file: `m${n}.glb`, height: 1.76 };


// Sesión 50 — clips de Mixamo (sin malla) convertidos a GLB: se aplican a cualquier esqueleto Mixamo
export const ANIM_SETS = {
  mutant: 'anim_mutant.glb',   // idle, idle2, walk, run, attack, death, flex, jump, turn_l, turn_r
};
const _anims = new Map();     // set → Promise<{ clips: {name: clip}, hipsY0 }>
export function preloadAnims(set) {
  if (_anims.has(set)) return _anims.get(set);
  const file = ANIM_SETS[set];
  const p = !file ? Promise.resolve(null) : new GLTFLoader().loadAsync(BASE + file).then(g => {
    const clips = {};
    for (const c of g.animations) clips[c.name] = c;
    const ht = (clips.idle || g.animations[0])?.tracks.find(t => /Hips\.position$/.test(t.name));
    return { clips, hipsY0: ht ? ht.values[1] : 100 };
  }).catch(err => { console.warn('[mixamo_rig] anims', set, err?.message); return null; });
  _anims.set(set, p);
  return p;
}
const _animReady = new Map();
const _adapted = new Map();   // `${model}|${set}` → {name: clip} con las caderas a la escala del modelo

function adaptedClips(model, set, hipsRest, boneNames) {
  const k = model + '|' + set;
  if (_adapted.has(k)) return _adapted.get(k);
  const A = _animReady.get(set); if (!A) return null;
  const out = {};
  const ratio = hipsRest.y / (A.hipsY0 || 100);
  for (const [name, c0] of Object.entries(A.clips)) {
    const c = c0.clone();
    if (boneNames) c.tracks = c.tracks.filter(t => boneNames.has(t.name.slice(0, t.name.lastIndexOf('.'))));
    for (const t of c.tracks) {
      if (/Hips\.position$/.test(t.name)) {
        const v = t.values;
        for (let i = 0; i < v.length; i += 3) { v[i] = hipsRest.x; v[i + 1] *= ratio; v[i + 2] = hipsRest.z; }
      }
    }
    out[name] = c;
  }
  _adapted.set(k, out);
  return out;
}

const _tpl = new Map();      // id → Promise<{ scene, scale, groundY } | null>
const _ready = new Map();    // id → template (ya cargado)
const _matCache = new Map(); // `${id}|${tintKey}|${matName}` → Material

const bare = (n) => String(n || '').replace(/^mixamorig\d*:?/, '');

export function isLoaded(id) { return _ready.has(id); }

export function preload(id, animSet = null) {
  const pa = animSet ? preloadAnims(animSet).then(a => { if (a) _animReady.set(animSet, a); }) : Promise.resolve();
  if (_tpl.has(id)) return Promise.all([_tpl.get(id), pa]).then(r => r[0]);
  const M = RIG_MODELS[id];
  if (!M) return Promise.resolve(null);
  const p = new GLTFLoader().loadAsync(BASE + M.file).then(gltf => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    // Altura y suelo con la malla en reposo
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
      }
    });
    const h = box.max.y - box.min.y;
    const scale = h > 0 ? M.height / h : 1;
    const t = { scene, scale, groundY: -box.min.y * scale };
    _ready.set(id, t);
    return t;
  }).catch(err => { console.warn('[mixamo_rig] no se pudo cargar', id, err?.message); return null; });
  _tpl.set(id, p);
  return Promise.all([p, pa]).then(r => r[0]);
}
export function animsLoaded(set) { return !set || _animReady.has(set); }

// ------------------------------------------------------------
// Tintes por shader
// ------------------------------------------------------------
const HSV_GLSL = `
vec3 sp_rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
vec3 sp_hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
`;
export const fireTime = { value: 0 };   // compartido: todas las llamas laten a la vez

function tintKey(t) { return t ? JSON.stringify(t) : '-'; }

function tintMaterial(src, tint) {
  const m = src.clone();
  if (!tint) return m;
  if (tint.mul != null) m.color = new THREE.Color(tint.mul);
  if (tint.rough != null) m.roughness = tint.rough;
  if (tint.metal != null) m.metalness = tint.metal;
  const hue = tint.hue || 0, sat = tint.sat ?? 1, val = tint.val ?? 1, satMin = tint.satMin ?? 0.18;
  const fire = !!tint.fire;
  if (!hue && sat === 1 && val === 1 && !fire) return m;
  if (fire) { m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.spHue = { value: hue }; sh.uniforms.spSat = { value: sat }; sh.uniforms.spVal = { value: val };
    sh.uniforms.spSatMin = { value: satMin }; sh.uniforms.spTime = fireTime; sh.uniforms.spGain = { value: tint.fireGain ?? 1 };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float spHue, spSat, spVal, spSatMin, spTime, spGain;\nvarying vec3 vSpPos;\n' + HSV_GLSL)
      .replace('#include <map_fragment>', fire ? `#include <map_fragment>
        float spL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float spN = sin(vSpPos.y * 9.0 - spTime * 4.0) * 0.5 + sin(vSpPos.x * 13.0 + spTime * 3.1) * 0.5;
        float spK = clamp(spL * 1.9 * spGain + spN * 0.12, 0.0, 1.0);
        vec3 spFire = spK < 0.35 ? mix(vec3(0.02,0.0,0.0), vec3(0.55,0.04,0.0), spK / 0.35)
                    : spK < 0.7 ? mix(vec3(0.55,0.04,0.0), vec3(1.0,0.45,0.02), (spK - 0.35) / 0.35)
                    : mix(vec3(1.0,0.45,0.02), vec3(1.0,0.92,0.35), (spK - 0.7) / 0.3);
        diffuseColor.rgb = spFire * 0.22;
        vec3 spGlow = spFire * smoothstep(0.42, 0.95, spK) * (1.6 + 0.5 * sin(spTime * 6.0 + vSpPos.y * 5.0));`
      : `#include <map_fragment>
        { vec3 h = sp_rgb2hsv(diffuseColor.rgb);
          float w = smoothstep(spSatMin, spSatMin + 0.15, h.y);
          // la piel y el cuero (naranjas apagados) no se tiñen
          float dSkin = abs(h.x - 0.075);
          w *= mix(1.0, smoothstep(0.035, 0.055, dSkin), step(h.y, 0.75) * step(0.12, h.z));
          h.x = fract(h.x + spHue * w); h.y = clamp(h.y * mix(1.0, spSat, w), 0.0, 1.0); h.z = clamp(h.z * spVal, 0.0, 1.0);
          diffuseColor.rgb = sp_hsv2rgb(h); }`);
    if (fire) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = spGlow;');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpPos = position * 0.01;');
  };
  m.customProgramCacheKey = () => 'sp|' + (fire ? 'fire' : 'hsv');
  return m;
}

function sharedMat(id, tint, src) {
  const k = `${id}|${tintKey(tint)}|${src.name}|${src.uuid}`;
  if (!_matCache.has(k)) _matCache.set(k, tintMaterial(src, tint));
  return _matCache.get(k);
}

// ------------------------------------------------------------
// Bones + animación procedural
// ------------------------------------------------------------
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function collectBones(root) {
  const bones = {};
  root.traverse(o => { if (o.isBone) { const n = bare(o.name); if (!bones[n]) bones[n] = o; } });
  // orientación de reposo de cada hueso en el espacio del modelo
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Quaternion(); root.getWorldQuaternion(rootInv).invert();
  const info = {};
  for (const [n, b] of Object.entries(bones)) {
    const qw = new THREE.Quaternion(); b.getWorldQuaternion(qw); qw.premultiply(rootInv);
    info[n] = { bone: b, rest: b.quaternion.clone(), qw, qwInv: qw.clone().invert() };
  }
  return info;
}

/** Fija el hueso = reposo · (rotación R expresada en el espacio del modelo). */
function setRot(B, name, R) {
  const I = B[name]; if (!I) return;
  _q2.copy(I.qwInv).multiply(R).multiply(I.qw);
  I.bone.quaternion.copy(I.rest).multiply(_q2);
}
function rotXYZ(x, y, z) { return _q.setFromEuler(_e.set(x, y, z, 'YXZ')); }

const LIMBS = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
  'LeftHand', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftShoulder', 'RightShoulder'];

// ------------------------------------------------------------
// Instancias
// ------------------------------------------------------------
/**
 * opts: { tint, armor: ['helm_bronze','body_bronze',...], weapon: 'sword_bronze',
 *         bottle: true, scale: 1, phase, ownMaterials: bool (para flashes) }
 * Devuelve null si el modelo no está cargado todavía (usa preload()).
 */
export function create(id, opts = {}) {
  const T = _ready.get(id);
  if (!T) return null;
  const inner = SkeletonUtils.clone(T.scene);
  const s = T.scale * (opts.scale || 1);
  inner.scale.setScalar(s);
  inner.position.y = T.groundY * (opts.scale || 1);
  const root = new THREE.Group();
  root.add(inner);

  const materials = [];
  inner.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.castShadow = true;
    const mk = (m) => {
      const mm = opts.ownMaterials ? tintMaterial(m, opts.tint) : sharedMat(id, opts.tint, m);
      materials.push(mm); return mm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
  });

  const B = collectBones(inner);
  const extras = [];
  for (const it of opts.armor || []) {
    const slot = it.split('_')[0];
    try {
      const parts = buildProceduralArmor(it, slot, inner);
      if (parts) for (const p of parts) { p.bone.add(p.mesh); extras.push(p.mesh); }
    } catch (e) { console.warn('[mixamo_rig] armadura', it, e?.message); }
  }
  if (opts.weapon) {
    try {
      const w = buildProceduralWeapon(opts.weapon, opts.weapon.includes('2h') ? '2h_sword' : '1h_sword', inner, B.RightHand?.bone);
      if (w) { w.bone.add(w.mesh); extras.push(w.mesh); }
    } catch (e) { console.warn('[mixamo_rig] arma', e?.message); }
  }
  if (opts.bottle && B.LeftHand) {
    const g = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10), glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.09, 8), glass); neck.position.y = 0.14;
    g.add(body, neck);
    g.scale.setScalar(1 / s);              // el hueso hereda la escala del modelo
    g.position.set(0, 0.09 / s, 0.03 / s);
    B.LeftHand.bone.add(g); extras.push(g);
  }

  // Clips de verdad si el modelo trae set de animaciones cargado
  let mixer = null, actions = null, cur = null, oneShot = null, dead = false;
  if (opts.anims && _animReady.has(opts.anims) && B.Hips) {
    const names = new Set(); inner.traverse(o => { if (o.isBone) names.add(o.name); });
    const clips = adaptedClips(id, opts.anims, B.Hips.bone.position, names);
    if (clips) {
      mixer = new THREE.AnimationMixer(inner);
      actions = {};
      for (const [n, c] of Object.entries(clips)) actions[n] = mixer.clipAction(c);
      for (const n of ['attack', 'death', 'flex', 'jump']) if (actions[n]) { actions[n].setLoop(THREE.LoopOnce, 1); actions[n].clampWhenFinished = true; }
      mixer.addEventListener('finished', (e) => { if (e.action === oneShot && !dead) { oneShot = null; cur = null; } });
    }
  }
  const play = (name, fade = 0.2, ts = 1) => {
    const a = actions?.[name]; if (!a) return;
    a.setEffectiveTimeScale(ts);
    if (cur === a) return;
    a.reset().setEffectiveWeight(1).play();
    if (cur) a.crossFadeFrom(cur, fade, true);
    cur = a;
  };

  // ¿Cuánto bajar los brazos? Depende de la pose de reposo (T = horizontal, A = ya medio bajados)
  const armRest = {};
  for (const L of ['Left', 'Right']) {
    const a = B[L + 'Arm']?.bone, f = B[L + 'ForeArm']?.bone;
    if (a && f) {
      const pa = new THREE.Vector3(), pf = new THREE.Vector3();
      a.getWorldPosition(pa); f.getWorldPosition(pf);
      inner.worldToLocal(pa); inner.worldToLocal(pf);
      armRest[L] = Math.atan2(-(pf.y - pa.y), Math.abs(pf.x - pa.x) + 1e-6);
    } else armRest[L] = 0;
  }

  const phase = opts.phase ?? Math.random() * 10;
  const st = { t: phase, walk: 0, attackT: 0, hurtT: 0, talkT: 0 };
  const style = opts.style || {};   // { armDown: rad, hunch: rad, wide: rad }

  function updateClips(dt, S) {
    if (S.dead && !dead && actions.death) { dead = true; oneShot = actions.death; play('death', 0.15); }
    if (!dead) {
      if (S.attack && actions.attack) { oneShot = actions.attack; cur = null; play('attack', 0.1, 1.6); }
      if (!oneShot && style.flexEvery && !S.moving && actions.flex && Math.random() < dt / style.flexEvery) { oneShot = actions.flex; cur = null; play('flex', 0.3); }
      if (!oneShot) {
        if (S.moving) {
          const sp = S.speed || 1.4;
          if (sp > 3.2 && actions.run) play('run', 0.2, Math.min(1.6, sp / 5));
          else play('walk', 0.2, Math.max(0.6, Math.min(1.8, sp / 1.4)) * (opts.stepMul || 1));
        } else play('idle', 0.3);
      }
    }
    mixer.update(dt);
    // encima: girar un poco la cabeza hacia el jugador
    if (B.Head && S.lookYaw) B.Head.bone.quaternion.multiply(_q.setFromAxisAngle(AX.y, Math.max(-0.8, Math.min(0.8, S.lookYaw)) * 0.6));
    if (S.hurt && B.Spine) { st.hurtT = 0.3; }
    st.hurtT = Math.max(0, st.hurtT - dt);
    if (st.hurtT > 0 && B.Spine) B.Spine.bone.quaternion.multiply(_q.setFromAxisAngle(AX.x, -Math.sin(st.hurtT / 0.3 * Math.PI) * 0.25));
  }

  function update(dt, S = {}) {
    st.t += dt;
    if (mixer) return updateClips(dt, S);
    const t = st.t;
    // mezcla suave entre quieto y andando
    const wantWalk = S.moving ? 1 : 0;
    st.walk += (wantWalk - st.walk) * Math.min(1, dt * 6);
    const w = st.walk;
    const run = S.speed > 3 ? Math.min(1, (S.speed - 3) / 3) : 0;
    const freq = (S.speed ? Math.max(5, Math.min(11, S.speed * 2.6)) : 6.2) * (opts.stepMul || 1);
    const ph = t * freq;
    const swing = Math.sin(ph) * (0.55 + run * 0.35) * w;
    if (S.attack) { st.attackT = 0.55; }
    if (S.hurt) { st.hurtT = 0.35; }
    st.attackT = Math.max(0, st.attackT - dt); st.hurtT = Math.max(0, st.hurtT - dt);
    const atk = st.attackT > 0 ? Math.sin((1 - st.attackT / 0.55) * Math.PI) : 0;
    const hurt = st.hurtT > 0 ? Math.sin((1 - st.hurtT / 0.35) * Math.PI) : 0;
    const breath = Math.sin(t * 1.7) * 0.025;
    const drunk = S.drunk ? 1 : 0;
    const sway = drunk * Math.sin(t * 1.3) * 0.12;
    const talk = S.talk ? 1 : 0;
    const hunch = style.hunch || 0;
    const armDown = style.armDown ?? 1.25;           // cuánto bajan los brazos desde la T

    // Cadera: rebote al andar, vaivén de borracho, encogerse al recibir
    setRot(B, 'Hips', rotXYZ(hurt * -0.15, Math.sin(ph) * 0.08 * w, sway));
    if (B.Hips) B.Hips.bone.position.copy(B.Hips.restPos || (B.Hips.restPos = B.Hips.bone.position.clone()));
    if (B.Hips) B.Hips.bone.position.y = B.Hips.restPos.y * (1 - Math.abs(Math.cos(ph)) * 0.035 * w);   // rebote proporcional (da igual cm o m)
    setRot(B, 'Spine', rotXYZ(breath + hunch * 0.5 + atk * 0.25 + 0.04 * w + run * 0.12, -Math.sin(ph) * 0.07 * w + atk * -0.35, -sway * 0.6));
    setRot(B, 'Spine1', rotXYZ(breath * 0.7 + hunch * 0.3, atk * -0.2, 0));
    setRot(B, 'Spine2', rotXYZ(breath * 0.5, 0, 0));
    // Cabeza: mirar al jugador (yaw relativo) + asentir al hablar
    const look = Math.max(-1, Math.min(1, S.lookYaw || 0));
    setRot(B, 'Neck', rotXYZ(talk * Math.sin(t * 7) * 0.05 + hunch * -0.3, look * 0.5, -sway * 0.8));
    setRot(B, 'Head', rotXYZ(talk * Math.sin(t * 5.3) * 0.06, look * 0.5, Math.sin(t * 0.7) * 0.03));
    // Piernas
    for (const side of [1, -1]) {
      const L = side === 1 ? 'Left' : 'Right';
      const sw = swing * side;
      setRot(B, L + 'UpLeg', rotXYZ(-sw - run * 0.1, 0, side * (style.wide || 0.03)));
      const knee = Math.max(0, Math.sin(ph * 1 + (side === 1 ? 0 : Math.PI) - 0.9)) * (0.9 + run * 0.5) * w + 0.05;
      setRot(B, L + 'Leg', rotXYZ(knee, 0, 0));
      setRot(B, L + 'Foot', rotXYZ(-knee * 0.35, 0, 0));
    }
    // Brazos: de la T a los costados, balanceo, gestos
    for (const side of [1, -1]) {
      const L = side === 1 ? 'Left' : 'Right';
      let down = armDown - armRest[L], fwd = -swing * side * 0.8 - run * 0.2, elbow = 0.18 + 0.4 * w + run * 0.6;
      // derecho: ataque (arriba y abajo) o gesto al hablar
      if (side === -1 && atk > 0) { down = armDown - armRest[L] - atk * 1.1; fwd = -1.4 * atk; elbow = 0.3 + atk * 0.6; }
      else if (side === -1 && talk) { fwd = -0.55 + Math.sin(t * 4) * 0.18; elbow = 1.1 + Math.sin(t * 6) * 0.2; }
      // izquierdo del borracho: botella a la boca de vez en cuando
      if (side === 1 && drunk) { const sip = Math.max(0, Math.sin(t * 0.45)) ** 8; fwd = -0.5 - sip * 0.9; elbow = 1.0 + sip * 1.2; }
      if (hurt) { fwd += -0.3 * hurt; elbow += 0.5 * hurt; }
      if (style.zombie && !(side === -1 && atk > 0)) { down = armDown - armRest[L]; fwd = -1.35 + Math.sin(t * 2 + side) * 0.1; elbow = 0.2; }
      // brazo: primero bajar (Z), luego balancear (X) — en espacio del modelo
      _q.setFromAxisAngle(AX.z, -side * down);
      _q2.setFromAxisAngle(AX.x, fwd);
      const R = _q2.clone().multiply(_q);
      setRot(B, L + 'Arm', R);
      // antebrazo: doblar el codo hacia delante (en la pose T es alrededor de Y)
      setRot(B, L + 'ForeArm', _q.setFromAxisAngle(AX.y, -side * elbow));
    }
  }

  function dispose() {
    try {
      root.traverse(o => { if (o.isMesh && opts.ownMaterials) [].concat(o.material).forEach(m => m?.dispose?.()); });
      for (const e of extras) e.traverse?.(o => { if (o.isMesh) { o.geometry?.dispose?.(); } });
    } catch {}
  }

  update(0, {});
  return { root, inner, bones: B, materials, update, dispose, id, hasClips: !!mixer };
}

if (typeof window !== 'undefined') window.__mixamoRig = { preload, preloadAnims, create, RIG_MODELS, fireTime };
