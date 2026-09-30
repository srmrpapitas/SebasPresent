/**
 * SebasPresent — Misiones (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. El server lleva el progreso
 * (tabla user_quests) y avanza los pasos cuando llegan eventos reales desde
 * los handlers (talar, encender fuego, matar, cocinar, picar, fundir, forjar,
 * equipar). El cliente solo muestra el paso actual y dónde ir.
 *
 * Paso:
 *   event:  'chop' | 'fire' | 'kill' | 'cook' | 'mine' | 'smelt' | 'smith' | 'equip' | 'fish' | 'bury' | 'altar' | 'fletch' | 'craft' | 'bank' | 'note' | 'ge_sell'
 *   match:  (opcional) lo que tiene que coincidir: item, npc def, mineral...
 *   count:  cuántas veces
 *   give:   herramientas que se entregan al empezar el paso SI no las tienes
 *   hint:   { x, z } fijo, o { npc: 'chicken' } (el cliente busca el más cercano)
 *   reward: recompensa al completar el paso { coins?, items?: [[id, qty]] }
 * Quest.reward: recompensa final al terminar todos los pasos.
 */

export const QUESTS = {
  tutorial: {
    id: 'tutorial',
    name: 'Primeros pasos',
    summary: 'Aprende lo básico: talar, hacer fuego, cazar, cocinar, picar mineral y forjar tu primera pieza de armadura.',
    steps: [
      { id: 'chop',  event: 'chop',  count: 3, give: ['axe_bronze'],
        text: 'Tala 3 troncos de cualquier árbol.',
        tip: 'Toca un árbol cerca del Concejo. Tu personaje irá y talará solo.',
        reward: { coins: 10 } },
      { id: 'fire',  event: 'fire',  count: 1, give: ['tinderbox'],
        text: 'Enciende un fuego.',
        tip: 'En la mochila, toca unos troncos → "Encender fuego".',
        reward: { coins: 10 } },
      { id: 'hunt',  event: 'kill',  match: 'chicken', count: 1, hint: { npc: 'chicken' },
        text: 'Mata un pollo.',
        tip: 'Los pollos están alrededor del Concejo. Tócalo para atacar.',
        reward: { coins: 10 } },
      { id: 'cook',  event: 'cook',  count: 1,
        text: 'Cocina carne cruda en un fuego.',
        tip: 'Enciende un fuego, ponte al lado y toca el pollo crudo → "Cocinar".',
        reward: { coins: 15 } },
      { id: 'mine',  event: 'mine',  match: 'bronze', count: 3, give: ['pickaxe_bronze'], hint: { x: 121, z: -95 },
        text: 'Pica 3 minerales de bronce en la Cantera del Concejo.',
        tip: 'Sigue el haz dorado. Las vetas de bronce brillan en naranja.',
        reward: { coins: 15 } },
      { id: 'smelt', event: 'smelt', match: 'bronze', count: 3, hint: { x: 102, z: -74 },
        text: 'Funde 3 lingotes de bronce en el horno.',
        tip: 'Toca el horno y elige "Lingote de bronce" → 5 o Todo.',
        reward: { coins: 20 } },
      { id: 'smith', event: 'smith', match: 'helm_bronze', count: 1, hint: { x: 96, z: -80 },
        text: 'Forja un yelmo de bronce en el yunque.',
        tip: 'Toca el yunque, pestaña Bronce → Yelmo de bronce.',
        reward: { coins: 20 } },
      { id: 'equip', event: 'equip', match: 'helm_bronze', count: 1,
        text: 'Equípate el yelmo de bronce.',
        tip: 'En la mochila, toca el yelmo → "Equipar".',
        reward: { coins: 0 } },
    ],
    reward: { coins: 150, items: [['sword_bronze', 1]], text: '150 monedas y una espada de bronce' },
  },

  // Sesión 50 — Pesca. Se lleva en paralelo, pero el rastreador la enseña
  // cuando terminas (o saltas) el tutorial.
  pescador: {
    id: 'pescador',
    name: 'Anzuelo y sedal',
    summary: 'Aprende a pescar en el Estanque del Concejo y cocina lo que saques. Al final te espera una caña de pescar.',
    steps: [
      { id: 'net',   event: 'fish', match: 'raw_shrimp', count: 5, give: ['small_net'], hint: { x: -70, z: -150 },
        text: 'Pesca 5 gambas en el Estanque del Concejo.',
        tip: 'Busca las burbujas en el agua y tócalas con la red pequeña en la mochila. Los bancos se mueven cada pocos minutos.',
        reward: { coins: 15 } },
      { id: 'cook',  event: 'cook', match: 'shrimp', count: 3,
        text: 'Cocina 3 gambas en un fuego.',
        tip: 'Enciende un fuego y toca las gambas crudas → "Cocinar".',
        reward: { coins: 15 } },
    ],
    reward: { coins: 50, items: [['fishing_rod', 1], ['feather', 50]], text: '50 monedas, una caña de pescar y 50 plumas (cebo)' },
  },

  // Sesión 50 — Flechería + Artesanía
  artesano: {
    id: 'artesano',
    name: 'Manos de artesano',
    summary: 'Aprende a tallar madera y a trabajar el cuero. Con esto podrás hacer tus propias flechas, arcos y armadura de cuero.',
    steps: [
      { id: 'shafts', event: 'fletch', match: 'arrow_shaft', count: 1, give: ['knife'],
        text: 'Talla astiles con unos troncos.',
        tip: 'En la mochila, toca unos troncos → "🏹 Flechería" → 15 astiles.',
        reward: { coins: 10, items: [['feather', 15]] } },
      { id: 'cow', event: 'kill', match: 'cow', count: 1, hint: { npc: 'cow' },
        text: 'Mata una vaca para conseguir su piel.',
        tip: 'Las vacas sueltan siempre piel de vaca.',
        reward: { coins: 10 } },
      { id: 'tan', event: 'craft', match: 'leather', count: 1,
        text: 'Curte la piel de vaca.',
        tip: 'Toca la piel de vaca en la mochila → "🧵 Artesanía" → Curtir.',
        reward: { coins: 10 } },
      { id: 'gloves', event: 'craft', match: 'gloves_cuero', count: 1, give: ['needle', 'thread'],
        text: 'Cose unos guantes de cuero.',
        tip: 'Toca el cuero → "🧵 Artesanía" → Guantes de cuero (aguja + hilo).',
        reward: { coins: 15 } },
      { id: 'equip', event: 'equip', match: 'gloves_cuero', count: 1,
        text: 'Ponte los guantes de cuero.',
        tip: 'En la mochila, toca los guantes → "Equipar".',
        reward: { coins: 0 } },
    ],
    reward: { coins: 100, items: [['arrow_bronze', 50], ['thread', 20]], text: '100 monedas, 50 flechas de bronce y 20 de hilo' },
  },
};

