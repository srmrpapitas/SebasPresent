/**
 * SebasPresent — Monturas (Sesión 50)
 *
 * Se compran a Tanausú, el cuadrero de La Laguna:
 *   🐎 Caballo  — nivel de combate 5,  por tierra
 *   🦅 Guirre   — nivel de combate 25, VUELA (el buitre canario)
 * Reglas:
 *   · Si te atacan, no puedes montar en 10 s.
 *   · Si te GOLPEAN (daño > 0) estando montado, te caes de la montura.
 *     Que un bicho te persiga (aggro) sin pegarte no te baja.
 *   · Atacar, recoger recursos, entrar en un interior o en la Fosa te baja.
 */
export const MOUNTS = {
  caballo: {
    id: 'caballo', name: 'Caballo', icon: '🐎', level: 5, price: 2000, speed: 1.6, fly: false,
    blurb: 'Un caballo criollo, fuerte y tranquilo. Corre mucho más que tú y no se cansa.',
  },
  guirre: {
    id: 'guirre', name: 'Guirre', icon: '🦅', level: 25, price: 40000, speed: 2.4, fly: true, alt: 9,
    blurb: 'El guirre, el buitre de Canarias. Vuela por encima de todo: árboles, casas y murallas.',
  },
};
export const MOUNT_LIST = ['caballo', 'guirre'];
export const MOUNT_COMBAT_LOCK_MS = 10_000;
export const STABLE_NPC = 'tanausu_cuadra';

/** Nivel de combate (misma fórmula que la pestaña de Combate). */
export function combatLevelFrom(att, str, def, hp) {
  return Math.floor((def + hp) / 4 + (att + str) * 13 / 40);
}
