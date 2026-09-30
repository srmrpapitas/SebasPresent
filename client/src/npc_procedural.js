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
  // Sesión 50 — jefes
  rey_yeti: 4.6, coloso_obsidiana: 5.0, reina_escorpion: 2.4, bruja_pantano: 2.6, leviatan: 5.5,
  rey_esqueleto: 3.3, dragon_rojo: 5.2, dragon_negro: 6.2,
  // Sesión 50 — Fosa de Fuego
  fosa_diablillo: 1.2, fosa_escupefuego: 1.3, fosa_espiritu: 1.9, fosa_bruto: 2.6, fosa_ignaroth: 5.2,
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


// ============================================================
// Sesión 50 — JEFES
// ============================================================
// Variante escalada/recoloreada de un modelo existente + extras (corona…).
// attack() dispara una animación corta de golpe (la llama boss_fx.js).
function variant(base, scale, recolor, extras) {
  const out = BUILDERS[base]();
  const done = new Set();   // los materiales se comparten entre mallas: recolorear una sola vez
  out.root.traverse(o => { if (o.isMesh && recolor && !done.has(o.material)) { done.add(o.material); recolor(o.material); } });
  const holder = new THREE.Group();
  holder.add(out.root);
  out.root.scale.setScalar(scale);
  if (extras) extras(out.root);
  let atkT = 0;
  const baseAnim = out.animate;
  return {
    root: holder,
    attack() { atkT = 0.45; },
    animate(dt, moving) {
      baseAnim(dt, moving);
      if (atkT > 0) {
        atkT -= dt;
        const k = Math.sin(Math.max(0, atkT) / 0.45 * Math.PI);
        out.root.rotation.x = k * 0.28;
        out.root.position.z = k * 0.4 * scale * 0.3;
      } else { out.root.rotation.x = 0; out.root.position.z = 0; }
    },
  };
}
function lum(m) { const h = m.color.getHex(); return ((h >> 16) & 255) * 0.3 + ((h >> 8) & 255) * 0.59 + (h & 255) * 0.11; }
function crown(parent, y, r, color = 0xe0b030) {
  const m = mat(color, { emissive: 0x5a3a00 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, r * 0.45, 10, 1, true), m);
  band.material.side = THREE.DoubleSide;
  band.position.y = y;
  parent.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = cone(r * 0.2, r * 0.6, m, 4);
    sp.position.set(Math.cos(a) * r, y + r * 0.45, Math.sin(a) * r);
    parent.add(sp);
  }
}

