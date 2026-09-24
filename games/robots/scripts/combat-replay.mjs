// Local-only visual QA. It uses the real simulation, rig, arena and effects.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.REPLAY_PORT) || 3015;
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.glb':'model/gltf-binary', '.css':'text/css', '.ttf':'font/ttf' };
http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/scripts/combat-replay.html';
    if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) pathname = '/public' + pathname;
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) throw Error('Invalid path');
    const body = await readFile(filename);
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(body);
  } catch { response.statusCode = 404; response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Combat replay: http://127.0.0.1:${port}`));
