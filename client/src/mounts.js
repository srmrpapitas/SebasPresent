/**
 * SebasPresent — Monturas (Sesión 50)
 *
 *   🐎 Caballo (nivel 5)  · 🕊️ Súper pardela (nivel 5; vuela desde nivel 25)
 *
 * Botón redondo junto a vida/plegaria/correr: tocar = montar / bajar.
 * Reglas (shared/mounts.js):
 *   · Te atacan → no puedes montar en 10 s (el orbe muestra la cuenta atrás).
 *   · Te GOLPEAN (daño > 0) montado → te caes. Que te persigan no te baja.
 *   · Atacar, recoger, entrar en interiores/Fosa o morir → te bajas.
 * La pardela, con nivel 25, vuela a 9 m: pasa por encima de árboles, casas y murallas. Al
 * bajar busca un hueco libre en el suelo.
 *
 * Los modelos se añaden a la escena (no como hijos del personaje, que puede
 * tener escala) y se sincronizan cada frame. Los otros jugadores ven tu
 * montura: realtime.js manda el id y multiplayer.js la pinta con peerMount().
 */
import * as THREE from 'three';
import * as api from './api.js';
import { MOUNTS, MOUNT_COMBAT_LOCK_MS } from './shared/mounts.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const HIP = 0.95;                  // altura de la cadera del personaje sobre sus pies
const SEAT = { caballo: 1.85, pardela: 1.45, dragon_vuelo: 1.35 };
const DRAGON_SEAT = 1.42;          // silla sobre el lomo del dragón (live: __mountSeat('pardela', v))   // silla sobre la base de la montura (caballo +0.3: iba muy hundido)
// Ajuste en vivo desde Eruda: window.__mountSeat('caballo', 1.9)

let scene = null;
let getPlayer = () => null;
let feedLog = () => {};
let canMountHere = () => null;     // → texto con el motivo si NO se puede, o null
let findLanding = null;            // (x,z) → {x,z} libre para aterrizar
let started = false;

let owned = [];
let current = null;                // id de la montura o null
let obj = null;                    // modelo
let lastAttackedAt = 0;
let alt = 0;                       // altura actual de vuelo (sube/baja suave)
let lastPos = null, speedNow = 0, t = 0;
let orbEl = null, orbVal = null, menuEl = null;
let preferred = null;
let combatLevel = 3;
let lastYaw = 0, bank = 0;

// ============================================================
// Modelos
// ============================================================
const L = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };

export function buildHorse(color = 0x6a3f22) {
  const g = new THREE.Group(); g.userData.kind = 'mount-horse';
  const coat = L(color), dark = L(0x2a1a10), hoof = L(0x1a1a1a), saddle = L(0x4a2a14), cloth = L(0xa02a2a), metal = L(0x9a9aa0);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.25, 4, 10), coat);
  body.rotation.x = Math.PI / 2; body.position.set(0, 1.18, 0); g.add(body);
  // cuello + cabeza
  const neck = new THREE.Group(); neck.position.set(0, 1.35, 0.75); neck.rotation.x = 0.6; g.add(neck);
  const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.85, 8), coat); nk.position.y = 0.38; neck.add(nk);
  const head = new THREE.Group(); head.position.set(0, 0.8, 0.02); head.rotation.x = 1.3; neck.add(head);
  head.add(bx(0.24, 0.62, 0.3, coat, 0, 0.26, 0));
  head.add(bx(0.2, 0.16, 0.26, dark, 0, 0.6, 0.0));
  for (const sx of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), coat); ear.position.set(sx, -0.05, -0.12); ear.rotation.x = -1.4; head.add(ear); }
  for (const sx of [-0.125, 0.125]) head.add(bx(0.02, 0.05, 0.05, dark, sx, 0.15, 0.05));
  // crin
  for (let i = 0; i < 6; i++) neck.add(bx(0.06, 0.18, 0.14, dark, 0, 0.05 + i * 0.14, -0.22));
  // cola
  const tail = new THREE.Group(); tail.position.set(0, 1.3, -0.95); g.add(tail);
  const tl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.85, 6), dark); tl.position.y = -0.4; tl.rotation.x = Math.PI; tail.add(tl);
  tail.rotation.x = 0.5;
  // patas (pivote en la cadera, para galopar)
  const legs = [];
  for (const [x, z] of [[-0.2, 0.62], [0.2, 0.62], [-0.2, -0.62], [0.2, -0.62]]) {
    const leg = new THREE.Group(); leg.position.set(x, 1.0, z);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.6, 6), coat); up.position.y = -0.3; leg.add(up);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.42, 6), coat); lo.position.y = -0.78; leg.add(lo);
    leg.add(bx(0.13, 0.08, 0.15, hoof, 0, -0.98, 0.01));
    g.add(leg); legs.push(leg);
  }
  // silla, manta, faldones (tapan las piernas del jinete) y estribos
  g.add(bx(0.8, 0.05, 0.8, cloth, 0, 1.5, -0.05));
  g.add(bx(0.5, 0.14, 0.62, saddle, 0, 1.58, -0.05));
  g.add(bx(0.46, 0.2, 0.08, saddle, 0, 1.68, 0.24));
  for (const sx of [-1, 1]) {
    g.add(bx(0.05, 0.7, 0.5, saddle, sx * 0.4, 1.2, 0.02));
    g.add(bx(0.14, 0.04, 0.1, metal, sx * 0.42, 0.82, 0.08));
  }
  g.userData.legs = legs; g.userData.neck = neck; g.userData.tail = tail;
  return g;
}