/** Dragón (rojo o negro): cuerpo, cuello largo, alas que baten, cola y aliento. */
function dragon(o) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const S = o.s;
  const m = mat(o.c1), belly = mat(o.c2), dark = mat(o.c3), horn = mat(0xe8dcc0), eyeM = mat(o.eye, { emissive: o.eye });
  const wingM = mat(o.wing, { side: THREE.DoubleSide });
  const torso = sph(1.1 * S, m, 1); torso.scale.set(1, 0.85, 1.6); torso.position.y = 1.8 * S; body.add(torso);
  const bel = sph(1.0 * S, belly, 1); bel.scale.set(0.9, 0.7, 1.4); bel.position.set(0, 1.55 * S, 0.1 * S); body.add(bel);
  // Espinas del lomo
  for (let i = 0; i < 6; i++) { const sp = cone(0.14 * S, 0.5 * S, dark, 4); sp.position.set(0, 2.65 * S, (1.2 - i * 0.5) * S); sp.rotation.x = -0.4; body.add(sp); }
  // Cuello + cabeza
  const neck = new THREE.Group(); neck.position.set(0, 2.2 * S, 1.5 * S); body.add(neck);
  const n1 = cyl(0.35 * S, 0.5 * S, 1.6 * S, m, 7); n1.position.set(0, 0.6 * S, 0.5 * S); n1.rotation.x = 0.7; neck.add(n1);
  const head = new THREE.Group(); head.position.set(0, 1.25 * S, 1.2 * S); neck.add(head);
  const skull = box(0.8 * S, 0.6 * S, 0.9 * S, m); head.add(skull);
  const snout = box(0.6 * S, 0.35 * S, 0.8 * S, m); snout.position.set(0, -0.05 * S, 0.75 * S); head.add(snout);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.25 * S, 0.3 * S); head.add(jaw);
  const jm = box(0.55 * S, 0.14 * S, 0.9 * S, dark); jm.position.z = 0.45 * S; jaw.add(jm);
  for (const sx of [-1, 1]) {
    const h = cone(0.1 * S, 0.8 * S, horn, 5); h.position.set(sx * 0.28 * S, 0.35 * S, -0.35 * S); h.rotation.set(-2.2, 0, sx * 0.3); head.add(h);
    const e = sph(0.08 * S, eyeM); e.position.set(sx * 0.3 * S, 0.12 * S, 0.3 * S); head.add(e);
    const t = cone(0.04 * S, 0.18 * S, horn, 4); t.position.set(sx * 0.2 * S, -0.22 * S, 1.05 * S); t.rotation.x = Math.PI; head.add(t);
  }
  const fire = sph(0.22 * S, mat(0xffa030, { emissive: 0xff5010, emissiveIntensity: 1.5 })); fire.position.set(0, -0.15 * S, 1.2 * S); fire.visible = false; head.add(fire);
  // Alas
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * 0.8 * S, 2.5 * S, 0.3 * S); body.add(w);
    const arm = cyl(0.08 * S, 0.12 * S, 2.6 * S, dark, 5); arm.rotation.z = sx * -1.2; arm.position.set(sx * 1.1 * S, 0.45 * S, 0); w.add(arm);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(2.4 * S, 0.9 * S); sh.lineTo(2.9 * S, -0.3 * S); sh.lineTo(2.2 * S, -1.2 * S); sh.lineTo(1.2 * S, -1.6 * S); sh.lineTo(0.3 * S, -1.1 * S); sh.closePath();
    const memb = new THREE.Mesh(new THREE.ShapeGeometry(sh), wingM);
    memb.rotation.x = Math.PI / 2; memb.scale.set(sx * 1.25, 1.25, 1);
    w.add(memb);
    wings.push(w);
  }
  // Cola
  const tail = new THREE.Group(); tail.position.set(0, 1.8 * S, -1.6 * S); body.add(tail);
  let par = tail; const tailSegs = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); g.position.z = i ? -0.55 * S : 0; par.add(g);
    const seg = cyl(0.3 * S * (1 - i * 0.14), 0.36 * S * (1 - i * 0.14), 0.65 * S, m, 6); seg.rotation.x = Math.PI / 2; seg.position.z = -0.3 * S; g.add(seg);
    tailSegs.push(g); par = g;
  }
  const tip = cone(0.25 * S, 0.6 * S, dark, 4); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.7 * S; par.add(tip);
  // Patas
  const legs = [];
  for (const [x, z] of [[-0.75, 0.9], [0.75, 0.9], [-0.75, -0.9], [0.75, -0.9]]) {
    const L = leg(1.3 * S, 0.34 * S, m, x * S, 1.35 * S, z * S); body.add(L); legs.push(L);
    const claw = cone(0.16 * S, 0.3 * S, horn, 4); claw.position.set(0, -1.3 * S, 0.2 * S); claw.rotation.x = Math.PI / 2; L.add(claw);
  }
  let ph = Math.random() * 6, atkT = 0, breathT = 0;
  return {
    root,
    attack(kind) { if (kind === 'breath') breathT = 1.1; else atkT = 0.5; },
    animate(dt, moving) {
      ph += dt * (moving ? 5 : 1.1);
      const sw = moving ? 0.45 : 0;
      legs[0].rotation.x = Math.sin(ph) * sw; legs[3].rotation.x = Math.sin(ph) * sw;
      legs[1].rotation.x = -Math.sin(ph) * sw; legs[2].rotation.x = -Math.sin(ph) * sw;
      wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (0.45 + Math.sin(ph * (moving ? 2 : 1.3)) * 0.3); });
      tailSegs.forEach((g, i) => { g.rotation.y = Math.sin(ph * 0.9 - i * 0.5) * 0.12; });
      torso.scale.y = 0.85 + Math.sin(ph * 0.8) * 0.02;
      let neckX = Math.sin(ph * 0.6) * 0.05, jawX = 0.05;
      if (atkT > 0) { atkT -= dt; const k = Math.sin(Math.max(0, atkT) / 0.5 * Math.PI); neckX += k * 0.5; jawX = 0.1 + k * 0.5; }
      if (breathT > 0) { breathT -= dt; neckX += 0.25; jawX = 0.6; fire.visible = true; fire.scale.setScalar(0.8 + Math.random() * 0.6); }
      else fire.visible = false;
      neck.rotation.x = neckX; jaw.rotation.x = jawX;
    },
  };
}

