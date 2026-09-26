// Local acceptance harness: Vite transforms the real page; the real WS server,
// StorySession and CombatRoom drive every visible snapshot. No production route.
import { createServer } from 'vite';
import WebSocket from 'ws';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';
import { CombatRoom } from '../server/combat.js';
import { StorySession } from '../server/story-session.js';
import { RULE_CARDS } from '../shared/club-story.js';
import { WINS_TO_MATCH, V5_ATTACKS, ROUND_SECONDS } from '../shared/constants.js';
import { buildFaceoff, FACE_OFF_DURATION } from '../shared/faceoff-script.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = await startServer({ host: '127.0.0.1', port: 0, autoTick: true });
async function client(message) {
  const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`); await once(socket, 'open');
  const result = new Promise(resolve => socket.on('message', data => { const packet = JSON.parse(data); if (packet.type === 'welcome') resolve(packet); }));
  socket.send(JSON.stringify(message)); return { socket, welcome: await result };
}
const first = await client({ type: 'create', name: 'ЛАТУННЫЙ ГРАФ', character: 'Считает себя аристократом. Работает на честном слове.', storyMode: true });
const second = await client({ type: 'join', room: first.welcome.room, name: 'ГОСПОЖА ИСКРА', character: 'Вежливо просит не трогать её заводскую гарантию.' });
const room = app.rooms.get(first.welcome.room); let serial = 1;
const scenes = ['workshop', 'rules', 'faceoff', 'round', 'refereeIntro', 'fight', 'paused', 'final'];
const refereeConnected = () => room.referee?.socket?.readyState === WebSocket.OPEN;
const refereePrepared = () => refereeConnected() && room.referee?.prepared === true;
const info = () => ({ room: room.game.id, stage: room.story.snapshot().stage, phase: room.game.phase,
  refereeConnected: refereeConnected(), round: room.game.round });

// Fast-forward only for selecting a local QA scene. These are the same state
// transitions used by server/index.js; do not send hundreds of intermediate
// snapshots that would play obsolete recordings or fill socket backpressure.
function quietStep() {
  room.story.step(1 / 60);
  if (!room.story.holdCombat(1 / 60)) room.game.step(1 / 60);
  room.story.prepareRound();
}
function advanceUntil(predicate, limit = 120) {
  for (let n = 0; !predicate() && n < limit * 60; n++) quietStep();
  if (!predicate()) throw Error('QA scene did not reach its real server stage.');
}
function scene(kind) {
  if (['round', 'refereeIntro'].includes(kind) && refereeConnected() && !refereePrepared()
    || kind === 'refereeIntro' && !refereeConnected()) throw Error('Сначала подключите пульт, выберите фаворита и дождитесь подготовки звука.');
  const previous = room.game;
  room.game = new CombatRoom({ id: previous.id });
  // Event identities and server time stay monotonic when changing QA scenes.
  room.game.elapsed = previous.elapsed + .1; room.game.nextEventId = previous.nextEventId;
  for (const player of previous.players) room.game.addPlayer(player.name, {
    character: player.character, customization: player.customization,
  });
  room.story = new StorySession(room.game, { ruleCount: RULE_CARDS.length, faceoffDuration: FACE_OFF_DURATION, buildFaceoff });
  room.story.sequenceId = `${room.game.id}:review:${++serial}`;
  if (kind !== 'workshop') { room.story.ready('p1'); room.story.ready('p2'); }
  if (!['workshop', 'rules'].includes(kind)) {
    // The fixture's two actual fighter seats acknowledge the rules before the
    // referee attaches to this selected scene. No forbidden referee advance.
    for (let ruleIndex = 0; ruleIndex < RULE_CARDS.length; ruleIndex++) {
      for (const actor of ['p1', 'p2']) room.story.advance({ actor, sequenceId: room.story.sequenceId, ruleIndex });
    }
  }
  // Fight fixtures represent a referee joining an existing live fight. Round
  // fixtures keep the real referee gate, including the actual WS start command.
  const existingFight = ['fight', 'paused', 'final'].includes(kind);
  if (!existingFight) room.story.setRefereeConnected(refereeConnected(), refereePrepared());
  if (['round', 'refereeIntro'].includes(kind) || existingFight) {
    advanceUntil(() => room.story.stage === 'complete');
  }
  if (kind === 'refereeIntro') advanceUntil(() => room.story.snapshot().stage === 'refereeIntro');
  if (['fight', 'paused', 'final'].includes(kind)) {
    advanceUntil(() => room.game.phase === 'fight');
    room.story.setRefereeConnected(refereeConnected(), refereePrepared());
    if (kind === 'fight') room.game.players.forEach(player => { player.bot = true; });
    if (kind === 'paused') room.game.setConnected('p2', false);
    if (kind === 'final') {
      const [a, b] = room.game.players; a.wins = WINS_TO_MATCH - 1; b.hp = 1;
      room.game.damage(a, b, V5_ATTACKS.heavyPress, 'heavy', a.x, { variant: 'heavyPress' }); quietStep();
      room.game.startFinisher('coreRip'); advanceUntil(() => room.game.phase === 'matchOver', 20);
    }
  }
  if (!Number.isFinite(room.game.time) || room.game.time > ROUND_SECONDS) throw Error('Invalid QA combat time');
  app.broadcast(room);
}
const vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: Number(process.env.REPLAY_PORT) || 3068, strictPort: true,
  proxy: { '/ws': { target: `ws://127.0.0.1:${app.port}`, ws: true } } }, plugins: [{ name: 'referee-review-fixture', configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith('/__referee-review__/')) return next();
    if (request.url.endsWith('/scene') && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      let kind; try { kind = JSON.parse(body).scene; } catch {}
      if (!scenes.includes(kind)) { response.statusCode = 400; response.end(JSON.stringify({ error: 'Неизвестная сцена.' })); return; }
      try { scene(kind); }
      catch (error) { response.statusCode = 409; response.end(JSON.stringify({ error: error.message, ...info() })); return; }
    }
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(info()));
  });
} }] });
await vite.listen(); console.log(`Referee review: http://127.0.0.1:${vite.config.server.port}/scripts/referee-review.html?room=${room.game.id}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { first.socket.close(); second.socket.close(); await vite.close(); await app.close(); process.exit(0); });
