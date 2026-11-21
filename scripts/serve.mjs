#!/usr/bin/env node
// Serve the repo root the way GitHub Pages would, for working on spaSHial:
//
//   node scripts/serve.mjs [port]        then open http://127.0.0.1:8180/
//
// The sketch runs in an iframe sandboxed WITHOUT allow-same-origin, so it has an opaque origin
// and every module and .wasm it loads is a CORS request. GitHub Pages answers every file with
// `access-control-allow-origin: *`; this server does the same (and `_headers` does it on
// Cloudflare Pages). A plain `python -m http.server` will NOT do: the engine cannot load.
//
// The request line is capped at 6 KB, because that is what GitHub Pages accepts (its front end
// answers 414 past about 6.1 KB). It is what makes a regression to "sketch in the URL" fail here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8',
};

export function serve(port = 8180) {
  const server = http.createServer({ maxHeaderSize: 6144 }, (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || file.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8180);
  await serve(port);
  console.log(`spaSHial: http://127.0.0.1:${port}/`);
}
