import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { lanUrls, normalizePublicUrl } from '../server/network.js';

async function connect(app) {
  const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  socket.packets = [];
  socket.on('message', data => socket.packets.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  socket.sendPacket = packet => socket.send(JSON.stringify(packet));
  return socket;
}

async function packet(socket, predicate) {
  const existing = socket.packets.findIndex(predicate);
  if (existing !== -1) return socket.packets.splice(existing, 1)[0];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', onMessage); reject(new Error('Timed out waiting for expected server message')); }, 2000);
    function onMessage(data) {
      const value = JSON.parse(data.toString());
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      const index = socket.packets.findIndex(candidate => candidate.type === value.type && JSON.stringify(candidate) === JSON.stringify(value));
      if (index !== -1) socket.packets.splice(index, 1);
      resolve(value);
    }
    socket.on('message', onMessage);
  });
}

const type = value => message => message.type === value;
const phase = value => message => message.type === 'state' && message.state.phase === value;
const frame = () => new Promise(resolve => setTimeout(resolve, 8));
function tick(app, seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) app.tick(); }

test('two real WebSocket clients create/join, ready, fight, reject stale inputs and reconnect securely', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const one = await connect(app);
  const two = await connect(app);
  one.sendPacket({ type: 'create', name: '<Клара>', character: '  <Вежливый>\nрыцарь\u202e  ', mode: 'pvp' });
  const welcomeOne = await packet(one, type('welcome'));
  assert.match(welcomeOne.room, /^[A-Z2-9]{6}$/);
  assert.equal(welcomeOne.playerId, 'p1');
  two.sendPacket({ type: 'join', room: welcomeOne.room.toLowerCase(), name: 'Сварог', character: '🤖'.repeat(80) });
  const welcomeTwo = await packet(two, type('welcome'));
  assert.equal(welcomeTwo.playerId, 'p2');
  assert.notEqual(welcomeOne.token, welcomeTwo.token);
  const third = await connect(app);
  third.sendPacket({ type: 'join', room: welcomeOne.room });
  assert.match((await packet(third, type('error'))).message, /два бойца/);
  third.sendPacket({ type: 'join', room: welcomeOne.room, token: 'x'.repeat(48) });
  assert.match((await packet(third, type('error'))).message, /ключ/);
  third.sendPacket({ type: 'join', room: welcomeOne.room, token: 'я'.repeat(48) });
  assert.match((await packet(third, type('error'))).message, /ключ/);
  third.close();
  one.sendPacket({ type: 'ready' });
  two.sendPacket({ type: 'ready' });
  await packet(one, phase('countdown'));
  const room = app.rooms.get(welcomeOne.room);
  assert.equal(room.game.player('p1').name, 'Клара');
  const expectedCharacters = ['Вежливый рыцарь', '🤖'.repeat(60)];
  assert.deepEqual(room.game.snapshot().players.map(player => player.character), expectedCharacters);
  tick(app, 3.05);
  await packet(two, phase('fight'));
  room.game.player('p1').x = -0.65; room.game.player('p2').x = 0.65;
  one.sendPacket({ type: 'input', seq: 2, move: 0, block: false, crouch: false, action: 'light', character: 'Подмена' });
  one.sendPacket({ type: 'input', seq: 1, move: -1, block: false, crouch: false, action: 'ultimate' });
  await frame();
  tick(app, 0.3);
  const struck = await packet(two, value => value.type === 'state' && value.state.players[1].hp < MAX_HP);
  assert.equal(struck.state.players[1].hp, MAX_HP - 6);
  assert.deepEqual(struck.state.players.map(player => player.character), expectedCharacters);
  assert.equal(room.game.player('p1').lastSeq, 2);
  const disconnect = once(two, 'close');
  two.close();
  await disconnect;
  await packet(one, phase('paused'));
  const timeBefore = room.game.time;
  tick(app, 1);
  assert.equal(room.game.time, timeBefore);
  const recovered = await connect(app);
  recovered.sendPacket({ type: 'join', room: welcomeOne.room, token: welcomeTwo.token, name: 'Changed name', character: 'Changed character' });
  const restored = await packet(recovered, type('welcome'));
  assert.equal(restored.playerId, 'p2');
  assert.equal(restored.token, welcomeTwo.token);
  const restoredState = await packet(recovered, phase('countdown'));
  assert.deepEqual(restoredState.state.players.map(player => player.character), expectedCharacters);
  assert.equal(room.game.player('p2').hp, MAX_HP - 6);
  assert.equal(room.game.player('p2').name, 'Сварог');
  tick(app, 3.05);
  await packet(recovered, phase('fight'));
  recovered.sendPacket({ type: 'input', seq: 0, move: 1, block: false, crouch: false, action: null });
  await frame();
  assert.equal(room.game.player('p2').lastSeq, 0);
  recovered.sendPacket({ type: 'ping', t: 1234 });
  assert.equal((await packet(recovered, type('pong'))).t, 1234);
});

