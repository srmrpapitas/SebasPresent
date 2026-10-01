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

import { CASTLES, bankerSpot } from './castles.js';
const CASONA_LOOK = {
  banquera_dacil:    { name: 'Dácil',    title: 'Banquera de Santa Cruz',     look: { skin: 0xc8946a, shirt: 0x2a4a6a, pants: 0x1f1f24, hair: 0x1a1008, acc: 'apron' } },
  banquero_acaymo:   { name: 'Acaymo',   title: 'Banquero de Adeje',          look: { skin: 0xb07a52, shirt: 0x5a1f2a, pants: 0x1f1f24, hair: 0x1a1a1a, acc: 'hat' } },
  banquera_cathaysa: { name: 'Cathaysa', title: 'Banquera de Los Cristianos', look: { skin: 0xd9a57a, shirt: 0x2f6a3a, pants: 0x1f1f24, hair: 0x3a2010, acc: 'apron' } },
};
const CASONA_BANKERS = CASTLES.map(c => {
  const s = bankerSpot(c), L = CASONA_LOOK[c.banker];
  return { id: c.banker, name: L.name, title: L.title, x: s.x, z: s.z, rotY: s.rotY, role: '🏦', look: L.look,
    actions: ['bank', 'ge', 'shop:general_store'],
    lines: [
      `Bienvenido a la ${c.name}. Banco, Mercado y tienda, todo en la misma puerta.`,
      'Lo que guardas aquí lo tienes en cualquier banco de la isla.',
    ] };
});

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
  // Sesión 50 — La ASO (herboristería) y personajes canarios
  { id: 'carmita_aso', name: 'Carmita', title: 'Herbolaria de La ASO', x: -8, z: 28, rotY: 3.3, role: '🌿',
    look: { skin: 0xd9a57a, shirt: 0x2f6a3a, pants: 0x3a2a1a, hair: 0x2a1a10, acc: 'apron' },
    actions: ['shop:aso'], stall: { sign: 'LA ASO' },
    lines: [
      '¿Qué pasó, muyayo? Esto es La ASO: las mejores hierbas de la isla. Pero solo pa\' socios, ¿eh?',
      'Hierba, un vial de agua y a mezclar: eso es una poción. Y si le echas gofio, ¡fuerte cosa, chacho!',
      'La tabaiba pa\' pegar, el verode pa\' la fuerza, la salvia pa\' aguantar… y la retama del Teide pa\' rezar. No hay más, mi niño.',
      'Últimamente los del Cabildo me arrasan con la retama y el tajinaste. ¿Pa\' qué querrán tanto? Me da un fleje de mala espina…',
      'Aquí no entra cualquiera, ¿sabes? O vienes con un socio o sueltas tus pavos. Normas de la casa.',
    ] },
  { id: 'airam_forzudo', name: 'Airam', title: 'el Forzudo de Santa Cruz', x: 1700, z: -775, rotY: 2.4, role: '💪',
    look: { skin: 0xc08a5a, shirt: 0xb02020, pants: 0x1a1a1a, hair: 0x1a1a1a, acc: 'bandana' },
    lines: [
      '¡Mira qué bíceps, chacho! Esto no sale solo, esto es entreno y gofio.',
      'Nunca te saltes el día de pierna. Nunca.',
      'Un buen guerrero se toma su poción de fuerza antes de pelear. Y después, un escaldón de gofio.',
    ] },
  { id: 'yeray_pastor', name: 'Yeray', title: 'Pastor de Vilaflor', x: -410, z: 412, rotY: 1.2, role: '🐐',
    look: { skin: 0xb07a52, shirt: 0x8a6a3a, pants: 0x4a3a2a, hair: 0x2a1a10, acc: 'hat' },
    lines: [
      'Mis cabras suben hasta el páramo de Erjos… y algunas no vuelven. Dicen que allí vive la bruja Chona.',
      'Por las noches se ven luces rojas en el monte de Las Mercedes. Gente con capucha. Yo no me acerco.',
    ] },
  // Sesión 50 — banqueros de las casonas del banco (shared/castles.js)
  ...CASONA_BANKERS,
  // Sesión 50 — Cronistas de Achinech (la historia de Tenerife, misión "Crónicas de Achinech")
  { id: 'cronista_elena', name: 'Doña Elena', title: 'Cronista de La Laguna', x: 26, z: -34, rotY: 2.6, role: '📜',
    look: { skin: 0xd9a57a, shirt: 0x4a3a6a, pants: 0x2a2a2a, hair: 0x5a4a3a, acc: 'hood' },
    lines: ['Llevo cuarenta años escribiendo la historia de esta isla. Y todavía me sorprende.',
            'Si quieres entender Achinech, empieza por el principio: el fuego y el mar.'] },
  { id: 'abuelo_guayre', name: 'Abuelo Guayre', title: 'Pastor de las cumbres', x: -575, z: 150, rotY: -1.6, role: '🐐',
    look: { skin: 0x9a6a42, shirt: 0x8a6a3a, pants: 0x5a4a2a, hair: 0xdadada, acc: 'none' },
    lines: ['Mis abuelos eran de Chinamada. Yo vivo fuera del poblado: ya no me dejan entrar. Cosas de viejos.',
            'Los de dentro se creen los últimos guanches. Guanches somos todos los de aquí, mi niño, aunque hayamos olvidado la lengua.'] },
  { id: 'ermitano_candelaria', name: 'Hermano Marcial', title: 'Ermitaño de Candelaria', x: 12, z: -1188, rotY: 3.6, role: '🕯️',
    look: { skin: 0xc8946a, shirt: 0x5a4a3a, pants: 0x5a4a3a, hair: 0x8a8a8a, acc: 'hood' },
    lines: ['La paz de Chaxiraxi contigo, caminante.',
            'Cada agosto vienen peregrinos andando desde toda la isla. Algunos, descalzos.'] },
  { id: 'abuela_lola', name: 'Abuela Lola', title: 'Vecina de Acentejo', x: -109, z: -348, rotY: 1.2, role: '🧶',
    look: { skin: 0xd0a07a, shirt: 0x2a2a2a, pants: 0x2a2a2a, hair: 0xe8e8e8, acc: 'apron' },
    lines: ['Aquí al lado está el barranco de Acentejo. Mi madre decía que de noche todavía se oyen los gritos.',
            '¿Tú sabes por qué un pueblo se llama La Matanza y el de al lado La Victoria? Siéntate, que te cuento.'] },
  { id: 'maestro_rafael', name: 'Don Rafael', title: 'Maestro de escuela de La Orotava', x: -318, z: -722, rotY: 0.6, role: '📚',
    look: { skin: 0xd9a57a, shirt: 0x2a3a5a, pants: 0x1a1a2a, hair: 0x3a3a3a, acc: 'glasses' },
    lines: ['A mis alumnos les enseño la historia del valle de Taoro. Era el menceyato más rico de la isla.',
            'La historia la escriben los que ganan. Por eso hay que escuchar también a los que perdieron.'] },
  { id: 'dona_carmen', name: 'Doña Carmen', title: 'Guardiana del drago', x: -672, z: -226, rotY: 2.2, role: '🌳',
    look: { skin: 0xc8946a, shirt: 0x2f6a3a, pants: 0x3a2a1a, hair: 0x2a1a10, acc: 'apron' },
    lines: ['Este drago tiene más años que todos los reyes de España juntos. Bueno, casi.',
            'Lo que fueron los guanches sigue aquí: en las palabras, en el gofio, en la cara de la gente.'] },
  // Sesión 50 — Arico, el pueblo blanco
  { id: 'alcalde_faustino', name: 'Don Faustino', title: 'Alcalde de Arico', x: 1088, z: 612, rotY: 2.4, role: '🏛️',
    look: { skin: 0xc8946a, shirt: 0xf4f0e6, pants: 0x2a2a2a, hair: 0x8a8a8a, acc: 'hat' },
    lines: [
      'Bienvenido a Arico. Aquí todas las casas son blancas: lo firmé yo mismo el primer día.',
      'Blanco en las paredes, verde en puertas y ventanas, piedra negra del volcán abajo. El que pinta de otro color, repinta.',
      'Nada de edificios altos ni carteles chillones. La casa tiene que parecer que nació del paisaje, no que se lo come.',
      'Las chimeneas redondas y las azoteas son de toda la vida. Y un cactus o una palmera en cada jardín, que el desierto también es bonito.',
      'Dicen que en Lanzarote lo hicieron así primero. Yo solo copié lo bueno.',
    ] },
  // Sesión 50 — monturas
  { id: 'tanausu_cuadra', name: 'Tanausú', title: 'Cuadrero', x: -38, z: 38, rotY: 2.3, role: '🐎',
    look: { skin: 0xb07a52, shirt: 0x6a4a2a, pants: 0x2a2a2a, hair: 0x1a1a1a, acc: 'hat' },
    actions: ['mounts'],
    lines: [
      '¡Epa! Tanausú, de la cuadra. ¿Cansado de patear la isla? Súbete a un caballo, mi niño.',
      'Por los caminos se va rápido. Sigue los postes y no te pierdes: cada flecha dice cuánto falta.',
      'Si te pegan, te caes del caballo. Y si te atacan, el animal se asusta: espera un poquito antes de volver a montar.',
      'Mis pardelas son de las grandes, criadas en los riscos de Anaga. Por tierra caminan; cuando seas fuerte (nivel 25), te llevan volando por encima del Teide.',
    ] },
  // Sesión 50 — casas de jugador
  { id: 'nauzet_inmobiliaria', name: 'Nauzet', title: 'Agente inmobiliario', x: 50, z: 50, rotY: 0.8, role: '🏠',
    look: { skin: 0xd0a07a, shirt: 0x2a3a6a, pants: 0x1a1a2a, hair: 0x1a1a1a, acc: 'glasses' },
    actions: ['house'],
    lines: [
      '¡Buenas! Nauzet, de Inmobiliaria Achinech. ¿Buscas casa en la isla? Tengo lo que necesitas… a buen precio. Más o menos.',
      'Con lo caro que está todo, chacho, una casa es la mejor inversión. Mañana vale el doble, fijo.',
      'Tu casa la compras una vez y entras desde cualquier urbanización: La Laguna, La Orotava, Güímar, Adeje, Los Cristianos, Santa Cruz, Vilaflor o Icod.',
      'Una cama pa\' recuperarte, un cofre del banco, un altar… Eso sí que es calidad de vida.',
    ] },
];

export const TOWN_NPCS_BY_ID = Object.fromEntries(TOWN_NPCS.map(n => [n.id, n]));
