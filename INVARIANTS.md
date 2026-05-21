# SebasPresent — INVARIANTS

> **Lee esto ANTES de tocar código.**
> Cada línea aquí es una asunción que el código depende de ella.
> Romperla causará bugs sutiles en runtime que el linter NO detectará.

> **Para Claude / cualquier IA que tome el proyecto:** este es el PRIMER archivo
> que tenés que leer al recibir el repo. Más útil que el código.

> **Última actualización:** S31 — refactor + multi-log + kneel fix.

---

## 0. Estructura del proyecto (post-S31)

```
client/src/
  ├── build.js                 Constante BUILD (única fuente de verdad)
  ├── main.js                  Entry point. Importa debug system + ui + auth.
  ├── world.js                 Orchestrator del mundo (2783 líneas, target: 400).
  ├── character.js             Character class — anims, weapons, armor, gather.
  ├── core/                    Núcleo extraído de world.js (S31)
  │   ├── scene.js               Setup three.js.
  │   ├── camera.js              Cámara orbital + drag + zoom + interior overrides.
  │   └── combat_hooks.js        window.__playerEnter/Exit/Death/Revive/PlayAttack.
  ├── skills/                  Skills aisladas (S31)
  │   ├── _base.js               Clase base (opcional).
  │   ├── index.js               startAll/stopAll/updateAll.
  │   ├── woodcutting.js         Tala con sistema multi-log + cae.
  │   ├── firemaking.js          Encender fuegos con kneel anim.
  │   ├── cooking.js             Placeholder (S32).
  │   └── mining.js              Placeholder (S33).
  └── debug/                   Sistema de debug (S31)
      ├── index.js, dev_overlay.js, health_check.js, diag.js,
      └── error_capture.js, weapon_debug.js, inspector.js

server/handlers/
  ├── woodcutting.js           Tala — multi-log mechanic (S31).
  ├── firemaking.js            Encender fuegos.
  ├── snapshot.js              Polled cada 250ms por cliente.
  └── ...
```

## 0.1 Regla de oro al editar

1. **Antes de tocar un módulo en `core/` o `skills/`**: leer el README de la carpeta.
2. **Antes de cambiar una invariante listada acá**: actualizar el doc en el mismo commit.
3. **Antes de un slice nuevo grande**: agregar las nuevas asunciones al final.

---

## 1. Timing y constantes acopladas

### 1.1 Tick de combate = 600ms
- `combat_engine.js` server: cooldown entre attacks = 600ms.
- `combat.js` cliente: `TICK_MS = 600`.
- `character.js`: `ATTACK_TICK_MS = 600` — escala los Sword_Attack para que duren ese tiempo.
- **Si cambias uno, cambia los tres.**

### 1.2 Threshold de tap táctil (INTOCABLES)
- `input.js`: `TAP_DRAG_THRESHOLD = 8px`, `LONG_PRESS_MS = 320ms`.
- **NO los toques sin verificar primero con `console.log` que `doCanvasTap` se llama o no.**
- Lección del chat 2026-05-13: subirlos rompió el tap-to-walk completamente.

### 1.3 Rango de combate
- Server: `COMBAT_RANGE_TOLERANCE = 3.5m` en `worker.js`. Compensa los 3m del patrol radius visual de los NPCs.
- Cliente: el NPC mesh visual está en `mesh.position`, el "centro de patrol" del server está en `npc.x/z`. Usar `mesh.position` para validaciones de rango cliente.

### 1.4 Loot drops (en ms)
- `LOOT_PRIVATE_MS = 60_000` (1min privado al killer)
- `LOOT_TOTAL_LIFETIME_MS = 120_000` (2min total)
- `LOOT_PICKUP_RADIUS_M = 5m` server, `GROUND_ITEM_PICKUP_RADIUS_M = 2.5m` cliente (cliente más estricto a propósito)

### 1.5 Snapshot polling (S27)
- `world_snapshot.js`: `POLL_INTERVAL_MS = 250` — cliente pide al server cada 250ms.
- `snapshot._serverLagMs` aceptable < 500ms. Más alto = warning en debug panel.
- Si el snapshot está stale > 3s, el debug overlay lo marca en rojo.

