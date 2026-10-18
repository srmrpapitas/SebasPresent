/**
 * SEBAS PRESENT — «La Cruzada» (modo historia de Sebas) · datos
 *
 * La vida de Sebas contada a lo John Wick: llega a Tenerife el 9 de octubre de
 * 1998 sin nada y acaba montando la banda más absurda e imparable de la isla.
 * Los villanos finales son personajes inventados.
 *
 * Personajes (modelo Mixamo + tinte):
 *   who → { name, title, model, tint, scale }
 * Capítulos:
 *   { id, n, title, date, place, theme, intro: [[who, texto]], outro, waves: [[tipo, n], …][], boss, unlock }
 */
export const CAST = {
  sebas:    { name: 'Sebas', title: 'El protagonista', model: 'm36', tint: { sat: 0.15, val: 0.42 } },
  choro:    { name: 'El Choro', title: '«Chorovitz», el alma de la fiesta', model: 'm40', tint: { hue: 0.08, sat: 1.4 } },
  ale:      { name: 'Ale «el Stone»', title: 'Rockero y tacaño', model: 'm42', tint: { hue: 0.0, sat: 1.6, val: 0.8 } },
  miguel:   { name: 'Miguel «the Legend»', title: 'Ex presidiario, leyenda viva', model: 'm37', tint: { sat: 0.3, val: 0.6 } },
  roland:   { name: 'Roland', title: 'El húngaro de dos metros', model: 'm44', tint: { hue: 0.58, sat: 0.6, val: 0.7 }, scale: 1.18 },
  mohit:    { name: 'Mohit', title: 'Manos más rápidas de San Isidro', model: 'm35', tint: { hue: 0.13, sat: 1.5 } },
  federico: { name: 'Federico', title: 'El hermano de Sebas', model: 'm41', tint: { hue: 0.6, sat: 0.4, val: 0.55 } },
  ella:     { name: 'Ella', title: 'Brasil, 1999', model: 'f45', tint: { hue: 0.33, sat: 1.3 } },
  narr:     { name: '', title: '' },
  // Enemigos y jefes (inventados)
  rey_taxi: { name: 'El Rey del Taxi', title: 'Taxis piratas del aeropuerto', model: 'm33', tint: { hue: 0.13, sat: 1.5 }, scale: 1.22 },
  gominola: { name: 'Gominola', title: 'Jefe de los relaciones públicas rivales', model: 'm45', tint: { hue: 0.85, sat: 1.6 } },
  inspector:{ name: 'Don Cifuentes', title: 'Inspector de mercadillos', model: 'sheriff_n_01', tint: { val: 0.8 } },
  capitan:  { name: 'El Capitán Yate', title: 'Dueño del puerto deportivo', model: 'm43', tint: { sat: 0.1, val: 1.6 } },
  cunhado:  { name: 'Os Cunhados', title: 'Los hermanos de ella', model: 'm39', tint: { hue: 0.3, sat: 1.5 } },
  diva:     { name: 'La Diva del Mediodía', title: 'Reina de la tele', model: 'f44', tint: { hue: 0.9, sat: 1.7, val: 1.2 } },
  coronel:  { name: 'El Coronel', title: 'Jefe de la seguridad privada', model: 'sheriff_n', tint: { hue: 0.22, sat: 0.9, val: 0.6 } },
  caudillo: { name: 'El Caudillo', title: 'El que manda en la sombra', model: 'm38', tint: { sat: 0.05, val: 1.7 }, scale: 1.05 },
};