// Súper pardela (pardela cenicienta, el ave marina de Canarias), en grande:
// dorso pardo-grisáceo, vientre blanco, pico amarillo pálido con punta oscura
// y "tubo" nasal, alas largas y estrechas de planeador, patas palmeadas
// rosadas. En tierra lleva las alas plegadas y camina; volando planea.
// ------------------------------------------------------------
// Sesión 50 — El dragón (sustituye a la pardela; el id interno sigue siendo 'pardela')
// GLB con 3 clips: idle, running, flying. Mira a +Z. Mientras carga se ve la pardela.
// ------------------------------------------------------------
const DRAGON_URL = 'assets/npcs/dragon_montura.glb';
const DRAGON_SCALE = 21;              // pelvis a ~1,2 m: ~6 m de largo, ~17 m de alas
const DRAGON_SEAT_Z = -0.03 * DRAGON_SCALE;   // la silla (vértebra 4) queda ~0,6 m por delante de la pelvis
let _dragon = null, _dragonP = null;
function loadDragon() {
  if (_dragonP) return _dragonP;
  _dragonP = new GLTFLoader().loadAsync(DRAGON_URL).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    _dragon = { scene: g.scene, clips: Object.fromEntries(g.animations.map(a => [a.name, a])) };
    SEAT.pardela = DRAGON_SEAT;
    return _dragon;
  }).catch(e => { console.warn('[mounts] dragón no cargó, se queda la pardela:', e?.message); return null; });
  return _dragonP;
}
function attachDragon(g) {
  if (!_dragon || g.userData.dragon) return;
  const d = SkeletonUtils.clone(_dragon.scene);
  d.scale.setScalar(DRAGON_SCALE);
  d.position.z = DRAGON_SEAT_Z;
  const mixer = new THREE.AnimationMixer(d);
  const actions = {};
  for (const [n, c] of Object.entries(_dragon.clips)) actions[n] = mixer.clipAction(c);
  for (const ch of g.children) ch.visible = false;   // fuera la pardela
  g.add(d);
  let rootB = null, pelvis = null;
  d.traverse(o => { if (!o.isBone) return; if (!rootB && /^root/i.test(o.name)) rootB = o; if (!pelvis && /^pelvis/i.test(o.name)) pelvis = o; });
  const fixed = [rootB, pelvis].filter(Boolean).map(b => ({ b, p: b.position.clone() }));
  g.userData.dragon = { d, mixer, actions, cur: null, lastT: null, fixed };
}
// ------------------------------------------------------------
// Sesión 50 — Caballo con modelo de verdad (blanco moteado, crines), clips idle/walk/run.
// Mira a +X en el GLB → se gira -90°. Mientras carga se ve el caballo de cajas.
// ------------------------------------------------------------
const HORSE_URL = 'assets/npcs/caballo_montura.glb';
const HORSE_SCALE = 0.0072;           // ~2,15 m hasta las orejas, lomo a ~1,2 m
const HORSE_SEAT = 1.42;              // silla (live: __mountSeat('caballo', v))
let _horse = null, _horseP = null;
function loadHorse() {
  if (_horseP) return _horseP;
  _horseP = new GLTFLoader().loadAsync(HORSE_URL).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    _horse = { scene: g.scene, clips: Object.fromEntries(g.animations.map(a => [a.name, a])) };
    SEAT.caballo = HORSE_SEAT;
    return _horse;
  }).catch(e => { console.warn('[mounts] caballo no cargó, se queda el de cajas:', e?.message); return null; });
  return _horseP;
}
function attachHorse(g) {
  if (!_horse || g.userData.horse) return;
  const d = SkeletonUtils.clone(_horse.scene);
  d.scale.setScalar(HORSE_SCALE);
  d.rotation.y = -Math.PI / 2;
  const mixer = new THREE.AnimationMixer(d);
  const actions = {};
  for (const [n, c] of Object.entries(_horse.clips)) actions[n] = mixer.clipAction(c);
  for (const ch of g.children) ch.visible = false;   // fuera el de cajas
  g.add(d);
  g.userData.horse = { d, mixer, actions, cur: null, lastT: null };
}
function animateHorse(H, moving, time) {
  const want = moving > 0.55 ? 'run' : (moving > 0.06 ? 'walk' : 'idle');
  const a = H.actions[want] || H.actions.idle;
  if (a && H.cur !== a) { a.reset().play(); if (H.cur) a.crossFadeFrom(H.cur, 0.25, true); H.cur = a; }
  if (a && want === 'run') a.setEffectiveTimeScale(Math.max(0.8, Math.min(1.5, moving)));
  if (a && want === 'walk') a.setEffectiveTimeScale(Math.max(0.7, Math.min(1.6, moving * 3)));
  const dt = H.lastT == null ? 0 : Math.max(0, Math.min(0.1, time - H.lastT));
  H.lastT = time;
  H.mixer.update(dt);
}

