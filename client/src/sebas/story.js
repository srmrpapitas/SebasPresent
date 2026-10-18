/**
 * SEBAS PRESENT — «La Cruzada» · decisiones y 400 finales
 *
 * Al final de cada capítulo Sebas tiene que decidir algo. Cada respuesta tiene
 * su propia contestación y se guarda. El final del capítulo 7 se arma con
 * todas tus decisiones:
 *
 *   A · Qué hiciste con Federico (cap. 6) ............ 5 opciones
 *   B · Corazón de la banda (caps. 1-4, 0-8 puntos) .. 5 niveles
 *   C · Lo que le prometiste a Ella (cap. 5) ......... 4 opciones
 *   D · Qué hiciste con el Caudillo (cap. 7) ......... 4 opciones
 *
 *   5 × 5 × 4 × 4 = 400 finales distintos, cada uno con su número y su título.
 */

// ------------------------------------------------------------
// Decisiones (al final de cada capítulo)
// ------------------------------------------------------------
// opción: { t: texto del botón, pts: corazón de la banda (caps. 1-4), reply: [[quién, texto], …] }
export const CHOICES = {
  c1: {
    who: 'sebas', prompt: 'Te quedan cuarenta pesetas. ¿Qué haces con ellas?',
    options: [
      { t: 'Dárselas a la señora que pide en la puerta', pts: 2, reply: [
        ['sebas', 'Tome, señora. A mí me sobra la suerte.'],
        ['narr', 'La señora le guiña un ojo: «Puerto Colón, muchacho. Pregunta por el que cuenta chistes».'] ] },
      { t: 'Guardarlas. Por algo se empieza', pts: 1, reply: [
        ['sebas', 'Cuarenta pesetas. Mañana serán ochenta. Y pasado, un imperio.'],
        ['narr', 'Las guardó en el calcetín izquierdo. Ahí siguen, por si acaso.'] ] },
      { t: 'Jugárselas en la tragaperras del aeropuerto', pts: 0, reply: [
        ['narr', 'La máquina hace tilín-tilín… y se las traga todas.'],
        ['sebas', 'Bueno. Así no me pesan los bolsillos.'] ] },
    ],
  },
  c2: {
    who: 'choro', prompt: '«Prestame veinte y te devuelvo cuarenta. Mañana. A las 6 en punto.»',
    options: [
      { t: 'Prestárselos, sabiendo que no vuelven', pts: 2, reply: [
        ['sebas', 'Tomá. Y no me los devuelvas: invitame a reírme.'],
        ['choro', '¿En serio? … Hermano, a vos te cuento los chistes buenos. Los tres que tengo.'] ] },
      { t: 'Prestárselos… con contrato en una servilleta', pts: 1, reply: [
        ['sebas', 'Firmá acá. Con fecha y hora.'],
        ['choro', '«Mañana, 6 en punto». ¿Ves? Ya está firmado. Esta servilleta vale oro.'] ] },
      { t: 'No prestarle nada', pts: 0, reply: [
        ['sebas', 'Ni veinte, ni diez, ni uno.'],
        ['choro', 'Bueno, bueno… te los pido mañana. A las 6 en punto.'] ] },
    ],
  },
  c3: {
    who: 'ale', prompt: 'Ale mira el chocolate recuperado. «¿Lo partimos? Pagas tú.»',
    options: [
      { t: 'Darle la mitad', pts: 2, reply: [
        ['sebas', 'Mitad y mitad, rockero.'],
        ['ale', '¿La mitad? ¿Para mí? … Esto se merece un solo de guitarra. Gratis. Por esta vez.'] ] },
      { t: 'Cobrarle a él, por una vez en su vida', pts: 1, reply: [
        ['sebas', 'Son quinientas pesetas.'],
        ['ale', '¿Pagar yo? … Te pago en riffs. Uno ahora y otro el año que viene.'] ] },
      { t: 'Comérselo todo delante de él', pts: 0, reply: [
        ['narr', 'Sebas se come el chocolate entero. Despacio. Mirándolo a los ojos.'],
        ['ale', 'Eso ha sido cruel. … Respeto.'] ] },
    ],
  },
  c4: {
    who: 'miguel', prompt: 'Miguel se queda callado mirando el mar. «Tú no sabes lo que hice.»',
    options: [
      { t: '«No me importa tu pasado. Me importa mañana»', pts: 2, reply: [
        ['sebas', 'Lo que hiciste ya lo pagaste. Mañana empezás de nuevo. Conmigo.'],
        ['miguel', '…'],
        ['miguel', 'Gracias. … ¡GRACIAAAS!'] ] },
      { t: '«Contame qué pasó»', pts: 1, reply: [
        ['miguel', 'Le robé el bocadillo a un guardia. Luego a otro. Luego a todos. Doce años.'],
        ['sebas', '¿Doce años por bocadillos?'],
        ['miguel', 'Eran bocadillos muy buenos.'] ] },
      { t: '«Si me fallás, te vas»', pts: 0, reply: [
        ['sebas', 'Una sola oportunidad. Una.'],
        ['miguel', 'Una basta. … Nunca tuve ni esa.'] ] },
    ],
  },
  c5: {
    who: 'ella', prompt: 'Ella te mira antes de subir al avión. «Prométeme algo, gringo.»',
    options: [
      { t: '«Una casa con vistas al Teide»', reply: [
        ['sebas', 'Te prometo una casa con vistas al volcán más alto de España.'],
        ['ella', '¿Con paredes?'],
        ['sebas', 'Con vistas. Las paredes… vamos viendo.'] ] },
      { t: '«Que nunca te voy a mentir»', reply: [
        ['sebas', 'Nunca te voy a mentir. Nunca.'],
        ['ella', 'Eso es mucho más difícil que una casa.'],
        ['sebas', 'Por eso te lo prometo a vos.'] ] },
      { t: '«Nada. Solo esta noche»', reply: [
        ['sebas', 'No prometo nada. Solo esta noche. Y es la mejor de mi vida.'],
        ['ella', 'Entonces bailemos hasta el final de la calle.'] ] },
      { t: '«Que se venga tu familia entera»', reply: [
        ['sebas', 'Que vengan tus hermanos. Y tu mamá. Y los perros.'],
        ['cunhado', '¿TODOS? … Ya me cae bien el gringo.'],
        ['ella', 'No sabes lo que acabas de hacer.'] ] },
    ],
  },
  c6: {
    who: 'federico', prompt: 'Federico, en el suelo, abrazado a la caja. «Hermanito… ¿qué vas a hacer conmigo?»',
    options: [
      { t: 'Perdonarlo', reply: [
        ['sebas', 'Sos mi hermano. Te perdono. Pero la caja se queda.'],
        ['federico', '¿De verdad? … Mamá tenía razón: sos el bueno.'] ] },
      { t: 'Entregarlo a la policía', reply: [
        ['sebas', 'Explícaselo a ellos. A mí ya no me engañás.'],
        ['federico', '¡Sebas! ¡Pedile a Mohit que me devuelva el móvil al menos!'],
        ['mohit', 'No.'] ] },
      { t: 'Desterrarlo a La Gomera', reply: [
        ['sebas', 'Hay un barco a La Gomera en una hora. Subite.'],
        ['federico', '¿La Gomera? ¡Allí se habla silbando!'],
        ['sebas', 'Perfecto. Así no podés mentir con palabras.'] ] },
      { t: 'Ponerlo a trabajar hasta pagar la deuda', reply: [
        ['sebas', 'Vas a trabajar en la banda hasta la última peseta.'],
        ['ale', 'Y con intereses. Te lo digo yo, que de esto sé.'],
        ['federico', '¿Trabajar? ¿Yo? … ¿Hay horario flexible?'] ] },
      { t: 'Dejar que Roland lo mire', reply: [
        ['sebas', 'Roland. Miralo.'],
        ['roland', '…'],
        ['federico', '¡Vale! ¡VALE! ¡Lo devuelvo todo! ¡Hasta el alfajor de 1979!'] ] },
    ],
  },
  c7: {
    who: 'caudillo', prompt: 'El Caudillo, sin guardias y sin plató. «¿Y ahora qué, argentino?»',
    options: [
      { t: 'Entregarlo en directo, delante de las cámaras', reply: [
        ['sebas', 'Sonreí. Estás en directo.'],
        ['diva', '¡Corten! … No, no corten. ¡Esto es audiencia!'] ] },
      { t: 'Dejarlo ir sin nada', reply: [
        ['sebas', 'Andate. Con lo puesto. Como llegué yo.'],
        ['caudillo', '¿Sin nada? … Nadie me había hecho algo tan cruel.'] ] },
      { t: 'Quedarse el plató', reply: [
        ['sebas', 'Este plató ahora es nuestro. Luces, cámara… banda.'],
        ['choro', '¡Por fin un escenario! ¡Tengo material para años!'] ] },
      { t: 'Que pague el asado de toda San Isidro', reply: [
        ['sebas', 'Vas a pagar el asado. De todo San Isidro.'],
        ['ale', '¿Alguien que paga? … Esto es lo más bonito que he visto nunca.'] ] },
    ],
  },
};

