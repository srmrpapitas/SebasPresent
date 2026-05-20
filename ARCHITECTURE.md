# SebasPresent — ARCHITECTURE

> **Cómo está organizado el proyecto.** Para entender qué hace cada módulo
> y cómo se conectan, sin tener que leer 50 archivos.

> **Pareja:** `INVARIANTS.md` (reglas que no se rompen) + este archivo (mapa).
> Lee primero INVARIANTS, después esto.

---

## 1. Stack en una línea

**Cliente** = ES modules nativos (sin bundler) servidos por **Cloudflare Pages** (`sebaspresent.pages.dev`).
**Server** = Cloudflare **Workers** (`sebaspresent.srmrpapitas.workers.dev`) con **D1** (SQLite) + **R2** (assets).
**Renderer** = three.js via importmap.
**Auth** = JWT propio en `localStorage`.
**Deploy** = `git push` → autodeploy a ambos.

---

## 2. Flujo de un frame (cliente)

```
        ┌─────────────────────────────────┐
        │  main.js  → boot()              │
        │  → initDebugSystem()            │  ← S31: badge + __sebasHealth + __diag
        │  → ui.initSidebar()             │
        │  → auth.tryResumeSession()      │
        │  → world.startWorld()           │
        └────────────┬────────────────────┘
                     ▼
        ┌─────────────────────────────────┐
        │  world.startWorld(user, token)  │  ← orchestrator, ~2700 líneas (post-S31)
        │  • sceneSetup.init()            │  ← core/scene.js (S31 extraído)
        │  • cameraOrbital.init()         │  ← core/camera.js (S31 extraído)
        │  • terrain.start()              │
        │  • setupPlayer() → character    │
        │  • equipment.init()             │
        │  • combatHooks.register()       │  ← core/combat_hooks.js (S31 extraído)
        │  • skills.start() (woodcut+fm)  │  ← skills/index.js (S31)
        │  • multiplayer.start()          │
        │  • worldSnapshot.start()        │
        │  • npcRenderer.start()          │
        │  • setupInput() → input.js      │
        │  • requestAnimationFrame(loop)  │
        └────────────┬────────────────────┘
                     ▼
        ┌─────────────────────────────────┐
        │  animate() — cada frame         │
        │  • updatePlayer(dt)             │  ← joystick + tap-to-walk + Y offset
        │  • terrain.update(dt)           │
        │  • cameraOrbital.update()       │
        │  • character.update(dt)         │  ← mixer.update, anim selection
        │  • npcRenderer.update(dt)       │
        │  • multiplayer.update(dt)       │
        │  • worldSnapshot.update(dt)     │  ← polling 250ms al server
        │  • woodcutting.update(dt)       │  ← loop de chop + sync depleted
        │  • firemaking.update(dt)        │  ← sync fires + flicker anim
        │  • groundItems.update(dt)       │
        │  • drawMinimap()                │
        │  • updatePositionSave(dt)       │  ← save al server cada 10s (500ms en combat)
        │  • renderer.render(scene, cam)  │
        └─────────────────────────────────┘
```

**Hooks paralelos durante el frame** (no se llaman desde animate, viven aparte):
- `worldSnapshot` poll cada 250ms → manda heartbeat + recibe `{ players, npcs, fires, depleted_trees, me }`.
- `combat.js` cuando vos atacás → dispara `window.__playerPlayAttack`/`EnterCombat`/`ExitCombat`/`Death`/`Revive` → `core/combat_hooks.js` los recibe.
- `debug/dev_overlay.js` corre `setInterval(500ms)` actualizando el badge + panel.

---

## 3. Cliente — mapa por módulo

### 3.1 `client/src/main.js` — Entry point
- 70 líneas. Importa todo, llama `boot()`.
- **Primera línea de boot**: `initDebugSystem()` (antes de cualquier cosa, para captura de errores tempranos).
- Después: `ui.initSidebar()` → `auth.tryResumeSession()`. Si hay session válida → llama eventualmente a `world.startWorld()`.

### 3.2 `client/src/world.js` — Orchestrator
- ~2700 líneas (post-S31). Está siendo refactorizado para llegar a ~400.
- **Qué hace**: arranca scene/camera/character/skills/multiplayer/etc en orden, y corre el animate loop.
- **Qué NO hace ya (extraído en S31)**:
  - Setup de three.js → `core/scene.js`
  - Cámara orbital → `core/camera.js`
  - Combat hooks → `core/combat_hooks.js`
- **Qué falta extraer (TODO post-S31)**:
  - Joystick + tap-to-walk + Y offset + gather Y → `core/player_controller.js`
  - CSS injection (audio panel + inv grid + skills panel) → `core/ui_injection.js`

### 3.3 `client/src/core/` — Núcleo del runtime (S31)

