# `client/src/debug/` — Sistema de debug

Instalado en S31, FASE 2. Resuelve el problema de S30: "cada bug requería abrir
Eruda → copiar script → correr → analizar (30min por iteración)".

## Cómo se inicia

`main.js` importa `./debug/index.js` y llama `initDebugSystem()` antes del
resto del boot. Es idempotente y no depende de `world.js`.

```js
// main.js
import { initDebugSystem } from './debug/index.js';
initDebugSystem();
```

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.js` | Orquestador. `initDebugSystem()` único punto de entrada. |
| `dev_overlay.js` | Badge "bNN.M · NN fps" arriba-izq + panel toggleable. |
| `health_check.js` | `__sebasHealth()` → tabla de chequeos del sistema. |
| `diag.js` | `__diag.*` → bones, tracks, fuerzas, dumps. |
| `error_capture.js` | Atrapa `window.onerror` y unhandledrejection. Buffer 50. |
| `weapon_debug.js` | Placeholder — el panel real vive aún en `character.js`. |
| `inspector.js` | Placeholder para `__inspect(subsistema)` (futuro). |

## Lo que ves en mobile

Esquina arriba-izquierda hay un badge mini que dice:

```
● b31.0-dev · 58fps
```

Color del punto:
- 🟢 verde — todo bien
- 🟡 amarillo — char no cargado / warnings
- 🔴 rojo — hay errores en el buffer
- ⚪ gris — todavía no entró al mundo

**Tap en el badge → abre el panel completo.**

El panel muestra: runtime / character / network / equipment / skills active / errors. Auto-refresh cada 500ms. Tiene botones:

- **Health** — corre `__sebasHealth()` en consola
- **Char dump** — `__diag.dumpCharacterState()`
- **Equip dump** — `__diag.printEquipment()`
- **Bones** — `__diag.printBones()`
- **Snapshot** — `__diag.printSnapshot()`
- **Weapon panel** — abre el panel de calibrar arma equipada
- **Clear cache** — borra caches del Service Worker + reload con `?_cb=ts`
- **Reload** — reload normal

## Lo que tenés en la consola de Eruda

### Health check

```js
__sebasHealth()
// → imprime tabla, devuelve { build, overall: 'ok'|'warn'|'fail', results, elapsedMs }
```

### Introspección runtime

```js
__diag.dumpCharacterState()       // pos, anim, weapon, _gathering*, isDead
__diag.printBones()               // tabla de bones con isBone + worldY
__diag.printTracks('Idle')        // tracks del clip + % match al esqueleto
__diag.printTracks()              // sin args lista clips disponibles
__diag.printEquipment()           // slots equipados
__diag.printSnapshot()            // último snapshot recibido
```

### Acciones

```js
__diag.forceCallApi('/api/me')                    // GET con auth
__diag.forceCallApi('/api/foo', { bar: 1 })       // POST con auth
__diag.forceChop('oak', 100, 50)                  // si en mundo
__diag.forceLightFire(3)                          // slot de inventario con logs
__diag.enableVerboseLogs()                        // window.__VERBOSE = true
__diag.testError()                                // forzar un error de prueba
```

### Hooks existentes que SIGUEN funcionando

El sistema nuevo NO reemplaza los hooks viejos, los **complementa**:

| Hook (donde se registra) | Qué hace |
|---|---|
| `__wcDebug()` (woodcutting.js) | Estado loop tala |
| `__wcDebug.forceChop(t,x,z)` | Forzar chop |
| `__wcDebug.stop()` | Cancelar loop |
| `__weaponDebug()` (character.js) | Panel calibrar arma equipada |
| `__snapshotDebug()` (world_snapshot.js) | Último snapshot |
| `__snapshotDebug.peers/npcs/me/lag()` | Slices del snapshot |
| `__playerPlayAttack/EnterCombat/...` (world.js) | Hooks de combat |
| `__gatherY = { kneel: -0.6 }` (world.js) | Override Y de gather |
| `__sebasOffsetY = N` (world.js) | Override Y del player |

## Diseño

El debug system es **100% observer**. No recibe callbacks de `world.js`,
no se le pasan refs al `player`, `character`, etc. Todo lo lee de `window.*`
que `world.js` ya expone. Por eso se puede inicializar antes que `world.js`,
no rompe si el juego no arrancó, y no agrega acoplamiento al refactor.

## Agregar un dato al panel

Editar `dev_overlay.js`, función `updatePanel()`. Buscar la sección donde
quieras agregar la fila, y añadir:

```js
lines.push(lineRow('mi label', valor, COLOR.text));
```

Usar `lineRow` mantiene la alineación con el resto. `COLOR.*` da los acentos
estándar (okGreen / warnY / errRed / muted).

## Agregar una función a `__diag`

Editar `diag.js`. Crear la función, agregarla al objeto en `installDiag()`.
Mantener: no romper si el estado no está listo, retornar `null` y avisar
con `console.warn` en ese caso.

## Reglas del proyecto a respetar

- **NO backticks anidados en strings CSS.** Usar `setProperty` o concat con `+`.
  Ejemplos en `dev_overlay.js` función `applyStyles`.
- **Tono casual técnico** en comentarios y mensajes de log.
- **Verificar `view` antes de cada `str_replace`** cuando se edite código existente.
