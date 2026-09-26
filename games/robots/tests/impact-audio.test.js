import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPACT_KINDS, synthesizeImpact, impactCue } from '../src/impact-audio.js';
import { GameAudio } from '../src/audio.js';

test('contact Foley accompanies confirmed punches, never misses or historical contacts', () => {
  for (const variant of ['jab', 'cross', 'heavyDrive', 'heavyHook', 'heavyPress', 'slam']) {
    assert.ok(impactCue('hit', { variant }));
    assert.equal(impactCue('attack', { variant }), null);
    assert.equal(impactCue('hit', { variant, presentationHistorical: true }), null);
  }
  assert.notEqual(impactCue('hit', { variant: 'heavyDrive' }).kind, impactCue('hit', { variant: 'heavyPress' }).kind);
  assert.notEqual(impactCue('block').kind, impactCue('hit').kind);
  for (const variant of ['bolt', 'shockwave', 'overload']) assert.equal(impactCue('hit', { variant }), null);
  assert.ok(impactCue('grabStrike', { chain: 2 }));
});

test('GameAudio layers contact over actor calls and stops both on lifecycle boundaries', t => {
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  t.after(() => { globalThis.localStorage = oldStorage; });
  const audio = new GameAudio(), calls = [], sources = [];
  audio.combatVoice = { play: event => calls.push(event.type), stop: () => calls.push('stop') };
  audio.ctx = { state: 'running', createBufferSource() {
    const source = { playbackRate: {}, connect(){}, disconnect(){}, start(){this.started = true;}, stop(){this.stopped = true;} };
    sources.push(source); return source;
  }, createGain: () => ({ gain: {}, connect(){}, disconnect(){} }) };
  audio.impacts = new Map(IMPACT_KINDS.map(kind => [kind, {}]));
  audio.tone = audio.burst = audio.metal = () => {};
  audio.play('attack', { variant: 'jab' });
  assert.equal(sources.length, 0, 'the ORA/MUDA attack call is not an audible contact');
  audio.play('hit', { id: 7, variant: 'jab' });
  assert.equal(sources.length, 1); assert.ok(sources[0].started);
  assert.deepEqual(calls, ['attack', 'hit'], 'actor channel is retained independently');
  audio.play('hit', { variant: 'heavyDrive', presentationHistorical: true });
  audio.muted = true; audio.play('hit', { variant: 'heavyDrive' });
  assert.equal(sources.length, 1, 'no delayed contact or muted playback');
  audio.stop(); assert.ok(sources[0].stopped); assert.equal(calls.at(-1), 'stop');
});

test('all precomputed impact samples have safe peaks and end silently without DC or clicks', () => {
  for (const kind of IMPACT_KINDS) {
    const samples = synthesizeImpact(kind);
    let peak = 0, sum = 0, attackEnergy = 0, tailEnergy = 0;
    samples.forEach((sample, i) => {
      assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); sum += sample;
      if (i < 3200) attackEnergy += sample * sample;
      if (i >= samples.length - 3200) tailEnergy += sample * sample;
    });
    assert.ok(peak > .7 && peak < .9);
    assert.ok(Math.abs(sum / samples.length) < .005);
    assert.equal(Math.abs(samples[0]), 0); assert.equal(Math.abs(samples.at(-1)), 0);
    assert.ok(attackEnergy > tailEnergy * 3, `${kind} has one focused strike, not a sustained drone`);
  }
});
