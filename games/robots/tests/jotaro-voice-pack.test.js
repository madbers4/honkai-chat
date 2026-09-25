import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GENERATED_JOTARO_VOICE_CLIPS as clips } from '../shared/generated-jotaro-voice-clips.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const script = JSON.parse(await read('scripts/voice-production/spoken-script.json'));
const report = JSON.parse(await read('scripts/voice-production/jotaro-pack-analysis.json'));
const expected = script.utterances.filter(line => line.speaker === 'p1');
const words = text => text.toLowerCase().replaceAll('ё', 'е').match(/[a-zа-я0-9]+/g);

test('Jotaro catalog supplies exactly all 28 p1 roles with the recorded words', () => {
  assert.equal(expected.length, 28);
  assert.deepEqual(Object.keys(clips).sort(), expected.map(line => line.id).sort());
  for (const line of expected) {
    assert.equal(clips[line.id].text, line.text, line.id);
    assert.equal(clips[line.id].speaker, 'p1', line.id);
    assert.equal(clips[line.id].url, `/assets/voices/spoken-v2/${line.id}.mp3`);
    assert.ok(Number.isFinite(clips[line.id].duration) && clips[line.id].duration > 0);
    assert.deepEqual(words(line.synthesisText), words(line.text), line.id);
    if (line.id.startsWith('round-')) {
      const otherSeat = script.utterances.find(other => other.id === line.id.replace(/p1$/, 'p2'));
      assert.equal(line.text, otherSeat.text, 'round subtitles keep the same semantic line for both voices');
    }
  }
});

test('each catalog asset matches the checked audio bytes and successful word/PCM review', async () => {
  assert.equal(report.clips.length, 28);
  assert.deepEqual(report.failedOrMissing, []);
  for (const row of report.clips) {
    const clip = clips[row.id];
    const bytes = await read('public' + clip.url);
    assert.equal(hash(bytes), row.sha256, row.id);
    assert.equal(bytes.length, row.bytes, row.id);
    assert.equal(clip.duration, row.duration, row.id);
    assert.equal(clip.text, row.text, row.id);
    assert.equal(row.synthesisText, expected.find(line => line.id === row.id).synthesisText);
    assert.equal(row.passed, true, row.id);
    assert.equal(row.exactWordMatch, true, row.id);
    assert.deepEqual(row.unexpectedReferenceWords, [], row.id);
    assert.equal(row.clippedFraction, 0, row.id);
    assert.equal(row.sampleRate, 24000, row.id);
    assert.equal(row.channels, 1, row.id);
  }
});

test('challenge preserves approved Original B bytes and no rejected D/H remain active', async () => {
  assert.equal(hash(await read('public' + clips['faceoff-challenge-p1'].url)),
    'b70455f4432e6b4cc56d989c0cf17734e87e21a7bf5f2440cc35cec814642544');
  assert.equal(clips['faceoff-challenge-p1'].duration, 4.46);
  assert.equal(clips['faceoff-challenge-p1'].text, 'Хватит пафоса! Покажи, на что СПОСОБЕН!');
  const rejected = new Set([
    'c8364e290dc541c75d4865e3f87eca75c22edc5dff68b76ee2d9ba302e50f7d0',
    '0c2adac2b26864b4a8b23d681de086c685afc370e506aea4ad6868c9d1516229',
  ]);
  for (const row of report.clips) assert.equal(rejected.has(row.sha256), false, row.id);
});

test('portable original reference is retained and approval belongs only to the copied B pilot', async () => {
  const reference = await read(report.reference.source);
  assert.equal(hash(reference), '17bad1ef01499370b836f7a5d5761b9150d6fa23036124c095e951a54e883741');
  assert.equal(report.reference.sha256, hash(reference));
  assert.equal(report.reference.wavSha256, '03dc4f5f6e8cce681c6e388b78766879e581cf59a7bbead15f55b4f7cb7c1c1b');
  assert.equal(report.reference.source, 'public/assets/voices/jotaro-dio.mp3');
  assert.equal(report.reference.refText, 'Ублюдок! Дио!');
  assert.equal(report.reference.reusedPrompt, true);
  assert.equal(report.reference.xVectorOnly, false);
  assert.equal(report.recipe, 'jotaro-original-b-icl-v1');
  assert.deepEqual(report.clips.filter(row => row.userListeningApproved).map(row => row.id), ['faceoff-challenge-p1']);
  assert.equal(report.userListeningApproved, false);
  const generator = (await read('scripts/voice-production/generate-jotaro-pack.py')).toString('utf8').replaceAll('\r\n', '\n');
  assert.equal(hash(generator), report.generatorSha256);
  assert.equal(generator.includes('jotaro-design-d.wav'), false);
});