| Archivo | Qué hace | Líneas | API |
|---|---|---|---|
| `scene.js` | Setup three.js + lights + fog + ocean | 110 | `init({canvasId, palette, fogNear, fogFar})` + `setupOcean({scene, palette, worldHalf})` + `onResize({camera, renderer})` |
| `camera.js` | Cámara orbital + drag + zoom + interior overrides | 170 | `init({threeCamera, getPlayer, isCharacterFallback, distMin, distMax})` + `onDrag(dyaw, dpitch)` + `onZoom(delta)` + `update()` + `pushInteriorOverrides({dist, pitch})` + `popInteriorOverrides()` + `getYaw()/getPitch()/getDist()` |
| `combat_hooks.js` | Window hooks del player anim (combat.js → character.js) | 180 | `register({getCharacter, getWeaponType, onRespawn})` + `getCombatTargetNpcId()` |
| `player_controller.js` | ⏳ TODO | — | — |
| `ui_injection.js` | ⏳ TODO | — | — |

### 3.4 `client/src/skills/` — Skills aisladas (S31)

| Archivo | Qué hace | Server endpoint |
|---|---|---|
| `_base.js` | Clase base `Skill` (opcional para skills nuevas) | — |
| `index.js` | Orchestrator `startAll/stopAll/updateAll/cancelAllOnMove` | — |
| `woodcutting.js` | Loop de tala + sync depleted + créa tocón cliente | `POST /api/woodcutting/chop` |
| `firemaking.js` | Encender fuego + sync fires + sprite + flicker | `POST /api/firemaking/light` |
| `cooking.js` | Placeholder S32 | TODO `/api/cooking/cook` |
| `mining.js` | Placeholder S33 | TODO `/api/mining/mine` |

**Patrón estándar de una skill:**

```js
export function start(opts) { /* opts: getPlayer, getCharacter, getAuthToken, getSnapshot, feedLog, scene */ }
export function stop() { /* cleanup */ }
export function update(dt) { /* cada frame */ }
export function cancelOnMove() { /* opcional, llamado cuando player mueve joystick */ }
```

Ver `skills/README.md` para agregar una skill nueva (paso a paso).

### 3.5 `client/src/debug/` — Debug system (S31)

| Archivo | Qué hace |
|---|---|
| `index.js` | `initDebugSystem()` → llama a todos los install |
| `dev_overlay.js` | Badge `b31.0-dev · NN fps` + panel toggleable con secciones runtime/char/network/equipment/skills/errors |
| `health_check.js` | `__sebasHealth()` chequea ~25 cosas y devuelve tabla |
| `diag.js` | `__diag.dumpCharacterState/printBones/printTracks/printEquipment/printSnapshot/forceCallApi/forceChop/testError/enableVerboseLogs` |
| `error_capture.js` | Captura `window.onerror` + `unhandledrejection` → buffer 50 errores |
| `weapon_debug.js` | Placeholder (el panel real vive aún en `character.js` `window.__weaponDebug`) |
| `inspector.js` | Placeholder futuro |

**Diseño**: 100% observer. Lee de `window.character/equipment/skills/__snapshotDebug/__wcDebug/__fmDebug`. No recibe callbacks de `world.js`. Por eso se puede inicializar antes que cualquier cosa y no rompe nada.

### 3.6 Resto de módulos del cliente

| Módulo | Responsabilidad principal |
|---|---|
| `api.js` | Fetch helpers a la API (con auth automático). Cada endpoint = una función. |
| `auth.js` | Login / register / resumeSession / handleLogout. JWT en localStorage. |
| `audio.js` | Música por biome + SFX (precarga 21 SFX). |
| `bank.js` | UI banco (depositar / retirar items). |
| `buildings.js` | GLB instances decorativas + tap → enter interior. |
| `chat.js` | Chat global + party + overhead bubbles. |
| `character.js` | Class `Character`. Loads FBX, mixer, attach weapon/armor, play() anims. |
| `combat.js` | Loop client de combate (tick 600ms), llama hooks. |
| `damage_splat.js` | Hitsplats OSRS (números rojos/azules sobre NPCs). |
| `duel.js` | Sistema de duelo PvP. |
| `equipment.js` | 9 slots de equipo (helm/cape/amulet/weapon/body/shield/legs/ring/boots). |
| `ge.js` | Grand Exchange overlay. |
| `ground_items.js` | Loot drops visibles en el piso. |
| `home_teleport.js` | Teleport a casa (cooldown). |
| `input.js` | Detección de gestos (tap/drag/long-press/joystick/pinch). |
| `interiors.js` | Salas interiores de edificios. |
| `inventory.js` | 28 slots inventario. |
| `item_icons.js` | SVGs custom por item_id. |
| `multiplayer.js` | Peers visibles + PvP engage. |
| `npc_renderer.js` | NPCs visibles + tap menu + auto-engage. |
| `party.js` | Sistema de party (grupo de PJs). |
| `shop.js` | Tienda general (NPC banker). |
| `skills.js` | UI panel de skills (los 13 skills con niveles). |
| `terrain.js` | Chunks procedurales + biomes + árboles. |
| `ui.js` | Pantallas (splash/auth/world) + sidebar. |
| `world_snapshot.js` | Polling 250ms al server. |

