#!/usr/bin/env node
/**
 * audit_globals.mjs — Detecta hooks globales `window.__*` no documentados.
 *
 * Razón de ser: cada hook nuevo añade acoplamiento invisible (no aparece
 * en imports). Si añades uno y olvidas documentarlo en INVARIANTS.md,
 * el próximo dev (o tú dentro de un mes) no sabrá que existe → bugs.
 *
 * Cómo: escanea client/src/*.js buscando "window.__nombre", lista todos los
 * encontrados, y los compara contra los listados en INVARIANTS.md sección 3.
 *
 * Exit codes:
 *   0 = todo documentado
 *   1 = hay hooks no documentados (lista cuáles), o falta INVARIANTS.md
 *
 * Diagnóstico defensivo: si no encuentra INVARIANTS.md, imprime cwd y la
 * lista completa de archivos en la raíz para depurarlo en el log de Actions.
 */

import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = 'client/src';

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

// 2. Localizar INVARIANTS.md de forma TOLERANTE.
// Acepta cualquier variante: INVARIANTS.md, invariants.md, INVARIANTS.MD,
// o con espacios/caracteres invisibles antes/después del nombre.
let invariantsPath = null;
let rootListing = [];
try {
  rootListing = fs.readdirSync('.');
  invariantsPath = rootListing.find(f => {
    const normalized = f.trim().toLowerCase();
    return normalized === 'invariants.md';
  }) || null;
} catch (err) {
  console.error(`[audit:globals] no se pudo leer la raíz: ${err.message}`);
  console.error(`[audit:globals] cwd=${process.cwd()}`);
  process.exit(1);
}

if (!invariantsPath) {
  console.error('[audit:globals] no se encontró INVARIANTS.md en la raíz del repo.');
  console.error(`[audit:globals] cwd=${process.cwd()}`);
  console.error('[audit:globals] archivos visibles en la raíz:');
  for (const f of rootListing) {
    // Mostrar cada nombre entre pipes para detectar espacios ocultos
    console.error(`  |${f}|`);
  }
  process.exit(1);
}

// 3. Leer INVARIANTS y extraer los hooks documentados.
// Soporta `__name`, `__name(args)`, `__name(arg1, arg2)`.
let documented = new Set();
try {
  const invariants = fs.readFileSync(invariantsPath, 'utf-8');
  const DOC_REGEX = /`(__[a-zA-Z_][a-zA-Z0-9_]*)(?:\([^)]*\))?`/g;
  let m;
  while ((m = DOC_REGEX.exec(invariants)) !== null) {
    documented.add(m[1]);
  }
} catch (err) {
  console.error(`[audit:globals] no se pudo leer ${invariantsPath}: ${err.message}`);
  process.exit(1);
}

// 4. Comparar
const undocumented = [];
for (const [hook, filesSet] of found) {
  if (!documented.has(hook)) {
    undocumented.push({ hook, files: [...filesSet] });
  }
}

if (undocumented.length === 0) {
  console.log(`[audit:globals] ✓ ${found.size} hooks encontrados, todos documentados en ${invariantsPath}`);
  process.exit(0);
}

console.log(`[audit:globals] ✗ ${undocumented.length} hook(s) NO documentados en ${invariantsPath} sección 3:\n`);
for (const { hook, files } of undocumented) {
  console.log(`  • window.${hook}`);
  console.log(`    usado en: ${files.join(', ')}`);
}
console.log(`\nArregla añadiendo entradas a ${invariantsPath} sección 3 (tabla de hooks).`);
process.exit(1);
