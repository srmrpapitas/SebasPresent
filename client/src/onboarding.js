/**
 * SebasPresent — Guía de inicio (Sesión 52)
 *
 * Recorrido corto por la pantalla la primera vez que entras: ilumina cada
 * parte del HUD (minimapa, misión, pestañas, chat…) con una flecha y un
 * texto. Se puede saltar y repetir desde ⚙ Ajustes.
 *
 * Solo se enseña sola a cuentas que no han empezado el tutorial
 * (misión 'tutorial' sin empezar o en el primer paso sin progreso) y
 * que no la hayan visto ya en este dispositivo.
 *
 *   onboarding.maybeStart({ getQuestState })
 *   onboarding.start()          // forzar (botón de Ajustes)
 */

const SEEN_KEY = 'sebaspresent.onboard.v1';

let layerEl = null, holeEl = null, cardEl = null, arrowEl = null;
let steps = [];
let idx = 0;
let active = false;
let onResize = null;

const isTouch = () => {
  try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch { return false; }
};

function buildSteps() {
  const touch = isTouch();
  return [
    { title: '¡Bienvenido a Tenerife!',
      text: 'Te enseño lo básico en un minuto. Puedes saltarte la guía cuando quieras y repetirla desde ⚙ Ajustes.' },
    { title: 'Moverte',
      text: touch
        ? 'Toca el suelo para caminar hasta allí. También puedes usar el joystick de abajo a la izquierda.'
        : 'Haz clic en el suelo para caminar hasta allí.',
      target: touch ? '#joystick' : null },
    { title: 'La cámara',
      text: touch
        ? 'Arrastra un dedo por el mundo para girar la cámara. Pellizca con dos dedos para acercar o alejar.'
        : 'Arrastra con el ratón para girar la cámara. Usa la rueda para acercar o alejar.' },
    { title: 'Hacer cosas',
      text: 'Toca árboles, rocas, animales, personas, hornos… Tu personaje irá solo y hará la acción. Mantén pulsado para ver más opciones.' },
    { title: 'Tu misión',
      text: 'Aquí ves lo que tienes que hacer ahora. Tócala para ver el consejo. Un haz de luz dorado en el mundo te marca a dónde ir.',
      target: '.quest-tracker' },
    { title: 'Minimapa',
      text: 'Tu posición y lo que hay cerca. El botón del mapa abre la isla entera.',
      target: '#worldMinimap' },
    { title: 'Vida, plegaria, energía y maná',
      text: 'Si la vida (corazón) llega a 0, mueres. Come comida cocinada para curarte.',
      target: '.osrs-stats-column' },
    { title: 'Mochila',
      text: 'Tus objetos. Toca uno para usarlo; mantén pulsado para ver su nombre y todas las opciones.',
      target: '[data-tab-btn="inventory"]', tab: 'inventory' },
    { title: 'Habilidades',
      text: 'Talar, pescar, minería, cocina, combate… Toca cualquiera para ver su guía y qué desbloqueas.',
      target: '[data-tab-btn="stats"]', tab: 'stats' },
    { title: 'Equipo',
      text: 'Lo que llevas puesto y tus bonus de ataque y defensa.',
      target: '[data-tab-btn="equipment"]', tab: 'equipment' },
    { title: 'Misiones',
      text: 'Todas las misiones con sus pasos y recompensas. Toca una para seguirla.',
      target: '[data-tab-btn="quest"]', tab: 'quest' },
    { title: 'Chat',
      text: 'Habla con los demás jugadores de la isla.',
      target: '#chatRoot' },
    { title: '¡A jugar!',
      text: 'Empieza por tu primera misión: tala 3 troncos de un árbol cercano. Te daremos un hacha. ¡Suerte!',
      tab: 'inventory' },
  ];
}

export function hasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}

/** Muestra la guía si es un jugador nuevo. */
export function maybeStart({ getQuestState } = {}) {
  if (active || hasSeen()) return;
  let fresh = true;
  try {
    const st = getQuestState?.('tutorial');
    if (st && (st.status !== 0 || st.step > 0 || st.progress > 0)) fresh = false;
  } catch {}
  if (!fresh) { markSeen(); return; }
  start();
}

export function isActive() { return active; }

