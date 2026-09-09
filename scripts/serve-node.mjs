#!/usr/bin/env node
/**
 * Zero-dependency static file server for the prototype.
 * Works on macOS, Linux, and Windows — requires only Node.js >= 18.
 *
 * Usage:
 *   node scripts/serve-node.mjs            # serves on http://localhost:8080
 *   PORT=9000 node scripts/serve-node.mjs  # custom port
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..', 'src');
const PORT = Number(process.env.PORT) || 8090;
const BIND = process.env.BIND || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.ogg':  'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.atlas':'text/plain; charset=utf-8',
  '.fnt':  'text/plain; charset=utf-8',
};

async function serve(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // Strip query strings for file resolution
  const cleanPath = urlPath.split('?')[0];
  const filePath = join(ROOT, cleanPath);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      try {
        const data = await readFile(indexPath);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
        return;
      } catch {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
    }

    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('File not found');
  }
}

const server = createServer(serve);
server.listen(PORT, BIND, () => {
  console.log(`\n  Prototype server running at:\n`);
  console.log(`    http://localhost:${PORT}/lobby.html`);
  console.log(`    http://localhost:${PORT}/player.html`);
  console.log(`    http://localhost:${PORT}/sandbox.html\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
