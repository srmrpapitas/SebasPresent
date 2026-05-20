/**
 * SebasPresent — Cámara orbital (Sesión 31, FASE 4b)
 *
 * Encapsula yaw/pitch/dist, drag, zoom y los overrides de interior. Antes
 * vivía en world.js como variables globales mutables (cameraDist, cameraYaw,
 * cameraPitch, savedCameraDist, savedCameraPitch) — ahora todo es estado
 * privado de este módulo.
 *
 * Uso desde world.js:
 *
 *   import * as cameraOrbital from './core/camera.js';
 *
 *   // 1. después de scene.init() y setupPlayer():
 *   cameraOrbital.init({
 *     threeCamera: camera,
 *     getPlayer:   () => player,
 *     isCharacterFallback: () => characterFallback,
 *     distMin: CAMERA_DIST_MIN, distMax: CAMERA_DIST_MAX,
 *   });
 *
 *   // 2. en setupInput callbacks:
 *   onCameraDrag: (dyaw, dpitch) => cameraOrbital.onDrag(dyaw, dpitch),
 *   onCameraZoom: (delta) => cameraOrbital.onZoom(delta),
 *
 *   // 3. en interiors callbacks:
 *   onEnter: () => { ...; cameraOrbital.pushInteriorOverrides({ dist: 5, pitch: 0.55 }); },
 *   onLeave: () => { ...; cameraOrbital.popInteriorOverrides(); },
 *
 *   // 4. en animate():
 *   cameraOrbital.update();
 *
 *   // 5. donde antes se leía cameraYaw (ej. gather direction):
 *   const yaw = cameraOrbital.getYaw();
 */

// ============================================================
// Estado interno
// ============================================================

// Defaults visuales OSRS-style (alejada y elevada).
let _dist  = 14;
let _yaw   = Math.PI * 0.25;
let _pitch = 0.55;

// Override stack para interiors (push al entrar, pop al salir).
let _savedDist  = null;
let _savedPitch = null;

// Refs externos
let _threeCamera = null;
let _getPlayer = null;
let _isCharacterFallback = () => false;

// Clamps
let _distMin = 6;
let _distMax = 30;
let _pitchMin = 0.1;
let _pitchMax = 1.3;

// ============================================================
// API pública
// ============================================================

/**
 * Inicializa el módulo. Llamar después de scene.init() y setupPlayer().
 * @param {object} opts
 * @param {THREE.PerspectiveCamera} opts.threeCamera
 * @param {() => THREE.Object3D} opts.getPlayer            getter del player
 * @param {() => boolean} [opts.isCharacterFallback]       true si char es la cápsula
 * @param {number} [opts.distMin=6]
 * @param {number} [opts.distMax=30]
 * @param {number} [opts.pitchMin=0.1]
 * @param {number} [opts.pitchMax=1.3]
 * @param {number} [opts.initialDist]
 * @param {number} [opts.initialYaw]
 * @param {number} [opts.initialPitch]
 */
export function init(opts) {
  _threeCamera = opts.threeCamera;
  _getPlayer = opts.getPlayer;
  if (typeof opts.isCharacterFallback === 'function') {
    _isCharacterFallback = opts.isCharacterFallback;
  }
  if (typeof opts.distMin === 'number')  _distMin = opts.distMin;
  if (typeof opts.distMax === 'number')  _distMax = opts.distMax;
  if (typeof opts.pitchMin === 'number') _pitchMin = opts.pitchMin;
  if (typeof opts.pitchMax === 'number') _pitchMax = opts.pitchMax;
  if (typeof opts.initialDist === 'number')  _dist = opts.initialDist;
  if (typeof opts.initialYaw === 'number')   _yaw = opts.initialYaw;
  if (typeof opts.initialPitch === 'number') _pitch = opts.initialPitch;
  _savedDist = null;
  _savedPitch = null;
}

/** Reset al estado por defecto. No se llama solo — útil para tests o para
 *  forzar la cámara a default después de un teleport. */
export function reset() {
  _dist  = 14;
  _yaw   = Math.PI * 0.25;
  _pitch = 0.55;
  _savedDist = null;
  _savedPitch = null;
}

/**
 * Handler del drag de la cámara (un dedo en canvas o dos dedos rotate).
 * Mantiene el signo histórico de world.js (yaw -= dyaw, pitch -= dpitch).
 */
export function onDrag(dyaw, dpitch) {
  _yaw   -= dyaw;
  _pitch -= dpitch;
  _pitch = Math.max(_pitchMin, Math.min(_pitchMax, _pitch));
}

/** Handler del pinch zoom. delta positivo = más lejos. */
export function onZoom(deltaDist) {
  _dist += deltaDist;
  _dist = Math.max(_distMin, Math.min(_distMax, _dist));
}

/**
 * Llamado cada frame desde animate(). Setea camera.position y camera.lookAt
 * en función de yaw/pitch/dist y la posición del player.
 */
export function update() {
  if (!_threeCamera || !_getPlayer) return;
  const player = _getPlayer();
  if (!player) return;

  const r = _dist;
  const p = _pitch;
  const desiredX = player.position.x + Math.sin(_yaw) * Math.cos(p) * r;
  const desiredY = player.position.y + Math.sin(p) * r;
  const desiredZ = player.position.z + Math.cos(_yaw) * Math.cos(p) * r;
  _threeCamera.position.set(desiredX, desiredY, desiredZ);

  // La altura a la que mira: más bajo si el char es la cápsula fallback.
  const lookHeight = _isCharacterFallback() ? 0.5 : 1.0;
  _threeCamera.lookAt(
    player.position.x,
    player.position.y + lookHeight,
    player.position.z,
  );
}

/**
 * Guarda los valores actuales de dist/pitch y aplica overrides de interior.
 * Idempotente: si ya hay overrides aplicados, no pisa los originales guardados.
 *
 * @param {{ dist?: number, pitch?: number, yaw?: number }} overrides
 */
export function pushInteriorOverrides(overrides) {
  if (_savedDist === null)  _savedDist  = _dist;
  if (_savedPitch === null) _savedPitch = _pitch;
  if (typeof overrides?.dist === 'number')  _dist  = overrides.dist;
  if (typeof overrides?.pitch === 'number') _pitch = overrides.pitch;
  if (typeof overrides?.yaw === 'number')   _yaw   = overrides.yaw;
}

/** Restaura los valores guardados por pushInteriorOverrides. */
export function popInteriorOverrides() {
  if (_savedDist !== null)  { _dist  = _savedDist;  _savedDist  = null; }
  if (_savedPitch !== null) { _pitch = _savedPitch; _savedPitch = null; }
}

// ============================================================
// Getters
// ============================================================
export function getYaw()   { return _yaw; }
export function getPitch() { return _pitch; }
export function getDist()  { return _dist; }
