import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { MAX_HP } from '../shared/constants.js';

test('two sockets see a high crossover, a whiff chain and a tapped reactor interrupted by a jab', { timeout: 10000 }, async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    ws.packets = []; ws.events = new Map();
    ws.on('message', data => {
      const packet = JSON.parse(data); ws.packets.push(packet);
      for (const event of packet.state?.events ?? []) ws.events.set(event.id, event);
    });
    await once(ws, 'open'); clients.push(ws);
  }
  async function receive(ws, predicate) {
    const saved = ws.packets.find(predicate); if (saved) return saved;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.off('message', listen); reject(Error('Expected gameplay packet')); }, 2000);
      function listen(data) { const packet = JSON.parse(data); if (predicate(packet)) { clearTimeout(timer); ws.off('message', listen); resolve(packet); } }
      ws.on('message', listen);
    });
  }
  let ping = 0;
  async function deliver(ws, packet) {
    if (packet) ws.send(JSON.stringify(packet));
    const serial = ++ping; ws.send(JSON.stringify({ type: 'ping', t: serial }));
    await receive(ws, p => p.type === 'pong' && p.t === serial);
  }
  const [first, second] = clients;
  await deliver(first, { type: 'create', mode: 'pvp', name: 'Первый' });
  const { room: code } = await receive(first, p => p.type === 'welcome');
  await deliver(second, { type: 'join', room: code, name: 'Второй' });
  await deliver(first, { type: 'ready' }); await deliver(second, { type: 'ready' });
  const game = app.rooms.get(code).game;
  const advance = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) app.tick(); };
  const send = (ws, player, action, move = 0) => deliver(ws, { type: 'input', seq: player.lastSeq + 1, move, crouch: false, block: false, action });
  advance(3.05);
  let a = game.player('p1'), b = game.player('p2');
  a.x = -2.15; b.x = 0;
  await send(first, a, 'jump', 1);
  let highest = 0, crossed = false;
  for (let frame = 0; frame < 95; frame++) {
    if (frame % 10 === 0) await send(first, a, null, 1);
    app.tick(); highest = Math.max(highest, a.y); crossed ||= a.x > b.x;
  }
  assert.ok(highest > 3, `robot cleared the original silhouette, apex ${highest}`);
  assert.ok(crossed && a.x > b.x && a.y === 0, 'real input crossed the other robot and landed on the far side');
  for (const ws of clients) {
    await deliver(ws);
    const snapshots = ws.packets.filter(packet => packet.type === 'state' && packet.state.players.length === 2).map(packet => packet.state);
    assert.ok(snapshots.some(state => state.players[0].y > 3), 'both clients receive the real jump apex');
    assert.ok(snapshots.some(state => state.players[0].x > state.players[1].x && state.players[0].y > 1), 'both clients receive the crossover while airborne');
    const final = snapshots.at(-1).players;
    assert.ok(final[0].x > final[1].x && final[0].y === 0, 'both clients receive landing on the far side');
  }

  game.startRound(); advance(3.05); a = game.player('p1'); b = game.player('p2');
  a.x = -6; b.x = 6;
  const beforeChain = game.nextEventId - 1;
  // Two physical taps can arrive between simulation ticks. Preserve one follow-up.
  await send(first, a, 'light'); await send(first, a, 'light');
  advance(.34);
  assert.equal(a.variant, 'cross');
  await send(first, a, 'light'); advance(.65);
  assert.equal(b.hp, MAX_HP); assert.equal(a.combo, 0, 'a whiff chain is not three fake hits');
  for (const ws of clients) {
    await deliver(ws);
    const attacks = [...ws.events.values()].filter(e => e.id > beforeChain && e.type === 'attack' && e.player === 'p1');
    assert.deepEqual(attacks.map(e => e.variant), ['jab', 'cross', 'rake']);
    const players = ws.packets.findLast(packet => packet.type === 'state').state.players;
    assert.equal(players[1].hp, MAX_HP); assert.equal(players[0].combo, 0);
  }

  game.startRound(); advance(3.05); a = game.player('p1'); b = game.player('p2');
  a.x = -1.1; b.x = 1.1; a.energy = 100;
  const beforeUltimate = game.nextEventId - 1;
  await send(first, a, 'ultimate'); advance(.10);
  await send(second, b, 'light'); advance(.20);
  assert.ok(a.hp < MAX_HP, 'the charging robot still takes real damage');
  assert.equal(a.action, 'hit', 'ordinary jab interrupts the tapped reactor');
  for (const ws of clients) {
    await deliver(ws);
    const player = ws.packets.findLast(packet => packet.type === 'state').state.players[0];
    assert.ok(player.hp < MAX_HP);
    assert.equal(player.action, 'hit'); assert.equal(player.ultimateArmor, false);
    assert.ok(player.actionTime < .18, 'both clients receive the actual short hit reaction');
  }
  advance(2.7);
  assert.equal(b.hp, MAX_HP);
  for (const ws of clients) {
    await deliver(ws);
    const events = [...ws.events.values()].filter(e => e.id > beforeUltimate && e.player === 'p1');
    assert.equal(events.filter(e => e.type === 'ultimate').length, 1);
    assert.deepEqual(events.filter(e => e.type === 'ultimatePulse').map(e => e.pulse), []);
    assert.equal(ws.packets.findLast(packet => packet.type === 'state').state.players[1].hp, MAX_HP);
  }
});
