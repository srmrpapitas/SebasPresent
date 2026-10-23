# SebasPresent — PENDIENTE (18 oct 2026)

> Para la próxima IA que tome el repo. Lee también `INVARIANTS.md`.
> Hecho hoy: 4 commits de seguridad del servidor + 1 del cliente (ver `git log`).

## ⚠️ PRIORIDAD — pedido del usuario (18 oct, 21:43). Hacer en este orden y tachar al terminar
> El usuario quiere el juego "impecable" y jugable. NADA de minijuegos nuevos (La Cruzada se queda como está;
> su versión 2 está aparcada en la rama `wip/cruzada-v2`, no fusionar).
1. [x] **Objetivo equivocado en grupo** (19 oct, 6080343): atacando al yeti con un compañero cerca, el log dice "Atacas a Sebas6".
       Un toque sobre un monstruo NUNCA debe elegir a un jugador; a compañeros de grupo nunca se les ataca;
       a jugadores solo en zona PvP / duelo y solo si se toca al jugador explícitamente.
2. [x] **Combate lento / no estilo OSRS (PvE y PvP)** (19 oct, 716e0f3 — falta probarlo con 2 jugadores reales en producción): al atacar tarda y no golpea al ritmo. Duelo contra Sebas
       "horrible". Revisar el bucle de ataque (ticks, cola de acciones, respuesta inmediata en el cliente,
       animación y daño sincronizados, sin esperar ida y vuelta para empezar a pegar).
3. [x] **Retraso de ~5 s al equipar y en acciones** (19 oct, 269f682 — equipar/quitar/comer al instante) (el padre juega desde Tenerife): respuesta optimista en el
       cliente (equipar/quitar/comer al instante y corregir si el servidor dice que no), medir qué tarda.
4. [x] **Capa + carcaj** (19 oct, 720bdd6 — el carcaj va a la cadera, procedural, lo ven todos): solo se puede llevar uno de los dos; deben poder llevarse a la vez (capa en `cape`,
       carcaj en `quiver`), también en el modelo 3D.
5. [x] **Ropa de arquero completa** (19 oct, fe6b35b — piezas propias de arquero; mago ya tenía sombrero/túnica/falda; guantes y botas de mago siguen con la forma genérica, quedan tapados por la túnica) (no solo "armadura de cuero"): capucha/cofia, pechera, pierneras, brazales,
       botas por tiers, igual que la armadura de melee. **Ropa de mago** completa (sombrero, túnica, falda,
       guantes, botas) por tiers. Que se vea en el modelo, se pueda conseguir (tiendas/drops/crafteo) y tenga bonos.
6. [x] **Pueblos vacíos** (19 oct — un edificio con lore y misión en los 8 pueblos principales): lore y cosas que hacer en cada pueblo; edificios en los que entrar con NPC dentro
       (tabernas, herreros, casas con historia, misiones cortas). Empezar por los pueblos principales.
