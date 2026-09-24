import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { startFestivalServer } from '../server/index.mjs';

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/robots/ws`);
  socket.packets = [];
  socket.on('message', data => socket.packets.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  return socket;
}
async function packet(socket, predicate) {
  for (let i = 0; i < 150; i++) {
    const index = socket.packets.findIndex(predicate);
    if (index >= 0) return socket.packets.splice(index, 1)[0];
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected multiplayer packet did not arrive');
}

test('story and robots share the existing port without leaking assets or routes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'festival-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['story', 'robots']) {
    await mkdir(path.join(root, name, 'assets'), { recursive: true });
    await writeFile(path.join(root, name, 'index.html'), `<title>${name}</title>`);
    await writeFile(path.join(root, name, 'assets/shared.js'), name);
  }
  const app = await startFestivalServer({ port: 0, host: '127.0.0.1', clientDir: path.join(root, 'story'), robotDir: path.join(root, 'robots'), autoTick: false });
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.port}`;
  for (const route of ['/', '/guest', '/actor', '/?staff=1']) assert.equal(await (await fetch(origin + route)).text(), '<title>story</title>');
  const redirect = await fetch(origin + '/robots?room=ABC', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/robots/?room=ABC');
  assert.equal(await (await fetch(origin + '/robots/')).text(), '<title>robots</title>');
  assert.equal(await (await fetch(origin + '/assets/shared.js')).text(), 'story');
  assert.equal(await (await fetch(origin + '/robots/assets/shared.js')).text(), 'robots');
  assert.equal((await fetch(origin + '/robots/assets/missing.js')).status, 404);
  assert.equal((await fetch(origin + '/assets/missing.js')).status, 404);
  assert.equal((await fetch(origin + '/robots/api/missing')).status, 404);
  assert.equal((await fetch(origin + '/robots/api/health')).status, 200);
  assert.equal((await fetch(origin + '/robots/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(origin + '/robots/assets/%00bad')).status, 400);
  assert.equal((await fetch(origin + '/%00bad')).status, 400);
  const head = await fetch(origin + '/robots/assets/shared.js', { method: 'HEAD' });
  assert.equal(head.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await head.text(), '');

  const one = await connect(app.port), two = await connect(app.port);
  one.send(JSON.stringify({ type: 'create', mode: 'pvp', name: 'Первый' }));
  const first = await packet(one, x => x.type === 'welcome');
  two.send(JSON.stringify({ type: 'join', room: first.room, name: 'Второй' }));
  const second = await packet(two, x => x.type === 'welcome');
  assert.equal(second.room, first.room); assert.notEqual(first.playerId, second.playerId);
  one.send(JSON.stringify({ type: 'ready' })); two.send(JSON.stringify({ type: 'ready' }));
  await packet(one, x => x.state?.phase === 'countdown');
  for (let i = 0; i < 190; i++) app.tick();
  await packet(two, x => x.state?.phase === 'fight');
  const closed = once(two, 'close'); two.close(); await closed;
  await packet(one, x => x.state?.phase === 'paused');
  const restored = await connect(app.port);
  restored.send(JSON.stringify({ type: 'join', room: first.room, token: second.token }));
  assert.equal((await packet(restored, x => x.type === 'welcome')).playerId, second.playerId);
  await packet(one, x => x.state?.phase === 'countdown');
});
