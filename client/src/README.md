# `client/src/` — Estructura

Refactorizada en S31 para que sea simple agregar features sin perder tiempo.

```
client/src/
  ├── core/         ← núcleo del runtime (extraído de world.js)
  │   ├── scene.js              setup three.js (scene, camera, renderer, lights, fog, ocean)
  │   ├── camera.js             cámara orbital (yaw/pitch/dist + drag + zoom)
  │   ├── combat_hooks.js       window.__playerEnterCombat/Exit/Death/Revive/PlayAttack
  │   ├── player_controller.js  ⚠ pendiente — joystick, tap, movement, Y offset
  │   └── ui_injection.js       ⚠ pendiente — CSS injection
  │
  ├── skills/       ← una skill por archivo, todas extienden Skill
  │   ├── _base.js              clase base con interface común (start/stop/update/cancelOnMove)
  │   ├── woodcutting.js        tala (logs, XP, hidden trees)
  │   ├── firemaking.js         encender fuego (kneel anim + sprite)
  │   ├── cooking.js            placeholder S32
  │   ├── mining.js             placeholder S33
  │   └── index.js              re-export central + startAll/stopAll/updateAll
  │
  ├── debug/        ← herramientas dev (instalado en S31, FASE 2)
  │   ├── index.js              initDebugSystem()
  │   ├── dev_overlay.js        badge + panel toggleable
  │   ├── health_check.js       __sebasHealth()
  │   ├── diag.js               __diag.*
  │   ├── error_capture.js      buffer de errores window.onerror
  │   ├── weapon_debug.js       placeholder — el real vive aún en character.js
  │   └── inspector.js          placeholder futuro
  │
  ├── build.js      ← única fuente de verdad de versión cliente
  │
  ├── world.js      ← orchestrator. Meta a 300-400 líneas (post-refactor completo)
  ├── character.js  ← Character class + animaciones + weapon/armor attach
  ├── main.js       ← entry point. Importa debug, llama startWorld de world.js
  │
  └── (resto de módulos: api, audio, bank, chat, combat, equipment, inventory,
        ge, ground_items, home_teleport, input, interiors, item_icons,
        multiplayer, npc_renderer, party, duel, shop, skills, terrain,
        damage_splat, combat_engine, world_snapshot, ui, auth, buildings)
```

## Convenciones

- **Módulos con estado interno**: exponen `init({...})` que recibe getters
  (no refs directas) y `start()`/`stop()`/`update(dt)`.
- **Módulos puros**: factory functions o solo exports — sin estado.
- **Getters vs refs directas**: SIEMPRE getters (ej. `() => player`) para
  evitar capturar valores stale en closures.
- **Hooks globales `window.__*`**: solo para debug y para callbacks de combat
  desde `combat.js`. Cualquier otra cosa va por imports.
- **NO backticks anidados en strings CSS**: usar `setProperty` o concat con `+`.
  Ver `debug/dev_overlay.js` `applyStyles()` como referencia.

## Cómo agregar una skill nueva

Ver `skills/README.md`.

## Cómo debuggear

Ver `debug/README.md`.

## Refactor pendiente (TODO post-S31)

- [ ] `core/player_controller.js` — joystick, tap, Y offset, gather Y, cancel hooks
- [ ] `core/ui_injection.js` — CSS injection del audio panel + inv grid + skills panel
- [ ] Mover `__weaponDebug` desde `character.js` → `debug/weapon_debug.js`
- [ ] Mover server handlers a `server/handlers/skills/`
