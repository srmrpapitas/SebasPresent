/**
 * SebasPresent — Combat log (Sesión 39 / beta 0.2 · primera tarea de PULIDO)
 *
 * Log automático de eventos de combate con timestamp en MILISEGUNDOS. La idea
 * (ver HANDOFF 5.3 §4.3.1): Nico juega y rompe cosas → el juego loguea solo →
 * pasa el log + describe qué se sintió raro → cruzamos datos (log) con feel.
 *
 * Con el log se cazan cosas que el ojo NO ve:
 *   - dobles disparos       (dos ataques más cerca que el cooldown)
 *   - inputs perdidos       (click sin ataque resultante)
 *   - delays inconsistentes (latencia del polling del Worker)
 *   - desync cliente/server (daño/HP que no cuadra entre ticks)
 *
 * DISEÑO: 100% OBSERVER, igual que el resto de debug/. NO toca combat.js,
 * combat_hooks.js ni woodcutting.js. Se cuelga de:
 *   - los hooks globales window.__player* (vía trap defineProperty, así da
 *     igual el orden de boot: registremos el log antes o después de que
 *     world.js registre los hooks, el wrapper siempre intercepta).
 *   - window.fetch (mide latencia REAL request→respuesta de los ataques y la
 *     tala, y parsea el resultado del server sin consumir el body original).
 *   - pointerdown sobre el canvas (pasivo, capture; nunca preventDefault).
 *
 * Nada de esto cambia el comportamiento del juego. Si algo falla acá, los
 * try/catch lo tragan: el log NUNCA debe romper el combate.
 *
 * NO toca CSS ni layout → la regla de oro ("EL MÓVIL NO SE TOCA") se respeta:
 * esto es JS de instrumentación puro.
 *
 * API expuesta en window.__combatLog:
 *   __combatLog()            — alias de dump() (imprime + devuelve string)
 *   __combatLog.dump()       — imprime el log formateado en consola y lo devuelve
 *   __combatLog.copy()       — copia el log al portapapeles (+ lo devuelve)
 *   __combatLog.clear()      — vacía el buffer
 *   __combatLog.tail(n=20)   — vista rápida de los últimos n eventos
 *   __combatLog.start()      — reanuda la captura
 *   __combatLog.stop()       — pausa la captura (el buffer se conserva)
 *   __combatLog.events       — array crudo de eventos (para inspección manual)
 */

import { BUILD } from '../build.js';

// ============================================================
// Estado del módulo
// ============================================================

const MAX_EVENTS = 800;          // ring buffer; ~800 eventos sobran para una sesión
const HIGH_LAT_MS = 700;         // umbral para marcar "latencia alta" en api de combate
const LOST_INPUT_MS = 600;       // ventana para considerar un click "sin ataque"
const DOUBLE_FIRE_RATIO = 0.8;   // dos ataques con Δ < cooldown*ratio = sospecha de doble disparo

let _events = [];
let _installed = false;
let _capturing = true;

// ============================================================
// Utilidades internas
// ============================================================

function now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

/** Empuja un evento al buffer y lo devuelve (para que el caller lo mute luego,
 *  ej. rellenar la latencia cuando la respuesta del fetch resuelve). */
function pushEvent(ev) {
  if (!_capturing) return ev;
  ev.t = now();
  _events.push(ev);
  if (_events.length > MAX_EVENTS) _events.shift();
  return ev;
}

/** Trampa un hook global window[name]. El wrapper loguea y delega en el real.
 *  Order-independent: aunque el real se asigne DESPUÉS, el setter lo captura. */
function trapHook(name, onCall) {
  let real = (typeof window[name] === 'function') ? window[name] : null;

  const wrapper = function (...args) {
    try { onCall(args); } catch { /* el log jamás rompe el juego */ }
    if (typeof real === 'function') return real.apply(this, args);
  };

  try {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return wrapper; },
      set(fn) { real = fn; },
    });
  } catch {
    // Fallback raro: si no se puede definir el accessor, envolvemos lo que haya.
    if (typeof window[name] === 'function') {
      const orig = window[name];
      window[name] = function (...args) {
        try { onCall(args); } catch {}
        return orig.apply(this, args);
      };
    }
  }
}

