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
 * Ejemplo de uso:
 *
 *   class CookingSkill extends Skill {
 *     constructor(opts) {
 *       super('cooking', opts);
 *     }
 *     start() { ... }
 *     stop()  { ... }
 *     update(dt) { ... }
 *     cancelOnMove() { ... }
 *   }
 *
 * O, para mantener el patrón módulo-con-estado, simplemente NO heredar y
 * exportar funciones start/stop/update/cancelOnMove desde un archivo. Las
 * dos formas funcionan con el orchestrator skills/index.js.
 */

export class Skill {
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    this.started = false;
    this.activeAction = null;
    // getters comunes que el orchestrator inyecta
    this.getPlayer    = opts.getPlayer    || (() => null);
    this.getCharacter = opts.getCharacter || (() => null);
    this.getSnapshot  = opts.getSnapshot  || (() => null);
    this.getAuthToken = opts.getAuthToken || (() => null);
    this.feedLog      = opts.feedLog      || (() => {});
  }

  /** Llamado una vez al arrancar el mundo. Override. */
  start() {
    this.started = true;
  }

  /** Llamado al salir del mundo. Override y llamar super.stop(). */
  stop() {
    this.started = false;
    this.activeAction = null;
  }

  /** Llamado cada frame desde animate(). Override. */
  update(_dt) {
    // no-op
  }

  /** Llamado cuando el player se mueve. Cancela la skill activa. Override. */
  cancelOnMove() {
    this.activeAction = null;
  }

  /** True si la skill tiene una acción activa ahora mismo. */
  isActive() {
    return this.activeAction !== null;
  }
}