// ------------------------------------------------------------
// Piezas de los finales
// ------------------------------------------------------------
const END_A = [   // Federico
  [['narr', 'Federico volvió a casa por Navidad. Trajo turrón. Lo había pagado. Por primera vez en su vida.'],
   ['federico', 'No te acostumbres, hermanito. Pero… gracias.']],
  [['narr', 'Federico pasó dos años a la sombra. Miguel le mandaba un libro cada mes con una nota: «Aprende a girar».'],
   ['federico', 'Salgo el martes. ¿Me venís a buscar? … ¿Sebas?']],
  [['narr', 'Federico vive en La Gomera. Vende miel de palma y aprendió el silbo. Silba «mañana te lo devuelvo» y nadie le cree.'],
   ['federico', '¡Fiuuu, fiu-fiu! (Que me prestes para el barco.)']],
  [['narr', 'Federico trabajó en la banda hasta pagar la última peseta. Tardó once años. Ale le cobró intereses hasta el final.'],
   ['federico', 'Once años, hermanito. Y te digo una cosa: el trabajo honrado no está tan mal. Está horrible, pero no tan mal.']],
  [['narr', 'Roland lo miró. Solo lo miró. Federico devolvió la caja, la plata, el alfajor de 1979 y pidió perdón en tres idiomas.'],
   ['roland', 'Ahora es buena persona. Lo vigilo. Siempre.']],
];
const END_B = [   // Corazón de la banda (0-1, 2-3, 4, 5-6, 7-8 puntos)
  [['narr', 'La banda se separó. Cada uno por su lado. Solo el Choro sigue llamando, cada mañana a las 6 en punto. Sebas nunca contesta.'],
   ['choro', '¿Sebas? … Bueno, te llamo mañana. A las 6 en punto.']],
  [['narr', 'La banda solo se ve en bodas y entierros. Se quieren a su manera: de lejos y sin pagar las rondas.'],
   ['ale', 'Os echo de menos. Pero no tanto como para invitar.']],
  [['narr', 'La banda sigue a medias: el Choro y Ale discuten quién no paga, Miguel calla, Roland vigila la puerta y Mohit vende móviles «de segunda mano».'],
   ['mohit', 'Jefe, este es suyo. Se lo vendo barato.']],
  [['narr', 'La banda abrió un bar en San Isidro. Se llama «Las 6 en punto». Nunca ha abierto a su hora.'],
   ['miguel', 'Yo sirvo las copas. En silencio. … ¡Y CON MUCHO HIELO!']],
  [['narr', 'La banda se volvió familia. Cada domingo, asado en casa de Sebas: el Choro cuenta chistes, Ale trae la guitarra (nunca la carne), Miguel dice su frase de la semana, Roland hace de sombrilla y Mohit devuelve los móviles al final de la tarde. Casi todos.'],
   ['roland', 'Familia. Igen.']],
];
const END_C = [   // Ella
  [['narr', 'Ella y Sebas construyeron la casa con vistas al Teide. Al baño le faltan paredes, pero las vistas son increíbles.'],
   ['ella', 'Gringo, el próximo verano: paredes.']],
  [['narr', 'Ella sigue a su lado. Sebas nunca le mintió. Bueno, una vez, con el precio de un asado. Ella lo supo. Ella siempre lo sabe.'],
   ['ella', 'Treinta euros el kilo, ¿eh? Ya hablaremos.']],
  [['narr', 'Ella volvió a Brasil. Cada carnaval llega una postal a San Isidro con una sola frase: «Todavía me debes el final de la calle».'],
   ['sebas', 'Algún carnaval llego, Ella. Algún carnaval.']],
  [['narr', 'Los tres cuñados se mudaron a San Isidro, con la suegra y cuatro perros. Sebas ya no conoce el silencio. Nunca más estuvo solo.'],
   ['cunhado', '¡Gringo! ¿Qué hay de cena? Somos once.']],
];
const END_D = [   // El Caudillo y la isla
  [['narr', 'El Caudillo cayó en directo, ante tres millones de espectadores. La Diva lloró en antena: fue la mejor audiencia de su vida.'],
   ['diva', 'Gracias, Tenerife. Mañana, más.']],
  [['narr', 'Sebas lo dejó ir sin nada. Hoy el Caudillo trabaja de relaciones públicas en Puerto Colón. «Primera copa gratis. La segunda… también».'],
   ['caudillo', 'Pase, pase, amigo. … Esto es más difícil de lo que parece.']],
  [['narr', 'Sebas se quedó con el plató. «SEBAS PRESENT» se emite cada noche: chistes del Choro, riffs de Ale y Roland mirando a cámara veinte minutos.'],
   ['choro', '¡Buenas noches, Tenerife! ¡Mañana, a las 6 en punto, más!']],
  [['narr', 'El Caudillo pagó el asado de toda San Isidro. Novecientos kilos de carne. Ale lloró de emoción y repitió seis veces.'],
   ['ale', 'Es el día más feliz de mi vida. No he pagado nada y hay de todo.']],
];
// Última frase de Sebas: una distinta para cada combinación Federico × Caudillo (20)
const END_LAST = [
  ['Perdoné a mi hermano y entregué a un rey. Raro, ¿no? Así es la justicia en esta isla.',
   'Perdoné a mi hermano y dejé ir a un rey. Esta isla me enseñó a perdonar. Y a cobrar.',
   'Perdoné a mi hermano y ahora salgo en la tele. Mamá estaría orgullosa. De los dos.',
   'Perdoné a mi hermano y el Caudillo pagó la carne. El mejor asado de la historia.'],
  ['Mi hermano en la cárcel, el Caudillo en la tele. A veces la justicia sale en directo.',
   'Mi hermano preso y el Caudillo libre. Algún día entenderé por qué. Hoy no.',
   'Mi hermano a la sombra y yo bajo los focos. Cosas de familia.',
   'Le guardé un plato a Federico. Se lo llevo el martes.'],
  ['Federico silba en La Gomera y el Caudillo llora en la tele. Se oye desde aquí.',
   'Uno en La Gomera, otro en Puerto Colón. Yo, en casa. Como debe ser.',
   'Le mando a Federico el programa por correo. Lo ve silbando.',
   'Le mandamos a Federico un táper de asado a La Gomera. Llegó vacío. Ya sé por qué.'],
  ['Federico trabaja, el Caudillo cayó. Hay días en que todo encaja.',
   'Federico trabajando y el Caudillo de relaciones públicas. Esta isla tiene sentido del humor.',
   'Federico lleva las cuentas del programa. Las reviso dos veces. Tres.',
   'Federico sirvió el asado. Se comió la mitad. Algunas cosas no cambian.'],
  ['Roland mira a Federico y la tele mira al Caudillo. Todos vigilados.',
   'Roland vigila a mi hermano y yo dejé ir al Caudillo. Cada uno con su condena.',
   'Roland sale en el programa mirando a cámara. Es el que más audiencia tiene.',
   'Roland cuidó la parrilla. Nadie se atrevió a robar ni una morcilla.'],
];
const TITLE_D = ['El justiciero', 'El hombre libre', 'La estrella de la tele', 'El rey del asado'];
const TITLE_A = ['que perdonó a su hermano', 'que entregó a su hermano', 'que desterró a su hermano', 'que puso a trabajar a su hermano', 'que dejó que Roland mirara'];
const TITLE_B = ['solo', 'con la banda de lejos', 'con la banda a medias', 'con su bar a deshora', 'con su familia elegida'];
const TITLE_C = ['bajo el Teide', 'sin mentiras', 'con una postal cada carnaval', 'con tres cuñados en casa'];