/** Resumen compacto de la respuesta de /api/combat/attack(_player). */
function summarizeAttack(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.error) return { error: data.error };
  const out = {};
  if (data.your_hit !== undefined)  out.youHit = !!data.your_hit;
  if (data.your_damage !== undefined) out.youDmg = data.your_damage;
  if (data.npc_hit !== undefined && data.npc_hit !== null) out.npcHit = !!data.npc_hit;
  if (data.npc_damage !== undefined) out.npcDmg = data.npc_damage;
  if (data.npc_hp !== undefined)    out.npcHp = data.npc_hp;
  if (data.your_hp !== undefined)   out.youHp = data.your_hp;
  if (data.cooldown_ms !== undefined) out.cd = data.cooldown_ms;
  if (data.npc_killed) out.killed = true;
  if (data.you_died)   out.died = true;
  if (data.is_crit)    out.crit = true;
  return out;
}

// ============================================================
// Instalación de los observadores
// ============================================================

function installHookTraps() {
  // engage / disengage / muerte / revive ------------------------------------
  trapHook('__playerEnterCombat', (args) => {
    pushEvent({ type: 'engage', target: args[0] });
  });
  trapHook('__playerExitCombat', () => {
    pushEvent({ type: 'disengage' });
  });
  trapHook('__playerDeath', () => {
    pushEvent({ type: 'death' });
  });
  trapHook('__playerRevive', () => {
    pushEvent({ type: 'revive' });
  });

  // EL evento clave para cazar dobles disparos. args = (stance, weaponType, cooldownMs)
  trapHook('__playerPlayAttack', (args) => {
    pushEvent({ type: 'attack', stance: args[0], wt: args[1], cd: args[2] });
  });

  // Resultado visual: daño que TÚ haces al NPC. args = (npcId, dmg)
  trapHook('__worldSpawnHitsplat', (args) => {
    pushEvent({ type: 'you_hit', target: args[0], dmg: args[1] });
  });
  // Resultado visual: daño que el NPC te hace a TI. args = (dmg, hit)
  trapHook('__spawnPlayerSplat', (args) => {
    pushEvent({ type: 'npc_hit', dmg: args[0], hit: !!args[1] });
  });
}

function installFetchWrap() {
  if (typeof window.fetch !== 'function') return;
  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    let url = '';
    try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch {}

    const isCombat = url.indexOf('/api/combat/attack') !== -1;
    const isChop   = url.indexOf('/api/woodcutting/chop') !== -1;
    if (!isCombat && !isChop) return origFetch(input, init);

    const type = isChop ? 'api_chop'
               : (url.indexOf('attack_player') !== -1 ? 'api_pvp' : 'api_attack');
    const start = now();
    const entry = pushEvent({ type, pending: true });

    return origFetch(input, init).then((res) => {
      entry.lat = Math.round(now() - start);
      entry.status = res.status;
      entry.pending = false;
      // Clonamos para leer el body SIN consumir el original (lo necesita combat.js).
      try {
        res.clone().json().then((data) => {
          if (isChop) {
            entry.out = data && (data.error ? { error: data.error }
              : { log: !!data.log_gained, xp: data.xp_gained || 0 });
          } else {
            entry.out = summarizeAttack(data);
          }
        }).catch(() => {});
      } catch {}
      return res;
    }, (err) => {
      entry.lat = Math.round(now() - start);
      entry.err = String((err && err.message) || err);
      entry.pending = false;
      throw err;
    });
  };
}

function installPointerWatch() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  // Pasivo + capture: observamos, nunca interferimos con input.js.
  document.addEventListener('pointerdown', (e) => {
    try {
      const onCanvas = e.target && e.target.tagName === 'CANVAS';
      if (!onCanvas) return;   // solo clicks sobre el mundo 3D nos interesan
      pushEvent({ type: 'click', btn: e.button });
    } catch {}
  }, { capture: true, passive: true });
}

// ============================================================
// Formato del dump (el artefacto que Nico copia y pasa)
// ============================================================

const TYPE_LABEL = {
  engage:    '⚔ ENGAGE',
  disengage: '✋ disengage',
  attack:    'atk',
  you_hit:   'hit → enemigo',
  npc_hit:   'hit ← enemigo',
  death:     '☠ MUERTE',
  revive:    '✚ revive',
  api_attack:'→ api_attack',
  api_pvp:   '→ api_pvp',
  api_chop:  '→ api_chop',
  click:     'click',
};

