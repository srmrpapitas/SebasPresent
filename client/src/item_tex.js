/**
 * SebasPresent — Icono de objeto → textura 3D (Sesión 50)
 * Para colgar en los puestos lo que vende cada comerciante: una tarjetita de
 * papel con el mismo icono que ves en la mochila (SVG) o su emoji.
 */
import * as THREE from 'three';
import { getItemIconHtml } from './item_icons.js';

const cache = new Map();

export function itemTexture(itemId, emoji = '📦') {
  if (cache.has(itemId)) return cache.get(itemId);
  const c = document.createElement('canvas'); c.width = 96; c.height = 96;
  const g = c.getContext('2d');
  const card = () => {
    g.clearRect(0, 0, 96, 96);
    g.fillStyle = '#f1e4c0'; g.beginPath(); g.roundRect?.(4, 4, 88, 88, 12) ?? g.rect(4, 4, 88, 88); g.fill();
    g.strokeStyle = '#7a5a30'; g.lineWidth = 4; g.stroke();
  };
  card();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const html = getItemIconHtml(itemId, emoji);
  if (html.startsWith('<svg')) {
    let svg = html.includes('xmlns=') ? html : html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    svg = svg.replace('<svg', '<svg width="72" height="72"');
    const img = new Image();
    img.onload = () => { card(); g.drawImage(img, 12, 12, 72, 72); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } else {
    g.font = '52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 48, 52); tex.needsUpdate = true;
  }
  cache.set(itemId, tex);
  return tex;
}

/**
 * Cuerda con objetos colgados (tendedero). Devuelve un Group centrado en x=0:
 * la cuerda va de -w/2 a w/2 a la altura y, y cada objeto cuelga con su pinza.
 */
export function hangingLine(items, w = 2.4, y = 2.15) {
  const g = new THREE.Group();
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, w, 5), new THREE.MeshLambertMaterial({ color: 0xd8c8a0 }));
  rope.rotation.z = Math.PI / 2; rope.position.y = y; g.add(rope);
  const n = items.length; if (!n) return g;
  const step = w / (n + 1);
  const pegM = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
  items.forEach(([id, emoji], i) => {
    const x = -w / 2 + step * (i + 1);
    const sag = Math.sin((i + 1) / (n + 1) * Math.PI) * 0.08;
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), pegM); peg.position.set(x, y - sag - 0.02, 0); g.add(peg);
    const mat = new THREE.MeshBasicMaterial({ map: itemTexture(id, emoji), side: THREE.DoubleSide, transparent: true });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), mat);
    card.position.set(x, y - sag - 0.22, 0); card.rotation.z = ((i * 37) % 11 - 5) * 0.02;
    g.add(card);
  });
  return g;
}