export function start() {
  if (active) return;
  ensureCss();
  steps = buildSteps();
  idx = 0;
  active = true;

  layerEl = document.createElement('div');
  layerEl.className = 'onb-layer';
  layerEl.innerHTML = `
    <div class="onb-hole"></div>
    <div class="onb-arrow">▼</div>
    <div class="onb-card" role="dialog" aria-live="polite">
      <div class="onb-count"></div>
      <div class="onb-title"></div>
      <div class="onb-text"></div>
      <div class="onb-btns">
        <button class="onb-skip" type="button">Saltar</button>
        <span class="onb-sp"></span>
        <button class="onb-back" type="button">‹</button>
        <button class="onb-next" type="button">Siguiente ›</button>
      </div>
    </div>`;
  document.body.appendChild(layerEl);
  holeEl = layerEl.querySelector('.onb-hole');
  cardEl = layerEl.querySelector('.onb-card');
  arrowEl = layerEl.querySelector('.onb-arrow');

  // Que nada de la guía llegue al juego (tap-to-walk, cámara…)
  const stop = (e) => { e.stopPropagation(); };
  for (const t of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'click', 'wheel']) {
    layerEl.addEventListener(t, stop);
  }
  const btn = (sel, fn) => layerEl.querySelector(sel).addEventListener('pointerup', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); fn();
  });
  btn('.onb-next', () => go(idx + 1));
  btn('.onb-back', () => go(idx - 1));
  btn('.onb-skip', () => finish());

  onResize = () => place();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey, true);
  go(0);
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
  else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(idx + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(idx - 1); }
}

function go(i) {
  if (!active) return;
  if (i < 0) i = 0;
  if (i >= steps.length) { finish(); return; }
  idx = i;
  const s = steps[idx];
  if (s.tab) openTab(s.tab);
  cardEl.querySelector('.onb-count').textContent = `${idx + 1} / ${steps.length}`;
  cardEl.querySelector('.onb-title').textContent = s.title;
  cardEl.querySelector('.onb-text').textContent = s.text;
  cardEl.querySelector('.onb-back').style.visibility = idx === 0 ? 'hidden' : 'visible';
  cardEl.querySelector('.onb-next').textContent = idx === steps.length - 1 ? '¡Vamos!' : 'Siguiente ›';
  cardEl.querySelector('.onb-skip').style.visibility = idx === steps.length - 1 ? 'hidden' : 'visible';
  cardEl.classList.remove('onb-in'); void cardEl.offsetWidth; cardEl.classList.add('onb-in');
  // Deja que la pestaña se abra antes de medir
  requestAnimationFrame(() => place());
}

function openTab(tab) {
  const b = document.querySelector(`.osrs-sidebar-tab[data-tab-btn="${tab}"]`);
  if (!b) return;
  // ui.js cambia de pestaña con pointerup (y despliega el panel si está minimizado)
  try { b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); } catch {}
}

function targetRect(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
  return r;
}

function place() {
  if (!active) return;
  const s = steps[idx];
  const r = targetRect(s.target);
  const vw = innerWidth, vh = innerHeight;
  const cw = Math.min(330, vw - 24);
  cardEl.style.width = cw + 'px';
  const ch = cardEl.offsetHeight || 150;

  if (!r) {
    holeEl.style.display = 'none';
    arrowEl.style.display = 'none';
    layerEl.classList.add('onb-dim');
    cardEl.style.left = Math.round((vw - cw) / 2) + 'px';
    cardEl.style.top = Math.round((vh - ch) / 2) + 'px';
    return;
  }
  layerEl.classList.remove('onb-dim');
  const pad = 6;
  holeEl.style.display = 'block';
  holeEl.style.left = (r.left - pad) + 'px';
  holeEl.style.top = (r.top - pad) + 'px';
  holeEl.style.width = (r.width + pad * 2) + 'px';
  holeEl.style.height = (r.height + pad * 2) + 'px';

  // Tarjeta: debajo del objetivo si cabe, si no encima; si tampoco, al lado.
  const gap = 34;
  const cx = r.left + r.width / 2;
  let left = Math.max(12, Math.min(vw - cw - 12, cx - cw / 2));
  let top, arrowTop, arrowRot;
  if (r.bottom + gap + ch < vh - 8) {
    top = r.bottom + gap; arrowTop = r.bottom + 4; arrowRot = 180;
  } else if (r.top - gap - ch > 8) {
    top = r.top - gap - ch; arrowTop = r.top - 30; arrowRot = 0;
  } else {
    // al lado (pestañas en la derecha en PC/horizontal)
    top = Math.max(8, Math.min(vh - ch - 8, r.top + r.height / 2 - ch / 2));
    const roomLeft = r.left - gap - cw;
    left = roomLeft > 8 ? roomLeft : Math.min(vw - cw - 8, r.right + gap);
    arrowEl.style.display = 'block';
    const toLeft = roomLeft > 8;
    arrowEl.style.left = (toLeft ? r.left - 30 : r.right + 4) + 'px';
    arrowEl.style.top = (r.top + r.height / 2 - 13) + 'px';
    arrowEl.style.setProperty('--rot', toLeft ? '-90deg' : '90deg');
    cardEl.style.left = Math.round(left) + 'px';
    cardEl.style.top = Math.round(top) + 'px';
    return;
  }
  arrowEl.style.display = 'block';
  arrowEl.style.left = (cx - 13) + 'px';
  arrowEl.style.top = arrowTop + 'px';
  arrowEl.style.setProperty('--rot', arrowRot === 180 ? '180deg' : '0deg');
  cardEl.style.left = Math.round(left) + 'px';
  cardEl.style.top = Math.round(top) + 'px';
}

