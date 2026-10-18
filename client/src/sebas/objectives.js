/**
 * SEBAS PRESENT — «La Cruzada» · una forma de jugar distinta en cada capítulo
 *
 *   c1 Llegada ........ ESCAPA: coge tu maleta y sácala por la salida (con maleta no disparas).
 *   c2 Rel. públicas .. CONGA: arrastra turistas a TU bar antes que los relaciones públicas rivales.
 *   c3 Chocolate ...... VENDE: quédate junto a los clientes para venderles, sin que te vea la patrulla.
 *   c4 Los barcos ..... CARGA: lleva cajas al yate que espera antes de que zarpe.
 *   c5 Brasil ......... SAMBA: lleva a Ella hasta el final de la calle; golpear al ritmo hace el doble.
 *   c6 San Isidro ..... DEFIENDE: que no destrocen la casa. Luego Federico huye con la caja: atrápalo.
 *   c7 El plató ....... EN DIRECTO: cada ronda la Diva impone una regla nueva; cuida la audiencia.
 *
 * Cada modo: { setup(), update(dt), text(), target(e) → a dónde va un enemigo, done, fail }
 * Lo usa mode.js; aquí no se toca el DOM salvo con las ayudas que llegan en `api`.
 */
import * as THREE from 'three';

// ------------------------------------------------------------
// Piezas comunes
// ------------------------------------------------------------
function zone(api, x, z, r, color) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r - 0.25, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.05; g.add(fill);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, 6, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 3; g.add(beam);
  g.position.set(x, 0, z);
  api.scene().add(g);
  return { g, x, z, r, ring, set(on) { g.visible = on; } };
}
function prop(kind) {
  const g = new THREE.Group();
  if (kind === 'maleta') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.3), new THREE.MeshLambertMaterial({ color: 0x8a2a1a, flatShading: true }));
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0x2a1a10 })); h.position.y = 0.3;
    g.add(b, h);
  } else if (kind === 'caja') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0xa07a48, flatShading: true })));
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.64), new THREE.MeshLambertMaterial({ color: 0x6a4a28 })); t.position.y = 0.2; g.add(t);
  }
  return g;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) < r;

/** Goteo de enemigos: mantiene `cap` vivos, uno nuevo cada `every` s. */
function trickle(api, st, dt, cap, every, kinds, spots) {
  const G = api.G();
  st.trT = (st.trT ?? 1.5) - dt;
  const alive = G.enemies.filter(e => !e.dead && !e.boss).length;
  if (st.trT <= 0 && alive < cap) {
    st.trT = every * rnd(0.7, 1.3);
    let tot = kinds.reduce((n, k) => n + k[1], 0), r = Math.random() * tot, kind = kinds[0][0];
    for (const [k, w] of kinds) { if ((r -= w) <= 0) { kind = k; break; } }
    const pool = spots || G.arena.spawns;
    // lejos del jugador
    const far = pool.filter(s => Math.hypot(s.x - G.p.x, s.z - G.p.z) > 9);
    const sp = (far.length ? far : pool)[Math.floor(Math.random() * (far.length ? far.length : pool.length))];
    return api.spawnEnemy(kind, { x: sp.x + rnd(-1.5, 1.5), z: sp.z + rnd(-1, 1) });
  }
  return null;
}

// Coger/soltar cosas (maleta, cajas): van sobre la cabeza de Sebas
function carry(api, kind) {
  const G = api.G();
  const m = prop(kind); m.position.y = 2.05; m.scale.setScalar(1.1);
  G.p.g.add(m);
  G.carry = { kind, m };
  api.sfx('pickup');
}
function dropCarry(api, place = true) {
  const G = api.G(); if (!G.carry) return null;
  G.p.g.remove(G.carry.m);
  let w = null;
  if (place) { w = prop(G.carry.kind); w.position.set(G.p.x, 0.3, G.p.z); api.scene().add(w); }
  const k = G.carry.kind; G.carry = null;
  return w ? { kind: k, m: w, x: G.p.x, z: G.p.z } : null;
}

