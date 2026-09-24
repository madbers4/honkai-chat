import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../games/robots/server/index.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

/** The existing static story stays at /; the multiplayer app has an isolated namespace. */
export async function startFestivalServer({ port = Number(process.env.PORT) || 3001, host = '0.0.0.0', clientDir = path.join(ROOT, 'client/dist'), robotDir = path.join(ROOT, 'games/robots/dist'), autoTick = true, log = false } = {}) {
  const staticRoot = path.resolve(clientDir);
  async function fallback(request, response) {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      const candidate = path.resolve(staticRoot, `.${pathname}`);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..') || (candidate !== staticRoot && !candidate.startsWith(staticRoot + path.sep))) {
        response.writeHead(400); response.end(); return;
      }
      let file = candidate;
      let info = await stat(file).catch(() => null);
      if (!info?.isFile() && !path.extname(pathname)) {
        file = path.join(staticRoot, 'index.html'); info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  }
  // Invitations normally use the browser origin, including HTTPS behind the existing proxy.
  return startServer({ port, host, staticDir: robotDir, publicDir: robotDir, basePath: '/robots', fallback, autoTick, log, publicUrl: null });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startFestivalServer({ log: true }).then(app => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
