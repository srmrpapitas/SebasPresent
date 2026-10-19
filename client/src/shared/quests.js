/**
 * SebasPresent — Misiones (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. El server lleva el progreso
 * (tabla user_quests) y avanza los pasos cuando llegan eventos reales desde
 * los handlers (talar, encender fuego, matar, cocinar, picar, fundir, forjar,
 * equipar). El cliente solo muestra el paso actual y dónde ir.
 *
 * Paso:
 *   event:  'chop' | 'fire' | 'kill' | 'cook' | 'mine' | 'smelt' | 'smith' | 'equip' | 'fish' | 'bury' | 'altar' | 'fletch' | 'craft' | 'bank' | 'note' | 'ge_sell' | 'talk' | 'deliver' | 'teleport'
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
        tip: 'Toca un árbol cerca de La Laguna. Tu personaje irá y talará solo.',
        reward: { coins: 10 } },
      { id: 'fire',  event: 'fire',  count: 1, give: ['tinderbox'],
        text: 'Enciende un fuego.',
        tip: 'En la mochila, toca unos troncos → "Encender fuego".',
        reward: { coins: 10 } },
      { id: 'hunt',  event: 'kill',  match: 'chicken', count: 1, hint: { npc: 'chicken' },
        text: 'Mata un pollo.',
        tip: 'Los pollos están alrededor de La Laguna. Tócalo para atacar.',
        reward: { coins: 10 } },
      { id: 'cook',  event: 'cook',  count: 1,
        text: 'Cocina carne cruda en un fuego.',
        tip: 'Enciende un fuego, ponte al lado y toca el pollo crudo → "Cocinar".',
        reward: { coins: 15 } },
      { id: 'mine',  event: 'mine',  match: 'bronze', count: 3, give: ['pickaxe_bronze'], hint: { x: 121, z: -95 },
        text: 'Pica 3 minerales de bronce en la Cantera de La Laguna.',
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
    summary: 'Aprende a pescar en la Laguna de Aguere y cocina lo que saques. Al final te espera una caña de pescar.',
    steps: [
      { id: 'net',   event: 'fish', match: 'raw_shrimp', count: 5, give: ['small_net'], hint: { x: -70, z: -150 },
        text: 'Pesca 5 gambas en la Laguna de Aguere.',
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
    { id: 'ge', event: 'ge_sell', count: 1, hint: { x: 30, z: 0 },
      text: 'Pon algo a la venta en el Mercado (GE).',
      tip: 'Entra al edificio del banco de la plaza y habla con el banquero → Mercado. Las notas cuentan como el objeto.',
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
    offer: ['¡Ay, forastero! Las ratas se están comiendo el grano de mis vacas.', '¿Podrías matar unas cuantas? Rondan por los campos, cerca de La Laguna.'],
    accept: 'Yo me encargo de las ratas.', doing: 'Todavía oigo ratas en el granero… ¡Mata 5!',
    thanks: '¡Qué alivio! Toma, y llévate la gratitud de mis vacas.',
    steps: [
      { id: 'kill', event: 'kill', match: 'rat', count: 5, hint: { npc: 'rat' }, text: 'Mata 5 ratas gigantes.', tip: 'En los Campos de las ratas, justo al este de La Laguna.' },
      talkBack('rosa_granjera', 'Vuelve a hablar con Rosa.'),
    ],
    reward: { coins: 80, xp: { attack: 200, strength: 200 }, text: '80 monedas · 200 XP Ataque · 200 XP Fuerza' },
  },
  aranas_robledal: {
    id: 'aranas_robledal', name: 'Telarañas en La Orotava', giver: 'joaquin_lenador',
    summary: 'Las arañas no dejan trabajar a los leñadores de La Orotava. Recomendado: nivel de combate 10.',
    offer: ['No puedo talar tranquilo: las arañas del sur del bosque me han llenado el hacha de telarañas.', 'Si matas 5, te enseño un par de trucos del oficio.'],
    accept: 'Arañas… vale, allá voy.', doing: 'Las arañas están al sur de La Orotava. ¡Cuidado con los lobos!',
    thanks: '¡Por fin! Mira, se tala mejor así, con la muñeca suelta…',
    steps: [
      { id: 'kill', event: 'kill', match: 'spider', count: 5, hint: { npc: 'spider' }, text: 'Mata 5 arañas del bosque.', tip: 'En el Pinar de las arañas, al sur de La Orotava.' },
      talkBack('joaquin_lenador', 'Vuelve a hablar con Joaquín en La Orotava.'),
    ],
    reward: { coins: 150, xp: { woodcutting: 500 }, text: '150 monedas · 500 XP Tala' },
  },
  aullidos: {
    id: 'aullidos', name: 'Aullidos en el bosque', giver: 'bruno_cazador',
    summary: 'Los lobos amenazan Icod de los Vinos. Recomendado: nivel de combate 15.',
    offer: ['Los lobos del bosque cada noche se acercan más a la cabaña.', 'Mata 3 y te doy mi arco de roble. Yo ya estoy viejo para esto.'],
    accept: 'Cazaré esos lobos.', doing: 'Los lobos rondan el bosque al norte de La Orotava.',
    thanks: 'Buen trabajo. El arco es tuyo: necesitarás nivel 10 de Distancia para usarlo.',
    steps: [
      { id: 'kill', event: 'kill', match: 'wolf', count: 3, hint: { npc: 'wolf' }, text: 'Mata 3 lobos.', tip: 'En la Guarida de los lobos: el bosque del norte, al noroeste de La Orotava.' },
      talkBack('bruno_cazador', 'Vuelve con Bruno a Icod de los Vinos.'),
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
    summary: 'Nuria, la herrera de Las Cañadas, necesita hierro para un pedido urgente.',
    offer: ['Tengo un pedido de la guardia y me he quedado sin hierro.', 'Tráeme 5 lingotes de hierro y te forjo una espada de acero. Palabra de herrera.'],
    accept: 'Trato hecho.', doing: '5 lingotes de hierro. El mineral de hierro se funde a nivel 5 de Herrería.',
    thanks: 'Hierro de primera. Toma tu espada: necesitarás nivel 10 de Ataque.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'nuria_herrera', items: [['bar_hierro', 5]], count: 1, hint: { talk: 'nuria_herrera' },
        text: 'Lleva 5 lingotes de hierro a Nuria (Las Cañadas).', tip: 'Pica hierro y fúndelo en un horno.' },
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
        text: 'Lleva 10 huesos y 20 plumas a Eldric (Observatorio de Izaña).', tip: 'Mata pollos: sueltan huesos y plumas.' },
    ],
    reward: { coins: 200, xp: { magic: 700, prayer: 300 }, text: '200 monedas · 700 XP Magia · 300 XP Plegaria' },
  },
  golems_mina: {
    id: 'golems_mina', name: 'Los guardianes de la mina', giver: 'ramiro_capataz',
    summary: 'Los gólems de la Mina de Guajara no dejan trabajar a nadie. Recomendado: nivel de combate 40.',
    offer: ['Los gólems se despertaron y mis mineros no bajan.', 'Si acabas con 2, la mina es tuya para picar cuando quieras.'],
    accept: 'Los gólems no me asustan.', doing: 'Están dentro de la mina. Golpean muy fuerte: lleva comida.',
    thanks: '¡Increíble! Los mineros te harán una estatua. Bueno, un dibujo.',
    steps: [
      { id: 'kill', event: 'kill', match: 'golem', count: 2, hint: { npc: 'golem' }, text: 'Derrota a 2 gólems de la Mina de Guajara.', tip: 'Lleva comida y tu mejor armadura.' },
      talkBack('ramiro_capataz', 'Vuelve a hablar con Ramiro.'),
    ],
    reward: { coins: 400, xp: { mining: 1500 }, text: '400 monedas · 1.500 XP Minería' },
  },
  escorpiones: {
    id: 'escorpiones', name: 'Veneno en las dunas', giver: 'samir_mercader',
    summary: 'Los escorpiones atacan las caravanas de Güímar. Recomendado: nivel de combate 25.',
    offer: ['Mis caravanas no pueden cruzar el desierto: escorpiones por todas partes.', 'Mata 4 y te pago con algo mejor que monedas.'],
    accept: 'Acabaré con ellos.', doing: 'Los escorpiones están por todo el desierto. Su veneno duele.',
    thanks: 'Las caravanas vuelven a pasar. Toma, guantes de acero de la mejor calidad.',
    steps: [
      { id: 'kill', event: 'kill', match: 'scorpion', count: 4, hint: { npc: 'scorpion' }, text: 'Mata 4 escorpiones del desierto.', tip: 'En las Dunas de los escorpiones, al noroeste de Güímar.' },
      talkBack('samir_mercader', 'Vuelve con Samir a Güímar.'),
    ],
    reward: { coins: 150, items: [['gloves_acero', 1]], xp: { defence: 500 }, text: 'Guantes de acero · 150 monedas · 500 XP Defensa' },
  },
  bestia_blanca: {
    id: 'bestia_blanca', name: 'La bestia blanca', giver: 'sven_guardia',
    summary: 'Un yeti ronda La Esperanza. Recomendado: nivel de combate 50.',
    offer: ['Anoche un yeti se llevó dos ovejas y una puerta.', 'Si lo cazas, el pueblo te lo pagará bien.'],
    accept: 'Cazaré a la bestia.', doing: 'Los yetis viven en la montaña, al norte de Las Cañadas.',
    thanks: '¡Lo has conseguido! El pueblo entero te invita a cerveza. Y a esto.',
    steps: [
      { id: 'kill', event: 'kill', match: 'yeti', count: 1, hint: { npc: 'yeti' }, text: 'Caza un yeti.', tip: 'En las Cumbres de los yetis, en la nieve al oeste de Las Cañadas.' },
      talkBack('sven_guardia', 'Vuelve con Sven a La Esperanza.'),
    ],
    reward: { coins: 800, xp: { defence: 1500, hitpoints: 500 }, text: '800 monedas · 1.500 XP Defensa · 500 XP Vitalidad' },
  },
});

// Sesión 50 — tabletas de teletransporte
QUESTS.primer_viaje = {
  id: 'primer_viaje', name: 'Primer viaje mágico', giver: 'morgana_maga',
  summary: 'Morgana vende tabletas de teletransporte. Aprende a usarlas para moverte rápido por la isla.',
  offer: ['¿Todavía vas andando a todas partes? Qué cansado.', 'Cómprame una tableta, rómpela y apareces donde quieras. Si lo pruebas, te regalo unas cuantas.'],
  accept: 'Quiero probarlo.', doing: 'Compra una tableta en mi tienda y, en tu mochila, tócala para romperla.',
  thanks: '¿A que es cómodo? Toma, unas tabletas de regalo para volver a casa.',
  steps: [
    { id: 'tele', event: 'teleport', count: 1, hint: { talk: 'morgana_maga' },
      text: 'Compra una tableta a Morgana y rómpela.', tip: 'Morgana está en La Laguna. En la mochila, toca la tableta para romperla.' },
  ],
  reward: { coins: 40, items: [['tele_concejo', 3], ['tele_robledal', 1]], text: '3 tabletas de La Laguna · 1 de La Orotava · 40 monedas' },
};

// ============================================================
// Sesión 50 — Misiones de aventura: tabletas, cazas, jefes y la Fosa
// ============================================================
Object.assign(QUESTS, {
  viaje_relampago: {
    id: 'viaje_relampago', name: 'Viaje relámpago', giver: 'morgana_maga',
    summary: 'Morgana quiere comprobar que sus tabletas funcionan en los confines de la isla.',
    offer: ['Mis tabletas nuevas llevan a los rincones más lejanos… en teoría.', 'Rompe una de Las Cañadas, otra de Güímar y otra de Los Cristianos, y cuéntame qué tal.'],
    accept: 'Probaré tus tabletas.', doing: 'Rompe las tabletas de Las Cañadas, Güímar y Los Cristianos (se venden en mi tienda).',
    thanks: '¡Funcionan todas! Toma, para tus viajes. Y un poco de mi sabiduría.',
    steps: [
      { id: 'tele1', event: 'teleport', match: 'tele_picoblanco', count: 1, hint: { talk: 'morgana_maga' }, text: 'Rompe una tableta de Las Cañadas.', tip: 'Cómprala en la tienda de Morgana y tócala en la mochila.' },
      { id: 'tele2', event: 'teleport', match: 'tele_solquemado', count: 1, hint: { talk: 'morgana_maga' }, text: 'Rompe una tableta de Güímar.', tip: 'El desierto del este.' },
      { id: 'tele3', event: 'teleport', match: 'tele_sirena', count: 1, hint: { talk: 'morgana_maga' }, text: 'Rompe una tableta de Los Cristianos.', tip: 'La costa del sur.' },
      talkBack('morgana_maga', 'Vuelve con Morgana a La Laguna (una tableta de La Laguna te ayuda).'),
    ],
    reward: { coins: 600, items: [['tele_concejo', 5], ['tele_mina', 2], ['tele_verdis', 2]], xp: { magic: 1500 }, text: '9 tabletas · 600 monedas · 1.500 XP Magia' },
  },
  huesos_ruinas: {
    id: 'huesos_ruinas', name: 'Huesos inquietos', giver: 'explorador_herido',
    summary: 'Los esqueletos de las Ruinas de Teno no descansan. Recomendado: combate 45 (¡wilderness!).',
    offer: ['Volvía de las Ruinas de Teno y los esqueletos me dieron una paliza…', 'Si acabas con 8 de ellos podré recuperar mi mochila. Ojo: allí otros jugadores pueden atacarte.'],
    accept: 'Me encargo de esos esqueletos.', doing: 'Mata 8 esqueletos en las Ruinas de Teno, al oeste.',
    thanks: '¡Gracias! Mi mochila sigue entera. Toma lo que encontré dentro.',
    steps: [
      { id: 'kill', event: 'kill', match: 'skeleton', count: 8, hint: { npc: 'skeleton' }, text: 'Mata 8 esqueletos en las Ruinas de Teno.', tip: 'Al oeste de Santiago del Teide. Lleva comida y guarda lo valioso en el banco.' },
      talkBack('explorador_herido', 'Vuelve con el explorador herido en Santiago del Teide.'),
    ],
    reward: { coins: 2500, items: [['shark', 5], ['tele_ruinas', 2]], xp: { prayer: 2000, attack: 2500 }, text: '2.500 monedas · 5 tiburones · 2 tabletas · XP de Plegaria y Ataque' },
  },
  rey_de_las_cumbres: {
    id: 'rey_de_las_cumbres', name: 'El Rey de las Cumbres', giver: 'sven_guardia',
    summary: 'El Rey Yeti Grom baja de las cumbres. Estrategia: trábalo detrás de una roca. Recomendado: combate 60.',
    offer: ['Aquel yeti no era más que un cachorro… su REY ha despertado.', 'Grom solo pega de cerca y es torpe: si pones una roca entre los dos, no podrá alcanzarte. Usa flechas o magia.', 'Viaja hasta Las Cañadas y sube a las cumbres del norte.'],
    accept: 'Derrotaré al Rey Yeti.', doing: 'Grom vive en las cumbres, al norte de Las Cañadas. Trábalo en una roca y atácale de lejos.',
    thanks: '¡El Rey de las Cumbres ha caído! Te has ganado el respeto de todo el norte.',
    steps: [
      { id: 'tele', event: 'teleport', match: 'tele_picoblanco', count: 1, hint: { talk: 'morgana_maga' }, text: 'Usa una tableta de Las Cañadas para llegar rápido.', tip: 'Morgana las vende en La Laguna.' },
      { id: 'kill', event: 'kill', match: 'rey_yeti', count: 1, hint: { x: 480, z: -1900 }, text: 'Derrota al Rey Yeti Grom.', tip: 'Ponte detrás de una roca: él no puede rodearla. Dispárale o lánzale hechizos.' },
      talkBack('sven_guardia', 'Vuelve con Sven a La Esperanza.'),
    ],
    reward: { coins: 6000, items: [['shark', 10]], xp: { ranged: 4000, magic: 4000, defence: 3000 }, text: '6.000 monedas · 10 tiburones · XP de Distancia, Magia y Defensa' },
  },
  terror_mareas: {
    id: 'terror_mareas', name: 'El terror de las mareas', giver: 'irene_farera',
    summary: 'Algo enorme hunde los barcos cerca de Los Cristianos. Estrategia: cambia tu protección según su color.',
    offer: ['Desde el faro lo he visto: una serpiente de mar gigante. El Leviatán.', 'Cuando brilla VERDE escupe agua como flechas; cuando brilla AZUL, lanza magia. Protégete de lo que toque.'],
    accept: 'Me enfrentaré al Leviatán.', doing: 'El Leviatán acecha en la playa al este de Los Cristianos.',
    thanks: 'Los barcos vuelven a navegar tranquilos. ¡Eres una leyenda de la costa!',
    steps: [
      { id: 'tele', event: 'teleport', match: 'tele_sirena', count: 1, hint: { talk: 'morgana_maga' }, text: 'Usa una tableta de Los Cristianos.', tip: 'Morgana las vende en La Laguna.' },
      { id: 'kill', event: 'kill', match: 'leviatan', count: 1, hint: { x: -450, z: 1950 }, text: 'Derrota al Leviatán.', tip: 'Verde = Protección contra proyectiles. Azul = Protección contra magia.' },
      talkBack('irene_farera', 'Vuelve con Irene al Faro de Punta Rasca.'),
    ],
    reward: { coins: 6000, items: [['shark', 10]], xp: { prayer: 3000, hitpoints: 3000 }, text: '6.000 monedas · 10 tiburones · XP de Plegaria y Vitalidad' },
  },
  bruja_niebla: {
    id: 'bruja_niebla', name: 'La bruja de la niebla', giver: 'samir_mercader',
    summary: 'Chona, la Bruja del Páramo, maldice las caravanas. Estrategia: Protección contra magia y sal de los círculos.',
    offer: ['Mis caravanas cruzan el páramo de Erjos y vuelven… malditas.', 'Chona lanza magia: protégete de ella. Y cuando veas un círculo morado a tus pies, ¡muévete!'],
    accept: 'Acabaré con la bruja.', doing: 'Chona vive en el páramo de Erjos, al oeste de Vilaflor.',
    thanks: 'Las maldiciones se han roto. Toma: la mejor mercancía de mi caravana.',
    steps: [
      { id: 'kill', event: 'kill', match: 'bruja_pantano', count: 1, hint: { x: -640, z: 760 }, text: 'Derrota a Chona, la Bruja del Páramo.', tip: 'Protección contra magia. Sal de los círculos morados.' },
      talkBack('samir_mercader', 'Vuelve con Samir a Güímar.'),
    ],
    reward: { coins: 6000, items: [['tele_solquemado', 3]], xp: { magic: 5000 }, text: '6.000 monedas · 3 tabletas · 5.000 XP Magia' },
  },
  la_fosa: {
    id: 'la_fosa', name: 'Bautismo de fuego', giver: 'kargath',
    summary: 'Kargath te reta a bajar a la Fosa de Guayota.',
    offer: ['¿Crees que eres fuerte? Demuéstralo ahí abajo.', 'Baja a la Fosa y acaba con 5 diablillos de lava. Luego hablamos.'],
    accept: 'Acepto el reto.', doing: 'Baja a la Fosa (háblame) y mata 5 diablillos de lava.',
    thanks: 'No está mal para un novato. Vuelve cuando quieras llegar hasta Guayota.',
    steps: [
      { id: 'enter', event: 'fosa_start', count: 1, hint: { talk: 'kargath' }, text: 'Habla con Kargath y baja a la Fosa.', tip: 'Elige "Quiero bajar a la Fosa".' },
      { id: 'kill', event: 'kill', match: 'fosa_diablillo', count: 5, hint: { x: 1860, z: -340 }, text: 'Mata 5 diablillos de lava.', tip: 'Aparecen en las primeras rondas.' },
      talkBack('kargath', 'Vuelve a hablar con Kargath.'),
    ],
    reward: { coins: 1500, items: [['shark', 5]], xp: { hitpoints: 2000 }, text: '1.500 monedas · 5 tiburones · 2.000 XP Vitalidad' },
  },
  matadragones: {
    id: 'matadragones', name: 'Matadragones', giver: 'eldric_mago',
    summary: 'Vermithrax, el Dragón Rojo, ha despertado en el Volcán Chinyero. Recomendado: combate 70 (¡wilderness!).',
    offer: ['Los libros lo advertían: cuando el cielo se tiñe de rojo, Vermithrax despierta.', 'Su aliento es MAGIA: Protección contra magia. Y esquiva la lluvia de fuego.', 'Se dice que en su guarida duerme una pechera de escamas…'],
    accept: 'Mataré al dragón.', doing: 'Vermithrax está en el Volcán Chinyero, en lo más profundo del Malpaís.',
    thanks: '¡Un Matadragones! Tu nombre se escribirá en los libros del Observatorio.',
    steps: [
      { id: 'kill', event: 'kill', match: 'dragon_rojo', count: 1, hint: { x: -1850, z: 40 }, text: 'Derrota a Vermithrax, el Dragón Rojo.', tip: 'Protección contra magia, comida y cuidado con otros jugadores.' },
      talkBack('eldric_mago', 'Vuelve con Eldric al Observatorio de Izaña.'),
    ],
    reward: { coins: 20000, items: [['shark', 15]], xp: { attack: 8000, strength: 8000, ranged: 8000, magic: 8000 }, text: '20.000 monedas · 15 tiburones · 8.000 XP en Ataque, Fuerza, Distancia y Magia' },
  },
});

// ============================================================
// Sesión 50 — Herbología y el Cabildo
// ============================================================
Object.assign(QUESTS, {
  primeras_pociones: {
    id: 'primeras_pociones', name: 'Primeras pociones', giver: 'carmita_aso',
    summary: 'Carmita te enseña a hacer pociones con las hierbas de La ASO.',
    offer: ['¿Nunca has hecho una poción? ¡Qué me dices!', 'Cómprame una tabaiba y un vial de agua, y mézclalos: poción de ataque. Fácil, fácil.'],
    accept: 'Enséñeme, Carmita.', doing: 'Compra tabaiba y un vial de agua en mi puesto. En la mochila, toca la tabaiba → 🌿 Herbología.',
    thanks: '¡Mira qué color más bonito! Toma, pa\' que sigas practicando.',
    steps: [
      { id: 'mix', event: 'herb', match: 'pocion_ataque_3', count: 1, hint: { talk: 'carmita_aso' }, text: 'Haz una poción de ataque (tabaiba + vial de agua).', tip: 'En la mochila, toca la tabaiba y elige 🌿 Herbología.' },
      talkBack('carmita_aso', 'Enséñale la poción a Carmita.'),
    ],
    reward: { coins: 150, items: [['hierba_verode', 5], ['hierba_salvia', 3], ['vial_agua', 10]], xp: { herblore: 500 }, text: '5 verodes · 3 salvias · 10 viales · 150 monedas · 500 XP Herbología' },
  },
  dia_de_pierna: {
    id: 'dia_de_pierna', name: 'Día de pierna', giver: 'airam_forzudo',
    summary: 'Airam, el Forzudo de Santa Cruz, necesita pociones para su entreno.',
    offer: ['¡Chacho! Hoy toca día de pierna y me quedé sin pociones.', 'Tráeme 2 pociones de fuerza (3 dosis) y te enseño unos truquillos de entreno.'],
    accept: 'Te las traigo, Airam.', doing: '2 pociones de fuerza, mi niño. Verode + vial de agua, nivel 8 de Herbología.',
    thanks: '¡Eso es! Mira, mira… ¡se me hinchan las venas! Toma, que te lo has ganado.',
    steps: [
      { id: 'deliver', event: 'deliver', npc: 'airam_forzudo', items: [['pocion_fuerza_3', 2]], count: 1, hint: { talk: 'airam_forzudo' },
        text: 'Lleva 2 pociones de fuerza (3) a Airam en Santa Cruz.', tip: 'Verode + vial de agua (La ASO, La Laguna).' },
    ],
    reward: { coins: 800, items: [['gofio', 5]], xp: { strength: 3000, herblore: 800 }, text: '800 monedas · 5 gofios · 3.000 XP Fuerza · 800 XP Herbología' },
  },
  el_tagoror: {
    id: 'el_tagoror', name: 'El tagoror de Chinamada', giver: 'yeray_pastor',
    summary: 'Los guanches de Chinamada le roban cabras a Yeray. Recomendado: combate 35.',
    offer: ['Los guanches de Chinamada bajan de noche y se llevan mis cabras.', 'No quiero guerra con ellos… pero su mencey no atiende a razones. Si le demuestras que eres más fuerte, quizá nos dejen en paz.'],
    accept: 'Iré al poblado.', doing: 'El poblado está en los riscos del noroeste. Cuidado con los honderos.',
    thanks: '¡Han devuelto las cabras! Y el mencey dice que te respeta. Toma, esto era de mi abuelo.',
    steps: [
      { id: 'warriors', event: 'kill', match: 'guanche_guerrero', count: 4, hint: { x: -620, z: 140 }, text: 'Vence a 4 guerreros guanches.', tip: 'Pelean cuerpo a cuerpo con banot.' },
      { id: 'slingers', event: 'kill', match: 'guanche_hondero', count: 3, hint: { x: -620, z: 140 }, text: 'Vence a 3 honderos guanches.', tip: 'Lanzan piedras de lejos: Protección contra proyectiles.' },
      { id: 'mencey', event: 'kill', match: 'guanche_mencey', count: 1, hint: { x: -619, z: 144 }, text: 'Vence al Mencey en el tagoror.', tip: 'Pega fuerte. Lleva comida y pociones de defensa.' },
      talkBack('yeray_pastor', 'Vuelve con Yeray, el pastor de Vilaflor.'),
    ],
    reward: { coins: 2500, items: [['gofio', 10], ['hierba_tajinaste', 3]], xp: { attack: 4000, defence: 4000 }, text: '2.500 monedas · 10 gofios · 3 tajinastes · 4.000 XP Ataque y Defensa' },
  },
  cronicas_achinech: {
    id: 'cronicas_achinech', name: 'Crónicas de Achinech', giver: 'guia_aldric',
    summary: 'Recorre la isla escuchando a sus cronistas: la historia de Tenerife desde el volcán hasta hoy.',
    offer: ['¿Quieres conocer de verdad esta isla? No la del Cabildo: la de verdad.', 'Hay gente repartida por Achinech que guarda su memoria. Escúchalos a todos, en orden, y vuelve a contarme.'],
    accept: 'Quiero conocer la historia de Achinech.', doing: 'Escucha a los cronistas en orden. Empieza por Doña Elena, aquí en La Laguna.',
    thanks: 'Ahora entiendes por qué esta isla es como es. Guárdalo bien: la memoria también se defiende.',
    steps: [
      { id: 'c1', event: 'talk', match: 'cronista_elena', count: 1, lore: true, hint: { talk: 'cronista_elena' }, text: 'Escucha a Doña Elena, la cronista de La Laguna.', tip: 'Está al sur de la plaza.' },
      { id: 'c2', event: 'talk', match: 'abuelo_guayre', count: 1, lore: true, hint: { talk: 'abuelo_guayre' }, text: 'Escucha al Abuelo Guayre, junto a Chinamada.', tip: 'Vive fuera del poblado, al este. ¡No entres en el poblado sin armas!' },
      { id: 'c3', event: 'talk', match: 'ermitano_candelaria', count: 1, lore: true, hint: { talk: 'ermitano_candelaria' }, text: 'Escucha al Hermano Marcial en la Basílica de Candelaria.', tip: 'Mira también las estatuas de los nueve menceyes.' },
      { id: 'c4', event: 'talk', match: 'abuela_lola', count: 1, lore: true, hint: { talk: 'abuela_lola' }, text: 'Escucha a la Abuela Lola en Acentejo.', tip: 'Junto al camino de La Laguna a La Orotava.' },
      { id: 'c5', event: 'talk', match: 'maestro_rafael', count: 1, lore: true, hint: { talk: 'maestro_rafael' }, text: 'Escucha a Don Rafael en La Orotava.', tip: 'Cerca del centro del pueblo.' },
      { id: 'c6', event: 'talk', match: 'dona_carmen', count: 1, lore: true, hint: { talk: 'dona_carmen' }, text: 'Escucha a Doña Carmen junto al drago de Icod.', tip: 'Icod de los Vinos, al oeste.' },
      talkBack('guia_aldric', 'Vuelve con Aldric en La Laguna.'),
    ],
    reward: { coins: 3000, items: [['gofio', 5]], xp: { prayer: 2000, magic: 1000 }, text: '3.000 monedas · 5 gofios · 2.000 XP Plegaria · 1.000 XP Magia' },
  },
  sombra_cabildo: {
    id: 'sombra_cabildo', name: 'La sombra del Cabildo', giver: 'alma_sacerdotisa',
    summary: 'El Cabildo esconde una orden de magos que quiere liberar a Guayota. Recomendado: combate 60.',
    offer: ['Tengo que contarte algo… y no puede oírlo nadie del Cabildo.', 'Por las noches, magos con capucha roja hacen rituales en el monte de Las Mercedes. Quieren romper el sello de Achamán y liberar a Guayota.', 'Habla primero con Carmita, en La ASO: ella ha visto qué compran.'],
    accept: 'Descubriré qué trama el Cabildo.', doing: 'El Cabildo se reúne en el monte de Las Mercedes, al norte de La Laguna.',
    thanks: 'Has salvado la isla sin que nadie lo sepa. Achamán te lo pagará… y yo también.',
    steps: [
      { id: 'talk', event: 'talk', match: 'carmita_aso', count: 1, hint: { talk: 'carmita_aso' }, text: 'Pregunta a Carmita en La ASO.', tip: 'Su puesto está en la plaza de La Laguna.' },
      { id: 'mix', event: 'herb', match: 'pocion_plegaria_3', count: 1, hint: { talk: 'carmita_aso' }, text: 'Prepara una poción de plegaria (retama del Teide + vial).', tip: 'Necesitas nivel 35 de Herbología. Te hará falta contra el Magister.' },
      { id: 'kill', event: 'kill', match: 'acolito_cabildo', count: 5, hint: { x: -40, z: -560 }, text: 'Derrota a 5 acólitos del Cabildo.', tip: 'Atacan con magia: Protección contra magia.' },
      { id: 'boss', event: 'kill', match: 'magister_cabildo', count: 1, hint: { x: -40, z: -600 }, text: 'Derrota al Magister Perdomo.', tip: 'Sal de los círculos rojos y bebe plegaria cuando te la robe.' },
      talkBack('alma_sacerdotisa', 'Vuelve con Alma junto al altar de La Laguna.'),
    ],
    reward: { coins: 12000, items: [['super_ataque_3', 2], ['super_fuerza_3', 2], ['super_defensa_3', 2]], xp: { prayer: 5000, magic: 5000, herblore: 3000 }, text: '12.000 monedas · 6 súper pociones · XP de Plegaria, Magia y Herbología' },
  },
});

export const QUEST_ORDER = ['tutorial', 'pescador', 'artesano', 'banquero', 'primer_viaje',
  'ratas_granero', 'guiso_abuela', 'faro_apagado', 'aranas_robledal', 'aullidos',
  'mago_huesos', 'encargo_herrera', 'escorpiones', 'golems_mina', 'bestia_blanca',
  // Sesión 50
  'viaje_relampago', 'huesos_ruinas', 'la_fosa', 'bruja_niebla', 'terror_mareas', 'rey_de_las_cumbres', 'matadragones',
  'primeras_pociones', 'dia_de_pierna', 'sombra_cabildo', 'el_tagoror', 'cronicas_achinech',
  // 19 oct — pueblos
  'vino_tacoronte', 'el_tigre'];

/** Misiones que ofrece un NPC. */
export function questsOfNpc(npcId) {
  return QUEST_ORDER.map(id => QUESTS[id]).filter(q => q.giver === npcId);
}

