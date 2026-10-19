// Fotos de armaduras procedurales sobre un NPC Mixamo local (sin R2):
//   cp scripts/local/test_armor.html client/__test_quiver.html  (¡no subirlo!)
//   node scripts/local/armor_shots.mjs 'body_dragon:body,cape_magma:cape,quiver_bronze:quiver' 1.9
// Deja q_front/back/right/3q.png en /home/claude/harness (cámbialo si hace falta).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('console', m => console.log('C', m.text().slice(0, 200)));
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:8080/__test_quiver.html?d=' + (process.argv[3]||4.2) + (process.argv[2] ? '&items=' + process.argv[2] : ''));
await page.waitForFunction(() => window.__done, null, { timeout: 60000 });
const shots = await page.evaluate(() => window.__shots);
for (const [k, v] of Object.entries(shots)) fs.writeFileSync(`/home/claude/harness/q_${k}.png`, Buffer.from(v.split(',')[1], 'base64'));
await browser.close();