// Aliados: habilidad que se usa con el botón ⭐ (una por misión, la que elijas)
export const ALLIES = {
  choro:  { icon: '🃏', skill: 'El chiste', desc: 'Cuenta un chiste tan malo que los enemigos cercanos se quedan riéndose 4 s.', cd: 14,
            lines: ['¡Mañana a primera hora, a las 6 en punto, tenés la plata!', '¿Sabés por qué el cocodrilo no usa Instagram? ¡Porque ya tiene mil seguidores… en la orilla!', 'Prestame veinte y te devuelvo cuarenta. Mañana. A las 6 en punto.'] },
  ale:    { icon: '🎸', skill: 'El riff', desc: 'Un riff de guitarra que lanza por los aires a los que tienes delante.', cd: 12,
            lines: ['¡Satisfaaaction! … Esto lo pagás vos, ¿eh?', '¿Una birra? No, no, invitás vos.', '¡Uno, dos, tres, cuatro!'] },
  miguel: { icon: '⛓️', skill: 'La leyenda', desc: 'Miguel entra a lo bestia: 4 s girando y repartiendo golpes a su alrededor.', cd: 16,
            lines: ['…', '¡VAMOOOOS!', 'Yo esto ya lo viví. Peor.'] },
  roland: { icon: '🗿', skill: 'Intimidar', desc: 'Roland se cruza de brazos: todos huyen 5 s y reciben el doble de daño.', cd: 18,
            lines: ['Nem.', 'Yo no grito. Yo miro.', 'Dos metros de argumentos.'] },
  mohit:  { icon: '📱', skill: 'Manos rápidas', desc: 'Mohit les roba las pistolas a los tiradores cercanos y te recarga la munición.', cd: 15,
            lines: ['¿Este móvil es tuyo, jefe?', 'Karim y Nico me deben una.', 'Yo no he sido. Bueno, un poco.'] },
};

