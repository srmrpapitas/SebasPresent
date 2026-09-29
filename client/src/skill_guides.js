/**
 * SebasPresent — Guías de habilidades en el libro (Sesión 50)
 *
 * Al tocar una skill en la pestaña de Stats se abre el libro (ui/book_modal.js):
 *   Página 1: tu nivel, XP, progreso y cómo se entrena.
 *   Páginas siguientes: todo lo que pertenece a la skill y a qué nivel se
 *   desbloquea (✓ ya desbloqueado / 🔒 nivel que te falta).
 *
 * Los datos salen de las mismas fuentes que usa el juego cuando es posible
 * (shared/ore_veins.js, shared/smithing.js y las recetas de la D1). Tala,
 * fuego, cocina y magia replican las tablas del server — si cambian allí,
 * actualizar aquí también.
 */

import { openBookModal } from './ui/book_modal.js';
import * as skills from './skills.js';
import * as api from './api.js';
import { getItemIconHtml, getSkillIconHtml } from './item_icons.js';
import { ORE_TIERS } from './shared/ore_veins.js';
import { SMELT, MATERIALS, MATERIAL_NAMES } from './shared/smithing.js';
import { FISH, SPOT_TYPES } from './shared/fishing.js';   // Sesión 50
import { EQUIP_LEVEL, equipRequirement } from './shared/equip_reqs.js';     // Sesión 50
import { RECIPES } from './shared/crafting.js';           // Sesión 50
import { PRAYERS } from './shared/prayer.js';

const ROWS_PER_PAGE = 7;

// ------------------------------------------------------------
// Datos (espejo de los handlers del server)
// ------------------------------------------------------------
const TREES = [
  ['Matorral', 1, 5, 'bush_leaves'], ['Arbusto', 1, 8, 'bush_leaves'], ['Árbol muerto', 1, 12, 'dead_logs'],
  ['Árbol', 1, 25, 'logs'], ['Roble', 15, 37, 'oak_logs'], ['Palmera', 20, 35, 'palm_logs'],
  ['Pino', 30, 65, 'pine_logs'], ['Sauce', 30, 67, 'willow_logs'], ['Teca', 35, 85, 'teak_logs'],
  ['Arce', 45, 100, 'maple_logs'], ['Caoba', 50, 125, 'mahogany_logs'], ['Tejo', 60, 175, 'yew_logs'],
  ['Árbol mágico', 75, 250, 'magic_logs'],
];
const LOGS = [
  ['Ramillas', 1, 5, 'bush_leaves'], ['Troncos muertos', 1, 25, 'dead_logs'], ['Troncos', 1, 40, 'logs'],
  ['Troncos de roble', 15, 60, 'oak_logs'], ['Troncos de palmera', 20, 70, 'palm_logs'],
  ['Troncos de pino', 25, 75, 'pine_logs'], ['Troncos de sauce', 30, 90, 'willow_logs'],
  ['Troncos de teca', 35, 105, 'teak_logs'], ['Troncos de arce', 45, 135, 'maple_logs'],
  ['Troncos de caoba', 50, 158, 'mahogany_logs'], ['Troncos de tejo', 60, 203, 'yew_logs'],
  ['Troncos mágicos', 75, 304, 'magic_logs'],
];
const COOKING = [
  ['Pollo cocinado', 1, 30, 'cooked_chicken', 'Cura 3 HP · crudo cura 1'],
  ['Ternera cocinada', 5, 40, 'cooked_beef', 'Cura 5 HP · cruda cura 1'],
  // Sesión 50 — pescado (shared/fishing.js)
  ...Object.values(FISH).map(f => [f.name, f.cookLevel, f.cookXp, f.cooked, `Cura ${f.heal} HP`]),
];
const SPELLS = [
  ['Rayo de fuego', 1, 'Maná 10 · daño máx. base 4'],
  ['Lanza de hielo', 20, 'Maná 9 · daño máx. base 8'],
  ['Enredar', 35, 'Maná 12 · inmoviliza al objetivo'],
  ['Rayo', 40, 'Maná 14 · daño máx. base 13'],
];