// ------------------------------------------------------------
// c1 · ESCAPA DEL AEROPUERTO
// ------------------------------------------------------------
function escape(api) {
  const st = {};
  const M = {
    intro: 'Tu maleta está en la cinta de equipajes. Cógela y sácala por la salida de taxis.',
    start: { x: 0, z: 4 },
    setup() {
      const G = api.G();
      st.bag = { kind: 'maleta', m: prop('maleta'), x: -16, z: -11 };
      st.bag.m.position.set(st.bag.x, 0.3, st.bag.z); api.scene().add(st.bag.m);
      st.zBag = zone(api, -16, -11, 1.6, 0xffd040);
      st.zExit = zone(api, 17, 12, 2.4, 0x40ff80);
      G.marks = [{ x: -16, z: -11, text: '🧳 Tu maleta' }, { x: 17, z: 12, text: '🚕 SALIDA' }];
    },
    update(dt) {
      const G = api.G(), p = G.p;
      st.zBag.set(!G.carry && !!st.bag);
      if (st.bag) { st.zBag.g.position.set(st.bag.x, 0, st.bag.z); G.marks[0].x = st.bag.x; G.marks[0].z = st.bag.z; }
      if (!G.carry && st.bag && near(p, st.bag.x, st.bag.z, 1.4)) {
        api.scene().remove(st.bag.m); st.bag = null; carry(api, 'maleta');
        api.toast('🧳 ¡Maleta! Con ella encima no puedes disparar. Si te pegan fuerte, se cae.', 2800);
      }
      G.target = G.carry ? { x: 17, z: 12 } : st.bag ? { x: st.bag.x, z: st.bag.z } : null;
      if (G.carry && near(p, 17, 12, 2.4)) {
        dropCarry(api, false); st.zExit.set(false); st.zBag.set(false); G.marks = []; G.target = null;
        M.done = true; api.banner('¡FUERA DEL AEROPUERTO!', 'Pero alguien te espera en la parada…');
      }
      if (!M.done) trickle(api, st, dt, 4 + Math.min(2, Math.floor(G.time / 30)), 2.6, [['thug', 1]]);
    },
    onHurt(dmg) {
      const G = api.G();
      if (G.carry && dmg >= 12) { st.bag = dropCarry(api, true); api.toast('¡Se te ha caído la maleta!', 1600); }
    },
    text() { const G = api.G(); return M.done ? '' : G.carry ? '🧳 Lleva la maleta a la SALIDA 🚕' : '🧳 Recoge tu maleta'; },
    bossAt: { x: 15, z: 10 },
    noShoot: () => !!api.G().carry,
    speed: () => api.G().carry ? 0.78 : 1,
  };
  return M;
}

