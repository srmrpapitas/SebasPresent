/**
 * SebasPresent — Misiones (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. El server lleva el progreso
 * (tabla user_quests) y avanza los pasos cuando llegan eventos reales desde
 * los handlers (talar, encender fuego, matar, cocinar, picar, fundir, forjar,
 * equipar). El cliente solo muestra el paso actual y dónde ir.
 *
 * Paso:
 *   event:  'chop' | 'fire' | 'kill' | 'cook' | 'mine' | 'smelt' | 'smith' | 'equip' | 'fish' | 'bury' | 'altar' | 'fletch' | 'craft' | 'bank' | 'note' | 'ge_sell' | 'talk' | 'deliver'
 *   match:  (opcional) lo que tiene que coincidir: item, npc def, mineral...
 *   count:  cuántas veces
 *   give:   herramientas que se entregan al empezar el paso SI no las tienes
 *   hint:   { x, z } fijo, o { npc: 'chicken' } (el cliente busca el más cercano)
 *   reward: recompensa al completar el paso { coins?, items?: [[id, qty]] }
 * Quest.reward: recompensa final al terminar todos los pasos.
 */

export const QUESTS = {
  tutorial: {
    id: 'tutorial',
    name: 'Primeros pasos',
    summary: 'Aprende lo básico: talar, hacer fuego, cazar, cocinar, picar mineral y forjar tu primera pieza de armadura.',
    steps: [
      { id: 'chop',  event: 'chop',  count: 3, give: ['axe_bronze'],
        text: 'Tala 3 troncos de cualquier árbol.',
        tip: 'Toca un árbol cerca del Concejo. Tu personaje irá y talará solo.',
        reward: { coins: 10 } },
      { id: 'fire',  event: 'fire',  count: 1, give: ['tinderbox'],
        text: 'Enciende un fuego.',
        tip: 'En la mochila, toca unos troncos → "Encender fuego".',
        reward: { coins: 10 } },
      { id: 'hunt',  event: 'kill',  match: 'chicken', count: 1, hint: { npc: 'chicken' },
        text: 'Mata un pollo.',
        tip: 'Los pollos están alrededor del Concejo. Tócalo para atacar.',
        reward: { coins: 10 } },
      { id: 'cook',  event: 'cook',  count: 1,
        text: 'Cocina carne cruda en un fuego.',
        tip: 'Enciende un fuego, ponte al lado y toca el pollo crudo → "Cocinar".',
        reward: { coins: 15 } },
      { id: 'mine',  event: 'mine',  match: 'bronze', count: 3, give: ['pickaxe_bronze'], hint: { x: 121, z: -95 },
        text: 'Pica 3 minerales de bronce en la Cantera del Concejo.',
        tip: 'Sigue el haz dorado. Las vetas de bronce brillan en naranja.',
        reward: { coins: 15 } },
      { id: 'smelt', event: 'smelt', match: 'bronze', count: 3, hint: { x: 102, z: -74 },
        text: 'Funde 3 lingotes de bronce en el horno.',
        tip: 'Toca el horno y elige "Lingote de bronce" → 5 o Todo.',
        reward: { coins: 20 } },
      { id: 'smith', event: 'smith', match: 'helm_bronze', count: 1, hint: { x: 96, z: -80 },
        text: 'Forja un yelmo de bronce en el yunque.',
        tip: 'Toca el yunque, pestaña Bronce → Yelmo de bronce.',
        reward: { coins: 20 } },
      { id: 'equip', event: 'equip', match: 'helm_bronze', count: 1,
        text: 'Equípate el yelmo de bronce.',
        tip: 'En la mochila, toca el yelmo → "Equipar".',
        reward: { coins: 0 } },
    ],
    reward: { coins: 150, items: [['sword_bronze', 1]], text: '150 monedas y una espada de bronce' },
  },

  // Sesión 50 — Pesca. Se lleva en paralelo, pero el rastreador la enseña
  // cuando terminas (o saltas) el tutorial.
  pescador: {
    id: 'pescador',
    name: 'Anzuelo y sedal',
    summary: 'Aprende a pescar en el Estanque del Concejo y cocina lo que saques. Al final te espera una caña de pescar.',
    steps: [
      { id: 'net',   event: 'fish', match: 'raw_shrimp', count: 5, give: ['small_net'], hint: { x: -70, z: -150 },
        text: 'Pesca 5 gambas en el Estanque del Concejo.',
        tip: 'Busca las burbujas en el agua y tócalas con la red pequeña en la mochila. Los bancos se mueven cada pocos minutos.',
        reward: { coins: 15 } },
      { id: 'cook',  event: 'cook', match: 'shrimp', count: 3,
        text: 'Cocina 3 gambas en un fuego.',
        tip: 'Enciende un fuego y toca las gambas crudas → "Cocinar".',
        reward: { coins: 15 } },
    ],
    reward: { coins: 50, items: [['fishing_rod', 1], ['feather', 50]], text: '50 monedas, una caña de pescar y 50 plumas (cebo)' },
  },

  // Sesión 50 — Flechería + Artesanía
  artesano: {
    id: 'artesano',
    name: 'Manos de artesano',
    summary: 'Aprende a tallar madera y a trabajar el cuero. Con esto podrás hacer tus propias flechas, arcos y armadura de cuero.',
    steps: [
      { id: 'shafts', event: 'fletch', match: 'arrow_shaft', count: 1, give: ['knife'],
        text: 'Talla astiles con unos troncos.',
        tip: 'En la mochila, toca unos troncos → "🏹 Flechería" → 15 astiles.',
        reward: { coins: 10, items: [['feather', 15]] } },
      { id: 'cow', event: 'kill', match: 'cow', count: 1, hint: { npc: 'cow' },
        text: 'Mata una vaca para conseguir su piel.',
        tip: 'Las vacas sueltan siempre piel de vaca.',
        reward: { coins: 10 } },
      { id: 'tan', event: 'craft', match: 'leather', count: 1,
        text: 'Curte la piel de vaca.',
        tip: 'Toca la piel de vaca en la mochila → "🧵 Artesanía" → Curtir.',
        reward: { coins: 10 } },
      { id: 'gloves', event: 'craft', match: 'gloves_cuero', count: 1, give: ['needle', 'thread'],
        text: 'Cose unos guantes de cuero.',
        tip: 'Toca el cuero → "🧵 Artesanía" → Guantes de cuero (aguja + hilo).',
        reward: { coins: 15 } },
      { id: 'equip', event: 'equip', match: 'gloves_cuero', count: 1,
        text: 'Ponte los guantes de cuero.',
        tip: 'En la mochila, toca los guantes → "Equipar".',
        reward: { coins: 0 } },
    ],
    reward: { coins: 100, items: [['arrow_bronze', 50], ['thread', 20]], text: '100 monedas, 50 flechas de bronce y 20 de hilo' },
  },
};

