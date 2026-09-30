/**
 * SebasPresent — Jefes (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Cada jefe vive en su guarida, tiene
 * sus ataques y una MECÁNICA que obliga a jugar con estrategia (como OSRS):
 *
 *   Rey Yeti Grom        → solo pega cuerpo a cuerpo y es lento: TRÁBALO detrás
 *                          de las rocas y dispárale/hechízalo. Pisotón en área.
 *   Coloso de Obsidiana  → casi inmune a melé; lento → rocas. Hace caer
 *                          piedras donde estás: muévete aunque estés trabado.
 *   Reina Sekhet         → escupe veneno a distancia (Protección contra
 *                          proyectiles) y deja charcos de veneno: no te quedes.
 *   Chona, la Bruja del Páramo → magia (Protección contra magia), se teletransporta y
 *                          lanza maldiciones en área a tus pies.
 *   Leviatán             → cambia de estilo: VERDE = proyectiles, AZUL = magia.
 *                          Cambia tu protección según su color. Remolinos.
 *   Rey Esqueleto        → melé + magia, te drena la plegaria y levanta púas.
 *   Vermithrax (rojo)    → garras + aliento de fuego (magia) + lluvia de fuego.
 *   Nidhogg (negro)      → todo lo anterior y coletazo alrededor. Rocas para
 *                          trabarlo y que solo te alcance el fuego.
 *
 * Cada uno suelta SU pieza de dragón con probabilidad 1/20.
 *
 * Ataques:   { style: 'melee'|'ranged'|'magic', range (m), max (golpe máx.),
 *              every (ms entre ataques) }
 * Especiales (se turnan cada `specialEvery` ms):
 *   aoe_target  → círculos en el suelo donde estás (y cerca); caen tras `delay`.
 *   aoe_self    → onda alrededor del jefe (aléjate).
 *   pool        → charcos que dañan cada segundo mientras estés dentro.
 *   teleport    → el jefe salta a otro punto de la guarida.
 *   drain       → te quita la mitad de la plegaria.
 *   switch      → cambia de estilo (solo el Leviatán).
 * Rocas: obstáculos circulares { x, z, r } — el jefe NO las atraviesa.
 */

export const BOSS_TICK_MS = 350;          // ritmo mínimo del "cerebro" del jefe
export const BOSS_MOVE_SPEED = 2.2;       // m/s
export const BOSS_EMPTY_RESET_MS = 25_000; // sin nadie en la guarida → se cura y vuelve