export function buildPardela() {
  const g = buildPardelaBird();
  if (_dragon) attachDragon(g); else loadDragon().then(() => attachDragon(g));
  return g;
}
function animateDragon(D, moving, time, flying, bank) {
  const want = flying ? 'flying' : (moving > 0.15 ? 'running' : 'idle');
  const a = D.actions[want] || D.actions.idle;
  if (a && D.cur !== a) { a.reset().play(); if (D.cur) a.crossFadeFrom(D.cur, 0.35, true); D.cur = a; }
  if (a && want === 'running') a.setEffectiveTimeScale(Math.max(0.6, Math.min(1.6, moving * 1.3)));
  const dt = D.lastT == null ? 0 : Math.max(0, Math.min(0.1, time - D.lastT));
  D.lastT = time;
  D.mixer.update(dt);
  // los clips traen desplazamiento propio (el de volar sube varios metros): raíz y pelvis
  // vuelven a su sitio y solo se deja un vaivén suave, así el jinete va siempre en la silla
  for (const f of D.fixed) {
    const dy = f.b.position.y - f.p.y;
    f.b.position.copy(f.p);
    f.b.position.y += dy * 0.12;
  }
  D.d.rotation.z = flying ? bank * 0.5 : 0;
}

function buildPardelaBird() {
  const g = new THREE.Group(); g.userData.kind = 'mount-pardela';
  const S = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const back = S(0x7a6a58), backD = S(0x5a4c3e), belly = S(0xf2efe8), bill = S(0xe8d27a, 0.5), tip = S(0x3a3228, 0.5),
    eyeM = S(0x0a0a0a, 0.2), foot = S(0xe8b8a8), tack = S(0x5a3418), gold = new THREE.MeshStandardMaterial({ color: 0xd8b040, metalness: 0.8, roughness: 0.3 });

  // Cuerpo: dorso y vientre como dos medias elipsoides suaves
  const body = new THREE.Group(); body.position.y = 0.95; g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.6, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), back);
  top.scale.set(0.95, 0.72, 1.75); body.add(top);
  const bot = new THREE.Mesh(new THREE.SphereGeometry(0.6, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), belly);
  bot.scale.set(0.95, 0.78, 1.75); body.add(bot);
  // Cuello y cabeza (gris pardo arriba, blanco abajo)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 0.55, 20), back);
  neck.position.set(0, 0.28, 0.95); neck.rotation.x = 1.0; body.add(neck);
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12), belly); throat.scale.set(0.9, 0.8, 1.1); throat.position.set(0, 0.12, 1.08); body.add(throat);
  const head = new THREE.Group(); head.position.set(0, 0.5, 1.28); body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), back); skull.scale.set(0.92, 0.9, 1.15); head.add(skull);
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), belly);
  cheek.scale.set(0.95, 0.9, 1.1); cheek.position.set(0, -0.03, 0.02); head.add(cheek);
  // Pico: base gruesa, tubo nasal arriba y gancho oscuro
  const beak = new THREE.Group(); beak.position.set(0, -0.02, 0.3); head.add(beak);
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, 0.42, 14), bill); b1.rotation.x = Math.PI / 2; b1.position.z = 0.2; beak.add(b1);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 10), bill); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.07, 0.1); beak.add(tube);
  const hk = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), tip); hk.scale.set(0.9, 1.1, 1.3); hk.position.set(0, -0.015, 0.42); beak.add(hk);
  const hk2 = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 10), tip); hk2.position.set(0, -0.06, 0.45); hk2.rotation.x = Math.PI; beak.add(hk2);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), eyeM); e.position.set(sx * 0.21, 0.06, 0.14); head.add(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), S(0xffffff, 0.1)); hl.position.set(sx * 0.235, 0.075, 0.16); head.add(hl);
  }
  // Cola corta redondeada
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 10), backD); tail.scale.set(0.8, 0.18, 0.9); tail.position.set(0, 0.05, -1.1); body.add(tail);
  // Alas: silueta larga y estrecha (Shape extruida), dorso pardo encima, blanco debajo
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.28); wingShape.bezierCurveTo(0.9, 0.42, 2.2, 0.36, 3.6, 0.02);
  wingShape.bezierCurveTo(3.1, -0.14, 2.0, -0.3, 0.9, -0.36); wingShape.lineTo(0, -0.34); wingShape.lineTo(0, 0.28);
  const wgeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 24 });
  wgeo.rotateX(Math.PI / 2);   // plano XZ: x = envergadura, z = cuerda
  const wings = [];
  for (const side of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(side * 0.42, 0.18, 0.12); body.add(w);
    const up = new THREE.Mesh(wgeo, back); up.scale.set(side, 1, 1); w.add(up);
    const dn = new THREE.Mesh(wgeo, belly); dn.scale.set(side, 1, 1); dn.position.y = -0.06; w.add(dn);
    // borde de ataque y puntas más oscuros
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.2, 8), backD);
    edge.rotation.z = Math.PI / 2; edge.position.set(side * 1.7, 0.02, 0.27); w.add(edge);
    const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), backD); tipM.scale.set(1.6, 0.12, 0.5); tipM.position.set(side * 3.2, 0.0, 0.04); w.add(tipM);
    w.userData.side = side;
    wings.push(w);
  }
  // Patas palmeadas
  const feet = [];
  for (const sx of [-0.22, 0.22]) {
    const leg = new THREE.Group(); leg.position.set(sx, 0.62, -0.15); g.add(leg);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.6, 10), foot); shin.position.y = -0.3; leg.add(shin);
    const web = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.2, 0.05, 3), foot); web.rotation.y = Math.PI; web.position.set(0, -0.6, 0.1); web.scale.set(1, 1, 1.5); leg.add(web);
    feet.push(leg);
  }
  // Montura: silla de cuero con perilla dorada, riendas
  const saddle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 24), tack); saddle.scale.set(1, 1, 1.4); saddle.position.set(0, 0.46, -0.05); body.add(saddle);
  const horn = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), gold); horn.position.set(0, 0.56, 0.35); body.add(horn);
  for (const sx of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.5), tack); flap.position.set(sx * 0.5, 0.22, -0.05); flap.rotation.z = sx * 0.25; body.add(flap);
    const rein = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6), tack); rein.position.set(sx * 0.16, 0.5, 0.85); rein.rotation.x = 1.2; body.add(rein);
  }
  g.userData.wings = wings; g.userData.head = head; g.userData.body = body; g.userData.feet = feet;
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
  return g;
}