### 1.6 Position save al server
- `world.js`: `POSITION_SAVE_INTERVAL = 10000ms` (10s default).
- **EN COMBATE bajamos a 500ms** para que el server pueda validar rangos correctamente.
- Sin esto: bug "pegar desde lejos" — el server creía que estabas cerca cuando ya te habías alejado.
- `POSITION_SAVE_MIN_DELTA = 5m` default, **0.5m en combate**.

### 1.7 Chop tick (S30)
- `woodcutting.js` cliente: `CHOP_TICK_S = 1.2s` — manda /chop cada 1.2 segundos.
- Si lo bajás, el server lo va a rechazar (rate limit implícito por validaciones).

---

## 2. Animaciones Mixamo (character.js)

### 2.1 Subida a R2
- Las FBX van a `r2/animations/` con los nombres EXACTOS del map `ANIM_FILES` en `character.js`.
- Case-sensitive. `Sword_Attack_1.fbx` ≠ `sword_attack_1.fbx`.

### 2.2 Esquema de bones (descubierto 2026-05-15)
- Three.js FBXLoader limpia los `:` de los nombres → `mixamorigHips` no `mixamorig:Hips`.
- Pero el `character.fbx` puede tener cualquier esquema según cómo se exportó.
- Por eso existe `adaptTrackNamesToSkeleton()` en `character.js`. **No quitar.**

### 2.3 Root motion (descubierto 2026-05-15)
- Solo estas anims son "in place" sin root motion: `Idle.fbx`, `Walking.fbx`, `Running.fbx`, `Sword_Idle.fbx`.
- **TODAS las demás (todas las direccionales, todos los Sword_Attack 1-3, todos los strafes, todas las deaths, Sword_Draw, Sword_Sheath) tienen drift de 2-7m por reproducción.**
- Por eso existe `stripHipsPositionTrack()` y la constante `CLIPS_TO_STRIP_ROOT`. **No quitar.**
- Si añades una anim nueva, **mide su root motion** con un script tipo `test_rootmotion.mjs` antes de añadirla.

### 2.4 Orden de Three.js para crossFade
- **OBLIGATORIO**: `next.reset()` → `next.play()` → `next.crossFadeFrom(current, fade)`.
- Llamar `crossFadeFrom` antes de `play()` causa T-pose visible durante la transición.

### 2.5 Deaths con `clampWhenFinished = true`
- Si pones una death con clamp y luego haces `revive()`, hay que:
  1. Desactivar el clamp (`death.clampWhenFinished = false`)
  2. `death.stop()` + `death.reset()` explícitos
  3. `mixer.setTime(0)` para forzar re-evaluación
- Solo `stopAllAction()` NO basta — el último valor escrito al bone permanece.

### 2.6 Validador FBX (S31)
- Al cargar cualquier clip, `adaptTrackNamesToSkeleton()` calcula `% match` y warnea si `<60%`.
- Si ves `[character/fbx-validator] ⚠️ LOW MATCH NN% — clip "X"` en consola: la anim va a verse rota (T-pose parcial, huesos sin animar).
- El clip queda marcado con `clip.userData.fbxUnstable = true`.
- **Antes de aceptar una anim nueva**: confirmá en consola que el match es >80%.

---

## 3. Sistema de Gather / Skills (S30 + S31)

### 3.1 Y offset del player
- **Base**: `player.position.y = -1.03` (NO -1.10 — recalibración S30).
- **Override DEV**: `window.__sebasOffsetY = N` (testing en runtime).
- **Override por anim de gather**: `window.__gatherY = { kneel: -0.6 }`.
- **Lerp suave**: cuando termina gather, lerp con `k = min(1, dt * 15)` y threshold `0.005`.
  - **NO bajar k debajo de 10** o vuelve el flash TP.
  - **NO subir threshold encima de 0.01** o se nota el snap final.
- Toda esta lógica vive en `world.js` updatePlayer (post-refactor: `core/player_controller.js`).

