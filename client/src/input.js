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

  // Inyectar CSS GLOBAL para evitar que iOS Safari interprete drag vertical
  // como scroll de página sobre el HUD/canvas. CRÍTICO aplicarlo a los
  // elementos correctos (NO al sidebar — el sidebar necesita poder scrollear
  // vertical para mostrar todos los tabs en pantallas pequeñas).
  if (!document.getElementById('input-touch-action-fix')) {
    const style = document.createElement('style');
    style.id = 'input-touch-action-fix';
    style.textContent = `
      /* Sesión 11c-2 v2: touch-action específico para que iOS no robe el
         drag vertical como scroll. NO incluir #osrsSidebar — necesita
         scroll vertical (pan-y) para mostrar todos los tabs. */
      #worldCanvas,
      .world-hud, .world-hud-top, .world-hud-pill, .world-hint,
      #joystick, .joystick, .joystick-knob,
      .osrs-minimap-wrap, #worldMinimap, #minimapOpenMap,
      .osrs-fullmap-overlay, .osrs-fullmap-frame,
      #interiorExitBtn, #interiorNpcMenu,
      .ge-overlay > .ge-overlay-frame > .ge-header,
      .bank-overlay > .bank-overlay-frame > .bank-overlay-header,
      #playerNameTag, .player-name-tag,
      #combatFeed, .combat-feed,
      .world-loading, #worldLoading {
        touch-action: none !important;
        -ms-touch-action: none !important;
      }
      /* Sidebar: permitir scroll vertical (pan-y) pero bloquear zoom/pan-x */
      .osrs-sidebar, #osrsSidebar,
      .osrs-sidebar-tabs, .osrs-sidebar-panel,
      .osrs-tab-pane {
        touch-action: pan-y !important;
      }
      /* Bodies de overlays scrollables (banco/GE renderizan listas) */
      .bank-overlay-body, .ge-body {
        touch-action: pan-y !important;
      }
      /* Sesión 13 — Sliders necesitan touch-action:auto para que el thumb
         se pueda arrastrar horizontalmente. Sin esto, el pan-y del sidebar
         bloquea el drag horizontal del slider. */
      .osrs-sidebar input[type="range"],
      input[type="range"][data-audio-slider] {
        touch-action: auto !important;
      }
      html, body { overscroll-behavior: none; }
    `;
    document.head.appendChild(style);
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
  // OJO: NO incluir `.world-hud` aquí. `.world-hud` envuelve a todos
  // los elementos del HUD (joystick, hint, pill, botón salir) y puede
  // cubrir toda la pantalla. Si lo incluyera, TODO drag caería en él y
  // se rechazaría. Solo añadir los hijos específicos que SÍ son UI.
  function isUiElement(t) {
    if (!t) return false;
    if (t === canvas) return false;
    // Interactivos nativos
    if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
        t.tagName === 'TEXTAREA' || t.tagName === 'A' || t.tagName === 'LABEL') return true;
    if (t.closest && t.closest('button, input, select, textarea, a, label, [role="button"]')) return true;
    // Overlays/widgets ESPECÍFICOS del juego. NO `.world-hud` porque cubre
    // toda la pantalla. Sí sus hijos visibles concretos.
    if (t.closest && t.closest(
      '#eruda, .eruda-container, .eruda-dev-tools, .___eruda___, ' +
      '#joystick, .joystick, ' +
      '.osrs-sidebar, #osrsSidebar, ' +
      '.world-hud-top, .world-hud-pill, .world-hint, ' +
      '.osrs-minimap-wrap, #worldMinimap, #minimapOpenMap, ' +
      '.osrs-fullmap-overlay, #fullMapOverlay, ' +
      '.ge-overlay, #geOverlay, ' +
      '.bank-overlay, #bankOverlay, ' +
      '#interiorNpcMenu, #interiorExitBtn, ' +
      '.modal, [role="dialog"], ' +
      '.player-name-tag, #playerNameTag, ' +
      '#worldRegion, #worldBanner, #worldTooltip, ' +
      '#combatFeed, .combat-feed, ' +
      '.world-loading, #worldLoading, ' +
      // Sesión 22 — menús contextuales sueltos
      '.inv-context-menu, #invContextMenu, ' +
      '.equip-tooltip, #equipTooltip, ' +
      '.osrs-action-menu'
    )) return true;
    // Eruda usa el id="eruda" y a veces emite events desde divs sin clase
    // específica. Como fallback: si el target tiene attribute o ancestor
    // con "eruda" en el id o class, lo respeto.
    let cur = t;
    for (let i = 0; i < 6 && cur; i++) {
      const id = cur.id || '';
      const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
      if (/eruda/i.test(id) || /eruda/i.test(cls)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function onPointerDown(e) {
    // Sesión 29 OSRS-PC: aceptar botón izquierdo (0) Y derecho (2). El
    // izquierdo es para tap/walk-to/atacar; el derecho mantenido es
    // para rotar cámara (drag) y soltado sin drag es action menu.
    if (e.button !== undefined && e.button !== 0 && e.button !== 2) return;
    // Filtro mejorado: aceptar pointerdown sobre el canvas O sobre cualquier
    // elemento que NO sea UI conocida.
    if (e.target !== canvas && isUiElement(e.target)) return;

    const isMouse = e.pointerType === 'mouse';
    const isRight = isMouse && e.button === 2;

    pointer = {
      x0: e.clientX, y0: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      isDrag: false,
      pointerId: e.pointerId,
      longPressFired: false,
      longPressTimer: null,
      isMouse,
      isRight,
    };

    // Notifica al consumidor (cerrar menús abiertos, etc.)
    onTouchStart(e.clientX, e.clientY);

    // Long-press solo en touch/pen (móvil/iPad) y solo con botón izquierdo.
    // En PC con ratón el equivalente es click derecho (gestionado en pointerup).
    if (!isMouse && !isRight) {
      pointer.longPressTimer = setTimeout(() => {
        if (!pointer || pointer.isDrag) return;
        pointer.longPressFired = true;
        onLongPress(pointer.lastX, pointer.lastY);
      }, LONG_PRESS_MS);
    }
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

    // Sesión 29 OSRS-PC: en PC con ratón, originalmente SOLO el click derecho
    // mantenido movía la cámara. El drag con click izquierdo no hacía nada
    // (decisión defensiva contra el bug "quería atacar pero moví el ratón sin
    // querer y rotó la cámara").
    //
    // Sesión 37 — Nico pidió click izq + drag también rote cámara (estilo
    // OSRS-PC moderno). El bug original que prevenía esto ya está cubierto
    // por TAP_DRAG_THRESHOLD: si el mouse se mueve >umbral durante el down,
    // pointer.isDrag=true y NO se dispara onTap al soltar (ver onPointerUp).
    // Así que "drag para rotar cámara" y "click para atacar" son mutuamente
    // exclusivos por el threshold — no hay conflicto real.
    //
    // Resultado: cualquier drag (touch, mouse-izq, mouse-der) rota cámara.
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
    const wasRight = pointer.isRight;
    const wasMouse = pointer.isMouse;
    const clientX = e.clientX;
    const clientY = e.clientY;
    pointer = null;

    if (wasDrag) return;
    if (longPressFired) return;

    // Sesión 29 OSRS-PC:
    // - Click derecho sin drag (PC) → action menu (Examinar/Atacar/etc).
    // - Click izquierdo sin drag (cualquier dispositivo) → tap (walk/atacar).
    if (wasMouse && wasRight) {
      onLongPress(clientX, clientY);
    } else {
      onTap(clientX, clientY);
    }
  }

  // CRÍTICO: capture:true. Si en el proyecto hay overlays absolutos que
  // interceptan pointer events (eruda debug panel, otros widgets), corren
  // en bubbling y consumen el evento antes de llegar aquí. Con capture:true
  // mi listener corre PRIMERO. Mi `isUiElement` ya filtra los target de UI
  // real, así que correr antes no daña a botones/sidebar/etc.
  on(window, 'pointerdown',  onPointerDown,   { capture: true });
  on(window, 'pointermove',  onPointerMove,   { capture: true });
  on(window, 'pointerup',    onPointerUp,     { capture: true });
  on(window, 'pointercancel', onPointerUp,    { capture: true });

  // Sesión 29 — Bloquear menú contextual del navegador. La lógica del
  // action menu va por pointerup (button=2 sin drag), aquí solo
  // suprimimos el menú nativo del browser.
  on(canvas, 'contextmenu', (e) => {
    e.preventDefault();
  });

  // Sesión 29 — Scroll wheel → zoom de cámara. Usa el callback
  // onCameraZoom ya existente (que en móvil se dispara con pinch).
  // deltaY positivo (scroll abajo / rueda hacia ti) = zoom out.
  on(canvas, 'wheel', (e) => {
    if (isUiElement(e.target)) return;
    e.preventDefault();
    // Normalizar: deltaMode 0 = pixel, 1 = line, 2 = page. La mayoría de
    // ratones son pixel. line mode da deltaY ~3-5 por click.
    const unit = e.deltaMode === 0 ? 0.02 : 1;
    onCameraZoom(e.deltaY * unit);
  }, { passive: false });

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
    // Sesión 13 — Margen extra de 30px porque el área visual del joystick
    // suele ser mayor que su bounding rect (el thumb se desplaza fuera del
    // contenedor). Sin margen, tocar el borde del joystick contaba como
    // "fuera" y activaba pinch.
    const M = 30;
    return touch.clientX >= r.left - M && touch.clientX <= r.right + M &&
           touch.clientY >= r.top  - M && touch.clientY <= r.bottom + M;
  }

  function onTouchStartCanvas(e) {
    if (e.touches.length !== 2) return;
    // Sesión 13 — Pinch ZOOM real: ambos dedos en el canvas Y cerca entre sí.
    //   1. NINGUNO de los 2 puede estar en (o cerca de) el joystick.
    //      Esto previene el bug: dedo izq en joystick + dedo der girando
    //      cámara → activaba pinch y hacía zoom no deseado.
    //   2. Los 2 dedos deben empezar relativamente cerca (<280px). Un pinch
    //      natural es 2 dedos juntos que se separan. Si están muy separados
    //      al inicio, no es un pinch — es un toque accidental con 2 manos.
    if (touchInsideJoystick(e.touches[0]) || touchInsideJoystick(e.touches[1])) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const initialDist = Math.hypot(dx, dy);
    if (initialDist > 280) return;     // 2 dedos demasiado separados → no es pinch
    pinchActive = true;
    lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    lastPinchDist = initialDist;
  }

  function onTouchMoveCanvas(e) {
    if (!pinchActive || e.touches.length !== 2) return;
    e.preventDefault();
    // Sesión 13 — Pinch 2 dedos: SOLO zoom. La rotación queda para drag
    // 1 dedo. Antes el pinch hacía zoom + rotación a la vez, que era muy
    // sensible (giraba sin querer al intentar hacer zoom).
    const newPinch = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const pinchDelta = newPinch - lastPinchDist;
    onCameraZoom(-pinchDelta * PINCH_ZOOM_SENS);  // separar dedos → zoom in (dist baja)
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
  // Sesión 29 — WASD para movimiento, flechas para rotación de cámara.
  //
  // Movimiento (reutiliza canal de joystick virtual):
  //   W = adelante (y: -1)
  //   S = atrás    (y: +1)
  //   A = izq      (x: -1)
  //   D = der      (x: +1)
  //
  // Cámara (rotación continua mientras se mantienen pulsadas):
  //   ← (ArrowLeft)  → yaw -  (gira cámara a la izquierda)
  //   → (ArrowRight) → yaw +
  //   ↑ (ArrowUp)    → pitch - (mira hacia arriba)
  //   ↓ (ArrowDown)  → pitch +
  //
  // Velocidad de rotación con teclado: ARROW_YAW_RATE rad/s.
  //
  // Si hay un campo de texto enfocado (chat input), las teclas pasan al
  // input y NO mueven al player ni rotan cámara.
  const wasdState   = { w: false, a: false, s: false, d: false };
  const arrowState  = { left: false, right: false, up: false, down: false };
  let wasdActive    = false;
  let arrowRafId    = null;
  let arrowLastTs   = 0;

  // rad/s mientras mantienes una flecha. ~90° por segundo a 1.57 rad/s.
  const ARROW_YAW_RATE   = 1.6;
  const ARROW_PITCH_RATE = 1.0;

  function isTextInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function emitWasdAsJoystick() {
    let x = 0, y = 0;
    if (wasdState.d) x += 1;
    if (wasdState.a) x -= 1;
    if (wasdState.s) y += 1;
    if (wasdState.w) y -= 1;
    const anyHeld = wasdState.w || wasdState.a || wasdState.s || wasdState.d;
    if (anyHeld) {
      wasdActive = true;
      onJoystickMove({ active: true, x, y });
    } else if (wasdActive) {
      wasdActive = false;
      onJoystickMove({ active: false, x: 0, y: 0 });
    }
  }

  function arrowAnyHeld() {
    return arrowState.left || arrowState.right || arrowState.up || arrowState.down;
  }

  function arrowTick(ts) {
    if (!arrowAnyHeld()) {
      arrowRafId = null;
      arrowLastTs = 0;
      return;
    }
    const dt = arrowLastTs ? Math.min(0.1, (ts - arrowLastTs) / 1000) : 0.016;
    arrowLastTs = ts;
    let dyaw = 0, dpitch = 0;
    if (arrowState.left)  dyaw   -= ARROW_YAW_RATE   * dt;
    if (arrowState.right) dyaw   += ARROW_YAW_RATE   * dt;
    if (arrowState.up)    dpitch -= ARROW_PITCH_RATE * dt;
    if (arrowState.down)  dpitch += ARROW_PITCH_RATE * dt;
    // Mismo signo / convención que onCameraDrag → world hace cameraYaw -= dyaw,
    // por lo que mantenemos el sentido: dyaw positivo = girar a la derecha.
    // En camera.drag, dx (mouse mov derecha) → onCameraDrag(positive yaw),
    // y world hace cameraYaw -= dyaw → girar A la IZQUIERDA. Para que las
    // flechas coincidan con el comportamiento esperado (← gira a la izq):
    onCameraDrag(-dyaw, dpitch);
    arrowRafId = requestAnimationFrame(arrowTick);
  }

  function startArrowLoopIfNeeded() {
    if (arrowRafId == null && arrowAnyHeld()) {
      arrowLastTs = 0;
      arrowRafId = requestAnimationFrame(arrowTick);
    }
  }

  function onKeyDown(e) {
    // No interceptar si el usuario está escribiendo en un input.
    if (isTextInputFocused()) {
      onKey(e.key);
      return;
    }
    // WASD = movimiento
    let handled = false;
    switch (e.key) {
      case 'w': case 'W': wasdState.w = true; handled = true; break;
      case 's': case 'S': wasdState.s = true; handled = true; break;
      case 'a': case 'A': wasdState.a = true; handled = true; break;
      case 'd': case 'D': wasdState.d = true; handled = true; break;
    }
    if (handled) {
      e.preventDefault();
      emitWasdAsJoystick();
      return;
    }
    // Flechas = cámara
    switch (e.key) {
      case 'ArrowLeft':  arrowState.left  = true; handled = true; break;
      case 'ArrowRight': arrowState.right = true; handled = true; break;
      case 'ArrowUp':    arrowState.up    = true; handled = true; break;
      case 'ArrowDown':  arrowState.down  = true; handled = true; break;
    }
    if (handled) {
      e.preventDefault();
      startArrowLoopIfNeeded();
      return;
    }
    onKey(e.key);
  }

  function onKeyUp(e) {
    if (isTextInputFocused()) return;
    let wasd = false, arrow = false;
    switch (e.key) {
      case 'w': case 'W': wasdState.w = false; wasd = true; break;
      case 's': case 'S': wasdState.s = false; wasd = true; break;
      case 'a': case 'A': wasdState.a = false; wasd = true; break;
      case 'd': case 'D': wasdState.d = false; wasd = true; break;
      case 'ArrowLeft':  arrowState.left  = false; arrow = true; break;
      case 'ArrowRight': arrowState.right = false; arrow = true; break;
      case 'ArrowUp':    arrowState.up    = false; arrow = true; break;
      case 'ArrowDown':  arrowState.down  = false; arrow = true; break;
    }
    if (wasd) {
      e.preventDefault();
      emitWasdAsJoystick();
    }
    if (arrow) {
      e.preventDefault();
      // arrowTick autodetecta cuando ya no hay flechas activas y se para
      // a sí mismo. No hace falta cancelAnimationFrame manualmente.
    }
  }

  on(window, 'keydown', onKeyDown);
  on(window, 'keyup',   onKeyUp);

  // Si la ventana pierde focus con teclas pulsadas, el keyup nunca llega.
  // Limpiar estado para no quedarse "moviendo solo" o "rotando solo".
  on(window, 'blur', () => {
    let any = false;
    if (wasdState.w || wasdState.a || wasdState.s || wasdState.d) any = true;
    wasdState.w = wasdState.a = wasdState.s = wasdState.d = false;
    if (arrowState.left || arrowState.right || arrowState.up || arrowState.down) any = true;
    arrowState.left = arrowState.right = arrowState.up = arrowState.down = false;
    if (any) emitWasdAsJoystick();
    if (arrowRafId != null) {
      cancelAnimationFrame(arrowRafId);
      arrowRafId = null;
    }
  });

  // ============================================================
  // Dispose
  // ============================================================
  return function dispose() {
    if (pointer?.longPressTimer) clearTimeout(pointer.longPressTimer);
    pointer = null;
    if (arrowRafId != null) {
      cancelAnimationFrame(arrowRafId);
      arrowRafId = null;
    }
    for (const { target, type, fn, options } of listeners) {
      try { target.removeEventListener(type, fn, options); } catch {}
    }
    listeners.length = 0;
  };
}

function noop() {}
