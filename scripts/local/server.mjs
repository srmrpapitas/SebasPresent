// Pruebas locales: API en :8787 (worker.fetch + D1 simulada con SQLite) y
// cliente en :8080. Sin Durable Object (el cliente usa el plan B por HTTP).
//
//   THREE_DIR=/ruta/a/three.js  node scripts/local/server.mjs [db.sqlite]
//
// THREE_DIR = copia de three.js r160 (carpetas build/ y examples/jsm/), porque
// en el entorno de pruebas no hay CDN. Los modelos de R2 tampoco cargan: el
// juego tiene que funcionar igual (personaje de reserva).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeD1, applySqlLoose } from './d1shim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB_FILE = process.argv[2] || ':memory:';
const THREE_DIR = process.env.THREE_DIR || '';
const fresh = DB_FILE === ':memory:' || !fs.existsSync(DB_FILE);
const DB = makeD1(DB_FILE);

if (fresh) {
  const run = (f) => applySqlLoose(DB, fs.readFileSync(f, 'utf8'), path.basename(f));
  run(path.join(ROOT, 'server/schema.sql'));
  for (const dir of ['server/migrations', 'server/seeds']) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.sql')).sort()) run(path.join(d, f));
  }
  console.log('[local] base de datos creada');
}

const { default: worker } = await import(path.join(ROOT, 'server/worker.js'));
const env = {
  DB,
  ALLOWED_ORIGINS: 'http://localhost:8080,http://127.0.0.1:8080',
  CAP_READS: '4500000', CAP_WRITES: '90000',
  JWT_SECRET: 'local-dev-secret',
};
const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); }, passThroughOnException() {} };
globalThis.__localEnv = env;

http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = new Request('http://localhost:8787' + req.url, {
      method: req.method, headers: req.headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body,
    });
    const out = await worker.fetch(r, env, ctx);
    const headers = {}; out.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(out.status, headers);
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error('[local api]', e);
    res.writeHead(500); res.end(String(e?.stack || e));
  }
}).listen(8787, () => console.log('[local] API en http://localhost:8787'));

// Cron cada minuto, como en Cloudflare
setInterval(() => { worker.scheduled?.({ cron: '* * * * *', scheduledTime: Date.now() }, env, ctx).catch(e => console.warn('[cron]', e.message)); }, 60_000);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (p.startsWith('/__three/')) file = path.join(THREE_DIR, p.slice('/__three/'.length));
  else file = path.join(ROOT, 'client', p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  let data = fs.readFileSync(file);
  if (file.endsWith('index.html') && THREE_DIR) {
    data = Buffer.from(String(data)
      .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', '/__three/build/three.module.js')
      .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', '/__three/examples/jsm/'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}).listen(8080, () => console.log('[local] cliente en http://localhost:8080'));