const DESCRIPTIONS = {
  attack:      'Aumenta tu probabilidad de acertar golpes cuerpo a cuerpo. Se entrena luchando con el estilo <strong>Preciso</strong> (o <strong>Controlado</strong>, que reparte la XP).',
  strength:    'Aumenta el <strong>daño máximo</strong> de tus golpes cuerpo a cuerpo. Se entrena con el estilo <strong>Agresivo</strong>.',
  defence:     'Reduce la probabilidad de que te acierten. Se entrena con el estilo <strong>Defensivo</strong> (y con arco en <em>largo alcance</em>).',
  hitpoints:   'Tu vida máxima es igual a tu nivel de Vitalidad. Sube un poco con cualquier golpe que aciertes. Fuera de combate recuperas <strong>1 HP cada 20 s</strong>; la comida cura al instante.',
  ranged:      'Combate a distancia con arco y flechas (hasta ~10 m). Cada disparo gasta una flecha; con carcaj equipado el <strong>75 %</strong> se conservan.',
  magic:       'Lanza hechizos con un bastón equipado. Cada hechizo gasta maná, que se regenera solo (más rápido con bastón).',
  prayer:      'Entierra <strong>huesos</strong> (tócalos en la mochila) para ganar XP. Tus puntos de plegaria = tu nivel; las plegarias activas los gastan y se recargan rezando en un <strong>altar</strong> (hay uno junto al Concejo y otro en el Templo de la Luz).',
  woodcutting: 'Tala árboles con un hacha para conseguir troncos. Toca un árbol y tu personaje irá hasta él. Algunos árboles dan varios troncos antes de caer.',
  fishing:     'Busca las <strong>burbujas</strong> en estanques, lagos y en la costa y tócalas para pescar. Cada banco pide una herramienta: <strong>red</strong>, <strong>caña</strong> (gasta plumas de cebo) o <strong>arpón</strong>. Los bancos se mueven cada pocos minutos.',
  mining:      'Pica vetas de mineral con un pico. Las vetas brillan con el color de su mineral y salen en el minimapa. Cuando una veta se agota, reaparece al rato.',
  cooking:     'Cocina carne y pescado crudos sobre un fuego encendido. A más nivel, menos probabilidad de quemarla.',
  firemaking:  'Enciende fuegos con un yesquero y troncos. Los fuegos duran 5 minutos y sirven para cocinar.',
  fletching:   'Con un <strong>cuchillo</strong> talla troncos en astiles y arcos. Junta 15 astiles con 15 plumas y ponles punta con un lingote para hacer flechas. Los arcos necesitan una cuerda (Artesanía). Se abre desde la mochila: toca unos troncos → <strong>🏹 Flechería</strong>.',
  crafting:    'Curte las pieles de vaca para sacar cuero y cóselo con <strong>aguja</strong> e <strong>hilo</strong> para hacer armadura de cuero (buena para Distancia), cuerdas de arco y carcajes. Toca el cuero en la mochila → <strong>🧵 Artesanía</strong>. Aguja, hilo y cuchillo están en la tienda general.',
  smithing:    'Funde mineral en el <strong>horno</strong> para obtener lingotes, y forja armaduras en el <strong>yunque</strong>. Hay horno y yunque junto a la Cantera del Concejo (al noreste del spawn) y en la Mina Antigua.',
};

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function ensureCss() {
  if (document.getElementById('skill-guide-css')) return;
  const st = document.createElement('style');
  st.id = 'skill-guide-css';
  st.textContent = `
    .sg-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .sg-head .sg-ico { width: 40px; height: 40px; font-size: 30px; display: flex; align-items: center; justify-content: center; }
    .sg-head .sg-ico svg { width: 40px; height: 40px; }
    .sg-lvl { font-size: 26px; font-weight: 900; color: #f0d878; }
    .sg-bar { height: 10px; background: rgba(0,0,0,0.45); border: 1px solid #7a6030; border-radius: 5px; overflow: hidden; margin: 6px 0 2px; }
    .sg-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #6aa84f, #c8e070); }
    .sg-muted { font-size: 12px; color: #b8a880; }
    .sg-row { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-bottom: 1px solid rgba(200,160,67,0.15); }
    .sg-row.lock { opacity: 0.55; }
    .sg-badge { flex: 0 0 44px; text-align: center; font-size: 12px; font-weight: 700; border-radius: 4px; padding: 3px 0; }
    .sg-row.ok .sg-badge { background: rgba(80,150,60,0.35); color: #b8f090; border: 1px solid #5a9a3a; }
    .sg-row.lock .sg-badge { background: rgba(0,0,0,0.35); color: #d8c89a; border: 1px solid #6a5530; }
    .sg-i { flex: 0 0 30px; height: 30px; font-size: 20px; display: flex; align-items: center; justify-content: center; }
    .sg-i svg { width: 28px; height: 28px; }
    .sg-t { flex: 1; min-width: 0; line-height: 1.2; }
    .sg-t b { display: block; font-size: 14px; color: #fff0c8; }
    .sg-t small { font-size: 11px; color: #b8a880; }
  `;
  document.head.appendChild(st);
}