export function getQuest(id) { return QUESTS[id] || null; }

// ============================================================
// Sesión 50 — Requisitos, como en OSRS: niveles y misiones previas.
// El server los comprueba al empezar; la pestaña los muestra con ✓/✗.
// `combat` = nivel de combate (shared/mounts.js → combatLevelFrom).
// ============================================================
export const QUEST_REQS = {
  ratas_granero:      { combat: 3 },
  aranas_robledal:    { combat: 10, quests: ['ratas_granero'] },
  aullidos:           { combat: 15, quests: ['aranas_robledal'] },
  guiso_abuela:       { levels: { cooking: 5 } },
  faro_apagado:       { levels: { woodcutting: 5, firemaking: 5 } },
  encargo_herrera:    { levels: { mining: 15, smithing: 15 } },
  mago_huesos:        { levels: { prayer: 5 } },
  golems_mina:        { combat: 40, levels: { mining: 20 } },
  escorpiones:        { combat: 25 },
  bestia_blanca:      { combat: 50, quests: ['aullidos'] },
  viaje_relampago:    { quests: ['primer_viaje'] },
  huesos_ruinas:      { combat: 45 },
  rey_de_las_cumbres: { combat: 60, quests: ['bestia_blanca'] },
  terror_mareas:      { combat: 55, levels: { prayer: 40 }, quests: ['faro_apagado'] },
  bruja_niebla:       { combat: 50, levels: { prayer: 37 }, quests: ['escorpiones'] },
  la_fosa:            { combat: 50, levels: { prayer: 40 } },
  matadragones:       { combat: 70, quests: ['rey_de_las_cumbres', 'huesos_ruinas'] },
  dia_de_pierna:      { levels: { herblore: 8 }, quests: ['primeras_pociones'] },
  el_tagoror:         { combat: 35 },
  el_tigre:           { levels: { smithing: 15 } },
  sombra_cabildo:     { combat: 60, levels: { herblore: 35, prayer: 37 }, quests: ['primeras_pociones', 'bruja_niebla'] },
};

