/**
 * SebasPresent — Cuadro de diálogo estilo OSRS (Sesión 50)
 *
 * Uso con promesas (guion lineal y legible):
 *   const d = dialogue.begin(npc);           // npc de shared/town_npcs.js
 *   await d.npc('¡Hola, viajero!');           // el NPC habla (toque = seguir)
 *   await d.player('Hola.');                  // tú hablas
 *   const i = await d.choose(['Sí', 'No']);   // opciones → índice (-1 si se cierra)
 *   d.end();
 * Si el diálogo se cierra a mitad (✕, alejarse, otro diálogo), las promesas
 * pendientes se resuelven con null / -1 y el guion debe comprobar d.closed.
 */

let el = null;
let current = null;   // { closed, resolve, npc }
// Sesión 53 — caras al estilo OSRS: world.js pinta la cabeza 3D del personaje en un canvas.
// provider(kind: 'npc'|'player', npc, canvas) → true si ha pintado.
let portraitProvider = null;
let portraitTimer = null;
const faceCanvas = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 160; c.className = 'dlg-face'; return c; } catch { return null; } })();
export function setPortraitProvider(fn) { portraitProvider = fn; }
function stopFace() { if (portraitTimer) { clearInterval(portraitTimer); portraitTimer = null; } }
function tryFace(portrait, kind, npc) {
  stopFace();
  if (!portraitProvider || !faceCanvas) return false;
  let ok = false;
  try { ok = !!portraitProvider(kind, npc, faceCanvas); } catch { ok = false; }
  if (!ok) return false;
  portrait.textContent = '';
  portrait.appendChild(faceCanvas);
  portrait.classList.add('has-face');
  // se mueve un poco mientras habla (6 veces por segundo, solo la cabeza en el encuadre)
  portraitTimer = setInterval(() => { if (!current || current.closed) { stopFace(); return; } try { portraitProvider(kind, npc, faceCanvas); } catch {} }, 170);
  return true;
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

function ensureEl() {
  if (el) return el;
  ensureCss();
  el = document.createElement('div');
  el.className = 'dlg';
  el.innerHTML = `<div class="dlg-portrait"></div>
    <div class="dlg-main"><div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-opts"></div>
    <div class="dlg-hint">Toca para continuar</div></div>
    <button class="dlg-x" aria-label="Cerrar">✕</button>`;
  el.addEventListener('pointerdown', ev => ev.stopPropagation());
  el.addEventListener('pointerup', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('.dlg-x')) { close(); return; }
    const opt = ev.target.closest('[data-opt]');
    if (opt && current?.resolve) { const r = current.resolve; current.resolve = null; r(Number(opt.dataset.opt)); return; }
    if (current?.typing) { current.finishTyping?.(); return; }
    if (current?.resolve && !current.choosing) { const r = current.resolve; current.resolve = null; r(true); }
  });
  document.body.appendChild(el);
  return el;
}

export function isOpen() { return !!(current && !current.closed); }
export function currentNpcId() { return current && !current.closed ? current.npc?.id : null; }

export function close() {
  if (!current) return;
  current.closed = true;
  const r = current.resolve; current.resolve = null;
  if (r) r(current.choosing ? -1 : null);
  current = null;
  stopFace();
  if (el) el.classList.remove('show');
}

function show(who, npc, text) {
  const box = ensureEl();
  box.classList.add('show');
  box.classList.toggle('dlg-narr', who === 'narr');   // Sesión 52 — narrador
  const portrait = box.querySelector('.dlg-portrait');
  portrait.classList.remove('has-face');
  stopFace();
  if (who === 'narr') {
    portrait.style.background = 'radial-gradient(circle at 50% 35%, #4a3a20, #1a120a)';
    portrait.textContent = '📜';
    box.querySelector('.dlg-name').textContent = '';
    box.classList.remove('dlg-me');
  } else if (who === 'npc') {
    portrait.style.background = `radial-gradient(circle at 50% 35%, ${hex(npc.look?.shirt ?? 0x6a5a3a)}, #1a120a)`;
    if (!tryFace(portrait, 'npc', npc)) portrait.textContent = npc.role || '🙂';
    box.querySelector('.dlg-name').innerHTML = `${esc(npc.name)}${npc.title ? ` <small>${esc(npc.title)}</small>` : ''}`;
    box.classList.remove('dlg-me');
  } else {
    portrait.style.background = 'radial-gradient(circle at 50% 35%, #3a6a3a, #0f1a0f)';
    if (!tryFace(portrait, 'player', null)) portrait.textContent = '🧑';
    box.querySelector('.dlg-name').textContent = 'Tú';
    box.classList.add('dlg-me');
  }
  box.querySelector('.dlg-opts').innerHTML = '';
  const tEl = box.querySelector('.dlg-text');
  tEl.style.display = '';
  tEl.textContent = '';
  box.querySelector('.dlg-hint').style.visibility = 'hidden';
  // Efecto de escritura (toque = completar)
  let i = 0;
  current.typing = true;
  const full = String(text);
  const done = () => {
    if (!current) return;
    clearInterval(timer);
    tEl.textContent = full;
    current.typing = false;
    box.querySelector('.dlg-hint').style.visibility = 'visible';
  };
  current.finishTyping = done;
  const timer = setInterval(() => {
    if (!current || current.closed) { clearInterval(timer); return; }
    i += 2;
    tEl.textContent = full.slice(0, i);
    if (i >= full.length) done();
  }, 16);
}

