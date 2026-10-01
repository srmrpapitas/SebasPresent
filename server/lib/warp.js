/**
 * SebasPresent — Mover al jugador desde el servidor (Sesión 50)
 *
 * Todo salto de posición que decide el SERVIDOR (tabletas, home, Fosa,
 * respawn) pasa por aquí: actualiza online_users, la posición guardada y
 * apunta el "salto autorizado" (users.warp_*). El Realm, que comprueba la
 * velocidad de cada movimiento, acepta un salto grande solo si cae junto a
 * un salto autorizado reciente. Así los teletransportes nunca cuentan como
 * trampa y un cliente trucado no puede teletransportarse solo.
 */
export async function serverWarp(env, uid, x, z, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('UPDATE online_users SET x = ?, z = ?, last_seen = ? WHERE user_id = ?').bind(x, z, now, uid),
    env.DB.prepare('UPDATE users SET last_x = ?, last_z = ?, warp_x = ?, warp_z = ?, warp_at = ? WHERE id = ?').bind(x, z, x, z, now, uid),
  ]);
}