// ------------------------------------------------------------
// c2 · LA CONGA DE TURISTAS
// ------------------------------------------------------------
const OUR_BAR = { x: -17, z: -12.6 }, RIVAL_BAR = { x: 16, z: -12.6 };
function conga(api) {
  const st = { tourists: [], ours: 0, theirs: 0, spawnT: 0 };
  const GOAL = 10;
  const M = {
    intro: `Lleva ${GOAL} turistas al MOJITO BAR. Pasa cerca de ellos y te siguen en conga. Los relaciones públicas de Gominola te los quieren robar: si llegan ${GOAL} al KARAOKE, pierdes.`,
    start: { x: 0, z: 4 },
    setup() {
      const G = api.G();
      zone(api, OUR_BAR.x, OUR_BAR.z, 2.4, 0x40ff80);
      zone(api, RIVAL_BAR.x, RIVAL_BAR.z, 2.4, 0xff4060);
      G.marks = [{ x: OUR_BAR.x, z: OUR_BAR.z, text: '🍹 TU BAR' }, { x: RIVAL_BAR.x, z: RIVAL_BAR.z, text: '🎤 Bar rival' }];
    },
    update(dt) {
      const G = api.G(), p = G.p;
      st.spawnT -= dt;
      if (st.spawnT <= 0 && st.tourists.length < 9) {
        st.spawnT = rnd(1.6, 2.6);
        const x = rnd(-G.arena.hw + 2, G.arena.hw - 2);
        const a = api.makeActor(null, { team: 'npc', model: api.pickModel(['m33', 'm34', 'm39', 'f36', 'f40', 'm43']), tint: { hue: 0.98, sat: 1.4, val: 1.15 }, x, z: G.arena.hd - 1, hp: 1 });
        const t = { a, lead: null, wx: rnd(-14, 14), wz: rnd(-6, 10), slot: 0 };
        st.tourists.push(t); G.neutrals.push(t);
        api.say(a, ['¿Happy hour?', 'Me pica todo del sol.', 'Two beers, please!', '¿Dónde está la fiesta?', 'Ich will Sangría!'][Math.floor(Math.random() * 5)], 1800);
      }
      // quién sigue a quién
      const lineOf = (lead) => st.tourists.filter(t => t.lead === lead);
      for (const t of st.tourists) {
        const a = t.a;
        if (t.lead && t.lead.dead) t.lead = null;
        if (!t.lead) {
          if (near(a, p.x, p.z, 1.8) && lineOf(p).length < 4) { t.lead = p; api.sfx('pickup'); api.say(a, '🍹 ¡Vamos!', 900); }
          const dx = t.wx - a.x, dz = t.wz - a.z, d = Math.hypot(dx, dz);
          if (d < 0.6) { t.wx = rnd(-14, 14); t.wz = rnd(-6, 10); }
          else { a.x += dx / d * 1.1 * dt; a.z += dz / d * 1.1 * dt; a.yaw = Math.atan2(dx, dz); api.play(a, 'walk', { ts: 0.8 }); }
        } else {
          const line = lineOf(t.lead), k = line.indexOf(t);
          const lead = k === 0 ? t.lead : line[k - 1].a;
          const d = api.dist(a, lead);
          if (d > 1.3) { a.x += (lead.x - a.x) / d * Math.min(7, d * 3) * dt; a.z += (lead.z - a.z) / d * Math.min(7, d * 3) * dt; a.yaw = Math.atan2(lead.x - a.x, lead.z - a.z); api.play(a, d > 2.5 ? 'run' : 'walk'); }
          else api.play(a, 'idle4');
        }
        api.collide(a, 0.35);
      }
      // ¿llegan a un bar?
      for (const t of [...st.tourists]) {
        const ourB = t.lead === p && near(p, OUR_BAR.x, OUR_BAR.z, 2.6);
        const theirB = t.lead && t.lead !== p && near(t.lead, RIVAL_BAR.x, RIVAL_BAR.z, 2.6);
        if (ourB || theirB) {
          if (ourB) { st.ours++; G.score += 250; api.floatText(t.a.x, 2.4, t.a.z, '+1 🍹', '#8fe08f'); api.sfx('pickup'); }
          else { st.theirs++; api.floatText(t.a.x, 2.4, t.a.z, '+1 🎤', '#ff8080'); }
          api.removeActor(t.a); t.a.bubble?.remove();
          st.tourists.splice(st.tourists.indexOf(t), 1); G.neutrals.splice(G.neutrals.indexOf(t), 1);
        }
      }
      // los rivales roban: un turista que toca a un rival se cambia de conga
      for (const e of G.enemies) {
        if (e.dead || e.role !== 'rival') continue;
        for (const t of st.tourists) if (t.lead !== e && near(t.a, e.x, e.z, 1.2) && lineOf(e).length < 3) { t.lead = e; api.say(e, '¡Este es mío! Karaoke, amigo.', 1300); }
      }
      if (st.ours >= GOAL && !M.done) { M.done = true; for (const t of st.tourists) t.lead = null; G.target = null; api.banner('¡BAR LLENO!', 'Gominola viene a por ti en persona'); }
      if (st.theirs >= GOAL && !M.done) M.fail = 'El karaoke se ha llenado antes que tu bar. Gominola se ríe en tu cara.';
      G.target = lineOf(p).length ? OUR_BAR : null;
      if (!M.done) {
        const s = trickle(api, st, dt, 3 + Math.min(2, Math.floor(G.time / 40)), 3.2, [['thug', 3], ['gunner', 1]], [{ x: RIVAL_BAR.x, z: RIVAL_BAR.z + 2 }, { x: G.arena.hw - 2, z: 0 }]);
        if (s && s.kind === 'thug') { s.role = 'rival'; s.speed = 3.6; }
      }
    },
    // los rivales van a por turistas libres o a por tu conga; solo pelean si estás muy cerca
    target(e) {
      if (e.role !== 'rival') return null;
      const G = api.G(), p = G.p;
      if (api.dist(e, p) < 2.6) return null;
      const mine = st.tourists.filter(t => t.lead === e);
      if (mine.length >= 2) return { x: RIVAL_BAR.x, z: RIVAL_BAR.z };
      let best = null, bd = 1e9;
      for (const t of st.tourists) { if (t.lead === e) continue; const d = api.dist(e, t.a) + (t.lead === p ? -4 : 0); if (d < bd) { bd = d; best = t.a; } }
      return best ? { x: best.x, z: best.z } : { x: RIVAL_BAR.x, z: RIVAL_BAR.z };
    },
    onKill(e) { for (const t of st.tourists) if (t.lead === e) t.lead = null; },
    text() { return M.done ? '' : `🍹 Tu bar ${st.ours}/${GOAL}   ·   🎤 Rival ${st.theirs}/${GOAL}`; },
    bossAt: { x: RIVAL_BAR.x, z: RIVAL_BAR.z + 3 },
  };
  return M;
}