7. [x] Dejarlo todo impecable: probar en móvil y PC antes de cada push, un commit por arreglo. (Regla de trabajo: se ha seguido en cada push.)
8. [x] **Jugabilidad (pedido 19 oct, 09:02 — lo primero ahora)** (23 oct — hecho; solo queda que Nico mire el ritmo del duelo en producción con 2 personas): partida de prueba completa en móvil y PC como
       jugador nuevo y como nivel alto; apuntar y arreglar todo lo que se sienta lento, confuso o roto
       (andar, tocar objetivos, combate, botín, mochila, banco, diálogos, cámara). Probar PvP/duelo con 2 clientes.
   - (22 oct, tarea programada — a medias) Partida de prueba de jugador nuevo en móvil 390×844 y PC (guía, talar, fuego,
     pollo, cocinar, pestañas, diálogo, banco). Arreglado: ~1 de cada 10 toques para andar no movía al personaje
     (`clock.getElapsedTime()` dejaba dt≈0) y ahora rodea árboles/rocas; «Demasiado lejos» al llegar a un árbol/roca/pesquero
     (el server acepta la posición del cliente a ≤ 8 m); el combate ya no se corta con «Fuera de rango» si el bicho se aparta
     (se acerca y reintenta; engancha a 1,5 m); tocar troncos = encender fuego y tocar crudo = cocinar (antes se lo comía crudo);
     tocar un tocón no gasta petición; pestaña de combate en español; nombres de habilidades sin pisar; registro
     «¡Has acabado con Pollo!»; borrachos callados durante la guía.
   - (22 oct noche, tarea programada) Probado: minar → fundir → forjar, banco (guardar/sacar/notas), misión «El vino que no
     llegó» entera (Fefo → Adonay → 3 ratas → Fefo), duelo con 2 clientes (retar, aceptar, pelear, salir) y arco a nivel alto.
     Arreglado: golpe de más al agotarse la veta / caer el árbol (aviso repetido); horno/yunque mandaban una petición de más
     y las pestañas de material se cortaban en móvil; botón **«Guardar todo»** en el banco (1 petición, `body.all` en
     /api/bank/deposit); «Mochila10/20»; «le quitas 0 HP» → «no le haces daño»; el vecino ya no te vuelve a saludar tras
     una escena de misión; textos de «El Tigre de Paso Alto» (Minería 10 ahora es requisito); contragolpe de PvP pintado
     dos veces (`counter_at` en la respuesta); registro de combate tapado por el panel en móvil; «Cast iniciado» / «En
     cooldown»; «¡Has acabado con…!» antes que el golpe de la flecha.
     **Falta**: jefes y magia a nivel alto; mirar el ritmo del duelo en producción (en local los snapshots van cada ~7 s
     con 2 navegadores y la escena a ~4 fps, así que el "ritmo" no se puede juzgar aquí).
     Ideas vistas (sin hacer, son de diseño): las ratas gigantes (5 HP) cuestan ~45 s a puñetazos a un jugador de nivel 3.
   - (23 oct, tarea programada) Jefes y magia a nivel alto (Rey Yeti con espada, arco y bastón + fuego automático, móvil y PC):
     todo funciona (golpes, flechas del carcaj, maná, muerte y volver al spawn). Arreglado: sin flechas, devolver el golpe
     repetía «Atacas…» + «Necesitas flechas…» cada segundo; **tocar flechas con carcaj las mete en el carcaj** y si tenía
     otras se cambian (antes solo se seleccionaban y el aviso decía «sacá esas primero» con el id en crudo).
     **DECISIÓN PENDIENTE (Nico)**: ninguna arma tiene bonus de fuerza (`strength_bonus` = 0 en todas, también en
     producción), así que el golpe máximo cuerpo a cuerpo a nivel 99 es 11 (16 con mandoble) y con arco de dragón ~17.
     A nivel alto la espada pega la mitad que el arco. Propuesta: dar bonus de fuerza a las armas por tier (bronce +6 …
     teiderio +60, mandobles ×1,5, Tindaya/garras ~+70) con un seed. No se ha tocado porque cambia el equilibrio de todo
     el combate (PvP incluido).