export function buildMount(id) {
  if (id === 'pardela') return buildPardela();
  const g = buildHorse();
  if (_horse) attachHorse(g); else loadHorse().then(() => attachHorse(g));
  return g;
}

/** Anima una montura. moving: 0..1 (velocidad relativa), time en s. */
export function animateMount(o, id, moving, time, flying, bank = 0) {
  if (!o) return;
  if (id === 'pardela' && o.userData.dragon) { animateDragon(o.userData.dragon, moving, time, flying, bank); return; }
  if (o.userData.horse) { animateHorse(o.userData.horse, moving, time); return; }
  if (id === 'pardela') {
    const U = o.userData;
    if (flying) {
      // planeo: alas extendidas, aleteo corto de vez en cuando, se inclina al girar
      const burst = Math.max(0, Math.sin(time * 0.9)) ** 6;       // rachas de aleteo
      const flap = Math.sin(time * (moving > 0.2 ? 7 : 9)) * (0.12 + burst * 0.45 + (moving > 0.2 ? 0 : 0.25));
      for (const w of U.wings) { w.rotation.set(0, 0, w.userData.side * (0.08 + flap)); w.scale.set(1, 1, 1); }
      U.body.rotation.z = bank * 0.6;
      U.body.rotation.x = -0.05;
      for (const f of U.feet) { f.rotation.x = -1.2; f.position.y = 0.72; }
      U.head.rotation.x = Math.sin(time * 1.1) * 0.05;
    } else {
      // en tierra: alas plegadas sobre el lomo, anda balanceándose
      const step = Math.sin(time * 9) * Math.min(1, moving);
      for (const w of U.wings) { w.rotation.set(0, w.userData.side * 1.48, 0); w.rotation.z = w.userData.side * -0.18; w.scale.set(0.5, 1, 0.9); }
      U.body.rotation.z = step * 0.08;
      U.body.rotation.x = 0;
      U.feet.forEach((f, i) => { f.rotation.x = (i ? 1 : -1) * step * 0.6; f.position.y = 0.62; });
      U.head.rotation.x = Math.sin(time * 9) * 0.06 * Math.min(1, moving) + Math.sin(time * 1.3) * 0.04;
    }
  } else {
    const legs = o.userData.legs || [];
    const amp = Math.min(1, moving) * 0.75;
    const ph = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    legs.forEach((l, i) => { l.rotation.x = Math.sin(time * 11 + ph[i]) * amp; });
    if (o.userData.neck) o.userData.neck.rotation.x = 0.6 + Math.sin(time * 11) * 0.08 * amp;
    if (o.userData.tail) o.userData.tail.rotation.x = 0.5 + amp * 0.5 + Math.sin(time * 3) * 0.08;
  }
}