---

## 4. Server — mapa por módulo

```
server/
├── worker.js            # router principal: matches URL + method, llama handler
├── combat_engine.js     # tick de combate (autoritativo)
├── ge_engine.js         # Grand Exchange engine
├── schema.sql           # schema D1 inicial
├── handlers/
│   ├── auth.js          # login, register, refresh
│   ├── bank.js          # deposit/withdraw
│   ├── chat.js          # mensajes globales y party
│   ├── combat.js        # engage/disengage/attack/revive
│   ├── cron.js          # respawn NPCs + cleanup loot/fires/trees
│   ├── duel.js          # PvP duel system
│   ├── equipment.js     # equip/unequip
│   ├── firemaking.js    # light fire
│   ├── ge.js            # GE buy/sell
│   ├── ground_items.js  # pickup
│   ├── home_teleport.js
│   ├── inventory.js     # mover items
│   ├── party.js
│   ├── position.js      # heartbeat de posición
│   ├── shop.js          # buy/sell con NPC tienda
│   ├── skills.js        # XP + level lookup
│   ├── snapshot.js      # GET /api/snapshot { players, npcs, fires, depleted_trees }
│   ├── woodcutting.js   # chop con multi-log mechanic (S31)
│   └── world.js         # online_users
└── lib/
    ├── auth.js          # requireSession, hashPassword
    ├── db.js            # json(), readJson() helpers
    └── skills_engine.js # xpToLevel, applyXpGrant, startingXpFor
```

### 4.1 Router (worker.js)
- Cada request entra acá. Match `url.pathname` + `req.method`.
- Si match → llama el handler correspondiente.
- CORS handling: ALLOWED_ORIGINS desde wrangler.toml.

### 4.2 Anti-cheat (server-side validations)
Cada handler valida:
- ✅ `requireSession(req, env)` → JWT válido → `session.user_id`.
- ✅ Position check (online_users.x/z) → proximidad al target (árbol, NPC, item).
- ✅ Level check (user_skills.xp) → al nivel mínimo.
- ✅ Inventory space → hay slot libre o stack disponible.
- ✅ Rolls (woodcutting/firemaking) → `Math.random()` server-side, cliente no ve probabilidades.

### 4.3 Cron
Corre cada 1min (configurado en `wrangler.toml`):
- Respawn NPCs muertos (status=0 con `respawn_at < now()`)
- Clean loot drops expirados
- Clean tree_state.depleted_until expirados
- Clean fires.expires_at expirados

---

## 5. Cómo agregar algo nuevo (recetas)

### 5.1 Una skill nueva (ej: Cooking)

1. **Server**: crear `server/handlers/cooking.js`:
   ```js
   import { json, readJson } from '../lib/db.js';
   import { requireSession } from '../lib/auth.js';
   import { applyXpGrant, xpToLevel, startingXpFor } from '../lib/skills_engine.js';

   export async function handleCookingCook(request, env) {
     const session = await requireSession(request, env);
     // ... validar nivel, fire cerca, raw item en inv, espacio cooked item ...
     // ... applyXpGrant, update inv, return json({ ok, ... })
   }
   ```

2. **Server router**: en `worker.js`:
   ```js
   if (url.pathname === '/api/cooking/cook' && req.method === 'POST')
     return handleCookingCook(req, env);
   ```

3. **Cliente**: copiar `skills/woodcutting.js` o `skills/firemaking.js` como template. Cambiar el endpoint, el item, la anim.

4. **Cliente router**: en `skills/index.js`:
   ```js
   import * as cooking from './cooking.js';
   const SKILL_MODULES = [
     { name: 'woodcutting', mod: woodcutting },
     { name: 'firemaking',  mod: firemaking  },
     { name: 'cooking',     mod: cooking     },  // ← nuevo
   ];
   ```

5. **Migrations SQL** en D1 si hace falta (rara vez — `user_skills` ya soporta cualquier skill_id).

6. **Probar**: `__sebasHealth()` debe mostrar el módulo OK. Encender un fuego, intentar `__diag.forceCallApi('/api/cooking/cook', { ... })`.

7. **Documentar**: agregar la skill en `INVARIANTS.md` sección 3 con sus invariantes propias.

### 5.2 Un item nuevo