/** rows: [{ level, name, detail, icon? (html) }] */
function unlockPages(title, rows, myLevel) {
  const sorted = rows.slice().sort((a, b) => a.level - b.level);
  const pages = [];
  for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
    const chunk = sorted.slice(i, i + ROWS_PER_PAGE);
    const part = sorted.length > ROWS_PER_PAGE ? ` (${Math.floor(i / ROWS_PER_PAGE) + 1}/${Math.ceil(sorted.length / ROWS_PER_PAGE)})` : '';
    let html = `<h2>${esc(title)}${part}</h2>`;
    for (const r of chunk) {
      const ok = myLevel >= r.level;
      html += `<div class="sg-row ${ok ? 'ok' : 'lock'}">
        <span class="sg-badge">${ok ? '✓' : '🔒'} ${r.level}</span>
        <span class="sg-i">${r.icon || ''}</span>
        <span class="sg-t"><b>${esc(r.name)}</b><small>${esc(r.detail || '')}</small></span>
      </div>`;
    }
    pages.push({ content: html });
  }
  return pages;
}

function overviewPage(skillId) {
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  const level = skills.getLevel(skillId);
  const xp = skills.getXp(skillId);
  const next = level < 99 ? skills.levelToXp(level + 1) : null;
  const cur = skills.levelToXp(level);
  const pct = next ? Math.min(100, Math.floor(((xp - cur) / (next - cur)) * 100)) : 100;
  return {
    content: `
      <div class="sg-head"><span class="sg-ico">${getSkillIconHtml(def.id, def.icon)}</span>
        <div><div class="sg-lvl">Nivel ${level}<span class="sg-muted"> / 99</span></div>
        <div class="sg-muted">${xp.toLocaleString('es-ES')} XP</div></div></div>
      <div class="sg-bar"><i style="width:${pct}%"></i></div>
      <div class="sg-muted">${next ? `Faltan <strong>${(next - xp).toLocaleString('es-ES')} XP</strong> para el nivel ${level + 1} (${pct}%)` : '⭐ Nivel máximo ⭐'}</div>
      <h3 style="margin-top:14px">¿Qué es?</h3>
      <p>${DESCRIPTIONS[skillId] || ''}</p>
      <p class="sg-muted">▶ Pasa la página para ver qué desbloqueas y a qué nivel.</p>`,
  };
}

function icon(itemId, emoji) { return getItemIconHtml(itemId, emoji || '•'); }