/** Altura extra del jinete (sobre su altura normal). */
// Sesión 50 — en vuelo el dragón lleva el cuerpo más alto que en tierra: el jinete sube
// (se mezcla según la altura de vuelo). Live: __mountSeat('dragon_vuelo', v)
const FLY_SEAT_EXTRA = { pardela: 1.35 };
export function riderLift(id, altitude = 0) {
  if (!id) return 0;
  if (id !== 'pardela') return SEAT[id] - HIP;
  const k = Math.max(0, Math.min(1, altitude / 4));
  const extra = (SEAT.dragon_vuelo ?? FLY_SEAT_EXTRA.pardela) * (_dragon ? k : 0);
  return SEAT[id] - HIP + altitude + extra;
}

// ============================================================
// Jugador local
// ============================================================
export function id() { return current; }
export function getOwned() { return owned.slice(); }
export function isMounted() { return !!current; }
export function isFlying() { return current === 'pardela' && alt > 0.5; }
export function canFly() { return combatLevel >= MOUNTS.pardela.flyLevel; }
export function speedMult() {
  if (!current) return 1;
  const M = MOUNTS[current];
  return M.fly && canFly() ? M.flySpeed : M.speed;
}
export function liftY() { return riderLift(current, alt); }

function lockLeft() { return Math.max(0, MOUNT_COMBAT_LOCK_MS - (Date.now() - lastAttackedAt)); }

/** Llamar cuando al jugador le atacan (acierte o falle). */
export function onAttacked(damage) {
  lastAttackedAt = Date.now();
  if (current && damage > 0) dismount('💥 ¡Te han tirado de la montura!');
}

export function mount(which) {
  const p = getPlayer();
  if (!p || current) return;
  const lock = lockLeft();
  if (lock > 0) { feedLog('warning', `🐾 Te están atacando: no puedes montar hasta dentro de ${Math.ceil(lock / 1000)} s.`); return; }
  const why = canMountHere();
  if (why) { feedLog('warning', why); return; }
  if (!owned.includes(which)) { feedLog('info', 'Todavía no tienes montura. Tanausú, el cuadrero de La Laguna, te vende una.'); return; }
  current = which; preferred = which;
  if (which === 'pardela' && !canFly()) refresh();   // por si subiste de nivel
  obj = buildMount(which);
  scene.add(obj);
  alt = 0;
  sync(0);
  feedLog('info', which === 'pardela'
    ? (canFly() ? '🐉 Te subes al dragón y levantas el vuelo.' : `🐉 Te subes al dragón. Volará cuando tengas nivel de combate ${MOUNTS.pardela.flyLevel}.`)
    : '🐎 Te subes al caballo.');
  try { window.__playSfx?.('door_open'); } catch {}
  renderOrb();
}

