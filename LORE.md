# Crónicas de Achinech — el lore de SebasPresent

El juego sucede en **Tenerife**, que los guanches llamaban **Achinech**. El lore mezcla la mitología guanche real con lo que pasa en el juego.

## El mito
- **Achamán**: el dios del cielo, que creó la isla. **Magec**: el sol.
- **Guayota**: el demonio de fuego que vive bajo **Echeyde** (el Teide). Secuestró a Magec y dejó la isla a oscuras. Achamán lo venció, liberó al sol y selló el volcán con el Pan de Azúcar, la punta del Teide.
- **Chaxiraxi**: la madre protectora, a la que se venera en la Basílica de Candelaria. Los altares recargan la plegaria.
- **Tibicenas**: perros negros de ojos rojos, sirvientes de Guayota. Los lobos fieros llevan su sangre.
- **Teiderio**: la sangre de Guayota, enfriada bajo tierra. Es el metal más fuerte, verde como el mar, y aparece en lo más hondo del Malpaís.

## El presente
El sello de Achamán se agrieta: la tierra tiembla y el Teide humea.
- En el este se abrió la **Fosa de Guayota**. La guarda Kargath. Al fondo espera el propio Guayota, y quien lo vence gana la Capa de fuego.
- El fuego despertó a los **dragones** que dormían bajo los dragos. La savia roja del drago se llama "sangre de dragón".
  - **Vermithrax** (rojo) salió en la erupción del Chinyero de 1909.
  - **Nidhogg** (negro) anida junto al Roque Negro.
  - Nadie puede forjar armadura de dragón: solo se consigue de los jefes.
- **Otros jefes**:
  - **Rey Yeti Grom**: Las Cañadas.
  - **Coloso de Obsidiana**: Mina de Guajara.
  - **Reina Sekhet**: malpaís de Güímar.
  - **Morgath**: Charcas de Erjos.
  - **Leviatán**: costa de Los Cristianos.
  - **Varkhul**: un mencey antiguo que pactó con Guayota. Vive en las Ruinas de Teno.
- **El Cabildo**: en apariencia gobierna desde **La Laguna** (Aguere). En secreto es una **orden de magos malignos** que adora a Guayota y quiere romper el sello para quedarse con su poder.
  - Hacen sus rituales en el **Monte de Las Mercedes**, con acólitos de capucha roja que atacan con magia.
  - Los guía el **Magister Perdomo, Gran Brujo del Cabildo**, que es un jefe.
  - Compran toda la retama del Teide para que nadie pueda rezar contra ellos.
- **Personajes** (todos con nombres canarios genéricos):
  - **Carmita**: herbolaria de **La ASO**, el puesto de hierbas de la plaza de La Laguna.
  - **Airam**: el Forzudo de Santa Cruz.
  - **Yeray**: pastor de Vilaflor.
  - **Chona**: la Bruja del Páramo (jefa en el páramo de Erjos).
- **Los jugadores** son forasteros recién llegados.

## Herbología (La ASO)
Las hierbas son plantas canarias. La poción se hace con hierba y vial de agua; si además lleva gofio, sale una súper poción:
- Tabaiba: Ataque.
- Verode: Fuerza.
- Salvia canaria: Defensa.
- Orégano de risco: Distancia.
- Retama del Teide: Plegaria.
- Tajinaste rojo: Magia.

## Geografía del juego
| Antes | Ahora |
|---|---|
| Concejo Central | La Laguna |
| Robledal | La Orotava |
| Picoblanco | Las Cañadas |
| Solquemado | Güímar |
| Verdis | Adeje |
| Puerto Sirena | Los Cristianos |
| Marpiedra | Santa Cruz |
| Avanzada del Olvido | Santiago del Teide |
| Aldea del Cruce | Vilaflor |
| Cabaña del Cazador | Icod de los Vinos |
| Pueblo de los Vientos | La Esperanza |
| Oasis del Halcón | Arico |
| Hondonada Verde | Chayofa |
| Faro del Sur | Faro de Punta Rasca |
| Torre del Mago | Observatorio de Izaña |
| Mina Antigua | Mina de Guajara |
| Templo de la Luz | Basílica de Candelaria |
| Ruinas de Antaño | Ruinas de Teno |
| Altar del Vacío | Altar de Guayota |
| Corazón Roto | Volcán Chinyero |
| Tierras Rotas (wilderness) | El Malpaís |
| Montaña nevada | El Teide |
| Acantilado | Los Gigantes |
| Roca negra | Roque Negro |
| Estanque del Concejo | Laguna de Aguere |
| Fosa de Fuego / Ignaroth | Fosa de Guayota / Guayota |

