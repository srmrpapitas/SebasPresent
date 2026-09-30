/**
 * SebasPresent — Poblado guanche de Chinamada (Sesión 50)
 * Casas redondas de piedra seca con techo de paja, el tagoror (círculo de
 * piedras del consejo), un corral de cabras y hogueras. Las casas bloquean
 * al jugador. Los habitantes son NPCs del server (shared/guanches.js).
 */
import * as THREE from 'three';
import { POBLADO, HUTS, TAGOROR, CORRAL } from './shared/guanches.js';

let scene = null, group = null, flames = [], t = 0;

export function registerKeepouts(terrain) {
  try { terrain.addKeepout?.(POBLADO.x, POBLADO.z, POBLADO.r); terrain.clearTreesNear?.(POBLADO.x, POBLADO.z, POBLADO.r); } catch {}
}

export function start(opts) {
  stop();
  scene = opts.scene;
  group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x7a7266, flatShading: true });
  const stoneD = new THREE.MeshLambertMaterial({ color: 0x5a544c, flatShading: true });
  const thatch = new THREE.MeshLambertMaterial({ color: 0xb89a5a, flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: 0x6a4a24, flatShading: true });
  const dirt = new THREE.MeshLambertMaterial({ color: 0x8a7a58 });
  const fireM = new THREE.MeshBasicMaterial({ color: 0xffa030 });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(POBLADO.r, 40), dirt);
  ground.rotation.x = -Math.PI / 2; ground.position.set(POBLADO.x, 0.025, POBLADO.z);
  group.add(ground);

  // Casas de piedra seca
  HUTS.forEach(([x, z, r], i) => {
    const h = new THREE.Group(); h.position.set(x, 0, z);
    const N = 16;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - i), Math.cos(a - i))) < 0.3) continue;   // puerta
      for (let row = 0; row < 3; row++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), row % 2 ? stoneD : stone);
        s.position.set(Math.cos(a + row * 0.2) * r, 0.35 + row * 0.5, Math.sin(a + row * 0.2) * r);
        s.rotation.set(k, row, 0);
        h.add(s);
      }
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r + 0.6, 2.4, 10), thatch);
    roof.position.y = 2.6; h.add(roof);
    group.add(h);
  });

  // Tagoror: círculo de piedras con asientos
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), k % 2 ? stone : stoneD);
    s.position.set(TAGOROR.x + Math.cos(a) * TAGOROR.r, 0.25, TAGOROR.z + Math.sin(a) * TAGOROR.r);
    s.rotation.y = -a;
    group.add(s);
  }
  // Hoguera central
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 6), fireM);
  fire.position.set(TAGOROR.x, 0.45, TAGOROR.z); group.add(fire); flames.push(fire);
  for (let k = 0; k < 6; k++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), wood);
    const a = k / 6 * Math.PI * 2;
    l.position.set(TAGOROR.x + Math.cos(a) * 0.3, 0.1, TAGOROR.z + Math.sin(a) * 0.3); l.rotation.set(Math.PI / 2, 0, a); group.add(l);
  }

  // Corral de cabras (vallado de palos)
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 5), wood);
    p.position.set(CORRAL.x + Math.cos(a) * CORRAL.r, 0.55, CORRAL.z + Math.sin(a) * CORRAL.r);
    group.add(p);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, CORRAL.r * 0.27), wood);
    const a2 = a + Math.PI / 24;
    b.position.set(CORRAL.x + Math.cos(a2) * CORRAL.r, 0.8, CORRAL.z + Math.sin(a2) * CORRAL.r);
    b.rotation.y = -a2;
    group.add(b);
  }
  scene.add(group);
}

export function stop() {
  if (group) scene?.remove(group);
  group = null; flames = [];
}

export function update(dt) {
  t += dt;
  for (const f of flames) { f.scale.set(1, 1 + Math.sin(t * 9) * 0.2, 1); f.rotation.y += dt * 2; }
}

/** El jugador no atraviesa las casas. */
export function applyCollision(x0, z0, x1, z1) {
  let x = x1, z = z1;
  for (const [hx, hz, r] of HUTS) {
    const dx = x - hx, dz = z - hz, d = Math.hypot(dx, dz), R = r + 0.5;
    if (d < R && d > 1e-4) { x = hx + dx / d * R; z = hz + dz / d * R; }
  }
  return { x, z };
}
