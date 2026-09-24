import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

async function client(port, history = new Map()) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.packets = []; ws.events = history;
  ws.on('message', bytes => {
    const packet = JSON.parse(bytes.toString()); ws.packets.push(packet);
    for (const event of packet.state?.events ?? []) ws.events.set(event.id, event);
  });
  await once(ws, 'open');
  return ws;
}
async function take(ws, predicate) {
  const index = ws.packets.findIndex(predicate);
  if (index >= 0) return ws.packets.splice(index, 1)[0];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error('Expected V5 packet not received')); }, 2000);
    function listener(bytes) {
      const packet = JSON.parse(bytes.toString()); if (!predicate(packet)) return;
      clearTimeout(timeout); ws.off('message', listener);
      const index = ws.packets.findIndex(saved => JSON.stringify(saved) === JSON.stringify(packet));
      if (index >= 0) ws.packets.splice(index, 1);
      resolve(packet);
    }
    ws.on('message', listener);
  });
}
let serial = 0;
async function deliver(ws, packet) {
  if (packet) ws.send(JSON.stringify(packet));
  const t = ++serial; ws.send(JSON.stringify({ type: 'ping', t }));
  await take(ws, packet => packet.type === 'pong' && packet.t === t);
}
const advance = (app, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) app.tick(); };

test('two real clients agree on V5 routes, paired pummels, back throw, frozen finishing and one destruction', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const a = await client(app.port); let b = await client(app.port);
  await deliver(a, { type: 'create', mode: 'pvp', name: 'Первый' });
  const welcomeA = await take(a, packet => packet.type === 'welcome');
  await deliver(b, { type: 'join', room: welcomeA.room, name: 'Второй' });
  const welcomeB = await take(b, packet => packet.type === 'welcome');
  await deliver(a, { type: 'ready' }); await deliver(b, { type: 'ready' }); advance(app, 3.05);
  const game = app.rooms.get(welcomeA.room).game;
  const input = (ws, id, patch) => deliver(ws, { type: 'input', seq: game.player(id).lastSeq + 1, move: 0, crouch: false, block: false, action: null, ...patch });
  const close = () => { game.player('p1').x = -1.075; game.player('p2').x = 1.075; };
  async function identicalEvent(type, after = 0) {
    const events = [];
    for (const ws of [a, b]) {
      const packet = await take(ws, packet => packet.type === 'state' && packet.state.events.some(event => event.type === type && event.id > after));
      events.push(packet.state.events.find(event => event.type === type && event.id > after));
    }
    assert.deepEqual(events[0], events[1]); return events[0];
  }
  close();
  await input(a, 'p1', { action: 'light' }); advance(app, .18);
  await input(a, 'p1', { action: 'light' }); advance(app, .23);
  await input(a, 'p1', { action: 'heavy' }); advance(app, .4);
  await deliver(a); await deliver(b);
  for (const ws of [a, b]) assert.deepEqual([...ws.events.values()].filter(event => event.type === 'hit').map(event => event.variant), ['jab', 'cross', 'crusher']);
  assert.equal(game.player('p2').hp, MAX_HP - 33);

  game.startRound(); advance(app, 3.05); close();
  await input(a, 'p1', { action: 'heavy', crouch: true }); advance(app, .55);
  const grab = await identicalEvent('grab');
  for (let strike = 1; strike <= 2; strike++) {
    await input(a, 'p1', { action: 'light' }); advance(app, .14);
    const impact = await identicalEvent('grabStrike', strike === 1 ? grab.id : grab.id + 1);
    assert.equal(impact.chain, strike); assert.equal(impact.damage, 4);
    assert.equal(impact.player, 'p1'); assert.equal(impact.target, 'p2');
    const state = game.snapshot(); assert.equal(state.players[0].grabStrikeTime, state.players[1].grabStrikeTime);
    advance(app, .17);
  }
  await input(a, 'p1', { action: 'heavy', move: -1 }); advance(app, .25);
  const thrown = await identicalEvent('throw', grab.id);
  assert.equal(thrown.throwStyle, 'back'); assert.equal(thrown.direction, -1); assert.equal(game.player('p2').hp, MAX_HP - 23);

  game.startRound(); advance(app, 3.05); close();
  game.player('p1').wins = WINS_TO_MATCH - 1; game.player('p2').hp = 6;
  await input(a, 'p1', { action: 'light' }); advance(app, .18);
  assert.equal(game.phase, 'finishing'); assert.equal(game.finish.stage, 'offer');
  await input(b, 'p2', { action: 'ultimate' }); assert.equal(game.finish.stage, 'offer');
  await input(a, 'p1', { action: 'heavy' }); advance(app, .5);
  const started = await identicalEvent('finisherStart', thrown.id);
  assert.equal(started.variant, 'coreRip'); assert.equal(started.finisherType, 'coreRip');
  assert.equal(started.impactTime, 1.25); assert.equal(started.destructionTime, 2.15);

  async function reconnectFrozen() {
    const elapsed = game.snapshot().finish.elapsed;
    const history = b.events; const closed = once(b, 'close'); b.close(); await closed;
    await take(a, packet => packet.type === 'state' && packet.state.phase === 'paused' && packet.state.finish?.elapsed === elapsed);
    const before = game.snapshot(); advance(app, 4);
    assert.deepEqual(game.snapshot().finish, before.finish);
    assert.deepEqual(game.snapshot().players, before.players);
    b = await client(app.port, history);
    await deliver(b, { type: 'join', room: welcomeA.room, token: welcomeB.token });
    await take(b, packet => packet.type === 'welcome');
    const resumed = await take(b, packet => packet.type === 'state' && packet.state.phase === 'finishing');
    assert.equal(resumed.state.finish.elapsed, before.finish.elapsed);
    assert.equal(resumed.state.finish.canTrigger, false);
  }
  await reconnectFrozen(); advance(app, .8);
  const impact = await identicalEvent('finisherImpact', started.id);
  assert.equal(impact.target, 'p2'); assert.equal(impact.x, game.snapshot().players[1].x);
  advance(app, .9);
  const explosion = await identicalEvent('destruction', impact.id);
  assert.equal(game.player('p2').action, 'destroyed'); assert.equal(game.phase, 'finishing');
  await reconnectFrozen(); advance(app, 2);
  await deliver(a); await deliver(b);
  assert.equal(game.phase, 'matchOver');
  for (const type of ['finisherStart', 'finisherImpact', 'destruction']) {
    const first = [...a.events.values()].filter(event => event.type === type);
    const second = [...b.events.values()].filter(event => event.type === type);
    assert.equal(first.length, 1); assert.deepEqual(first, second);
  }
  assert.equal([...a.events.values()].filter(event => event.type === 'destruction')[0].id, explosion.id);
  await deliver(a, { type: 'rematch' }); assert.equal(game.phase, 'matchOver');
  await deliver(b, { type: 'rematch' }); assert.equal(game.phase, 'countdown'); assert.equal(game.finish, null);
  assert.ok(game.snapshot().players.every(player => player.hp === MAX_HP && player.destructionTime === null && player.wins === 0));
});