### 3.2 `playGather(animKey, durationMs)` — patrón estándar
- `animKey` debe existir en `ANIM_FILES` (ej: 'woodcut', 'kneel').
- `durationMs = 0` → usa duración natural del clip (recomendado para `woodcut`).
- `durationMs > 0` → escala el clip a esa duración con `setEffectiveTimeScale()`.
- **AL TERMINAR**, el `playGather` hace:
  1. `_gatheringActive = false`
  2. `action.setEffectiveTimeScale(1)` — **CRÍTICO**, sin esto idle hereda timeScale corrupto
  3. `mixer.stopAllAction()` + `mixer.setTime(0)` — limpia pose residual del kneel
  4. `play('idle')` — vuelve a estado normal

### 3.3 Cancel hooks de gather
- **Joystick activo durante woodcut/firemaking → cancela la actividad.**
- Bypass: `Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15` (deadzone tolerada).
- El skill llama `stopChop('user_move')` o equivalente y la anim termina con `play('idle')`.

### 3.4 Durations de gather actuales
- `woodcut`: usa duración natural (`playGather('punching', 0)`).
- `kneel` (firemaking): `KNEEL_DURATION_MS = 1800ms` (S31 fix — antes usaba natural y duraba demasiado).
- **Si subís una anim de gather nueva**, recordar:
  - Medir su duración natural en Blender.
  - Decidir si querés natural o forzar duración.
  - Si forzás, NO bajar de ~1500ms (queda atragantada).
  - Si la pose final difiere mucho de idle, **CRÍTICO**: chequear pose residual al volver.

---

## 4. Sistema de Skills (S30 + S31)

### 4.1 Patrón de archivo
- Una skill por archivo en `client/src/skills/`.
- Exporta `start(opts) / stop() / update(dt)` (cancelOnMove opcional).
- Estado interno en `let` privados al inicio del archivo.
- Hook debug `window.__SKILL_NAME_Debug` para inspección.

### 4.2 Orquestador (`skills/index.js`)
- Para agregar una skill: importar + añadir a `SKILL_MODULES`. Listo.
- `startAll(opts)` llama a `start()` de cada una.
- `stopAll()` y `updateAll(dt)` análogos.

### 4.3 Woodcutting — multi-log mechanic (S31)
- **Cada /chop hace 2 rolls independientes** server-side:
  1. `chop_success` — probabilidad de cortar (depende de nivel del player).
  2. `tree_falls` — probabilidad de que el árbol caiga tras el log.
- Respuesta server: `{ ok, log_gained, tree_falls, log_item?, xp_gained?, ... }`.
- Si `log_gained = false`: no log, no XP, cliente sigue talando.
- Si `tree_falls = true`: árbol depleted, cliente para el loop.
- **Tabla de árboles**: ver `server/handlers/woodcutting.js` constante `TREE_DEFS`.
- Respawn variable según especie: normal 30s, oak 1min, willow 3min, yew 15min, magic 30min.

### 4.4 Firemaking
- Endpoint `POST /api/firemaking/light { slotIdx }`.
- Consume 1 log del inv + 1 carga de tinderbox (no se gasta, tinderbox es permanente).
- Crea entrada en tabla `fires (id, x, z, log_type, user_id, lit_at, expires_at)`.
- Sync visual: snapshot.fires → sprite animado + base de carbón.
- Anim del char: `kneel` con `KNEEL_DURATION_MS = 1800`.

---

## 5. Hooks globales `window.__*`

> **Cualquier hook nuevo se documenta aquí. Si no está aquí, no existe.**

### 5.1 Combat hooks (registrados en `core/combat_hooks.js`)

| Hook | Dispara | Quién lo llama |
|---|---|---|
| `__playerPlayAttack(stance, weaponType, cooldownMs)` | Anima swing del player | `combat.js` cada tick |
| `__playerEnterCombat(npcId)` | Set target + draw espada si melee | `combat.js` engageNpc |
| `__playerExitCombat()` | Clear target + sheath | `combat.js` disengage |
| `__playerDeath()` | Anima muerte | `combat.js` you_died |
| `__playerRevive()` | Limpia muerte, vuelve a idle, teleport (0,0) | `combat.js` respawn |

