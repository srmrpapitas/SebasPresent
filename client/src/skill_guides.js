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

import * as audio from './audio.js';
import * as skills from './skills.js';
import * as api from './api.js';
import { getItemIconHtml, getSkillIconHtml } from './item_icons.js';
import { ORE_TIERS } from './shared/ore_veins.js';
import { SMELT, MATERIALS, MATERIAL_NAMES } from './shared/smithing.js';
import { FISH, SPOT_TYPES } from './shared/fishing.js';   // Sesión 50
import { EQUIP_LEVEL, equipRequirement, hasSpecialAttack, WEAPON_SPECS } from './shared/equip_reqs.js';     // Sesión 50
import { RECIPES } from './shared/crafting.js';           // Sesión 50
import { TABLETS } from './shared/teleports.js';          // Sesión 50
import { QUESTS } from './shared/quests.js';              // Sesión 50
import { PRAYERS } from './shared/prayer.js';


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
  strength:    'Aumenta el <strong>daño máximo</strong> de tus golpes cuerpo a cuerpo. Se entrena con el estilo <strong>Agresivo</strong>. El equipo con <strong>💪 Fuerza</strong> también lo sube: botas de dragón +4, capa de fuego +4, de lava +3 y de magma +6.',
  defence:     'Reduce la probabilidad de que te acierten. Se entrena con el estilo <strong>Defensivo</strong> (y con arco en <em>largo alcance</em>).',
  hitpoints:   'Tu vida máxima es igual a tu nivel de Vitalidad. Sube un poco con cualquier golpe que aciertes. Fuera de combate recuperas <strong>1 HP cada 20 s</strong>; la comida cura al instante.',
  ranged:      'Combate a distancia con arco y flechas (hasta ~10 m). Cada disparo gasta una flecha; con carcaj equipado el <strong>75 %</strong> se conservan.',
  magic:       'Lanza hechizos con un bastón equipado. Cada hechizo gasta maná, que se regenera solo (más rápido con bastón).',
  prayer:      'Entierra <strong>huesos</strong> (tócalos en la mochila) para ganar XP. Tus puntos de plegaria = tu nivel; las plegarias activas los gastan y se recargan rezando en un <strong>altar</strong> (hay uno junto a La Laguna y otro en la Basílica de Candelaria).',
  woodcutting: 'Tala árboles con un hacha para conseguir troncos. Toca un árbol y tu personaje irá hasta él. Algunos árboles dan varios troncos antes de caer.',
  fishing:     'Busca las <strong>burbujas</strong> en estanques, lagos y en la costa y tócalas para pescar. Cada banco pide una herramienta: <strong>red</strong>, <strong>caña</strong> (gasta plumas de cebo) o <strong>arpón</strong>. Los bancos se mueven cada pocos minutos.',
  mining:      'Pica vetas de mineral con un pico. Las vetas brillan con el color de su mineral y salen en el minimapa. Cuando una veta se agota, reaparece al rato.',
  cooking:     'Cocina carne y pescado crudos sobre un fuego encendido. A más nivel, menos probabilidad de quemarla.',
  firemaking:  'Enciende fuegos con un yesquero y troncos. Los fuegos duran 5 minutos y sirven para cocinar.',
  herblore:    'Compra <strong>hierbas</strong> y <strong>viales de agua</strong> en <strong>La ASO</strong> (el puesto de Carmita en la plaza de La Laguna) y mézclalas: toca una hierba en la mochila → <strong>🌿 Herbología</strong>. Con <strong>gofio</strong> salen súper pociones. Tocar una poción = beber una dosis: sube tu nivel durante 5 minutos. Tabaiba = Ataque · Verode = Fuerza · Salvia = Defensa · Orégano = Distancia · Retama = Plegaria · Tajinaste = Magia.',
  fletching:   'Con un <strong>cuchillo</strong> talla troncos en astiles y arcos. Junta 15 astiles con 15 plumas y ponles punta con un lingote para hacer flechas. Los arcos necesitan una cuerda (Artesanía). Se abre desde la mochila: toca unos troncos → <strong>🏹 Flechería</strong>.',
  crafting:    'Curte las pieles de vaca para sacar cuero y cóselo con <strong>aguja</strong> e <strong>hilo</strong> para hacer armadura de cuero (buena para Distancia), cuerdas de arco y carcajes. Toca el cuero en la mochila → <strong>🧵 Artesanía</strong>. Aguja, hilo y cuchillo están en la tienda general.',
  thieving:    'Mantén pulsado sobre un habitante → <strong>🫳 Robar</strong>. Cada uno pide un nivel (vecinos 1, pastores 5, artesanos 15… banqueros 70). A su mismo nivel te pillan la mitad de las veces; cuantos más niveles le saques, menos. Si te pillan, <strong>los guardias van a por ti: ¡huye!</strong> Desde nivel 50 puedes robar a otros jugadores (un objeto de su mochila, nunca lo equipado). A nivel 99 no te pilla nadie.',
  smithing:    'Funde mineral en el <strong>horno</strong> para obtener lingotes, y forja armaduras en el <strong>yunque</strong>. Hay horno y yunque junto a la Cantera de La Laguna (al noreste del spawn) y en la Mina de Guajara.',
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

