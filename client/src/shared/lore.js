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
  // Capítulo XII — Los guanches de Chinamada
  yeray_pastor: {
    label: '📖 ¿Quiénes viven en Chinamada?',
    pages: [
      'Al noroeste, en los riscos de Chinamada, sigue viviendo un pueblo guanche que nunca bajó a las ciudades.',
      'Viven como sus abuelos: casas de piedra seca, pieles de cabra, gofio y leche. Pelean con banot y lanzan piedras con la honda mejor que nadie.',
      'Se reúnen en el tagoror, el círculo de piedras, y los manda un mencey. Sus faycanes, los sacerdotes, rezan a Magec y lanzan su luz como un rayo.',
      'Son fieles a Achamán y odian al Cabildo: dicen que los magos les quitaron sus tierras. Por eso atacan a cualquier forastero que se acerque al poblado.',
      'Si vas, ve preparado. Y respeta a las cabras, que son lo que más quieren.',
    ],
  },

  // ============================================================
  // Sesión 50 — CRÓNICAS DE ACHINECH: la historia de Tenerife en 7 capítulos
  // (misión "Crónicas de Achinech"). Historia real + el mito del juego.
  // ============================================================
  cronista_elena: {
    label: '📖 Capítulo I: El nacimiento de Achinech',
    pages: [
      'Antes que nadie, aquí solo había mar. Hace millones de años, el fuego del fondo del océano empezó a subir… y subir… hasta asomar la cabeza.',
      'Primero nacieron los macizos viejos: Anaga al noreste, Teno al noroeste y Adeje al sur. Eran tres islas sueltas.',
      'Luego los volcanes del centro las soldaron en una sola. Y encima de todo creció Echeyde, el Teide: más de tres mil setecientos metros. La montaña más alta de España.',
      'Los que llegaron después la llamaron Achinech. Vinieron del norte de África, del pueblo amazigh, hace más de dos mil años. Cruzaron el mar con sus cabras, su cebada y su lengua.',
      'Nadie sabe bien cómo llegaron ni por qué. Lo que sí sabemos es que se quedaron, y que con el tiempo se olvidaron del mar: los guanches casi no navegaban.',
      '"Guanche" viene de su propia lengua: "guan Chinet", el hombre de Tenerife. Así se llamaban ellos.',
      'Ve a ver al Abuelo Guayre, el pastor que vive junto a Chinamada. Él sabe cómo vivían. Y no se lo leyó en ningún libro.',
    ],
  },
  abuelo_guayre: {
    label: '📖 Capítulo II: Los nueve menceyes y la vida guanche',
    pages: [
      'Dicen que hubo un rey de toda la isla, Tinerfe el Grande, en Adeje. Cuando murió, sus nueve hijos se la repartieron. Así nacieron los nueve menceyatos.',
      'Taoro, Güímar, Anaga, Tacoronte, Tegueste, Icod, Daute, Adeje y Abona. Cada uno con su mencey, su rey. Por eso esos nombres siguen en el mapa.',
      'El mencey llevaba el añepa, un bastón de mando, y se reunía con los nobles, los achimenceyes, en el tagoror: un círculo de piedras al aire libre. Allí se juzgaba y se decidía la guerra.',
      'Se vivía de las cabras y las ovejas, de la cebada y del gofio, que es grano tostado y molido. Vestían el tamarco, de piel de cabra. Y muchos vivían en cuevas, frescas en verano y calientes en invierno.',
      'En verano se subía el ganado a las cumbres y en invierno se bajaba a la costa. Eso se sigue haciendo: se llama trashumancia.',
      'Su dios era Achamán, el del cielo. Magec era el sol. Guayota, el demonio que vivía dentro del Teide. Y Chaxiraxi, la madre.',
      'A sus muertos importantes los momificaban: los secaban y los envolvían en pieles. Los guardaban en cuevas. Todavía hoy aparecen algunas.',
      'Cuando acababa la cosecha hacían el Beñesmén, la gran fiesta: comida, bailes y luchas. Luchar era cosa seria, de honor. Algo de eso sigue vivo en la lucha canaria.',
      'Ahora baja a Candelaria y habla con el Hermano Marcial. Allí pasó algo que cambió la isla un siglo antes de que llegaran los castellanos.',
    ],
  },
  ermitano_candelaria: {
    label: '📖 Capítulo III: La Virgen de Candelaria',
    pages: [
      'Hacia el año 1400, dos cabreros del menceyato de Güímar paseaban sus cabras por la playa de Chimisay. Y vieron una figura de mujer encima de una roca, junto al mar.',
      'Los pastores no sabían lo que era. Uno quiso tirarle una piedra… y cuentan que se le quedó el brazo paralizado. El otro intentó cortarla y se hirió a sí mismo.',
      'El mencey de Güímar mandó llevarla a su cueva. Los guanches la llamaron Chaxiraxi, la madre que sostiene el mundo, y la veneraron durante cien años sin saber nada de cristianos.',
      'Cuando llegaron los castellanos y vieron a los guanches adorando a una Virgen con un niño en brazos… no se lo podían creer.',
      'Esa imagen se la llevó el mar en 1826, en un temporal. La que hay hoy es una copia. Pero cada 15 de agosto los peregrinos siguen viniendo andando a verla.',
      'Fuera de la basílica están los nueve menceyes de piedra, mirando al mar. Ve a verlos. Y luego busca a la Abuela Lola, en Acentejo: allí empieza la parte triste.',
    ],
  },
  abuela_lola: {
    label: '📖 Capítulo IV: La conquista y la Matanza de Acentejo',
    pages: [
      'En 1494 desembarcaron los castellanos en la playa de Añaza, donde hoy está Santa Cruz. Venían a conquistar la última isla libre de Canarias. Las otras ya habían caído.',
      'Los menceyes no se pusieron de acuerdo. Güímar, Anaga, Adeje y Abona pactaron con los de fuera: eran los bandos de paz.',
      'Taoro, Tacoronte, Tegueste, Icod y Daute decidieron luchar: los bandos de guerra. Los capitaneaba Bencomo, el mencey de Taoro, con su hermano Tinguaro.',
      'Los castellanos subieron hacia el valle de Taoro. A la vuelta, en el barranco de Acentejo, los guanches los esperaban arriba en las laderas.',
      'Piedras, lanzas, gritos… Fue una masacre. La mayoría de los soldados no salió viva de aquel barranco. Su capitán escapó herido y se volvió a Gran Canaria.',
      'Por eso este pueblo se llama La Matanza de Acentejo. Fue una de las peores derrotas de los castellanos en toda la conquista de Canarias.',
      'Pero volvieron. Siempre vuelven, mi niño. Ve a La Orotava y que Don Rafael te cuente el final.',
    ],
  },
  maestro_rafael: {
    label: '📖 Capítulo V: La caída de los menceyes',
    pages: [
      'Después de Acentejo vino algo peor que cualquier ejército: la modorra. Una enfermedad que dejaba a la gente dormida, sin fuerzas. Murieron muchísimos guanches.',
      'A finales de 1495 los castellanos volvieron, con más hombres y caballos. En la vega de Aguere, donde hoy está La Laguna, los guanches perdieron en campo abierto. Allí murió Tinguaro.',
      'Semanas después, en Navidad, se encontraron otra vez cerca de Acentejo. Esta vez ganaron los castellanos. El pueblo de al lado se llama, por eso, La Victoria de Acentejo.',
      'Cuenta la leyenda que Bentor, hijo de Bencomo y último mencey de Taoro, no quiso rendirse jamás. Se tiró desde el risco de Tigaiga antes de que lo cogieran.',
      'En 1496 los menceyes que quedaban se rindieron en Los Realejos. Muchos guanches fueron vendidos como esclavos. Otros se escondieron en las montañas: los llamaron "alzados".',
      'Ese mismo año se fundó San Cristóbal de La Laguna, en la vega de Aguere. La ciudad donde empezaste tu viaje nació sobre un campo de batalla.',
      'Aquí, en el juego, hay quien dice que los de Chinamada son descendientes de aquellos alzados. Por eso odian al Cabildo: para ellos, la guerra nunca terminó.',
      'Para el final, ve a Icod de los Vinos. Doña Carmen cuida el drago. Ella te dirá qué quedó de todo esto.',
    ],
  },
  dona_carmen: {
    label: '📖 Capítulo VI: Lo que quedó',
    pages: [
      'Lo que no se llevó la guerra se lo quiso llevar el volcán. En 1706, una erupción enterró Garachico, el mejor puerto de la isla. La lava llenó la bahía. El pueblo nunca volvió a ser lo que era.',
      'La última vez que habló el Teide fue en 1909, por el Chinyero. Aquí decimos que fue Vermithrax despertando. Los científicos dicen otra cosa. Tú elige.',
      'Este drago es de los más viejos del mundo. Su savia es roja como la sangre: "sangre de drago". Los guanches la usaban para curar.',
      'Los guanches no desaparecieron del todo. Se mezclaron. Mira tu cara en el agua: puede que tengas algo de ellos.',
      'Y siguen en las palabras. Gofio, baifo, guirre, tabaiba, tajinaste, gánigo… son palabras guanches que todavía usamos sin darnos cuenta.',
      'Y en los nombres: Tenerife, Taoro, Güímar, Anaga, Tegueste, Icod, Adeje… y en nombres de personas como Yeray, Dácil, Tanausú, Acaymo o Cathaysa.',
      'Ahora vuelve con Aldric, en La Laguna. Ya conoces la historia de Achinech mejor que muchos que nacieron aquí.',
    ],
  },
};
