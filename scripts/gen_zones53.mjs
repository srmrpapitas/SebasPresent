import fs from 'node:fs';
import { HUNTING_ZONES } from '../client/src/shared/hunting_zones.js';   // uso: node scripts/gen_zones53.mjs (desde la raíz)
const NEW = ['pastos_esperanza','lomas_arafo','bandidos_fasnia','barranco_infierno','cementerio_arico','arenales_candelaria','montana_roja','pinar_arona','roques_anaga','altos_anaga','cantera_helada','monteverde_jabalies','bosque_tibicenas','playa_pelada','cabras_rasca','batalla_teno','los_gigantes','calas_contrabandistas'];
let seed = 53531;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
let out = `-- Sesión 53 — Rellenar el mapa: ${NEW.length} zonas de caza nuevas (generado por gen_zones53.mjs desde client/src/shared/hunting_zones.js).\n-- Re-ejecutable: borra solo los monstruos de esas zonas antes de crearlos.\n`;
const rows = [];
for (const id of NEW) {
  const z = HUNTING_ZONES.find(h => h.id === id);
  const defs = z.mobs.map(m => `'${m[0]}'`).join(',');
  out += `DELETE FROM npc_instances WHERE owner_user_id IS NULL AND expires_at IS NULL AND def_id IN (${defs}) AND spawn_x BETWEEN ${z.x - z.r - 2} AND ${z.x + z.r + 2} AND spawn_z BETWEEN ${z.z - z.r - 2} AND ${z.z + z.r + 2};\n`;
  for (const [def, n] of z.mobs) {
    for (let i = 0; i < n; i++) {
      let x, zz;
      if (/_jefe$/.test(def)) { x = z.x + (rnd() - 0.5) * 6; zz = z.z + (rnd() - 0.5) * 6; }
      else { const a = rnd() * Math.PI * 2, d = Math.sqrt(0.08 + rnd() * 0.92) * z.r * 0.92; x = z.x + Math.cos(a) * d; zz = z.z + Math.sin(a) * d; }
      x = Math.round(x * 10) / 10; zz = Math.round(zz * 10) / 10;
      rows.push(`('${def}',-1,${x},${zz},0,${x},${zz})`);
    }
  }
}
out += `INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z) VALUES\n${rows.join(',\n')};\n`;
out += `UPDATE npc_instances SET hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id) WHERE hp_current = -1 AND def_id IN (SELECT id FROM npc_defs);\n`;
fs.writeFileSync(new URL('../server/seeds/026_zonas_s53.sql', import.meta.url), out);
console.log('monstruos', rows.length);