export const ENDINGS_TOTAL = END_A.length * END_B.length * END_C.length * END_D.length;   // 400

/** Corazón de la banda (0-8 puntos de los caps. 1-4) → nivel 0-4 */
export function heartLevel(choices = {}) {
  let p = 0;
  for (const c of ['c1', 'c2', 'c3', 'c4']) { const o = CHOICES[c].options[choices[c] ?? 1]; p += o?.pts ?? 1; }
  return p <= 1 ? 0 : p <= 3 ? 1 : p === 4 ? 2 : p <= 6 ? 3 : 4;
}

/** Arma el final a partir de las decisiones guardadas. */
export function buildEnding(choices = {}) {
  const a = Math.min(4, choices.c6 ?? 0), b = heartLevel(choices), c = Math.min(3, choices.c5 ?? 0), d = Math.min(3, choices.c7 ?? 0);
  const n = a * 80 + b * 16 + c * 4 + d + 1;   // 1…400
  const title = `${TITLE_D[d]} ${TITLE_A[a]}, ${TITLE_B[b]}, ${TITLE_C[c]}`;
  const lines = [
    ['narr', 'Años después…'],
    ...END_D[d], ...END_A[a], ...END_C[c], ...END_B[b],
    ['sebas', END_LAST[a][d]],
    ['narr', `FINAL ${n} de ${ENDINGS_TOTAL}: «${title}». SEBAS PRESENT.`],
  ];
  return { n, title, lines, axes: { a, b, c, d } };
}
