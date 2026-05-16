#!/usr/bin/env node
/**
 * audit_todo.mjs — Cuenta TODOs y FIXMEs en el código.
 *
 * No falla nunca (exit 0). Solo informa. Ayuda a no perder de vista
 * deuda técnica acumulada. Si la lista crece mucho, es señal de que
 * hace falta dedicar tiempo a limpieza.
 */

import * as fs from 'fs';
import * as path from 'path';

const DIRS = ['client', 'server'];
const TODO_REGEX = /(?:\/\/|\*)\s*(TODO|FIXME|XXX|HACK)[:\s]+(.*)$/gm;

let total = 0;
const byKind = { TODO: 0, FIXME: 0, XXX: 0, HACK: 0 };
const items = [];

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/(?:\/\/|\*)\s*(TODO|FIXME|XXX|HACK)[:\s]+(.*)$/);
      if (m) {
        const kind = m[1];
        byKind[kind] = (byKind[kind] || 0) + 1;
        total++;
        items.push({ file: fullPath, line: i + 1, kind, text: m[2].trim() });
      }
    }
  }
}

if (total === 0) {
  console.log('[audit:todo] ✓ sin TODOs/FIXMEs pendientes');
  process.exit(0);
}

console.log(`[audit:todo] ${total} pendientes:`);
for (const k of Object.keys(byKind)) {
  if (byKind[k] > 0) console.log(`  ${k}: ${byKind[k]}`);
}
console.log('');
for (const item of items) {
  console.log(`  ${item.file}:${item.line}  [${item.kind}] ${item.text.slice(0, 80)}`);
}
// No falla — solo informa
process.exit(0);
