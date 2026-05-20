# `client/src/core/` — Núcleo del runtime

Lo que vive acá: cosas que SIEMPRE se usan mientras el mundo está corriendo.
Cosas como setup de three.js, cámara, controles del player, hooks que tocan
el character.

**Esto se extrajo de `world.js`**, que antes era un god-file de 2900 líneas
mezclando 12 responsabilidades distintas. El objetivo final es que `world.js`
quede en 300-400 líneas como **orchestrator puro**: importa los módulos de
`core/`, los inicializa en orden, y delega.

## Estado actual del refactor

| Módulo | Estado | Líneas extraídas de world.js |
|---|---|---|
| `scene.js` | ✅ extraído | ~30 |
| `camera.js` | ✅ extraído | ~30 + 2 listeners |
| `combat_hooks.js` | ✅ extraído | ~95 |
| `player_controller.js` | ⏳ pendiente | ~400 |
| `ui_injection.js` | ⏳ pendiente | ~300 |

## Patrón de los módulos

Cada módulo de `core/` sigue este patrón:

```js
// estado privado
let _x = null;

export function init(opts) {
  // recibir getters/refs, setup inicial
}

export function update(dt) {
  // llamado cada frame desde world.js animate loop
}

// getters/setters expuestos
export function getX() { return _x; }
```

## Por qué módulos con estado y no clases

El proyecto ya usa ES modules con estado privado en el resto de los módulos
(`woodcutting.js`, `firemaking.js`, `multiplayer.js`, etc). Mantener consistencia.

Si en el futuro hace falta tener múltiples instancias (ej. dos cámaras), se
puede refactorar a clase. Por ahora YAGNI.
