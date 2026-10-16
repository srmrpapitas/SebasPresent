# SebasPresent — PENDIENTE (3 oct 2026)

> Para la próxima IA que tome el repo. Lee también `INVARIANTS.md`.
> Hecho hoy: 4 commits de seguridad del servidor + 1 del cliente (ver `git log`).

## Cómo se trabaja
- Push directo a `main` (Cloudflare despliega solo). D1 de producción: `bd9c29c7-493d-4ece-ac6e-6f97d49558b9`.
- Hay tope diario de D1 (`server/lib/budget.js`); no lo quites.
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

## Pendiente — "el juego se siente vacío" (diagnóstico del 16 oct, acordado con el usuario)
Orden decidido:
1. **Ambiente** (rápido): música audible por defecto (hoy `music: 0.0007` en audio.js), ciclo día/noche,
   sonidos de ambiente (mar, viento, pájaros), gaviotas/pájaros volando, voces distintas para los borrachos.
2. **Historia principal de Guayota por capítulos** (la "carne"): escenas, decisiones, combate final contra
   Guayota. Hoy el arco del villano es una sola misión (`sombra_cabildo`) y Guayota solo sale en la Fosa.
   El canon está en `LORE.md` / `client/src/shared/lore.js`. Ojo: Morgath/Chona y `fosa_ignaroth` (nombres viejos).
3. **Motivos para volver**: tareas diarias, logros + registro de colección, contador de jefes, récord de la Fosa visible.
4. **Jugar juntos**: eventos del mundo ("¡el Teide ruge!": jefe para todos, botín repartido), chat de grupo,
   XP/botín compartido en grupo.
5. **Rellenar el mapa**: 30 de 64 celdas de 512 m sin contenido (sur/sureste, noroeste, este Güímar–Santa Cruz);
   pueblos fuera de La Laguna con 1–4 NPC.
6. Habilidades que se acaban pronto (Plegaria 43, Artesanía/Flechería 30): más contenido de nivel alto.
7. Probar en el juego: armaduras nuevas puestas en el personaje real (solo se vieron en el maniquí Xbot).

## Pruebas
Scripts locales con D1 simulada (node:sqlite): `d1shim.mjs` + `worker.fetch(new Request(...), env)`.
Toda carrera arreglada se probó lanzando dos peticiones a la vez (`Promise.all`).