function fmtEventDetail(ev) {
  switch (ev.type) {
    case 'engage':    return String(ev.target ?? '');
    case 'attack':    return `stance=${ev.stance ?? '?'} wt=${ev.wt ?? '?'} cd=${ev.cd ?? '?'}`;
    case 'you_hit':   return `${ev.dmg} dmg → #${ev.target}`;
    case 'npc_hit':   return ev.hit ? `${ev.dmg} dmg recibido` : 'fallo enemigo';
    case 'click':     return ev.btn === 2 ? 'derecho (examinar)' : (ev.btn === 0 ? 'izquierdo' : `btn${ev.btn}`);
    case 'api_attack':
    case 'api_pvp':
    case 'api_chop': {
      if (ev.pending) return 'lat=… (sin respuesta)';
      let s = `lat=${ev.lat}ms st=${ev.status ?? '?'}`;
      if (ev.err) return s + ` ERR=${ev.err}`;
      if (ev.out) {
        const o = ev.out;
        if (o.error) return s + ` error=${o.error}`;
        const bits = [];
        if (o.youDmg !== undefined) bits.push(`you=${o.youHit ? o.youDmg : 'miss'}`);
        if (o.npcDmg !== undefined && o.npcHit !== undefined) bits.push(`npc=${o.npcHit ? o.npcDmg : 'miss'}`);
        if (o.npcHp !== undefined) bits.push(`npcHP=${o.npcHp}`);
        if (o.youHp !== undefined) bits.push(`youHP=${o.youHp}`);
        if (o.crit) bits.push('CRIT');
        if (o.killed) bits.push('KILL');
        if (o.died) bits.push('DEATH');
        if (o.log !== undefined) bits.push(o.log ? 'log+' : 'log-');
        if (bits.length) s += '  ' + bits.join(' ');
      }
      return s;
    }
    default: return '';
  }
}

