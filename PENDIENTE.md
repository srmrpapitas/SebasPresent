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
6. [ ] **Pueblos vacíos**: lore y cosas que hacer en cada pueblo; edificios en los que entrar con NPC dentro
       (tabernas, herreros, casas con historia, misiones cortas). Empezar por los pueblos principales.
7. [ ] Dejarlo todo impecable: probar en móvil y PC antes de cada push, un commit por arreglo.
8. [ ] **Jugabilidad (pedido 19 oct, 09:02 — lo primero ahora)**: partida de prueba completa en móvil y PC como
       jugador nuevo y como nivel alto; apuntar y arreglar todo lo que se sienta lento, confuso o roto
       (andar, tocar objetivos, combate, botín, mochila, banco, diálogos, cámara). Probar PvP/duelo con 2 clientes.
9. [ ] **Aventureros (bots que parecen jugadores)** (pedido 19 oct): cuando hay alguien conectado, que se vean
       «jugadores» con nombre haciendo cosas (andar entre pueblos, talar, pescar, pelear con monstruos, hablar con
       NPC, chatear poco). Simulados en el CLIENTE (cero coste de servidor), deterministas por hora para que dos
       jugadores en el mismo sitio vean lo mismo, cerca del jugador, sin bloquear ni robar monstruos ni botín.

   - [x] (19 oct) La Laguna: **Taberna La Vieja Aguere** (Fefo vende comida, Don Pancho cuenta la historia de La Laguna,
     Chago el del timple) + misión «El vino que no llegó». Santa Cruz: **Herrería del Muelle** (Maestro Chano cuenta la
     historia de Santa Cruz y El Tigre, la aprendiza Iballa) + misión «El Tigre de Paso Alto» (Herrería 15).
     Sistema reutilizable: `shared/town_buildings.js` (ver INVARIANTS §36).
   - [ ] Siguen: La Orotava, Icod, Güímar, Adeje/Los Cristianos, Vilaflor (1 edificio + lore + misión corta cada uno).

### Notas del 19 oct (tarea programada)
- Siguiente: punto 6 (pueblos). Hechos La Laguna y Santa Cruz; seguir con La Orotava e Icod (casa con historia / bodega).
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
