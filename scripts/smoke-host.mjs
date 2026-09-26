import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { MAX_HP } from '../games/robots/shared/constants.js';
import { RULE_CARDS } from '../games/robots/shared/club-story.js';
import { FACE_OFF_DURATION } from '../games/robots/shared/faceoff-script.js';
import { GENERATED_VOICE_CLIPS } from '../games/robots/shared/generated-voice-clips.js';

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
assert.equal((await fetch(origin + '/robots/assets/automaton.glb', { method: 'HEAD', signal: AbortSignal.timeout(10000) })).status, 200);
assert.equal((await fetch(origin + '/robots/assets/voices/greeting.mp3', { method: 'HEAD', signal: AbortSignal.timeout(10000) })).status, 200);
for (const clip of Object.values(GENERATED_VOICE_CLIPS)) {
  const response = await fetch(origin + '/robots' + clip.url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, clip.url);
  assert.ok(Number(response.headers.get('content-length')) > 1000, 'generated speech must be an actual audio file');
}
assert.match(await fetchText('/robots/?role=referee'), /Бойцовский клуб/);
const sockets = [];
let checkpoint = 'connect first fighter';
let lastState = null;
const timeout = setTimeout(() => {
  console.error('Multiplayer smoke check timed out', { checkpoint, lastState, sockets: sockets.map(socket => socket.readyState) });
  process.exit(1);
}, 40000);
function next(socket, type, predicate = () => true) {
  return new Promise(resolve => {
    function handler(data) {
      const value = JSON.parse(data);
      if (value.type === 'state') {
        const state = value.state;
        lastState = { phase: state.phase, stage: state.story?.stage, elapsed: state.story?.elapsed,
          ruleIndex: state.story?.ruleIndex, paused: state.story?.paused, referee: state.referee };
      }
      if (value.type === type && predicate(value)) { socket.off('message', handler); resolve(value); }
    }
    socket.on('message', handler);
  });
}
try {
  const first = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(first); await once(first, 'open');
  let response = next(first, 'welcome'); first.send(JSON.stringify({ type: 'create', mode: 'pvp', storyMode: true, name: 'Проверка сервера', customization: { body: 'jade', core: 'violet', accessory: 'clubCap' } }));
  const room = (await response).room;
  const second = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(second); await once(second, 'open');
  const initialState = next(second, 'state');
  response = next(second, 'welcome'); second.send(JSON.stringify({ type: 'join', room, name: 'Проверка подключения' }));
  assert.equal((await response).room, room);
  const { state } = await initialState;
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every(player => player.hp === MAX_HP && player.maxHp === MAX_HP), 'deployed combat health must match this release');
  assert.equal(state.story.stage, 'workshop');
  assert.deepEqual(state.players[0].customization, { body: 'jade', core: 'violet', accessory: 'clubCap' });
  // Read the cards as two fighters, then attach the optional referee during
  // the cinema. Automatic referee card timing is covered by the server tests.
  let stage = next(first, 'state', packet => packet.state.story.stage === 'rules');
  first.send(JSON.stringify({ type: 'ready' })); second.send(JSON.stringify({ type: 'ready' }));
  let current = (await stage).state;
  for (let index = 0; index < RULE_CARDS.length; index++) {
    checkpoint = `acknowledge rule ${index + 1}`;
    stage = next(first, 'state', packet => packet.state.story.ruleIndex === index + 1);
    const packet = JSON.stringify({ type: 'storyAdvance', sequenceId: current.story.sequenceId, ruleIndex: index });
    first.send(packet); second.send(packet); current = (await stage).state;
  }
  assert.equal(current.story.stage, 'faceoff'); assert.equal(current.story.duration, FACE_OFF_DURATION);
  checkpoint = 'connect and prepare referee';
  const referee = new WebSocket(origin.replace(/^http/, 'ws') + '/robots/ws'); sockets.push(referee); await once(referee, 'open');
  response = next(referee, 'refereeWelcome'); referee.send(JSON.stringify({ type: 'watch', room }));
  const refWelcome = await response; assert.equal(refWelcome.room, room);
  response = next(referee, 'refereeState', packet => packet.favorite === 'p2');
  referee.send(JSON.stringify({ type: 'refereeFavorite', favorite: 'p2' })); await response;
  response = next(referee, 'refereeState', packet => packet.prepared === true);
  referee.send(JSON.stringify({ type: 'refereeReady' })); await response;
  checkpoint = 'wait for faceoff skip window';
  current = (await next(referee, 'state', packet => packet.state.story.stage === 'faceoff' && packet.state.story.elapsed >= 3.1)).state;
  assert.equal(current.referee.connected, true); assert.equal(current.referee.preparing, false);
  assert.ok(!JSON.stringify(current).includes(refWelcome.token));
  stage = next(referee, 'state', packet => packet.state.story.stage === 'refereeIntro');
  const skip = JSON.stringify({ type: 'storyAdvance', sequenceId: current.story.sequenceId, ruleIndex: RULE_CARDS.length });
  first.send(skip); second.send(skip);
  checkpoint = 'skip faceoff and reach referee introduction';
  current = (await stage).state;
  const gate = current.story.refereeIntro.sequenceId, heldTime = current.time;
  checkpoint = 'verify referee gate holds combat';
  const held = next(referee, 'state', packet => packet.state.story.refereeIntro?.elapsed >= .3);
  first.send(JSON.stringify({ type: 'refereeStartRound', sequenceId: gate }));
  current = (await held).state; assert.equal(current.time, heldTime, 'fighter cannot release the referee gate');
  stage = next(referee, 'state', packet => packet.state.phase === 'countdown');
  referee.send(JSON.stringify({ type: 'refereeStartRound', sequenceId: gate }));
  checkpoint = 'referee starts full countdown';
  current = (await stage).state; assert.ok(current.countdown > 2.8, 'full countdown starts after the referee');
  checkpoint = 'countdown reaches fight';
  current = (await next(referee, 'state', packet => packet.state.phase === 'fight')).state;
  assert.ok(current.time > 74 && current.time <= 75);
  console.log(`PASS: both games, story assets, ${MAX_HP} HP, customization, two fighters, private referee and held round start → countdown → fight.`);
} finally { for (const socket of sockets) socket.terminate(); clearTimeout(timeout); }
