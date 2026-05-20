/**
 * SebasPresent — Health check (Sesión 31, FASE 2)
 *
 * `window.__sebasHealth()` corre un chequeo completo del estado del cliente
 * y del estado server-visible. Devuelve un objeto con cada chequeo + un
 * resultado overall ('ok' | 'warn' | 'fail').
 *
 * Ataca directamente el problema #5 del retro de S30: "asunciones sin
 * verificar". Si algo no funciona, este check te dice exactamente qué módulo
 * no se inició, qué cosa no está expuesta, qué endpoint server no responde,
 * etc — sin tener que escarbar el código.
 *
 * Uso:
 *   __sebasHealth()              → imprime tabla + retorna objeto
 *   __sebasHealth({ silent:true }) → solo retorna, no imprime
 *
 * Server-side check: por ahora skip (handoff S30→S31). Cuando exista
 * /api/_debug/version se llena la sección `server`.
 */

import { BUILD, BUILD_DATE, CLIENT_SCHEMA } from '../build.js';
import { getErrorCount, getRecentErrors } from './error_capture.js';

const REQUIRED_GLOBALS = [
  // [global, label, criticality]
  ['character',        'character (Character instance)',       'warn'],
  ['equipment',        'equipment module',                     'warn'],
  ['skills',           'skills module',                        'warn'],
  ['__snapshotDebug',  'world_snapshot debug hook',            'warn'],
  ['__playerPlayAttack', 'combat hook playAttack',             'warn'],
  ['__playerEnterCombat','combat hook enterCombat',            'warn'],
  ['__playerExitCombat', 'combat hook exitCombat',             'warn'],
  ['__wcDebug',        'woodcutting debug hook',               'info'],
  ['__diag',           'diag tools',                           'warn'],
];

const EXPECTED_SNAPSHOT_KEYS = ['now', 'players', 'npcs', 'me', 'fires', 'depleted_trees'];

function check(label, level, ok, detail) {
  return { label, level, ok: !!ok, detail: detail || '' };
}

async function checkApiBase() {
  const host = window.location.hostname;
  const url = (host === 'localhost' || host === '127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://sebaspresent.srmrpapitas.workers.dev';
  try {
    // No requiere auth — solo verificamos que el server responde algo.
    const res = await fetch(url + '/api/me', {
      headers: { 'Accept': 'application/json' },
    });
    // 401 está bien: significa "vivo, pero sin auth". 5xx no.
    if (res.status >= 500) {
      return check('api reachable', 'fail', false,
        url + ' → HTTP ' + res.status);
    }
    return check('api reachable', 'info', true,
      url + ' → HTTP ' + res.status);
  } catch (err) {
    return check('api reachable', 'fail', false,
      url + ' → ' + err.message);
  }
}

function checkSnapshot() {
  const dbg = window.__snapshotDebug;
  if (typeof dbg !== 'function') {
    return [check('snapshot.exists', 'warn', false, 'no en mundo todavía')];
  }
  const s = dbg();
  if (!s) return [check('snapshot.fresh', 'warn', false, 'snapshot null')];

  const results = [];
  for (const k of EXPECTED_SNAPSHOT_KEYS) {
    const has = (s[k] !== undefined && s[k] !== null);
    results.push(check('snapshot.key.' + k, has ? 'info' : 'warn', has,
      has ? '' : 'missing'));
  }
  const lag = s._serverLagMs ?? null;
  results.push(check('snapshot.lag', lag !== null && lag < 1500 ? 'info' : 'warn',
    lag !== null && lag < 1500, lag + ' ms'));
  return results;
}

function checkCharacter() {
  const ch = window.character;
  if (!ch) return [check('character.loaded', 'warn', false, 'no en mundo todavía')];
  const results = [];
  results.push(check('character.loaded', ch.loaded ? 'info' : 'warn', !!ch.loaded));
  results.push(check('character.mixer', 'warn', !!ch.mixer));
  results.push(check('character.group', 'warn', !!ch.group));
  const clipCount = Object.keys(ch.clips || {}).length;
  results.push(check('character.clips', clipCount > 0 ? 'info' : 'warn',
    clipCount > 0, clipCount + ' clips'));
  const boneCount = ch._boneNames?.size ?? 0;
  results.push(check('character.bones', boneCount > 10 ? 'info' : 'warn',
    boneCount > 10, boneCount + ' bones'));
  // Weapon attach refs
  results.push(check('character.rightHandBone', 'info', !!ch._rightHandBone));
  results.push(check('character.leftHandBone', 'info', !!ch._leftHandBone));
  return results;
}

function checkGlobals() {
  const results = [];
  for (const [g, label, lvl] of REQUIRED_GLOBALS) {
    const has = (typeof window[g] !== 'undefined' && window[g] !== null);
    results.push(check('global.' + g, lvl, has, has ? '' : 'missing: ' + label));
  }
  return results;
}

function checkErrors() {
  const count = getErrorCount();
  const recent = getRecentErrors(3);
  const results = [];
  results.push(check('errors.count', count === 0 ? 'info' : 'warn',
    count === 0, count + ' total'));
  for (let i = 0; i < recent.length; i++) {
    const e = recent[i];
    results.push(check('errors.recent.' + i, 'warn', false,
      '[' + e.type + '] ' + e.message.slice(0, 100)));
  }
  return results;
}

function overallFrom(results) {
  let hasFail = false, hasWarn = false;
  for (const r of results) {
    if (!r.ok) {
      if (r.level === 'fail') hasFail = true;
      else if (r.level === 'warn') hasWarn = true;
    }
  }
  if (hasFail) return 'fail';
  if (hasWarn) return 'warn';
  return 'ok';
}

/**
 * Corre todos los chequeos. Devuelve { build, results[], overall }.
 * @param {{silent?: boolean}} opts
 */
export async function runHealthCheck(opts = {}) {
  const t0 = performance.now();
  const apiResult = await checkApiBase();
  const results = [
    check('build.version', 'info', true, BUILD),
    check('build.date', 'info', true, BUILD_DATE),
    check('build.schema', 'info', true, 'v' + CLIENT_SCHEMA),
    apiResult,
    ...checkGlobals(),
    ...checkCharacter(),
    ...checkSnapshot(),
    ...checkErrors(),
  ];
  const overall = overallFrom(results);
  const elapsed = (performance.now() - t0).toFixed(1);

  if (!opts.silent) {
    const emoji = overall === 'ok' ? '✅' : overall === 'warn' ? '⚠️' : '❌';
    console.log('%c[health] ' + emoji + ' overall: ' + overall +
      ' (in ' + elapsed + 'ms, ' + results.length + ' checks)',
      'font-weight:bold;font-size:13px');
    console.table(results.map(r => ({
      check: r.label,
      ok: r.ok ? '✓' : (r.level === 'fail' ? '✗' : '○'),
      level: r.level,
      detail: r.detail,
    })));
  }

  return { build: BUILD, overall, results, elapsedMs: +elapsed };
}

let installed = false;

export function installHealthCheck() {
  if (installed) return;
  installed = true;
  window.__sebasHealth = (opts) => runHealthCheck(opts);
  console.log('[debug/health_check] installed — corré __sebasHealth() en consola');
}
