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

## Pendiente
1. Diseño pendiente con el usuario: cueros por animal + armaduras de arquero (bonus distancia y def. mágica),
   túnicas de mago con poder mágico; problema de sebas6 (padre) que ve una pardela en vez del dragón.
2. Probar en móvil real: arrastrar en el banco (mantener ~0,2 s), guía de inicio en iPhone.

## Pruebas
Scripts locales con D1 simulada (node:sqlite): `d1shim.mjs` + `worker.fetch(new Request(...), env)`.
Toda carrera arreglada se probó lanzando dos peticiones a la vez (`Promise.all`).
