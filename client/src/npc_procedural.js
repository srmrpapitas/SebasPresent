/**
 * SebasPresent — NPCs procedurales low-poly (Sesión 50)
 *
 * Para los mobs que todavía no tienen GLB en R2. Cada modelo se construye con
 * primitivas de three.js (flatShading) y trae su propia animación sencilla:
 * patas que se mueven al caminar, respiración en reposo, cola/pinzas, etc.
 *
 *   const p = buildProceduralNpc('wolf');   // null si el tipo no existe
 *   group.add(p.root);  p.materials → flash rojo al recibir golpe
 *   p.animate(dt, moving)                   // cada frame
 *
 * Tipos: rat, spider, boar, wolf, scorpion, golem, yeti, skeleton.
 * Alturas objetivo en PROC_NPC_HEIGHTS (las usa la barra de vida).
 */

import * as THREE from 'three';

export const PROC_NPC_HEIGHTS = {
  rat: 0.55, spider: 0.8, boar: 1.0, wolf: 1.15, scorpion: 0.8, golem: 2.4, yeti: 2.5, skeleton: 1.8,
};

function mat(color, extra = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  m.userData = { baseColor: m.color.clone() };
  return m;
}
function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
function sph(r, m, detail = 0) { return new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), m); }
function cyl(rt, rb, h, m, seg = 6) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); }
function cone(r, h, m, seg = 5) { return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m); }

/** Pata con pivote en la cadera (rota en X para caminar). */
function leg(len, thick, m, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const l = box(thick, len, thick, m);
  l.position.y = -len / 2;
  pivot.add(l);
  return pivot;
}

// ------------------------------------------------------------
// Cuadrúpedo genérico (rata, jabalí, lobo)
// ------------------------------------------------------------
function quadruped(o) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = box(o.bw, o.bh, o.bl, o.m);
  torso.position.y = o.legLen + o.bh / 2;
  body.add(torso);
  const head = new THREE.Group();
  head.position.set(0, o.legLen + o.bh * 0.75, o.bl / 2 + o.hs * 0.3);
  const skull = box(o.hs, o.hs * 0.85, o.hs * 1.1, o.m);
  head.add(skull);
  const snout = box(o.hs * 0.55, o.hs * 0.45, o.hs * 0.7, o.snoutM || o.m);
  snout.position.set(0, -o.hs * 0.15, o.hs * 0.75);
  head.add(snout);
  for (const sx of [-1, 1]) {
    const eye = box(o.hs * 0.14, o.hs * 0.14, 0.02, o.eyeM);
    eye.position.set(sx * o.hs * 0.26, o.hs * 0.12, o.hs * 0.56);
    head.add(eye);
    if (o.ears) {
      const ear = cone(o.hs * 0.2, o.hs * 0.45, o.m, 4);
      ear.position.set(sx * o.hs * 0.3, o.hs * 0.55, -o.hs * 0.1);
      head.add(ear);
    }
    if (o.tusks) {
      const t = cone(o.hs * 0.07, o.hs * 0.4, o.tuskM, 4);
      t.position.set(sx * o.hs * 0.22, -o.hs * 0.1, o.hs * 1.0);
      t.rotation.x = -0.6;
      head.add(t);
    }
  }
  body.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, o.legLen + o.bh * 0.8, -o.bl / 2);
  const tm = o.tailThin ? cyl(0.02, 0.035, o.tailLen, o.tailM || o.m, 4) : box(o.hs * 0.25, o.hs * 0.25, o.tailLen, o.m);
  if (o.tailThin) { tm.rotation.x = Math.PI / 2 - 0.3; tm.position.z = -o.tailLen / 2; tm.position.y = -o.tailLen * 0.15; }
  else { tm.position.z = -o.tailLen / 2; tm.rotation.x = 0.5; }
  tail.add(tm);
  body.add(tail);
  const legs = [];
  const lx = o.bw / 2 - o.lt / 2, lz = o.bl / 2 - o.lt;
  for (const [x, z] of [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]]) {
    const L = leg(o.legLen, o.lt, o.m, x, o.legLen, z);
    body.add(L);
    legs.push(L);
  }
  let ph = Math.random() * 6;
  return {
    root,
    animate(dt, moving) {
      ph += dt * (moving ? o.gait : 1.2);
      const sw = moving ? 0.6 : 0;
      legs[0].rotation.x = Math.sin(ph) * sw;
      legs[3].rotation.x = Math.sin(ph) * sw;
      legs[1].rotation.x = -Math.sin(ph) * sw;
      legs[2].rotation.x = -Math.sin(ph) * sw;
      body.position.y = moving ? Math.abs(Math.sin(ph)) * o.legLen * 0.08 : Math.sin(ph) * 0.01;
      head.rotation.x = moving ? Math.sin(ph * 2) * 0.05 : Math.sin(ph * 0.5) * 0.08;
      tail.rotation.y = Math.sin(ph * (moving ? 1 : 2)) * 0.35;
    },
  };
}