### 5.2 World hooks

| Hook | Dispara | Quién lo llama |
|---|---|---|
| `__worldFlashNpcHit(npcId)` | Flash visual + jerk del NPC | `combat.js` cuando hit |
| `__worldSpawnHitsplat(npcId, dmg)` | Hitsplat OSRS sobre NPC | `combat.js` cada tick |
| `__setPlayerTarget(x, z)` | Tap-to-move programático | `multiplayer.js` tap-on-peer |
| `__spawnLevelUpBanner(skillId, newLevel)` | Banner de subida de nivel | `skills/*.js` |

### 5.3 Debug hooks (de `debug/*.js`)

| Hook | Devuelve | Para qué |
|---|---|---|
| `__sebasHealth({silent?})` | `{ build, overall, results, elapsedMs }` | Health check completo |
| `__diag.dumpCharacterState()` | `{ pos, activeAnim, weapon, flags, ... }` | Inspección del char |
| `__diag.printBones()` | tabla bones | Debug de skeleton |
| `__diag.printTracks(clip)` | tabla tracks + % match | Debug de anim |
| `__diag.printEquipment()` | tabla slots | Estado equipment |
| `__diag.printSnapshot()` | último snapshot | Estado del snapshot |
| `__diag.forceCallApi(path, body?)` | promise | Test endpoint |
| `__diag.forceChop(treeType, x, z)` | delega a __wcDebug | Forzar tala |
| `__diag.testError()` | — | Probar error capture |

### 5.4 Skill-specific debug

| Hook | Para qué |
|---|---|
| `__wcDebug()` | Estado del loop de tala actual |
| `__wcDebug.forceChop(typeId, x, z)` | Forzar /chop a un árbol |
| `__wcDebug.stop()` | Parar loop activo |
| `__fmDebug()` | Estado de firemaking (si existe) |
| `__weaponDebug()` | Panel de calibración de arma equipada |
| `__snapshotDebug()` | Último snapshot recibido |

### 5.5 Tweaks dev (overrides en runtime)

| Variable global | Default | Para qué |
|---|---|---|
| `window.__sebasOffsetY` | undefined → -1.03 | Override Y del player (testing) |
| `window.__gatherY = { kneel: N }` | undefined → -0.6 | Override Y durante anim kneel |
| `window.__VERBOSE` | undefined | Si true, módulos imprimen más logs |

**Anti-patrón conocido**: estado duplicado entre `combat.js` (`currentTarget`) y `combat_hooks.js` (`_combatTargetNpcId`). Se sincronizan via `__playerEnterCombat` / `__playerExitCombat`. Si añades lógica que cambia el target, asegúrate de disparar los hooks.

---

## 6. Sistema de Equipment

### 6.1 Slots y weapon types
- 9 slots OSRS: `weapon, shield, helm, body, legs, boots, cape, amulet, ring`.
- **weapon_type** del item determina anims a usar:
  - `'unarmed'` → punching attack, sin draw/sheath
  - `'1h_sword'` → Sword_Draw + Sword_Attack_1-3 + Sword_Sheath
  - `'2h_sword'` → Sword_Draw + Sword_Attack_2H + Sword_Sheath
  - `'bow'` → combatStance manual (sin draw), Bow_Shot
  - `'staff'` → combatStance manual (sin draw), Magic_Cast
  - `'dagger'` → mapeado a '1h_sword'
  - **`'axe'` / `'pickaxe'`** → combatStance manual SIN draw. Anim de attack = punching.
- Las herramientas son melee pero no usan sword_draw porque visualmente es raro.

### 6.2 WEAPON_TRANSFORMS (character.js)
- Calibración por mano. Cada arma tiene scale/position/rotation/hand.
- `axe`: `{ scale: 7.0, position: [-7.0, 18.5, 17.0], rotation: [2.458, -1.542, -0.192], hand: 'right' }`
- `pickaxe`: `{ scale: 0.7, position: [8.5, 12.0, 4.5], rotation: [-0.992, 0.058, -1.392], hand: 'right' }`
- **Si una nueva arma se ve mal posicionada**, abrir `__weaponDebug()` panel y calibrar visual.

