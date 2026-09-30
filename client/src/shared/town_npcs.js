/**
 * SebasPresent — Habitantes del mundo (Sesión 50)
 *
 * NPCs con los que se HABLA (no se pelea): guías, artesanos, granjeros,
 * guardias... Inspirados en OSRS: cada pueblo tiene su gente, algunos dan
 * misiones (el "!" amarillo sobre la cabeza) y otros dan consejos.
 *
 * MÓDULO COMPARTIDO: el server usa las posiciones para validar que estás al
 * lado cuando hablas / entregas algo.
 *
 * look: colores del modelo procedural (piel, camisa, pantalón, pelo) y
 *       accesorio: 'hood' | 'hat' | 'helm' | 'wizard' | 'apron' | 'crown' | 'bandana' | null
 * role: icono del retrato en el cuadro de diálogo.
 * lines: frases al hablar (si no hay misión que ofrecer / seguir).
 * actions: botones extra en el diálogo ('bank' | 'shop' | 'ge').
 */

export const TALK_DIST_M = 3.0;        // cliente
export const TALK_DIST_SERVER_M = 9.0; // server (posición del heartbeat con algo de retraso)

export const TOWN_NPCS = [
  // ----------------------------------------------------- La Laguna
  { id: 'guia_aldric', name: 'Aldric', title: 'Guía de La Laguna', x: 12, z: -14, rotY: 2.4, role: '🧭',
    look: { skin: 0xe8b98c, shirt: 0x2f5d8a, pants: 0x3a3226, hair: 0x9a9a9a, acc: 'hat' },
    lines: [
      '¡Bienvenido a Tenerife, forastero! Estás en La Laguna, donde empiezan todos los caminos de la isla.',
      'Si no sabes qué hacer, mira tus misiones (📜). Y fíjate en la gente con un "!" amarillo encima: tienen trabajo para ti.',
      'Hay cofres de banco por todo el mapa (la moneda dorada del minimapa). Todos abren el mismo banco.',
      'Al oeste, más allá de Santiago del Teide, empieza el Malpaís (wilderness). Allí se puede pelear entre jugadores… y perderlo todo.',
    ] },
  { id: 'banquero_gerardo', name: 'Gerardo', title: 'Banquero', x: -19, z: 13, rotY: 1.2, role: '🏦',
    look: { skin: 0xd9a57a, shirt: 0x5a1f2a, pants: 0x1f1f24, hair: 0x2a1a10, acc: 'crown' },
    actions: ['bank'],
    lines: [
      'El Banco de La Laguna guarda tus cosas en todos los cofres de la isla. Magia burocrática, lo llamamos.',
      'Consejo de banquero: saca tus troncos y minerales como NOTAS y véndelos en el Mercado. Ocupan un solo hueco.',
    ] },
  { id: 'lia_artesana', name: 'Lía', title: 'Artesana', x: 18, z: 16, rotY: 3.6, role: '🧵',
    look: { skin: 0xf0c8a0, shirt: 0x7a5a2a, pants: 0x4a3a2a, hair: 0xa0522d, acc: 'apron' },
    lines: [
      'Un buen cuchillo y una buena aguja valen más que una espada. Bueno… casi.',
      'Las vacas del sur sueltan piel. Curte la piel y tendrás cuero para coser.',
    ] },
  { id: 'morgana_maga', name: 'Morgana', title: 'Tienda de magia', x: -14, z: -19, rotY: 0.6, role: '🔮',
    look: { skin: 0xf0d0b0, shirt: 0x5a2a7a, pants: 0x3a1a4a, hair: 0x1a1a2a, acc: 'wizard' },
    actions: ['shop:magic_store'],
    lines: [
      'Bienvenido a mi tienda. Tabletas de teletransporte a todos los rincones de la isla.',
      'Rompe la tableta y ¡zas!, estás allí. Pero en lo profundo del Malpaís la magia no responde.',
      'Cada tableta te deja cerca de alguien que necesita ayuda. Aprovecha el viaje.',
    ] },
  { id: 'pregonero', name: 'Pregonero', title: 'Anuncios de la isla', x: 8, z: 22, rotY: 3.3, role: '📣',
    look: { skin: 0xe0b08a, shirt: 0xa0782a, pants: 0x3a2a1a, hair: 0x5a3a1a, acc: 'hat' },
    lines: [
      '¡Oíd, oíd! Se buscan valientes: la granjera Rosa tiene ratas en el granero, al sur.',
      '¡Oíd, oíd! En Las Cañadas la herrera Nuria necesita lingotes de hierro.',
      '¡Oíd, oíd! Dicen que en la Mina de Guajara los gólems han despertado…',
      '¡Oíd, oíd! Cuidado en la wilderness: quien ataca primero lleva calavera.',
    ] },
  { id: 'guardia_concejo', name: 'Guardia', title: 'Guardia de La Laguna', x: -26, z: -8, rotY: 1.6, role: '🛡',
    look: { skin: 0xd9a57a, shirt: 0x8a8f96, pants: 0x3a3f46, hair: 0x2a1a10, acc: 'helm' },
    lines: [
      'Circule, circule.',
      'Llevo veinte años de guardia y nunca ha pasado nada. Ojalá siga así.',
      'Si vas a la wilderness, ve ligero. Lo que lleves encima puede acabar en manos de otro.',
    ] },

  // ----------------------------------------------------- Alrededores del spawn
  { id: 'tomas_pescador', name: 'Tomás', title: 'Pescador', x: -58, z: -139, rotY: 0.5, role: '🎣',
    look: { skin: 0xc98f62, shirt: 0x3a6a4a, pants: 0x4a4030, hair: 0x6a6a6a, acc: 'bandana' },
    lines: [
      'Los bancos de peces se mueven cada pocos minutos. Si desaparecen las burbujas, busca otras.',
      'Con caña se pescan truchas y salmones, pero gastas una pluma por pez. Los pollos sueltan plumas.',
      'Dicen que en la costa del Malpaís hay tiburones. Yo no pienso ir.',
    ] },
  { id: 'brom_herrero', name: 'Brom', title: 'Herrero', x: 97, z: -87, rotY: 0.2, role: '🔨',
    look: { skin: 0xb07a52, shirt: 0x3a2a1e, pants: 0x2a2018, hair: 0x1a1a1a, acc: 'apron' },
    lines: [
      'Funde el mineral en el horno y forja en el yunque. Espada, 1 lingote; escudo, 2; espadón, 3.',
      'El bronce es para aprender. Con acero ya se nota la diferencia.',
      'Las espadas buenas, de oro para arriba, tienen ataque especial. Barra verde en la pestaña de combate.',
    ] },
  { id: 'gus_minero', name: 'Gus', title: 'Minero', x: 127, z: -86, rotY: 3.9, role: '⛏',
    look: { skin: 0xd9a57a, shirt: 0x6a4a2a, pants: 0x3a3a3a, hair: 0x8a6a3a, acc: 'helm' },
    lines: [
      'Las vetas brillan con el color de su mineral. Naranja bronce, gris hierro, azul acero…',
      'Cuando una veta se agota, espera un poco y vuelve a salir.',
      'La obsidiana, la basaltita y el teiderio solo salen en la wilderness. Cuanto más al oeste, mejor… y más peligroso.',
    ] },
  { id: 'alma_sacerdotisa', name: 'Alma', title: 'Sacerdotisa', x: -34, z: -96, rotY: 5.4, role: '✦',
    look: { skin: 0xf0d0b0, shirt: 0xe8e0d0, pants: 0xe8e0d0, hair: 0xf0e0a0, acc: 'hood' },
    lines: [
      'Entierra los huesos de tus enemigos y la luz te lo agradecerá.',
      'Reza en el altar para recuperar tus puntos de plegaria.',
      '"Protegerse del cuerpo a cuerpo" te salva la vida ante cualquier bestia. Llega a nivel 43.',
    ] },
  { id: 'rosa_granjera', name: 'Rosa', title: 'Granjera', x: 40, z: 150, rotY: 3.1, role: '🌾',
    look: { skin: 0xe8b98c, shirt: 0xb04a3a, pants: 0x4a5a8a, hair: 0xc08040, acc: 'hat' },
    lines: [
      'Mis vacas dan la mejor leche de la isla. Y la mejor piel, si hace falta.',
      'Los pollos sueltan plumas. ¡Llévate las que quieras!',
    ] },

  // ----------------------------------------------------- Ciudades y pueblos
  { id: 'joaquin_lenador', name: 'Joaquín', title: 'Leñador de La Orotava', x: -285, z: -683, rotY: 0.8, role: '🪓',
    look: { skin: 0xc98f62, shirt: 0x8a2a2a, pants: 0x3a3226, hair: 0x5a2a0a, acc: 'hat' },
    lines: [
      'Los robles dan buena madera. Los tejos, mejor aún, si tienes nivel.',
      'Al sur del bosque las arañas hacen nidos del tamaño de un carro.',
    ] },
  { id: 'bruno_cazador', name: 'Bruno', title: 'Cazador', x: -690, z: -188, rotY: 2.2, role: '🏹',
    look: { skin: 0xb07a52, shirt: 0x4a5a2a, pants: 0x3a3020, hair: 0x2a1a10, acc: 'hood' },
    lines: [
      'Un arco de roble y flechas de hierro: con eso cazo casi todo.',
      'Las pieles de lobo dan buen cuero. El cuero cosido protege sin estorbar al disparar.',
    ] },
  { id: 'petra_abuela', name: 'Petra', title: 'Abuela de Vilaflor', x: -395, z: 392, rotY: 0.9, role: '🍲',
    look: { skin: 0xf0c8a0, shirt: 0x6a3a5a, pants: 0x4a3a4a, hair: 0xe0e0e0, acc: 'hood' },
    lines: [
      'Pasa, pasa, que el guiso está al fuego.',
      'Cuanto mejor cocines, menos se te quema. Lo dice la experiencia.',
    ] },
  { id: 'irene_farera', name: 'Irene', title: 'Farera', x: -790, z: 1392, rotY: 0.3, role: '🗼',
    look: { skin: 0xd9a57a, shirt: 0x2a4a7a, pants: 0x2a2a3a, hair: 0x1a1a1a, acc: 'bandana' },
    lines: [
      'Desde el faro se ve toda la Costa del Sur. Buenas gambas, y atún si llevas arpón.',
    ] },
  { id: 'nuria_herrera', name: 'Nuria', title: 'Herrera de Las Cañadas', x: 215, z: -1683, rotY: 4.1, role: '⚒',
    look: { skin: 0xe0b08a, shirt: 0x3a3f46, pants: 0x2a2a2a, hair: 0xb03a1a, acc: 'apron' },
    lines: [
      'El frío templa bien el acero. Por eso forjo aquí arriba.',
      'Los yetis de la montaña dan miedo, pero sus huesos rezan bien.',
    ] },
  { id: 'sven_guardia', name: 'Sven', title: 'Guardia de La Esperanza', x: 707, z: -1082, rotY: 2.7, role: '🛡',
    look: { skin: 0xf0d0b0, shirt: 0x6a7a8a, pants: 0x3a3f46, hair: 0xe0c070, acc: 'helm' },
    lines: [
      'El viento de aquí te corta la cara. Abrígate.',
    ] },
  { id: 'eldric_mago', name: 'Eldric', title: 'Mago del Observatorio', x: 410, z: -888, rotY: 0.4, role: '🔮',
    look: { skin: 0xe8c8a8, shirt: 0x3a3a8a, pants: 0x3a3a8a, hair: 0xe0e0e0, acc: 'wizard' },
    actions: ['shop:magic_store'],
    lines: [
      'La magia no es más que paciencia con buen gusto.',
      'Con un bastón equipado tu maná se regenera más rápido.',
    ] },
  { id: 'ramiro_capataz', name: 'Ramiro', title: 'Capataz de la Mina', x: 1180, z: -1452, rotY: 5.9, role: '⛏',
    look: { skin: 0xc98f62, shirt: 0x8a6a2a, pants: 0x3a3a3a, hair: 0x3a3a3a, acc: 'helm' },
    lines: [
      'Aquí abajo hay acero y oro de sobra. El problema son los guardianes.',
    ] },
  { id: 'samir_mercader', name: 'Samir', title: 'Mercader de Güímar', x: 1508, z: 88, rotY: 3.4, role: '🐫',
    look: { skin: 0xa06a42, shirt: 0xe0c070, pants: 0xe8e0d0, hair: 0x1a1a1a, acc: 'bandana' },
    lines: [
      'Todo se compra y todo se vende, amigo. Hasta la arena, si sabes a quién.',
      'El Mercado (GE) de La Laguna es donde de verdad se mueve el dinero.',
    ] },
  { id: 'explorador_herido', name: 'Explorador herido', title: 'Superviviente', x: -1010, z: 8, rotY: 1.6, role: '🩹',
    look: { skin: 0xd9a57a, shirt: 0x5a4a3a, pants: 0x3a3226, hair: 0x5a3a1a, acc: 'bandana' },
    lines: [
      'No sigas hacia el oeste… Allí empieza el Malpaís.',
      'Allí cualquiera puede atacarte. Si atacas tú primero, te marcan con una calavera: si mueres, lo pierdes TODO.',
      'Pero los mejores minerales están allí. Obsidiana, basaltita… teiderio. Decide tú.',
    ] },
  // Sesión 50 — La Fosa de Guayota (minijuego de oleadas)
  { id: 'kargath', name: 'Kargath', title: 'Guardián de la Fosa', x: 1864, z: -306, rotY: 3.14, role: '🔥',
    look: { skin: 0x8a5a3a, shirt: 0x7a1a0a, pants: 0x2a1a10, hair: 0x1a1a1a, acc: 'helm' },
    actions: ['fosa'],
    lines: [
      'Bienvenido a la Fosa de Guayota. Doce rondas de criaturas de lava… y al final, GUAYOTA.',
      'Cada criatura pega a su manera: los diablillos y brutos cuerpo a cuerpo, los escupefuegos con proyectiles y los espíritus con magia. Usa la protección adecuada.',
      'Guayota BRILLA antes de atacar: verde = proyectiles, azul = magia. Cambia tu plegaria a tiempo.',
      'Si caes ahí abajo no pierdes nada: te saco yo. Pero sin capa, claro.',
    ] },
];

export const TOWN_NPCS_BY_ID = Object.fromEntries(TOWN_NPCS.map(n => [n.id, n]));
