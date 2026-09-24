// Local acceptance harness: Vite transforms the real page; the real WS server,
// StorySession and CombatRoom drive every visible snapshot. No production route.
import { createServer } from 'vite';
import WebSocket from 'ws';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { StorySession } from '../server/story-session.js';
import { RULE_CARDS } from '../shared/club-story.js';
import { WINS_TO_MATCH, V5_ATTACKS } from '../shared/constants.js';
import { buildFaceoff, FACE_OFF_DURATION } from '../shared/faceoff-script.js';
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const app = await startServer({ host: '127.0.0.1', port: 0, autoTick: true });
async function client(message) {
  const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`); await once(socket, 'open');
  const result = new Promise(resolve => socket.on('message', data => { const packet = JSON.parse(data); if (packet.type === 'welcome') resolve(packet); }));
  socket.send(JSON.stringify(message)); return { socket, welcome: await result };
}
const first = await client({ type: 'create', name: 'ЛАТУННЫЙ ГРАФ', character: 'Считает себя аристократом. Работает на честном слове.', storyMode: true });
const second = await client({ type: 'join', room: first.welcome.room, name: 'ГОСПОЖА ИСКРА', character: 'Вежливо просит не трогать её заводскую гарантию.' });
const room = app.rooms.get(first.welcome.room); let serial = 1;
function scene(kind) {
  for (const player of room.game.players) { player.connected = true; player.bot = false; player.wins = 0; player.hp = player.maxHp; player.action = 'idle'; player.actionTime = 0; player.y = 0; player.vy = 0; }
  room.game.phase = 'waiting'; room.game.round = 1; room.game.winner = room.game.roundWinner = null; room.game.finish = null; room.game.events = []; room.game.projectiles = []; room.game.time = 75;
  room.story = new StorySession(room.game, { ruleCount: RULE_CARDS.length, faceoffDuration: FACE_OFF_DURATION, buildFaceoff });
  room.story.sequenceId = `${room.game.id}:review:${++serial}`;
  if (kind !== 'workshop') { room.story.ready('p1'); room.story.ready('p2'); }
  if (!['workshop', 'rules'].includes(kind)) for (let i = 0; i < RULE_CARDS.length; i++) room.story.advance({ actor: 'referee', sequenceId: room.story.sequenceId, ruleIndex: i }, true);
  if (kind === 'round') {
    // This UI worktree predates root's nine-second countdown decoration. Only
    // this local fixture supplies its documented roundIntro fields; the clock
    // is still CombatRoom's real countdown and text comes from the shared deck.
    room.story.startFight(); room.game.countdown = 9;
    const originalSnapshot = room.story.snapshot.bind(room.story);
    room.story.snapshot = refereeConnected => {
      const value = originalSnapshot(refereeConnected);
      if (room.game.phase === 'countdown' && room.game.countdown > 3) return { ...value, stage: 'roundIntro',
        roundIntro: { sequenceId: `${value.sequenceId}:round:${room.game.round}`, elapsed: 9 - room.game.countdown, duration: 6, round: room.game.round, matchSerial: 0 } };
      return value;
    };
  }
  if (['fight', 'paused', 'final'].includes(kind)) {
    room.story.startFight(); for (let i = 0; i < 182; i++) app.tick();
    if (kind === 'fight') room.game.players.forEach(player => { player.bot = true; });
    if (kind === 'paused') room.game.setConnected('p2', false);
    if (kind === 'final') {
      const [a, b] = room.game.players; a.wins = WINS_TO_MATCH - 1; b.hp = 1;
      room.game.damage(a, b, V5_ATTACKS.heavyPress, 'heavy', a.x, { variant: 'heavyPress' }); app.tick();
      room.game.startFinisher('coreRip'); for (let i = 0; i < 260; i++) app.tick();
    }
  }
  app.broadcast(room);
}
const vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: Number(process.env.REPLAY_PORT) || 3068, strictPort: true,
  proxy: { '/ws': { target: `ws://127.0.0.1:${app.port}`, ws: true } } }, plugins: [{ name: 'referee-review-fixture', configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith('/__referee-review__/')) return next();
    if (request.url.endsWith('/scene') && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      let kind; try { kind = JSON.parse(body).scene; } catch {}
      if (['workshop', 'rules', 'faceoff', 'round', 'fight', 'paused', 'final'].includes(kind)) scene(kind);
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ room: room.game.id }));
  });
} }] });
await vite.listen(); console.log(`Referee review: http://127.0.0.1:${vite.config.server.port}/scripts/referee-review.html?room=${room.game.id}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { first.socket.close(); second.socket.close(); await vite.close(); await app.close(); process.exit(0); });