9. [x] **Aventureros (bots que parecen jugadores)** (pedido 19 oct; hecho el 23 oct — `client/src/adventurers.js`, INVARIANTS §37): cuando hay alguien conectado, que se vean
       «jugadores» con nombre haciendo cosas (andar entre pueblos, talar, pescar, pelear con monstruos, hablar con
       NPC, chatear poco). Simulados en el CLIENTE (cero coste de servidor), deterministas por hora para que dos
       jugadores en el mismo sitio vean lo mismo, cerca del jugador, sin bloquear ni robar monstruos ni botín.

   - [x] (19 oct) La Laguna: **Taberna La Vieja Aguere** (Fefo vende comida, Don Pancho cuenta la historia de La Laguna,
     Chago el del timple) + misión «El vino que no llegó». Santa Cruz: **Herrería del Muelle** (Maestro Chano cuenta la
     historia de Santa Cruz y El Tigre, la aprendiza Iballa) + misión «El Tigre de Paso Alto» (Herrería 15).
     Sistema reutilizable: `shared/town_buildings.js` (ver INVARIANTS §36).
   - [x] (19 oct, tarde) La Orotava: **Casa de los Balcones** (Doña Mencía, bordadora: historia del valle de Taoro; su sobrino
     Bentor) + misión «El balcón de tea» (Tala 15, 5 troncos de roble). Icod: **Bodega El Drago** (Goyo, bodeguero: historia
     de Icod y Garachico; Nieves, vendimiadora) + misión «Sangre de drago» (combate 25, 4 tibicenas).
   - [x] (19 oct, noche) Güímar: **Molino de gofio La Majada** (Tía Benita, molinera: historia de Güímar, el malpaís y las
     pirámides; Mauro, cabrero) + misión «Gofio para la romería» (Pesca 5, pasa por Ayoze, 5 sardinas). Adeje: **Casa Fuerte**
     (Don Tomé, guarda: Tinerfe, el azúcar y los piratas; Iraya, cartógrafa) + misión «Cochinos en el barranco» (6 jabalíes, para empezar).
   - [x] (19 oct, noche) Los Cristianos: **Cofradía de Pescadores** (Patrón Isidro: historia del pueblo y el Carmen; Rosario, remendadora)
     + misión «Ratas en las redes» (5 ratas en Montaña Pelada). Vilaflor: **Casa del Pinero** (Don Eusebio: el pinar, la tea y el agua;
     Saray, pinochera) + misión «Leña para el invierno» (5 troncos a la abuela Petra).
   - Idea para más adelante (no urgente): segundo edificio en Santiago del Teide, La Esperanza, Arico y Chayofa.

### Notas del 19 oct (tarea programada)
- Punto 6 hecho. Siguiente: punto 8 (jugabilidad: partida de prueba completa) y luego el 9 (aventureros simulados en el cliente).
- Nombres repetidos que ya había: Gara (vigia_gara, gara_pieles) y Yeray (pastor y borracho). Al poner vecinos nuevos, mirar que el nombre no exista.
- Para buscar hueco: script de colocación (huecos a 22–70 m del centro, roadDist 10–18, lejos de NPC/bancos/urbanizaciones/zonas de caza)
  y la fachada mirando al punto de camino más cercano (dir = atan2(dx, dz)).
- Para colocar un edificio nuevo sin pisar caminos/NPC: buscar huecos a 9–20 m del camino (roadDist) y lejos de NPC, bancos,
  hornos, estanques y casas (así se eligieron Orotava e Icod). La BD local no trae `coins` ni `oak_logs` en `items`: insertarlos a mano para probar.
- Pruebas locales (22 oct): `scripts/local/items_base.sql` mete en la BD local los objetos y monstruos básicos que en
  producción se crearon a mano (hacha, monedas, troncos, pollo/vaca/goblin con botín). `window.__mainScene` para buscar
  árboles (`userData.trees`), rocas, etc. con Playwright. En Playwright usar `deviceScaleFactor: 1` (con 2 va a 1–4 fps).
  El registro de cuentas tiene tope por IP: en local, borrar `auth_limits` antes de crear cuentas de prueba.
- Pruebas locales: `scripts/local/server.mjs` (API + cliente con SQLite; three.js se clona de GitHub r160 porque
  no hay CDN ni npm en el entorno) y `scripts/local/armor_shots.mjs` (fotos de armaduras sin R2).
  Los modelos de R2 no cargan en local: el personaje sale como cápsula.
- Combate: el golpe se anima al enviarlo y el ritmo cuenta desde el envío; el servidor acepta 150 ms antes
  (`ATTACK_GRACE_MS`). Equipo/mochila: cola de peticiones + sincronización al vaciarse (`equipment.isBusy()`).

## Cómo se trabaja
- Push directo a `main` (Cloudflare despliega solo). D1 de producción: `bd9c29c7-493d-4ece-ac6e-6f97d49558b9`.
- Hay tope diario de D1 (`server/lib/budget.js`); no lo quites.
- **PLAN GRATIS de Cloudflare** (el usuario canceló el de pago el 17 oct; no quiere gastar nada). Límites:
  D1 5 M lecturas / 100 k escrituras al día (tope propio en wrangler.toml: 4,5 M / 90 k), Workers 100 k
  peticiones al día y 10 ms de CPU por petición, Durable Objects 100 k peticiones al día.
  Medido el 17 oct: ~80 peticiones/min por jugador (≈ 20 h de juego al día en total); CPU 1–3 ms (máx ~7 ms
  en snapshot completo, medido en local con SQLite incluido). NO añadas más sondeos ni peticiones por segundo:
  lo nuevo, por el WebSocket o en peticiones que ya existen.
