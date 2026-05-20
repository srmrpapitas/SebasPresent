/**
 * SebasPresent — Scene setup (Sesión 31, FASE 4a)
 *
 * Extraído de world.js. Encapsula el setup de three.js (scene, camera,
 * renderer, raycaster, luces, fog) y del océano de fondo.
 *
 * Uso desde world.js:
 *
 *   import * as sceneSetup from './core/scene.js';
 *
 *   const { scene, camera, renderer, raycaster, canvas } = sceneSetup.init({
 *     canvasId: 'worldCanvas',
 *     palette: PALETTE,
 *     fogNear: FOG_NEAR,
 *     fogFar:  FOG_FAR,
 *   });
 *
 *   const ocean = sceneSetup.setupOcean({ scene, palette: PALETTE, worldHalf: WORLD_HALF });
 *
 *   // En el resize handler:
 *   sceneSetup.onResize({ camera, renderer });
 *
 * Diseño:
 *   - NO mantiene estado privado: las refs (scene/camera/renderer/...) se
 *     devuelven al caller para que las maneje como antes.
 *   - Eso significa que la integración con world.js es mínima: solo se
 *     reemplazan las funciones setupScene() y setupOcean() locales por
 *     llamadas a este módulo.
 */

import * as THREE from 'three';

/**
 * Crea scene + camera + renderer + raycaster + luces + fog.
 * Devuelve un objeto con todas las refs para que el caller las guarde.
 *
 * @param {object} opts
 * @param {string} opts.canvasId          ID del canvas en el DOM (default 'worldCanvas')
 * @param {object} opts.palette           PALETTE con .sky y .fog
 * @param {number} opts.fogNear           distancia near del fog
 * @param {number} opts.fogFar            distancia far del fog (también clip far de cámara)
 * @param {number} [opts.fov=55]
 * @returns {{ scene, camera, renderer, raycaster, canvas }}
 */
export function init(opts) {
  const canvasId = opts.canvasId || 'worldCanvas';
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error('No #' + canvasId + ' element in DOM');

  // Bloquear pinch-zoom nativo del browser sobre el canvas (no toca el
  // joystick/minimapa, que tienen sus propios listeners).
  canvas.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.palette.sky);
  scene.fog = new THREE.Fog(opts.palette.fog, opts.fogNear, opts.fogFar);

  const fov = opts.fov ?? 55;
  const camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    0.1,
    opts.fogFar + 50,
  );

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const raycaster = new THREE.Raycaster();

  // Luces: una directional cálida tipo "sol" + una ambient azul fría.
  const sun = new THREE.DirectionalLight(0xffeecc, 1.0);
  sun.position.set(-30, 50, 20);
  scene.add(sun);

  // Sesión 27 fix — ambient subida de 0.55 a 0.72 para zonas densas de árboles.
  const ambient = new THREE.AmbientLight(0x6088a0, 0.72);
  scene.add(ambient);

  return { scene, camera, renderer, raycaster, canvas, sun, ambient };
}

/**
 * Crea el plano de océano y lo agrega a la scene. Devuelve la ref del mesh.
 *
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {object} opts.palette       PALETTE con .ocean
 * @param {number} opts.worldHalf     mitad del mundo (define tamaño del plano)
 * @returns {THREE.Mesh}
 */
export function setupOcean(opts) {
  const geom = new THREE.PlaneGeometry(opts.worldHalf * 6, opts.worldHalf * 6);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: opts.palette.ocean, flatShading: true });
  const ocean = new THREE.Mesh(geom, mat);
  ocean.position.y = -0.4;
  opts.scene.add(ocean);
  return ocean;
}

/**
 * Handler para window resize. Llamar desde el listener de world.js.
 * @param {{camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer}} refs
 */
export function onResize(refs) {
  refs.camera.aspect = window.innerWidth / window.innerHeight;
  refs.camera.updateProjectionMatrix();
  refs.renderer.setSize(window.innerWidth, window.innerHeight, false);
}
