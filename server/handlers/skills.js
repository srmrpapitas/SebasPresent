/**
 * SebasPresent — Skills handlers (Sesión 14)
 *
 * Endpoints:
 *   GET  /api/skills            → todos los skills del player
 *   POST /api/skills/grant      → suma XP a un skill (server-validated)
 *
 * Patrón sigue handlers/bank.js: requireSession, batch updates, json().
 *
 * Anti-cheat:
 *   /grant valida que skill_id y delta_xp sean razonables (delta entre 1
 *   y 10000 por llamada). El cliente NUNCA decide cuánto XP gana — eso
 *   se delegará a handlers específicos de skilling (woodcutting, combat,
 *   etc.) que llamarán internamente a grantXp con valores hardcodeados.
 *   Por ahora /grant existe para testing y será deprecated cuando los
 *   skilling handlers estén listos.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import {
  SKILLS, SKILLS_BY_ID, applyXpGrant, xpToLevel, levelToXp, startingXpFor,
  totalLevel, combatLevel, MAX_XP,
} from '../lib/skills_engine.js';

const MAX_DELTA_PER_GRANT = 10000;

/**
 * Devuelve el estado completo de skills del player. Si el player aún
 * no tiene filas en user_skills (cuenta antigua creada antes de sesión
 * 14), las crea con XP inicial.
 */
export async function handleGetSkills(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const userId = session.user_id;

  const rows = await env.DB.prepare(
    'SELECT skill_id, xp FROM user_skills WHERE user_id = ?'
  ).bind(userId).all();

  const xpById = {};
  for (const r of (rows.results || [])) {
    xpById[r.skill_id] = r.xp;
  }

  // Si faltan skills (cuenta antigua), backfill.
  const missing = SKILLS.filter(s => xpById[s.id] === undefined);
  if (missing.length > 0) {
    const now = Date.now();
    const stmts = missing.map(s => {
      const xp = startingXpFor(s.id);
      xpById[s.id] = xp;
      return env.DB.prepare(
        'INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, ?)'
      ).bind(userId, s.id, xp, now);
    });
    await env.DB.batch(stmts);
  }

  // Compose response
  const skills = SKILLS.map(def => {
    const xp = xpById[def.id] || 0;
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      xp,
      level: xpToLevel(xp),
      next_level_xp: def.id && xpToLevel(xp) < 99 ? levelToXp(xpToLevel(xp) + 1) : null,
    };
  });

  const xpMap = Object.fromEntries(skills.map(s => [s.id, xpToLevel(s.xp)]));
  return json({
    skills,
    total_level: totalLevel(xpById),
    combat_level: combatLevel(xpMap),
  });
}

/**
 * Suma XP a un skill. Body: { skill_id: string, xp: number }.
 * Validaciones:
 *   - skill_id existe en SKILLS
 *   - xp es entero positivo ≤ MAX_DELTA_PER_GRANT
 *   - el row de user_skills existe (sino lo crea)
 *
 * Respuesta: { ok, skill_id, xp, level, level_up, levels_gained, prev_level }
 */
export async function handleGrantXp(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const skillId = body.skill_id;
  const delta = body.xp;

  if (typeof skillId !== 'string' || !SKILLS_BY_ID[skillId]) {
    return json({ error: 'invalid_skill', message: `skill_id desconocido: ${skillId}` }, 400);
  }
  if (!Number.isInteger(delta) || delta < 1 || delta > MAX_DELTA_PER_GRANT) {
    return json({
      error: 'invalid_xp',
      message: `xp debe ser entero entre 1 y ${MAX_DELTA_PER_GRANT}.`,
    }, 400);
  }

  const userId = session.user_id;
  const now = Date.now();

  const row = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, skillId).first();

  const currentXp = row ? row.xp : startingXpFor(skillId);
  const prevLevel = xpToLevel(currentXp);
  const result = applyXpGrant(currentXp, delta);

  if (row) {
    await env.DB.prepare(
      'UPDATE user_skills SET xp = ?, updated_at = ? WHERE user_id = ? AND skill_id = ?'
    ).bind(result.newXp, now, userId, skillId).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, skillId, result.newXp, now).run();
  }

  return json({
    ok: true,
    skill_id: skillId,
    xp: result.newXp,
    level: result.newLevel,
    prev_level: prevLevel,
    level_up: result.levelUp,
    levels_gained: result.levelsGained,
  });
}

/**
 * Inicializa los 13 skills de un usuario nuevo. Llamado desde handleRegister.
 * Export para que auth.js lo use sin duplicar lógica.
 */
export async function initSkillsForNewUser(env, userId) {
  const now = Date.now();
  const stmts = SKILLS.map(def =>
    env.DB.prepare(
      'INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, def.id, startingXpFor(def.id), now)
  );
  await env.DB.batch(stmts);
}