export const SKILL_NAMES = {
  attack: 'Ataque', strength: 'Fuerza', defence: 'Defensa', hitpoints: 'Vitalidad', ranged: 'Distancia', magic: 'Magia',
  prayer: 'Plegaria', woodcutting: 'Tala', fishing: 'Pesca', mining: 'Minería', cooking: 'Cocina', firemaking: 'Fuego',
  smithing: 'Herrería', fletching: 'Flechería', herblore: 'Herbología', crafting: 'Artesanía', thieving: 'Robo',
};

/** Dificultad orientativa según el combate que pide. */
export function questDifficulty(id) {
  const c = QUEST_REQS[id]?.combat || 0;
  return c >= 60 ? 'Maestro' : c >= 40 ? 'Experimentado' : c >= 15 ? 'Intermedio' : 'Novato';
}

/**
 * Lista de requisitos con si se cumplen.
 * levels: { skillId: nivel, combat: nivel }, done: Set de misiones terminadas.
 * → [{ label, ok }]
 */
export function checkReqs(id, levels = {}, done = new Set()) {
  const R = QUEST_REQS[id]; if (!R) return [];
  const out = [];
  if (R.combat) out.push({ label: `Nivel de combate ${R.combat}`, ok: (levels.combat || 0) >= R.combat });
  for (const [sk, n] of Object.entries(R.levels || {})) out.push({ label: `${n} de ${SKILL_NAMES[sk] || sk}`, ok: (levels[sk] || 1) >= n });
  for (const q of R.quests || []) out.push({ label: `Misión: ${QUESTS[q]?.name || q}`, ok: done.has(q) });
  return out;
}

