/**
 * SebasPresent — Día y noche (Sesión 52)
 *
 * Ciclo de 40 minutos reales sincronizado con la hora del SERVIDOR: todos
 * los jugadores ven el mismo cielo a la vez. 28 min de día y 12 de noche,
 * con amanecer y atardecer anaranjados entre medias.
 *
 *   - Sol: cruza el cielo, se vuelve naranja al ponerse; de noche la luz
 *     direccional pasa a ser la luna (azulada y suave).
 *   - Luz ambiente, cielo y niebla se tiñen (respetando el tinte rojizo del
 *     Malpaís, que llega por setBase()).
 *   - De noche: estrellas y luna (sin luces nuevas: no recompila shaders).
 *   - Dentro de casas/cuevas no toca cielo ni niebla (lo gestionan ellas).
 *
 * Sin peticiones al servidor: la hora sale del snapshot que ya llega.
 * Pruebas: window.__dayTime = 0..1 (0 = amanecer, 0,35 = mediodía,
 * 0,7 = atardecer, 0,85 = medianoche); window.__dayTime = null para volver.
 */
import * as THREE from 'three';

import { CYCLE_MS, DAY_FRAC, phaseAt, lightAt } from './shared/daytime.js';   // misma hora que el servidor
export { CYCLE_MS };

let scene = null, camera = null, sun = null, ambient = null;
let getServerNow = () => null, isIndoors = () => false, isCave = () => false, onChange = () => {};
let started = false;
let clockOffset = 0, haveOffset = false;
const baseSky = new THREE.Color(0x9ec0d6), baseFog = new THREE.Color(0xa8c4d8);
let stars = null, moon = null;
let lastPeriod = null;
let state = { phase: 0.35, light: 1, night: 0 };

const C = {
  sunDay: new THREE.Color(0xffeecc), sunLow: new THREE.Color(0xff9a50), moon: new THREE.Color(0x9ab4ff),
  ambDay: new THREE.Color(0x6088a0), ambNight: new THREE.Color(0x5a6ea0),
  skyNight: new THREE.Color(0x0e1a34), fogNight: new THREE.Color(0x16223c),
  dusk: new THREE.Color(0xe8905a), duskFog: new THREE.Color(0xd8a080),
};
const tmp = new THREE.Color(), tmp2 = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function start(opts) {
  scene = opts.scene; camera = opts.camera;
  getServerNow = opts.getServerNow || (() => null);
  isIndoors = opts.isIndoors || (() => false);
  isCave = opts.isCave || (() => false);
  onChange = opts.onChange || (() => {});
  sun = null; ambient = null;
  scene.traverse(o => {
    if (!sun && o.isDirectionalLight) sun = o;
    if (!ambient && o.isAmbientLight) ambient = o;
  });
  if (scene.background?.isColor) baseSky.copy(scene.background);
  if (scene.fog) baseFog.copy(scene.fog.color);
  buildSkyDecor();
  started = true;
  lastPeriod = null;
  update(0);
}

export function stop() {
  if (!started) return;
  started = false;
  for (const o of [stars, moon]) if (o) { scene?.remove(o); o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }
  stars = moon = null;
}

/** Color base del cielo y la niebla (normal o Malpaís). */
export function setBase(skyHex, fogHex) {
  baseSky.setHex(skyHex); baseFog.setHex(fogHex);
  if (started) update(0);
}

/** 0..1 del ciclo (0 = amanecer, DAY_FRAC = atardecer). */
export function getPhase() { return state.phase; }
export function isNight() { return state.night > 0.5; }
export function getLight() { return state.light; }

function currentPhase() {
  if (typeof window !== 'undefined' && typeof window.__dayTime === 'number') return ((window.__dayTime % 1) + 1) % 1;
  const sn = getServerNow();
  if (sn) {
    const off = sn - Date.now();
    // el snapshot llega con algo de retraso: suavizar el desfase
    clockOffset = haveOffset ? clockOffset + (off - clockOffset) * 0.05 : off;
    haveOffset = true;
  }
  return phaseAt(Date.now() + clockOffset);
}