// ------------------------------------------------------------
// Constructores por tipo
// ------------------------------------------------------------
const BUILDERS = {
  rat() {
    const m = mat(0x6e6258), eyeM = mat(0xff3030, { emissive: 0x551010 });
    return quadruped({ m, eyeM, snoutM: mat(0xd89a9a), bw: 0.28, bh: 0.24, bl: 0.55, hs: 0.2, legLen: 0.14, lt: 0.06,
      ears: true, tailThin: true, tailLen: 0.55, tailM: mat(0xd89a9a), gait: 16 });
  },
  boar() {
    const m = mat(0x5a3e2b), eyeM = mat(0x111111);
    return quadruped({ m, eyeM, snoutM: mat(0x9a6a5a), bw: 0.6, bh: 0.55, bl: 1.1, hs: 0.42, legLen: 0.32, lt: 0.13,
      ears: true, tusks: true, tuskM: mat(0xf0ead8), tailLen: 0.2, gait: 11 });
  },
  wolf() {
    const m = mat(0x7d8088), eyeM = mat(0xffd040, { emissive: 0x664400 });
    return quadruped({ m, eyeM, snoutM: mat(0x5a5d64), bw: 0.42, bh: 0.42, bl: 1.1, hs: 0.36, legLen: 0.5, lt: 0.1,
      ears: true, tailLen: 0.6, gait: 12 });
  },
  spider() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const m = mat(0x2b2230), red = mat(0xb02020, { emissive: 0x400000 });
    const abd = sph(0.42, m, 1); abd.scale.set(1, 0.8, 1.2); abd.position.set(0, 0.62, -0.35); body.add(abd);
    const mark = box(0.18, 0.02, 0.28, red); mark.position.set(0, 0.95, -0.35); body.add(mark);
    const ceph = sph(0.24, m, 0); ceph.position.set(0, 0.52, 0.18); body.add(ceph);
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
      const e = sph(0.04, red); e.position.set(sx * (0.07 + k * 0.06), 0.62, 0.38); body.add(e);
    }
    const legs = [];
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(sx * 0.15, 0.52, 0.25 - i * 0.14);
      const up = box(0.5, 0.05, 0.05, m); up.position.x = sx * 0.25; up.rotation.z = sx * -0.6; p.add(up);
      const lo = box(0.05, 0.55, 0.05, m); lo.position.set(sx * 0.48, -0.1, 0); lo.rotation.z = sx * 0.25; p.add(lo);
      p.rotation.y = sx * (0.5 - i * 0.33);
      body.add(p); legs.push(p);
    }
    let ph = Math.random() * 6;
    return { root, animate(dt, moving) {
      ph += dt * (moving ? 18 : 1.5);
      legs.forEach((p, i) => { p.rotation.x = moving ? Math.sin(ph + i * 1.3) * 0.35 : 0; });
      body.position.y = moving ? Math.abs(Math.sin(ph * 2)) * 0.04 : Math.sin(ph) * 0.015;
      abd.scale.y = 0.8 + Math.sin(ph * 0.8) * 0.03;
    } };
  },
  scorpion() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const m = mat(0xb07a3a), dark = mat(0x6a4020), sting = mat(0x303030);
    const segs = [];
    for (let i = 0; i < 3; i++) { const s = box(0.5 - i * 0.06, 0.2, 0.3, i ? m : dark); s.position.set(0, 0.28, 0.25 - i * 0.28); body.add(s); }
    const tail = new THREE.Group(); tail.position.set(0, 0.32, -0.5); body.add(tail);
    let parent = tail;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group(); g.position.set(0, 0.06, -0.14); g.rotation.x = 0.6; parent.add(g);
      const s = box(0.16 - i * 0.02, 0.14, 0.18, m); g.add(s); segs.push(g); parent = g;
    }
    const st = cone(0.05, 0.22, sting, 4); st.position.set(0, 0.1, 0.05); st.rotation.x = 2.2; parent.add(st);
    const claws = [];
    for (const sx of [-1, 1]) {
      const c = new THREE.Group(); c.position.set(sx * 0.28, 0.28, 0.4); body.add(c);
      const arm = box(0.08, 0.08, 0.35, m); arm.position.z = 0.17; c.add(arm);
      const p1 = box(0.12, 0.08, 0.2, dark); p1.position.set(sx * 0.04, 0, 0.42); p1.rotation.y = -sx * 0.3; c.add(p1);
      const p2 = box(0.07, 0.07, 0.18, dark); p2.position.set(-sx * 0.05, 0, 0.42); p2.rotation.y = sx * 0.3; c.add(p2);
      c.rotation.y = sx * 0.35; claws.push(c);
    }
    const legs = [];
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
      const L = box(0.4, 0.04, 0.04, m); L.position.set(sx * 0.35, 0.18, 0.2 - i * 0.25); L.rotation.z = sx * -0.5; body.add(L); legs.push(L);
    }
    let ph = Math.random() * 6;
    return { root, animate(dt, moving) {
      ph += dt * (moving ? 16 : 1.4);
      legs.forEach((l, i) => { l.rotation.y = moving ? Math.sin(ph + i) * 0.3 : 0; });
      segs.forEach((g, i) => { g.rotation.x = 0.6 + Math.sin(ph * 0.7 + i * 0.4) * 0.08; });
      claws.forEach((c, i) => { c.rotation.x = Math.sin(ph * 0.9 + i) * 0.12; });
    } };
  },
  golem() {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const m = mat(0x7a7470), m2 = mat(0x5c5652), glow = mat(0x6fd0ff, { emissive: 0x2a7aa0 });
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), m); torso.scale.set(1.1, 1, 0.8); torso.position.y = 1.45; body.add(torso);
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.33, 0), m2); head.position.set(0, 2.25, 0.1); body.add(head);
    for (const sx of [-1, 1]) { const e = box(0.1, 0.06, 0.04, glow); e.position.set(sx * 0.12, 2.28, 0.4); body.add(e); }
    const core = sph(0.16, glow); core.position.set(0, 1.5, 0.58); body.add(core);
    const arms = [], legs = [];
    for (const sx of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(sx * 0.95, 1.85, 0); body.add(a);
      const up = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), m2); up.position.y = -0.35; a.add(up);
      const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), m); fist.position.y = -0.9; a.add(fist);
      arms.push(a);
      const L = new THREE.Group(); L.position.set(sx * 0.4, 0.8, 0); body.add(L);
      const lg = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), m2); lg.scale.y = 1.3; lg.position.y = -0.4; L.add(lg);
      legs.push(L);
    }
    let ph = Math.random() * 6;
    return { root, animate(dt, moving) {
      ph += dt * (moving ? 5 : 1);
      const s = moving ? 0.4 : 0;
      legs[0].rotation.x = Math.sin(ph) * s; legs[1].rotation.x = -Math.sin(ph) * s;
      arms[0].rotation.x = -Math.sin(ph) * s * 0.8; arms[1].rotation.x = Math.sin(ph) * s * 0.8;
      body.rotation.z = moving ? Math.sin(ph) * 0.05 : 0;
      core.material.emissiveIntensity = 0.8 + Math.sin(ph * 2) * 0.3;
    } };
  },
  yeti() {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const fur = mat(0xe8eef2), skin = mat(0x6a7a8a), eyeM = mat(0x40c0ff, { emissive: 0x104060 });
    const torso = sph(0.7, fur, 1); torso.scale.set(1.1, 1.2, 0.85); torso.position.y = 1.45; body.add(torso);
    const head = sph(0.38, fur, 1); head.position.set(0, 2.3, 0.1); body.add(head);
    const face = box(0.42, 0.32, 0.1, skin); face.position.set(0, 2.25, 0.42); body.add(face);
    for (const sx of [-1, 1]) {
      const e = box(0.07, 0.05, 0.02, eyeM); e.position.set(sx * 0.1, 2.31, 0.48); body.add(e);
      const horn = cone(0.07, 0.3, skin, 4); horn.position.set(sx * 0.25, 2.62, 0.05); horn.rotation.z = -sx * 0.5; body.add(horn);
    }
    const arms = [], legs = [];
    for (const sx of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(sx * 0.82, 1.95, 0); body.add(a);
      const arm = box(0.3, 1.1, 0.3, fur); arm.position.y = -0.55; a.add(arm);
      const hand = box(0.3, 0.25, 0.3, skin); hand.position.y = -1.2; a.add(hand);
      arms.push(a);
      const L = leg(0.8, 0.34, fur, sx * 0.35, 0.8, 0); body.add(L); legs.push(L);
    }
    let ph = Math.random() * 6;
    return { root, animate(dt, moving) {
      ph += dt * (moving ? 6 : 1.2);
      const s = moving ? 0.55 : 0.06;
      legs[0].rotation.x = Math.sin(ph) * (moving ? 0.5 : 0); legs[1].rotation.x = -Math.sin(ph) * (moving ? 0.5 : 0);
      arms[0].rotation.x = -Math.sin(ph) * s; arms[1].rotation.x = Math.sin(ph) * s;
      torso.scale.y = 1.2 + Math.sin(ph * 0.8) * 0.02;
    } };
  },
  skeleton() {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const bone = mat(0xe6dcc4), dark = mat(0x1a1410), eyeM = mat(0x60ff90, { emissive: 0x20a040 });
    const skull = sph(0.2, bone, 1); skull.scale.set(1, 1.1, 1.05); skull.position.y = 1.62; body.add(skull);
    const jaw = box(0.2, 0.08, 0.16, bone); jaw.position.set(0, 1.45, 0.05); body.add(jaw);
    for (const sx of [-1, 1]) { const e = sph(0.05, eyeM); e.position.set(sx * 0.08, 1.65, 0.16); body.add(e); }
    const spine = cyl(0.04, 0.04, 0.7, bone, 5); spine.position.y = 1.05; body.add(spine);
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.18 - i * 0.015, 0.025, 4, 10), bone); r.rotation.x = Math.PI / 2; r.position.y = 1.3 - i * 0.1; body.add(r); }
    const pelvis = box(0.34, 0.1, 0.16, bone); pelvis.position.y = 0.72; body.add(pelvis);
    const arms = [], legs = [];
    for (const sx of [-1, 1]) {
      const a = leg(0.65, 0.05, bone, sx * 0.24, 1.35, 0); body.add(a); arms.push(a);
      const L = leg(0.7, 0.06, bone, sx * 0.12, 0.7, 0); body.add(L); legs.push(L);
    }
    const sword = box(0.05, 0.7, 0.02, mat(0x8a8a90)); sword.position.set(0, -0.9, 0.2); sword.rotation.x = 1.3; arms[1].add(sword);
    let ph = Math.random() * 6;
    return { root, animate(dt, moving) {
      ph += dt * (moving ? 8 : 1.5);
      const s = moving ? 0.6 : 0;
      legs[0].rotation.x = Math.sin(ph) * s; legs[1].rotation.x = -Math.sin(ph) * s;
      arms[0].rotation.x = -Math.sin(ph) * s * 0.7; arms[1].rotation.x = Math.sin(ph) * s * 0.7 - 0.3;
      jaw.position.y = 1.45 - Math.max(0, Math.sin(ph * 0.7)) * 0.03;
      body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.04 : 0;
    } };
  },
};

/** Construye el NPC. Devuelve { root, materials, animate } o null. */
export function buildProceduralNpc(typeId) {
  const b = BUILDERS[typeId];
  if (!b) return null;
  const out = b();
  const materials = new Set();
  out.root.traverse(o => {
    if (o.isMesh) {
      // Material propio por NPC (para el flash rojo individual)
      o.material = o.material.clone();
      o.material.userData = { baseColor: o.material.color.clone() };
      materials.add(o.material);
    }
  });
  out.materials = [...materials];
  return out;
}

export function hasProceduralNpc(typeId) { return !!BUILDERS[typeId]; }