/** Bruja del pantano: túnica, sombrero puntiagudo, bastón con calavera. Flota. */
function witch() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const robe = mat(0x3a1a4a), robe2 = mat(0x24102e), skin = mat(0x8aa070), hat = mat(0x1a0c22), glow = mat(0xc070ff, { emissive: 0x7020c0, emissiveIntensity: 1.3 }), bone = mat(0xe6dcc4);
  const skirt = cone(0.75, 1.6, robe, 8); skirt.position.y = 0.9; body.add(skirt);
  const tatters = cone(0.85, 0.5, robe2, 8); tatters.position.y = 0.25; tatters.rotation.x = Math.PI; body.add(tatters);
  const chest = sph(0.38, robe, 1); chest.scale.set(1, 1.1, 0.8); chest.position.set(0, 1.75, 0.05); body.add(chest);
  const head = sph(0.26, skin, 1); head.position.set(0, 2.2, 0.18); body.add(head);
  const nose = cone(0.06, 0.28, skin, 4); nose.position.set(0, 2.18, 0.46); nose.rotation.x = Math.PI / 2 + 0.3; body.add(nose);
  for (const sx of [-1, 1]) { const e = sph(0.045, glow); e.position.set(sx * 0.1, 2.26, 0.4); body.add(e); }
  const brim = cyl(0.55, 0.55, 0.04, hat, 12); brim.position.y = 2.38; body.add(brim);
  const tip = cone(0.3, 1.0, hat, 8); tip.position.set(0, 2.9, -0.1); tip.rotation.x = -0.35; body.add(tip);
  const arm = new THREE.Group(); arm.position.set(0.45, 1.8, 0.1); body.add(arm);
  const sleeve = cyl(0.1, 0.16, 0.7, robe, 6); sleeve.position.y = -0.3; sleeve.rotation.z = 0.4; arm.add(sleeve);
  const staff = cyl(0.04, 0.05, 2.2, mat(0x3a2410), 5); staff.position.set(0.25, -0.2, 0.1); arm.add(staff);
  const sk = sph(0.14, bone, 0); sk.position.set(0.25, 0.95, 0.1); arm.add(sk);
  const orb = sph(0.1, glow, 1); orb.position.set(0.25, 1.15, 0.1); arm.add(orb);
  let ph = Math.random() * 6, atkT = 0;
  return {
    root,
    attack() { atkT = 0.5; },
    animate(dt) {
      ph += dt * 1.6;
      body.position.y = 0.25 + Math.sin(ph) * 0.12;
      body.rotation.y = Math.sin(ph * 0.5) * 0.08;
      skirt.rotation.y += dt * 0.4;
      orb.scale.setScalar(1 + Math.sin(ph * 4) * 0.2);
      arm.rotation.x = atkT > 0 ? -1.2 * Math.sin(Math.max(0, (atkT -= dt)) / 0.5 * Math.PI) : Math.sin(ph) * 0.05;
    },
  };
}

