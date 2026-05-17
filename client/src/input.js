/**
 * SebasPresent — Input module (Sesión 2 refactor)
 *
 * Detección de gestos PURA: traduce eventos del navegador (pointer, touch,
 * keyboard) en callbacks semánticos. No sabe nada del mundo 3D, NPCs,
 * cámara ni nada del juego. Solo dispara callbacks.
 *
 * Cómo se usa:
 *
 *   import * as input from './input.js';
 *
 *   const dispose = input.setup({
 *     canvas, joystickEl, joystickKnobEl,
 *     onTouchStart: (x, y) => { ... },     // dedo abajo (cerrar menús, etc.)
 *     onTap:        (x, y) => { ... },     // dedo arriba sin haberse movido
 *     onLongPress:  (x, y) => { ... },     // dedo quieto >LONG_PRESS_MS
 *     onCameraDrag: (dyaw, dpitch) => {},  // dedo arrastrado por canvas
 *     onCameraZoom: (delta) => {},         // pinch (2 dedos)
 *     onJoystickMove: ({active, x, y}) => {}, // x,y en [-1, 1]
 *     onKey:        (key) => {},           // tecla pulsada (Q, E)
 *   });
 *
 *   // Para limpiar:
 *   dispose();
 *
 * Constantes táctiles (¡INTOCABLES sin verificar!):
 *   - TAP_DRAG_THRESHOLD = 8px  → si se mueve más, es drag
 *   - LONG_PRESS_MS = 320ms     → si se queda quieto, es long-press
 *
 *   Subirlos rompe el tap-to-walk completo. Bajarlos hace que pequeños
 *   temblores de dedo se interpreten como drag.
 */

// ============================================================
// Constantes
// ============================================================
const TAP_DRAG_THRESHOLD = 8;          // px de movimiento antes de considerarlo drag
const LONG_PRESS_MS = 320;             // ms de pulsación antes de long-press
const CAMERA_DRAG_YAW_SENS = 0.005;    // rad/px horizontal
const CAMERA_DRAG_PITCH_SENS = 0.004;  // rad/px vertical
const PINCH_ROT_SENS = 0.005;          // rad/px midpoint
const PINCH_ZOOM_SENS = 0.05;          // unidades de dist por px de pinch

// ============================================================
// Setup principal
// ============================================================
/**
 * Engancha todos los listeners de input y devuelve una función dispose()
 * que los desengancha todos. Llamar dispose() al salir del world.
 */