Los ids internos (`tele_robledal`, `bank_concejo`…) no cambian: solo los nombres visibles.

## En el juego
Los NPC de `client/src/shared/lore.js` tienen en su diálogo la opción "📖 Cuéntame…" con su capítulo:
- Aldric: la isla y el Cabildo.
- Alma: el mito de Guayota.
- Eldric: el teiderio y los dragones.
- Kargath: la Fosa.
- Bruno: los tibicenas.
- Explorador: el Malpaís.
- Sven: las cumbres.
- Irene: el mar.
- Samir: el desierto.
- Gus: las minas.
- Yeray: los guanches de Chinamada.

## Los guanches de Chinamada
En los riscos del noroeste (Poblado de Chinamada, -620, 140) sigue viviendo un pueblo guanche que nunca bajó a las ciudades: casas de piedra seca, tagoror (círculo del consejo), corral de cabras. Fieles a Achamán, enemigos del Cabildo, atacan a los forasteros.
- **Guerrero guanche** (cuerpo a cuerpo, banot y escudo).
- **Hondero guanche** (proyectiles: piedras con honda).
- **Faycán** (magia: rayo de Magec).
- **Mencey de Chinamada** (jefe del poblado, en el tagoror).
- **Cabras** (pasivas).
Misión: *El tagoror de Chinamada* (Yeray, pastor de Vilaflor).


## La ASO: solo socios
Carmita habla en canario de la calle. Para comprar hay que ser socio:
- venir con un socio conectado al lado (gratis), o
- pagar **5 pavos**. El juego no lo explica, pero 1 pavo = 100 monedas, así que son 500. Si preguntas "¿Pavos?", te llama godo y te lo traduce.
Tabla `aso_members` (migración 009). El servidor rechaza cualquier compra o venta en la tienda `aso` de quien no sea socio.


## Casas y castillos
- **Nauzet** (Inmobiliaria Achinech, junto a la urbanización de La Laguna) vende casas:
  - Casa cueva: 5.000 monedas. Tiene cama.
  - Casa terrera: 30.000. Cama y cofre del banco.
  - Casona canaria: 120.000. Cama, cofre y altar de Chaxiraxi.
  Si mejoras, pagas solo la diferencia.
- **Urbanizaciones** (🏠 en el mapa): La Laguna, La Orotava, Güímar, Adeje, Los Cristianos, Santa Cruz, Vilaflor e Icod. La casita del cartel "Tu casa" es la puerta a TU casa. Sales por el mismo sitio.
- **Muebles de la casa:**
  - cama: vida al máximo, cada 5 min, fuera de combate;
  - cofre: tu banco;
  - altar: recarga la plegaria.
  El server lo valida como "estás en una urbanización y tu casa tiene ese mueble", porque dentro de la casa el cliente no manda su posición.
- **Castillos** (mismo modelo que el de La Laguna, `shared/castles.js`): Castillo de San Cristóbal en Santa Cruz (Dácil), Casa Fuerte de Adeje (Acaymo) y Fortaleza de Los Cristianos (Cathaysa). Cada banquero tiene Banco, Mercado (GE) y Tienda.


## Caminos y monturas
- 15 km de caminos de tierra unen todas las ciudades. En cada pueblo hay un poste con una flecha por camino, que dice el destino y la distancia, y otro poste a mitad de cada tramo. Los caminos salen en el minimapa y en el mapa.
- **Tanausú**, el cuadrero de La Laguna, vende:
  - 🐎 Caballo: nivel de combate 5, 2.000 monedas.
  - 🕊️ Súper pardela: nivel 5, 20.000 monedas. Anda por tierra y, con nivel de combate 25, vuela a 9 m por encima de árboles, casas y rocas.
- **Reglas:**
  - si te atacan, no puedes montar en 10 s;
  - si te golpean (daño > 0), te caes;
  - que un bicho te persiga no te baja;
  - atacar, recoger recursos, entrar en un interior o en la Fosa te baja de la montura.