/** Construye el texto completo del log + un resumen analítico al final. */
function buildReport() {
  if (!_events.length) {
    return `=== SebasPresent · Combat Log (${BUILD}) ===\n(sin eventos — todavía no pasó nada de combate/tala)`;
  }

  const t0 = _events[0].t;
  const lines = [];
  lines.push(`=== SebasPresent · Combat Log (${BUILD}) ===`);
  lines.push(`${new Date().toISOString()} · ${_events.length} eventos · ventana ${((_events[_events.length - 1].t - t0) / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('   t(+s)     Δms   evento');

  // Para análisis de dobles disparos: recordamos el último 'attack'.
  let lastAttack = null;
  const doubleFires = [];

  let prevT = t0;
  for (const ev of _events) {
    const rel = ((ev.t - t0) / 1000).toFixed(3).padStart(8);
    const dt = Math.round(ev.t - prevT);
    const dtStr = (dt === 0 && ev === _events[0]) ? '   —' : String(dt).padStart(6);
    prevT = ev.t;

    let label = TYPE_LABEL[ev.type] || ev.type;
    let flag = '';

    if (ev.type === 'attack') {
      if (lastAttack) {
        const gap = ev.t - lastAttack.t;
        const expected = (lastAttack.cd || ev.cd || 900) * DOUBLE_FIRE_RATIO;
        if (gap < expected) {
          flag = `  ⚠ POSIBLE DOBLE DISPARO (Δ=${Math.round(gap)}ms < ${Math.round(expected)}ms)`;
          doubleFires.push({ rel, gap: Math.round(gap), expected: Math.round(expected) });
        }
      }
      lastAttack = ev;
    }

    if ((ev.type === 'api_attack' || ev.type === 'api_pvp' || ev.type === 'api_chop') &&
        !ev.pending && typeof ev.lat === 'number' && ev.lat > HIGH_LAT_MS) {
      flag += `  ⚠ latencia alta`;
    }

    const detail = fmtEventDetail(ev);
    lines.push(`  +${rel}  ${dtStr}   ${label}${detail ? '  ' + detail : ''}${flag}`);
  }

  // ---------- RESUMEN ----------
  lines.push('');
  lines.push('RESUMEN');

  const attacks = _events.filter(e => e.type === 'attack');
  const apiAtk  = _events.filter(e => (e.type === 'api_attack' || e.type === 'api_pvp') && typeof e.lat === 'number');
  const apiChop = _events.filter(e => e.type === 'api_chop' && typeof e.lat === 'number');
  const kills   = _events.filter(e => e.out && e.out.killed).length;
  const deaths  = _events.filter(e => e.type === 'death').length;

  // Cooldown observado (Δ entre ataques consecutivos)
  const gaps = [];
  for (let i = 1; i < attacks.length; i++) gaps.push(attacks[i].t - attacks[i - 1].t);
  const meanGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;

  lines.push(`  ataques: ${attacks.length}` +
    (meanGap !== null ? ` · cooldown observado ~${meanGap}ms (esperado 900)` : ''));

  function latStats(arr, label) {
    if (!arr.length) return;
    const lats = arr.map(e => e.lat).sort((a, b) => a - b);
    const med = lats[Math.floor(lats.length / 2)];
    lines.push(`  latencia ${label}: min ${lats[0]} / med ${med} / max ${lats[lats.length - 1]} ms (n=${lats.length})`);
  }
  latStats(apiAtk, 'ataque');
  latStats(apiChop, 'tala');

  // Inputs perdidos: clicks (izquierdo) sin un engage/attack en la ventana siguiente.
  let lostInputs = 0;
  for (let i = 0; i < _events.length; i++) {
    const ev = _events[i];
    if (ev.type !== 'click' || ev.btn !== 0) continue;
    let resolved = false;
    for (let j = i + 1; j < _events.length; j++) {
      if (_events[j].t - ev.t > LOST_INPUT_MS) break;
      if (_events[j].type === 'engage' || _events[j].type === 'attack' || _events[j].type === 'api_chop') {
        resolved = true; break;
      }
    }
    if (!resolved) lostInputs++;
  }

  lines.push(`  kills: ${kills} · muertes: ${deaths}`);
  if (doubleFires.length) {
    lines.push(`  ⚠ ${doubleFires.length} posible(s) doble disparo:`);
    for (const d of doubleFires) lines.push(`      @ +${d.rel.trim()}s  Δ=${d.gap}ms (esperado ≥${d.expected}ms)`);
  } else {
    lines.push(`  ✓ sin dobles disparos detectados`);
  }
  if (lostInputs) {
    lines.push(`  ⚠ ${lostInputs} click(s) izq sin acción en ${LOST_INPUT_MS}ms (posible input perdido)`);
  }

  return lines.join('\n');
}

// ============================================================
// API pública
// ============================================================

function dump() {
  const report = buildReport();
  console.log(report);
  return report;
}

function tail(n = 20) {
  const slice = _events.slice(-n);
  const t0 = slice.length ? slice[0].t : 0;
  const out = slice.map((ev) => {
    const rel = ((ev.t - t0) / 1000).toFixed(3);
    return `+${rel}s  ${TYPE_LABEL[ev.type] || ev.type}  ${fmtEventDetail(ev)}`.trim();
  }).join('\n');
  console.log(out || '(sin eventos)');
  return out;
}

async function copy() {
  const report = buildReport();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(report);
      console.log('[combat_log] copiado al portapapeles ✔ — pegáselo al asistente');
    } else {
      console.log('[combat_log] clipboard no disponible; copiá manualmente de acá abajo:');
      console.log(report);
    }
  } catch (e) {
    console.warn('[combat_log] no pude copiar automáticamente; copiá del log de abajo:', e);
    console.log(report);
  }
  return report;
}

function clear() {
  _events = [];
  console.log('[combat_log] buffer vaciado');
}

export function installCombatLog() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  installHookTraps();
  installFetchWrap();
  installPointerWatch();

  // window.__combatLog es a la vez función (alias de dump) y namespace,
  // igual que el patrón de window.__wcDebug().
  const api = function () { return dump(); };
  api.dump = dump;
  api.copy = copy;
  api.clear = clear;
  api.tail = tail;
  api.start = () => { _capturing = true; console.log('[combat_log] captura ON'); };
  api.stop = () => { _capturing = false; console.log('[combat_log] captura PAUSADA'); };
  Object.defineProperty(api, 'events', { get: () => _events });

  window.__combatLog = api;

  console.log('[combat_log] activo. Jugá, rompé cosas, y luego corré __combatLog.copy() ' +
    '(o tap el botón "Combat log" en el panel de debug).');
}
