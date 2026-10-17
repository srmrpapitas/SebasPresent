/**
 * SebasPresent — Tareas diarias (cliente) · Sesión 53
 *
 * Las filas llegan con las misiones (snapshot.me.quests y respuestas de
 * /api/quests): 'daily_1..3' (step = día) y 'daily_racha'. Aquí solo se
 * pintan y se celebran; quien cuenta y paga es el servidor.
 */
import { DAILY_SLOTS, DAILY_STREAK_ID, dayNumber, dailiesFor, msToNextDay, dailyXp, dailyBonus, isDailyId } from './shared/dailies.js';
import { SKILL_DEFS_BY_ID } from './skills.js';

let rows = {};          // quest_id → { step, progress, status }
let seen = false;
let lastDay = null;

export { isDailyId };

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * Aplica filas del servidor. Devuelve true si cambió algo.
 * `fx` = { feedLog, celebrate, onDone } para avisar (solo si announce).
 */
export function applyRows(list, announce, fx = {}, now = Date.now()) {
  let changed = false;
  const today = dayNumber(now);
  for (const r of list || []) {
    if (!isDailyId(r.quest_id)) continue;
    const prev = rows[r.quest_id];
    if (prev && prev.step === r.step && prev.progress === r.progress && prev.status === r.status) continue;
    rows[r.quest_id] = { step: r.step, progress: r.progress, status: r.status };
    changed = true;
    if (!announce || !seen || !prev) continue;
    if (r.quest_id === DAILY_STREAK_ID) {
      if (r.step === today && (prev.step !== r.step)) {
        const b = dailyBonus(r.progress);
        fx.feedLog?.('info', `🎉 ¡Las 3 tareas de hoy hechas! Racha: ${r.progress} ${r.progress === 1 ? 'día' : 'días'} · +${b.coins.toLocaleString('es-ES')} monedas${b.items.length ? ' · 3 pociones de plegaria' : ''}`);
        fx.celebrate?.(`🎉 ¡Diarias completas! Racha ${r.progress}`);
        fx.onDone?.();
      }
      continue;
    }
    if (r.step !== today) continue;
    const t = dailiesFor(today).find(x => x.slot === r.quest_id);
    if (!t) continue;
    if (r.status === 1 && prev.status !== 1) {
      fx.feedLog?.('info', `📅 Tarea diaria hecha: ${t.text} (+${t.coins} monedas y XP de ${SKILL_DEFS_BY_ID[t.skill]?.name || t.skill})`);
      fx.celebrate?.(`📅 ${t.text} ✔`);
      fx.onDone?.();
    } else if (r.progress > (prev.step === r.step ? prev.progress : 0) && (r.progress % 5 === 0)) {
      fx.feedLog?.('info', `📅 ${t.text}: ${r.progress}/${t.count}`);
    }
  }
  seen = true;
  return changed;
}

/** Filas del snapshot que han cambiado (para no repintar si no hace falta). */
export function differs(list) {
  for (const r of list || []) {
    if (!isDailyId(r.quest_id)) continue;
    const p = rows[r.quest_id];
    if (!p || p.step !== r.step || p.progress !== r.progress || p.status !== r.status) return true;
  }
  return false;
}

/** ¿Cambió el día desde la última vez? (para pedir las filas nuevas una vez). */
export function dayChanged(now) {
  const d = dayNumber(now);
  if (lastDay == null) { lastDay = d; return false; }
  if (d !== lastDay) { lastDay = d; return true; }
  return false;
}

export function streakNow(now = Date.now()) {
  const s = rows[DAILY_STREAK_ID];
  const today = dayNumber(now);
  if (!s || !s.progress) return 0;
  return (s.step === today || s.step === today - 1) ? s.progress : 0;
}

/** Estado de hoy: [{ task, progress, done }] */
export function today(now = Date.now()) {
  const day = dayNumber(now);
  return dailiesFor(day).map(t => {
    const r = rows[t.slot];
    const cur = r && r.step === day;
    return { task: t, progress: cur ? Math.min(r.progress, t.count) : 0, done: !!(cur && r.status === 1) };
  });
}

function fmtLeft(ms) {
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Tarjeta para la pestaña de misiones. */
export function cardHtml(now = Date.now(), levels = {}) {
  if (!Object.keys(rows).length) return '';
  const list = today(now);
  const nDone = list.filter(x => x.done).length;
  const streak = streakNow(now);
  const sr = rows[DAILY_STREAK_ID];
  const nextStreak = (sr && sr.step === dayNumber(now) - 1) ? sr.progress + 1 : 1;   // racha si hoy haces las 3
  const bonus = dailyBonus(nextStreak);
  let h = `<div class="qd-card"><div class="qd-head"><b>📅 Tareas de hoy</b> <span>${nDone}/3</span></div>`;
  for (const x of list) {
    const pct = Math.round(100 * x.progress / x.task.count);
    const xp = dailyXp(levels[x.task.skill] || 1);
    h += `<div class="qd-row${x.done ? ' done' : ''}">
      <div class="qd-t">${x.task.icon} ${esc(x.task.text)} <span>${x.done ? '✔' : `${x.progress}/${x.task.count}`}</span></div>
      <div class="qd-bar"><i style="width:${pct}%"></i></div>
      <div class="qd-r">🎁 ${x.task.coins} monedas · ${xp.toLocaleString('es-ES')} XP de ${esc(SKILL_DEFS_BY_ID[x.task.skill]?.name || x.task.skill)}</div>
    </div>`;
  }
  h += `<div class="qd-foot">${nDone === 3
    ? `✅ ¡Hechas! Vuelven en <b>${fmtLeft(msToNextDay(now))}</b>.`
    : `Las 3: <b>+${bonus.coins.toLocaleString('es-ES')} monedas</b>${bonus.items.length ? ' y 3 pociones' : ''}. Cambian en ${fmtLeft(msToNextDay(now))}.`}
    ${streak ? `<br>🔥 Racha: <b>${streak} ${streak === 1 ? 'día' : 'días'}</b> (premio mayor hasta 7; cada 7 días, pociones)` : ''}</div></div>`;
  return h;
}

export const CSS = `
  .qd-card{margin:6px 0 8px;padding:7px 8px;border:1px solid rgba(232,197,96,.45);border-radius:8px;background:linear-gradient(180deg,rgba(60,44,18,.85),rgba(30,22,10,.85));}
  .qd-head{display:flex;justify-content:space-between;color:#ffd77a;font-size:13px;margin-bottom:4px}
  .qd-row{margin:5px 0}
  .qd-t{display:flex;justify-content:space-between;gap:6px;font-size:12px;color:#f3e6c4}
  .qd-t span{color:#e8c560;font-variant-numeric:tabular-nums;white-space:nowrap}
  .qd-row.done .qd-t{color:#8fd88f}
  .qd-bar{height:6px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;margin-top:2px}
  .qd-bar i{display:block;height:100%;background:linear-gradient(90deg,#c8a043,#ffd35a)}
  .qd-row.done .qd-bar i{background:linear-gradient(90deg,#3f9a3f,#7fe07f)}
  .qd-r{font-size:10.5px;color:#bba77a;margin-top:1px}
  .qd-foot{font-size:11px;color:#d9c79a;margin-top:6px;line-height:1.35}
`;

export const _debug = () => ({ rows, slots: DAILY_SLOTS });
