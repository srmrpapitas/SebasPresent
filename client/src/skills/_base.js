/**
 * SebasPresent — Skill base class (Sesión 31, FASE 5)
 *
 * Interface común para todas las skills. Las skills viejas (woodcutting,
 * firemaking) NO heredan de esta clase para no romper su API — están
 * implementadas como módulos con estado privado, que es el patrón del proyecto.
 *
 * Esta clase está para skills NUEVAS (cooking, mining, smithing, etc) que
 * quieran un esqueleto consistente. Reduce el boilerplate de cada skill.
 *
 * @example
 *   import { Skill } from './_base.js';
 *
 *   class CookingSkill extends Skill {
 *     constructor(opts) {
 *       super('cooking', opts);
 *     }
 *     start() {
 *       super.start();
 *       // setup propio
 *     }
 *     update(dt) {
 *       if (!this.isActive()) return;
 *       // loop logic
 *     }
 *     cancelOnMove() {
 *       super.cancelOnMove();
 *       this.feedLog('info', 'Cocción cancelada por movimiento');
 *     }
 *   }
 *
 * O, para mantener el patrón módulo-con-estado (woodcutting / firemaking),
 * simplemente NO heredar y exportar funciones start/stop/update/cancelOnMove
 * desde un archivo. Las dos formas funcionan con el orchestrator
 * `skills/index.js`.
 *
 * @typedef {object} SkillOpts
 * @property {() => THREE.Object3D | null} [getPlayer]
 *   Getter del player container (el group del char). Usar pos.x/z para
 *   validaciones de proximidad client-side.
 *
 * @property {() => Character | null} [getCharacter]
 *   Getter del Character instance. Llamar `playGather(animKey, durationMs)`
 *   para anim de gathering, `play('idle')` para parar, etc.
 *
 * @property {() => Snapshot | null} [getSnapshot]
 *   Getter del último snapshot (world_snapshot.js). Acceso a depleted_trees,
 *   fires, npcs visibles, etc.
 *
 * @property {() => string | null} [getAuthToken]
 *   Getter del JWT actual para llamadas a la API.
 *
 * @property {(level: 'info'|'xp'|'error', message: string) => void} [feedLog]
 *   Función para mostrar mensajes al player en la UI tipo OSRS.
 *
 * @property {THREE.Scene} [scene]
 *   Ref a la escena three.js, por si la skill agrega sprites/meshes
 *   (ej: firemaking agrega sprites de fire).
 */

export class Skill {
  /**
   * @param {string} name      Identificador de la skill (ej 'cooking').
   *   Debe matchear el `skill_id` que usa el server para tracking de XP.
   * @param {SkillOpts} [opts]
   */
  constructor(name, opts = {}) {
    /** @type {string} */
    this.name = name;
    /** @type {SkillOpts} */
    this.opts = opts;
    /** @type {boolean} */
    this.started = false;
    /**
     * Estado de la skill ahora mismo. `null` = idle, cualquier otra cosa =
     * activa. Por convención, contiene los parámetros de la acción en curso
     * (ej: para woodcut, `{ tree_type, tx, tz, fails }`).
     * @type {object|null}
     */
    this.activeAction = null;

    // Getters inyectados por el orchestrator. Defaults son no-op para
    // que el código nunca explote si una skill no tiene una dependencia.
    this.getPlayer    = opts.getPlayer    || (() => null);
    this.getCharacter = opts.getCharacter || (() => null);
    this.getSnapshot  = opts.getSnapshot  || (() => null);
    this.getAuthToken = opts.getAuthToken || (() => null);
    this.feedLog      = opts.feedLog      || (() => {});
  }

  /**
   * Llamado una vez al entrar al mundo, desde `skills/index.js startAll()`.
   * Override para hacer setup propio (cargar sprites, registrar hooks debug, etc).
   *
   * @example
   *   start() {
   *     super.start();
   *     window.__cookingDebug = () => this.activeAction;
   *   }
   */
  start() {
    this.started = true;
  }

  /**
   * Llamado al salir del mundo, desde `skills/index.js stopAll()`.
   * Override para cleanup (dispose sprites, unregister hooks, etc).
   * **Llamar `super.stop()` al final para resetear flags base.**
   */
  stop() {
    this.started = false;
    this.activeAction = null;
  }

  /**
   * Llamado cada frame desde el animate loop (`skills/index.js updateAll(dt)`).
   * Override con la lógica del loop interno (ticks de chop, sync visual, etc).
   *
   * @param {number} _dt   Delta time en segundos (típicamente 0.016 a 60fps).
   */
  update(_dt) {
    // no-op
  }

  /**
   * Llamado por world.js cuando el player mueve el joystick. Debe cancelar
   * la acción en curso sin romper estado (la idea es: "el player decidió
   * caminar, parar lo que estaba haciendo").
   *
   * Default: setea `activeAction = null`. Override si necesitás más cleanup
   * (parar anim del char, mostrar mensaje, etc).
   *
   * @example
   *   cancelOnMove() {
   *     if (!this.activeAction) return;
   *     super.cancelOnMove();
   *     this.feedLog('info', 'Cancelado.');
   *     this.getCharacter()?.play?.('idle');
   *   }
   */
  cancelOnMove() {
    this.activeAction = null;
  }

  /**
   * @returns {boolean} `true` si la skill tiene una acción activa ahora mismo.
   *   Usado por el debug panel para mostrar qué skill está corriendo.
   */
  isActive() {
    return this.activeAction !== null;
  }
}