### 6.3 Sources of truth de un item
Cada item con weapon (ej `axe`) se referencia en **6 lugares**:
1. **D1** tabla `items` — `id, equip_slot='weapon', weapon_type='axe', attack_bonus`
2. **R2** asset `weapons/axe.glb`
3. `character.js` constante `WEAPON_TRANSFORMS.axe`
4. `server/handlers/inventory.js` starter pack (si aplica)
5. `item_icons.js` para icon del inv slot
6. `server/handlers/equipment.js` validaciones
- **Cualquier mismatch = bug oscuro.** Cuando agregás item nuevo, chequear los 6.

---

## 7. State server-side (D1)

### 7.1 Schema migrations
- **NO hay sistema de migrations automáticas.** Cada cambio de schema se hace a mano con:
  ```bash
  npx wrangler d1 execute sebaspresent-db --remote --command="ALTER TABLE ..."
  ```
- Documentar cada migration en `server/migrations/NNN_description.sql` aunque sea solo para referencia humana.

### 7.2 `npc_instances.spawn_x/spawn_z`
- Cada NPC instance tiene su propio spawn point en BD (no compartido por npc_def).
- `combatReviveExpiredNpcs` usa `COALESCE(spawn_x, npc_defs.spawn_x)` para fallback.
- Sin esto, todos los NPCs respawneaban en el mismo punto (bug pre-5c).

### 7.3 Cron de respawn
- Corre cada 1 minuto (`wrangler.toml` triggers).
- Si lo cambias, recordar que afecta también la limpieza de loot drops expirados.

### 7.4 Tablas de gather (S30)
- `tree_state (x, z, tree_type, depleted_until)` PRIMARY KEY (x, z).
- `fires (id, x, z, log_type, user_id, lit_at, expires_at)`.
- Cron de cleanup limpia `tree_state` y `fires` expirados.

---

## 8. CORS y deploy

### 8.1 ALLOWED_ORIGINS en wrangler.toml
- Hardcoded: `localhost:8080`, `127.0.0.1:8080`, `sebaspresent.pages.dev`.
- Si despliegas a otro dominio (Pages preview, custom domain), añadirlo aquí.

### 8.2 API_URL en api.js
- Detecta automáticamente `localhost` vs producción.
- Producción: `https://sebaspresent.srmrpapitas.workers.dev`.

### 8.3 CDN R2 base
- `https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev`
- Hardcoded en `character.js` y `world.js`. Cambiar en los dos sitios si cambia.

### 8.4 Deploy del server (Cloudflare Workers)
- **Auto-deploy desde Git**: push al repo → Cloudflare detecta y deploya en 30-60s.
- Si no deploya solo, ir al dashboard → Workers → seleccionar el worker → "Retry deployment".

### 8.5 Deploy del cliente (Cloudflare Pages)
- Auto-deploy desde Git también.
- URL: `sebaspresent.pages.dev`.

---

## 9. Tamaños de UI

### 9.1 Inventario
- 28 slots fijos (4×7), igual que OSRS clásico.
- Si lo cambias, también cambiar `MAX_SLOTS` en `worker.js` y los SQL inserts.

### 9.2 Bank
- Sin tope hardcoded actualmente.

---

## 10. Bugs conocidos (workaround o pendiente)

### 10.1 Tocón no aparece visualmente al talar (S30 → S32, FIXED)
- **Status**: FIXED en S32.
- **Causa REAL**: bug en `world_snapshot.js` líneas ~234-242 — el cliente
  construía `lastSnapshot` copiando explícitamente solo 7 campos (`now`,
  `players`, `npcs`, `me`, `_sentAt`, `_receivedAt`, `_serverLagMs`).
  Aunque el server enviaba `fires` y `depleted_trees`, el cliente los
  DESCARTABA al guardar. `woodcutting.js syncDepletedFromSnapshot()` veía
  `snap.depleted_trees = undefined` y nunca creaba tocones.