export const CHAPTERS = [
  {
    id: 'c1', n: 1, title: 'Llegada', date: '9 de octubre de 1998', place: 'Aeropuerto Reina Sofía', theme: 'airport',
    tutorial: true,
    intro: [
      ['narr', '9 de octubre de 1998. Aeropuerto Reina Sofía, Tenerife Sur.'],
      ['narr', 'Un argentino baja del avión con una maleta, cuarenta pesetas y ninguna idea de lo que le espera.'],
      ['sebas', 'Calor, che. Mucho calor. Bueno… a laburar de lo que sea.'],
      ['narr', 'Los taxis piratas del aeropuerto huelen al turista recién llegado.'],
      ['rey_taxi', '¡Eh, argentino! Puerto Colón son cien mil pesetas. Paga o camina… si puedes.'],
      ['sebas', 'Camino. Pero primero, ustedes.'],
    ],
    waves: [[['thug', 3]], [['thug', 5]]],
    boss: { who: 'rey_taxi', kind: 'tank', hp: 260 },
    outro: [
      ['rey_taxi', 'Vale, vale… el viaje es gratis. ¡Gratis!'],
      ['sebas', 'Puerto Colón. Ahí está el dinero. Ahí voy.'],
    ],
  },
  {
    id: 'c2', n: 2, title: 'Relaciones públicas', date: 'Invierno de 1998', place: 'Puerto Colón', theme: 'neon',
    intro: [
      ['narr', 'Puerto Colón. Primer trabajo: relaciones públicas. Meter turistas en los bares a cualquier precio.'],
      ['sebas', 'Pase, pase, amigo. Primera copa gratis. La segunda… también, si me la pagás vos.'],
      ['gominola', '¡Esta es MI acera, argentino! Los relaciones públicas de esta calle trabajan para mí.'],
      ['narr', 'En un rincón, un tipo cuenta chistes malísimos para que no le peguen. Le están pegando igual.'],
      ['choro', '¡Paren, paren! ¡Mañana a primera hora, a las 6 en punto, tienen la plata!'],
      ['sebas', 'Aguantá, flaco. Ya voy.'],
    ],
    waves: [[['thug', 4], ['gunner', 1]], [['thug', 4], ['gunner', 2]], [['thug', 3], ['gunner', 2], ['tank', 1]]],
    boss: { who: 'gominola', kind: 'gunboss', hp: 320 },
    unlock: 'choro',
    outro: [
      ['choro', '¡Me salvaste, hermano! Te debo una. Mañana a las 6 en punto te la pago.'],
      ['sebas', 'No me debés nada. Pero venís conmigo.'],
      ['narr', '⭐ El Choro se une a la banda. Usa ⭐ en combate: su chiste deja a todos riéndose.'],
    ],
  },
  {
    id: 'c3', n: 3, title: 'Chocolate', date: 'Primavera de 1999', place: 'El paseo marítimo', theme: 'paseo',
    intro: [
      ['narr', 'Segundo trabajo: vender chocolate por el paseo. «El más rico de Marruecos», decía el cartel.'],
      ['sebas', '¡Chocolate, chocolate! El que no compra hoy, mañana llora.'],
      ['narr', 'Un rockero con el pelo de Mick Jagger le vende guitarras de plástico a los turistas en el puesto de al lado.'],
      ['ale', 'Ese chocolate tuyo… ¿me invitas a uno? Es que me olvidé la cartera. Desde 1987.'],
      ['inspector', '¡Puestos sin licencia! ¡Todo el mundo al suelo! El chocolate queda requisado… para mí.'],
      ['ale', 'Ah, no. Mi chocolate gratis, no.'],
    ],
    waves: [[['thug', 5], ['gunner', 1]], [['thug', 5], ['gunner', 2], ['tank', 1]], [['thug', 4], ['gunner', 3], ['tank', 1]]],
    boss: { who: 'inspector', kind: 'gunboss', hp: 380 },
    unlock: 'ale',
    outro: [
      ['ale', '¡Qué riff les metimos! Oye… ¿y el chocolate que te requisaron? ¿Lo partimos? Pagas tú.'],
      ['narr', '⭐ Ale «el Stone» se une a la banda. Su riff de guitarra lanza a los enemigos por los aires.'],
    ],
  },
  {
    id: 'c4', n: 4, title: 'Los barcos', date: 'Verano de 1999', place: 'El puerto deportivo', theme: 'docks',
    intro: [
      ['narr', 'El negocio grande está en el agua: vender de todo a los dueños de los yates. Sin papeles y sin preguntas.'],
      ['narr', 'En el muelle trabaja un hombre callado que acaba de salir de la cárcel. Nadie se le acerca.'],
      ['miguel', '…'],
      ['sebas', '¿Y vos? ¿Sos de hablar poco?'],
      ['miguel', 'Hablo poco. Hasta que hablo mucho. ¡Y HOY HABLO MUCHO!'],
      ['capitan', '¿Quién os ha dejado entrar en MI puerto? ¡Seguridad! Tiradlos al agua.'],
    ],
    waves: [[['thug', 5], ['gunner', 2]], [['thug', 5], ['gunner', 3], ['tank', 1]], [['thug', 6], ['gunner', 3], ['tank', 2]]],
    boss: { who: 'capitan', kind: 'tankboss', hp: 480 },
    unlock: 'miguel',
    outro: [
      ['capitan', '¡Vale! ¡Compro! ¡Lo compro todo! ¿Aceptáis pesetas?'],
      ['sebas', 'Aceptamos todo. Y con la plata… me voy a Brasil.'],
      ['narr', '⭐ Miguel «the Legend» se une a la banda. Cuando entra, gira como un tornado.'],
    ],
  },
  {
    id: 'c5', n: 5, title: 'Brasil', date: 'Carnaval de 2000', place: 'Brasil', theme: 'carnaval',
    intro: [
      ['narr', 'Brasil. Carnaval. Sebas no venía a enamorarse. Pasó igual.'],
      ['ella', '¿Argentino? Mi mamá dice que no me fíe de los argentinos.'],
      ['sebas', 'Tu mamá tiene razón. Pero yo soy la excepción.'],
      ['narr', 'Los hermanos de ella no opinan lo mismo.'],
      ['cunhado', '¿Este es el gringo? ¡Que no salga vivo del carnaval!'],
      ['ella', 'Si llegas al final de la calle… me voy contigo a Tenerife.'],
    ],
    waves: [[['thug', 6]], [['thug', 6], ['gunner', 2], ['tank', 1]], [['thug', 6], ['gunner', 3], ['tank', 2]]],
    boss: { who: 'cunhado', kind: 'tankboss', hp: 520 },
    outro: [
      ['cunhado', 'Está bien, está bien… cuídala. Si no, vamos a Tenerife nadando.'],
      ['ella', 'Bueno, gringo. ¿Y dónde vamos a vivir?'],
      ['sebas', 'En un sitio que se llama San Isidro. Te va a encantar. Creo.'],
    ],
  },
  {
    id: 'c6', n: 6, title: 'San Isidro', date: '2001', place: 'San Isidro', theme: 'sanisidro',
    intro: [
      ['narr', 'San Isidro. Casa nueva, vida nueva. Y empieza la mayor cruzada de la historia contemporánea.'],
      ['narr', 'Las empresas rivales mandan a sus matones. Pero Sebas ya no está solo.'],
      ['roland', 'Me han dicho que necesitas a alguien que intimide. Soy Roland. Mido dos metros. Nem.'],
      ['mohit', 'Y yo me llamo Mohit. Les quito los móviles antes de que llamen a nadie. Pregúntale a Karim y a Nico.'],
      ['federico', '¡Hermanito! Yo me encargo de las cuentas. Confía en mí. Totalmente legal.'],
      ['sebas', 'Federico… cada vez que decís «totalmente legal» alguien acaba mal.'],
    ],
    waves: [[['thug', 6], ['gunner', 3]], [['thug', 6], ['gunner', 3], ['tank', 2]], [['thug', 7], ['gunner', 4], ['tank', 2]]],
    boss: { who: 'federico', kind: 'gunboss', hp: 560, betrayal: true },
    unlock: ['roland', 'mohit'],
    outro: [
      ['narr', 'Federico se escapa por la ventana con la caja fuerte. Bueno, con la caja. La fuerte se le cae en el pie.'],
      ['federico', '¡Esto no es lo que parece! ¡Es una inversión! ¡Mañana te lo devuelvo!'],
      ['choro', 'Eh, esa frase es mía.'],
      ['narr', '⭐ Roland y Mohit se unen a la banda. Pero alguien muy poderoso se ha enterado de todo esto…'],
    ],
  },
  {
    id: 'c7', n: 7, title: 'La gran cruzada', date: 'El presente', place: 'El plató', theme: 'plato',
    intro: [
      ['narr', 'El presente. Tres personas mandan en la isla desde un plató de televisión.'],
      ['diva', '¡Bienvenidos a mi programa! Hoy tenemos de invitado a… un argentino que se cree alguien. ¡Aplausos!'],
      ['coronel', 'Mis hombres rodean el edificio. Nadie sale de aquí sin mi permiso.'],
      ['caudillo', 'Sebas, Sebas… Todo tiene un precio. ¿Cuál es el tuyo?'],
      ['sebas', 'El mío no está en venta. Y el tuyo… lo vamos a cobrar ahora.'],
      ['choro', '¡Mañana a las 6 en punto les pagamos a todos! … ¡CON PIÑAS!'],
    ],
    waves: [[['thug', 6], ['gunner', 4]], [['thug', 6], ['gunner', 4], ['tank', 2]], [['thug', 8], ['gunner', 5], ['tank', 2]]],
    boss: { who: 'caudillo', kind: 'final', hp: 900, adds: ['diva', 'coronel'] },
    outro: [
      ['caudillo', 'Imposible… ¿Cómo un hombre con una maleta y cuarenta pesetas…?'],
      ['sebas', 'No era un hombre. Era una banda.'],
      ['narr', 'Esa noche, en San Isidro, la banda cenó asado. Pagó Ale. Por primera vez en su vida.'],
      ['ale', 'No se acostumbren.'],
      ['narr', 'FIN… por ahora. SEBAS PRESENT.'],
    ],
  },
];
export const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map(c => [c.id, c]));