// Sesión 50 — Bancos, notas y GE
QUESTS.banquero = {
  id: 'banquero',
  name: 'El banquero',
  summary: 'Por todo el mapa hay cofres de banco (el icono dorado del minimapa). Todos abren TU banco. Aprende a guardar, a sacar notas y a vender en el Mercado.',
  steps: [
    { id: 'deposit', event: 'bank', count: 1, hint: { bank: true },
      text: 'Guarda algo en un cofre de banco.',
      tip: 'Sigue el haz dorado hasta el cofre más cercano, tócalo y toca un objeto de tu mochila.',
      reward: { coins: 20 } },
    { id: 'note', event: 'note', count: 1, hint: { bank: true },
      text: 'Saca un objeto como NOTA.',
      tip: 'En el banco activa "📜 Sacar como nota" y saca algo que no se apile (troncos, mineral…). Ocupa un solo hueco.',
      reward: { coins: 20 } },
    { id: 'ge', event: 'ge_sell', count: 1, hint: { x: -80, z: -80 },
      text: 'Pon algo a la venta en el Mercado (GE).',
      tip: 'Habla con el banquero del castillo → Mercado. Las notas cuentan como el objeto.',
      reward: { coins: 0 } },
  ],
  reward: { coins: 150, text: '150 monedas' },
};

export const QUEST_ORDER = ['tutorial', 'pescador', 'artesano', 'banquero'];

export function getQuest(id) { return QUESTS[id] || null; }