/** rows: [{ level, name, detail, icon? (html) }] → una sección (pestaña) */
function unlockPages(title, rows) {
  return [{ title, rows: rows.slice().sort((a, b) => a.level - b.level) }];
}

function headerHtml(skillId, sections) {
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  const level = skills.getLevel(skillId);
  const xp = skills.getXp(skillId);
  const next = level < 99 ? skills.levelToXp(level + 1) : null;
  const cur = skills.levelToXp(level);
  const pct = next ? Math.min(100, Math.floor(((xp - cur) / (next - cur)) * 100)) : 100;
  // siguiente desbloqueo (el más cercano por encima de tu nivel)
  let nextU = null;
  for (const sec of sections) for (const r of sec.rows || []) if (r.level > level && (!nextU || r.level < nextU.level)) nextU = r;
  return `
    <div class="sgx-head">
      <span class="sgx-ico">${getSkillIconHtml(def.id, def.icon)}</span>
      <div class="sgx-hmain">
        <div class="sgx-title">${esc(def.name)} <span class="sgx-lvl">${level}<small>/99</small></span></div>
        <div class="sgx-bar"><i style="width:${pct}%"></i></div>
        <div class="sgx-sub">${xp.toLocaleString('es-ES')} XP · ${next ? `faltan ${(next - xp).toLocaleString('es-ES')} para el ${level + 1}` : '⭐ nivel máximo'}</div>
        ${nextU ? `<div class="sgx-next">Próximo: <b>${esc(nextU.name)}</b> a nivel ${nextU.level}</div>` : ''}
      </div>
      <button type="button" class="sgx-x" aria-label="Cerrar">✕</button>
    </div>`;
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
            <li><strong>Bronce</strong> — Llanuras y la Cantera de La Laguna (NE del spawn)</li>
            <li><strong>Hierro</strong> — Bosques y pantano</li>
            <li><strong>Acero</strong> — Tundra nevada y la Mina de Guajara</li>
            <li><strong>Oro</strong> — Desierto, selva y la Mina de Guajara</li>
            <li><strong>Obsidiana, Basaltita, Teiderio</strong> — Malpaís (wilderness), cuanto más al fondo, mejor</li></ul>
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
            <li><strong>Laguna de Aguere</strong> — al suroeste del spawn: gambas, sardina, arenque, trucha, salmón</li>
            <li><strong>Laguna del Pantano</strong> — igual que el estanque</li>
            <li><strong>Lago de Adeje</strong> (selva) — peces de río y atún / pez espada</li>
            <li><strong>Lago Helado</strong> (tundra) — atún y pez espada con arpón</li>
            <li><strong>Costa del Sur</strong> — gambas y peces grandes en la orilla de la playa</li>
            <li><strong>Costa del Malpaís</strong> — ☠ aguas profundas: <strong>tiburón</strong> (nivel 76)</li></ul>
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
        .concat([{ content: `<h2>Huesos</h2><p><strong>Huesos</strong>: 5 XP · <strong>Huesos grandes</strong> (animales grandes): 20 XP · <strong>Súper huesos</strong> (jefes): 2000 XP.</p><p class="sg-muted">Solo puedes tener activa una plegaria de cada tipo (una de Defensa, una de Fuerza...).</p>` }]);
    case 'magic':
      return unlockPages('Hechizos', SPELLS.map(([n, l, d]) => ({ level: l, name: n, detail: d, icon: '✨' })), lvl)
        .concat([{ content: `<h2>Maná</h2><p>Tu maná máximo crece con tu nivel de Magia; con bastón equipado tienes <strong>+100</strong> y se regenera más rápido.</p>` }])
        // Sesión 50 — tabletas de teletransporte
        .concat(unlockPages('Tabletas de teletransporte', Object.entries(TABLETS).map(([id, t]) => ({
          level: 1, name: t.name, icon: icon(id, '🪨'),
          detail: t.quest ? `Misión cerca: ${QUESTS[t.quest]?.name || ''}` : (t.wild ? '¡En la wilderness!' : 'Se compra a Morgana (La Laguna)'),
        })), lvl));
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
          rows.push({ level: EQUIP_LEVEL[m], name: `Espada de ${n}`, detail: `+${A1[i]} ataque · una mano${hasSpecialAttack(`sword_${m}`) ? ' · ⚡ especial' : ''} · Herrería ${SMELT[m].level}`, icon: icon(`sword_${m}`, '⚔️') });
          rows.push({ level: EQUIP_LEVEL[m], name: `Espadón de ${n}`, detail: `+${A2[i]} ataque · dos manos · ×1,5 daño, 25 % crítico${hasSpecialAttack(`sword_${m}_2h`) ? ' · ⚡ especial' : ''} · Herrería ${SMELT[m].level + 4}`, icon: icon(`sword_${m}_2h`, '⚔') });
        });
        // Sesión 51 — armas legendarias (raros de jefe)
        const LEG = [['gs_achaman', 'Espadón de Achamán', 'Rey Yeti Grom', '2h_sword'], ['gs_tibicena', 'Espadón de Tibicena', 'Varkhul', '2h_sword'],
          ['gs_magec', 'Espadón de Magec', 'Reina Sekhet', '2h_sword'], ['gs_guayota', 'Espadón de Guayota', 'Coloso de Obsidiana', '2h_sword'],
          ['sword_tindaya', 'Espada larga de Tindaya', 'Chona', '1h_sword'], ['claws_dragon', 'Garras de dragón', 'Nidhogg', '1h_sword'],
          ['dagger_dragon', 'Daga de dragón', 'Nidhogg, Vermithrax, Leviatán', '1h_sword']];
        const legend = LEG.map(([id, n, boss, wt]) => ({
          level: equipRequirement({ id, equip_slot: 'weapon', weapon_type: wt })?.level || 70, name: n,
          detail: `⚡ ${WEAPON_SPECS[id]?.name || 'especial'} · raro de ${boss}`, icon: icon(id, '⚔'),
        }));
        return [...unlockPages('Armas', rows, lvl), ...unlockPages('Legendarias', legend, lvl)];
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
          detail: `+${[7, 12, 18, 26, 35][i]} distancia${hasSpecialAttack(id) ? ' · ⚡ especial' : ''} · se fabrica con Flechería`, icon: icon(id, '🏹'),
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

