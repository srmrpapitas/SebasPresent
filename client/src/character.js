/**
 * SebasPresent — Character module (Slice 3 + 5b)
 *
 * Loads the Mixamo Remy character + animations from R2.
 * Slice 5b: adds attack animation (Punching.fbx) for melee swing.
 *
 * Assets live outside the Cloudflare Pages deploy dir because the
 * character FBX is over Cloudflare's 25 MiB single-file limit.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

const URLS = {
  character: `${CDN_BASE}/character.fbx`,
  idle:      `${CDN_BASE}/anim_idle.fbx`,
  walk:      `${CDN_BASE}/anim_walk.fbx`,
  run:       `${CDN_BASE}/anim_run.fbx`,
  attack:    `${CDN_BASE}/animations/Punching.fbx`,    // Slice 5b
};

const CHARACTER_SCALE = 0.01;  // FBX is in cm, scene is in m
const CROSSFADE = 0.22;
const ATTACK_TICK_MS = 600;    // tiempo de un swing visible — coincide con TICK_MS del combate

export class Character {
  constructor() {
    this.group = null;
    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.loaded = false;
    this.isAttacking = false;  // Slice 5b — bloquea play() durante swing
  }

  async load(onProgress) {
    const loader = new FBXLoader();

    onProgress?.(0, 'Descargando personaje…');
    const characterFBX = await loadFBXWithProgress(
      loader,
      URLS.character,
      p => onProgress?.(p * 0.75, `Descargando personaje… ${Math.round(p * 100)}%`)
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

    onProgress?.(0.78, 'Cargando animaciones…');

    // Idle/walk/run son críticas: si fallan, throw. Attack es bonus:
    // si falla la carga, el juego sigue funcionando sin animación de swing.
    const [idleFBX, walkFBX, runFBX] = await Promise.all([
      loader.loadAsync(URLS.idle),
      loader.loadAsync(URLS.walk),
      loader.loadAsync(URLS.run),
    ]);

    let attackFBX = null;
    try {
      attackFBX = await loader.loadAsync(URLS.attack);
    } catch (err) {
      console.warn('[character] attack anim failed to load, swing will be silent:', err.message);
    }

    onProgress?.(0.95, 'Preparando…');
    this.actions.idle = this._registerClip(idleFBX, 'idle');
    this.actions.walk = this._registerClip(walkFBX, 'walk');
    this.actions.run  = this._registerClip(runFBX, 'run');
    if (attackFBX) {
      this.actions.attack = this._registerClip(attackFBX, 'attack');
      if (this.actions.attack) {
        this.actions.attack.setLoop(THREE.LoopOnce, 1);
        this.actions.attack.clampWhenFinished = false;
      }
    }

    if (!this.actions.idle || !this.actions.walk || !this.actions.run) {
      throw new Error('Una o más animaciones base (idle/walk/run) no tienen clip dentro del FBX');
    }

    this.actions.idle.play();
    this.current = this.actions.idle;
    this.loaded = true;
    onProgress?.(1, 'Listo');
    return this.group;
  }

  _registerClip(fbx, name) {
    if (!fbx.animations || fbx.animations.length === 0) return null;
    const clip = fbx.animations[0];
    clip.name = name;
    normalizeClipTracks(clip);
    const action = this.mixer.clipAction(clip);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    return action;
  }

  /**
   * Locomoción / idle. Ignora la llamada si estamos a mitad de un swing
   * de ataque (isAttacking) para no cortar la animación una y otra vez
   * cuando world.js sigue diciendo "estás corriendo" mientras combat.js
   * dispara playAttack().
   */
  play(name) {
    if (!this.loaded) return;
    if (this.isAttacking) return;
    const next = this.actions[name];
    if (!next) return;
    if (next === this.current) return;
    next.reset();
    next.play();
    if (this.current) {
      next.crossFadeFrom(this.current, CROSSFADE, true);
    }
    this.current = next;
  }

  /**
   * Slice 5b — Swing de ataque (one-shot).
   *
   * Comprime el clip a ATTACK_TICK_MS (~600ms) para que cada attack tick
   * del server produzca un swing visible completo. Mientras dura, isAttacking
   * bloquea play() para que walk/idle/run no la corten.
   *
   * Idempotente: si llaman mientras ya está activa, se ignora.
   */
  playAttack() {
    if (!this.loaded || !this.actions.attack) return;
    if (this.isAttacking) return;

    const action = this.actions.attack;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;

    // Escalar timeScale para que dure ~600ms en pantalla
    const clipMs = action.getClip().duration * 1000;
    const timeScale = clipMs > ATTACK_TICK_MS ? clipMs / ATTACK_TICK_MS : 1;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);

    if (this.current) {
      action.crossFadeFrom(this.current, 0.08, true);
    }
    action.play();
    this.current = action;
    this.isAttacking = true;

    // Al terminar el swing: limpiar el flag y resetear current a null,
    // así el siguiente play() de world.js (cada frame nos llama según
    // el estado de movimiento) arranca una transición limpia.
    setTimeout(() => {
      this.isAttacking = false;
      this.current = null;
    }, ATTACK_TICK_MS + 20);
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }

  dispose() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.actions = {};
    this.current = null;
    this.isAttacking = false;
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

function normalizeBones(root) {
  root.traverse(child => {
    if (child.name && typeof child.name === 'string') {
      if (child.name.startsWith('mixamorig1:')) {
        child.name = 'mixamorig:' + child.name.slice('mixamorig1:'.length);
      }
    }
  });
}

function normalizeClipTracks(clip) {
  for (const track of clip.tracks) {
    if (track.name.startsWith('mixamorig1:')) {
      track.name = 'mixamorig:' + track.name.slice('mixamorig1:'.length);
    }
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