export function update() {
  if (!started || !scene) return;
  const p = currentPhase();
  const { day, ang, elev, light } = lightAt(p);       // light: 0 noche cerrada · 1 pleno día
  const night = 1 - light;
  const twilight = Math.max(0, 1 - Math.abs(elev) / 0.32) * (elev > -0.2 ? 1 : 0);   // naranja cerca del horizonte
  state = { phase: p, light, night };

  // Luz direccional: sol de día, luna de noche (misma luz → sin recompilar)
  if (sun) {
    if (light > 0.02 || day) {
      const sx = Math.cos(ang) * 60, sy = Math.max(30, Math.sin(ang) * 55);   // nunca rasante: el suelo plano se quedaba gris
      sun.position.set(sx, sy, 22);
      sun.color.copy(C.sunDay).lerp(C.sunLow, smooth(0.5, 0.05, elev));
      sun.intensity = 0.5 + 0.5 * light;
    } else {
      sun.position.set(-Math.cos(ang) * 50, 40, -20);
      sun.color.copy(C.moon);
      sun.intensity = 0.5;
    }
  }
  const indoors = isIndoors();
  if (ambient) {
    if (indoors) { ambient.color.copy(C.ambDay); ambient.intensity = 0.72; }
    else { ambient.color.copy(C.ambDay).lerp(C.ambNight, night); ambient.intensity = 0.66 + 0.06 * light; }   // de noche se tiene que seguir jugando
  }
  if (!indoors && !isCave()) {
    tmp.copy(baseSky).lerp(C.dusk, twilight * 0.55).lerp(C.skyNight, night * 0.85);
    tmp2.copy(baseFog).lerp(C.duskFog, twilight * 0.5).lerp(C.fogNight, night * 0.8);
    if (scene.background?.isColor) scene.background.copy(tmp);
    if (scene.fog) scene.fog.color.copy(tmp2);
  }

  // Estrellas y luna siguen a la cámara
  const showSky = !indoors && !isCave() && night > 0.05;
  if (stars) {
    stars.visible = showSky;
    if (showSky && camera) { stars.position.copy(camera.position); stars.material.opacity = Math.min(1, night * 1.3); stars.rotation.y = p * Math.PI * 2; }
  }
  if (moon) {
    moon.visible = showSky && !day;
    if (moon.visible && camera) {
      const ma = ((p - DAY_FRAC) / (1 - DAY_FRAC)) * Math.PI;
      moon.position.set(camera.position.x + Math.cos(ma) * 150, camera.position.y + 40 + Math.sin(ma) * 90, camera.position.z - 120);
      moon.material.opacity = Math.min(1, night * 1.4);
    }
  }

  // Avisos al amanecer / anochecer
  const period = light > 0.5 ? 'day' : 'night';
  if (lastPeriod && period !== lastPeriod) { try { onChange(period); } catch {} }
  lastPeriod = period;
}

function buildSkyDecor() {
  if (stars || !scene) return;
  const N = 700, pos = new Float32Array(N * 3);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const u = rnd(), v = 0.08 + rnd() * 0.92;           // solo la mitad de arriba
    const th = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(th) * r * 200; pos[i * 3 + 1] = y * 200; pos[i * 3 + 2] = Math.sin(th) * r * 200;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xf4f0ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  stars = new THREE.Points(g, m);
  stars.frustumCulled = false; stars.renderOrder = -2; stars.visible = false;
  scene.add(stars);

  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,252,235,1)'); gr.addColorStop(0.42, 'rgba(240,238,220,1)');
  gr.addColorStop(0.5, 'rgba(200,210,255,0.35)'); gr.addColorStop(1, 'rgba(160,180,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(190,190,175,0.55)';
  for (const [cx, cy, r] of [[52, 54, 7], [72, 70, 9], [60, 80, 5], [78, 50, 4]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, fog: false, depthWrite: false });
  moon = new THREE.Sprite(sm);
  moon.scale.set(16, 16, 1); moon.renderOrder = -1; moon.visible = false; moon.frustumCulled = false;
  scene.add(moon);
}
