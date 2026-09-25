import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

async function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.received = [];
  ws.on('message', bytes => ws.received.push(JSON.parse(bytes.toString())));
  await once(ws, 'open');
  ws.sendJSON = data => ws.send(JSON.stringify(data));
  return ws;
}
async function take(ws, predicate) {
  const index = ws.received.findIndex(predicate);
  if (index >= 0) return ws.received.splice(index, 1)[0];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', listener); reject(new Error('Expected V2 packet not received')); }, 2500);
    const listener = bytes => {
      const packet = JSON.parse(bytes.toString());
      if (!predicate(packet)) return;
      clearTimeout(timer); ws.off('message', listener);
      const saved = ws.received.findIndex(value => JSON.stringify(value) === JSON.stringify(packet));
      if (saved >= 0) ws.received.splice(saved, 1);
      resolve(packet);
    };
    ws.on('message', listener);
  });
}
let barrier = 100;
async function deliver(ws, data) {
  ws.sendJSON(data);
  const t = ++barrier;
  ws.sendJSON({ type: 'ping', t });
  await take(ws, p => p.type === 'pong' && p.t === t);
}
const advance = (app, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) app.tick(); };

test('V2 wave, parry reward and three authoritative ultimate pulses reach both real clients', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const a = await client(app.port), b = await client(app.port);
  a.sendJSON({ type: 'create', name: 'Искра', mode: 'pvp' });
  const welcome = await take(a, p => p.type === 'welcome');
  b.sendJSON({ type: 'join', name: 'Иней', room: welcome.room });
  await take(b, p => p.type === 'welcome');
  await deliver(a, { type: 'ready' }); await deliver(b, { type: 'ready' });
  advance(app, 3.05);
  const game = app.rooms.get(welcome.room).game;
  const input = async (ws, id, values) => deliver(ws, { type:'input', seq:game.player(id).lastSeq + 1, move:0, block:false, crouch:false, action:null, ...values });
  game.player('p1').x = -3; game.player('p2').x = 3;
  await input(a, 'p1', { action:'special', crouch:true });
  advance(app, .5);
  for (const ws of [a,b]) {
    const wave = await take(ws, p => p.type === 'state' && p.state.projectiles.some(bolt => bolt.variant === 'shockwave'));
    assert.equal(wave.state.players[0].variant, 'shockwave');
    assert.ok(wave.state.projectiles[0].y < .7);
    assert.equal(typeof wave.state.players[0].launchWindow, 'number');
    assert.equal(typeof wave.state.players[0].counterWindow, 'number');
    assert.equal(typeof wave.state.players[0].parryCooldown, 'number');
  }
  game.startRound(); advance(app, 3.05);
  game.player('p1').x = -1.05; game.player('p2').x = 1.05;
  await input(a, 'p1', { action:'light' }); advance(app, .05);
  await input(b, 'p2', { block:true }); advance(app, .1);
  const parry = [];
  for (const ws of [a,b]) {
    const packet = await take(ws, p => p.type === 'state' && p.state.events.some(e => e.type === 'parry'));
    const event = packet.state.events.find(e => e.type === 'parry');
    parry.push(event);
    assert.equal(event.player, 'p2'); assert.equal(event.target, 'p1');
    assert.equal(packet.state.players[1].hp, MAX_HP);
    assert.ok(packet.state.players[1].counterWindow > 0);
  }
  assert.deepEqual(parry[0], parry[1]);
  game.startRound(); advance(app, 3.05);
  game.player('p1').x = -1.1; game.player('p2').x = 1.1;
  game.player('p1').energy = 80;
  await input(a, 'p1', { action:'ultimate' }); advance(app, 2.5);
  const dischargePackets = [];
  for (const ws of [a,b]) {
    const packet = await take(ws, p => p.type === 'state' && p.state.events.filter(e => e.type === 'ultimatePulse').length === 3);
    const pulses = packet.state.events.filter(e => e.type === 'ultimatePulse');
    assert.deepEqual(pulses.map(e => e.pulse), [0,1,2]);
    assert.equal(new Set(pulses.map(e => e.id)).size, 3);
    assert.ok(pulses.every(e => e.player === 'p1' && Number.isFinite(e.x) && Number.isFinite(e.y)));
    assert.deepEqual(pulses.map(e => e.damage), [45, 55, 120]);
    assert.equal(packet.state.players[0].variant, 'overloadRecovery');
    assert.equal(packet.state.players[1].hp, 0);
    assert.equal(packet.state.phase, 'roundOver');
    dischargePackets.push(pulses);
  }
  assert.deepEqual(dischargePackets[0], dischargePackets[1]);
});