/** Leviatán: serpiente marina en arcos que salen del suelo. setStyle(verde/azul). */
function leviatan() {
  const root = new THREE.Group();
  const scaleM = mat(0x2a7a8a), belly = mat(0xc8e0b0), fin = mat(0x1a4a5a, { side: THREE.DoubleSide });
  const glowM = mat(0x40ff80, { emissive: 0x20a040, emissiveIntensity: 1.2 });
  const humps = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); g.position.set(0, 0, -1.6 - i * 2.2); root.add(g);
    const t = new THREE.Mesh(new THREE.TorusGeometry(1.0 - i * 0.15, 0.42 - i * 0.07, 6, 12, Math.PI), scaleM);
    g.add(t);
    const f = cone(0.3, 0.8, fin, 3); f.position.y = 1.35 - i * 0.2; g.add(f);
    humps.push(g);
  }
  // Cuello que sale del agua y cabeza
  const neck = new THREE.Group(); root.add(neck);
  const n = cyl(0.45, 0.6, 3.6, scaleM, 8); n.position.set(0, 1.7, 0); neck.add(n);
  const nb = cyl(0.3, 0.42, 3.4, belly, 8); nb.position.set(0, 1.7, 0.18); neck.add(nb);
  const head = new THREE.Group(); head.position.set(0, 3.7, 0.3); neck.add(head);
  head.add(box(0.9, 0.7, 1.2, scaleM));
  const snout = box(0.7, 0.4, 0.9, scaleM); snout.position.set(0, -0.1, 0.9); head.add(snout);
  const jaw = box(0.65, 0.15, 0.9, belly); jaw.position.set(0, -0.38, 0.75); head.add(jaw);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = sph(0.1, glowM); e.position.set(sx * 0.38, 0.12, 0.45); head.add(e); eyes.push(e);
    const fn = cone(0.25, 0.9, fin, 3); fn.position.set(sx * 0.5, 0.2, -0.4); fn.rotation.set(-1.2, 0, sx * 0.8); head.add(fn);
  }
  const crest = cone(0.2, 0.9, fin, 3); crest.position.set(0, 0.6, -0.2); crest.rotation.x = -0.6; head.add(crest);
  let ph = Math.random() * 6, atkT = 0;
  const STY = { ranged: [0x2a8a4a, 0x40ff80], magic: [0x2a4a9a, 0x60a0ff] };
  // (los materiales se clonan al construir el NPC: marcamos las mallas por nombre)
  root.traverse(o => { if (o.material === scaleM) o.name = 'lev_scale'; else if (o.material === glowM) o.name = 'lev_glow'; });
  return {
    root,
    attack() { atkT = 0.5; },
    setStyle(st) {
      const c = STY[st] || STY.ranged;
      root.traverse(o => {
        if (o.name === 'lev_scale') { o.material.color.setHex(c[0]); o.material.userData.baseColor = o.material.color.clone(); }
        else if (o.name === 'lev_glow') { o.material.color.setHex(c[1]); o.material.emissive?.setHex(c[1]); o.material.userData.baseColor = o.material.color.clone(); }
      });
    },
    animate(dt) {
      ph += dt * 1.5;
      humps.forEach((g, i) => { g.position.y = Math.sin(ph + i * 1.2) * 0.25 - 0.1; });
      neck.rotation.x = Math.sin(ph * 0.7) * 0.08 + (atkT > 0 ? Math.sin(Math.max(0, (atkT -= dt)) / 0.5 * Math.PI) * 0.45 : 0);
      neck.rotation.z = Math.sin(ph * 0.5) * 0.06;
      eyes.forEach(e => e.scale.setScalar(1 + Math.sin(ph * 5) * 0.15));
    },
  };
}