- **Patrón anti-carreras nuevo:** `server/lib/atomic.js` (`guard`, `guardSlot`, `atomicBatch`, `changed()`).
  Toda escritura que dependa de algo leído antes (slot de mochila, equipo, pila) debe ir en un
  `env.DB.batch` con una guarda al principio. Si la guarda falla → 409 `changed`.
- Escribir **diferencias** (`xp = xp + ?`, `hp_current = hp_current + ?`), no valores leídos antes.
- Posición: nunca confiar en x,z del cliente si se aleja >15–20 m de `online_users` (ver `trustedAttackerPos`).
- Luces: no crear `PointLight` nuevas en tiempo de juego (recompila shaders = tirón). Usar `poolLight/releaseLight` de `client/src/spec_fx.js`.

## Hecho en la sesión 52 (16 oct)
- Banco estilo OSRS: nombres bajo cada objeto, buscador, scroll, mochila siempre visible, 1·5·10·X·Todo y 📜 en la esquina.
- Guía de inicio (`client/src/onboarding.js`): 13 pasos con foco y flecha; se repite desde ⚙ Ajustes.
- Bugs 2–15 de la lista anterior arreglados: búsqueda del Gran Bazar, chat que perdía mensajes, rastreador
  vs botón del chat, dobles toques (GE, equipar/quitar, tienda), hechizos en iOS, teletransporte a casa,
  luces de cuevas/casas desde el pool (`POOL_N = 8`, no subir), mochila tras entregar/recompensas, `100dvh`,
  multitáctil en mochila/banco, errores en crudo, geometría compartida, preload de Mixamo, cámara tras
  teletransportarse desde un edificio.

## Hecho después (16 oct, tarde)
- Montura: si el dragón no carga, se reintenta solo en segundo plano (arreglo para sebas6).
- Armaduras de arquero por animal (lobo 20, escorpión 35, yeti 50, escama 70) y túnicas de mago
  (algodón 1, lino 25, seda 45, Cabildo 60, Magister 70) con poder mágico (+golpe máx. y maná).
  Datos en `client/src/shared/gear_sets.js`; seed 023 (ya aplicado en producción).
- El bonus de distancia de la armadura ahora cuenta al disparar.

## Hecho el 17 oct (tarea programada de la 01:00)
- **Ambiente**: ciclo de día y noche igual para todos (40 min: 28 de día y 12 de noche; `client/src/shared/daytime.js`
  y `client/src/daynight.js`, sin luces nuevas), sonidos de ambiente sintetizados según bioma y hora
  (`client/src/ambience.js`: mar, viento, pájaros, gaviotas, grillos, búhos, ranas, goteo en cuevas),
  gaviotas/gorriones/murciélagos (`client/src/birds.js`), 13 borrachos con frases y voz propias.
  Ajustes ⚙: deslizadores de Música, Ambiente y Efectos. La música sigue baja por defecto porque el usuario
  pidió "90 % más baja"; ahora se sube con el deslizador y se recuerda.
- **Historia principal «El Sello de Achamán»** (6 capítulos, `SAGA` en `client/src/shared/quests.js`,
  escenas en `client/src/story.js`):
  1. *La tierra tiembla* (Eldric, combate 15) · 2. *Voces bajo el Cabildo* (Alma; la reja solo de noche) ·
  3. *Las tres llaves* (Candelaria, Guajara, Chinamada) · 4. *La traición* (Magister Perdomo) ·
  5. *La corona de Varkhul* (Tibiabin) · 6. *El despertar de Guayota* (combate 70 + plegaria 43).
  Decisiones guardadas en `user_quest_flags` (migración 023): `aviso` cabildo/alma, `chinamada` lucha/presente,
  `corona` envolver/escuchar, `final` sello/pacto (Capa del Sello de Achamán o Capa de Guayota).
  Motor nuevo: pasos `visit` (con `night`), `choice`, pasos condicionales `if: {flag: valor}`, capítulos
  encadenados con `next`. Rutas `/api/quests/visit` y `/api/quests/choose`.