// ============================================================
// Sesión 52 — HISTORIA PRINCIPAL: «El Sello de Achamán»
// ============================================================
// Seis capítulos encadenados (q.next). Al terminar uno empieza el siguiente
// si cumples sus requisitos; si no, te lo ofrece su personaje más adelante.
//
// Formato extra de los pasos (ver server/lib/quests.js y client/src/story.js):
//   scene:   [línea, …] que se ve al hacer el paso. Una línea es un texto (habla
//            el NPC del paso) o { who: 'player'|'narr'|npcId|'guayota'|'voz', text }.
//   sceneBy: { flag, values: { valor: [líneas] } } → escena según una decisión.
//   sceneAfter: [líneas] → después de la variante. Orden: scene, variante, sceneAfter.
//   visit:   { event: 'visit', at: { x, z, r }, night?: true } → ir a un sitio.
//   choice:  { event: 'choice', flag, npc?, prompt, options: [{ id, label, reply, reward }] }
//   if:      { flag: valor | [valores] } → el paso solo existe si elegiste eso.
// offerScene sustituye a `offer` (diálogo con varios personajes y narrador).
// ============================================================
const N = (text) => ({ who: 'narr', text });
const P = (text) => ({ who: 'player', text });
const S = (who, text) => ({ who, text });