export function dismount(msg = null) {
  if (!current) return;
  const p = getPlayer();
  // aterrizar en un sitio libre si venías volando
  if (p && current === 'pardela' && alt > 0.5 && findLanding) {
    try { const f = findLanding(p.position.x, p.position.z); if (f) { p.position.x = f.x; p.position.z = f.z; } } catch {}
  }
  if (obj) { scene.remove(obj); obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  obj = null; current = null; alt = 0;
  if (msg) feedLog('warning', msg);
  renderOrb();
}

export function toggle() {
  if (current) { dismount(); return; }
  if (!owned.length) { feedLog('info', '🐎 No tienes montura. Tanausú, el cuadrero de La Laguna (junto a la plaza), te vende una.'); return; }
  if (owned.length === 1) { mount(owned[0]); return; }
  openChooser();
}

function sync(dt) {
  const p = getPlayer();
  if (!p || !obj) return;
  obj.position.set(p.position.x, current === 'pardela' ? alt : 0, p.position.z);
  obj.rotation.y = p.rotation.y;
}

export function update(dt) {
  if (!started) return;
  t += dt;
  const p = getPlayer();
  if (p) {
    if (lastPos) {
      const d = Math.hypot(p.position.x - lastPos.x, p.position.z - lastPos.z);
      const v = dt > 0 ? d / dt : 0;
      speedNow = speedNow * 0.8 + Math.min(1.5, v / 12) * 0.2;
    }
    lastPos = { x: p.position.x, z: p.position.z };
  }
  if (current) {
    const why = canMountHere();
    if (why) { dismount(why.replace('No puedes montar', 'Te bajas de la montura')); return; }
    const M = MOUNTS[current];
    const flyNow = M.fly && canFly();
    const target = flyNow ? M.alt + Math.sin(t * 1.4) * 0.35 : 0;
    alt += (target - alt) * Math.min(1, dt * 1.6);
    // inclinación al girar (según cuánto cambia el rumbo)
    let dy = (p?.rotation.y || 0) - lastYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    lastYaw = p?.rotation.y || 0;
    bank += ((dt > 0 ? Math.max(-1, Math.min(1, -dy / dt * 0.35)) : 0) - bank) * Math.min(1, dt * 4);
    sync(dt);
    animateMount(obj, current, speedNow, t, alt > 0.5, bank);
  }
  // cuenta atrás del bloqueo en el orbe
  if (orbVal) {
    const lock = lockLeft();
    const txt = lock > 0 ? `${Math.ceil(lock / 1000)}s` : (current ? MOUNTS[current].icon : (owned.length ? '🐾' : '—'));
    if (orbVal.textContent !== txt) orbVal.textContent = txt;
    orbEl.classList.toggle('locked', lock > 0 && !current);
  }
}

// ============================================================
// HUD: orbe y selector
// ============================================================
function ensureCss() {
  if (document.getElementById('mountCss')) return;
  const s = document.createElement('style'); s.id = 'mountCss';
  s.textContent = `
    #hudStatMount { cursor: pointer; }
    #hudStatMount .osrs-stat-icon { display:flex; align-items:center; justify-content:center; font-size: 17px; line-height: 1; }
    #hudStatMount.active { box-shadow: 0 0 0 2px #ffd35a, 0 0 10px rgba(255,211,90,0.7); }
    #hudStatMount.locked { filter: grayscale(0.7); opacity: 0.8; }
    #hudStatMount .osrs-stat-value { font-size: 11px; }
    .mount-menu { position: fixed; z-index: 90; background: rgba(20,14,8,0.96); border: 2px solid #c8a043; border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 5px; }
    .mount-menu button { background: #3a2f1c; color: #f0e6d2; border: 1px solid #a88040; border-radius: 6px; padding: 9px 12px; font: bold 14px sans-serif; text-align: left; }
  `;
  document.head.appendChild(s);
}

function buildOrb() {
  ensureCss();
  const col = document.querySelector('.osrs-stats-column');
  if (!col || document.getElementById('hudStatMount')) return;
  orbEl = document.createElement('div');
  orbEl.className = 'osrs-stat mount';
  orbEl.id = 'hudStatMount';
  orbEl.title = 'Montura';
  orbEl.innerHTML = `<div class="osrs-stat-icon">🐎</div><div class="osrs-stat-value">—</div>`;
  orbVal = orbEl.querySelector('.osrs-stat-value');
  orbEl.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    toggle();
  });
  col.appendChild(orbEl);
  renderOrb();
}

