/**
 * SebasPresent — El Lore: Crónicas de Achinech (Sesión 50)
 *
 * Todo sucede en TENERIFE, que los antiguos guanches llamaban ACHINECH.
 * Basado en la mitología guanche (Achamán, Magec, Guayota, Chaxiraxi, los
 * tibicenas, los menceyes) y en la geografía real de la isla.
 *
 * Cada NPC con `LORE[npcId]` ofrece en su diálogo la opción "📖 Cuéntame…"
 * y narra su capítulo. El canon completo está en LORE.md.
 */

export const LORE_TITLE = 'Crónicas de Achinech';

export const LORE = {
  // Capítulo I — La isla y el Cabildo
  guia_aldric: {
    label: '📖 Cuéntame la historia de la isla',
    pages: [
      'Esta isla es Tenerife. Los antiguos, los guanches, la llamaban Achinech.',
      'En el centro se alza Echeyde, el Teide: la montaña más alta de todas las islas. Los guanches decían que era la puerta del infierno.',
      'Nueve menceyes —reyes— se repartían la isla: Taoro, Güímar, Anaga, Tacoronte, Tegueste, Icod, Daute, Adeje y Abona. Sus nombres aún viven en nuestros pueblos.',
      'Oficialmente gobierna el Cabildo, desde aquí, La Laguna, la antigua vega de Aguere. Por eso todos los caminos empiezan en esta plaza.',
      'Aunque… entre tú y yo: el Cabildo está lleno de magos. Y últimamente sus túnicas se han vuelto rojas. No me gusta nada.',
      'Pero la isla está inquieta. La tierra tiembla, el Teide humea y del Malpaís llegan criaturas que nadie había visto. Habla con Alma, la sacerdotisa: ella conoce la leyenda.',
    ],
  },
  // Capítulo II — El mito: Achamán, Magec y Guayota
  alma_sacerdotisa: {
    label: '📖 Cuéntame la leyenda de Guayota',
    pages: [
      'Escucha la leyenda más antigua de Achinech.',
      'Achamán, el dios del cielo, creó la isla. Magec, el sol, la iluminaba cada día.',
      'Pero bajo el Teide vivía GUAYOTA, el demonio de fuego. Un día salió de las entrañas del volcán, secuestró a Magec y lo encerró dentro de la montaña. La isla quedó a oscuras.',
      'Los guanches rezaron a Achamán. Achamán bajó, venció a Guayota, liberó al sol y selló la boca del volcán con un tapón de piedra: el Pan de Azúcar que aún corona el Teide.',
      'La sangre de Guayota, al enfriarse bajo la tierra, se convirtió en un metal verde que brilla como el mar: el TEIDERIO. Por eso es el metal más fuerte… y se encuentra en lo más hondo del Malpaís.',
      'Chaxiraxi, la madre, cuida de nosotros desde la Basílica de Candelaria. Si tu plegaria se agota, reza en un altar: ella te escucha.',
      'Ahora el sello se agrieta. Al este se ha abierto una fosa de fuego… y los ancianos dicen que Guayota intenta volver.',
      'Y no está solo. Bajo las túnicas del Cabildo se esconde una orden de brujos que lo adora: quieren romper el sello y quedarse con su poder. Los guía el Magister Perdomo.',
    ],
  },
  // Capítulo III — El teiderio, los dragos y los dragones
  eldric_mago: {
    label: '📖 Háblame del teiderio y los dragones',
    pages: [
      'Desde este observatorio, en Izaña, estudio el cielo y el volcán. Y lo que veo no me gusta.',
      'Los minerales de la isla nacen del fuego del Teide: bronce y hierro cerca de la superficie; obsidiana y basaltita en las coladas; y teiderio, la sangre de Guayota, donde la tierra está más rota.',
      '¿Conoces el drago milenario de Icod? Su savia es roja como la sangre: "sangre de dragón". Los guanches creían que los dragos eran dragones dormidos.',
      'Tenían razón. Cuando el sello de Achamán se agrietó, el fuego de Guayota despertó a los dragones que dormían bajo la isla.',
      'Vermithrax, el Dragón Rojo, salió en 1909 por el volcán Chinyero: aquella erupción fue su despertar. Nidhogg, el Dragón Negro, anida junto al Roque Negro.',
      'Sus escamas son más duras que cualquier metal forjado. Ningún herrero puede fabricar armadura de dragón: solo se consigue arrancándosela a los grandes jefes de la isla.',
    ],
  },
  // Capítulo IV — La Fosa de Guayota
  kargath: {
    label: '📖 ¿Qué es esta fosa?',
    pages: [
      'Hace tres lunas la tierra se abrió aquí, al este de la isla. De la grieta sale el aliento de Guayota.',
      'Primero salieron diablillos de lava. Luego escupefuegos, espíritus ígneos, brutos de magma… Todos son hijos del fuego del demonio.',
      'Yo guardo la entrada para que no suban a Santa Cruz. Los valientes bajan a limpiar la fosa ronda tras ronda.',
      'Al fondo de todo espera el propio GUAYOTA, o lo que queda de él. Quien lo derrote se lleva la Capa de fuego: tejida con su propia llama.',
    ],
  },
  // Capítulo V — Los tibicenas y el monte
  bruno_cazador: {
    label: '📖 ¿Qué acecha en los montes?',
    pages: [
      'Los viejos de Icod hablan de los tibicenas: perros negros enormes, de ojos rojos, sirvientes de Guayota.',
      'Los lobos que rondan el monteverde se han vuelto más fieros desde que tiembla la tierra. Yo creo que llevan sangre de tibicena.',
      'Y en las Charcas de Erjos vive Chona, una bruja que maldice a los caminantes. Mi abuelo decía que las brujas de Las Raíces se reunían allí en las noches sin luna.',
    ],
  },
  // Capítulo VI — El Malpaís y el Rey Esqueleto
  explorador_herido: {
    label: '📖 ¿Qué hay en el Malpaís?',
    pages: [
      'Al oeste de Santiago del Teide empieza el Malpaís: lava vieja, sin ley. Allí los forasteros se matan entre ellos por un puñado de teiderio.',
      'En las Ruinas de Teno descansaba un mencey antiguo, Varkhul, que pactó con Guayota para no morir nunca. Ahora es el Rey Esqueleto y sus huesos no descansan.',
      'Más al fondo está el volcán Chinyero, donde duerme Vermithrax… y a veces no duerme.',
    ],
  },
  // Capítulo VII — Las cumbres
  sven_guardia: {
    label: '📖 ¿Qué pasa en las cumbres?',
    pages: [
      'En invierno la nieve cubre Las Cañadas y el Teide. Allí arriba viven los yetis, bestias del frío.',
      'Su rey, Grom, era una leyenda para asustar a los niños de La Esperanza… hasta que el volcán lo despertó.',
      'Es fuerte pero torpe: no sabe rodear las rocas. Quien lo sepa aprovechar, lo vencerá.',
    ],
  },
  // Capítulo VIII — El mar
  irene_farera: {
    label: '📖 ¿Qué hay en el mar?',
    pages: [
      'Los pescadores de Los Cristianos siempre han contado historias de una serpiente de mar gigante.',
      'Yo la he visto desde el faro de Punta Rasca: el Leviatán. Cambia de color como el mar, verde y azul, y según su color ataca de una forma u otra.',
      'Desde que tiembla el Teide, el agua está caliente y el Leviatán se acerca cada vez más a la orilla.',
    ],
  },

  // Capítulo IX — El malpaís de Güímar
  samir_mercader: {
    label: '📖 ¿Qué pasa en el desierto?',
    pages: [
      'Mis caravanas cruzan el malpaís de Güímar desde que tengo memoria. Nunca había visto escorpiones tan grandes.',
      'Dicen que bajo la arena reina Sekhet, una escorpión del tamaño de una casa, que escupe veneno desde lejos y deja charcos que queman.',
    ],
  },
  // Capítulo X — La Mina de Guajara
  gus_minero: {
    label: '📖 ¿Qué hay en las minas?',
    pages: [
      'Guajara es la montaña que vigila al Teide. En sus minas sale acero, oro… y a veces obsidiana negra como la noche.',
      'Los mineros que bajaron más hondo contaron que la obsidiana se movía. Ahora un Coloso de Obsidiana guarda la mina: las espadas rebotan en él.',
    ],
  },

  // Capítulo XI — Las hierbas de la isla
  carmita_aso: {
    label: '📖 ¿De dónde salen tus hierbas?',
    pages: [
      'Cada hierba de mi puesto crece en un rincón de la isla, mi niño.',
      'La tabaiba en la costa, el verode en los riscos, la salvia en el monte, el orégano en los barrancos… y el tajinaste rojo solo en Las Cañadas, a los pies del Teide.',
      'Los guanches ya curaban con ellas. Y con gofio, que lo arregla todo.',
      'La retama del Teide calma el espíritu y devuelve la fe: por eso los del Cabildo la quieren toda. Sin fe, nadie puede rezar contra sus hechizos.',
    ],
  },
};