// ------------------------------------------------------------
// Ventana estilo guía de OSRS / libro de hechizos de WoW: pestañas por
// categoría y una lista con icono + nivel; lo que aún no tienes sale gris.
// ------------------------------------------------------------
let _root = null;
function ensureDom() {
  if (_root) return _root;
  _root = document.createElement('div');
  _root.id = 'skillGuideOverlay';
  const css = document.createElement('style');
  css.textContent = `
    #skillGuideOverlay { position: fixed; inset: 0; z-index: 9000; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); }
    #skillGuideOverlay.visible { display: flex; }
    #skillGuideOverlay .sgx-book { width: min(520px, calc(100vw - 16px)); height: min(720px, calc(100vh - 24px)); display: flex; flex-direction: column;
      background: linear-gradient(#4a3f30, #3a3124); border: 3px solid #c8a043; border-radius: 10px; color: #f3e6c4; box-shadow: 0 10px 40px rgba(0,0,0,0.7); overflow: hidden; }
    #skillGuideOverlay .sgx-head { display: flex; gap: 10px; align-items: flex-start; padding: 12px 12px 8px; border-bottom: 1px solid #6a5530; }
    #skillGuideOverlay .sgx-ico { width: 46px; height: 46px; flex: 0 0 46px; display: flex; align-items: center; justify-content: center; font-size: 32px;
      background: #241e15; border: 2px solid #6a5530; border-radius: 8px; }
    #skillGuideOverlay .sgx-ico svg, #skillGuideOverlay .sgx-ico img { width: 36px; height: 36px; }
    #skillGuideOverlay .sgx-hmain { flex: 1; min-width: 0; }
    #skillGuideOverlay .sgx-title { font-size: 19px; font-weight: 800; color: #ffd76a; text-shadow: 0 2px 0 #000; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    #skillGuideOverlay .sgx-lvl { font-size: 22px; color: #fff3cf; } #skillGuideOverlay .sgx-lvl small { font-size: 12px; color: #b8a880; }
    #skillGuideOverlay .sgx-bar { height: 8px; background: rgba(0,0,0,0.45); border: 1px solid #7a6030; border-radius: 5px; overflow: hidden; margin: 5px 0 3px; }
    #skillGuideOverlay .sgx-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #6aa84f, #c8e070); }
    #skillGuideOverlay .sgx-sub { font-size: 12px; color: #c8b890; }
    #skillGuideOverlay .sgx-next { font-size: 12px; color: #e8d8a8; margin-top: 2px; } #skillGuideOverlay .sgx-next b { color: #ffd76a; }
    #skillGuideOverlay .sgx-x { font: inherit; font-size: 18px; width: 36px; height: 36px; flex: 0 0 36px; border-radius: 8px; border: 2px solid #8a6a2a; background: #5a3e1a; color: #fff3cf; cursor: pointer; }
    #skillGuideOverlay .sgx-tabs { display: flex; gap: 6px; padding: 8px 12px; overflow-x: auto; scrollbar-width: none; flex: 0 0 auto; }
    #skillGuideOverlay .sgx-tab { font: inherit; font-size: 13px; font-weight: 700; padding: 6px 11px; border-radius: 16px; white-space: nowrap;
      border: 2px solid #6a5530; background: #2e271c; color: #d8c8a0; cursor: pointer; }
    #skillGuideOverlay .sgx-tab.on { background: #c8a043; color: #2a1a00; border-color: #ffd76a; }
    #skillGuideOverlay .sgx-tab .n { font-size: 11px; opacity: 0.75; margin-left: 4px; }
    #skillGuideOverlay .sgx-list { flex: 1; overflow-y: auto; padding: 4px 10px 14px; -webkit-overflow-scrolling: touch; }
    #skillGuideOverlay .sgx-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; margin-bottom: 4px; border-radius: 8px;
      background: #2e271c; border: 1px solid #5a4a2a; }
    #skillGuideOverlay .sgx-lv { flex: 0 0 34px; text-align: center; font-weight: 900; font-size: 17px; color: #ffd76a; text-shadow: 0 1px 0 #000; }
    #skillGuideOverlay .sgx-slot { position: relative; flex: 0 0 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 26px;
      background: radial-gradient(#3a3226, #1e1912); border: 2px solid #6a5530; border-radius: 6px; }
    #skillGuideOverlay .sgx-slot svg, #skillGuideOverlay .sgx-slot img { width: 34px; height: 34px; }
    #skillGuideOverlay .sgx-badge { position: absolute; right: -5px; bottom: -5px; font-size: 11px; width: 18px; height: 18px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; border: 1px solid #000; }
    #skillGuideOverlay .sgx-row.ok .sgx-badge { background: #3f8a2a; color: #fff; }
    #skillGuideOverlay .sgx-row.lock .sgx-badge { background: #2a2418; }
    #skillGuideOverlay .sgx-t { flex: 1; min-width: 0; line-height: 1.25; }
    #skillGuideOverlay .sgx-t b { display: block; font-size: 14px; color: #fff0c8; }
    #skillGuideOverlay .sgx-t small { font-size: 11.5px; color: #c0b088; }
    #skillGuideOverlay .sgx-row.lock { background: #221d16; border-color: #3e3424; }
    #skillGuideOverlay .sgx-row.lock .sgx-slot > :not(.sgx-badge) { filter: grayscale(1) brightness(0.55); opacity: 0.6; }
    #skillGuideOverlay .sgx-row.lock .sgx-t b, #skillGuideOverlay .sgx-row.lock .sgx-t small { color: #807560; }
    #skillGuideOverlay .sgx-row.lock .sgx-lv { color: #8a7a5a; }
    #skillGuideOverlay .sgx-mark { display: flex; align-items: center; gap: 8px; margin: 8px 2px; font-size: 12px; font-weight: 800; color: #9fe08a; }
    #skillGuideOverlay .sgx-mark::before, #skillGuideOverlay .sgx-mark::after { content: ''; flex: 1; height: 2px; background: linear-gradient(90deg, transparent, #6aa84f, transparent); }
    #skillGuideOverlay .sgx-info { padding: 6px 6px; font-size: 14px; line-height: 1.45; color: #ecdfbe; }
    #skillGuideOverlay .sgx-info h3 { font-size: 15px; color: #ffd76a; margin: 12px 0 4px; }
    #skillGuideOverlay .sgx-info ul { padding-left: 18px; margin: 4px 0; } #skillGuideOverlay .sgx-info li { margin: 3px 0; }
    #skillGuideOverlay .sgx-info .sg-muted { font-size: 12px; color: #b8a880; }`;
  _root.appendChild(css);
  const book = document.createElement('div');
  book.className = 'sgx-book'; book.setAttribute('role', 'dialog');
  _root.appendChild(book);
  document.body.appendChild(_root);
  _root.addEventListener('pointerdown', (e) => { if (e.target === _root) closeGuide(); });
  _root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeGuide(); });
  return _root;
}
function closeGuide() {
  if (!_root || !_root.classList.contains('visible')) return;
  _root.classList.remove('visible');
  try { audio.sfx('book_close'); } catch {}
}