// ------------------------------------------------------------
// c3 · VENDE CHOCOLATE SIN QUE TE VEA LA PATRULLA
// ------------------------------------------------------------
function sell(api) {
  const st = { buyers: [], sold: 0, spawnT: 1, patrols: [], alarmT: 0, sellT: 0, cur: null };
  const GOAL = 10;
  const M = {
    intro: `Vende ${GOAL} chocolates. Los clientes con 🍫 quieren comprar: quédate a su lado hasta llenar el círculo. Si una patrulla te ve vendiendo (su cono de luz), salta la alarma.`,
    start: { x: 0, z: 6 },
    setup() {
      const G = api.G();
      for (const [z, x0] of [[-3.5, -18], [8.5, 18]]) {
        const e = api.spawnEnemy('thug', { x: x0, z }, { model: 'sheriff_n_01', tint: { val: 0.85 } });
        e.role = 'patrol'; e.speed = 2.2; e.pz = z; e.dir = x0 < 0 ? 1 : -1; e.calm = true;
        // cono de visión: abanico de 7 m y ±26° hacia donde mira
        const fan = new THREE.Mesh(new THREE.CircleGeometry(7, 20, -Math.PI / 2 - 0.45, 0.9), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        fan.rotation.x = -Math.PI / 2;
        const cone = new THREE.Group(); cone.add(fan); cone.position.y = 0.07; api.scene().add(cone); e.cone = cone; e.fan = fan;
        st.patrols.push(e);
      }
      st.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: 0x8fe08f, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      st.ring.rotation.x = -Math.PI / 2; st.ring.position.y = 0.08; st.ring.visible = false; api.scene().add(st.ring);
    },
    update(dt) {
      const G = api.G(), p = G.p;
      st.spawnT -= dt;
      if (st.spawnT <= 0 && st.buyers.length < 4) {
        st.spawnT = rnd(2, 3.5);
        const x = Math.random() < 0.5 ? -G.arena.hw + 1 : G.arena.hw - 1;
        const a = api.makeActor(null, { team: 'npc', model: api.pickModel(['f36', 'f40', 'm34', 'm43', 'f43']), tint: { hue: Math.random(), sat: 1.2 }, x, z: rnd(-1, 10), hp: 1 });
        const b = { a, tx: rnd(-16, 16), tz: rnd(-1, 10), wait: rnd(9, 14), want: true };
        st.buyers.push(b); G.neutrals.push(b);
        api.say(a, '🍫?', 3000);
      }
      // clientes: van a un sitio y esperan; si tardas se van
      for (const b of [...st.buyers]) {
        const a = b.a, dx = b.tx - a.x, dz = b.tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.4) { a.x += dx / d * 1.6 * dt; a.z += dz / d * 1.6 * dt; a.yaw = Math.atan2(dx, dz); api.play(a, 'walk'); }
        else { b.wait -= dt; api.play(a, 'idle2'); if (b.want && Math.random() < 0.004) api.say(a, ['¿Es de Marruecos de verdad?', '¿Aceptas pesetas?', '¿Tiene almendras?', 'Uno para mi suegra.'][Math.floor(Math.random() * 4)], 1600); }
        if (b.wait <= 0 && b.want) { b.want = false; b.tx = a.x < 0 ? -G.arena.hw - 3 : G.arena.hw + 3; b.tz = a.z; api.say(a, 'Bah, me voy.', 1200); }
        if (!b.want && Math.abs(a.x) > G.arena.hw + 1.5) { api.removeActor(a); a.bubble?.remove(); st.buyers.splice(st.buyers.indexOf(b), 1); G.neutrals.splice(G.neutrals.indexOf(b), 1); }
      }
      // vender: cerca de un cliente que quiere, y poco movimiento
      const cand = st.buyers.find(b => b.want && near(b.a, p.x, p.z, 1.9));
      if (cand) {
        if (st.cur !== cand) { st.cur = cand; st.sellT = 0; }
        st.sellT += dt;
        st.ring.visible = true; st.ring.position.set(cand.a.x, 0.08, cand.a.z);
        st.ring.geometry.dispose(); st.ring.geometry = new THREE.RingGeometry(0.9, 1.15, 32, 1, 0, Math.PI * 2 * Math.min(1, st.sellT / 1.4));
        if (st.sellT >= 1.4) {
          st.sold++; G.score += 300; cand.want = false; cand.tx = cand.a.x < 0 ? -G.arena.hw - 3 : G.arena.hw + 3;
          api.floatText(cand.a.x, 2.4, cand.a.z, '+1 🍫  +100 pts', '#ffe0a0'); api.sfx('pickup'); api.say(cand.a, '¡Riquísimo!', 1200);
          st.cur = null; st.sellT = 0; st.ring.visible = false;
        }
      } else { st.cur = null; st.sellT = 0; st.ring.visible = false; }
      // patrullas: van y vienen; si te ven vendiendo → alarma
      st.alarmT -= dt;
      for (const e of st.patrols) {
        if (e.dead) { e.cone && (e.cone.visible = false); continue; }
        e.cone.position.set(e.x, 0.07, e.z); e.cone.rotation.y = e.yaw;
        const ang = Math.atan2(p.x - e.x, p.z - e.z), dA = Math.abs(((ang - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const seen = api.dist(e, p) < 7 && dA < 0.45;
        e.fan.material.color.setHex(seen ? 0xff4040 : 0xffe080);
        if (seen && st.cur && st.alarmT <= 0) {
          st.alarmT = 8; st.cur.want = false; st.cur.tx = st.cur.a.x < 0 ? -G.arena.hw - 3 : G.arena.hw + 3; st.cur = null; st.sellT = 0; st.ring.visible = false;
          api.banner('¡ALARMA!', '¡Te han visto vendiendo!', true, 1400); api.say(e, '¡Eh, tú! ¡Venta ambulante!', 1600); api.sfx('bt');
          e.calm = false; setTimeout(() => { e.calm = true; }, 7000);
          for (let i = 0; i < 3; i++) api.spawnEnemy(i ? 'thug' : 'gunner', { x: e.x + rnd(-3, 3), z: e.z + rnd(-2, 2) });
        }
      }
      if (st.sold >= GOAL && !M.done) {
        M.done = true; st.ring.visible = false;
        for (const e of st.patrols) { e.cone && api.scene().remove(e.cone); e.calm = false; }
        api.banner('¡TODO VENDIDO!', 'El inspector viene a «requisar» la caja'); G.target = null;
      }
      const tgt = st.buyers.find(b => b.want);
      G.target = !M.done && tgt ? { x: tgt.a.x, z: tgt.a.z } : null;
      if (!M.done) trickle(api, st, dt, 2, 6, [['thug', 2], ['gunner', 1]]);
    },
    target(e) {
      if (e.role !== 'patrol' || !e.calm) return null;
      // ronda: ir y venir por su línea
      const G = api.G();
      if (Math.abs(e.x) > G.arena.hw - 3) e.dir = -Math.sign(e.x);
      return { x: e.x + e.dir * 3, z: e.pz, walk: true };
    },
    text() { return M.done ? '' : `🍫 Vendidos ${st.sold}/${GOAL}   ·   que no te vean las patrullas 🔦`; },
    bossAt: { x: 0, z: -8 },
  };
  return M;
}

// ------------------------------------------------------------
// c4 · CARGA LOS YATES
// ------------------------------------------------------------
const BOATS = [{ x: -12, z: -13.6, name: 'el yate «Pepita»' }, { x: 10, z: -13.6, name: 'el yate «Dólar Azul»' }, { x: -4, z: 13.6, name: 'el yate «Mi Segunda Esposa»' }];
function cargo(api) {
  const st = { served: 0, boat: 0, need: 3, have: 0, timer: 50, pile: { x: 2, z: 0 } };
  const GOAL = 3;
  const M = {
    intro: 'Coge cajas del montón 📦 (centro) y llévalas al yate que espera ⛵. Cada yate quiere 3 cajas y zarpa cuando se le acaba la paciencia. Con una caja encima no disparas.',
    start: { x: 2, z: 4 },
    setup() {
      const G = api.G();
      st.zPile = zone(api, st.pile.x, st.pile.z, 1.8, 0xffd040);
      for (let i = 0; i < 5; i++) { const c = prop('caja'); c.position.set(st.pile.x + (i % 3 - 1) * 0.8, 0.3 + Math.floor(i / 3) * 0.6, st.pile.z + (i % 2) * 0.5 - 0.25); api.scene().add(c); }
      st.zBoat = zone(api, BOATS[0].x, BOATS[0].z, 2.2, 0x40c0ff);
      G.marks = [{ x: st.pile.x, z: st.pile.z, text: '📦 Cajas' }, { x: BOATS[0].x, z: BOATS[0].z, text: '⛵ Yate' }];
      api.banner('⛵ ' + BOATS[0].name, 'quiere 3 cajas');
    },
    update(dt) {
      const G = api.G(), p = G.p;
      const B = BOATS[st.boat % BOATS.length];
      st.zBoat.g.position.set(B.x, 0, B.z); G.marks[1].x = B.x; G.marks[1].z = B.z;
      if (!G.carry && near(p, st.pile.x, st.pile.z, 1.9)) carry(api, 'caja');
      if (G.carry && near(p, B.x, B.z, 2.4)) {
        dropCarry(api, false); st.have++; G.score += 150;
        api.floatText(p.x, 2.5, p.z, `📦 ${st.have}/${st.need}`, '#a0e0ff'); api.sfx('pickup');
        if (st.have >= st.need) {
          st.served++; G.score += 600 + Math.round(st.timer * 10);
          api.banner('¡VENDIDO!', `${B.name} paga en efectivo`, false, 1500);
          st.boat++; st.have = 0; st.timer = Math.max(36, 50 - st.served * 6);
          if (st.served < GOAL) setTimeout(() => api.G() && api.banner('⛵ ' + BOATS[st.boat % BOATS.length].name, 'quiere 3 cajas'), 1600);
        }
      }
      st.timer -= dt;
      if (st.timer <= 0 && !M.done) {
        api.banner('¡ZARPÓ SIN PAGAR!', `${B.name} se ha cansado de esperar`, true, 1600);
        st.boat++; st.have = 0; st.timer = 50;
      }
      G.target = G.carry ? { x: B.x, z: B.z } : st.pile;
      if (st.served >= GOAL && !M.done) { M.done = true; G.target = null; G.marks = []; st.zBoat.set(false); st.zPile.set(false); api.banner('¡TRES YATES SERVIDOS!', 'El dueño del puerto está muy enfadado'); }
      if (!M.done) trickle(api, st, dt, 4 + Math.min(2, st.served), 2.8, [['thug', 3], ['gunner', 2], ['tank', st.served ? 1 : 0]]);
    },
    // los de seguridad van a por el que lleva la caja… y si no, a los yates
    text() { return M.done ? '' : `⛵ Yates ${st.served}/${GOAL}  ·  📦 ${st.have}/${st.need}  ·  ⏳ ${Math.max(0, Math.ceil(st.timer))} s`; },
    onHurt(dmg) { const G = api.G(); if (G.carry && dmg >= 14) { const w = dropCarry(api, true); if (w) setTimeout(() => api.scene()?.remove(w.m), 3000); api.toast('📦 ¡Se te cayó la caja al agua!', 1500); } },
    bossAt: { x: 0, z: -10 },
    noShoot: () => !!api.G().carry,
    speed: () => api.G().carry ? 0.82 : 1,
  };
  return M;
}

// ------------------------------------------------------------
// c5 · SAMBA HASTA EL FINAL DE LA CALLE
// ------------------------------------------------------------
function samba(api) {
  const st = { beat: 0, ella: null, grab: null, prog: 0 };
  const GOAL_X = 18;
  const M = {
    intro: 'Lleva a Ella hasta el final de la calle (➡ derecha). Te sigue de la mano. Si un cuñado la agarra, se la lleva hacia atrás: ¡pégale! Golpea AL RITMO de la samba (cuando late el círculo) y harás el doble de daño.',
    start: { x: -18, z: 0 },
    setup() {
      const G = api.G();
      const a = api.makeActor('ella', { team: 'npc', x: -19.5, z: 1.2, hp: 1 });
      st.ella = { a }; G.neutrals.push(st.ella);
      st.goal = zone(api, GOAL_X + 1, 0, 3, 0x40ff80);
      G.marks = [{ x: GOAL_X + 1, z: 0, text: '🏁 Final de la calle' }];
      st.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      st.pulse.rotation.x = -Math.PI / 2; st.pulse.position.y = 0.07; api.scene().add(st.pulse);
      G.beat = () => { const ph = (st.beat % 0.5) / 0.5; return ph < 0.18 || ph > 0.88; };   // ¿estás en el golpe?
    },
    update(dt) {
      const G = api.G(), p = G.p, E = st.ella.a;
      st.beat += dt;
      const ph = (st.beat % 0.5) / 0.5;
      st.pulse.position.set(p.x, 0.07, p.z); st.pulse.scale.setScalar(1 + (1 - ph) * 0.5); st.pulse.material.opacity = G.beat() ? 0.95 : 0.25;
      if (Math.floor(st.beat / 0.5) !== st.lastB) { st.lastB = Math.floor(st.beat / 0.5); if (st.lastB % 2 === 0) api.sfx('click'); }
      // ¿la tiene un cuñado?
      if (st.grab && (st.grab.dead || st.grab.status)) { st.grab = null; api.say(E, '¡Gracias, gringo!', 1000); }
      if (!st.grab) {
        for (const e of G.enemies) if (!e.dead && !e.boss && e.role === 'cunhado' && api.dist(e, E) < 1.2) { st.grab = e; api.say(e, '¡A casa, hermanita!', 1400); api.say(E, '¡SEBAS!', 1400); break; }
      }
      if (st.grab) {
        // la arrastra hacia atrás
        const g = st.grab; g.x -= 2.2 * dt; E.x = g.x - 0.8; E.z = g.z; E.yaw = Math.PI / 2; api.play(E, 'react', { ts: 0.6 });
      } else {
        const d = api.dist(E, p);
        if (d > 1.6) { E.x += (p.x - E.x) / d * Math.min(6.5, d * 3) * dt; E.z += (p.z - E.z) / d * Math.min(6.5, d * 3) * dt; E.yaw = Math.atan2(p.x - E.x, p.z - E.z); api.play(E, d > 3 ? 'run' : 'walk'); }
        else api.play(E, 'idle3');
      }
      api.collide(E, 0.35);
      st.prog = Math.max(0, Math.min(1, (E.x + 19) / (GOAL_X + 19)));
      if (E.x > GOAL_X - 1 && !M.done) { M.done = true; G.target = null; G.marks = []; api.banner('¡FINAL DE LA CALLE!', 'Los tres hermanos te cierran el paso'); api.say(E, '¡Lo hiciste, gringo!', 2000); }
      G.target = st.grab ? { x: st.grab.x, z: st.grab.z } : M.done ? null : { x: GOAL_X + 1, z: 0 };
      if (!M.done) {
        const s = trickle(api, st, dt, 5, 2.2, [['thug', 4], ['tank', 1]], [{ x: p.x + 14, z: -12 }, { x: p.x + 14, z: 12 }, { x: Math.min(20, p.x + 18), z: 0 }, { x: p.x + 8, z: 13 }]);
        if (s && s.kind === 'thug' && Math.random() < 0.6) { s.role = 'cunhado'; s.speed = 3.5; }
      }
    },
    target(e) {
      if (e.role !== 'cunhado' || st.grab || M.done) return null;
      const E = st.ella.a; if (api.dist(e, api.G().p) < 2.2) return null;
      return { x: E.x, z: E.z };
    },
    dmgMul() { return api.G().beat?.() ? 2 : 1; },
    text() { return M.done ? '' : `💃 Calle ${Math.round(st.prog * 100)} %   ·   ${st.grab ? '¡LA HAN AGARRADO!' : 'golpea al ritmo 🥁'}`; },
    bossAt: { x: GOAL_X - 2, z: 0 },
  };
  return M;
}

// ------------------------------------------------------------
// c6 · DEFIENDE LA CASA (y luego Federico huye)
// ------------------------------------------------------------
function defend(api) {
  const st = { hp: 500, max: 500, hitT: 0 };
  const H = { x: 0, z: -9 };
  const M = {
    intro: 'Las empresas rivales vienen a destrozar la casa de San Isidro. Que no llegue a cero su barra 🏠. Los que van a por la casa no te atacan a ti: ¡aprovecha!',
    start: { x: 0, z: -4 },
    usesWaves: true,
    setup() {
      const G = api.G();
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), new THREE.MeshLambertMaterial({ color: 0xf0ece2, flatShading: true })); wall.position.y = 1.3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.4, 4), new THREE.MeshLambertMaterial({ color: 0xb04a2a, flatShading: true })); roof.position.y = 3.3; roof.rotation.y = Math.PI / 4;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), new THREE.MeshLambertMaterial({ color: 0x2f6a3a })); door.position.set(0, 0.8, 1.52);
      g.add(wall, roof, door); g.position.set(H.x, 0, H.z); api.scene().add(g); st.house = g;
      G.arena.boxes.push({ x: H.x, z: H.z, hx: 2, hz: 1.5 });
      G.marks = [{ x: H.x, z: H.z, y: 4.4, text: '🏠 La casa', bar: () => st.hp / st.max }];
    },
    update(dt) {
      st.hitT -= dt;
      if (st.hp <= 0 && !M.fail) M.fail = 'Han destrozado la casa. Ella está muy, muy enfadada contigo.';
    },
    target(e) {
      if (e.kind === 'gunner' || e.boss) return null;
      const G = api.G();
      if (api.dist(e, G.p) < 2.4) return null;
      if (!e.goHouse) e.goHouse = Math.random() < 0.55 ? 1 : -1;
      if (e.goHouse < 0) return null;
      return { x: H.x + Math.sign(e.x - H.x) * 2.3, z: H.z + 1.8, hit: (en, dmg) => { st.hp = Math.max(0, st.hp - dmg); if (st.hitT <= 0) { st.hitT = 0.6; api.floatText(H.x, 3, H.z, `🏠 -${dmg}`, '#ff8080'); } } };
    },
    text() { return `🏠 Casa ${Math.ceil(st.hp)}/${st.max}`; },
    bossAt: { x: 0, z: -5 },
  };
  return M;
}