// ---------------- Criaturas de la Fosa de Fuego ----------------
const LAVA = () => mat(0xff6a10, { emissive: 0xff3a00, emissiveIntensity: 1.3 });
function imp() {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const skin = mat(0x8a1a10), dark = mat(0x3a0a06), lava = LAVA(), eye = mat(0xffe040, { emissive: 0xffc000 });
  const torso = sph(0.3, skin, 1); torso.scale.set(1, 1.15, 0.85); torso.position.y = 0.62; body.add(torso);
  const belly = sph(0.16, lava, 0); belly.position.set(0, 0.6, 0.2); body.add(belly);
  const head = sph(0.22, skin, 1); head.position.set(0, 1.0, 0.05); body.add(head);
  for (const sx of [-1, 1]) {
    const h = cone(0.05, 0.22, dark, 4); h.position.set(sx * 0.12, 1.2, 0); h.rotation.z = -sx * 0.4; body.add(h);
    const e = sph(0.04, eye); e.position.set(sx * 0.08, 1.02, 0.2); body.add(e);
    const w = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 3), mat(0x5a0a08, { side: THREE.DoubleSide })); w.position.set(sx * 0.3, 0.85, -0.15); w.rotation.set(0.4, 0, sx * 1.3); body.add(w);
  }
  const legs = [];
  for (const sx of [-1, 1]) { const L = leg(0.34, 0.09, dark, sx * 0.13, 0.36, 0); body.add(L); legs.push(L); }
  const tail = cyl(0.02, 0.05, 0.5, dark, 4); tail.position.set(0, 0.45, -0.3); tail.rotation.x = 1.0; body.add(tail);
  let ph = Math.random() * 6, atkT = 0;
  return { root, attack() { atkT = 0.35; }, animate(dt, moving) {
    ph += dt * (moving ? 14 : 2);
    legs[0].rotation.x = Math.sin(ph) * (moving ? 0.7 : 0); legs[1].rotation.x = -Math.sin(ph) * (moving ? 0.7 : 0);
    body.position.y = Math.abs(Math.sin(ph)) * 0.05;
    belly.scale.setScalar(1 + Math.sin(ph * 1.5) * 0.15);
    body.rotation.x = atkT > 0 ? Math.sin(Math.max(0, (atkT -= dt)) / 0.35 * Math.PI) * 0.5 : 0;
  } };
}
function spitter() {
  const m = mat(0x2a2220), eyeM = mat(0xffa020, { emissive: 0xff6000 });
  const out = quadruped({ m, eyeM, snoutM: mat(0xff5a10, { emissive: 0xc02000 }), bw: 0.55, bh: 0.4, bl: 1.0, hs: 0.38, legLen: 0.28, lt: 0.12,
    ears: false, tailLen: 0.7, gait: 10 });
  const lava = LAVA();
  for (let k = 0; k < 4; k++) { const c = cone(0.06, 0.25, lava, 4); c.position.set(0, 0.8, 0.3 - k * 0.22); out.root.add(c); }
  return out;
}
function fireSpirit() {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const core = sph(0.28, mat(0xfff0a0, { emissive: 0xffc040, emissiveIntensity: 1.5 }), 1); core.position.y = 1.2; body.add(core);
  const flames = [];
  for (let k = 0; k < 7; k++) {
    const f = cone(0.18 - k * 0.015, 0.7 + (k % 3) * 0.2, mat(k % 2 ? 0xff7a10 : 0xffb030, { emissive: k % 2 ? 0xff4000 : 0xff8000, emissiveIntensity: 1.2 }), 5);
    const a = k * 0.9;
    f.position.set(Math.cos(a) * 0.18, 1.35 + (k % 2) * 0.1, Math.sin(a) * 0.18);
    body.add(f); flames.push(f);
  }
  for (const sx of [-1, 1]) { const e = box(0.08, 0.05, 0.03, mat(0x2a0a00)); e.position.set(sx * 0.1, 1.28, 0.26); body.add(e); }
  let ph = Math.random() * 6, atkT = 0;
  return { root, attack() { atkT = 0.4; }, animate(dt) {
    ph += dt * 3;
    body.position.y = 0.15 + Math.sin(ph) * 0.12;
    flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(ph * 3 + i) * 0.25; f.rotation.z = Math.sin(ph * 2 + i) * 0.15; });
    core.scale.setScalar(1 + (atkT > 0 ? Math.sin(Math.max(0, (atkT -= dt)) / 0.4 * Math.PI) * 0.6 : 0));
  } };
}
const lavaRecolor = (m) => {
  const glowing = m.emissive && m.emissive.getHex() !== 0;
  if (glowing) { m.color.setHex(0xff6a10); m.emissive.setHex(0xff3a00); m.emissiveIntensity = 1.4; }
  else m.color.setHex(lum(m) > 110 ? 0x3a2a24 : 0x241a16);
};
function ignaroth() {
  const v = variant('golem', 2.2, lavaRecolor, (r) => {
    const lava = LAVA();
    for (let k = 0; k < 6; k++) { const c = cone(0.1, 0.55, lava, 4); const a = k / 6 * Math.PI * 2; c.position.set(Math.cos(a) * 0.25, 2.55, Math.sin(a) * 0.25 + 0.1); c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); r.add(c); }
    for (const sx of [-1, 1]) { const h = cone(0.12, 0.7, mat(0x1a1210), 4); h.position.set(sx * 0.35, 2.4, 0.05); h.rotation.z = -sx * 1.0; r.add(h); }
  });
  // Brillo de aviso: verde (proyectiles) / azul (magia)
  const aura = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0, depthWrite: false }));
  aura.position.y = 3.2; aura.name = 'ign_aura';
  v.root.add(aura);
  let glowT = 0;
  const baseAnim = v.animate;
  v.setGlow = (style) => {
    v.root.traverse(o => { if (o.name === 'ign_aura') { o.material.color.setHex(style === 'magic' ? 0x4a8aff : 0x40ff60); } });
    glowT = style ? 1.8 : 0;
  };
  v.animate = (dt, moving) => {
    baseAnim(dt, moving);
    if (glowT > 0) glowT -= dt;
    v.root.traverse(o => { if (o.name === 'ign_aura') o.material.opacity = glowT > 0 ? 0.25 + Math.sin(performance.now() / 70) * 0.12 : 0; });
  };
  return v;
}