// Sesión 50 — Bancos, notas y GE
QUESTS.banquero = {
  id: 'banquero',
  name: 'El banquero',
  summary: 'Por todo el mapa hay cofres de banco (el icono dorado del minimapa). Todos abren TU banco. Aprende a guardar, a sacar notas y a vender en el Mercado.',
  steps: [
    { id: 'deposit', event: 'bank', count: 1, hint: { bank: true },
      text: 'Guarda algo en un cofre de banco.',
      tip: 'Sigue el haz dorado hasta el cofre más cercano, tócalo y toca un objeto de tu mochila.',
      reward: { coins: 20 } },
    { id: 'note', event: 'note', count: 1, hint: { bank: true },
      text: 'Saca un objeto como NOTA.',
      tip: 'En el banco activa "📜 Sacar como nota" y saca algo que no se apile (troncos, mineral…). Ocupa un solo hueco.',
      reward: { coins: 20 } },
    { id: 'ge', event: 'ge_sell', count: 1, hint: { x: -80, z: -80 },
      text: 'Pon algo a la venta en el Mercado (GE).',
      tip: 'Habla con el banquero del castillo → Mercado. Las notas cuentan como el objeto.',
      reward: { coins: 0 } },
  ],
  reward: { coins: 150, text: '150 monedas' },
};

