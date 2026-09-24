import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { MAX_HP } from '../games/robots/shared/constants.js';
import { RULE_CARDS } from '../games/robots/shared/club-story.js';

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
assert.ok((await fetchText(bundle)).length > 500, 'entry bundle is served');
assert.equal((await fetch(origin + '/robots/assets/automaton.glb', { method: 'HEAD' })).status, 200);
assert.equal((await fetch(origin + '/robots/assets/voices/greeting.mp3', { method: 'HEAD' })).status, 200);
assert.match(await fetchText('/robots/?role=referee'), /Бойцовский клуб/);
const sockets = [];
const timeout = setTimeout(() => { console.error('Multiplayer smoke check timed out'); process.exit(1); }, 15000);
function next(socket, type, predicate = () => true) {
  return new Promise(resolve => {
    function handler(data) { const value = JSON.parse(data); if (value.type === type && predicate(value)) { socket.off('message', handler); resolve(value); } }
    socket.on('message', handler);
  });
}
try {
  const first = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(first); await once(first, 'open');
  let response = next(first, 'welcome'); first.send(JSON.stringify({ type: 'create', mode: 'pvp', storyMode: true, name: 'Проверка сервера', customization: { body: 'jade', core: 'violet', accessory: 'crown' } }));
  const room = (await response).room;
  const second = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(second); await once(second, 'open');
  const initialState = next(second, 'state');
  response = next(second, 'welcome'); second.send(JSON.stringify({ type: 'join', room, name: 'Проверка подключения' }));
  assert.equal((await response).room, room);
  const { state } = await initialState;
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every(player => player.hp === MAX_HP && player.maxHp === MAX_HP), 'deployed combat health must match this release');
  assert.equal(state.story.stage, 'workshop');
  assert.deepEqual(state.players[0].customization, { body: 'jade', core: 'violet', accessory: 'crown' });
  const referee = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(referee); await once(referee, 'open');
  response = next(referee, 'refereeWelcome'); referee.send(JSON.stringify({ type: 'watch', room }));
  const refWelcome = await response; assert.equal(refWelcome.room, room);
  response = next(referee, 'refereeState', packet => packet.favorite === 'p2');
  referee.send(JSON.stringify({ type: 'refereeFavorite', favorite: 'p2' })); await response;
  let stage = next(referee, 'state', packet => packet.state.story.stage === 'rules');
  first.send(JSON.stringify({ type: 'ready' })); second.send(JSON.stringify({ type: 'ready' }));
  let current = (await stage).state;
  assert.deepEqual(current.referee, { connected: true });
  assert.ok(!JSON.stringify(current).includes(refWelcome.token));
  for (let index = 0; index < RULE_CARDS.length; index++) {
    stage = next(referee, 'state', packet => packet.state.story.ruleIndex === index + 1);
    referee.send(JSON.stringify({ type: 'storyAdvance', sequenceId: current.story.sequenceId, ruleIndex: index }));
    current = (await stage).state;
  }
  assert.equal(current.story.stage, 'faceoff'); assert.equal(current.players.length, 2);
  console.log(`PASS: both games, story assets, ${MAX_HP} HP, customization, two fighters, private referee, shared rules and faceoff.`);
} finally { for (const socket of sockets) socket.terminate(); clearTimeout(timeout); }
