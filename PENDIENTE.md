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

## Pedido nuevo del usuario (3 oct, 13:43) — hacer junto al tutorial
- **Banco estilo OSRS** (`client/src/bank.js`, `server/handlers/bank.js` no hace falta tocar):
  - Cada objeto del banco muestra su **nombre debajo del icono** (texto pequeño en la parte inferior de la casilla).
  - Al abrir el banco se ve **la mochila a la vez** (al lado en PC, debajo en móvil) para saber qué llevas.
  - El banco se recorre **haciendo scroll** (lista/rejilla larga), sin páginas; con los nombres se encuentra todo rápido.
    Si cabe, un buscador por nombre arriba.
- **Mochila: NO cambiar** — sigue igual (tocar el objeto muestra nombre y opciones).
- Después: **arreglar todos los bugs de la lista de abajo**.

## Pendiente (prioridad de arriba abajo)
1. **Tutorial de inicio** (pedido por el usuario): guía paso a paso para cuentas nuevas con flechas a los
   botones del HUD (joystick, cámara, mochila, habilidades, misiones, mapa, banco, equipar, combate,
   especial), que se pueda saltar y repetir desde Ajustes. Engancharlo a la misión `tutorial`
   (`client/src/shared/quests.js`, `client/src/quests.js`). No mostrar a cuentas que ya la hicieron.
2. **Gran Bazar — búsqueda rota** (`client/src/ge.js` ~571-618): busca en `keydown` con el valor viejo y
   `render()` reconstruye el input. Buscar en el listener `input` y solo repintar `.ge-search-results`.
3. **Chat pierde mensajes** (`client/src/chat.js` ~200, ~273): al enviar mueve `lastServerNow`. No moverlo;
   pedir con solape (`since - 5000`) y deduplicar con `seenIds`.
4. **Rastreador de misiones tapa el botón del chat** (`quests.js` CSS `.quest-tracker` top 58px vs chat top 56px).
5. **Dobles toques**: GE place/claim (`ge.js` 669-687, 746-783), equipar (`inventory.js` 770-779,
   `equipment.js` 290-314), "Quitar" del equipo, tienda: el temporizador de pulsación larga sobrevive al
   re-render (`shop.js` 241-283 → `if (!cell.isConnected) return`).
6. **Spellbook iOS**: la pulsación larga lanza el hechizo (`spellbook.js` 270-298, 432-435): ignorar el click
   tras disparar el long-press.
7. **Teletransporte a casa**: el cliente manda `finish` varias veces (`home_teleport.js` 206-254): poner
   `castingUntil = 0` antes del fetch. OJO: el servidor ahora exige `/start` ≥10 s antes y fuera de combate.
8. **Cuevas y casas recompilan shaders** al entrar/salir (`caves.js` 213-216, `houses.js` 356): usar el pool
   de luces (subir `POOL_N` en `spec_fx.js` a 4 y que las cuevas tomen prestadas).
9. **Mochila no se refresca** tras entregar a NPC / recompensas (`town_npcs.js` 384, `quests.js`
   `applyServerRows`): llamar `window.inventory?.refresh?.()`.
10. **Overlays con `100vh`** cortan el botón ✕ en móvil (GE `style.css:1114`, ranking `:2550`, `bestiary.js:180`,
    `skill_guides.js`, `ui/book_modal.js:95`): usar `100dvh`.
11. **Multi-touch en mochila/banco** (`inventory.js` 297-332, `bank.js` 402-440): el `once` de pointerup lo
    consume otro dedo.
12. **Errores en crudo**: `equipment.js` 725-743 hace `alert('slot_empty')`; `party.js` lee `r.error` pero
    `apiFetch` lanza excepción (mirar `err.code` en el catch). Mostrar también `409 changed` con su mensaje.
13. **Geometría compartida liberada** al quitar NPCs/peers (`npc_renderer.js` 708-714, `multiplayer.js`
    1096-1102/1185-1191/1370-1376, `mounts.js` 390): marcar `userData.shared` y no hacer dispose.
14. `npc_renderer.js:398` llama a `mixamoRig.preload()` cada frame mientras carga (crea promesas sin parar).
15. Teletransportarse dentro de un edificio deja la cámara de interior (`interiors.js` 318-321 `forceLeave`).
16. Diseño pendiente con el usuario: cueros por animal + armaduras de arquero (bonus distancia y def. mágica),
    túnicas de mago con poder mágico; problema de sebas6 (padre) que ve una pardela en vez del dragón.

## Pruebas
Scripts locales con D1 simulada (node:sqlite): `d1shim.mjs` + `worker.fetch(new Request(...), env)`.
Toda carrera arreglada se probó lanzando dos peticiones a la vez (`Promise.all`).