export function begin(npc) {
  close();
  current = { npc, closed: false, resolve: null, choosing: false };
  const me = current;
  const wait = () => new Promise(res => { me.resolve = res; });
  const api = {
    get closed() { return me.closed; },
    get npcId() { return npc?.id; },   // Sesión 52
    async npc(text) { if (me.closed) return null; me.choosing = false; show('npc', npc, text); return wait(); },
    async player(text) { if (me.closed) return null; me.choosing = false; show('player', npc, text); return wait(); },
    // Sesión 52 — escenas: narrador y otros personajes en el mismo diálogo
    async narr(text) { if (me.closed) return null; me.choosing = false; show('narr', npc, text); return wait(); },
    async as(who, text) { if (me.closed) return null; me.choosing = false; show('npc', who || npc, text); return wait(); },
    async choose(labels, prompt = 'Elige una opción') {
      if (me.closed) return -1;
      const box = ensureEl();
      box.classList.add('show');
      box.classList.remove('dlg-me');
      me.choosing = true;
      me.typing = false;
      stopFace();
      box.querySelector('.dlg-portrait').classList.remove('has-face');
      box.querySelector('.dlg-portrait').textContent = '💬';
      box.querySelector('.dlg-portrait').style.background = 'radial-gradient(circle at 50% 35%, #5a4520, #1a120a)';
      box.querySelector('.dlg-name').textContent = prompt;
      box.querySelector('.dlg-text').textContent = '';
      box.querySelector('.dlg-text').style.display = 'none';
      box.querySelector('.dlg-hint').style.visibility = 'hidden';
      box.querySelector('.dlg-opts').innerHTML = labels.map((l, i) => `<button data-opt="${i}">${esc(l)}</button>`).join('');
      const r = await wait();
      me.choosing = false;
      return r == null ? -1 : r;
    },
    end() { if (current === me) close(); },
  };
  return api;
}

function ensureCss() {
  if (document.getElementById('dlg-css')) return;
  const s = document.createElement('style');
  s.id = 'dlg-css';
  s.textContent = `
    .dlg { position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); transform: translate(-50%, 16px);
      width: min(520px, calc(100vw - 16px)); min-height: 96px; display: none; gap: 10px; padding: 10px 12px; box-sizing: border-box;
      background: linear-gradient(#f3e6c4, #e2cf9e); border: 3px solid #5a4020; border-radius: 6px; z-index: 230;
      box-shadow: 0 8px 26px rgba(0,0,0,0.7), inset 0 0 0 2px #c8a86a; font-family: 'IM Fell English', serif; color: #2a1a08;
      user-select: none; -webkit-user-select: none; opacity: 0; transition: opacity .15s, transform .15s; }
    .dlg.show { display: flex; opacity: 1; transform: translate(-50%, 0); }
    .dlg-portrait { flex: 0 0 60px; height: 60px; border-radius: 50%; border: 2px solid #5a4020; display: flex; align-items: center;
      justify-content: center; font-size: 30px; box-shadow: inset 0 0 8px rgba(0,0,0,0.6); align-self: center; }
    .dlg-portrait.has-face { flex-basis: 84px; height: 84px; border-radius: 8px; overflow: hidden; background: radial-gradient(circle at 50% 40%, #6a5a3a, #2a1c0c) !important; }
    .dlg-face { width: 100%; height: 100%; display: block; }
    .dlg-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .dlg-name { font-family: 'Cinzel', serif; font-weight: 700; color: #7a1a0a; font-size: 15px; }
    .dlg-me .dlg-name { color: #1a4a1a; }
    .dlg-narr .dlg-text { font-style: italic; color: #4a3418; }
    .dlg-narr .dlg-name { display: none; }
    .dlg-name small { font-family: 'IM Fell English', serif; font-weight: 400; color: #6a5030; font-size: 12px; }
    .dlg-text { font-size: 15px; line-height: 1.3; min-height: 38px; }
    .dlg-hint { font-size: 11px; color: #1a3a8a; text-align: center; animation: dlgBlink 1.2s infinite; }
    @keyframes dlgBlink { 50% { opacity: 0.35; } }
    .dlg-opts { display: flex; flex-direction: column; gap: 4px; }
    .dlg-opts:empty { display: none; }
    .dlg-opts button { text-align: left; font-family: inherit; font-size: 14px; padding: 7px 10px; color: #1a1aa0;
      background: rgba(255,255,255,0.35); border: 1px solid #a88a50; border-radius: 4px; }
    .dlg-opts button:active { background: #c8a043; color: #000; }
    .dlg-x { position: absolute; top: -12px; right: -8px; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #5a4020;
      background: #7a1a0a; color: #fff; font-size: 13px; line-height: 1; padding: 0; }
  `;
  document.head.appendChild(s);
}
