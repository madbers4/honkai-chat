import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { MAX_HP } from '../games/robots/shared/constants.js';

const origin = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/$/, '');
const fetchText = async route => {
  const response = await fetch(origin + route, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, route); return response.text();
};
assert.match(await fetchText('/'), /Искра|Фонтейнка/);
const robotHtml = await fetchText('/robots/');
assert.match(robotHtml, /Бойцовский клуб/);
assert.equal(JSON.parse(await fetchText('/robots/api/health')).ok, true);
const bundle = robotHtml.match(/src="(\/robots\/assets\/[^\"]+\.js)"/)[1];
assert.ok((await fetchText(bundle)).length > 10000);
assert.equal((await fetch(origin + '/robots/assets/automaton.glb', { method: 'HEAD' })).status, 200);
const sockets = [];
const timeout = setTimeout(() => { console.error('Multiplayer smoke check timed out'); process.exit(1); }, 15000);
function next(socket, type) {
  return new Promise(resolve => {
    function handler(data) { const value = JSON.parse(data); if (value.type === type) { socket.off('message', handler); resolve(value); } }
    socket.on('message', handler);
  });
}
try {
  const first = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(first); await once(first, 'open');
  let response = next(first, 'welcome'); first.send(JSON.stringify({ type: 'create', mode: 'pvp', name: 'Проверка сервера' }));
  const room = (await response).room;
  const second = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(second); await once(second, 'open');
  const initialState = next(second, 'state');
  response = next(second, 'welcome'); second.send(JSON.stringify({ type: 'join', room, name: 'Проверка подключения' }));
  assert.equal((await response).room, room);
  const { state } = await initialState;
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every(player => player.hp === MAX_HP && player.maxHp === MAX_HP), 'deployed combat health must match this release');
  console.log(`PASS: story, robot page, bundle, model and two WebSocket players with ${MAX_HP} HP.`);
} finally { for (const socket of sockets) socket.terminate(); clearTimeout(timeout); }
