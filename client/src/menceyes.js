/**
 * SebasPresent — Los nueve menceyes de Candelaria (Sesión 50)
 * Como en la plaza real de Candelaria: nueve estatuas de bronce, una por
 * menceyato, en semicírculo junto a la basílica. Tocar una → quién era.
 */
import * as THREE from 'three';

const CENTER = { x: 0, z: -1200 };
const R = 16;
export const MENCEYES = [
  { name: 'Bencomo',  reino: 'Taoro',     txt: 'Mencey de Taoro, el reino más rico. Encabezó la resistencia contra los castellanos.' },
  { name: 'Añaterve', reino: 'Güímar',    txt: 'Mencey de Güímar, donde apareció la Virgen. Pactó con los castellanos.' },
  { name: 'Beneharo', reino: 'Anaga',     txt: 'Mencey de Anaga, el de los montes del noreste, frente al mar.' },
  { name: 'Acaymo',   reino: 'Tacoronte', txt: 'Mencey de Tacoronte, en las tierras del norte.' },
  { name: 'Tegueste', reino: 'Tegueste',  txt: 'Mencey de Tegueste. Su reino, pequeño y fértil, todavía lleva su nombre.' },
  { name: 'Pelinor',  reino: 'Icod',      txt: 'Mencey de Icod, la tierra del drago.' },
  { name: 'Romen',    reino: 'Daute',     txt: 'Mencey de Daute, en el extremo noroeste, junto a Teno.' },
  { name: 'Pelicar',  reino: 'Adeje',     txt: 'Mencey de Adeje, el sur, donde según la leyenda reinó Tinerfe el Grande.' },
  { name: 'Adjoña',   reino: 'Abona',     txt: 'Mencey de Abona, las tierras secas del sureste.' },
];

let scene = null, group = null, feedLog = () => {}, getPlayer = () => null;
const spots = [];   // { x, z, m, mesh }

function plaque(name, reino) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2a18'; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#c8a043'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90);
  g.fillStyle = '#f2d78a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 36px serif'; g.fillText(name.toUpperCase(), 128, 38);
  g.font = 'italic 24px serif'; g.fillText(`Mencey de ${reino}`, 128, 72);
  return new THREE.CanvasTexture(c);
}

function statue(m, i) {
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, metalness: 0.65, roughness: 0.45, flatShading: true });
  const stone = new THREE.MeshLambertMaterial({ color: 0x5a544c, flatShading: true });
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), stone); base.position.y = 0.7; g.add(base);
  const fig = new THREE.Group(); fig.position.y = 1.4; g.add(fig);
  const add = (geo, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(geo, bronze); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); fig.add(o); return o; };
  // piernas, tamarco (capa de piel), torso, cabeza con pelo largo
  add(new THREE.CylinderGeometry(0.13, 0.11, 1.0, 7), -0.16, 0.5, 0);
  add(new THREE.CylinderGeometry(0.13, 0.11, 1.0, 7), 0.16, 0.5, 0.05 + (i % 2) * 0.1, (i % 2) * -0.15);
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 8), 0, 1.25, 0);
  add(new THREE.CylinderGeometry(0.3, 0.56, 1.2, 8, 1, true), 0, 1.1, -0.05);
  add(new THREE.SphereGeometry(0.25, 10, 8), 0, 1.95, 0);
  add(new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), 0, 1.98, -0.04);
  add(new THREE.BoxGeometry(0.4, 0.5, 0.1), 0, 1.75, -0.2);
  // brazos: uno con el añepa (bastón de mando) o una lanza, otro al pecho / alzado
  add(new THREE.CylinderGeometry(0.08, 0.07, 0.75, 6), -0.5, 1.35, 0.05, 0, 0.35);
  add(new THREE.CylinderGeometry(0.08, 0.07, 0.75, 6), 0.5, 1.45, 0.1, -0.6 - (i % 3) * 0.2, -0.3);
  const staffLen = i % 2 ? 2.6 : 1.8;
  add(new THREE.CylinderGeometry(0.035, 0.035, staffLen, 6), 0.62, 0.3 + staffLen / 2, 0.35);
  if (i % 2) add(new THREE.ConeGeometry(0.07, 0.25, 6), 0.62, 0.3 + staffLen + 0.1, 0.35);
  // placa con el nombre
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), new THREE.MeshBasicMaterial({ map: plaque(m.name, m.reino) }));
  pl.position.set(0, 0.85, 0.81); g.add(pl);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.6, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 2.3; hit.userData.mencey = m; g.add(hit);
  return { g, hit };
}

export function start(opts) {
  stop();
  scene = opts.scene; feedLog = opts.feedLog || (() => {}); getPlayer = opts.getPlayer || (() => null);
  group = new THREE.Group(); group.userData.kind = 'menceyes';
  MENCEYES.forEach((m, i) => {
    const a = (135 + i * 15) * Math.PI / 180;
    const x = CENTER.x + Math.cos(a) * R, z = CENTER.z + Math.sin(a) * R;
    const { g, hit } = statue(m, i);
    g.position.set(x, 0, z);
    g.scale.setScalar(1.4);
    g.rotation.y = Math.atan2(CENTER.x - x, CENTER.z - z);   // miran a la plaza
    group.add(g);
    spots.push({ x, z, m, hit });
  });
  scene.add(group);
}

export function stop() {
  if (group && scene) scene.remove(group);
  group = null; spots.length = 0;
}

export function tryHandleTap(raycaster) {
  if (!spots.length) return false;
  const hits = raycaster.intersectObjects(spots.map(s => s.hit), false);
  if (!hits.length) return false;
  const m = hits[0].object.userData.mencey;
  feedLog('info', `🗿 ${m.name}, mencey de ${m.reino}. ${m.txt}`);
  return true;
}

export function applyCollision(x0, z0, x1, z1) {
  let x = x1, z = z1;
  for (const s of spots) {
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
    if (d < 1.7 && d > 1e-4) { x = s.x + dx / d * 1.7; z = s.z + dz / d * 1.7; }
  }
  return { x, z };
}

export function registerKeepouts(terrain) {
  try { terrain.addKeepout?.(CENTER.x, CENTER.z, R + 4); terrain.clearTreesNear?.(CENTER.x, CENTER.z, R + 4); } catch {}
}
