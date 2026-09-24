// Local diagnostic: real Three.js rig/effects, with the previous renderer served from Git.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const before = '5d74ef3';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.glb':'model/gltf-binary', '.css':'text/css' };
const old = new Map(['effects.js','spark-streaks.js'].map(name => [name,
  execFileSync('git', ['show', `${before}:src/${name}`], {cwd:root, encoding:'utf8'})
    .replace("'../shared/robot-presentation.js'", "'/shared/robot-presentation.js'")
    .replace("'./mechanical-effects.js'", "'/src/mechanical-effects.js'")]));
http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/__before/')) {
      const source = old.get(path.basename(pathname)); if (!source) throw Error('Missing baseline');
      response.setHeader('Content-Type','text/javascript'); response.end(source); return;
    }
    if (pathname === '/') pathname = '/scripts/electrical-review.html';
    if (pathname.startsWith('/assets/')) pathname = '/public' + pathname;
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) throw Error('Invalid path');
    const body = await readFile(filename);
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(body);
  } catch { response.statusCode = 404; response.end('Not found'); }
}).listen(3036, '127.0.0.1', () => console.log('Electrical review: http://127.0.0.1:3036/'));
