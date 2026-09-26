import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { CombatRoom } from './combat.js';
import { StorySession } from './story-session.js';
import { RULE_CARDS } from '../shared/club-story.js';
import { FACE_OFF_DURATION, buildFaceoff } from '../shared/faceoff-script.js';
import { cleanRobotName, cleanCharacter } from '../shared/fighter-profile.js';
import { normalizeCustomization } from '../shared/robot-customization.js';
import { SIMULATION_HZ, SNAPSHOT_HZ } from '../shared/constants.js';
import { lanUrls, normalizePublicUrl } from './network.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const MAX_ROOMS = 80;
const RECONNECT_WINDOW_MS = 180_000;
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const safeTokenEqual = (provided, stored) => typeof provided === 'string' && /^[a-f0-9]{48}$/.test(provided) && timingSafeEqual(Buffer.from(provided), Buffer.from(stored));

function send(socket, packet) {
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(packet));
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function findFile(base, pathname) {
  const resolvedBase = path.resolve(base);
  const candidate = path.resolve(base, `.${pathname}`);
  if (candidate !== resolvedBase && !candidate.startsWith(resolvedBase + path.sep)) return null;
  try {
    const info = await stat(candidate);
    return info.isFile() ? { path: candidate, info } : null;
  } catch { return null; }
}

// HTMLAudio seeks use a single byte range. Unsupported units/multipart requests
// fall back to the complete representation; false means an unsatisfiable range.
function byteRange(header, size) {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (!size || (!first && !last)) return false;
  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(Number(last), size - 1) : size - 1;
  if (start >= size || start > end) return false;
  return { start, end };
}