async function buildUnlocks(skillId, lvl) {
  switch (skillId) {
    case 'woodcutting':
      return [
        ...unlockPages('Herramientas', [{ level: 1, name: 'Hacha de bronce', detail: 'Necesaria para talar', icon: icon('axe_bronze', '🪓') }], lvl),
        ...unlockPages('Árboles', TREES.map(([n, l, xp, item]) => ({ level: l, name: n, detail: `${xp} XP por tronco`, icon: icon(item, '🌳') })), lvl),
      ];
    case 'firemaking':
      return unlockPages('Troncos que puedes quemar', LOGS.map(([n, l, xp, item]) => ({ level: l, name: n, detail: `${xp} XP · necesitas yesquero`, icon: icon(item, '🪵') })), lvl);
    case 'cooking':
      return unlockPages('Recetas', COOKING.map(([n, l, xp, item, d]) => ({ level: l, name: n, detail: `${xp} XP · ${d}`, icon: icon(item, '🍗') })), lvl)
        .concat([{ content: `<h2>Quemar comida</h2><p>Al nivel justo de una receta tienes un <strong>50 %</strong> de quemarla. Cada nivel por encima baja un <strong>2,5 %</strong>: a 20 niveles por encima ya no se quema nunca.</p>` }]);
    case 'mining':
      return [
        ...unlockPages('Herramientas', [{ level: 1, name: 'Pico de bronce', detail: 'Necesario para picar', icon: icon('pickaxe_bronze', '⛏️') }], lvl),
        ...unlockPages('Vetas de mineral', Object.values(ORE_TIERS).map(t => ({
          level: t.level, name: t.name, detail: `${t.xp} XP · reaparece en ${Math.round(t.respawnMs / 1000)} s`, icon: icon(t.oreItem, '🪨'),
        })), lvl),
        { content: `<h2>Dónde encontrarlas</h2><ul>
            <li><strong>Bronce</strong> — Llanuras y la Cantera del Concejo (NE del spawn)</li>
            <li><strong>Hierro</strong> — Bosques y pantano</li>
            <li><strong>Acero</strong> — Tundra nevada y la Mina Antigua</li>
            <li><strong>Oro</strong> — Desierto, selva y la Mina Antigua</li>
            <li><strong>Obsidiana, Basaltita, Teiderio</strong> — Tierras Rotas (wilderness), cuanto más al fondo, mejor</li></ul>
            <p class="sg-muted">Las vetas salen en el minimapa con el color de su mineral.</p>` },
      ];
    case 'fishing': {
      const toolFor = { net: 'small_net', rod: 'fishing_rod', harpoon: 'harpoon' };
      const toolName = { net: 'red', rod: 'caña + plumas', harpoon: 'arpón' };
      const byFish = {};
      for (const [tid, T] of Object.entries(SPOT_TYPES)) for (const f of T.fish) byFish[f] ||= T.tool;
      return [
        ...unlockPages('Herramientas', [
          { level: 1,  name: 'Red pequeña', detail: 'Gambas · estanques y costa', icon: icon('small_net', '🥅') },
          { level: 5,  name: 'Caña de pescar', detail: 'Ríos y lagos · usa plumas como cebo', icon: icon('fishing_rod', '🎣') },
          { level: 35, name: 'Arpón', detail: 'Peces grandes · costa y lagos', icon: icon('harpoon', '🔱') },
        ], lvl),
        ...unlockPages('Peces', Object.entries(FISH).map(([id, f]) => ({
          level: f.level, name: f.name, detail: `${f.xp} XP · ${toolName[byFish[id]] || ''} · cocinado cura ${f.heal}`, icon: icon(id, '🐟'),
        })), lvl),
        { content: `<h2>Dónde pescar</h2><ul>
            <li><strong>Estanque del Concejo</strong> — al suroeste del spawn: gambas, sardina, arenque, trucha, salmón</li>
            <li><strong>Laguna del Pantano</strong> — igual que el estanque</li>
            <li><strong>Lago de Verdis</strong> (selva) — peces de río y atún / pez espada</li>
            <li><strong>Lago Helado</strong> (tundra) — atún y pez espada con arpón</li>
            <li><strong>Costa del Sur</strong> — gambas y peces grandes en la orilla de la playa</li>
            <li><strong>Costa de las Tierras Rotas</strong> — ☠ aguas profundas: <strong>tiburón</strong> (nivel 76)</li></ul>
            <p class="sg-muted">Los lagos salen en azul en el minimapa y los bancos activos como puntitos celestes.</p>` },
      ];
    }
    case 'smithing': {
      const pages = unlockPages('Horno: lingotes', MATERIALS.map(m => ({
        level: SMELT[m].level, name: `Lingote de ${MATERIAL_NAMES[m]}`, detail: `1 mineral · ${SMELT[m].xp} XP`, icon: icon(`bar_${m}`, '🧱'),
      })), lvl);
      try {
        const r = await api.smithingRecipes();
        const rows = (r?.smith || []).map(it => ({
          level: it.level, name: it.name,
          detail: `${it.bars} lingote${it.bars > 1 ? 's' : ''} · ${it.xp} XP${it.defence_bonus ? ` · +${it.defence_bonus} def` : ''}${it.attack_bonus ? ` · +${it.attack_bonus} atq` : ''}`,
          icon: icon(it.id, it.icon),
        }));
        pages.push(...unlockPages('Yunque: armaduras', rows, lvl));
      } catch { /* sin conexión: solo horno */ }
      return pages;
    }
    case 'prayer':
      return unlockPages('Plegarias', PRAYERS.map(p => ({ level: p.level, name: p.name, detail: `${p.desc} · ${p.drain} pts/min`, icon: p.icon })), lvl)
        .concat([{ content: `<h2>Huesos</h2><p><strong>Huesos</strong>: 5 XP cada uno. Los sueltan casi todos los monstruos.</p><p class="sg-muted">Solo puedes tener activa una plegaria de cada tipo (una de Defensa, una de Fuerza...).</p>` }]);
    case 'magic':
      return unlockPages('Hechizos', SPELLS.map(([n, l, d]) => ({ level: l, name: n, detail: d, icon: '✨' })), lvl)
        .concat([{ content: `<h2>Maná</h2><p>Tu maná máximo crece con tu nivel de Magia; con bastón equipado tienes <strong>+100</strong> y se regenera más rápido.</p>` }]);
    case 'strength': {
      const rows = [1, 7, 17, 27, 37, 47, 57, 67, 77, 87, 97].map(l => ({
        level: l, name: `Golpe máximo ${Math.floor((l + 13) / 10)}`, detail: 'Con arma de una mano · espadón ×1,5', icon: '💥',
      }));
      return unlockPages('Daño máximo', rows, lvl);
    }
    case 'defence': {
      const sets = MATERIALS.map((m, i) => ({
        level: EQUIP_LEVEL[m], name: `Armadura de ${MATERIAL_NAMES[m]}`,
        detail: `Se forja con Herrería nv ${SMELT[m].level}`, icon: icon(m === 'bronze' ? 'chest_bronze' : `body_${m}`, '🛡'),
      }));
      const DEF = [3, 6, 9, 12, 15, 18, 21];
      const shields = MATERIALS.map((m, i) => ({
        level: EQUIP_LEVEL[m], name: `Escudo de ${MATERIAL_NAMES[m]}`,
        detail: `+${DEF[i]} defensa · Herrería ${SMELT[m].level + 2} (2 lingotes)`, icon: icon(`shield_${m}`, '🛡'),
      }));
      return [...unlockPages('Armaduras', sets, lvl), ...unlockPages('Escudos', shields, lvl)];
    }
    case 'attack':
      {
        // Sesión 50 — espadas de los 7 materiales (se forjan en el yunque)
        const A1 = [4, 8, 12, 16, 21, 26, 32], A2 = [8, 15, 22, 30, 39, 48, 58];
        const rows = [];
        MATERIALS.forEach((m, i) => {
          const n = MATERIAL_NAMES[m];
          rows.push({ level: EQUIP_LEVEL[m], name: `Espada de ${n}`, detail: `+${A1[i]} ataque · una mano · Herrería ${SMELT[m].level}`, icon: icon(`sword_${m}`, '⚔️') });
          rows.push({ level: EQUIP_LEVEL[m], name: `Espadón de ${n}`, detail: `+${A2[i]} ataque · dos manos · ×1,5 daño, 25 % crítico · Herrería ${SMELT[m].level + 4}`, icon: icon(`sword_${m}_2h`, '⚔') });
        });
        return unlockPages('Armas', rows, lvl);
      }
    case 'fletching':
    case 'crafting': {
      const groups = {};
      for (const r of RECIPES.filter(x => x.skill === skillId)) (groups[r.group] ||= []).push(r);
      const pages = [];
      for (const [g, rs] of Object.entries(groups)) {
        pages.push(...unlockPages(g, rs.map(r => ({
          level: r.level, name: r.name, detail: `${r.xp} XP · ${r.in.map(([id, q]) => `${q} ${id.replace(/_/g, ' ')}`).join(' + ')}`,
          icon: icon(r.out[0], '🛠'),
        })), lvl));
      }
      return pages;
    }
    case 'ranged':
      return unlockPages('Equipo', [
        ...['bow_oak', 'bow_willow', 'bow_maple', 'bow_yew', 'bow_magic'].map((id, i) => ({
          level: equipRequirement({ id, equip_slot: 'weapon', weapon_type: 'bow' })?.level || 1,
          name: ['Arco de roble', 'Arco de sauce', 'Arco de arce', 'Arco de tejo', 'Arco mágico'][i],
          detail: `+${[7, 12, 18, 26, 35][i]} distancia · se fabrica con Flechería`, icon: icon(id, '🏹'),
        })),
        { level: 1, name: 'Armadura de cuero', detail: 'Artesanía · algo de defensa y +distancia', icon: icon('body_cuero', '🛡') },
        { level: 1, name: 'Arco normal', detail: 'Dos manos · alcance ~10 m', icon: icon('bow_normal', '🏹') },
        { level: 1, name: 'Flecha de bronce', detail: 'Munición', icon: icon('arrow_bronze', '➳') },
        { level: 1, name: 'Carcaj de bronce', detail: 'Guarda flechas · conserva el 75 %', icon: icon('quiver_bronze', '🎯') },
      ], lvl);
    default:
      return [];
  }
}

/** Abre el libro de una skill. */
export async function openSkillGuide(skillId) {
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  if (!def) return;
  ensureCss();
  const lvl = skills.getLevel(skillId);
  let extra = [];
  try { extra = await buildUnlocks(skillId, lvl); } catch (e) { console.warn('[skill_guides]', e); }
  openBookModal({ title: def.name, pages: [overviewPage(skillId), ...extra] });
}

if (typeof window !== 'undefined') window.__skillGuide = openSkillGuide;
