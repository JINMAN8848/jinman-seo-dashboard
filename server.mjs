// seo-dashboard micro server
// Owner: L1 调度师 (32789)
// Date: 2026-09-29
// Status: serves dist/index.html on PORT (env, set by portal tool).
//
// Red lines:
//   * No external calls.
//   * No writes (read-only static file).
//   * No auth — gateway portal token already gates access.

import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '9880', 10);
const DIST = join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  // Strip query string; default to /index.html for /
  const urlPath = (req.url ?? '/').split('?')[0];
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve relative to DIST, guard against ../ traversal
  const resolved = join(DIST, filePath);
  if (!resolved.startsWith(DIST)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(resolved)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + filePath); return;
  }
  const ext = extname(resolved).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const body = readFileSync(resolved);
  const stat = statSync(resolved);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': body.length,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[seo-dashboard] listening http://127.0.0.1:${PORT}/`);
  console.log(`[seo-dashboard] serving from ${DIST}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));