- **Síntoma engañoso**: parecía bug del cliente (createStumpAtScene), pero
  era bug en CAPA DE TRANSPORTE (el snapshot guardado descartaba campos).
- **Fix aplicado**: agregar `fires` y `depleted_trees` al objeto que se
  guarda en `lastSnapshot`.
- **Lección crítica**: cuando un campo nuevo se agrega al server response,
  hay que ASEGURARSE que el cliente lo preserva en su capa de storage.
  No alcanza con que llegue al fetch — tiene que llegar al consumer final.
- **Cómo se detectó**: comparando `fetch` directo desde Eruda (mostraba los
  campos) vs `__diag.printSnapshot()` (no los mostraba). Esa discrepancia
  es la firma típica de este patrón.

### 10.1b Bug del kneel (FIXED S31)
- Ver sección anterior 10.2 del documento original — kneel pose residual.

### 10.2 Kneel — pose residual en idle (S31, FIXED)
- **Status**: FIXED en S31.
- **Causa original**: el clip Kneel.fbx dejaba escrita la pose final en los bones. Three.js no resetea esos valores aunque arrancara idle. Crossfade gradual mantenía 50% de pose vieja durante 5s → char hundido visualmente.
- **Fix aplicado**: `mixer.stopAllAction() + setTime(0)` antes de `play('idle')` + reset timeScale del action.
- **Lección**: para cualquier anim FBX de gather, **siempre** resetear mixer al terminar.

### 10.3 NPCs "amontonados" tras un crash del cron
- Si el cron de respawn falla, los NPCs muertos no vuelven. NO es bug del cliente.
- Verificar con: `SELECT COUNT(*) FROM npc_instances WHERE status = 0;`

### 10.4 "Fuera de rango" durante movimiento hacia el NPC
- Conocido. El cliente spammea attacks antes de llegar a `attack_range`.
- **TODO pendiente**: auto-stop a `attack_range` antes de mandar attack.

### 10.5 Char "vuela" o se hunde un frame
- Probablemente bbox normalize del player. Tolerable mientras no sea persistente.

---

## 11. Refactor S31 — qué cambió

### 11.1 Mudanzas (paths nuevos)
- `client/src/woodcutting.js` → `client/src/skills/woodcutting.js`
- `client/src/firemaking.js` → `client/src/skills/firemaking.js`
- Bloques de `world.js` movidos a `core/scene.js`, `core/camera.js`, `core/combat_hooks.js`.

### 11.2 Estado interno extraído de world.js
- `cameraDist, cameraYaw, cameraPitch` → vive ahora en `core/camera.js`.
- `savedCameraDist, savedCameraPitch` (interior overrides) → idem.
- `combatTargetNpcId` → `core/combat_hooks.js`, acceso via `combatHooks.getCombatTargetNpcId()`.

### 11.3 Hooks NUEVOS de S31
- `window.__sebasHealth()`, `window.__diag.*` — sistema de debug.

### 11.4 Pendiente (próxima sesión)
- `core/player_controller.js` — joystick, tap, Y offset, gather Y, cancel hooks (~400 líneas).
- `core/ui_injection.js` — CSS injection del audio panel + inv grid + skills panel.
- Mover handlers del server a `server/handlers/skills/`.
- Mover `__weaponDebug` de `character.js` → `debug/weapon_debug.js`.

---

## 12. Reglas de oro para no romper nada