- **Guayota en la Boca del Teide** (640, -1620) con 3 fases (`B.phases` en `client/src/shared/bosses.js`,
  `boss_state.phase`): al 66 % despierta 3 tibicenas dormidos; al 33 % eclipse (círculos de luz de Magec, fuera
  pega 34). Tibicenas en la grieta de Las Cañadas. Seed 024 aplicado en producción.
- Nombres viejos: Morgath → Chona. El id interno `fosa_ignaroth` se queda (su nombre visible ya es "Guayota";
  cambiar el id rompería registros guardados). La Fosa del este sigue teniendo su propio "eco" de Guayota.

## Hecho el 17 oct (tarea programada de las 05:00)
- **Tareas diarias** (`client/src/shared/dailies.js`, `server/lib/dailies.js`, `client/src/dailies.js`):
  3 al día iguales para todos (combate, recoger, oficio), cambian a medianoche de Canarias. Monedas + XP
  según nivel; las 3 → premio que crece con la racha (cada 7 días, pociones). Viven en `user_quests`
  ('daily_1..3' con step = día, 'daily_racha'): cero lecturas extra. Evento nuevo 'steal' (robo con éxito).
- **Logros, colección y contador** (migración 024: `user_kc`, `user_collection`, `user_achievements`):
  60 logros en 7 categorías (`client/src/shared/achievements.js`), pagan monedas una vez (todos: 445.500).
  Registro de colección = botín de jefes/minijuego + lo raro (≤ 1/20) de cualquier monstruo.
  `GET /api/progress` (8 s caché) y `GET /api/progress/records` (60 s). Libros desde la pestaña de misiones;
  el bestiario enseña "Has derrotado: N". El contador empieza en 0 para todos (no había datos antes).
- **Récords visibles**: páginas "La Fosa de Fuego" y "Cazadores de jefes" en el libro de Ranking; Kargath
  tiene "🏆 Récords de la Fosa"; el marcador de la Fosa enseña tu récord y el de la isla.
- **Evento «¡El Teide ruge!»** (`client/src/shared/world_events.js`, `server/world_event.js`, migración y
  seed 025): la Tibicena Mayor despierta 15 min cada 2 h (horas impares UTC) junto al Observatorio de Izaña;
  el cron la despierta/duerme; todos los que le pegan se llevan su premio. Recomendado combate 30+.
- **Chat al instante + chat de grupo**: mensajes por WebSocket (sondeo de respaldo cada 30 s en vez de 4 s);
  canal de grupo con 🌐/👥 o "/g mensaje" (Realm acepta `to: [uids]` en /event).
- **Grupo**: las muertes cuentan para los del grupo a ≤ 30 m (misiones y diarias).

## Pendiente — "el juego se siente vacío" (orden acordado)
1. ~~Ambiente~~ ✔ · 2. ~~Historia de Guayota~~ ✔ · 3. ~~Motivos para volver~~ ✔ · 4. ~~Jugar juntos~~ ✔
   (falta, si se quiere: XP compartida en grupo; botín repartido en grupo fuera del evento)
5. **Rellenar el mapa**: 30 de 64 celdas de 512 m sin contenido (sur/sureste, noroeste, este Güímar–Santa Cruz);
   pueblos fuera de La Laguna con 1–4 NPC.
6. Habilidades que se acaban pronto (Plegaria 43, Artesanía/Flechería 30): más contenido de nivel alto.
7. Probar en el juego: armaduras nuevas puestas en el personaje real (solo se vieron en el maniquí Xbot),
   la historia completa con un personaje real, la pelea de Guayota con 2–3 jugadores y el primer evento
   de la Tibicena Mayor en producción.

## Pruebas
Scripts locales con D1 simulada (node:sqlite): `d1shim.mjs` + `worker.fetch(new Request(...), env)`.
Toda carrera arreglada se probó lanzando dos peticiones a la vez (`Promise.all`).