function renderOrb() {
  if (!orbEl) return;
  orbEl.classList.toggle('active', !!current);
  const icon = orbEl.querySelector('.osrs-stat-icon');
  icon.textContent = current ? '⬇' : (preferred ? MOUNTS[preferred].icon : (owned.includes('pardela') ? '🐉' : '🐎'));
}

function openChooser() {
  closeChooser();
  menuEl = document.createElement('div');
  menuEl.className = 'mount-menu';
  const r = orbEl?.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, (r?.left ?? 100) - 150)}px`;
  menuEl.style.top = `${(r?.top ?? 100)}px`;
  for (const id of owned) {
    const b = document.createElement('button');
    b.textContent = `${MOUNTS[id].icon} ${MOUNTS[id].name}`;
    b.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); closeChooser(); mount(id); });
    menuEl.appendChild(b);
  }
  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 50);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeChooser(); }
function closeChooser() { document.removeEventListener('pointerdown', outside, true); if (menuEl) { menuEl.remove(); menuEl = null; } }

export async function refresh() {
  try { const r = await api.mountsGet(); owned = r?.owned || []; combatLevel = r?.combat_level || combatLevel; } catch {}
  renderOrb();
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  feedLog = opts.feedLog || (() => {});
  canMountHere = opts.canMountHere || (() => null);
  findLanding = opts.findLanding || null;
  started = true;
  buildOrb();
  refresh();
  if (typeof window !== 'undefined') window.__mountSeat = (id, v) => { if (SEAT[id] != null && Number.isFinite(v)) SEAT[id] = v; return { ...SEAT }; };
    window.__mounts = { refresh, id: () => current, toggle, onAttacked, setLevel: (l) => { combatLevel = l; } };
}

export function stop() {
  dismount();
  closeChooser();
  if (orbEl) { orbEl.remove(); orbEl = null; orbVal = null; }
  started = false; owned = []; lastPos = null;
}

// ============================================================
// Otros jugadores
// ============================================================
/** Pone/quita la montura de un peer (peer.group) y la anima. Llamar cada frame. */
export function updatePeerMount(peer, mountId, dt, time) {
  if (!scene || !peer?.group) return;
  if ((peer._mountId || null) !== (mountId || null)) {
    if (peer._mountObj) { scene.remove(peer._mountObj); peer._mountObj = null; }
    peer._mountId = mountId || null;
    peer._mountAlt = 0;
    if (mountId && MOUNTS[mountId]) { peer._mountObj = buildMount(mountId); scene.add(peer._mountObj); }
  }
  if (!peer._mountObj) { if (peer._liftApplied) { peer.group.position.y = 0; peer._liftApplied = false; } return; }
  const M = MOUNTS[peer._mountId];
  // un peer vuela si su montura vuela y su nivel lo permite
  const flyNow = M.fly && (peer.combatLvl || 0) >= (M.flyLevel || 0);
  const target = flyNow ? M.alt + Math.sin(time * 1.4) * 0.35 : 0;
  peer._mountAlt += (target - peer._mountAlt) * Math.min(1, dt * 1.6);
  const moving = peer.state === 'run' ? 1 : 0;
  peer.group.position.y = riderLift(peer._mountId, peer._mountAlt);
  peer._liftApplied = true;
  peer._mountObj.position.set(peer.group.position.x, peer._mountAlt, peer.group.position.z);
  peer._mountObj.rotation.y = peer.group.rotation.y;
  animateMount(peer._mountObj, peer._mountId, moving, time, peer._mountAlt > 0.5);
}
export function removePeerMount(peer) {
  if (peer?._mountObj && scene) scene.remove(peer._mountObj);
  if (peer) { peer._mountObj = null; peer._mountId = null; }
}