export function setup(opts) {
  const {
    canvas,
    joystickEl,
    joystickKnobEl,
    onTouchStart  = noop,
    onTap         = noop,
    onLongPress   = noop,
    onCameraDrag  = noop,
    onCameraZoom  = noop,
    onJoystickMove = noop,
    onKey         = noop,
  } = opts;

  if (!canvas) {
    throw new Error('[input] setup: canvas es obligatorio');
  }

  // Track de listeners para poder removerlos todos en dispose()
  const listeners = [];
  function on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push({ target, type, fn, options });
  }

  // ============================================================
  // Tap / drag / long-press con 1 dedo en el canvas
  // ============================================================
  // Si el dedo se mueve > TAP_DRAG_THRESHOLD antes de soltar → DRAG
  // (rota cámara). Si se queda quieto > LONG_PRESS_MS → LONG_PRESS.
  // Si no, al soltar → TAP.
  let pointer = null;

  // Helper: ¿es UI real del juego (botón, joystick, modal)? Si lo es,
  // el evento se respeta y NO se trata como drag de cámara. Si NO lo es
  // (canvas, body, área 3D sin overlay), procesamos drag.
  //
  // Lista basada en index.html real: world-hud (top + hint), sidebar
  // OSRS, joystick, minimapa, overlays (GE, full-map), botón de exit
  // del interior, menú NPC del interior, name tag del player.
  function isUiElement(t) {
    if (!t) return false;
    if (t === canvas) return false;
    // Interactivos nativos
    if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
        t.tagName === 'TEXTAREA' || t.tagName === 'A' || t.tagName === 'LABEL') return true;
    if (t.closest && t.closest('button, input, select, textarea, a, label, [role="button"]')) return true;
    // Overlays/widgets del juego (selectores reales del index.html)
    if (t.closest && t.closest(
      '#joystick, .joystick, ' +
      '.osrs-sidebar, #osrsSidebar, ' +
      '.world-hud, .world-hud-top, .world-hud-pill, .world-hint, ' +
      '.osrs-minimap-wrap, #worldMinimap, #minimapOpenMap, ' +
      '.osrs-fullmap-overlay, #fullMapOverlay, ' +
      '.ge-overlay, #geOverlay, ' +
      '#interiorNpcMenu, #interiorExitBtn, ' +
      '.modal, [role="dialog"], .osrs-tab-pane, .tab-pane, ' +
      '.player-name-tag, #playerNameTag, ' +
      '#worldRegion, #worldBanner, #worldTooltip, ' +
      '#combatFeed, .combat-feed, ' +
      '.world-loading, #worldLoading'
    )) return true;
    return false;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // Filtro mejorado: aceptar pointerdown sobre el canvas O sobre cualquier
    // elemento que NO sea UI conocida. Antes filtraba con `e.target !== canvas`,
    // lo cual rompía el drag si algún overlay transparente cubría el canvas.
    if (e.target !== canvas && isUiElement(e.target)) return;

    pointer = {
      x0: e.clientX, y0: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      isDrag: false,
      pointerId: e.pointerId,
      longPressFired: false,
      longPressTimer: null,
    };

    // Notifica al consumidor (típicamente para cerrar menús abiertos)
    onTouchStart(e.clientX, e.clientY);

    pointer.longPressTimer = setTimeout(() => {
      if (!pointer || pointer.isDrag) return;
      pointer.longPressFired = true;
      onLongPress(pointer.lastX, pointer.lastY);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e) {
    if (!pointer) return;
    if (pointer.pointerId !== undefined && e.pointerId !== pointer.pointerId) return;

    const totalDist = Math.hypot(e.clientX - pointer.x0, e.clientY - pointer.y0);
    if (!pointer.isDrag && totalDist < TAP_DRAG_THRESHOLD) return;

    // Promovido a drag — cancelar el timer de long-press
    pointer.isDrag = true;
    if (pointer.longPressTimer) {
      clearTimeout(pointer.longPressTimer);
      pointer.longPressTimer = null;
    }

    const dx = e.clientX - pointer.lastX;
    const dy = e.clientY - pointer.lastY;
    onCameraDrag(dx * CAMERA_DRAG_YAW_SENS, dy * CAMERA_DRAG_PITCH_SENS);

    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
  }

  function onPointerUp(e) {
    if (!pointer) return;
    if (pointer.pointerId !== undefined && e.pointerId !== pointer.pointerId) {
      pointer = null;
      return;
    }
    if (pointer.longPressTimer) {
      clearTimeout(pointer.longPressTimer);
    }
    const wasDrag = pointer.isDrag;
    const longPressFired = pointer.longPressFired;
    const clientX = e.clientX;
    const clientY = e.clientY;
    pointer = null;

    if (wasDrag) return;
    if (longPressFired) return;
    onTap(clientX, clientY);
  }

  // Pointerdown enganchado a WINDOW, no a canvas. Razón: el canvas es
  // hermano del .world-hud / .osrs-minimap-wrap, etc. Los eventos NO
  // burbujean a hermanos, solo a ancestros. Si registramos en canvas y
  // tappeas en una zona cubierta por un overlay hermano, el listener
  // nunca se dispara — drag de cámara no inicia. Registrar en window
  // capta TODOS los pointerdown; el filtro `isUiElement` rechaza los
  // que provienen de UI real (botones, joystick, modales, sidebar).
  on(window, 'pointerdown',  onPointerDown);
  on(window, 'pointermove',  onPointerMove);
  on(window, 'pointerup',    onPointerUp);
  on(window, 'pointercancel', onPointerUp);
  on(canvas, 'contextmenu',  e => e.preventDefault());

  // ============================================================
  // Joystick (movimiento del player)
  // ============================================================
  // Stick virtual que devuelve x,y en [-1,1]. Solo activa los callbacks
  // si hay un knob+contenedor en el DOM; si no, se ignora limpiamente.
  let joyState = { active: false, x: 0, y: 0 };
  const MAX_R = 42;
  let centerX = 0, centerY = 0;

  function setKnob(dx, dy) {
    if (joystickKnobEl) joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function joyStart(ev) {
    if (!joystickEl) return;
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    const rect = joystickEl.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    joyState.active = true;
    joyUpdate(t.clientX, t.clientY);
  }

  function joyUpdate(cx, cy) {
    let dx = cx - centerX, dy = cy - centerY;
    const len = Math.hypot(dx, dy);
    if (len > MAX_R) { dx = dx / len * MAX_R; dy = dy / len * MAX_R; }
    setKnob(dx, dy);
    joyState.x = dx / MAX_R;
    joyState.y = dy / MAX_R;
    onJoystickMove({ active: joyState.active, x: joyState.x, y: joyState.y });
  }

  function joyMove(ev) {
    if (!joyState.active) return;
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    joyUpdate(t.clientX, t.clientY);
  }

  function joyEnd() {
    joyState.active = false;
    joyState.x = 0;
    joyState.y = 0;
    setKnob(0, 0);
    onJoystickMove({ active: false, x: 0, y: 0 });
  }

  if (joystickEl) {
    on(joystickEl, 'touchstart',  joyStart, { passive: false });
    on(joystickEl, 'touchmove',   joyMove,  { passive: false });
    on(joystickEl, 'touchend',    joyEnd);
    on(joystickEl, 'touchcancel', joyEnd);
    on(joystickEl, 'mousedown',   joyStart);
    on(window,     'mousemove',   joyMove);
    on(window,     'mouseup',     joyEnd);
  }

  // ============================================================
  // Pinch zoom + rotación con 2 dedos
  // ============================================================
  // Solo activo si los DOS dedos están fuera del joystick (si no, hay
  // conflicto con el joystick que ya está procesando el primer dedo).
  let pinchActive = false;
  let lastMidX = 0, lastMidY = 0;
  let lastPinchDist = 0;

  function touchInsideJoystick(touch) {
    if (!joystickEl) return false;
    const r = joystickEl.getBoundingClientRect();
    return touch.clientX >= r.left && touch.clientX <= r.right &&
           touch.clientY >= r.top  && touch.clientY <= r.bottom;
  }

  function onTouchStartCanvas(e) {
    if (e.touches.length !== 2) return;
    if (touchInsideJoystick(e.touches[0]) || touchInsideJoystick(e.touches[1])) return;
    pinchActive = true;
    lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    lastPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }

  function onTouchMoveCanvas(e) {
    if (!pinchActive || e.touches.length !== 2) return;
    e.preventDefault();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    // Rotación con midpoint
    onCameraDrag(
      -(mx - lastMidX) * PINCH_ROT_SENS,    // negativo: drag derecha → mira izquierda
       (my - lastMidY) * PINCH_ROT_SENS
    );
    // Pinch zoom
    const newPinch = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const pinchDelta = newPinch - lastPinchDist;
    onCameraZoom(-pinchDelta * PINCH_ZOOM_SENS);  // separar dedos → zoom in (dist baja)
    lastMidX = mx; lastMidY = my;
    lastPinchDist = newPinch;
  }

  function onTouchEndCanvas(e) {
    if (e.touches.length < 2) pinchActive = false;
  }

  on(canvas, 'touchstart', onTouchStartCanvas);
  on(canvas, 'touchmove',  onTouchMoveCanvas, { passive: false });
  on(canvas, 'touchend',   onTouchEndCanvas);

  // ============================================================
  // Teclado
  // ============================================================
  function onKeyDown(e) {
    onKey(e.key);
  }
  on(window, 'keydown', onKeyDown);

  // ============================================================
  // Dispose
  // ============================================================
  return function dispose() {
    if (pointer?.longPressTimer) clearTimeout(pointer.longPressTimer);
    pointer = null;
    for (const { target, type, fn, options } of listeners) {
      try { target.removeEventListener(type, fn, options); } catch {}
    }
    listeners.length = 0;
  };
}

function noop() {}