/** Starts a self-contained production/LAN host. Tests may disable the real-time clock. */
export async function startServer({
  port = Number(process.env.PORT) || 3000, host = '0.0.0.0',
  staticDir = path.join(ROOT, 'dist'), publicDir = path.join(ROOT, 'public'),
  autoTick = true, random = Math.random, log = false, publicUrl = process.env.PUBLIC_URL,
  basePath = '', fallback = null,
} = {}) {
  const prefix = basePath.replace(/\/+$/, '');
  if (prefix && !/^\/(?:[a-zA-Z0-9_-]+\/?)+$/.test(prefix)) throw new Error('Invalid game basePath');
  const rooms = new Map();
  const deploymentUrl = normalizePublicUrl(publicUrl);
  let actualPort = port;
  let frame = 0;
  let closing = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); }
    catch { return json(response, 400, { error: 'Некорректный адрес.' }); }
    if (prefix && pathname === prefix) {
      response.writeHead(308, { Location: `${prefix}/${new URL(request.url, 'http://local').search}` });
      return response.end();
    }
    if (prefix && !pathname.startsWith(`${prefix}/`)) {
      if (fallback) return fallback(request, response);
      return json(response, 404, { error: 'Не найдено.' });
    }
    if (prefix) pathname = pathname.slice(prefix.length);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Метод не поддерживается.' });
    if (pathname === '/api/health') return json(response, 200, { ok: true });
    if (pathname === '/api/info') return json(response, 200, { port: actualPort, urls: lanUrls(actualPort), publicUrl: deploymentUrl });
    if (pathname.startsWith('/api/')) return json(response, 404, { error: 'Не найдено.' });
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) return json(response, 400, { error: 'Некорректный путь.' });
    let file = await findFile(staticDir, pathname === '/' ? '/index.html' : pathname);
    if (!file && pathname.startsWith('/assets/')) file = await findFile(publicDir, pathname);
    if (!file && !path.extname(pathname)) file = await findFile(staticDir, '/index.html');
    if (!file) {
      if (pathname === '/' || !path.extname(pathname)) return json(response, 503, { error: 'Клиент ещё не собран. Выполните npm run build, затем откройте эту страницу снова.' });
      return json(response, 404, { error: 'Файл не найден.' });
    }
    const headers = {
      'Content-Type': MIME[path.extname(file.path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': file.info.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': path.extname(file.path) === '.html' ? 'no-cache' : 'public, max-age=3600',
    };
    // Range applies only to GET (RFC 9110 §14.2). We expose no strong validator,
    // so an If-Range condition cannot match: send the full file in that case.
    const range = request.method === 'GET' && !request.headers['if-range']
      ? byteRange(request.headers.range, file.info.size) : null;
    if (range === false) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.info.size}`, 'Content-Length': 0 });
      return response.end();
    }
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.info.size}`;
      headers['Content-Length'] = range.end - range.start + 1;
    }
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(file.path, range ?? undefined);
    stream.on('error', () => response.destroy());
    response.once('close', () => stream.destroy());
    stream.pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://local').pathname; } catch { socket.destroy(); return; }
    if (closing || pathname !== `${prefix}/ws` || wss.clients.size >= 256) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, websocket => wss.emit('connection', websocket, request));
  });

  function broadcast(room) {
    const refereeConnected = room.referee?.socket?.readyState === WebSocket.OPEN;
    room.story?.setRefereeConnected(refereeConnected, room.referee?.prepared === true);
    room.story?.prepareRound();
    const snapshot = room.game.snapshot();
    const state = { type: 'state', state: room.story ? room.story.decorate(snapshot, refereeConnected) : { ...snapshot, referee: { connected: refereeConnected } } };
    for (const session of room.sessions.values()) send(session.socket, state);
    send(room.referee?.socket, state);
  }

  function uniqueCode() {
    let code;
    do { code = [...randomBytes(6)].map(value => codeAlphabet[value % codeAlphabet.length]).join(''); } while (rooms.has(code));
    return code;
  }

  function bindSocket(socket, room, session) {
    const previous = session.socket;
    session.socket = socket;
    session.disconnectedAt = null;
    socket.roomId = room.game.id;
    socket.playerId = session.playerId;
    socket.role = 'fighter';
    room.lastActivity = Date.now();
    room.game.setConnected(session.playerId, true);
    if (previous && previous !== socket) previous.close(4001, 'Подключение открыто на другом устройстве.');
    send(socket, { type: 'welcome', room: room.game.id, playerId: session.playerId, token: session.token });
    broadcast(room);
  }

  function bindReferee(socket, room, session) {
    const previous = session.socket;
    session.socket = socket; session.disconnectedAt = null;
    socket.roomId = room.game.id; socket.role = 'referee';
    // A referee can also join a room created by a legacy client that does not
    // request an opening story. Its next round still needs the announcer gate.
    room.story ??= new StorySession(room.game, { openingComplete: true });
    if (!['p1', 'p2'].includes(session.favorite)) session.favorite = null;
    if (previous && previous !== socket) previous.close(4001, 'Пульт рефери открыт на другом устройстве.');
    send(socket, { type: 'refereeWelcome', room: room.game.id, token: session.token });
    send(socket, { type: 'refereeState', favorite: session.favorite, selectionRequired: !session.favorite, prepared: session.prepared === true });
    broadcast(room);
  }

  wss.on('connection', socket => {
    socket.isAlive = true;
    socket.credits = 140;
    socket.creditTime = performance.now();
    socket.badMessages = 0;
    socket.on('pong', () => { socket.isAlive = true; });
    const error = message => send(socket, { type: 'error', message });
    socket.on('message', (data, binary) => {
      const now = performance.now();
      socket.credits = Math.min(140, socket.credits + (now - socket.creditTime) * 0.095);
      socket.creditTime = now;
      if (--socket.credits < 0) { socket.close(4008, 'Слишком много сообщений.'); return; }
      if (binary) { error('Ожидается JSON-сообщение.'); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch {
        error('Некорректное сообщение.');
        if (++socket.badMessages >= 5) socket.close(4002, 'Некорректные сообщения.');
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { error('Некорректное сообщение.'); return; }
      if (message.type === 'ping') {
        if (Number.isFinite(message.t)) send(socket, { type: 'pong', t: message.t });
        return;
      }
      if (message.type === 'create') {
        if (socket.roomId) { error('Вы уже в комнате.'); return; }
        if (rooms.size >= MAX_ROOMS) { error('Сервер заполнен. Попробуйте чуть позже.'); return; }
        const id = uniqueCode();
        const game = new CombatRoom({ id, mode: message.mode, random });
        const player = game.addPlayer(cleanRobotName(message.name, 'Первопроходец'), { character: message.character, customization: message.customization });
        const room = { game, sessions: new Map(), createdAt: Date.now(), lastActivity: Date.now() };
        if (message.storyMode === true) room.story = new StorySession(game, { ruleCount: RULE_CARDS.length, faceoffDuration: FACE_OFF_DURATION, buildFaceoff });
        const session = { playerId: player.id, token: randomBytes(24).toString('hex'), socket: null, disconnectedAt: null };
        room.sessions.set(player.id, session);
        if (game.mode === 'training') game.addPlayer('Учебный автоматон', { bot: true, character: 'Верит в заводскую гарантию' });
        rooms.set(id, room);
        bindSocket(socket, room, session);
        return;
      }
      if (message.type === 'join') {
        if (socket.roomId) { error('Вы уже в комнате.'); return; }
        const roomCode = typeof message.room === 'string' ? message.room.trim().toUpperCase() : '';
        const room = rooms.get(roomCode);
        if (!room) { error('Комната не найдена. Проверьте код или создайте новую.'); return; }
        if (message.token) {
          const session = [...room.sessions.values()].find(candidate => safeTokenEqual(message.token, candidate.token));
          if (!session) { error('Не удалось восстановить подключение. Неверный ключ игрока.'); return; }
          if (session.disconnectedAt && Date.now() - session.disconnectedAt > RECONNECT_WINDOW_MS) { error('Время восстановления подключения истекло. Создайте новую комнату.'); return; }
          bindSocket(socket, room, session);
          return;
        }
        if (room.game.players.length >= 2 || room.game.mode === 'training') { error('В комнате уже два бойца.'); return; }
        const player = room.game.addPlayer(cleanRobotName(message.name, 'Соперник'), { character: message.character, customization: message.customization });
        const session = { playerId: player.id, token: randomBytes(24).toString('hex'), socket: null, disconnectedAt: null };
        room.sessions.set(player.id, session);
        bindSocket(socket, room, session);
        return;
      }
      if (message.type === 'watch') {
        if (socket.roomId) { error('Вы уже в комнате.'); return; }
        const code = typeof message.room === 'string' ? message.room.trim().toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) { error('Комната не найдена. Проверьте код на телефоне бойца.'); return; }
        let session = room.referee;
        if (message.token) {
          if (!session || !safeTokenEqual(message.token, session.token)) { error('Неверный ключ рефери. Откройте приглашение заново.'); return; }
          if (session.disconnectedAt && Date.now() - session.disconnectedAt > RECONNECT_WINDOW_MS) { error('Время восстановления пульта истекло. Войдите по приглашению заново.'); return; }
        } else {
          if (session && (session.socket || !session.disconnectedAt || Date.now() - session.disconnectedAt < RECONNECT_WINDOW_MS)) { error('Микрофон уже у другого рефери. Для восстановления используйте его устройство.'); return; }
          session = room.referee = { token: randomBytes(24).toString('hex'), socket: null, favorite: null, prepared: false, disconnectedAt: null };
        }
        // A fresh page has not decoded its audio/GPU assets even if it restores
        // an existing credential. Ordinary same-page socket reconnects preserve
        // readiness by omitting this flag (or sending false).
        if (message.preparing === true) session.prepared = false;
        bindReferee(socket, room, session);
        return;
      }
      const room = rooms.get(socket.roomId);
      if (room && socket.role === 'referee' && room.referee?.socket === socket) {
        if (message.type === 'refereeFavorite') {
          if (['p1', 'p2'].includes(message.favorite)) room.referee.favorite = message.favorite;
          send(socket, { type: 'refereeState', favorite: room.referee.favorite, selectionRequired: !room.referee.favorite, prepared: room.referee.prepared === true });
          return;
        }
        if (message.type === 'refereeReady') {
          if (!room.referee.favorite) {
            send(socket, { type: 'notice', message: 'Выберите, за кого тайно болеть, прежде чем выходить в эфир.' });
            return;
          }
          room.referee.prepared = true;
          send(socket, { type: 'refereeState', favorite: room.referee.favorite, selectionRequired: false, prepared: true });
          room.lastActivity = Date.now(); broadcast(room); return;
        }
        if (message.type === 'refereeStartRound') {
          if (!room.referee.favorite) {
            send(socket, { type: 'notice', message: 'Выберите, за кого тайно болеть. Это останется только на вашем пульте.' });
            return;
          }
          if (!room.story?.startRefereeRound(message.sequenceId)) {
            send(socket, { type: 'notice', message: 'Дождитесь подводки к текущему раунду и подключения обоих бойцов.' });
          } else room.lastActivity = Date.now();
          broadcast(room); return;
        }
        send(socket, { type: 'notice', message: 'У рефери микрофон. Управление роботами остаётся у бойцов.' });
        return;
      }
      if (!room || room.sessions.get(socket.playerId)?.socket !== socket) { error('Сначала создайте комнату или присоединитесь.'); return; }
      if (message.type === 'profile') {
        if (!room.story?.canEdit(socket.playerId)) { send(socket, { type: 'notice', message: 'Паспорт уже сдан. В мастерской можно сначала снять готовность.' }); return; }
        const player = room.game.player(socket.playerId);
        if (Object.hasOwn(message, 'name')) player.name = cleanRobotName(message.name);
        if (Object.hasOwn(message, 'character')) player.character = cleanCharacter(message.character);
        if (Object.hasOwn(message, 'customization')) player.customization = normalizeCustomization(message.customization);
        room.lastActivity = Date.now(); broadcast(room); return;
      }
      if (message.type === 'storyAdvance') {
        room.story?.advance({ actor: socket.playerId, sequenceId: message.sequenceId, ruleIndex: message.ruleIndex }, room.referee?.socket?.readyState === WebSocket.OPEN);
        room.lastActivity = Date.now(); broadcast(room); return;
      }
      if (message.type === 'input') {
        if (room.story && room.story.stage !== 'complete') return;
        room.game.input(socket.playerId, message);
        return;
      }
      if (message.type === 'ready') {
        if (room.story && room.story.stage !== 'complete') room.story.ready(socket.playerId, message.ready !== false);
        else room.game.ready(socket.playerId);
        room.lastActivity = Date.now(); broadcast(room); return;
      }
      if (message.type === 'rematch') { room.game.requestRematch(socket.playerId); room.story?.prepareRound(); room.lastActivity = Date.now(); broadcast(room); return; }
      error('Неизвестная команда.');
    });
    socket.on('close', () => {
      const room = rooms.get(socket.roomId);
      if (socket.role === 'referee') {
        if (room?.referee?.socket === socket) {
          room.referee.socket = null; room.referee.disconnectedAt = Date.now(); broadcast(room);
        }
        return;
      }
      const session = room?.sessions.get(socket.playerId);
      if (!session || session.socket !== socket) return;
      session.socket = null;
      session.disconnectedAt = Date.now();
      room.lastActivity = Date.now();
      room.game.setConnected(socket.playerId, false);
      broadcast(room);
    });
    socket.on('error', () => {});
  });

  function tick(dt = 1 / SIMULATION_HZ) {
    frame++;
    for (const room of rooms.values()) {
      room.story?.step(dt);
      if (!room.story?.holdCombat(dt)) room.game.step(dt);
      room.story?.prepareRound();
      if (frame % (SIMULATION_HZ / SNAPSHOT_HZ) === 0) broadcast(room);
    }
  }

  let previousTime = performance.now();
  let accumulator = 0;
  const timer = autoTick ? setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(0.1, (now - previousTime) / 1000);
    previousTime = now;
    while (accumulator >= 1 / SIMULATION_HZ) { tick(); accumulator -= 1 / SIMULATION_HZ; }
  }, 1000 / SIMULATION_HZ) : null;
  timer?.unref();

  function cleanup(now = Date.now()) {
    for (const [code, room] of rooms) {
      const sessions = [...room.sessions.values()];
      const empty = sessions.every(session => !session.socket);
      const staleDisconnected = sessions.some(session => session.disconnectedAt && now - session.disconnectedAt > RECONNECT_WINDOW_MS);
      const staleLobby = room.game.phase === 'waiting' && now - room.lastActivity > 30 * 60_000;
      const staleFinished = room.game.phase === 'matchOver' && now - room.lastActivity > 20 * 60_000;
      if ((empty && now - room.lastActivity > RECONNECT_WINDOW_MS) || staleDisconnected || staleLobby || staleFinished) {
        for (const session of sessions) {
          send(session.socket, { type: 'error', message: 'Комната закрыта из-за долгого отсутствия игрока. Создайте новую.' });
          session.socket?.close(4000, 'Комната закрыта.');
        }
        send(room.referee?.socket, { type: 'error', message: 'Бойцы покинули клуб. Комната закрыта.' });
        room.referee?.socket?.close(4000, 'Комната закрыта.');
        rooms.delete(code);
      }
    }
  }
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
    cleanup();
  }, 20_000);
  heartbeat.unref();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) { clearInterval(timer); clearInterval(heartbeat); wss.close(); throw error; }
  actualPort = server.address().port;
  if (log) {
    console.log(`\n  BELOBOG UNDERGROUND\n  Компьютер: http://localhost:${actualPort}${prefix}/`);
    for (const url of lanUrls(actualPort)) console.log(`  Телефоны в этой Wi-Fi сети: ${url}${prefix}/`);
    if (deploymentUrl) console.log(`  Публичная ссылка: ${deploymentUrl}`);
    console.log('  Оба игрока должны открыть одну и ту же ссылку.\n');
  }
  return {
    server, wss, rooms, port: actualPort, tick, broadcast, cleanup,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await new Promise(resolve => wss.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ log: true }).then(app => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
  }).catch(error => { console.error('Не удалось запустить сервер:', error.message); process.exitCode = 1; });
}
