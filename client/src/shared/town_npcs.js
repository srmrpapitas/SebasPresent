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

import { CASONAS, bankerSpot } from './casonas.js';
const CASONA_LOOK = {
  banquera_dacil:    { name: 'Dácil',    title: 'Banquera de Santa Cruz',     look: { skin: 0xc8946a, shirt: 0x2a4a6a, pants: 0x1f1f24, hair: 0x1a1008, acc: 'apron' } },
  banquero_acaymo:   { name: 'Acaymo',   title: 'Banquero de Adeje',          look: { skin: 0xb07a52, shirt: 0x5a1f2a, pants: 0x1f1f24, hair: 0x1a1a1a, acc: 'hat' } },
  banquera_cathaysa: { name: 'Cathaysa', title: 'Banquera de Los Cristianos', look: { skin: 0xd9a57a, shirt: 0x2f6a3a, pants: 0x1f1f24, hair: 0x3a2010, acc: 'apron' } },
};
const CASONA_BANKERS = CASONAS.map(c => {
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
    actions: ['shop:magic_store'], stall: { sign: 'MAGIA', colors: ['#5a2a8a', '#e8d8f8'], signBg: '#2a1240', goods: [['tele_concejo', '📜'], ['tele_faro', '📜'], ['tele_mina', '📜'], ['staff_normal', '🪄'], ['tele_torre', '📜'], ['tele_verdis', '📜']] },
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
    actions: ['shop:magic_store'], stall: { sign: 'MAGIA', colors: ['#5a2a8a', '#e8d8f8'], signBg: '#2a1240', goods: [['tele_concejo', '📜'], ['tele_faro', '📜'], ['tele_mina', '📜'], ['staff_normal', '🪄'], ['tele_torre', '📜'], ['tele_verdis', '📜']] },
    lines: [
      'La magia no es más que paciencia con buen gusto.',
      'Con un bastón equipado tu maná se regenera más rápido.',
    ] },
  { id: 'ramiro_capataz', name: 'Ramiro', title: 'Capataz de la Mina', x: 1180, z: -1452, rotY: 5.9, role: '⛏',
    look: { skin: 0xc98f62, shirt: 0x8a6a2a, pants: 0x3a3a3a, hair: 0x3a3a3a, acc: 'helm' },
    lines: [
      'Aquí abajo hay acero y oro de sobra. El problema son los guardianes.',
    ] },
  { id: 'samir_mercader', name: 'Samir', title: 'Mercader de Güímar', x: 1512, z: 100, rotY: -1.57, role: '🐫',
    look: { skin: 0xa06a42, shirt: 0xe0c070, pants: 0xe8e0d0, hair: 0x1a1a1a, acc: 'bandana' },
    actions: ['shop:bazar_guimar'], stall: { sign: 'BAZAR', colors: ['#c8a040','#5a2a10'], signBg: '#3a2008', goods: [['bar_bronze', '🧱'], ['bar_hierro', '🧱'], ['ore_oro', '🪨'], ['oak_logs', '🪵'], ['willow_logs', '🪵'], ['vial_agua', '🧪']] },
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
    actions: ['shop:aso'], stall: { sign: 'LA ASO', props: 'herbs', goods: [['hierba_tabaiba', '🌿'], ['hierba_verode', '🌿'], ['hierba_salvia', '🌿'], ['hierba_oregano', '🌿'], ['hierba_retama', '🌿'], ['hierba_tajinaste', '🌺'], ['gofio', '🌾']] },
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
  // Sesión 50 — banqueros de las casonas del banco (shared/casonas.js)
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
  // Sesión 50 — los borrachos de cada pueblo: dan vueltas a la plaza, se tambalean y hablan con voz
  { id: 'adonay_vagabundo', name: 'Adonay', title: 'Vagabundo de La Laguna', x: 11, z: -4, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x5a5242, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: 4, cz: -4, r: 7 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 ADONAY quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'Yo antes era alguien, ¿eh? Yo tenía un barco… o era una barca… o un barraquito. No me acuerdo.',
      'Los del Cabildo me quitaron el banco donde dormía. ¡El banco, mi niño! Ahora duermo en la guagua.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Adonay, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'yeray_borracho', name: 'Yeray', title: 'Vagabundo de La Orotava', x: -279, z: -682, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x4a5a6a, pants: 0x2e2e2e, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: -290, cz: -682, r: 11 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 YERAY quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'En La Orotava las alfombras de flores son pa\' el Corpus… yo me eché una siesta encima de una. Casi me linchan.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Yeray, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'adexe_borracho', name: 'Adexe', title: 'Vagabundo de Icod', x: -671, z: -184, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x6a4a3a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: -686, cz: -184, r: 15 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 ADEXE quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'El Drago tiene mil años, mi niño. Y yo me siento como si tuviera dos mil.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Adexe, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'ancor_borracho', name: 'Ancor', title: 'Vagabundo de Vilaflor', x: -375, z: 396, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x5a5242, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: -390, cz: 396, r: 15 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 ANCOR quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'Aquí arriba en Vilaflor hace un frío que pela… menos mal que la botella calienta.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Ancor, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'dailos_borracho', name: 'Dailos', title: 'Vagabundo de Los Cristianos', x: -277, z: 1694, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x4a5a6a, pants: 0x2e2e2e, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: -286, cz: 1694, r: 9 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 DAILOS quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'Los guiris me dan monedas por hacerme una foto. Soy patrimonio, chacho.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Dailos, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'jonay_borracho', name: 'Jonay', title: 'Vagabundo de La Esperanza', x: 731, z: -1078, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x6a4a3a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 722, cz: -1078, r: 9 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 JONAY quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'En La Esperanza hay más niebla que en mi cabeza. Y eso es decir mucho.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Jonay, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'ayoze_borracho', name: 'Ayoze', title: 'Vagabundo de Güímar', x: 1503, z: 92, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x5a5242, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: 1494, cz: 92, r: 9 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 AYOZE quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      '¿Las pirámides de Güímar? Las hice yo, de chico. Bueno… ayudé a mirar.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Ayoze, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'aday_borracho', name: 'Aday', title: 'Vagabundo de Adeje', x: 1021, z: 1196, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x4a5a6a, pants: 0x2e2e2e, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: 1012, cz: 1196, r: 9 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 ADAY quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'En Adeje hay hoteles con piscina. Yo me bañé en una. Me sacaron con una red.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Aday, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'acoidan_borracho', name: 'Acoidan', title: 'Vagabundo de Santa Cruz', x: 1719, z: -788, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x6a4a3a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 1712, cz: -788, r: 7 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 ACOIDAN quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'En Carnaval me disfracé de borracho. Nadie notó la diferencia.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Acoidan, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'iriome_borracho', name: 'Iriome', title: 'Vagabundo de Arico', x: 1121, z: 600, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x5a5242, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: 1110, cz: 600, r: 11 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 IRIOME quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'Todas las casas de Arico son blancas, menos mi cartón. Mi cartón es marrón.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Iriome, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'haridian_borracho', name: 'Haridian', title: 'Vagabundo de Candelaria', x: 25, z: -1200, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x4a5a6a, pants: 0x2e2e2e, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: 0, cz: -1200, r: 25 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 HARIDIAN quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'Le pido a la Virgen todos los días. Ella me escucha… pero no me contesta.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Haridian, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'ruyman_borracho', name: 'Ruymán', title: 'Vagabundo de Chayofa', x: 699, z: 1450, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x6a4a3a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 690, cz: 1450, r: 9 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 RUYMÁN quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'En Chayofa hay unos mangos que… ay, mi niño. Y unas parras que… mejor no te cuento.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Ruymán, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  { id: 'mayec_borracho', name: 'Mayec', title: 'Vagabundo de el Faro', x: -769, z: 1396, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x5a5242, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: -776, cz: 1396, r: 7 }, voice: 'assets/voices/adonay.mp3', callout: '🍾 MAYEC quiere hablar contigo',
    lines: [
      '¡Eeeeh, mi niiiño! Ven pa\'cá, que te cuento una cosa…',
      'El farero no me deja dormir en el faro. Dice que alumbro más yo que la bombilla.',
      '¿Tienes un pavo? Es pa\' un bocadillo. Bueno, pa\' la botella. Pero la botella también es comida, ¿no?',
      'El Teide me habla por las noches, ¿sabes? Me dice: "Mayec, vete pa\' casa". Y yo le digo: "¿Qué casa?".',
    ] },
  // Sesión 50 — mercaderes de los pueblos (puesto + tendedero con lo que venden)
  { id: 'yaiza_comidas', name: 'Yaiza', title: 'Comidas de Vilaflor', x: -412, z: 403, rotY: 1.83, role: '🍲',
    look: { skin: 0xd9a57a, shirt: 0xc0602a, pants: 0x3a2a1a, hair: 0x3a2010, acc: 'apron' },
    actions: ['shop:comidas_vilaflor'], stall: { sign: 'COMIDAS', colors: ['#d0602a','#f8e8c8'], signBg: '#5a2a10', goods: [['pan', '🍞'], ['cooked_chicken', '🍗'], ['cooked_beef', '🍖'], ['trout', '🐟'], ['salmon', '🐟'], ['gofio', '🌾']] },
    lines: [
      '¡Pasa, mi niño, que hay comida pa\' todos! Pan de leña, pollo, ternera y pescado del día.',
      'Con la tripa llena se pelea mejor. Eso lo sabe cualquier guanche.',
      'Aquí arriba en Vilaflor el aire es fino: hay que comer bien.',
    ] },
  { id: 'echedey_armero', name: 'Echedey', title: 'Armero de Icod', x: -710, z: -206, rotY: 1.05, role: '⚔️',
    look: { skin: 0xb07a52, shirt: 0x4a4a52, pants: 0x2a2a2a, hair: 0x1a1a1a, acc: 'apron' },
    actions: ['shop:armeria_icod'], stall: { sign: 'ARMERÍA', colors: ['#8a2a2a','#d8d8d8'], signBg: '#3a1010', goods: [['sword_hierro', '⚔️'], ['sword_acero', '⚔️'], ['shield_hierro', '🛡'], ['helm_hierro', '⛑'], ['body_hierro', '🛡'], ['legs_hierro', '👖']] },
    lines: [
      'Hierro y acero bien templados. Con esto no te tumba ni un lobo.',
      '¿Todavía con bronce? Chacho, cambia de espada, que das pena.',
      'A la sombra del Drago se forja mejor. Eso decía mi padre.',
    ] },
  { id: 'gara_pieles', name: 'Gara', title: 'Peletera de La Esperanza', x: 700, z: -1088, rotY: 3.14, role: '🧥',
    look: { skin: 0xe0b48c, shirt: 0x6a4a2a, pants: 0x3a2a1a, hair: 0x5a3a1a, acc: 'hat' },
    actions: ['shop:pieles_esperanza'], stall: { sign: 'PIELES', colors: ['#6a4a2a','#e8d8b8'], signBg: '#2a1a0a', goods: [['body_cuero', '🛡'], ['legs_cuero', '👖'], ['boots_cuero', '🥾'], ['gloves_cuero', '🧤'], ['helm_cuero', '⛑'], ['cape_linen', '🧣']] },
    lines: [
      'En La Esperanza hace frío de verdad. Llévate algo de cuero y una capa.',
      'El cuero no para una espada, pero a los arqueros les va de lujo.',
      '¿Tienes pieles de vaca? Te las compro, que siempre hacen falta.',
    ] },
  { id: 'bentejui_ferretero', name: 'Bentejuí', title: 'Ferretero de Arico', x: 1088, z: 600, rotY: 1.57, role: '🔧',
    look: { skin: 0xc8946a, shirt: 0x2a5a7a, pants: 0x2a2a2a, hair: 0x2a2a2a, acc: 'apron' },
    actions: ['shop:ferreteria_arico'], stall: { sign: 'FERRETERÍA', colors: ['#2a5a7a','#f0f0f0'], signBg: '#0a2a3a', goods: [['axe_bronze', '🪓'], ['pickaxe_bronze', '⛏️'], ['tinderbox', '🔥'], ['fishing_rod', '🎣'], ['harpoon', '🔱'], ['bucket', '🪣']] },
    lines: [
      'Hachas, picos, cañas, yesqueros… Todo lo que necesitas pa\' trabajar la isla.',
      'Aquí en Arico todo es blanco menos mis herramientas.',
      'Sin yesquero no hay fuego, y sin fuego no hay comida. Apunta.',
    ] },
  { id: 'guacimara_flechas', name: 'Guacimara', title: 'Flechera de Chayofa', x: 706, z: 1460, rotY: -2.62, role: '🏹',
    look: { skin: 0xb07a52, shirt: 0x3a6a2a, pants: 0x3a2a1a, hair: 0x1a1008, acc: 'hood' },
    actions: ['shop:flecheria_chayofa'], stall: { sign: 'FLECHAS', colors: ['#3a6a2a','#e8e0c0'], signBg: '#1a3010', goods: [['bow_oak', '🏹'], ['bow_willow', '🏹'], ['arrow_hierro', '➳'], ['arrow_acero', '➳'], ['feather', '🪶'], ['quiver_bronze', '🎒']] },
    lines: [
      'Un buen arco y flechas rectas: eso es todo. Bueno, y puntería.',
      'En la selva de Adeje se caza mejor de lejos. Créeme.',
      'Las plumas me las traen de las pardelas. Las que se caen, ¿eh?',
    ] },
  { id: 'fayna_pescadera', name: 'Fayna', title: 'Pescadera del Faro', x: -800, z: 1412, rotY: 3.14, role: '🐟',
    look: { skin: 0xd9a57a, shirt: 0x2a4a8a, pants: 0x2a2a3a, hair: 0x3a2010, acc: 'apron' },
    actions: ['shop:pescaderia_faro'], stall: { sign: 'PESCADO', colors: ['#2a5a9a','#f0f8ff'], signBg: '#0a1a3a', goods: [['raw_sardine', '🐟'], ['raw_tuna', '🐟'], ['tuna', '🐟'], ['swordfish', '🐡'], ['small_net', '🥅'], ['harpoon', '🔱']] },
    lines: [
      '¡Pescado fresco, recién sacado del muelle! Crudo o ya hecho.',
      'Mi abuelo pescaba atunes con caña desde esa roca. Bueno, eso decía él.',
      'Si pescas de más, tráemelo, que yo te lo compro.',
    ] },
  // Sesión 50 — personajes nuevos por regiones (modelos Mixamo, ver client/src/town_npc_looks.js)
  { id: 'chema_oso', name: 'Chema', title: 'el del disfraz de oso', x: -289, z: 1710, rotY: 2.97, role: '🐻',
    look: { skin: 0x8a5a3a, shirt: 0x6a4a2a, pants: 0x6a4a2a, hair: 0x5a3a1a, acc: 'none' },
    lines: [
      '¡Foto con el oso, foto con el oso! Un pavo y te dejo darme un abrazo.',
      'Llevo doce años de oso en Los Cristianos. Los guiris creen que en Canarias hay osos. Yo no les digo nada.',
      'En agosto aquí dentro se está a cincuenta grados, mi niño. Soy un oso al baño maría.',
      'Una vez un niño alemán me dio un plátano. Me lo comí. Profesionalidad, ¿sabes?',
    ] },
  { id: 'visitante_izana', name: 'Zirk', title: 'Visitante del Observatorio', x: 413, z: -881, rotY: -1.92, role: '👽',
    look: { skin: 0x6a8a5a, shirt: 0x3a5a4a, pants: 0x3a5a4a, hair: 0x2a3a2a, acc: 'none' },
    lines: [
      'Saludos, terrícola. Vinimos por el cielo más limpio de la galaxia. Y por las papas arrugadas.',
      'Vuestros telescopios nos miran a nosotros. Nosotros miramos al mojo picón. Todos contentos.',
      'He probado el barraquito. En mi planeta eso es combustible de nave.',
      'No le digas a nadie que estoy aquí. Bueno, díselo. Total, nadie te va a creer.',
    ] },
  { id: 'bicho_canadas', name: 'El Bicho', title: 'Criatura de Las Cañadas', x: 220, z: -1676, rotY: -1.57, role: '🦶',
    look: { skin: 0x3a2a1a, shirt: 0x3a2a1a, pants: 0x3a2a1a, hair: 0x2a1a0a, acc: 'none' },
    lines: [
      'Grrrr… ¿Tú también vienes a hacerme fotos borrosas?',
      'Los de las excursiones dicen que no existo. Yo tampoco creo mucho en ellos.',
      'Vivo entre las retamas desde antes de que el Teide echara humo. Huele a azufre y a bocadillo de turista.',
    ] },
  { id: 'caballero_anaga', name: 'Sir Beneharo', title: 'Caballero de Anaga', x: 1724, z: -784, rotY: -1.92, role: '🛡️',
    look: { skin: 0xd9a57a, shirt: 0x2f6a3a, pants: 0x3a3a3a, hair: 0x2a1a10, acc: 'helm' },
    lines: [
      'Guardo los caminos que suben a los montes de Anaga. Laurisilva, niebla y bichos raros.',
      'Este escudo es de bronce. Humilde, pero ha parado más golpes que tu cara.',
      'Si subes al Roque de Taborno, lleva agua. Y ganas.',
    ] },
  { id: 'caballera_teide', name: 'Dama Yurena', title: 'Caballera del Teide', x: 200, z: -1676, rotY: 1.57, role: '⚔️',
    look: { skin: 0xd9a57a, shirt: 0x2f9e8f, pants: 0x2f9e8f, hair: 0x3a2010, acc: 'helm' },
    lines: [
      'Esta armadura es de teiderio, forjado con mineral de lo más alto de la isla. No hay nada más duro.',
      'Quien quiera vestir teiderio tiene que ganárselo a golpe de martillo. Nivel 90 de herrería, ni uno menos.',
      'Vigilo Las Cañadas. Y al Bicho, que de vez en cuando roba bocadillos.',
    ] },
  { id: 'caballero_abona', name: 'Sir Tegueste', title: 'Caballero de Abona', x: 1095, z: 609, rotY: 2.62, role: '🛡️',
    look: { skin: 0xd9a57a, shirt: 0x2a4a8a, pants: 0x3a3a3a, hair: 0x2a1a10, acc: 'helm' },
    lines: [
      'Abona: tierra seca, gente dura y casas blancas. Aquí no se rinde nadie.',
      'El alcalde Faustino me pidió que limpiara la armadura. Que desentonaba con las casas.',
    ] },
  // Sesión 50 — monturas
  { id: 'tanausu_cuadra', name: 'Tanausú', title: 'Cuadrero', x: -38, z: 38, rotY: 2.3, role: '🐎',
    look: { skin: 0xb07a52, shirt: 0x6a4a2a, pants: 0x2a2a2a, hair: 0x1a1a1a, acc: 'hat' },
    actions: ['mounts'],
    lines: [
      '¡Epa! Tanausú, de la cuadra. ¿Cansado de patear la isla? Súbete a un caballo, mi niño.',
      'Por los caminos se va rápido. Sigue los postes y no te pierdes: cada flecha dice cuánto falta.',
      'Si te pegan, te caes del caballo. Y si te atacan, el animal se asusta: espera un poquito antes de volver a montar.',
      'Mis dragones nacen en los riscos de Anaga. Por tierra corren a cuatro patas; cuando seas fuerte (nivel 25), te llevan volando por encima del Teide.',
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

/**
 * Sesión 50 — NPCs que pasean (los borrachos): dan vueltas a su plaza con un
 * zigzag de borracho. `t` es su reloj de paseo en segundos.
 */
export const WANDER_SPEED = 0.9;   // m/s
export function wanderPos(n, t) {
  const w = n.wander, per = (2 * Math.PI * w.r) / WANDER_SPEED;
  const a = (t / per) * 2 * Math.PI;
  const R = w.r + Math.sin(a * 6) * 1.2;
  const x = w.cx + Math.cos(a) * R, z = w.cz + Math.sin(a) * R;
  // mira hacia donde camina (tangente) con algo de bamboleo
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.sin(a * 9) * 0.35;
  return { x, z, yaw };
}
/** Distancia de (x,z) al NPC; si pasea, a su recorrido (el server no sabe dónde va exactamente). */
export function npcDist(n, x, z) {
  if (!n.wander) return Math.hypot(x - n.x, z - n.z);
  return Math.max(0, Math.abs(Math.hypot(x - n.wander.cx, z - n.wander.cz) - n.wander.r) - 1.2);
}

export const TOWN_NPCS_BY_ID = Object.fromEntries(TOWN_NPCS.map(n => [n.id, n]));