export function finish() {
  if (!active) return;
  active = false;
  markSeen();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKey, true);
  layerEl?.remove();
  layerEl = holeEl = cardEl = arrowEl = null;
}

function ensureCss() {
  if (document.getElementById('onb-css')) return;
  const st = document.createElement('style');
  st.id = 'onb-css';
  st.textContent = `
    .onb-layer { position: fixed; inset: 0; z-index: 9000; touch-action: none; }
    .onb-layer.onb-dim { background: rgba(0,0,0,0.62); }
    .onb-hole { position: fixed; border-radius: 8px; border: 2px solid #e8c560;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.62), 0 0 18px 4px rgba(232,197,96,0.75);
      transition: left .25s, top .25s, width .25s, height .25s; pointer-events: none;
      animation: onbGlow 1.4s ease-in-out infinite; }
    @keyframes onbGlow { 50% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.62), 0 0 28px 8px rgba(255,220,120,0.95); } }
    .onb-arrow { position: fixed; width: 26px; height: 26px; font-size: 24px; line-height: 26px; text-align: center;
      color: #ffd060; text-shadow: 0 0 8px #000, 0 2px 2px #000; pointer-events: none;
      transform: rotate(var(--rot, 0deg)); animation: onbBob .8s ease-in-out infinite alternate; }
    @keyframes onbBob { to { translate: 0 5px; } }
    .onb-card { position: fixed; box-sizing: border-box; padding: 12px 14px 10px;
      background: linear-gradient(180deg, rgba(44,30,16,0.98), rgba(22,15,8,0.98));
      border: 2px solid #c8a043; border-radius: 8px; color: #f0e0b0;
      box-shadow: 0 10px 30px rgba(0,0,0,0.75); font-family: 'IM Fell English', Georgia, serif; }
    .onb-card.onb-in { animation: onbIn .22s ease-out; }
    @keyframes onbIn { from { opacity: 0; transform: translateY(6px) scale(.98); } }
    .onb-count { font-size: 11px; color: rgba(220,190,130,0.7); }
    .onb-title { font-family: 'Cinzel', serif; font-weight: 900; font-size: 17px; color: #e8c560;
      text-shadow: 0 2px 3px #000; margin: 1px 0 5px; }
    .onb-text { font-size: 15px; line-height: 1.35; }
    .onb-btns { display: flex; align-items: center; gap: 6px; margin-top: 11px; }
    .onb-sp { flex: 1; }
    .onb-btns button { height: 34px; padding: 0 12px; border-radius: 5px; cursor: pointer;
      font: bold 14px 'IM Fell English', serif; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .onb-skip { background: transparent; border: 1px solid rgba(200,160,67,0.4); color: rgba(220,190,130,0.8); }
    .onb-back { background: rgba(60,45,30,0.9); border: 1px solid #5a4020; color: #d8c89a; min-width: 36px; }
    .onb-next { background: linear-gradient(180deg, #b8862e, #8a5f1a); border: 1px solid #f0d080; color: #fff6d0;
      text-shadow: 0 1px 1px #000; }
    .onb-btns button:active { transform: scale(0.96); }
  `;
  document.head.appendChild(st);
}