test('training is playable with one human and bot auto-readiness', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false, random: () => 0.25 });
  t.after(() => app.close());
  const socket = await connect(app);
  socket.sendPacket({ type: 'create', mode: 'training', name: 'Игрок' });
  const welcome = await packet(socket, type('welcome'));
  const waiting = await packet(socket, phase('waiting'));
  assert.equal(waiting.state.players.length, 2);
  assert.equal(waiting.state.players[1].bot, true);
  assert.equal(waiting.state.players[1].ready, true);
  assert.equal(waiting.state.players[0].character, '', 'old clients may omit character');
  assert.equal(waiting.state.players[1].name, 'Учебный автоматон');
  assert.equal(waiting.state.players[1].character, 'Верит в заводскую гарантию');
  socket.sendPacket({ type: 'ready' });
  await packet(socket, phase('countdown'));
  tick(app, 12);
  const room = app.rooms.get(welcome.room);
  assert.ok(room.game.player('p1').hp < MAX_HP || room.game.player('p2').wins > 0, 'bot has dealt damage or already won a round and begun recovery');
});

test('HTTP serves health, LAN details and static files while blocking private path access', async t => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'belobog-test-'));
  const dist = path.join(fixture, 'dist');
  const publicDir = path.join(fixture, 'public');
  await mkdir(dist); await mkdir(path.join(publicDir, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<html>Belobog</html>');
  await writeFile(path.join(publicDir, 'assets', 'robot.glb'), 'GLB');
  await writeFile(path.join(fixture, 'secret.txt'), 'private');
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false, staticDir: dist, publicDir, publicUrl: 'https://robots.example.com/' });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(fixture).startsWith(path.resolve(tmpdir()) + path.sep + 'belobog-test-'));
    await rm(fixture, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.port}`;
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.port, app.port);
  assert.ok(Array.isArray(info.urls));
  assert.equal(info.publicUrl, 'https://robots.example.com');
  assert.equal(await (await fetch(base)).text(), '<html>Belobog</html>');
  const model = await fetch(`${base}/assets/robot.glb`);
  assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(await model.text(), 'GLB');
  const secret = await fetch(`${base}/%2e%2e%2fsecret.txt`);
  assert.equal(secret.status, 400);
  assert.doesNotMatch(await secret.text(), /private/);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/assets/missing.glb`)).status, 404);
});

test('expired disconnected rooms are removed, live reconnections replace old socket safely', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const first = await connect(app);
  first.sendPacket({ type: 'create', mode: 'training' });
  const welcome = await packet(first, type('welcome'));
  const replacement = await connect(app);
  const previousClosed = once(first, 'close');
  replacement.sendPacket({ type: 'join', room: welcome.room, token: welcome.token });
  await packet(replacement, type('welcome'));
  assert.equal((await previousClosed)[0], 4001);
  const room = app.rooms.get(welcome.room);
  assert.equal(room.game.player('p1').connected, true);
  const closed = once(replacement, 'close');
  replacement.close(); await closed; await frame();
  app.cleanup(Date.now() + 181_000);
  assert.equal(app.rooms.has(welcome.room), false);
});

test('LAN discovery ranks physical Wi-Fi above VPN and virtual adapters without changing host interfaces', () => {
  const ipv4 = address => [{ address, family: 'IPv4', internal: false }];
  const interfaces = {
    tun11: ipv4('172.19.0.1'),
    'vEthernet (WSL)': ipv4('192.168.99.1'),
    docker0: ipv4('172.17.0.1'),
    Ethernet: ipv4('10.0.0.15'),
    'Wi-Fi': ipv4('192.168.1.12'),
    'Unknown network': ipv4('192.168.2.3'),
    'Ethernet disconnected': ipv4('169.254.12.5'),
    Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'Wireless IPv6': [{ address: 'fe80::1234', family: 'IPv6', internal: false }],
    'Wi-Fi alias': ipv4('192.168.1.12'),
  };
  const urls = lanUrls(3000, interfaces);
  assert.deepEqual(urls.slice(0, 3), ['http://192.168.1.12:3000', 'http://10.0.0.15:3000', 'http://192.168.2.3:3000']);
  assert.equal(urls.length, 6);
  assert.ok(urls.indexOf('http://172.19.0.1:3000') > 2);
  assert.ok(urls.indexOf('http://192.168.99.1:3000') > 2);
  assert.ok(!urls.some(url => /169\.254|127\.0\.0\.1|fe80/.test(url)));
  assert.deepEqual(lanUrls(8080, { en0: [{ address: '192.168.1.50', family: 4, internal: false }] }), ['http://192.168.1.50:8080']);
});

test('public invite base accepts HTTP(S), strips query/fragment and rejects credentials or other protocols', () => {
  assert.equal(normalizePublicUrl(' https://robots.example.com/ '), 'https://robots.example.com');
  assert.equal(normalizePublicUrl('http://example.com:3000/arena/?old=123#top'), 'http://example.com:3000/arena');
  for (const value of [undefined, '', 'no url', '//example.com', 'javascript:alert(1)', 'ftp://example.com', 'https://user:secret@example.com']) {
    assert.equal(normalizePublicUrl(value), null);
  }
});
