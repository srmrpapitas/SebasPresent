# SebasPresent — INVARIANTS

> **Lee esto ANTES de tocar código.**
> Cada línea aquí es una asunción que el código depende de ella.
> Romperla causará bugs sutiles en runtime que el linter NO detectará.

---

## 1. Timing y constantes acopladas

### 1.1 Tick de combate = 600ms
- `combat_engine.js` server: cooldown entre attacks = 600ms.
- `combat.js` cliente: `TICK_MS = 600`.
- `character.js`: `ATTACK_TICK_MS = 600` — escala los Sword_Attack para que duren ese tiempo.
- **Si cambias uno, cambia los tres.**

### 1.2 Threshold de tap táctil (INTOCABLES)
- `world.js`: `TAP_DRAG_THRESHOLD = 8px`, `LONG_PRESS_MS = 320ms`.
- **NO los toques sin verificar primero con `console.log` que `doCanvasTap` se llama o no.**
- Lección del chat 2026-05-13: subirlos rompió el tap-to-walk completamente.

### 1.3 Rango de combate
- Server: `COMBAT_RANGE_TOLERANCE = 3.5m` en `worker.js`. Compensa los 3m del patrol radius visual de los NPCs.
- Cliente: el NPC mesh visual está en `mesh.position`, el "centro de patrol" del server está en `npc.x/z`. Usar `mesh.position` para validaciones de rango cliente.

### 1.4 Loot drops (en ms)
- `LOOT_PRIVATE_MS = 60_000` (1min privado al killer)
- `LOOT_TOTAL_LIFETIME_MS = 120_000` (2min total)
- `LOOT_PICKUP_RADIUS_M = 5m` server, `GROUND_ITEM_PICKUP_RADIUS_M = 2.5m` cliente (cliente más estricto a propósito)

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

---

## 3. Hooks globales `window.__*`

> **Cualquier hook nuevo se documenta aquí. Si no está aquí, no existe.**

| Hook | Dispara | Quién lo expone | Quién lo llama |
|---|---|---|---|
| `__playerPlayAttack` | Anima swing del player | `world.js` | `combat.js` cada tick |
| `__playerEnterCombat(npcId)` | Set target + draw espada | `world.js` | `combat.js` engageNpc |
| `__playerExitCombat` | Clear target + sheath | `world.js` | `combat.js` disengage |
| `__playerDeath` | Anima muerte | `world.js` | `combat.js` you_died |
| `__playerRevive` | Limpia muerte, vuelve a idle | `world.js` | `combat.js` respawn |
| `__worldFlashNpcHit(npcId)` | Flash visual + jerk del NPC | `world.js` | `combat.js` cuando hit |
| `__worldSpawnHitsplat(npcId, dmg)` | Hitsplat OSRS sobre NPC | `world.js` | `combat.js` cada tick |
| `__sebasOffsetY` | Offset Y del player (debug) | `world.js` (opcional) | `world.js` (interno) |

**Anti-patrón conocido**: estado duplicado entre `combat.js` (`currentTarget`) y `world.js` (`combatTargetNpcId`). Se sincronizan via `__playerEnterCombat` / `__playerExitCombat`. Si añades lógica que cambia el target, asegúrate de disparar los hooks.

---

## 4. State server-side (D1)

### 4.1 Schema migrations
- **NO hay sistema de migrations automáticas.** Cada cambio de schema se hace a mano con:
  ```bash
  npx wrangler d1 execute sebaspresent-db --remote --command="ALTER TABLE ..."
  ```
- Documentar cada migration en `server/migrations/NNN_description.sql` aunque sea solo para referencia humana.

### 4.2 `npc_instances.spawn_x/spawn_z`
- Cada NPC instance tiene su propio spawn point en BD (no compartido por npc_def).
- `combatReviveExpiredNpcs` usa `COALESCE(spawn_x, npc_defs.spawn_x)` para fallback.
- Sin esto, todos los NPCs respawneaban en el mismo punto (bug pre-5c).

### 4.3 Cron de respawn
- Corre cada 1 minuto (`wrangler.toml` triggers).
- Si lo cambias, recordar que afecta también la limpieza de loot drops expirados.

### 4.4 Tabla `_debug_log`
- Ya NO se usa. Se puede dropear (`DROP TABLE _debug_log;`) si está vacía.
- Si la dropeas, asegúrate que ningún endpoint sigue intentando escribir en ella.

---

## 5. CORS y deploy

### 5.1 ALLOWED_ORIGINS en wrangler.toml
- Hardcoded: `localhost:8080`, `127.0.0.1:8080`, `sebaspresent.pages.dev`.
- Si despliegas a otro dominio (Pages preview, custom domain), añadirlo aquí.

### 5.2 API_URL en api.js
- Detecta automáticamente `localhost` vs producción.
- Producción: `https://sebaspresent.srmrpapitas.workers.dev`.

### 5.3 CDN R2 base
- `https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev`
- Hardcoded en `character.js` y `world.js`. Cambiar en los dos sitios si cambia.

---

## 6. Tamaños de UI

### 6.1 Inventario
- 28 slots fijos (4×7), igual que OSRS clásico.
- Si lo cambias, también cambiar `MAX_SLOTS` en `worker.js` y los SQL inserts.

### 6.2 Bank
- Sin tope hardcoded actualmente.

---

## 7. Cosas que NO se rompen pero parecen bug

### 7.1 NPCs "amontonados" tras un crash del cron
- Si el cron de respawn falla, los NPCs muertos no vuelven. NO es bug del cliente.
- Verificar con: `SELECT COUNT(*) FROM npc_instances WHERE status = 0;`

### 7.2 "Fuera de rango" durante movimiento hacia el NPC
- Conocido. El cliente spammea attacks antes de llegar a `attack_range`.
- TODO pendiente: auto-stop a `attack_range` antes de mandar attack.

### 7.3 Char "vuela" o se hunde un frame
- Probablemente bbox normalize del player (world.js). Tolerable mientras no sea persistente.

---

## 8. Reglas de oro para no romper nada

1. **Antes de tocar `world.js`**: lee qué sección estás tocando. El archivo tiene 4000 líneas y secciones que comparten state. Cambia una y rompe otra.
2. **Antes de añadir un hook global nuevo**: pregúntate si puedes resolverlo con un import. Si no, documéntalo en sección 3.
3. **Antes de cambiar un timing/threshold**: busca en este doc si está listado como acoplado. Si lo está, cambia los acoplados también.
4. **Antes de cambiar un nombre de animación o archivo R2**: actualiza el map en `character.js` Y sube el archivo nuevo a R2.
5. **Antes de un slice nuevo grande**: actualiza este doc con las nuevas asunciones.

---

*Última actualización: 2026-05-15. Cuando hagas un cambio que invalide una sección, actualízala.*