// ============================================================
// Sesión 50 — Misiones de los habitantes (estilo OSRS)
// ============================================================
// giver:  NPC que la ofrece (shared/town_npcs.js). Estas NO se crean solas:
//         empiezan al aceptarlas hablando con él (POST /api/quests/start).
// offer:  lo que cuenta el NPC al ofrecerla. accept: respuesta del jugador.
// doing:  lo que dice mientras la haces. thanks: al terminar.
// Pasos nuevos:
//   { event: 'talk', match: npcId }                       → hablar con él
//   { event: 'deliver', npc: npcId, items: [[id, n], …] } → entregarle objetos
// reward.xp: { skill: xp }
QUESTS.pescador.giver = 'tomas_pescador';
QUESTS.pescador.offer = ['¿Sabes pescar? Aquí en el estanque hay gambas de sobra.', 'Coge esta red, saca unas gambas y cocínalas. Si lo haces, te regalo mi caña vieja.'];
QUESTS.pescador.accept = 'Vale, lo intento.';
QUESTS.pescador.doing = '¿Qué tal van esas gambas? Busca las burbujas en el agua.';
QUESTS.pescador.thanks = '¡Ya eres todo un pescador! Quédate la caña, y usa plumas de cebo.';
QUESTS.artesano.giver = 'lia_artesana';
QUESTS.artesano.offer = ['Todo aventurero debería saber tallar madera y coser cuero.', 'Te dejo un cuchillo. Haz unos astiles, consigue una piel de vaca, cúrtela y cóseme unos guantes.'];
QUESTS.artesano.accept = 'Enséñame.';
QUESTS.artesano.doing = 'Los troncos se tallan desde la mochila: tócalos y elige Flechería.';
QUESTS.artesano.thanks = '¡Buen trabajo! Ahora ya puedes hacer tus propias flechas y armadura.';
QUESTS.banquero.giver = 'banquero_gerardo';
QUESTS.banquero.offer = ['¿Todavía cargas con todo encima? Mal negocio.', 'Te enseño a usar el banco, las notas y el Mercado. A cambio, unas monedas de bienvenida.'];
QUESTS.banquero.accept = 'Enséñame a ser rico.';
QUESTS.banquero.doing = 'Cualquier cofre con la moneda dorada te sirve.';
QUESTS.banquero.thanks = 'Así se hace. El dinero llama al dinero.';

const talkBack = (npc, text, coins = 0) => ({ id: 'back', event: 'talk', match: npc, count: 1, hint: { talk: npc }, text, reward: { coins } });