1. SQL: `INSERT INTO items (id, name, equip_slot, weapon_type, attack_bonus, ...) VALUES (...);`
2. Si tiene icono custom: agregar SVG en `item_icons.js`.
3. Si es arma: agregar a `WEAPON_TRANSFORMS` en `character.js` con scale/pos/rot calibrados (usar `__weaponDebug()` para calibrar live).
4. Si es GLB 3D: subir a R2 `weapons/X.glb` o `armor/X.glb`.

### 5.3 Un NPC nuevo

1. SQL: `INSERT INTO npc_defs (...)` con stats, drops, spawn pattern.
2. Si tiene GLB custom: subir a R2, agregar en `npc_renderer.js` el mapping.

### 5.4 Un hook nuevo

**Pensá DOS veces antes de agregar un hook global `window.__*`.** Lo correcto es:
1. ¿Puedo resolverlo con un import? → SÍ → usar import.
2. ¿Es un hook de combat/anim que `combat.js` necesita disparar al character? → único caso válido para hook global.
3. ¿Es de debug? → va a `debug/diag.js` o similar.
4. Si igual lo agregás → documentalo en `INVARIANTS.md` sección 4.

---

## 6. Flujo de datos típico — un click en un árbol

```
1. User TAP en árbol
2. input.js detecta tap (TAP_DRAG_THRESHOLD = 8px)
3. input.js dispara onTap callback registrado por world.js
4. world.js doCanvasTap(clientX, clientY):
   • raycaster detecta árbol bajo el cursor
   • llama woodcutting.startChopAt(tree_type, x, z)
5. woodcutting.startChopAt:
   • setPlayerTarget(x, z) → marker + walk
   • setea activeChop = { tree_type, tx, tz, fails: 0 }
6. cada frame (animate → woodcutting.update):
   • si dist al árbol < 3m → tickear el loop
   • cada 1.2s → llamar attemptChop()
7. attemptChop → fetch POST /api/woodcutting/chop
8. SERVER (woodcutting.js):
   • requireSession → user_id
   • validar proximidad (online_users.x/z vs target)
   • validar axe + level
   • validar tree no depleted (tree_state)
   • ROLL chop_success → si falla, return { ok, log_gained: false }
   • si éxito: validar espacio inv
   • ROLL tree_falls → si cae, INSERT tree_state.depleted_until
   • update user_skills.xp, user_inventory
   • return { ok, log_gained: true, tree_falls, log_item, xp_gained, ... }
9. CLIENT (woodcutting.js attemptChop):
   • si log_gained=false → seguir el loop (sin mensaje, sin XP)
   • si log_gained=true:
     • skills.reload() → refresca panel XP
     • inventory.refresh() → muestra el log nuevo
     • feedLog('+25 XP Tala (Tronco)')
     • si tree_falls=true → feedLog('El árbol cae.') + stopChop('depleted')
10. Paralelamente:
    • worldSnapshot poll cada 250ms → recibe snapshot.depleted_trees actualizado
    • woodcutting.update detecta el cambio → createStumpAtScene(x, z, meshes)
    • createStumpAtScene oculta el árbol original + agrega un cilindro (TOCÓN)
      ⚠ BUG ABIERTO: el cilindro no se ve. Ver INVARIANTS sección 9.1.
```

---

## 7. Cómo debuggear cualquier cosa

1. Tap en el badge `b31.0-dev · NN fps` arriba-izq → abre panel debug.
2. Mirá la sección que corresponda (character/network/equipment/skills/errors).
3. Si hace falta más detalle, abrí Eruda y corré:
   - `__sebasHealth()` — overall del sistema
   - `__diag.dumpCharacterState()` — todo del char
   - `__diag.printSnapshot()` — último snapshot del server
   - `__diag.printEquipment()` — qué tenés equipado
   - `__diag.printTracks('NombreClip')` — si el bug es de anim
   - `__diag.forceCallApi('/api/X', body)` — testar un endpoint sin UI
4. Si es bug de movimiento → `__diag.dumpCharacterState().pos.y` te dice 80% de los casos.
5. Si es bug de anim → `__diag.dumpCharacterState().timeScale` y `.activeAnim` te dicen el otro 80%.

---

## 8. Próximos refactors planeados

| Sesión | Plan |
|---|---|
| S32 | Cooking skill — sigue el patrón de `skills/firemaking.js`. ~1.5h con esta arquitectura. |
| S33 | Mining skill — sigue el patrón de `skills/woodcutting.js` (mismo loop chop/depleted). |
| S34 | Bug del tocón (sección 9.1 INVARIANTS) + `core/player_controller.js`. |
| S35 | `core/ui_injection.js` (saca 300 líneas de CSS de world.js). |
| S36+ | Smithing, Crafting, Fishing, Fletching — todas siguen el patrón de skills/. |

---

*Última actualización: 2026-05-20 (Sesión 31).*