1. **Antes de tocar `world.js`**: lee qué sección estás tocando. El archivo tiene 2700 líneas y secciones que comparten state. Cambia una y rompe otra.
2. **Antes de añadir un hook global nuevo**: pregúntate si puedes resolverlo con un import. Si no, documéntalo en sección 5.
3. **Antes de cambiar un timing/threshold**: busca en este doc si está listado como acoplado. Si lo está, cambia los acoplados también.
4. **Antes de cambiar un nombre de animación o archivo R2**: actualiza el map en `character.js` Y sube el archivo nuevo a R2.
5. **Antes de un slice nuevo grande**: actualiza este doc con las nuevas asunciones.
6. **Antes de cambiar lógica de gather (woodcut/kneel)**: leer sección 3 entera. Hay 5 invariantes acopladas.
7. **Cualquier anim FBX nueva**: chequear validador con `__diag.printTracks('NombreClip')`. Match >80%.
8. **Cualquier item nuevo**: chequear las 6 sources of truth (sección 6.3).

---

## 13. Sesión 33 — B-001: tool override durante gathering

### 13.1 attachToolForGather / restoreWeapon (Character)
- `character.attachToolForGather(toolItemId, toolWeaponType)`: swappea
  visualmente al hacha/pico para la actividad. Guarda el arma original en
  `_savedWeaponId / _savedWeaponType` y setea `_toolOverrideActive=true`.
  Es **idempotente**: si la tool ya está equipada (`alreadyEquipped`), no
  hace nada y NO activa el saved state — no hay restore que hacer.
- `character.restoreWeapon()`: si hay override activo, vuelve al arma
  original (`attachWeapon(saved.id, saved.type)`). Si el saved era "ninguna",
  detacha. Limpia los flags. Safe de llamar múltiples veces.
- `character.attachWeapon()` (público): si hay override activo y se pide
  un arma DISTINTA a la tool actual, **invalida el saved state** —
  interpretamos que el jugador/menú cambió el arma a propósito.
- Lógica interna refactorizada a `_doAttachWeapon()` para que tool-override
  y attach normal no se pisen. **No llamar `_doAttachWeapon` desde afuera**
  excepto desde el propio override.

### 13.2 Selección de tool — equipment.getBestAxeAvailable()
- `equipment.findBestToolInInventory(weaponType, slots)` busca:
  1. Si el weapon equipado es del tipo pedido → lo devuelve con `alreadyEquipped: true`.
  2. Si no, busca en `slots` (típicamente `inventory.getState()`) la de
     mayor ranking según `TOOL_RANKINGS`.
- `TOOL_RANKINGS` está hardcodeado en `equipment.js`. Cuando agregues
  `axe_iron`, `axe_steel`, `pickaxe_iron`, etc, **añadirlo al array en
  orden ASCENDENTE de calidad**. Sin esto, el swap usa la primera del
  inventario, no la mejor.

### 13.3 Cancel de skills al entrar combate / morir
- `skills.cancelAll(reason)` (en `skills/index.js`) cancela cualquier
  skill activa. Cada skill debe exportar `cancel(reason)` o el viejo
  `cancelOnMove()` (compat).
- `core/combat_hooks.js` llama `skills.cancelAll('combat')` al inicio de
  `__playerEnterCombat`, y `skills.cancelAll('death')` al inicio de
  `__playerDeath`. Sin esto, el restoreWeapon no se dispara al recibir
  attack o morir → char queda con el hacha durante el draw/death anim.
- **Si agregás una skill nueva con loop activo (mining, fishing, etc),
  asegurate de que exporte `cancel(reason)` que detenga el loop Y haga
  cualquier cleanup visual (restore tool, etc).**

### 13.4 Bugs preexistentes que B-001 NO arregla (TODOs)
- **Peers no ven el swap.** Hoy peers no tienen weapon attached. Cuando
  se haga peer-equipment-sync (probablemente para bow/arrows en bloque 2),
  agregar `equipped_weapon` + `gather_tool` al snapshot por peer y
  attachear/detachear en multiplayer.js. Es B-001b en el backlog.
- **Joystick no llama explícitamente stopChop.** Hoy se cancela "por
  accidente" porque el server rechaza por out_of_range tras alejarse.
  Funciona pero es frágil. Pendiente conectar explícitamente.

---

## 14. Sesión 33 — B-002: smoothness post-combat + combat_styles

