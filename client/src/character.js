/**
 * SebasPresent — Character module (Slice 3)
 *
 * Loads the Mixamo Remy character + 3 animations (idle/walk/run) from
 * jsDelivr CDN, then cross-fades between them as the player moves.
 *
 * Assets live outside the Cloudflare Pages deploy dir because the
 * character FBX is over Cloudflare's 25 MiB single-file limit.
 * jsDelivr serves them straight from GitHub.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

const URLS = {
  character: `${CDN_BASE}/character.fbx`,
  idle:      `${CDN_BASE}/anim_idle.fbx`,
  walk:      `${CDN_BASE}/anim_walk.fbx`,
  run:       `${CDN_BASE}/anim_run.fbx`,
};

const CHARACTER_SCALE = 0.07;  // FBX is in cm, scene is in m
const CROSSFADE = 0.22;

export class Character {
  constructor() {
    this.group = null;
    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.loaded = false;
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
    const [idleFBX, walkFBX, runFBX] = await Promise.all([
      loader.loadAsync(URLS.idle),
      loader.loadAsync(URLS.walk),
      loader.loadAsync(URLS.run),
    ]);

    onProgress?.(0.95, 'Preparando…');
    this.actions.idle = this._registerClip(idleFBX, 'idle');
    this.actions.walk = this._registerClip(walkFBX, 'walk');
    this.actions.run  = this._registerClip(runFBX, 'run');

    if (!this.actions.idle || !this.actions.walk || !this.actions.run) {
      throw new Error('Una o más animaciones no tienen clip dentro del FBX');
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

  play(name) {
    if (!this.loaded) return;
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.play();
    next.crossFadeFrom(this.current, CROSSFADE, true);
    this.current = next;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }

  dispose() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.actions = {};
    this.current = null;
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
