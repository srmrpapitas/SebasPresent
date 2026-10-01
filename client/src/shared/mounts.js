/**
 * SebasPresent — Monturas (Sesión 50)
 *
 * Se compran a Tanausú, el cuadrero de La Laguna:
 *   🐎 Caballo  — nivel de combate 5,  por tierra
 *   🕊️ Súper pardela — nivel 5 por tierra; con nivel de combate 25, VUELA
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
  pardela: {
    id: 'pardela', name: 'Dragón', icon: '🐉', level: 5, price: 20000, speed: 1.45, fly: true, flyLevel: 25, flySpeed: 3.2, alt: 9,   // volando: el doble que el caballo (1.6 × 2)
    blurb: 'Un dragón de los riscos de Anaga, criado desde el huevo. Por tierra corre a cuatro patas; con nivel de combate 25 te lleva volando por encima del Teide.',
  },
};
export const MOUNT_LIST = ['caballo', 'pardela'];
export const MOUNT_COMBAT_LOCK_MS = 10_000;
/** Correr montado (botón de correr activo): +50 % de velocidad, gasta la mitad de energía. */
export const MOUNT_RUN_MULT = 1.5;
export const STABLE_NPC = 'tanausu_cuadra';

/** Nivel de combate (misma fórmula que la pestaña de Combate). */
export function combatLevelFrom(att, str, def, hp) {
  return Math.floor((def + hp) / 4 + (att + str) * 13 / 40);
}
