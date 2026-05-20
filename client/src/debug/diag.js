/**
 * SebasPresent — Diag (Sesión 31, FASE 2)
 *
 * Conjunto de funciones reusables expuestas en `window.__diag` para depurar
 * desde la consola de Eruda. Todas son síncronas (excepto forceCallApi que
 * devuelve una promise) y no rompen si el estado del juego no está listo
 * (devuelven null o avisan con console.warn).
 *
 * API expuesta (window.__diag.X):
 *   printBones()              — lista bones del char con flag isBone + posY
 *   printTracks(clipName)     — tracks del clip + cuántos matchean al esqueleto
 *   printEquipment()          — slots equipados (weapon, body, helm, ...)
 *   printSnapshot()           — último snapshot recibido
 *   dumpCharacterState()      — pos, anim activa, weapon, _gathering*, isDead
 *   forceCallApi(path, body?) — fetch a la API con auth automático
 *   forceChop(treeType, x, z) — delega a __wcDebug.forceChop si existe
 *   forceLightFire(slotIdx)   — delega a __fmDebug si existe (S30+)
 *   enableVerboseLogs()       — activa console.debug y console.log en Eruda
 *   testError()               — fuerza un error para probar error_capture
 *
 * Ejemplo:
 *   __diag.dumpCharacterState()
 *   __diag.forceCallApi('/api/me')
 *   __diag.printTracks('Idle')
 */

import { pushError } from './error_capture.js';

// ============================================================
// Helpers internos
// ============================================================

function getCharacter() {
  return (typeof window !== 'undefined') ? (window.character || null) : null;
}

function getApiBase() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8787';
  return 'https://sebaspresent.srmrpapitas.workers.dev';
}

function getToken() {
  try { return localStorage.getItem('sebaspresent.token'); } catch { return null; }
}

// ============================================================
// printBones — lista bones con flag isBone, y posición Y
// ============================================================

function printBones() {
  const ch = getCharacter();
  if (!ch || !ch.mesh) {
    console.warn('[diag] no character loaded yet');
    return null;
  }
  const rows = [];
  const tmp = { x: 0, y: 0, z: 0 };
  ch.mesh.traverse((obj) => {
    if (!obj.name) return;
    obj.getWorldPosition?.(tmp);
    rows.push({
      name: obj.name,
      isBone: !!obj.isBone,
      type: obj.type,
      worldY: +Number(tmp.y || 0).toFixed(3),
    });
  });
  rows.sort((a, b) => a.worldY - b.worldY);
  console.table(rows);
  console.log('[diag] total nodos con nombre:', rows.length,
    'bones (isBone):', rows.filter(r => r.isBone).length);
  return rows;
}

// ============================================================
// printTracks — tracks de un clip + cuántos matchean al esqueleto
// ============================================================

function printTracks(clipName) {
  const ch = getCharacter();
  if (!ch) { console.warn('[diag] no character'); return null; }
  if (!clipName) {
    const names = Object.keys(ch.clips || {});
    console.log('[diag] clips disponibles:', names);
    return names;
  }
  const clip = ch.clips?.[clipName];
  if (!clip) {
    console.warn('[diag] clip no encontrado:', clipName,
      '— disponibles:', Object.keys(ch.clips || {}));
    return null;
  }
  const boneNames = ch._boneNames || new Set();
  const rows = clip.tracks.map((t) => {
    // Track name suele ser "BoneName.position" o "BoneName.quaternion"
    const dotIdx = t.name.indexOf('.');
    const bone = dotIdx >= 0 ? t.name.substring(0, dotIdx) : t.name;
    const prop = dotIdx >= 0 ? t.name.substring(dotIdx + 1) : '';
    return {
      bone,
      prop,
      matches: boneNames.has(bone),
      valueSize: t.getValueSize?.() ?? 0,
    };
  });
  const matched = rows.filter(r => r.matches).length;
  const pct = rows.length > 0 ? Math.round((matched / rows.length) * 100) : 0;
  console.log('[diag] clip:', clipName,
    '— tracks:', rows.length,
    '— match:', matched + ' (' + pct + '%)',
    pct < 60 ? '⚠️ LOW MATCH — anim puede verse rota' : '✅ ok');
  console.table(rows);
  return { clipName, total: rows.length, matched, pct, tracks: rows };
}

// ============================================================
// printEquipment — slots equipados
// ============================================================

function printEquipment() {
  const eq = window.equipment;
  if (!eq) { console.warn('[diag] equipment no expuesto todavía'); return null; }
  const slots = (typeof eq.getSlots === 'function') ? eq.getSlots() : null;
  if (!slots) {
    console.warn('[diag] equipment.getSlots() no existe — usando getEquipped?()');
    const alt = (typeof eq.getEquipped === 'function') ? eq.getEquipped() : null;
    console.log('[diag] equipment (alt):', alt);
    return alt;
  }
  console.table(Object.entries(slots).map(([slot, item]) => ({
    slot,
    item_id: item?.item_id || '—',
    weapon_type: item?.weapon_type || '—',
    name: item?.name || item?.item_id || '—',
  })));
  return slots;
}

