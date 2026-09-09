/**
 * Servidor estatico minimo. Node puro, cero dependencias.
 * Los modulos ES no cargan desde file://, hace falta un http:// para probar.
 * En produccion esto no existe: la app son archivos estaticos en GitHub Pages.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';

    // Sin esto, un ../../ leeria cualquier archivo de la maquina.
    const safe = normalize(rel).replace(/^([/\\]|\.\.)+/, '');
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Nope');
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.code ?? err));
  }
}).listen(PORT, () => {
  console.log(`Riftrain en http://localhost:${PORT}`);
});