test('V3 grab, fresh tech, throw, aerial burst and feint are identical on two real clients', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const a = await client(app.port), b = await client(app.port);
  a.sendJSON({ type: 'create', name: 'Искра', mode: 'pvp' });
  const welcome = await take(a, p => p.type === 'welcome');
  b.sendJSON({ type: 'join', name: 'Иней', room: welcome.room });
  await take(b, p => p.type === 'welcome');
  await deliver(a, { type: 'ready' }); await deliver(b, { type: 'ready' });
  advance(app, 3.05);
  const game = app.rooms.get(welcome.room).game;
  const input = (ws, id, values) => deliver(ws, { type:'input', seq:game.player(id).lastSeq + 1, move:0, block:false, crouch:false, action:null, ...values });
  const position = (distance = 2.1) => { game.player('p1').x = -distance / 2; game.player('p2').x = distance / 2; };
  const fresh = () => { game.startRound(); advance(app, 3.05); position(); a.received.length = b.received.length = 0; };
  const pairedEvent = async (type, afterId = 0, inspect = () => {}) => {
    const events = [];
    for (const ws of [a,b]) {
      const packet = await take(ws, p => p.type === 'state' && p.state.events.some(e => e.type === type && e.id > afterId));
      inspect(packet.state);
      events.push(packet.state.events.find(e => e.type === type && e.id > afterId));
    }
    assert.deepEqual(events[0], events[1]);
    return events[0];
  };
  position();
  await input(b, 'p2', { block:true });
  await input(a, 'p1', { action:'heavy', crouch:true });
  advance(app, .32);
  const caught = await pairedEvent('grab', 0, state => {
    assert.ok(state.players[1].grabTechWindow > 0);
    assert.equal(state.players[1].grabbedBy, 'p1');
    assert.equal(state.players[0].grabTarget, 'p2');
    assert.equal(state.players[1].variant, 'grabbed');
  });
  assert.equal(caught.target, 'p2');
  await input(b, 'p2', { action:'light' }); advance(app, .06);
  const tech = await pairedEvent('grabBreak', caught.id);
  assert.equal(tech.player, 'p2');
  assert.equal(game.player('p2').hp, MAX_HP);
  assert.equal(game.player('p2').grabbedBy, null);

  fresh();
  await input(a, 'p1', { action:'heavy', crouch:true }); advance(app, .55);
  await input(a, 'p1', { action:'heavy' }); advance(app, .30);
  const thrown = await pairedEvent('throw', tech.id);
  assert.equal(thrown.target, 'p2');
  assert.equal(game.player('p2').hp, MAX_HP - 15);
  const hpAfterThrow = game.player('p2').hp;
  advance(app, .35);
  assert.equal(game.player('p2').hp, hpAfterThrow);

  fresh();
  await input(a, 'p1', { action:'light' }); advance(app, .14);
  await input(a, 'p1', { action:'heavy' }); advance(app, .33);
  assert.ok(game.player('p2').y > 0);
  game.player('p2').energy = 80;
  await input(b, 'p2', { action:'dash' }); advance(app, .04);
  const burst = await pairedEvent('burst', thrown.id, state => {
    assert.equal(state.players[1].variant, 'burst');
    assert.ok(state.players[1].cooldowns.burst > 11);
    assert.ok(state.players[1].burstInvulnerable > 0);
  });
  assert.equal(burst.player, 'p2');
  assert.equal(game.player('p2').variant, 'burst');
  assert.ok(game.player('p2').y > 0, 'escape must not teleport an airborne victim to the floor');
  assert.ok(game.player('p2').energy >= 30 && game.player('p2').energy < 31);

  fresh(); position(3.4);
  await input(a, 'p1', { action:'heavy' }); advance(app, .12);
  await input(a, 'p1', { action:'dash' }); advance(app, .05);
  await pairedEvent('feint', burst.id);
  assert.equal(game.player('p1').variant, 'feint');
  assert.ok(game.player('p1').vx < 0);
});