// ============================================================
// printSnapshot — último snapshot
// ============================================================

function printSnapshot() {
  const dbg = window.__snapshotDebug;
  if (!dbg) { console.warn('[diag] __snapshotDebug no expuesto todavía'); return null; }
  const s = dbg();
  if (!s) { console.warn('[diag] snapshot no recibido aún'); return null; }
  console.log('[diag] snapshot keys:', Object.keys(s));
  console.log('[diag] players:', s.players?.length, '| npcs:', s.npcs?.length,
    '| fires:', s.fires?.length, '| depleted_trees:', s.depleted_trees?.length,
    '| lag:', s._serverLagMs + 'ms');
  return s;
}

// ============================================================
// dumpCharacterState — pos, anim activa, weapon, _gathering*, isDead
// ============================================================

function dumpCharacterState() {
  const ch = getCharacter();
  if (!ch) { console.warn('[diag] no character'); return null; }
  const pos = ch.group?.position || { x: 0, y: 0, z: 0 };
  const currentAction = ch.current || null;
  const currentClip = currentAction?.getClip?.();
  const state = {
    loaded: !!ch.loaded,
    pos: { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3) },
    activeAnim: currentClip?.name || null,
    activeAnimDur: currentClip ? +currentClip.duration.toFixed(2) : null,
    weight: currentAction?.getEffectiveWeight?.() ?? null,
    timeScale: currentAction?.getEffectiveTimeScale?.() ?? null,
    weapon: {
      id: ch._equippedWeaponId || null,
      hand: ch._equippedWeaponHand || null,
      hasMesh: !!ch._equippedWeaponMesh,
    },
    flags: {
      combatStance: !!ch.combatStance,
      isAttacking: !!ch.isAttacking,
      isInTransition: !!ch.isInTransition,
      isDead: !!ch.isDead,
      gatheringActive: !!ch._gatheringActive,
      gatherAnimName: ch._gatherAnimName || null,
    },
    boneCount: ch._boneNames?.size ?? 0,
    clipCount: Object.keys(ch.clips || {}).length,
  };
  console.log('[diag] character state:');
  console.log(state);
  return state;
}

// ============================================================
// forceCallApi — fetch directo a la API con auth
// ============================================================

async function forceCallApi(path, body) {
  const base = getApiBase();
  const token = getToken();
  if (!path.startsWith('/')) path = '/' + path;
  const method = body !== undefined ? 'POST' : 'GET';
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  console.log('[diag] →', method, base + path, body !== undefined ? body : '');
  try {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    console.log('[diag] ←', res.status, data);
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    console.error('[diag] fetch failed:', err);
    return { status: 0, ok: false, error: err.message };
  }
}

// ============================================================
// forceChop — delega al __wcDebug si existe
// ============================================================

function forceChop(treeType, x, z) {
  if (!window.__wcDebug?.forceChop) {
    console.warn('[diag] __wcDebug.forceChop no existe — woodcutting no inicializado o no en mundo');
    return null;
  }
  return window.__wcDebug.forceChop(treeType, x, z);
}

// ============================================================
// forceLightFire — delega al __fmDebug si existe (S30+)
// ============================================================

function forceLightFire(slotIdx) {
  const fm = window.__fmDebug;
  if (!fm) {
    console.warn('[diag] __fmDebug no expuesto — firemaking puede que no esté iniciado todavía');
    return null;
  }
  if (typeof fm.forceLight === 'function') return fm.forceLight(slotIdx);
  if (typeof fm.light === 'function')      return fm.light(slotIdx);
  console.warn('[diag] __fmDebug existe pero sin forceLight/light. Keys:', Object.keys(fm));
  return null;
}

// ============================================================
// enableVerboseLogs — placeholder, por ahora solo confirma
// ============================================================

function enableVerboseLogs() {
  if (typeof window !== 'undefined') window.__VERBOSE = true;
  console.log('[diag] verbose logs ON (window.__VERBOSE = true). ' +
    'Módulos que respetan este flag van a imprimir más detalle.');
}

// ============================================================
// testError — fuerza un error para probar error_capture
// ============================================================

function testError() {
  pushError({
    type: 'manual_test',
    message: 'Error de prueba forzado desde __diag.testError()',
    source: 'diag.js',
  });
  console.log('[diag] error de prueba registrado — chequear panel de errores en overlay');
}

// ============================================================
// Install
// ============================================================

let installed = false;

export function installDiag() {
  if (installed) return;
  installed = true;
  const diag = {
    printBones,
    printTracks,
    printEquipment,
    printSnapshot,
    dumpCharacterState,
    forceCallApi,
    forceChop,
    forceLightFire,
    enableVerboseLogs,
    testError,
  };
  window.__diag = diag;
  console.log('[debug/diag] installed — usá __diag.dumpCharacterState() en consola');
}
