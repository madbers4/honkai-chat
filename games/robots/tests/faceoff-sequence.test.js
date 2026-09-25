import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { StorySession } from '../server/story-session.js';
import { createStoryVoice } from '../src/story-voice.js';
import { buildFaceoff, FACE_OFF_DURATION, faceoffActorX, VOICE_CLIPS } from '../shared/faceoff-script.js';

test('production opening stays server-authoritative through the complete scene, including disconnect in the dialogue', () => {
  const room = new CombatRoom({ id: 'CINEMA' });
  room.addPlayer('Медный Сом'); room.addPlayer('Барон Коротыш');
  const scene = new StorySession(room, { ruleCount: 1, faceoffDuration: FACE_OFF_DURATION, buildFaceoff });
  scene.ready('p1'); scene.ready('p2');
  scene.advance({ actor: 'referee', sequenceId: scene.sequenceId, ruleIndex: 0 }, true);
  const step = seconds => { for (let i = 0; i < Math.round(seconds * 60); i++) scene.step(1 / 60); };
  assert.equal(scene.snapshot().duration, FACE_OFF_DURATION);
  const positions = [room.player('p1').x, room.player('p2').x];
  step(8);
  let presented = scene.decorate(room.snapshot());
  assert.equal(presented.players[0].variant, 'reactor');
  assert.equal(presented.players[1].variant, 'stance');
  assert.equal(presented.players[0].x, faceoffActorX(0, 8));
  assert.deepEqual([room.player('p1').x, room.player('p2').x], positions, 'staging cannot move combat state');
  step(16);
  assert.equal(scene.stage, 'faceoff', 'legacy 24-second duration cannot cut the new scene');
  assert.equal(room.phase, 'waiting');
  room.setConnected('p2', false);
  const held = scene.snapshot(); step(10);
  assert.deepEqual(scene.snapshot(), held, 'disconnected scene freezes its authoritative clock');
  room.setConnected('p2', true); step(scene.beats.at(-1).at+.1-scene.elapsed);
  presented = scene.decorate(room.snapshot());
  assert.deepEqual(presented.players.map(p => p.variant), ['armed', 'armed']);
  assert.equal(scene.stage, 'faceoff');
  step(FACE_OFF_DURATION-scene.elapsed+1/60);
  assert.equal(scene.stage, 'complete'); assert.equal(room.phase, 'countdown');
  const starts = room.events.filter(event => event.type === 'round').length;
  step(5); assert.equal(room.events.filter(event => event.type === 'round').length, starts);
});

test('complete selected production voice schedule plays every recording without truncation', async t => {
  const records = [], beats = buildFaceoff([{ id: 'p1' }, { id: 'p2' }], 'audio-proof');
  let clock = 0;
  const ctx = {
    state: 'running', destination: {}, resume: async () => {}, close: async () => {},
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    decodeAudioData: async () => ({ duration: 60 }),
    createBufferSource() {
      const record = { startedAt: null, stoppedAt: null, startArgs: null };
      records.push(record);
      return { connect() {}, disconnect() {}, start(...args) { record.startedAt = clock; record.startArgs = args; }, stop() { record.stoppedAt = clock; } };
    },
  };
  const voice = createStoryVoice({ makeContext: () => ctx, fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), visibility: null, speech: null });
  t.after(() => voice.dispose());
  await voice.unlock(); await voice.preload(beats);
  // Exercise exact audio/visual boundaries as well as regular server packets.
  const moments = new Set(Array.from({ length: FACE_OFF_DURATION * 60 + 1 }, (_, i) => i / 60));
  for (const beat of beats) { moments.add(beat.at); if (beat.clip) moments.add(beat.at + beat.clipDuration); }
  for (clock of [...moments].sort((a, b) => a - b)) voice.update({ sequenceId: 'cinema', elapsed: clock, beats, enabled: true });
  const originals = beats.filter(beat => beat.clip);
  assert.equal(records.length, originals.length);
  for (const [i, record] of records.entries()) {
    const beat = originals[i];
    assert.equal(record.startedAt, beat.at);
    assert.equal(record.startArgs[1], 0);
    assert.ok(Math.abs(record.startArgs[2] - VOICE_CLIPS[beat.clip].duration) < 1e-8, 'entire recording is scheduled');
    assert.ok(record.stoppedAt >= beat.at + beat.clipDuration, 'visual subtitle/shot changes cannot interrupt a recording');
  }
});