// ------------------------------------------------------------
// c7 · EN DIRECTO (reglas de la Diva)
// ------------------------------------------------------------
const RULES = [
  { id: 'punos', t: 'RONDA 1: ¡SOLO PUÑETAZOS!', s: 'Disparar baja la audiencia', diva: '¡Aquí se pelea con las manos, como en los buenos tiempos!' },
  { id: 'foco', t: 'RONDA 2: ¡PELEA EN EL FOCO!', s: 'Dentro de la luz pegas ×1,5; fuera, la mitad', diva: '¡Si no sales en el foco, no existes, cariño!' },
  { id: 'confeti', t: 'RONDA 3: ¡SUELO DE CONFETI!', s: 'Resbala muchísimo. Mucho ánimo.', diva: '¡Confeti para todos! ¡Que nadie se quede de pie!' },
];
function show(api) {
  const st = { aud: 60, rule: null, spot: null, sx: 0, sz: 0, tx: 0, tz: 0 };
  const M = {
    intro: 'Estás en directo. Cada ronda la Diva cambia las reglas. La audiencia 📺 multiplica tus puntos: los combos la suben; aburrir a la gente la baja.',
    start: { x: 0, z: 6 },
    usesWaves: true,
    setup() {
      st.spot = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
      st.spot.rotation.x = -Math.PI / 2; st.spot.position.y = 0.06; st.spot.visible = false; api.scene().add(st.spot);
    },
    onWave(w) {
      const G = api.G(), R = RULES[Math.min(w, RULES.length - 1)];
      st.rule = R.id;
      api.banner(R.t, R.s, true, 2600);
      const diva = G.enemies.find(e => e.who === 'diva');
      if (!diva) api.toast('📢 Diva: «' + R.diva + '»', 3000);
      st.spot.visible = R.id === 'foco';
      G.slide = R.id === 'confeti';
    },
    update(dt) {
      const G = api.G(), p = G.p;
      st.aud = Math.max(5, Math.min(100, st.aud - dt * 1.2 + (G.combo >= 5 ? dt * 2.5 : 0)));
      G.scoreMul = 0.5 + st.aud / 100 * 1.5;
      if (st.rule === 'foco') {
        if (Math.hypot(st.tx - st.sx, st.tz - st.sz) < 0.5) { st.tx = rnd(-14, 14); st.tz = rnd(-9, 9); }
        const d = Math.hypot(st.tx - st.sx, st.tz - st.sz); st.sx += (st.tx - st.sx) / d * 2.4 * dt; st.sz += (st.tz - st.sz) / d * 2.4 * dt;
        st.spot.position.set(st.sx, 0.06, st.sz);
        if (Math.hypot(p.x - st.sx, p.z - st.sz) < 4) st.aud = Math.min(100, st.aud + dt * 3);
        G.target = { x: st.sx, z: st.sz };
      } else G.target = null;
      if (G.phase === 'boss') { st.spot.visible = false; G.slide = false; G.target = null; }
    },
    onShoot() { if (st.rule === 'punos' && api.G().phase !== 'boss') { st.aud = Math.max(5, st.aud - 8); api.floatText(api.G().p.x, 2.6, api.G().p.z, '📺 ¡Abucheos!', '#ff8080'); } },
    onKill() { st.aud = Math.min(100, st.aud + 4); },
    dmgMul() {
      const G = api.G();
      if (st.rule !== 'foco' || G.phase === 'boss') return 1;
      return Math.hypot(G.p.x - st.sx, G.p.z - st.sz) < 4 ? 1.5 : 0.5;
    },
    text() { const G = api.G(); return `📺 Audiencia ${Math.round(st.aud)} %  ·  puntos ×${(G.scoreMul || 1).toFixed(1)}`; },
    bossAt: { x: 0, z: -10 },
  };
  return M;
}

const MODES = { c1: escape, c2: conga, c3: sell, c4: cargo, c5: samba, c6: defend, c7: show };
export function createObjective(chId, api) { return MODES[chId] ? MODES[chId](api) : null; }