function rowsHtml(rows, lvl) {
  let h = '', marked = false;
  const anyLocked = rows.some(r => r.level > lvl), anyOk = rows.some(r => r.level <= lvl);
  for (const r of rows) {
    const ok = lvl >= r.level;
    if (!ok && !marked && anyOk && anyLocked) { marked = true; h += `<div class="sgx-mark" id="sgxMark">Tu nivel: ${lvl}</div>`; }
    h += `<div class="sgx-row ${ok ? 'ok' : 'lock'}">
      <span class="sgx-lv">${r.level}</span>
      <span class="sgx-slot">${r.icon || '•'}<span class="sgx-badge">${ok ? '✓' : '🔒'}</span></span>
      <span class="sgx-t"><b>${esc(r.name)}</b>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</span>
    </div>`;
  }
  return h;
}

/** Abre la guía de una skill. */
export async function openSkillGuide(skillId) {
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  if (!def) return;
  const lvl = skills.getLevel(skillId);
  let extra = [];
  try { extra = await buildUnlocks(skillId, lvl); } catch (e) { console.warn('[skill_guides]', e); }
  // secciones con lista + una pestaña "Guía" con la descripción y las notas
  const lists = [], infos = [`<h3>¿Qué es?</h3><p>${DESCRIPTIONS[skillId] || ''}</p>`];
  for (const sec of extra) {
    if (sec.rows) { if (sec.rows.length) lists.push(sec); continue; }
    if (sec.content) infos.push(sec.content.replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>'));
  }
  const tabs = [...lists.map(l => ({ title: l.title, rows: l.rows })), { title: 'ℹ️ Guía', html: infos.join('') }];
  // pestaña inicial: la que tiene tu próximo desbloqueo (si no, la más grande)
  let cur = 0, best = -1;
  lists.forEach((l, i) => { const nx = l.rows.find(r => r.level > lvl); if (nx && (best < 0 || nx.level < best)) { best = nx.level; cur = i; } });
  if (best < 0 && lists.length) cur = lists.reduce((bi, l, i) => (l.rows.length > lists[bi].rows.length ? i : bi), 0);
  const root = ensureDom();
  const book = root.querySelector('.sgx-book');
  const render = () => {
    const t = tabs[cur];
    book.innerHTML = headerHtml(skillId, lists)
      + `<div class="sgx-tabs">${tabs.map((tb, i) => `<button type="button" class="sgx-tab${i === cur ? ' on' : ''}" data-i="${i}">${esc(tb.title)}${tb.rows ? `<span class="n">${tb.rows.filter(r => r.level <= lvl).length}/${tb.rows.length}</span>` : ''}</button>`).join('')}</div>`
      + `<div class="sgx-list">${t.rows ? rowsHtml(t.rows, lvl) : `<div class="sgx-info">${t.html}</div>`}</div>`;
    book.querySelector('.sgx-x').onclick = closeGuide;
    book.querySelectorAll('.sgx-tab').forEach(b => { b.onclick = () => { cur = +b.dataset.i; render(); try { audio.sfx('book_flip'); } catch {} }; });
    const mark = book.querySelector('#sgxMark');
    if (mark) { const list = book.querySelector('.sgx-list'); list.scrollTop = Math.max(0, mark.offsetTop - list.clientHeight * 0.45); }
    book.querySelector('.sgx-tabs .on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  };
  render();
  root.classList.add('visible');
  root.tabIndex = -1; try { root.focus({ preventScroll: true }); } catch {}
  try { audio.sfx('book_open'); } catch {}
}

if (typeof window !== 'undefined') window.__skillGuide = openSkillGuide;
