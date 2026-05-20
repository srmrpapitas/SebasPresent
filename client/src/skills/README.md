# `client/src/skills/` — Skills del jugador

Una skill por archivo. Cada una es **autocontenida**: maneja su loop interno,
sus llamadas a la API, su anim del char, su UI propia si la tiene.

## Skills actuales

| Skill | Archivo | Server handler | Estado |
|---|---|---|---|
| Woodcutting | `woodcutting.js` | `server/handlers/woodcutting.js` | ✅ S30 |
| Firemaking | `firemaking.js` | `server/handlers/firemaking.js` | ✅ S30 |
| Cooking | `cooking.js` | `server/handlers/cooking.js` | ⏳ S32 |
| Mining | `mining.js` | `server/handlers/mining.js` | ⏳ S33 |

## Contrato de una skill

Cada archivo expone (por convención):

```js
export function start(opts) { ... }    // arranque
export function stop() { ... }          // shutdown
export function update(dt) { ... }     // por frame
export function cancelOnMove() { ... } // cuando el player se mueve (opcional)
```

`opts` incluye getters comunes que recibe del orchestrator (`skills/index.js`):
```js
{
  getPlayer:       () => player,
  getCharacter:    () => character,
  getAuthToken:    () => authToken,
  getSnapshot:     () => worldSnapshot.getSnapshot(),
  getTerrain:      () => terrain,
  setPlayerTarget: (x, z) => setPlayerTarget(x, z),
  feedLog:         (type, msg) => combat.feedLog(type, msg),
  scene,
}
```

La skill ignora los getters que no usa.

## Cómo agregar una skill nueva (paso a paso)

### 1. Crear el handler server

`server/handlers/cooking.js`:
```js
import { db } from '../lib/db.js';

export async function cook(env, req) {
  // validar nivel, consumir input (raw), dar producto + XP
}
```

Registrarlo en `server/worker.js`:
```js
if (url.pathname === '/api/cooking/cook' && req.method === 'POST') {
  return cook(env, req);
}
```

### 2. Crear el client en `skills/cooking.js`

Copiá la estructura de `woodcutting.js` como template:
- `start(opts)` / `stop()` / `update(dt)`
- `cancelOnMove()` si el movimiento cancela la acción
- Estado del módulo en `let` privados arriba del archivo
- Hook debug `window.__cookingDebug` o `__cookDebug` para inspección en consola
- Si toca el char (anim de cook), seguir el patrón de `firemaking.js` con
  `character.playGatherAnim('cook', {...})`

### 3. Activarla en `skills/index.js`

Descomentar el import + añadir al array `SKILL_MODULES`:
```js
import * as cooking from './cooking.js';

const SKILL_MODULES = [
  { name: 'woodcutting', mod: woodcutting },
  { name: 'firemaking',  mod: firemaking  },
  { name: 'cooking',     mod: cooking     },
];
```

### 4. SQL en D1

Crear las migrations necesarias (XP tracking, recipes, etc) **una por una**
para que sea fácil rollback si algo sale mal.

### 5. Probar

`__sebasHealth()` debería mostrar el módulo OK. El badge de debug muestra la
skill activa en la sección "skills active" del panel.

## Por qué NO usar clases para las skills viejas

Las skills viejas (woodcutting, firemaking) son módulos con estado privado.
No las migré a `Skill` (la clase base de `_base.js`) para no romper su API.
La clase base está para skills NUEVAS que prefieran un esqueleto más OO.

Las dos formas funcionan con el orchestrator. No hay opinión fuerte —
elegí lo que te resulte más natural cuando sumes Cooking/Mining.

## Anim de gathering (woodcut/kneel/etc) — patrón estándar

Cuando una skill necesita una anim que dura X ms (tala, encender, minar),
usar `character.playGatherAnim(animName, durationMs)`. Eso ya maneja:
- crossFade desde idle
- timeScale para que la anim dure exactamente lo pedido
- restore a idle al terminar
- el flag `_gatheringActive` que pinea Y=0 durante la anim (evita el hundir)

Para anims arrodilladas como `kneel`, hay un override Y configurable vivo:
```js
window.__gatherY = { kneel: -0.6 };
```
Esto lo lee `world.js` en el bloque updatePlayer (post-refactor:
`core/player_controller.js`). Mientras dura la anim, el player baja a -0.6.
