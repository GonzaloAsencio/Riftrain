/**
 * Corre test/browser.html en un Chrome/Edge headless real y falla si hay algun FAIL.
 *
 * Por que hace falta: node --test cubre el motor (aritmetica, dominios, progresion),
 * pero NO puede ver un grayscale que no se aplica, un abanico que parte la pagina,
 * ni una carta que no se da vuelta. Esos bugs solo aparecen con un layout de verdad.
 *
 * Cero dependencias: usa el navegador que ya esta instalado en la maquina.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8199);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function findBrowser() {
  return BROWSERS.find((p) => existsSync(p)) ?? null;
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
      const safe = normalize(rel === '/' ? '/index.html' : rel).replace(/^([/\\]|\.\.)+/, '');
      const body = await readFile(join(ROOT, safe));
      res.writeHead(200, { 'content-type': TYPES[extname(safe)] ?? 'text/plain', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('404');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

function run(bin, url) {
  return new Promise((ok, err) => {
    const p = spawn(bin, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--virtual-time-budget=4000', '--window-size=500,900', '--dump-dom', url,
    ]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', err);
    p.on('close', () => ok(out));
  });
}

const bin = findBrowser();
if (!bin) {
  console.error('No encontre Chrome ni Edge. Los tests de navegador NO corrieron.');
  console.error('Instalalos, o corre test/browser.html a mano en tu navegador.');
  process.exit(1);
}

const server = await serve();
const dom = await run(bin, `http://localhost:${PORT}/test/browser.html`);
server.close();

// Solo las lineas del reporte: las del <script> tambien contienen la palabra PASS.
const lines = [...dom.matchAll(/<div class="t-(pass|fail)">([^<]*)<\/div>/g)].map((m) => ({
  ok: m[1] === 'pass',
  text: m[2].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim(),
}));

if (!lines.length) {
  console.error('El navegador no reporto nada. Se rompio el bundle de test?');
  process.exit(1);
}

for (const l of lines) if (!l.ok) console.error(l.text);

const failed = lines.filter((l) => !l.ok).length;
const passed = lines.length - failed;
console.log(`navegador: ${passed} pass, ${failed} fail (${bin.split(/[\\/]/).pop()})`);
process.exit(failed ? 1 : 0);
