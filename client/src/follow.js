/**
 * SebasPresent — Seguir a otro jugador (Sesión 50), como en OSRS.
 * Vas detrás de él a ~2 m. Funciona a pie y montado (tu montura te da la
 * velocidad). Se para si tocas el suelo, usas el joystick o el otro se va.
 */
let getPlayer = () => null, setPlayerTarget = () => {}, getPeers = () => [], feedLog = () => {};
let target = null;       // { id, name }
let acc = 0, bannerEl = null;

export function follow(id, name) {
  target = { id, name };
  feedLog('info', `👣 Sigues a ${name}. Toca el suelo para parar.`);
  showBanner();
}
export function stop(silent = false) {
  if (!target) return;
  if (!silent) feedLog('info', `👣 Dejas de seguir a ${target.name}.`);
  target = null; hideBanner();
}
export function isFollowing() { return !!target; }

export function update(dt) {
  if (!target) return;
  acc += dt; if (acc < 0.15) return; acc = 0;
  const p = getPlayer(); if (!p) return;
  let peer = null;
  for (const q of getPeers()) if (q.user_id === target.id) { peer = q; break; }
  if (!peer) { feedLog('warning', `👣 Has perdido de vista a ${target.name}.`); target = null; hideBanner(); return; }
  const dx = peer.x - p.position.x, dz = peer.z - p.position.z, d = Math.hypot(dx, dz);
  if (d > 2.6) setPlayerTarget(peer.x - dx / d * 2, peer.z - dz / d * 2);
}

function showBanner() {
  hideBanner();
  bannerEl = document.createElement('div');
  bannerEl.className = 'follow-banner';
  bannerEl.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 44px);transform:translateX(-50%);z-index:60;background:rgba(20,14,8,0.88);border:1.5px solid #c8a043;border-radius:14px;padding:4px 12px;color:#f0e0b0;font:bold 12px sans-serif;pointer-events:auto';
  bannerEl.textContent = `👣 Siguiendo a ${target.name} ✕`;
  bannerEl.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); stop(); });
  document.body.appendChild(bannerEl);
}
function hideBanner() { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }

export function start(opts) {
  getPlayer = opts.getPlayer; setPlayerTarget = opts.setPlayerTarget; getPeers = opts.getPeers; feedLog = opts.feedLog || (() => {});
  if (typeof window !== 'undefined') window.__follow = { follow, stop };
}
