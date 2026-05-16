#!/usr/bin/env node
/**
 * audit_console.mjs — Cuenta console.log/warn/error en cliente.
 *
 * console.log: usualmente debug que se olvidó borrar → informa.
 * console.warn/error: legítimo para reportar problemas → no se reporta.
 *
 * No falla. Solo lista los console.log para que decidas si se quedan
 * o se borran.
 */

import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = 'client/src';
const items = [];

if (!fs.existsSync(CLIENT_DIR)) {
  console.error(`[audit:console] no existe ${CLIENT_DIR}/`);
  process.exit(0);
}

const files = fs.readdirSync(CLIENT_DIR).filter(f => f.endsWith('.js'));
for (const file of files) {
  const content = fs.readFileSync(path.join(CLIENT_DIR, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignorar líneas que estén dentro de un comment de bloque o ya comentadas
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (/\bconsole\.log\s*\(/.test(line)) {
      items.push({ file: path.join(CLIENT_DIR, file), line: i + 1, code: line.trim().slice(0, 100) });
    }
  }
}

if (items.length === 0) {
  console.log('[audit:console] ✓ sin console.log en cliente');
  process.exit(0);
}

console.log(`[audit:console] ${items.length} console.log encontrados (revisar si son debug residual):`);
for (const item of items) {
  console.log(`  ${item.file}:${item.line}  ${item.code}`);
}
// No falla
process.exit(0);
