import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { MAX_HP, V5_ATTACKS } from '../shared/constants.js';

test('two socket clients receive the same heavy stages, timings, damage and cancel cues', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false }); t.after(() => app.close());
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`); ws.packets = [];
    ws.on('message', bytes => ws.packets.push(JSON.parse(bytes))); await once(ws, 'open'); clients.push(ws);
  }
  let serial = 0;
  async function deliver(ws, packet) {
    const token = ++serial;
    const pong = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { ws.off('message', listener); reject(Error('Heavy test ping timed out')); }, 2000);
      const listener = bytes => { const p = JSON.parse(bytes); if (p.type !== 'pong' || p.t !== token) return; clearTimeout(timeout); ws.off('message', listener); resolve(); };
      ws.on('message', listener);
    });
    if (packet) ws.send(JSON.stringify(packet));
    ws.send(JSON.stringify({ type: 'ping', t: token })); await pong;
  }
  const [a, b] = clients;
  await deliver(a, { type: 'create', mode: 'pvp', name: 'Кузнец' });
  const welcome = a.packets.find(p => p.type === 'welcome');
  await deliver(b, { type: 'join', room: welcome.room, name: 'Наковальня' });
  await deliver(a, { type: 'ready' }); await deliver(b, { type: 'ready' });
  const advance = frames => { for (let i = 0; i < frames; i++) app.tick(); };
  advance(181);
  const game = app.rooms.get(welcome.room).game;
  game.player('p1').x = -1.25; game.player('p2').x = 1.25;
  for (const frames of [Math.ceil((V5_ATTACKS.heavyDrive.startup + .14) * 60), Math.ceil((V5_ATTACKS.heavyHook.startup + .14) * 60), Math.ceil((V5_ATTACKS.heavyPress.startup + .06) * 60)]) {
    await deliver(a, { type: 'input', seq: game.player('p1').lastSeq + 1, move: 0, crouch: false, block: false, action: 'heavy' });
    advance(frames); await deliver(a); await deliver(b);
  }
  const events = ws => [...new Map(ws.packets.flatMap(p => p.state?.events ?? []).filter(e => e.type === 'hit' || e.type === 'attack').map(e => [e.id, e])).values()];
  assert.deepEqual(events(a), events(b));
  assert.deepEqual(events(a).filter(e => e.type === 'hit').map(e => e.variant), ['heavyDrive', 'heavyHook', 'heavyPress']);
  for (const ws of clients) {
    const state = ws.packets.findLast(p => p.type === 'state').state;
    assert.equal(state.players[1].hp, MAX_HP - 88); assert.equal(state.players[0].comboRoute, 'heavyDrive-heavyHook-heavyPress');
    assert.equal(state.players[0].cancelWindow, 0);
    const drive = ws.packets.find(p => p.state?.players[0].variant === 'heavyDrive' && p.state.players[0].cancelWindow > 0);
    assert.ok(drive, 'confirmation is serialized for the contextual heavy label');
    assert.ok(drive.state.players[1].defenseOnly > 0, 'both clients receive the authoritative defense-only timer');
    assert.ok(ws.packets.some(packet => packet.state?.players[0].groundHeavy && packet.state.players[0].y > .06), 'ground-route marker survives the real hop on both clients');
  }
});