Object.assign(QUESTS, {
  ratas_granero: {
    id: 'ratas_granero', name: 'Ratas en el granero', giver: 'rosa_granjera',
    summary: 'La granjera Rosa tiene el granero lleno de ratas. Recomendado: nivel de combate 3.',
    offer: ['¡Ay, forastero! Las ratas se están comiendo el grano de mis vacas.', '¿Podrías matar unas cuantas? Rondan por los campos, cerca del Concejo.'],
    accept: 'Yo me encargo de las ratas.', doing: 'Todavía oigo ratas en el granero… ¡Mata 5!',
    thanks: '¡Qué alivio! Toma, y llévate la gratitud de mis vacas.',
    steps: [
      { id: 'kill', event: 'kill', match: 'rat', count: 5, hint: { npc: 'rat' }, text: 'Mata 5 ratas gigantes.', tip: 'Las ratas rondan por los campos alrededor del Concejo.' },
      talkBack('rosa_granjera', 'Vuelve a hablar con Rosa.'),
    ],
    reward: { coins: 80, xp: { attack: 200, strength: 200 }, text: '80 monedas · 200 XP Ataque · 200 XP Fuerza' },
  },
  aranas_robledal: {
    id: 'aranas_robledal', name: 'Telarañas en Robledal', giver: 'joaquin_lenador',
    summary: 'Las arañas no dejan trabajar a los leñadores de Robledal. Recomendado: nivel de combate 10.',
    offer: ['No puedo talar tranquilo: las arañas del sur del bosque me han llenado el hacha de telarañas.', 'Si matas 5, te enseño un par de trucos del oficio.'],
    accept: 'Arañas… vale, allá voy.', doing: 'Las arañas están al sur de Robledal. ¡Cuidado con los lobos!',
    thanks: '¡Por fin! Mira, se tala mejor así, con la muñeca suelta…',
    steps: [
      { id: 'kill', event: 'kill', match: 'spider', count: 5, hint: { npc: 'spider' }, text: 'Mata 5 arañas del bosque.', tip: 'Están al sur de Robledal.' },
      talkBack('joaquin_lenador', 'Vuelve a hablar con Joaquín en Robledal.'),
    ],
    reward: { coins: 150, xp: { woodcutting: 500 }, text: '150 monedas · 500 XP Tala' },
  },
  aullidos: {
    id: 'aullidos', name: 'Aullidos en el bosque', giver: 'bruno_cazador',
    summary: 'Los lobos amenazan la Cabaña del Cazador. Recomendado: nivel de combate 15.',
    offer: ['Los lobos del bosque cada noche se acercan más a la cabaña.', 'Mata 3 y te doy mi arco de roble. Yo ya estoy viejo para esto.'],
    accept: 'Cazaré esos lobos.', doing: 'Los lobos rondan el bosque al norte de Robledal.',
    thanks: 'Buen trabajo. El arco es tuyo: necesitarás nivel 10 de Distancia para usarlo.',
    steps: [
      { id: 'kill', event: 'kill', match: 'wolf', count: 3, hint: { npc: 'wolf' }, text: 'Mata 3 lobos.', tip: 'En el bosque del norte.' },
      talkBack('bruno_cazador', 'Vuelve con Bruno a la Cabaña del Cazador.'),
    ],
    reward: { coins: 100, items: [['bow_oak', 1], ['leather', 5]], xp: { ranged: 400 }, text: 'Arco de roble · 5 de cuero · 100 monedas · 400 XP Distancia' },
  },
  guiso_abuela: {
    id: 'guiso_abuela', name: 'El guiso de la abuela', giver: 'petra_abuela',
    summary: 'La abuela Petra quiere hacer su famoso guiso. Necesita ingredientes cocinados.',
    offer: ['Mis nietos vienen a cenar y no tengo nada en la olla.', '¿Me traerías 3 gambas cocinadas y 2 filetes de ternera cocinada? Te guardo un plato… y algo más.'],
    accept: 'Ahora mismo se los traigo.', doing: 'Recuerda: 3 gambas y 2 de ternera, bien cocinadas.',
    thanks: '¡Huele de maravilla! Toma, y vuelve cuando quieras.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'petra_abuela', items: [['shrimp', 3], ['cooked_beef', 2]], count: 1, hint: { talk: 'petra_abuela' },
        text: 'Lleva a Petra 3 gambas y 2 de ternera cocinadas.', tip: 'Pesca gambas en el estanque, mata vacas y cocínalo todo en un fuego.' },
    ],
    reward: { coins: 120, xp: { cooking: 400 }, text: '120 monedas · 400 XP Cocina' },
  },
  faro_apagado: {
    id: 'faro_apagado', name: 'El faro apagado', giver: 'irene_farera',
    summary: 'El faro del sur se ha quedado sin leña. Los barcos no ven la costa.',
    offer: ['¡El faro se ha apagado y viene tormenta!', 'Tráeme 5 troncos de roble para la hoguera de arriba, por favor.'],
    accept: 'Traeré la madera.', doing: 'Necesito 5 troncos de roble. Los robles abundan en el bosque.',
    thanks: '¡Luz otra vez! Ningún barco se perderá esta noche gracias a ti.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'irene_farera', items: [['oak_logs', 5]], count: 1, hint: { talk: 'irene_farera' },
        text: 'Lleva 5 troncos de roble a Irene, la farera.', tip: 'Tala robles (nivel 15 de Tala).' },
    ],
    reward: { coins: 200, xp: { firemaking: 600, woodcutting: 200 }, text: '200 monedas · 600 XP Fuego · 200 XP Tala' },
  },
  encargo_herrera: {
    id: 'encargo_herrera', name: 'El encargo de la herrera', giver: 'nuria_herrera',
    summary: 'Nuria, la herrera de Picoblanco, necesita hierro para un pedido urgente.',
    offer: ['Tengo un pedido de la guardia y me he quedado sin hierro.', 'Tráeme 5 lingotes de hierro y te forjo una espada de acero. Palabra de herrera.'],
    accept: 'Trato hecho.', doing: '5 lingotes de hierro. El mineral de hierro se funde a nivel 5 de Herrería.',
    thanks: 'Hierro de primera. Toma tu espada: necesitarás nivel 10 de Ataque.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'nuria_herrera', items: [['bar_hierro', 5]], count: 1, hint: { talk: 'nuria_herrera' },
        text: 'Lleva 5 lingotes de hierro a Nuria (Picoblanco).', tip: 'Pica hierro y fúndelo en un horno.' },
    ],
    reward: { items: [['sword_acero', 1]], xp: { smithing: 800 }, text: 'Espada de acero · 800 XP Herrería' },
  },
  mago_huesos: {
    id: 'mago_huesos', name: 'Huesos y plumas', giver: 'eldric_mago',
    summary: 'El mago Eldric prepara un ritual muy… particular.',
    offer: ['Ah, justo a quien necesitaba. Preparo un ritual de levitación.', 'Tráeme 10 huesos y 20 plumas. No preguntes para qué.'],
    accept: '…Vale, no pregunto.', doing: '10 huesos y 20 plumas. Los pollos tienen de las dos cosas.',
    thanks: '¡Perfecto! Siente cómo fluye el maná… Esto te servirá.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'eldric_mago', items: [['bones', 10], ['feather', 20]], count: 1, hint: { talk: 'eldric_mago' },
        text: 'Lleva 10 huesos y 20 plumas a Eldric (Torre del Mago).', tip: 'Mata pollos: sueltan huesos y plumas.' },
    ],
    reward: { coins: 200, xp: { magic: 700, prayer: 300 }, text: '200 monedas · 700 XP Magia · 300 XP Plegaria' },
  },
  golems_mina: {
    id: 'golems_mina', name: 'Los guardianes de la mina', giver: 'ramiro_capataz',
    summary: 'Los gólems de la Mina Antigua no dejan trabajar a nadie. Recomendado: nivel de combate 40.',
    offer: ['Los gólems se despertaron y mis mineros no bajan.', 'Si acabas con 2, la mina es tuya para picar cuando quieras.'],
    accept: 'Los gólems no me asustan.', doing: 'Están dentro de la mina. Golpean muy fuerte: lleva comida.',
    thanks: '¡Increíble! Los mineros te harán una estatua. Bueno, un dibujo.',
    steps: [
      { id: 'kill', event: 'kill', match: 'golem', count: 2, hint: { npc: 'golem' }, text: 'Derrota a 2 gólems de la Mina Antigua.', tip: 'Lleva comida y tu mejor armadura.' },
      talkBack('ramiro_capataz', 'Vuelve a hablar con Ramiro.'),
    ],
    reward: { coins: 400, xp: { mining: 1500 }, text: '400 monedas · 1.500 XP Minería' },
  },
  escorpiones: {
    id: 'escorpiones', name: 'Veneno en las dunas', giver: 'samir_mercader',
    summary: 'Los escorpiones atacan las caravanas de Solquemado. Recomendado: nivel de combate 25.',
    offer: ['Mis caravanas no pueden cruzar el desierto: escorpiones por todas partes.', 'Mata 4 y te pago con algo mejor que monedas.'],
    accept: 'Acabaré con ellos.', doing: 'Los escorpiones están por todo el desierto. Su veneno duele.',
    thanks: 'Las caravanas vuelven a pasar. Toma, guantes de acero de la mejor calidad.',
    steps: [
      { id: 'kill', event: 'kill', match: 'scorpion', count: 4, hint: { npc: 'scorpion' }, text: 'Mata 4 escorpiones del desierto.', tip: 'Están por todo el desierto de Solquemado.' },
      talkBack('samir_mercader', 'Vuelve con Samir a Solquemado.'),
    ],
    reward: { coins: 150, items: [['gloves_acero', 1]], xp: { defence: 500 }, text: 'Guantes de acero · 150 monedas · 500 XP Defensa' },
  },
  bestia_blanca: {
    id: 'bestia_blanca', name: 'La bestia blanca', giver: 'sven_guardia',
    summary: 'Un yeti ronda el Pueblo de los Vientos. Recomendado: nivel de combate 50.',
    offer: ['Anoche un yeti se llevó dos ovejas y una puerta.', 'Si lo cazas, el pueblo te lo pagará bien.'],
    accept: 'Cazaré a la bestia.', doing: 'Los yetis viven en la montaña, al norte de Picoblanco.',
    thanks: '¡Lo has conseguido! El pueblo entero te invita a cerveza. Y a esto.',
    steps: [
      { id: 'kill', event: 'kill', match: 'yeti', count: 1, hint: { npc: 'yeti' }, text: 'Caza un yeti.', tip: 'En las montañas nevadas del norte.' },
      talkBack('sven_guardia', 'Vuelve con Sven al Pueblo de los Vientos.'),
    ],
    reward: { coins: 800, xp: { defence: 1500, hitpoints: 500 }, text: '800 monedas · 1.500 XP Defensa · 500 XP Vitalidad' },
  },
});

export const QUEST_ORDER = ['tutorial', 'pescador', 'artesano', 'banquero',
  'ratas_granero', 'guiso_abuela', 'faro_apagado', 'aranas_robledal', 'aullidos',
  'mago_huesos', 'encargo_herrera', 'escorpiones', 'golems_mina', 'bestia_blanca'];

/** Misiones que ofrece un NPC. */
export function questsOfNpc(npcId) {
  return QUEST_ORDER.map(id => QUESTS[id]).filter(q => q.giver === npcId);
}

export function getQuest(id) { return QUESTS[id] || null; }
