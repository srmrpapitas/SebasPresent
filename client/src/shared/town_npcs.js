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
import { inRoom, DOOR_SERVER_SLACK_M } from './town_buildings.js';   // 19 oct — vecinos dentro de edificios
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
      'Las espadas de oro para arriba, el arco mágico, el de dragón y los bastones tienen ataque especial, cada uno el suyo. Barra verde en la pestaña de combate.',
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
  // Sesión 52 — Historia principal «El Sello de Achamán»
  { id: 'consejero_benitez', name: 'Consejero Benítez', title: 'Consejero del Cabildo', x: -44, z: -2, rotY: 1.2, role: '🏛️',
    look: { skin: 0xe0b890, shirt: 0x2a2a3a, pants: 0x2a2a3a, hair: 0x6a6a6a, acc: 'none' },
    lines: [
      '¡Buenos días! El Cabildo trabaja para usted. Bueno… para todos. Para todos.',
      'Las fiestas de este año van a ser las mejores. Lo prometo yo, el consejero Benítez.',
      '¿Temblores? Cosa de la naturaleza. Nada de qué preocuparse. Nada.',
      'Si ve usted gente con capucha roja, no les haga caso. Una cofradía. Muy devotos.',
    ] },
  { id: 'tibiabin_vidente', name: 'Tibiabin', title: 'La última harimaguada', x: 560, z: -1555, rotY: 3.6, role: '👁️',
    look: { skin: 0x9a6a42, shirt: 0x7a5a32, pants: 0x5a4224, hair: 0xe8e8e8, acc: 'hood' },
    lines: [
      'Los muertos hablan bajito, forastero. Hay que callarse para oírlos.',
      'Las harimaguadas cuidábamos el fuego sagrado. Ahora solo cuido esta hoguera de retama.',
      'Guayota no odia a los hombres. Los desprecia. Es peor.',
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
  // Sesión 53 — gente del Observatorio de Izaña (places.js)
  { id: 'astronoma_nayra', name: 'Nayra', title: 'Astrónoma', x: 391.6, z: -909.4, rotY: 3.4, role: '🔭',
    look: { skin: 0xd8a882, shirt: 0xe8e8f0, pants: 0x2a2a3a, hair: 0x2a1a10 },
    lines: [
      'Los guanches llamaban Magec al sol y Achamán al cielo. Desde aquí arriba se entiende por qué lo adoraban.',
      'Los sismógrafos se vuelven locos cada noche. Algo se mueve debajo del Teide… y no es la tierra sola.',
      'Si miras al norte al anochecer verás «el Perro»: siete estrellas en fila. Los viejos dicen que es un tibicena que Achamán clavó en el cielo.',
      'Cuando cae la noche abrimos las cúpulas. Ven a verlo: el cielo de Achinech es el más limpio del mundo.',
      '¿Buscas trabajo? Eldric siempre necesita a alguien que baje a Las Cañadas a por muestras. Ten cuidado con los perros negros.',
    ] },
  { id: 'ayudante_tinguaro', name: 'Tinguaro', title: 'Ayudante del observatorio', x: 395, z: -891.5, rotY: 0.3, role: '🧰',
    look: { skin: 0xb07a52, shirt: 0x3a5a8a, pants: 0x3a3a3a, hair: 0x1a1a1a },
    wander: { cx: 394, cz: -891, r: 5 },
    lines: [
      'Tres cúpulas, una torre, un plato gigante… y un solo ayudante. Adivina quién barre.',
      'El radiotelescopio escucha el cielo. A veces oye cosas que no deberían estar ahí. Yo no pregunto.',
      'Si te pierdes de noche, busca la luz roja de la torre. Se ve desde media isla.',
      'Antes subían turistas en guagua. Ahora con los tibicenas sueltos solo suben valientes… y tú.',
    ] },
  { id: 'vigia_gara', name: 'Gara', title: 'Vigía de la torre solar', x: 403.6, z: -905.6, rotY: 0.2, role: '🗼',
    look: { skin: 0xc89670, shirt: 0x8a3a2a, pants: 0x3a3022, hair: 0x5a3018 },
    lines: [
      'Desde lo alto de la torre lo veo todo. Cada dos horas el Teide ruge y la Tibicena Mayor sale de la tierra, ahí mismo, en los llanos de al lado.',
      'Cuando suene el aviso, ven corriendo: dale aunque sea un golpe y te llevas tu parte. Todos los que pelean cobran.',
      'La Tibicena Mayor pega fuerte. Si eres nuevo, dale desde lejos y apártate de los círculos.',
      'Por la noche los perros negros bajan de Las Cañadas. Por eso encendemos todas las farolas.',
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
    drunk: true, wander: { cx: 4, cz: -4, r: 7 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.0, callout: '🍾 ADONAY quiere hablar contigo',
    lines: [
      "¡Eeeeh, mi niiiño! Ven pa'cá, que te cuento una cosa…",
      "Yo antes era alguien, ¿eh? Yo tenía un barco… o era una barca… o un barraquito. No me acuerdo.",
      "Los del Cabildo me quitaron el banco donde dormía. ¡El banco, mi niño! Ahora duermo en la guagua.",
      "El Teide me habla por las noches, ¿sabes? Me dice: \"Adonay, vete pa' casa\". Y yo le digo: \"¿Qué casa?\".",
      "Anoche vi a unos encapuchados de rojo subiendo pa' Las Cañadas con antorchas. A las tres de la mañana. Eso no es pa' coger tunos, mi niño.",
    ] },
  { id: 'yeray_borracho', name: 'Yeray', title: 'Vagabundo de La Orotava', x: -279, z: -682, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x3a5a4a, pants: 0x2a2a22, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: -290, cz: -682, r: 11 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.86, callout: '🍾 YERAY quiere hablar contigo',
    lines: [
      "Shhh… no hables alto, que la botella está dormida.",
      "En La Orotava las alfombras de flores son pa' el Corpus… yo me eché una siesta encima de una. Casi me linchan.",
      "Mi abuela decía que el que mira mucho rato al Teide se le mete el fuego en los ojos. Por eso yo miro la botella.",
      "Las casas de los balcones de madera crujen de noche. No son las casas, mi niño. Es algo que camina debajo.",
      "¿Tú has visto mi chaqueta? La dejé aquí en 2009.",
    ] },
  { id: 'adexe_borracho', name: 'Adexe', title: 'Vagabundo de Icod', x: -671, z: -184, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x7a3a2a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: -686, cz: -184, r: 15 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.12, callout: '🍾 ADEXE quiere hablar contigo',
    lines: [
      "¡Tú! ¡Sí, tú! ¿Sabes cuántos años tiene el Drago? ¡Mil! ¿Y sabes cuántos tengo yo? ¡Tampoco!",
      "El Drago sangra rojo cuando lo cortas, ¿lo sabías? Igual que yo cuando me caigo. Somos hermanos.",
      "Dicen que debajo del Drago duerme algo grande con escamas. Yo le dejo un vasito de ron por si acaso.",
      "Me dieron una medalla por estar tres días sin beber. Me la bebí.",
      "Los dragones esos de los que hablan los guardias… yo los vi primero. Nadie me creyó. Nunca nadie me cree.",
    ] },
  { id: 'ancor_borracho', name: 'Ancor', title: 'Vagabundo de Vilaflor', x: -375, z: 396, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x4a4a5a, pants: 0x2e2e3a, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: -390, cz: 396, r: 15 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.92, callout: '🍾 ANCOR quiere hablar contigo',
    lines: [
      "Aquí arriba en Vilaflor hace un frío que pela… menos mal que la botella calienta.",
      "El agua de Vilaflor es la mejor de la isla. No sé, yo no la pruebo.",
      "Subí al Teide a pata una vez. A mitad de camino el suelo estaba caliente como un plato de potaje. El suelo, mi niño. Caliente.",
      "Los pinos de aquí aguantan el fuego. Se queman por fuera y por dentro siguen vivos. Como yo.",
      "Si ves humo saliendo de la montaña, no es niebla. Te lo digo yo, que de humo sé un rato.",
    ] },
  { id: 'dailos_borracho', name: 'Dailos', title: 'Vagabundo de Los Cristianos', x: -277, z: 1694, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0xc86a3a, pants: 0x3a5a7a, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: -286, cz: 1694, r: 9 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.18, callout: '🍾 DAILOS quiere hablar contigo',
    lines: [
      "Hello my friend! ¿Inglés? ¿No? Pues hola, mi niño. Los guiris me dan monedas por hacerme una foto. Soy patrimonio, chacho.",
      "Vendo gafas de sol. Bueno, vendía. Ahora las llevo todas puestas, una encima de otra.",
      "En la playa encontré una botella con un mensaje. Decía: \"Ron Arehucas\". Me lo tomé como una señal.",
      "Los pescadores dicen que el mar se calienta de noche cerca de la costa. Yo me baño y no noto nada. Bueno, no noto nada en general.",
      "¡Mira, mira, un guiri quemado! Ah, no, es un cangrejo.",
    ] },
  { id: 'jonay_borracho', name: 'Jonay', title: 'Vagabundo de La Esperanza', x: 731, z: -1078, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x5a6a4a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 722, cz: -1078, r: 9 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.8, callout: '🍾 JONAY quiere hablar contigo',
    lines: [
      "En La Esperanza hay más niebla que en mi cabeza. Y eso es decir mucho.",
      "Me perdí en el bosque una vez. Tres días. Al final me encontró una cabra y me trajo de vuelta. Buena gente, las cabras.",
      "En el monte hay lobos con los ojos colorados. Dice mi primo que llevan sangre de tibicena. Mi primo también dice que es astronauta.",
      "Las papas de aquí son las mejores. Las papas arrugadas con mojo… ay. Hace dos días que no como. No me mires así.",
      "La niebla se mete en los huesos, mi niño. Por eso hay que meterle algo calentito a los huesos.",
    ] },
  { id: 'ayoze_borracho', name: 'Ayoze', title: 'Vagabundo de Güímar', x: 1503, z: 92, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x8a6a2a, pants: 0x3a382e, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: 1494, cz: 92, r: 9 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.06, callout: '🍾 AYOZE quiere hablar contigo',
    lines: [
      "¿Las pirámides de Güímar? Las hice yo, de chico. Bueno… ayudé a mirar.",
      "Las pirámides miran al sol cuando sale en el solsticio. Los guanches sabían cosas, mi niño. Cosas del cielo y cosas de debajo de la tierra.",
      "Mi tatarabuelo decía que los menceyes enterraron algo en el malpaís pa' que nadie lo despertara. Yo no he excavado. Todavía.",
      "El malpaís es lava que se cansó de correr. Como yo.",
      "Si te pica un escorpión, ponte ron en la herida. Por dentro, mi niño. Por dentro.",
    ] },
  { id: 'aday_borracho', name: 'Aday', title: 'Vagabundo de Adeje', x: 1021, z: 1196, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0xe0d0a0, pants: 0x3a6a8a, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: 1012, cz: 1196, r: 9 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.2, callout: '🍾 ADAY quiere hablar contigo',
    lines: [
      "En Adeje hay hoteles con piscina. Yo me bañé en una. Me sacaron con una red.",
      "Me dieron una pulsera de todo incluido. Me la encontré en el suelo. ¿Cuenta?",
      "En el Barranco del Infierno se oyen voces cuando cae la tarde. Los guías dicen que es el viento. El viento no dice tu nombre, mi niño.",
      "Yo fui camarero. Tres horas. Me comí las tapas.",
      "Mañana dejo la bebida. Lo digo todos los días y todos los días es mañana.",
    ] },
  { id: 'acoidan_borracho', name: 'Acoidan', title: 'Vagabundo de Santa Cruz', x: 1719, z: -788, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x2a2a4a, pants: 0x2a2a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 1712, cz: -788, r: 7 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.9, callout: '🍾 ACOIDAN quiere hablar contigo',
    lines: [
      "En Carnaval me disfracé de borracho. Nadie notó la diferencia.",
      "Yo trabajaba en el puerto descargando barcos. Ahora descargo botellas.",
      "Los del Cabildo tienen un sótano que no sale en los planos. Yo dormía al lado de la reja y se oían cánticos. Cánticos raros, mi niño. En guanche.",
      "La murga de mi barrio ganó un premio en el 98. Yo tocaba el bombo. Ahora el bombo me toca a mí, aquí en la cabeza.",
      "¿Ves esos barcos tan grandes? Uno me trajo aquí hace treinta años. Iba a quedarme una semana.",
    ] },
  { id: 'iriome_borracho', name: 'Iriome', title: 'Vagabundo de Arico', x: 1121, z: 600, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0xf0f0e8, pants: 0x5a4a3a, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: 1110, cz: 600, r: 11 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.0, callout: '🍾 IRIOME quiere hablar contigo',
    lines: [
      "Todas las casas de Arico son blancas, menos mi cartón. Mi cartón es marrón.",
      "Aquí no llueve nunca. Por eso no me lavo. Es por el agua, que hay que ahorrarla.",
      "Las cabras de Arico me conocen todas por mi nombre. Me llaman \"¡Bééé!\". No sé cómo lo saben.",
      "Hace una semana tembló el suelo y se me cayó la botella. Desde entonces no me fío ni del suelo.",
      "Una señora me dio un queso entero. Un queso, mi niño. Me lo comí en el sitio. Era una vela.",
    ] },
  { id: 'haridian_borracho', name: 'Haridian', title: 'Vagabundo de Candelaria', x: 25, z: -1200, rotY: 0, role: '🍾',
    look: { skin: 0xa87650, shirt: 0x6a5a8a, pants: 0x2e2e2e, hair: 0x1a1a1a, acc: 'bottle' },
    drunk: true, wander: { cx: 0, cz: -1200, r: 25 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.84, callout: '🍾 HARIDIAN quiere hablar contigo',
    lines: [
      "Le pido a la Virgen todos los días. Ella me escucha… pero no me contesta.",
      "Los menceyes de bronce de la plaza me miran mal. Sobre todo el de la lanza.",
      "Mi madre me decía: \"Haridian, si Guayota sale del Teide, que te pille rezando\". Yo por si acaso rezo y bebo, a la vez.",
      "Los peregrinos vienen andando desde La Laguna toda la noche. Yo también ando toda la noche. Pero en círculos.",
      "La playa de aquí tiene arena negra. Me tumbo y no me ven. Es mi escondite.",
    ] },
  { id: 'ruyman_borracho', name: 'Ruymán', title: 'Vagabundo de Chayofa', x: 699, z: 1450, rotY: 0, role: '🍾',
    look: { skin: 0xd09a70, shirt: 0x4a7a3a, pants: 0x3a3a2a, hair: 0x4a3020, acc: 'bottle' },
    drunk: true, wander: { cx: 690, cz: 1450, r: 9 }, voice: 'assets/voices/adonay.mp3', voiceRate: 1.1, callout: '🍾 RUYMÁN quiere hablar contigo',
    lines: [
      "En Chayofa hay unos mangos que… ay, mi niño. Y unas parras que… mejor no te cuento.",
      "Yo hago vino. Bueno, hago que me lo beba. El proceso es parecido.",
      "Los plátanos se cortan verdes, ¿sabías? Igual que yo, que me cortaron joven.",
      "El otro día un perro me robó el bocadillo. Lo perseguí media hora. El perro también estaba borracho, creo.",
      "¿Me prestas cinco monedas? Te las devuelvo cuando se apague el Teide.",
    ] },
  { id: 'mayec_borracho', name: 'Mayec', title: 'Vagabundo de el Faro', x: -769, z: 1396, rotY: 0, role: '🍾',
    look: { skin: 0xc08a60, shirt: 0x2a4a6a, pants: 0x2a2a2a, hair: 0x2a2018, acc: 'bottle' },
    drunk: true, wander: { cx: -776, cz: 1396, r: 7 }, voice: 'assets/voices/adonay.mp3', voiceRate: 0.88, callout: '🍾 MAYEC quiere hablar contigo',
    lines: [
      "El farero no me deja dormir en el faro. Dice que alumbro más yo que la bombilla.",
      "Desde el faro se ve el Teide entero. Algunas noches tiene un brillo rojo arriba, como un ojo. El farero dice que son las luces del teleférico. ¿Qué teleférico, mi niño?",
      "Las pardelas lloran de noche como niños pequeños. Mi abuelo decía que son las almas de los marineros. Yo creo que son pardelas.",
      "Pesqué una vieja así de grande. Bueno, así. Bueno… me la vendieron en el mercado.",
      "Si un día el mar se pone caliente y las pardelas se callan, tú corre, mi niño. No preguntes. Corre.",
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
  // ------------------------------------------------ 19 oct — dentro de los edificios (shared/town_buildings.js)
  // Taberna La Vieja Aguere (La Laguna)
  { id: 'tabernero_fefo', name: 'Fefo', title: 'Tabernero de La Vieja Aguere', ...inRoom('taberna_laguna', 0, 2.9), rotY: Math.PI, role: '🍷',
    look: { skin: 0xd9a57a, shirt: 0xf0ece0, pants: 0x2a2a2a, hair: 0x2a1a10, acc: 'apron' },
    actions: ['shop:taberna_laguna'],
    lines: [
      '¡Pasa, pasa, que fuera hace frío! Bienvenido a La Vieja Aguere, la taberna más antigua de La Laguna.',
      'Aquí no se viene solo a beber, ¿eh? Se viene a enterarse de todo. Lo que no se sabe en esta barra, no ha pasado.',
      'Si tienes hambre, tengo pan, gofio, pollo y ternera. Y si vas a pelear, llévate comida: los muertos no pagan la cuenta.',
      'Don Pancho lleva sentado en esa mesa desde antes de que yo naciera. Pregúntale por la laguna, que le encanta.',
      'Chago toca el timple los viernes. Y los lunes. Y cuando le pagan una ronda, que es casi siempre.',
    ] },
  { id: 'parroquiano_pancho', name: 'Don Pancho', title: 'Parroquiano de toda la vida', ...inRoom('taberna_laguna', -4.2, -1.25), rotY: Math.PI, role: '🍷',
    look: { skin: 0xe0b08a, shirt: 0x4a4a5a, pants: 0x2a2a30, hair: 0xd0d0d0, acc: 'hat' },
    lines: [
      'Siéntate, siéntate. A mi edad uno ya no se levanta por cualquiera.',
      'Yo vi secarse los últimos charcos de la laguna. Bueno, eso dice mi abuelo que vio él. Viene a ser lo mismo.',
      'Cuando hay niebla en La Laguna, no te fíes de las sombras de la Plaza del Adelantado. Algunas no son de nadie.',
      'El mejor vino de la isla es el de Tacoronte. El segundo mejor, también.',
    ] },
  { id: 'timplista_chago', name: 'Chago', title: 'Músico del timple', ...inRoom('taberna_laguna', 4.2, -1.55), rotY: Math.PI, role: '🎶',
    look: { skin: 0xc8946a, shirt: 0x8a2a2a, pants: 0x2a2a2a, hair: 0x1a1008, acc: 'hat' },
    lines: [
      '¡Una folía pa\'l forastero! ♪ Ay, Laguna, Laguna mía, con tu niebla y tu llovizna… ♪',
      'El timple tiene cinco cuerdas y ninguna se calla. Como mi suegra.',
      'Dicen que en las cumbres, de noche, todavía se oye el silbo de los pastores guanches. Yo lo he intentado y solo me sale un pitido.',
      'Si un día ves la taberna vacía, es que Fefo ha cerrado la cuenta. Y eso es más peligroso que cualquier dragón.',
    ] },
  // Herrería del Muelle (Santa Cruz)
  { id: 'herrero_chano', name: 'Maestro Chano', title: 'Herrero del Muelle', ...inRoom('herreria_santacruz', 1.6, 2.6), rotY: Math.PI, role: '⚒',
    look: { skin: 0xb07a52, shirt: 0x3a3028, pants: 0x2a2620, hair: 0x2a2a2a, acc: 'apron' },
    lines: [
      'Cuidado con la forja, que quema más que el sol de agosto en el muelle.',
      'Herraduras para los caballeros de Anaga, anclas para los barcos, rejas para el castillo… Aquí no se para nunca.',
      'El buen hierro se trabaja al rojo cereza, no al blanco. Si sale chispa blanca, ya te has pasado.',
      'Ese cañón del rincón es El Tigre. No lo toques, que está de baja.',
    ] },
  { id: 'aprendiza_iballa', name: 'Iballa', title: 'Aprendiza de herrera', ...inRoom('herreria_santacruz', -1.5, 2.9), rotY: Math.PI * 1.15, role: '🔨',
    look: { skin: 0xd9a57a, shirt: 0x6a3a2a, pants: 0x2a2620, hair: 0x3a2010, acc: 'apron' },
    lines: [
      '¡Hola! Perdona el hollín, es que hoy me tocó limpiar la forja. Y ayer. Y anteayer.',
      'El Maestro Chano dice que en cinco años me deja tocar el yunque. Yo ya practico con una cuchara.',
      'Si picas hierro, fúndelo en el horno de la Cantera de La Laguna. El de aquí es solo para el Maestro.',
    ] },
  // Casa de los Balcones (La Orotava)
  { id: 'bordadora_mencia', name: 'Doña Mencía', title: 'Bordadora de calados', ...inRoom('casa_balcones_orotava', -3.2, 1.6), rotY: Math.PI * 0.9, role: '🧵',
    look: { skin: 0xe0b08a, shirt: 0x2a2a3a, pants: 0x2a2a30, hair: 0xd8d8d8, acc: 'glasses' },
    lines: [
      'Pasa, mi niño, y limpia los pies, que el suelo es de tea y tiene más años que el Teide.',
      'Esto es un calado: se sacan hilos del lino y con los que quedan se borda el dibujo. Una mantelería me lleva un invierno entero.',
      'Desde ese balcón se ve todo el valle hasta el mar. Por eso los ricos de antes se hacían las casas aquí: para mirar por encima a los demás.',
      'En el Corpus las calles se cubren de alfombras de flores y de tierras del Teide. Yo las dibujo; los chiquillos las rellenan.',
    ] },
  { id: 'sobrino_bentor', name: 'Bentor', title: 'Sobrino de Doña Mencía', ...inRoom('casa_balcones_orotava', 3.6, 1.2), rotY: Math.PI * 1.1, role: '🌺',
    look: { skin: 0xc8946a, shirt: 0x3a6a3a, pants: 0x2a2a3a, hair: 0x1a1008 },
    lines: [
      'Mi tía dice que algún día heredaré la casa. Yo solo quiero heredar el balcón: desde ahí se tiran las mejores flores en el Corpus.',
      'El patio lo regamos con agua de la acequia. Hay helechos más viejos que yo. Bueno, y que mi tía. No se lo digas.',
      'En el monte de La Orotava hay pinos tan viejos que son de tea por dentro: madera roja que no se pudre nunca. Están protegidos.',
    ] },
  // Bodega El Drago (Icod de los Vinos)
  { id: 'bodeguero_goyo', name: 'Goyo', title: 'Bodeguero de El Drago', ...inRoom('bodega_icod', 0, 2.9), rotY: Math.PI, role: '🍇',
    look: { skin: 0xc8946a, shirt: 0x6a2a3a, pants: 0x2a2620, hair: 0x3a3a3a, acc: 'apron' },
    lines: [
      'Bienvenido a El Drago. Aquí el vino se hace como lo hacía mi abuelo: pisando la uva y con paciencia.',
      'La malvasía de Icod la bebían en los palacios del otro lado del mar. Hoy la bebe quien la paga, que es más justo.',
      'Las barricas de abajo son de castaño. Las de arriba, de roble. Las del rincón… mejor no preguntes.',
      'Si te sobra valor, tengo un trabajo para ti. Si te sobra sed, también.',
    ] },
  { id: 'vendimiadora_nieves', name: 'Nieves', title: 'Vendimiadora', ...inRoom('bodega_icod', 4.0, -1.4), rotY: Math.PI * 1.15, role: '🍇',
    look: { skin: 0xd9a57a, shirt: 0xe0d8c0, pants: 0x3a2a2a, hair: 0x2a1408, acc: 'hat' },
    lines: [
      'Llevo desde el amanecer en el lagar. Tengo los pies morados hasta las rodillas.',
      'Este año la vendimia viene buena… si los tibicenas nos dejan subir a las viñas del norte.',
      'Mi abuela decía que cuando se quemó el puerto de Garachico con el volcán, el vino de Icod se quedó sin barcos. Tardamos cien años en recuperarnos.',
    ] },
  // Molino de gofio La Majada (Güímar)
  { id: 'molinera_benita', name: 'Tía Benita', title: 'Molinera de La Majada', ...inRoom('molino_guimar', -2.6, 2.6), rotY: Math.PI * 0.9, role: '🌾',
    look: { skin: 0xc8946a, shirt: 0x5a4a3a, pants: 0x2a2620, hair: 0xd0d0d0, acc: 'apron' },
    lines: [
      'Entra, entra, pero no toques la tolva, que está llena. ¿Gofio de millo o de trigo? Aquí se muele de los dos.',
      'Primero se tuesta, luego se muele y luego se come con todo: con leche, con caldo, con miel… Mi marido lo comía hasta con sardinas.',
      'Las muelas son de piedra del malpaís. La lava que bajó de la montaña lo quemó todo, pero nos dejó la mejor piedra de la isla.',
      'En agosto media isla pasa por aquí caminando hacia Candelaria. Y todos paran a por gofio. ¡Todos!',
    ] },
  { id: 'cabrero_mauro', name: 'Mauro', title: 'Cabrero del malpaís', ...inRoom('molino_guimar', 3.8, -1.2), rotY: Math.PI * 1.2, role: '🐐',
    look: { skin: 0xb07a52, shirt: 0x8a6a3a, pants: 0x3a3020, hair: 0x1a1008, acc: 'hat' },
    lines: [
      'Mis cabras comen tabaiba y cardón en el malpaís. Por eso su leche sabe a monte.',
      'Las pirámides están ahí abajo, junto al barranco. Escalones de piedra negra, uno encima de otro. Yo creo que eran para quitar piedras de los huertos. Mi primo dice que eran para mirar el sol.',
      'En verano, el día más largo del año, el sol se pone justo detrás de una montaña, mirando desde las pirámides. Eso no es casualidad, ¿no?',
    ] },
  // Casa Fuerte de Adeje
  { id: 'guarda_tome', name: 'Don Tomé', title: 'Guarda de la Casa Fuerte', ...inRoom('casafuerte_adeje', -2.8, 2.5), rotY: Math.PI * 0.95, role: '🏰',
    look: { skin: 0xd0a07a, shirt: 0x2a3a5a, pants: 0x1f1f24, hair: 0x8a8a8a, acc: 'hat' },
    lines: [
      'Esta casa la levantaron para aguantar piratas. Muros de un metro y un cañón en cada ventana. Y aguantó.',
      'Dentro se guardaba el azúcar del ingenio. El azúcar era oro blanco: por eso venían los piratas.',
      'No subas a las almenas, que hay viento. Siempre hay viento. Bueno, casi siempre.',
      'Si tienes buen brazo, tengo un trabajo para ti. Los cochinos del barranco nos tienen fritos.',
    ] },
  { id: 'cartografa_iraya', name: 'Iraya', title: 'Aprendiz de cartógrafa', ...inRoom('casafuerte_adeje', 3.6, 1.4), rotY: Math.PI, role: '🗺️',
    look: { skin: 0xc8946a, shirt: 0x3a6a6a, pants: 0x2a2a3a, hair: 0x1a0a04, acc: 'glasses' },
    lines: [
      'Estoy dibujando el Barranco del Infierno, sendero a sendero. Al fondo hay una cascada que no se seca nunca.',
      'Los guanches de Adeje enterraban a sus muertos en cuevas del barranco. Por eso le pusieron ese nombre tan feo: no hay ningún infierno, hay sombra y agua.',
      'Desde las almenas se ve La Gomera. Dicen que los pastores de allí hablan silbando de un monte a otro. Algún día voy a ir a dibujarlos.',
    ] },
  // Cofradía de Pescadores (Los Cristianos)
  { id: 'patron_isidro', name: 'Patrón Isidro', title: 'Patrón de la Cofradía', ...inRoom('cofradia_cristianos', -2.6, 2.6), rotY: Math.PI * 0.9, role: '⚓',
    look: { skin: 0xa87650, shirt: 0x2a3a6a, pants: 0x2a2a30, hair: 0xd8d8d8, acc: 'hat' },
    lines: [
      'Cincuenta años saliendo a la mar y todavía me mareo. No se lo digas a nadie.',
      'Aquí se pescaba vieja, sama y cherne. Y en verano, cuando se acercaban los atunes, no dormía nadie en el pueblo.',
      'La mar es como mi señora: cuando está tranquila, no te fíes; cuando está brava, tampoco.',
      'Desde el muelle salen los barcos para La Gomera. En un día claro se ve tan cerca que parece que se llega nadando. No lo intentes.',
    ] },
  { id: 'remendadora_rosario', name: 'Rosario', title: 'Remendadora de redes', ...inRoom('cofradia_cristianos', 4.4, -1.4), rotY: Math.PI * 1.25, role: '🪡',
    look: { skin: 0xc8946a, shirt: 0x3a7a9a, pants: 0x2a2a3a, hair: 0x2a1408, acc: 'apron' },
    lines: [
      'Una red bien remendada dura veinte años. Una mal remendada, una mañana.',
      'Mi madre remendaba aquí mismo, y mi abuela en la playa, sentada en la arena. Las manos son las mismas.',
      'Algo se está comiendo las redes por las noches. Y no son los peces, que esos no tienen dientes tan pequeños.',
    ] },
  // Casa del Pinero (Vilaflor)
  { id: 'pinero_eusebio', name: 'Don Eusebio', title: 'Pinero de Vilaflor', ...inRoom('casa_pinero_vilaflor', -2.0, 2.5), rotY: Math.PI * 0.9, role: '🌲',
    look: { skin: 0xd0a07a, shirt: 0x3a5a2a, pants: 0x3a3020, hair: 0x9a9a9a, acc: 'hat' },
    lines: [
      'Bienvenido al pueblo más alto de la isla. Aquí arriba el aire es tan limpio que se ven las estrellas de día. Bueno, casi.',
      'Mi trabajo es cuidar el pinar: limpiar los cortafuegos, vigilar el humo y contar los pinos. Van por catorce mil. Creo.',
      'El pino canario es el más terco del mundo: se le quema todo y al año siguiente vuelve a echar hojas por el tronco.',
      'Más arriba está el Pino Gordo: hacen falta seis personas para abrazarlo. Yo lo he abrazado solo, a ratos.',
    ] },
  { id: 'pinochera_saray', name: 'Saray', title: 'Recogedora de pinocha', ...inRoom('casa_pinero_vilaflor', 2.6, -0.8), rotY: Math.PI * 1.2, role: '🍂',
    look: { skin: 0xd9a57a, shirt: 0xa06a3a, pants: 0x3a3a2a, hair: 0x3a2010, acc: 'hood' },
    lines: [
      'Recojo pinocha desde que tengo memoria. Se baja al valle en fardos, para las cabras y para las fincas de plátanos.',
      'En Vilaflor se crían las mejores papas de la isla. Con el frío salen dulces. Arrugadas con mojo… ay.',
      'Si subes al pinar, no hagas fuego. Don Eusebio te encuentra. Siempre te encuentra.',
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
  // 19 oct — dentro de un edificio: el server solo sabe que estás en la puerta
  if (n.door) return Math.max(0, Math.hypot(x - n.door.x, z - n.door.z) - DOOR_SERVER_SLACK_M);
  if (!n.wander) return Math.hypot(x - n.x, z - n.z);
  return Math.max(0, Math.abs(Math.hypot(x - n.wander.cx, z - n.wander.cz) - n.wander.r) - 1.2);
}

export const TOWN_NPCS_BY_ID = Object.fromEntries(TOWN_NPCS.map(n => [n.id, n]));