Object.assign(BUILDERS, {
  rey_yeti: () => variant('yeti', 1.8, (m) => { if (m.color.getHex() === 0xe8eef2) m.color.setHex(0xd8e8f8); }, (r) => {
    crown(r, 2.62, 0.3, 0x9fe3ff);
    const ice = mat(0x9fe3ff, { emissive: 0x2a6a9a });
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const c = cone(0.08, 0.4, ice, 4); c.position.set(sx * (0.7 + k * 0.1), 2.1 + k * 0.05, -0.1 * k); c.rotation.z = -sx * 0.8; r.add(c); }
  }),
  coloso_obsidiana: () => variant('golem', 2.0, (m) => {
    const glowing = m.emissive && m.emissive.getHex() !== 0;
    if (glowing) { m.color.setHex(0xb070ff); m.emissive.setHex(0x6a20c0); }
    else m.color.setHex(lum(m) > 110 ? 0x2e2838 : 0x1a1620);
  }, (r) => {
    const g = mat(0xa36bff, { emissive: 0x6a20c0, emissiveIntensity: 1.2 });
    for (let k = 0; k < 5; k++) { const c = cone(0.12, 0.6, g, 4); c.position.set(-0.5 + k * 0.25, 2.0 + (k % 2) * 0.1, -0.4); c.rotation.x = -0.4; r.add(c); }
  }),
  reina_escorpion: () => variant('scorpion', 3.2, (m) => {
    const l = lum(m);
    if (l < 60) { m.color.setHex(0x60ff60); m.emissive?.setHex?.(0x20a020); }   // aguijón venenoso
    else if (l > 100) m.color.setHex(0x6a3a7a); else m.color.setHex(0x2a1030);
  }, (r) => crown(r, 0.42, 0.12)),
  rey_esqueleto: () => variant('skeleton', 1.75, null, (r) => {
    crown(r, 1.82, 0.17, 0x60ff90);
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.1), mat(0x3a0a4a, { side: THREE.DoubleSide }));
    cape.position.set(0, 1.0, -0.14); r.add(cape);
  }),
  bruja_pantano: witch,
  leviatan,
  dragon_rojo: () => dragon({ s: 1.0, c1: 0xa3161a, c2: 0xe8a060, c3: 0x3a0a08, wing: 0xc0302a, eye: 0xffd040 }),
  fosa_diablillo: imp,
  fosa_escupefuego: spitter,
  fosa_espiritu: fireSpirit,
  fosa_bruto: () => variant('golem', 1.1, lavaRecolor),
  fosa_ignaroth: ignaroth,
  dragon_negro: () => dragon({ s: 1.2, c1: 0x1a1620, c2: 0x4a3a5a, c3: 0x0a080c, wing: 0x4a2a6a, eye: 0xc060ff }),
});

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