export const SAGA = {
  id: 'sello',
  name: 'El Sello de Achamán',
  summary: 'La historia principal de Achinech: el sello que encierra a Guayota bajo el Teide se agrieta.',
  chapters: ['saga_temblor', 'saga_sotano', 'saga_llaves', 'saga_traicion', 'saga_corona', 'saga_despertar'],
};
// Lugares de la historia (también se dibujan en el mundo: client/src/story.js)
export const STORY_PLACES = {
  grieta:  { x: 420, z: -1560, r: 9,  name: 'Grieta de Las Cañadas' },
  reja:    { x: -52, z: -12,   r: 4,  name: 'Reja del sótano del Cabildo' },
  campamento: { x: 560, z: -1555, r: 6, name: 'Campamento de Tibiabin' },
  boca:    { x: 640, z: -1620, r: 14, name: 'Boca del Teide' },
};

Object.assign(QUESTS, {
  // -------------------------------------------------------------- Capítulo 1
  saga_temblor: {
    id: 'saga_temblor', saga: 'sello', chapter: 1, name: 'La tierra tiembla', giver: 'eldric_mago', next: 'saga_sotano',
    summary: 'El sismógrafo del Observatorio no para de moverse. Algo despierta bajo el Teide. (Historia principal · capítulo 1)',
    offerScene: [
      '¡Forastero! Ven, ven, mira esto.',
      N('Sobre la mesa del observatorio, una aguja tiembla sin parar y dibuja picos sobre un rollo de papel.'),
      'Es un sismógrafo. Lleva tres noches así. El Teide no temblaba de esta manera desde que Achamán lo selló.',
      'Y hay algo peor: anoche vi humo saliendo de una grieta nueva en Las Cañadas. Olía a azufre… y a perro mojado.',
      P('¿A perro?'),
      'Ve y mírala tú. Coge una muestra del azufre y tráemela. Y lleva con qué defenderte, que no me gusta nada ese olor.',
    ],
    accept: 'Iré a la grieta.',
    doing: 'La grieta humea entre Las Cañadas y el Teide. Coge una muestra y vuelve.',
    thanks: 'Ten cuidado ahí fuera. Los tibicenas no salen solos: algo los llama.',
    steps: [
      { id: 'grieta', event: 'visit', at: { x: 420, z: -1560, r: 9 }, hint: { x: 420, z: -1560 }, count: 1,
        text: 'Inspecciona la grieta humeante de Las Cañadas.', tip: 'Entre Las Cañadas y el Teide. Sigue el haz dorado.',
        scene: [
          N('El suelo quema a través de las botas. De la grieta sale un vapor amarillo que pica en los ojos.'),
          N('Entre el azufre hay huellas: patas enormes, de perro… con las uñas marcadas a fuego en la roca.'),
          N('Te agachas a coger una piedra de azufre. Está tibia, y late como si tuviera pulso.'),
          N('Entonces oyes un gruñido detrás de ti.'),
        ],
        reward: { items: [['muestra_azufre', 1]] } },
      { id: 'tibicenas', event: 'kill', match: 'tibicena', count: 3, hint: { npc: 'tibicena' },
        text: 'Defiéndete de los tibicenas (3).', tip: 'Perros negros con los ojos como brasas. Muerden fuerte: lleva comida.' },
      { id: 'informe', event: 'talk', match: 'eldric_mago', count: 1, hint: { talk: 'eldric_mago' },
        text: 'Vuelve con Eldric al Observatorio de Izaña.',
        scene: [
          P('Había perros negros en la grieta. Con los ojos como brasas.'),
          'Tibicenas… los perros de Guayota. Mi abuela decía que bajaban a robar ganado cuando el volcán se enfadaba.',
          N('Eldric frota la piedra de azufre entre los dedos. Se le pone la piel de gallina.'),
          'Esto no es azufre. Está tibio, late… Es sangre de Guayota, forastero. El sello de Achamán se está agrietando.',
        ] },
      { id: 'aviso', event: 'choice', flag: 'aviso', npc: 'eldric_mago', count: 1, hint: { talk: 'eldric_mago' },
        text: 'Decide con Eldric a quién avisar.',
        prompt: '¿A quién avisamos?',
        scene: ['Alguien tiene que saberlo. El Cabildo tiene soldados y dinero; Alma, la sacerdotisa, conoce los ritos antiguos.'],
        options: [
          { id: 'cabildo', label: '🏛️ Al Cabildo: tienen soldados y poder.',
            reply: ['Sensato. El consejero Benítez atiende a la gente junto a la plaza de La Laguna. Llévale la muestra.'] },
          { id: 'alma', label: '🕯️ A Alma: ella conoce los ritos de Achamán.',
            reply: ['Mmm… Alma no se fía del Cabildo. Y a veces pienso que con razón. Búscala junto al altar de La Laguna.'] },
        ] },
    ],
    reward: { coins: 400, xp: { magic: 900, defence: 900, hitpoints: 600 }, text: '400 monedas · XP de Magia, Defensa y Vitalidad' },
  },

  // -------------------------------------------------------------- Capítulo 2
  saga_sotano: {
    id: 'saga_sotano', saga: 'sello', chapter: 2, name: 'Voces bajo el Cabildo', giver: 'alma_sacerdotisa', next: 'saga_llaves',
    summary: 'Alguien en La Laguna sabe más de lo que dice. (Historia principal · capítulo 2)',
    offer: ['El agua del altar hierve sola desde hace días… ¿Vienes por eso, verdad?'],
    accept: 'Cuéntamelo todo.',
    doing: 'Hay una reja del sótano del Cabildo junto a la plaza. De noche se oye lo que hablan abajo.',
    thanks: 'Las tres llaves… Que Achamán nos ampare. Esto no ha hecho más que empezar.',
    steps: [
      { id: 'benitez', event: 'talk', match: 'consejero_benitez', count: 1, if: { aviso: 'cabildo' }, hint: { talk: 'consejero_benitez' },
        text: 'Lleva la muestra al consejero Benítez (La Laguna).',
        scene: [
          '¡Bienvenido, bienvenido! Siéntese. ¿Un cafecito? ¿Un barraquito?',
          P('Vengo del Observatorio. El Teide tiembla y de una grieta salen tibicenas.'),
          N('Le enseñas la piedra de azufre. Los ojos del consejero brillan un instante, rojos como brasas.'),
          'Fascinante… Digo: preocupante. ¡Muy preocupante! Déjemela, que la estudien nuestros expertos.',
          'Y no se preocupe por nada. El Cabildo lo tiene todo bajo control. Todo.',
          N('Al salir, oyes cómo cierra la puerta con llave. Y su voz, al otro lado: «Magister… ha encontrado la grieta».'),
          N('Por la noche, por la reja del sótano, se oirá lo que hablen.'),
        ] },
      { id: 'alma', event: 'talk', match: 'alma_sacerdotisa', count: 1, if: { aviso: 'alma' }, hint: { talk: 'alma_sacerdotisa' },
        text: 'Cuéntale a Alma lo de la grieta.',
        scene: [
          'Te esperaba. Esta mañana el agua bendita del altar hervía sola.',
          P('Eldric dice que el sello de Achamán se agrieta. Y he visto tibicenas.'),
          'Entonces es verdad… Escúchame bien: el Cabildo no es lo que parece. Por las noches se oyen cánticos bajo la plaza.',
          'Junto a la casa del Cabildo hay una reja del sótano. Ve de noche y escucha. Que no te vean.',
        ] },
      { id: 'reja', event: 'visit', night: true, at: { x: -52, z: -12, r: 4 }, hint: { x: -52, z: -12 }, count: 1,
        text: 'De noche, escucha por la reja del sótano del Cabildo (junto a la plaza).',
        tip: 'Solo de noche. La noche dura 12 minutos de cada 40: mira el cielo.',
        scene: [
          N('Por la reja del sótano sale una luz roja y un canto en una lengua muy antigua.'),
          S('consejero_benitez', '«…el forastero nos ha traído justo lo que buscábamos. La grieta de Las Cañadas es la primera herida del sello.»'),
          S('voz', '«No basta una herida, Benítez. Achamán cerró el Teide con tres llaves: la Lágrima, la Piedra y el Añepa. Con las tres, el sello no se arregla… se abre.»'),
          S('consejero_benitez', '«Se hará, Magister. Por el Señor del Fuego.»'),
          N('Alguien apaga las velas. Te alejas de la reja antes de que te vean.'),
        ] },
      { id: 'contar', event: 'talk', match: 'alma_sacerdotisa', count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Cuéntale a Alma lo que oíste.',
        sceneBy: { flag: 'aviso', values: {
          cabildo: [
            P('El consejero Benítez es uno de ellos. Y yo… le di la muestra de la grieta.'),
            'No es culpa tuya, forastero. Nadie sabía nada. Pero ahora ellos saben dónde sangra el sello.',
          ],
          alma: [
            P('El consejero Benítez habla con un tal Magister. Quieren abrir el sello.'),
            'Benítez… El que bendice las fiestas y reparte gofio a los pobres. Qué bien se esconde el diablo.',
          ],
        } },
        sceneAfter: [
          'Las tres llaves… Cuando Achamán venció a Guayota, cerró el Teide con tres regalos:',
          'la Lágrima de Chaxiraxi, la Piedra de Echeyde y el Añepa de Tinerfe, el bastón del primer mencey.',
          'Las llaves sellan… pero también abren. Si el Cabildo las reúne, Guayota saldrá. Tenemos que encontrarlas antes.',
        ] },
    ],
    reward: { coins: 600, xp: { prayer: 1500, magic: 800 }, text: '600 monedas · 1.500 XP Plegaria · 800 XP Magia' },
  },

  // -------------------------------------------------------------- Capítulo 3
  saga_llaves: {
    id: 'saga_llaves', saga: 'sello', chapter: 3, name: 'Las tres llaves', giver: 'alma_sacerdotisa', next: 'saga_traicion',
    summary: 'Encuentra la Lágrima, la Piedra y el Añepa antes que el Cabildo. (Historia principal · capítulo 3)',
    offer: ['La Lágrima la guardan los ermitaños de Candelaria. La Piedra duerme en la Mina de Guajara. Y el Añepa… lo tiene el Mencey de Chinamada.'],
    accept: 'Traeré las tres llaves.',
    doing: 'Candelaria, la Mina de Guajara y Chinamada. Date prisa: el Cabildo también las busca.',
    thanks: 'Las tres… ¡las tres! Guárdalas bien. En cuanto puedas, haremos el rito para reforzar el sello.',
    steps: [
      { id: 'marcial', event: 'talk', match: 'ermitano_candelaria', count: 1, hint: { talk: 'ermitano_candelaria' },
        text: 'Pregunta por la Lágrima al Hermano Marcial (Candelaria).',
        scene: [
          '¿La Lágrima de Chaxiraxi? Los ermitaños la guardamos desde hace quinientos años, sin saber muy bien para qué.',
          'Dicen que es una gota del mar que lloró la Virgen cuando llegó a la playa de Chimisay.',
          'Si de verdad Achamán te envía, reza ante el altar de la basílica. La Lágrima solo se entrega a quien tiene fe.',
        ] },
      { id: 'rezar', event: 'altar', match: 'altar_templo', count: 1, hint: { x: 0, z: -1182 },
        text: 'Reza en el altar de la Basílica de Candelaria.', tip: 'Toca el altar de la basílica.' },
      { id: 'lagrima', event: 'talk', match: 'ermitano_candelaria', count: 1, hint: { talk: 'ermitano_candelaria' },
        text: 'Vuelve con el Hermano Marcial.',
        scene: [
          N('Mientras rezabas, todas las velas de la basílica se encendieron a la vez.'),
          'Lo he visto. Chaxiraxi te ha escuchado. Toma… pesa más de lo que parece.',
          N('Te da una gota de cristal azul. Dentro, el agua se mueve como el mar.'),
        ],
        reward: { items: [['lagrima_chaxiraxi', 1]] } },
      { id: 'ramiro', event: 'talk', match: 'ramiro_capataz', count: 1, hint: { talk: 'ramiro_capataz' },
        text: 'Pregunta por la Piedra a Ramiro (Mina de Guajara).',
        scene: [
          '¿Una piedra que late? Sí… En lo más hondo hay una veta que da calor. Los mineros dicen que de noche suena como un corazón.',
          'Pero los gólems no dejan pasar a nadie. Si acabas con dos, te bajo yo mismo con la lámpara.',
        ] },
      { id: 'golems', event: 'kill', match: 'golem', count: 2, hint: { npc: 'golem' },
        text: 'Derrota a 2 gólems de la cantera de Guajara.', tip: 'Golpean muy fuerte: lleva comida y tu mejor armadura.' },
      { id: 'piedra', event: 'talk', match: 'ramiro_capataz', count: 1, hint: { talk: 'ramiro_capataz' },
        text: 'Vuelve con Ramiro.',
        scene: [
          N('Ramiro te guía por una galería que nadie usa. Al fondo, una piedra negra brilla como un ascua.'),
          'Nunca la había visto tan roja. Cógela y vámonos, que no me gusta este calor.',
        ],
        reward: { items: [['piedra_echeyde', 1]] } },
      { id: 'guayre', event: 'talk', match: 'abuelo_guayre', count: 1, hint: { talk: 'abuelo_guayre' },
        text: 'Pregunta por el Añepa al Abuelo Guayre (junto a Chinamada).',
        scene: [
          'El Añepa de Tinerfe… el bastón del primer mencey de toda la isla. Lo tiene el Mencey de Chinamada, en el tagoror.',
          'No se lo dará a un forastero. A no ser que le ganes en su propio tagoror… o que le lleves un presente digno de un rey.',
        ] },
      { id: 'como', event: 'choice', flag: 'chinamada', npc: 'abuelo_guayre', count: 1, hint: { talk: 'abuelo_guayre' },
        text: 'Decide cómo conseguir el Añepa.', prompt: '¿Cómo conseguirás el Añepa?',
        scene: ['¿Qué vas a hacer, forastero?'],
        options: [
          { id: 'lucha', label: '⚔️ Retar al mencey en el tagoror.', reply: ['Valiente… o loco. Los guanches respetan la fuerza, pero no olvidan una derrota.'] },
          { id: 'presente', label: '🎁 Llevarle un presente: 10 gofios y 3 pieles de vaca.', reply: ['Eso es saber estar. Tráemelos y yo mismo se los llevaré al mencey.'] },
        ] },
      { id: 'mencey', event: 'kill', match: 'guanche_mencey', count: 1, if: { chinamada: 'lucha' }, hint: { x: -619, z: 144 },
        text: 'Vence al Mencey en el tagoror de Chinamada.', tip: 'Pega fuerte. Lleva comida y pociones.' },
      { id: 'presente', event: 'deliver', npc: 'abuelo_guayre', items: [['gofio', 10], ['cowhide', 3]], count: 1, if: { chinamada: 'presente' }, hint: { talk: 'abuelo_guayre' },
        text: 'Lleva 10 gofios y 3 pieles de vaca al Abuelo Guayre.', tip: 'El gofio se compra en la plaza; las pieles, de las vacas o en la peletería.' },
      { id: 'anepa', event: 'talk', match: 'abuelo_guayre', count: 1, hint: { talk: 'abuelo_guayre' },
        text: 'Habla con el Abuelo Guayre.',
        sceneBy: { flag: 'chinamada', values: {
          lucha: [
            'Le has vencido en su propio tagoror… Mis gentes no lo olvidarán, para bien o para mal.',
            N('El abuelo te da un bastón de sabina con una piedra roja engastada. Tiene las manos frías.'),
          ],
          presente: [
            'El mencey aceptó tu presente. Dice que hace cien años que un forastero no respetaba el tagoror.',
            N('El abuelo te da un bastón de sabina con una piedra roja engastada. Sonríe por primera vez.'),
            'Los de Chinamada no olvidan a quien los respeta. Cuando haga falta, estarán ahí.',
          ],
        } },
        reward: { items: [['anepa_tinerfe', 1]] } },
      { id: 'volver', event: 'talk', match: 'alma_sacerdotisa', count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Vuelve con Alma con las tres llaves.' },
    ],
    reward: { coins: 2500, xp: { prayer: 3000, attack: 2000, strength: 2000, defence: 2000 }, text: '2.500 monedas · XP de Plegaria, Ataque, Fuerza y Defensa' },
  },

  // -------------------------------------------------------------- Capítulo 4
  saga_traicion: {
    id: 'saga_traicion', saga: 'sello', chapter: 4, name: 'La traición', giver: 'alma_sacerdotisa', next: 'saga_corona',
    summary: 'El rito para reforzar el sello… y la noche en que el Cabildo dejó de esconderse. (Historia principal · capítulo 4)',
    offer: ['Con las tres llaves en el altar, puedo cantar el sello de Achamán y cerrar la grieta. ¿Estás preparado?'],
    accept: 'Hagamos el rito.',
    doing: 'Detén al Cabildo en el monte de Las Mercedes, al norte de La Laguna.',
    thanks: 'La última harimaguada… Tibiabin. Si alguien sabe cómo entrar en el Teide, es ella.',
    steps: [
      { id: 'llaves', event: 'deliver', npc: 'alma_sacerdotisa', items: [['lagrima_chaxiraxi', 1], ['piedra_echeyde', 1], ['anepa_tinerfe', 1]], count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Entrega las tres llaves a Alma.', tip: 'La Lágrima, la Piedra de Echeyde y el Añepa.' },
      { id: 'rito', event: 'talk', match: 'alma_sacerdotisa', count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Acompaña a Alma en el rito.',
        scene: [
          N('Alma coloca las tres llaves sobre el altar y empieza a cantar en la lengua de los antiguos.'),
          N('La Lágrima brilla, la Piedra late, el Añepa se ilumina… y entonces se abren las puertas de golpe.'),
          N('Entra el consejero Benítez, sonriente, con seis acólitos de capucha roja.'),
          S('consejero_benitez', 'Buenas noches, hermana Alma. Y buenas noches a ti, forastero.'),
        ],
        sceneBy: { flag: 'aviso', values: {
          cabildo: [S('consejero_benitez', 'Te debo una, de verdad: sin tu muestra de azufre nunca habríamos encontrado la grieta. Y ahora nos traes las llaves en bandeja.')],
          alma: [S('consejero_benitez', '¿Creíais que no os oíamos por la reja? El Cabildo lo oye todo, querida.')],
        } },
        sceneAfter: [
          S('consejero_benitez', 'Por orden del Cabildo, estas reliquias quedan confiscadas.'),
          N('Un acólito golpea a Alma, que cae al suelo. Benítez guarda las llaves bajo la túnica y desaparece en una nube de humo rojo.'),
          '(tosiendo) Van al monte de Las Mercedes… El Magister hará allí su rito antes de subir al Teide. ¡Detenlos!',
        ] },
      { id: 'acolitos', event: 'kill', match: 'acolito_cabildo', count: 5, hint: { x: -40, z: -560 },
        text: 'Derrota a 5 acólitos del Cabildo (monte de Las Mercedes).', tip: 'Atacan con magia: Protección contra magia.' },
      { id: 'magister', event: 'kill', match: 'magister_cabildo', count: 1, hint: { x: -40, z: -600 },
        text: 'Derrota al Magister Perdomo.', tip: 'Sal de los círculos rojos y bebe plegaria cuando te la robe.' },
      { id: 'informe', event: 'talk', match: 'alma_sacerdotisa', count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Vuelve con Alma.',
        scene: [
          P('Perdomo ha caído. Pero no tenía las llaves.'),
          P('Antes de morir se rió: «Necios… Benítez ya va camino del Teide».'),
          N('Esa misma noche, el Teide se ilumina por dentro como un farol. Todo Achinech lo ve.'),
          'Entonces el sello ya está abierto… Solo queda una persona que pueda ayudarte: Tibiabin, la última harimaguada.',
          'Vive en las faldas del Teide, al este de Las Cañadas. Dicen que habla con los muertos. Ve, y que Magec te alumbre.',
        ] },
    ],
    reward: { coins: 8000, items: [['pocion_plegaria_3', 4]], xp: { prayer: 5000, magic: 5000, hitpoints: 3000 }, text: '8.000 monedas · 4 pociones de plegaria · XP de Plegaria, Magia y Vitalidad' },
  },

  // -------------------------------------------------------------- Capítulo 5
  saga_corona: {
    id: 'saga_corona', saga: 'sello', chapter: 5, name: 'La corona de Varkhul', giver: 'tibiabin_vidente', next: 'saga_despertar',
    summary: 'Para entrar en el fuego de Guayota hace falta la corona del mencey que pactó con él. (Historia principal · capítulo 5)',
    offerScene: [
      N('Junto a una hoguera de retama, una mujer muy anciana teje sin mirar el telar. Tiene los ojos blancos.'),
      'Te oí llegar desde Las Cañadas, forastero. Pisas fuerte, como los que ya han visto el fuego.',
      'El consejero subió anoche con las tres llaves y abrió la Boca del Teide. Pero no puede entrar: el fuego de Guayota quema a todo el que no le pertenece.',
      'Solo hubo un hombre que caminó por ese fuego: Varkhul, el mencey traidor, que vendió a su pueblo a cambio de no morir nunca.',
      'Su corona está hecha con el pacto. Quien la lleve podrá entrar en el cráter. Búscalo en las Ruinas de Teno.',
    ],
    accept: 'Traeré la corona de Varkhul.',
    doing: 'Varkhul vive en las Ruinas de Teno, en el Malpaís. Allí otros jugadores pueden atacarte.',
    thanks: 'Ahora descansa. Cuando estés listo, subiremos al cráter.',
    steps: [
      { id: 'varkhul', event: 'kill', match: 'rey_esqueleto', count: 1, hint: { x: -1500, z: -440 },
        text: 'Derrota a Varkhul en las Ruinas de Teno (¡Malpaís!).', tip: 'Drena tu plegaria: lleva pociones. Guarda lo valioso en el banco antes.' },
      { id: 'corona', event: 'talk', match: 'tibiabin_vidente', count: 1, hint: { talk: 'tibiabin_vidente' },
        text: 'Lleva la corona de Varkhul a Tibiabin.',
        scene: [
          N('La corona de Varkhul es de hueso negro. Al tocarla oyes una voz dentro de tu cabeza:'),
          S('voz', '«Póntela… y serás eterno, como él.»'),
          '¿La oyes? Es Guayota. Te habla a través de ella. Así compró a Varkhul.',
        ],
        reward: { items: [['corona_varkhul', 1]] } },
      { id: 'tamarco', event: 'choice', flag: 'corona', npc: 'tibiabin_vidente', count: 1, hint: { talk: 'tibiabin_vidente' },
        text: 'Decide qué hacer con la corona.', prompt: '¿Qué haces con la corona?',
        options: [
          { id: 'envolver', label: '🧶 Envolverla en el tamarco de Tibiabin y no escucharla.',
            reply: ['Bien hecho. El tamarco apaga su voz. Te protegerá del fuego sin hacerte su siervo.'] },
          { id: 'escuchar', label: '👂 Escuchar lo que dice la voz.',
            reply: [N('La voz te promete fuego, fuerza, una isla entera a tus pies…'), 'Has escuchado demasiado, forastero. Cuando estés frente a él, recuérdalo: Guayota no da nada gratis.'] },
        ] },
    ],
    reward: { coins: 12000, items: [['shark', 10]], xp: { attack: 6000, strength: 6000, defence: 6000, prayer: 4000 }, text: '12.000 monedas · 10 tiburones · XP de combate y Plegaria' },
  },

  // -------------------------------------------------------------- Capítulo 6
  saga_despertar: {
    id: 'saga_despertar', saga: 'sello', chapter: 6, name: 'El despertar de Guayota', giver: 'tibiabin_vidente',
    summary: 'La Boca del Teide está abierta. El final de la historia. (Historia principal · capítulo 6)',
    offer: ['Esta noche Magec se esconderá: es la noche que Guayota esperaba. ¿Subirás conmigo al cráter?'],
    accept: 'Subamos al cráter.',
    doing: 'La Boca del Teide está al norte de mi campamento. Cuando el sol se apague, busca la luz.',
    thanks: 'Se acabó, hijo de ninguna parte. Su cuerpo de fuego se rehará con el tiempo: quien quiera probarse, que baje al cráter.',
    steps: [
      { id: 'preparar', event: 'talk', match: 'tibiabin_vidente', count: 1, hint: { talk: 'tibiabin_vidente' },
        text: 'Escucha a Tibiabin antes de subir.',
        scene: [
          'En el cráter verás círculos de luz dorada: son los últimos rayos de Magec atrapados en la roca.',
          'Cuando Guayota se coma el sol, métete en uno o arderás. Y cuando aúlle, vendrán sus tibicenas: acaba con ellos primero.',
        ],
        sceneBy: { flag: 'chinamada', values: {
          presente: ['Los guerreros de Chinamada vigilan el camino. No olvidan a quien respetó su tagoror.'],
          lucha: ['Los de Chinamada no subirán: aún te recuerdan en el tagoror. Irás solo.'],
        } } },
      { id: 'guardianes', event: 'kill', match: 'acolito_cabildo', count: 4, hint: { x: 612, z: -1588 },
        text: 'Derrota a 4 acólitos que guardan la subida al cráter.', tip: 'Están en el camino a la Boca del Teide.' },
      { id: 'boca', event: 'visit', at: { x: 640, z: -1620, r: 18 }, hint: { x: 640, z: -1620 }, count: 1,
        text: 'Entra en la Boca del Teide.',
        scene: [
          N('En el centro del cráter, el consejero Benítez levanta las tres llaves sobre la lava.'),
          S('consejero_benitez', '¡Señor del Fuego! ¡Tu siervo te ha liberado! ¡Dame tu poder, como me prometiste!'),
          N('La lava se alza como una ola. Una mano enorme, de roca y fuego, sale del cráter… y aplasta al consejero.'),
          S('guayota', 'NO TENGO SIERVOS. TENGO CENIZA.'),
          N('Dos ojos como soles se clavan en ti. Las tres llaves caen a la lava, al rojo vivo.'),
          S('guayota', 'Y TÚ, PEQUEÑO… ¿VIENES A SELLARME… O A SERVIRME?'),
        ],
        sceneBy: { flag: 'corona', values: {
          escuchar: [S('guayota', 'TE OÍ ESCUCHARME A TRAVÉS DE LA CORONA. SÉ LO QUE DESEAS.')],
          envolver: [S('guayota', 'ESE TRAPO DE VIEJA NO TE SALVARÁ.')],
        } } },
      { id: 'guayota', event: 'kill', match: 'guayota', count: 1, hint: { x: 640, z: -1620 },
        text: 'Derrota a Guayota.', tip: 'Protección contra magia. Fase 2: mata a los tibicenas. Fase 3: en el ECLIPSE, métete en un círculo de luz.' },
      { id: 'final', event: 'choice', flag: 'final', count: 1, hint: { x: 640, z: -1620 },
        text: 'Decide el destino del corazón de Guayota.', prompt: 'El corazón de Guayota',
        scene: [
          N('Guayota se derrumba sobre la lava. Su corazón, una piedra que late como un tambor, rueda hasta tus pies.'),
          N('Desde el borde del cráter, Tibiabin grita:'),
          S('tibiabin_vidente', '¡Rápido, antes de que se rehaga! Las llaves están en la lava: con su corazón puedes sellar el Teide otra vez… o quedarte con su poder.'),
        ],
        options: [
          { id: 'sello', label: '🌞 Arrojar el corazón a la lava y cantar el sello de Achamán.',
            reply: [N('Lanzas el corazón a la lava. Las tres llaves se funden con él y la roca se cierra como una boca.'),
                    N('Amanece. Magec vuelve a salir sobre Achinech, y en el cráter queda una capa de luz dorada.'),
                    S('tibiabin_vidente', 'Achamán te lo agradece, hijo de ninguna parte. La isla dormirá tranquila otros mil años.')],
            reward: { items: [['cape_sello', 1]] } },
          { id: 'pacto', label: '🔥 Quedarte el corazón de Guayota y su poder.',
            reply: [N('Aprietas el corazón contra el pecho. El fuego no te quema: te obedece.'),
                    N('El cráter se cierra de todos modos… pero en tu espalda arde una capa de magma vivo.'),
                    S('guayota', 'AHORA SOMOS UNO, PEQUEÑO. YA HABLAREMOS.'),
                    S('tibiabin_vidente', 'Lo que has hecho no tiene vuelta atrás. Que Achamán se apiade de ti.')],
            reward: { items: [['cape_guayota', 1]] } },
        ] },
      { id: 'epilogo', event: 'talk', match: 'alma_sacerdotisa', count: 1, hint: { talk: 'alma_sacerdotisa' },
        text: 'Vuelve con Alma a La Laguna.',
        sceneBy: { flag: 'final', values: {
          sello: [
            '¡Lo sentí en el altar! El agua dejó de hervir de golpe. ¡Lo has conseguido!',
            'La isla nunca sabrá lo que hiciste por ella. Pero yo sí. Y Achamán también.',
          ],
          pacto: [
            'El agua del altar sigue tibia… ¿Qué llevas ahí, en el pecho? Late como un tambor.',
            'No, no me lo digas. Has cerrado el Teide, y eso te lo agradezco. Pero vete en paz… si puedes.',
          ],
        } } },
    ],
    reward: { coins: 30000, items: [['super_bones', 3]], xp: { attack: 15000, strength: 15000, defence: 15000, ranged: 10000, magic: 10000, prayer: 8000, hitpoints: 10000 },
      text: '30.000 monedas · 3 súper huesos · mucha XP · y la capa que elegiste' },
  },
});

QUEST_ORDER.push(...SAGA.chapters);
Object.assign(QUEST_REQS, {
  saga_temblor:   { combat: 15 },
  saga_sotano:    { combat: 15, quests: ['saga_temblor'] },
  saga_llaves:    { combat: 35, quests: ['saga_sotano'] },
  saga_traicion:  { combat: 55, levels: { prayer: 37 }, quests: ['saga_llaves'] },
  saga_corona:    { combat: 65, quests: ['saga_traicion'] },
  saga_despertar: { combat: 70, levels: { prayer: 43 }, quests: ['saga_corona'] },
});

// ============================================================
// 19 oct — Misiones cortas de los pueblos (edificios: shared/town_buildings.js)
// ============================================================
Object.assign(QUESTS, {
  vino_tacoronte: {
    id: 'vino_tacoronte', name: 'El vino que no llegó', giver: 'tabernero_fefo',
    summary: 'Fefo, el tabernero de La Vieja Aguere (La Laguna), se ha quedado sin el vino de Tacoronte. Recomendado: combate 3.',
    offer: ['El carro del vino de Tacoronte tenía que llegar ayer… y aquí no ha llegado ni una gota.', 'El arriero jura que dejó los barriles en la plaza. Y en la plaza, ¿quién duerme? Adonay. Pregúntale, anda.'],
    accept: 'Voy a hablar con Adonay.', doing: 'Adonay pasea por la plaza de La Laguna. Si no lo ves, sigue el olor.',
    thanks: '¿Las ratas? ¿Y Adonay se bebió un barril entero? ¡Ese sinvergüenza! Bueno, al menos el resto se salva. Toma, invita la casa.',
    steps: [
      { id: 'adonay', event: 'talk', match: 'adonay_vagabundo', count: 1, hint: { talk: 'adonay_vagabundo' },
        text: 'Pregunta a Adonay, el vagabundo de la plaza, por el vino.', tip: 'Da vueltas por la plaza de La Laguna.',
        scene: [
          '¿El vino? ¿Qué vino? Yo no he visto ningún vino, mi niño. *hip*',
          N('Adonay lleva la camisa manchada de morado hasta el cuello.'),
          'Bueno… a lo mejor me caí encima de un barril. Y a lo mejor se abrió. Y a lo mejor me lo bebí pa\' que no se perdiera. ¡Por civismo!',
          'Los otros dos se los llevaron rodando unas ratas gordísimas pa\'l campo del este. ¡Grandes como cabras, te lo juro!',
        ] },
      { id: 'ratas', event: 'kill', match: 'rat', count: 3, hint: { npc: 'rat' },
        text: 'Espanta a las ratas que se llevaron los barriles: mata 3 ratas gigantes.', tip: 'En los Campos de las ratas, al este de La Laguna.' },
      talkBack('tabernero_fefo', 'Vuelve con Fefo a la Taberna La Vieja Aguere.', 20),
    ],
    reward: { coins: 150, items: [['pan', 4], ['cooked_beef', 3]], xp: { cooking: 300, attack: 150 }, text: '150 monedas · 4 panes · 3 de ternera · 300 XP Cocina · 150 XP Ataque' },
  },
  el_tigre: {
    id: 'el_tigre', name: 'El Tigre de Paso Alto', giver: 'herrero_chano',
    summary: 'El Maestro Chano, herrero del muelle de Santa Cruz, quiere reparar El Tigre, el viejo cañón del puerto.',
    offer: ['¿Ves ese cañón del rincón? Es El Tigre. Hace muchos años echó del puerto a una flota entera.', 'Sir Beneharo quiere que dispare en las fiestas, pero tiene los aros de hierro rotos… y yo no tengo hierro.', 'Tráeme 3 lingotes de hierro y te enseño cómo se trabaja en el muelle.'],
    accept: 'Le traeré el hierro, Maestro.', doing: '3 lingotes de hierro. Pica hierro y fúndelo en un horno (nivel 15 de Herrería).',
    thanks: '¡Mira cómo brilla! Ya no es un cañón: es un tigre otra vez. Toma, que te lo has ganado, y aprende lo que viste.',
    steps: [
      { id: 'hierro', event: 'deliver', npc: 'herrero_chano', items: [['bar_hierro', 3]], count: 1, hint: { talk: 'herrero_chano' },
        text: 'Lleva 3 lingotes de hierro al Maestro Chano (Herrería del Muelle, Santa Cruz).', tip: 'Pica hierro en la Cantera de La Laguna y fúndelo en su horno.',
        scene: [N('Chano mete los lingotes en la forja. El taller se llena de chispas y del ruido del martillo.'), 'Ya está. Aros nuevos, como el primer día. Ahora ve a avisar a Sir Beneharo: está en la plaza, haciéndose el importante.'] },
      { id: 'beneharo', event: 'talk', match: 'caballero_anaga', count: 1, hint: { talk: 'caballero_anaga' },
        text: 'Avisa a Sir Beneharo, en la plaza de Santa Cruz, de que El Tigre está listo.', tip: 'Junto a la casona del banco.',
        scene: [
          P('Sir Beneharo, el Maestro Chano dice que El Tigre ya está reparado.'),
          '¿De verdad? ¡Por fin! Ese cañón defendió el puerto cuando nadie más podía.',
          'En las fiestas dispararemos una salva por los que cayeron aquel verano. Dile a Chano que el café de esta semana corre de mi cuenta.',
        ] },
      talkBack('herrero_chano', 'Vuelve con el Maestro Chano a la Herrería del Muelle.'),
    ],
    reward: { coins: 400, items: [['bar_hierro', 2]], xp: { smithing: 1500 }, text: '400 monedas · 2 lingotes de hierro · 1.500 XP Herrería' },
  },
});
