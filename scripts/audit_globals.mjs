#!/usr/bin/env node
/**
 * audit_globals.mjs — Detecta hooks globales `window.__*` no documentados.
 *
 * Razón de ser: cada hook nuevo añade acoplamiento invisible (no aparece
 * en imports). Si añades uno y olvidas documentarlo en INVARIANTS.md,
 * el próximo dev (o tú dentro de un mes) no sabrá que existe → bugs.
 *
 * Cómo: escanea client/*.js buscando "window.__nombre", lista todos los
 * encontrados, y los compara contra los listados en INVARIANTS.md sección 3.
 *
 * Exit codes:
 *   0 = todo documentado
 *   1 = hay hooks no documentados (lista cuáles)
 */

import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = 'client';
const INVARIANTS_PATH = 'INVARIANTS.md';

// 1. Encontrar todos los hooks usados en el código
const HOOK_REGEX = /window\.(__[a-zA-Z_][a-zA-Z0-9_]*)/g;
const found = new Map(); // hook -> [files...]

const files = fs.readdirSync(CLIENT_DIR).filter(f => f.endsWith('.js'));
for (const file of files) {
  const content = fs.readFileSync(path.join(CLIENT_DIR, file), 'utf-8');
  let m;
  while ((m = HOOK_REGEX.exec(content)) !== null) {
    const hook = m[1];
    if (!found.has(hook)) found.set(hook, new Set());
    found.get(hook).add(file);
  }
}

if (found.size === 0) {
  console.log('[audit:globals] ✓ no se encontraron hooks window.__* (¡bien!)');
  process.exit(0);
}

// 2. Leer INVARIANTS.md y extraer los documentados.
// Soporta `__name`, `__name(args)`, `__name(arg1, arg2)`.
let documented = new Set();
try {
  const invariants = fs.readFileSync(INVARIANTS_PATH, 'utf-8');
  const DOC_REGEX = /`(__[a-zA-Z_][a-zA-Z0-9_]*)(?:\([^)]*\))?`/g;
  let m;
  while ((m = DOC_REGEX.exec(invariants)) !== null) {
    documented.add(m[1]);
  }
} catch (err) {
  console.error(`[audit:globals] no se pudo leer ${INVARIANTS_PATH}: ${err.message}`);
  process.exit(1);
}

// 3. Comparar
const undocumented = [];
for (const [hook, filesSet] of found) {
  if (!documented.has(hook)) {
    undocumented.push({ hook, files: [...filesSet] });
  }
}

if (undocumented.length === 0) {
  console.log(`[audit:globals] ✓ ${found.size} hooks encontrados, todos documentados en INVARIANTS.md`);
  process.exit(0);
}

console.log(`[audit:globals] ✗ ${undocumented.length} hook(s) NO documentados en INVARIANTS.md sección 3:\n`);
for (const { hook, files } of undocumented) {
  console.log(`  • window.${hook}`);
  console.log(`    usado en: ${files.join(', ')}`);
}
console.log(`\nArregla añadiendo entradas a INVARIANTS.md sección 3 (tabla de hooks).`);
process.exit(1);