### 14.1 B-002 — playDraw / playSheath robustez
- `_drawSheathTimeoutId` en Character guarda el id del setTimeout pendiente
  de playDraw o playSheath. Cuando se llama uno de los dos, primero
  cancela el timeout del anterior. Sin esto: race condition donde el
  setTimeout de playDraw se ejecuta DESPUÉS de playSheath y pisa
  combatStance=false con true (pose residual permanente).
- `playSheath` ya NO aborta por `isInTransition`. Si está en transición,
  igual setea `combatStance=false`, salta la anim de envainar, y llama
  `_forceIdleReset()` para limpiar el mixer.
- `__playerExitCombat` cubre TODOS los branches (incluyendo `unarmed` y
  weaponType desconocido): siempre setea combatStance=false, limpia
  isInTransition, y llama _forceIdleReset.
- `_forceIdleReset()` es el nuevo helper estilo kneel-fix: `mixer.stopAllAction
  + setTime(0) + idle.play()`. Garantiza que el mixer arranque limpio.
  Solo llamar con combatStance=false (sino rompe la pose de combate).

### 14.2 combat_styles.js — interfaz unificada (Bloque 1 día 1)
- Archivo creado en `client/src/combat_styles.js`. Exporta `MeleeStyle`,
  `RangedStyle`, `MagicStyle`, `getActiveStyle()`, `styleForWeaponType(wt)`.
- HOY (S33 día 1) está creado pero **no se usa todavía** — combat.js,
  character.js y combat_hooks.js siguen con su lógica original. La
  migración es trabajo de día 2.
- Contrato que cada style implementa:
  - `id`: 'melee' | 'ranged' | 'magic'
  - `matchesWeaponType(wt)` → boolean. EXCLUSIVO: cada wt matchea 1 solo.
  - `getRange()` → metros. Para validación cliente.
  - `onEnterCombat(character)` → void. Anim de "entrar" + setCombatStance.
  - `onExitCombat(character)` → void. SIEMPRE garantiza combatStance=false.
  - `playAttackAnim(character, stance, cooldownMs)` → void.
  - `canAttack()` → `{ok:true}` o `{ok:false, message}`. Para ammo/runas.
- `MeleeStyle` cubre: 1h_sword, 2h_sword, axe, pickaxe, unarmed.
  Implementado y delega a las funciones existentes en character.js.
- `RangedStyle` cubre: bow. STUB con TODOs marcados para Bloque 2 días 4-7.
- `MagicStyle` cubre: staff. STUB con TODOs marcados para Bloque 2 días 8-11.
- Selector `getActiveStyle()` lee `equipment.getWeaponType()` y devuelve el
  style que matchea. Fallback a MeleeStyle si nada matchea (safe).
- Debug: `window.__combatStyles.getActive()` / `.styleFor('bow')` en Eruda.

### 14.3 Reglas para mañana (día 2 — migración)
- ANTES de tocar combat_hooks.js / combat.js / character.js, leer
  combat_styles.js entero para entender el contrato.
- Reemplazar los `if (weaponType === '1h_sword' || ...)` por
  `getActiveStyle().onEnterCombat(ch)` etc. NO cambiar lógica, solo
  redirigir las llamadas al style.
- Validar que tras la migración: tala con hacha, combate con espada,
  death/revive, y todos los casos de B-002 siguen funcionando idénticos.
  Si algo cambia, el style NO está delegando correctamente.

### 14.4 Reglas para Bloque 2 (arquero/mago)
- NO agregar if/else por weapon_type en combat.js o combat_hooks.js.
  Toda lógica nueva debe vivir en el style correspondiente.
- Si necesitás un método nuevo en el contrato (ej. `playReloadAnim`),
  agregarlo a los 3 styles aunque sea no-op en los que no aplican.
  Mantiene la interfaz consistente.
- Range del server (hoy ~2m hardcoded melee) tiene que actualizarse
  también: ranged necesita ~8m, magic ~6m. El style declara el range
  del cliente pero el server tiene que matchear o el out_of_range
  falla diferente entre cliente y server.

---

*Para Claude / IA: si un bug futuro coincide con un patrón en esta doc, probable que la causa esté acá descrita. No reescribas la solución, leé primero.*