export const BOSSES = {
  rey_yeti: {
    name: 'Rey Yeti Grom', title: 'Señor de las Cumbres', x: 480, z: -1900, lairR: 26, bodyR: 1.6,
    color: '#9fe3ff', drop: 'helm_dragon', dropName: 'Yelmo de dragón',
    stats: { hp: 260, att: 62, str: 60, def: 45, speed: 5, range: 3.2 },
    attacks: [{ style: 'melee', range: 3.4, max: 20, every: 3000 }],
    specialEvery: 9000,
    specials: [
      { kind: 'aoe_self', r: 6, delay: 2000, dmg: 18, name: '¡El Rey Yeti levanta los puños! (aléjate)' },
    ],
    rocks: [{ x: 468, z: -1888, r: 2.2 }, { x: 494, z: -1914, r: 2.4 }, { x: 466, z: -1912, r: 2.0 }, { x: 496, z: -1886, r: 2.1 }],
    tip: 'Solo pega cuerpo a cuerpo y no atraviesa las rocas: pon una roca entre los dos y atácale a distancia.',
  },
  coloso_obsidiana: {
    name: 'Coloso de Obsidiana', title: 'Guardián de la Mina', x: 1330, z: -1560, lairR: 26, bodyR: 1.8,
    color: '#a36bff', drop: 'legs_dragon', dropName: 'Grebas de dragón',
    stats: { hp: 320, att: 60, str: 62, def: 70, speed: 6, range: 3.4 }, meleeResist: 0.5,
    attacks: [{ style: 'melee', range: 3.6, max: 22, every: 3600 }],
    specialEvery: 7000,
    specials: [
      { kind: 'aoe_target', count: 3, spread: 3.5, r: 2.4, delay: 2200, dmg: 16, name: '¡El techo tiembla! Caen piedras…' },
    ],
    rocks: [{ x: 1318, z: -1548, r: 2.3 }, { x: 1344, z: -1574, r: 2.3 }, { x: 1316, z: -1574, r: 2.0 }, { x: 1346, z: -1546, r: 2.2 }],
    tip: 'Las armas cuerpo a cuerpo apenas le hacen daño (−50 %). Trábalo en una roca y usa magia o flechas… y muévete cuando caigan piedras.',
  },
  reina_escorpion: {
    name: 'Reina Sekhet', title: 'Reina Escorpión', x: 1480, z: 400, lairR: 26, bodyR: 1.5,
    color: '#7ae05a', drop: 'boots_dragon', dropName: 'Botas de dragón',
    stats: { hp: 280, att: 64, str: 58, def: 50, speed: 4, range: 10 },
    attacks: [{ style: 'ranged', range: 11, max: 17, every: 2800 }, { style: 'melee', range: 3.2, max: 19, every: 2800 }],
    specialEvery: 8000,
    specials: [
      { kind: 'pool', count: 2, spread: 2.5, r: 2.2, delay: 900, dmg: 5, duration: 9000, name: 'La Reina escupe charcos de veneno.' },
    ],
    rocks: [],
    tip: 'Protección contra proyectiles y no te quedes quieto sobre los charcos verdes.',
  },
  bruja_pantano: {
    name: 'Chona', title: 'la Bruja del Páramo', x: -640, z: 760, lairR: 24, bodyR: 0.9,
    color: '#c070ff', drop: 'gloves_dragon', dropName: 'Guantes de dragón',
    stats: { hp: 240, att: 66, str: 60, def: 48, speed: 5, range: 11 },
    attacks: [{ style: 'magic', range: 12, max: 18, every: 3000 }],
    specialEvery: 7500,
    specials: [
      { kind: 'aoe_target', count: 1, spread: 0, r: 3.2, delay: 1800, dmg: 20, name: 'Chona te maldice: ¡sal del círculo!' },
      { kind: 'teleport', name: 'Chona desaparece entre la niebla…' },
    ],
    rocks: [],
    tip: 'Protección contra magia. Sal de los círculos morados y búscala cuando se teletransporte.',
  },
  leviatan: {
    name: 'Leviatán', title: 'Terror de las Mareas', x: -450, z: 1950, lairR: 26, bodyR: 2.0,
    color: '#4ac0ff', drop: 'shield_dragon', dropName: 'Escudo de dragón',
    stats: { hp: 300, att: 66, str: 60, def: 52, speed: 5, range: 12 }, stationary: true,
    attacks: [{ style: 'ranged', range: 14, max: 18, every: 2800 }, { style: 'magic', range: 14, max: 18, every: 2800 }],
    styleSwitch: true,
    specialEvery: 8000,
    specials: [
      { kind: 'switch', name: '¡El Leviatán cambia de color!' },
      { kind: 'aoe_target', count: 2, spread: 3, r: 2.6, delay: 2000, dmg: 16, name: 'Remolinos a tus pies…' },
    ],
    rocks: [],
    tip: 'VERDE = te dispara proyectiles, AZUL = magia. Cambia tu protección cada vez que cambie de color.',
  },
  rey_esqueleto: {
    name: 'Varkhul', title: 'el Rey Esqueleto', x: -1500, z: -440, lairR: 26, bodyR: 1.1,
    color: '#60ff90', drop: 'staff_dragomante', dropName: 'Bastón de Dragomante',
    stats: { hp: 320, att: 68, str: 64, def: 58, speed: 4, range: 3.2 },
    attacks: [{ style: 'melee', range: 3.4, max: 20, every: 2600 }, { style: 'magic', range: 10, max: 16, every: 3000 }],
    specialEvery: 9000,
    specials: [
      { kind: 'drain', name: '¡Varkhul grita! Tu plegaria se debilita.' },
      { kind: 'aoe_target', count: 4, spread: 4, r: 2.0, delay: 1700, dmg: 14, name: 'Púas de hueso brotan del suelo.' },
    ],
    rocks: [{ x: -1488, z: -428, r: 1.8 }, { x: -1512, z: -452, r: 1.8 }],
    tip: 'Usa melé con Protección cuerpo a cuerpo de cerca, o magia con Protección contra magia de lejos. Lleva comida: drena tu plegaria.',
  },
  magister_cabildo: {
    name: 'Magister Perdomo', title: 'Gran Brujo del Cabildo', x: -40, z: -600, lairR: 24, bodyR: 1.0,
    color: '#ff3a3a', drop: 'super_fuerza_3', dropName: 'Súper fuerza',
    stats: { hp: 300, att: 68, str: 60, def: 55, speed: 5, range: 11 },
    attacks: [{ style: 'magic', range: 12, max: 20, every: 2800 }, { style: 'melee', range: 3.0, max: 14, every: 2600 }],
    specialEvery: 7000,
    specials: [
      { kind: 'aoe_target', count: 3, spread: 3.5, r: 2.6, delay: 1900, dmg: 18, name: '¡Perdomo invoca el Sello de Guayota! Fuego a tus pies.' },
      { kind: 'drain', name: 'El Magister te roba la fe: tu plegaria se debilita.' },
      { kind: 'teleport', name: 'Perdomo se esfuma en humo rojo…' },
    ],
    rocks: [],
    tip: 'Protección contra magia. Sal de los círculos rojos y ten pociones de plegaria a mano: te la roba.',
  },
  dragon_rojo: {
    name: 'Vermithrax', title: 'el Dragón Rojo', x: -1850, z: 40, lairR: 30, bodyR: 2.4,
    color: '#ff5a1a', drop: 'body_dragon', dropName: 'Pechera de dragón',
    stats: { hp: 400, att: 70, str: 68, def: 60, speed: 5, range: 3.8 },
    attacks: [{ style: 'melee', range: 4.2, max: 22, every: 3000 }, { style: 'magic', range: 12, max: 24, every: 3600, breath: true }],
    specialEvery: 8500,
    specials: [
      { kind: 'aoe_target', count: 4, spread: 4.5, r: 2.4, delay: 2200, dmg: 20, name: '¡Vermithrax ruge! Lluvia de fuego.' },
    ],
    rocks: [{ x: -1838, z: 28, r: 2.5 }, { x: -1864, z: 54, r: 2.5 }],
    tip: 'Su aliento es MAGIA: Protección contra magia y quédate lejos. Esquiva la lluvia de fuego.',
  },
  dragon_negro: {
    name: 'Nidhogg', title: 'el Dragón Negro', x: -1600, z: -1540, lairR: 32, bodyR: 2.8,
    color: '#b050ff', drop: 'bow_dragon', dropName: 'Arco de garras de dragón',
    stats: { hp: 500, att: 76, str: 72, def: 66, speed: 5, range: 4 },
    attacks: [{ style: 'melee', range: 4.6, max: 26, every: 3000 }, { style: 'magic', range: 12, max: 26, every: 3600, breath: true }],
    specialEvery: 7000,
    specials: [
      { kind: 'aoe_self', r: 7, delay: 1800, dmg: 22, name: '¡Nidhogg barre con la cola! (aléjate)' },
      { kind: 'aoe_target', count: 5, spread: 5, r: 2.4, delay: 2100, dmg: 20, name: 'Llueve fuego negro.' },
    ],
    rocks: [{ x: -1586, z: -1526, r: 2.6 }, { x: -1614, z: -1554, r: 2.6 }, { x: -1612, z: -1524, r: 2.2 }],
    tip: 'Trábalo en una roca para evitar sus garras; entonces solo te alcanzará el fuego (Protección contra magia).',
  },
};

export const BOSS_IDS = Object.keys(BOSSES);
export const DRAGON_DROP_RATE = 20;   // 1/20

/** ¿El punto (x,z) choca con una roca de la guarida (con radio extra `pad`)? */
export function hitsRock(boss, x, z, pad = 0) {
  for (const r of boss.rocks || []) {
    if (Math.hypot(x - r.x, z - r.z) < r.r + pad) return true;
  }
  return false;
}

/** Todas las rocas de todas las guaridas (para colisión del jugador en el cliente). */
export function allBossRocks() {
  const out = [];
  for (const [id, b] of Object.entries(BOSSES)) for (const r of b.rocks || []) out.push({ ...r, boss: id });
  return out;
}

/** Jefe cuya guarida contiene (x,z), o null. */
export function bossLairAt(x, z) {
  for (const [id, b] of Object.entries(BOSSES)) {
    if (Math.hypot(x - b.x, z - b.z) <= b.lairR) return id;
  }
  return null;
}
