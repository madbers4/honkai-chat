// Local visual fixture: real arena/rig/camera. Before the environment integration
// lands, replace only its old platform construction in the served module.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.FLOOR_REVIEW_PORT) || 3081;
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.glb':'model/gltf-binary', '.css':'text/css', '.ttf':'font/ttf' };
http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.writeHead(302, {Location: '/scripts/traversal-review.html' + new URL(request.url, 'http://localhost').search}); response.end(); return; }
    if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) pathname = '/public' + pathname;
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) throw Error('Invalid path');
    let body = await readFile(filename);
    if (pathname === '/src/environment.js' && !body.toString().includes('createClubFloor')) {
      body = `import { createClubFloor } from './club-floor.js';\n` + body.toString()
        .replace(/  \/\/ Deck panels[\s\S]*?(?=  const ratio =)/, '  const floor = createClubFloor({ deckSurface }); group.add(floor.group);\n  const serviceCenter = ARENA_SET.deckHalfWidth + .85;\n')
        .replace('posters.dispose(); receivers.dispose();', 'posters.dispose(); receivers.dispose(); floor.dispose();');
    }
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(body);
  } catch (error) { response.statusCode = 404; response.end(error.message); }
}).listen(port, '127.0.0.1', () => console.log(`Club floor review: http://127.0.0.1:${port}`));
