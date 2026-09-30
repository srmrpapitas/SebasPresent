/**
 * SebasPresent — Empujar eventos al canal en tiempo real (Sesión 50)
 *
 * pushRealtime(env, msg) → el Durable Object Realm lo reenvía a todos los
 * jugadores conectados por WebSocket. Si el binding no existe (dev local
 * sin DO) o falla, no pasa nada: el snapshot HTTP sigue llevando los datos.
 */
export async function pushRealtime(env, msg) {
  try {
    if (!env?.REALM) return;
    const stub = env.REALM.get(env.REALM.idFromName('global'));
    await stub.fetch('https://realm/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg }),
    });
  } catch (err) {
    console.warn('[realtime] push failed:', err?.message);
  }
}