- Los demás jugadores ven tu montura: el Realm manda `m` en el mensaje `p`.


## Entre jugadores
- Si mantienes pulsado sobre otro jugador salen **🤝 Comerciar** y **👣 Seguir**. Las dos opciones funcionan también montado.
- **Comercio** (`server/handlers/trade.js`):
  - Tú lo pides y al otro le sale un aviso; si los dos se lo piden a la vez, se abre directamente.
  - Lo ofrecido queda retenido en el servidor.
  - Hay dos pantallas: aceptar y confirmar.
  - Cualquier cambio en las ofertas quita los "aceptar" y avisa de que la oferta ha cambiado.
  - Si a alguien no le cabe lo que recibe, no se completa.
  - Al cancelar, todo vuelve a su dueño; si no le cabe en la mochila, va al banco.
- **Seguir:** vas detrás del otro jugador a 2 m. Se deja de seguir al tocar la pantalla o usar el joystick.
- **Pestaña 👥**, con dos subpestañas:
  - Amigos: añadir por nombre, ver quién está conectado y dónde, y los jugadores que tienes cerca.
  - Monturas: tu colección; tocas una para llamarla, como en WoW.


## Crónicas de Achinech (la historia de Tenerife)
Misión de Aldric, en La Laguna: escuchar en orden a seis cronistas. Cada uno cuenta su capítulo completo al hablar con él; después se puede volver a escuchar con "📖".
1. **Doña Elena** (La Laguna): el nacimiento volcánico de la isla (Anaga, Teno, Adeje y el Teide) y los primeros pobladores amazigh del norte de África.
2. **Abuelo Guayre** (fuera de Chinamada): Tinerfe el Grande, los nueve menceyatos, el tagoror y el añepa, la vida pastoril (gofio, tamarco, cuevas, trashumancia), los dioses, las momias y el Beñesmén.
3. **Hermano Marcial** (Candelaria): los cabreros de Güímar y la Virgen en la playa de Chimisay (hacia 1400), Chaxiraxi, y el temporal de 1826 que se llevó la imagen original.
4. **Abuela Lola** (Acentejo): el desembarco en Añaza (1494), los bandos de paz y de guerra, Bencomo y Tinguaro, y la Matanza de Acentejo.
5. **Don Rafael** (La Orotava): la modorra, Aguere (1495, muere Tinguaro), La Victoria de Acentejo, la leyenda de Bentor en Tigaiga, la paz de Los Realejos (1496) y la fundación de La Laguna. En el juego, los de Chinamada descienden de los "alzados".
6. **Doña Carmen** (drago de Icod): Garachico en 1706, el Chinyero en 1909, el drago y lo que queda de lo guanche: palabras (gofio, baifo, guirre, tabaiba, tajinaste, gánigo) y nombres.
- **Estatuas de los nueve menceyes** junto a la Basílica de Candelaria, como en la plaza real: Bencomo, Añaterve, Beneharo, Acaymo, Tegueste, Pelinor, Romen, Pelicar y Adjoña. Al tocar una, sale quién era.


## Robo (pickpocket)
Habilidad nueva, **Robo**. Para robar, mantén pulsado sobre un habitante y elige **🫳 Robar**.
- **A quién se le roba:**
  - vecinos: nivel 1 (pan, monedas);
  - pastores: nivel 5;
  - artesanos: nivel 15;
  - herbolarias: nivel 25;
  - guardias: nivel 35;
  - magos: nivel 45 (tabletas);
  - mercaderes: nivel 55;
  - banqueros: nivel 70.
- **Que te pillen** (regla de Nico): a su mismo nivel, 50 %; baja a 0 % cuando le sacas 4 + (su nivel / 2) niveles. Por ejemplo, contra un vecino: nivel 1 → 50 %, nivel 5 → 0 %.
- **Si te pillan:** aparecen guardias que solo te atacan a ti y te persiguen hasta que huyes lejos. Desaparecen al minuto, y durante 6 s no puedes robar.
- **A jugadores:** desde nivel 50 de Robo; te pillan el 50 % a nivel 50 y nunca a nivel 99. Se roba un objeto de su MOCHILA (nunca lo equipado): una pieza, o un 1–5 % de sus monedas. Si te pilla, se entera.
