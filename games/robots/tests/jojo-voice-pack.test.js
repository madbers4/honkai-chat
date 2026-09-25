import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GENERATED_VOICE_CLIPS as clips } from '../shared/generated-voice-clips.js';

const read = path => readFile(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const script = JSON.parse(await read('scripts/voice-production/spoken-script.json'));
const report = JSON.parse(await read('scripts/voice-production/jojo-v3-final-analysis.json'));
const words = text => text.toLowerCase().replaceAll('ё', 'е').match(/[a-zа-я0-9]+/g);

test('both fixed actors cover every rewritten cinematic and round role', () => {
  assert.equal(script.utterances.length, 57);
  assert.deepEqual(Object.keys(clips).sort(), script.utterances.map(line => line.id).sort());
  assert.equal(script.utterances.filter(line => line.speaker === 'p1').length, 28);
  assert.equal(script.utterances.filter(line => line.speaker === 'p2').length, 29);
  for (const line of script.utterances) {
    assert.equal(clips[line.id].text, line.text, line.id);
    assert.equal(clips[line.id].speaker, line.speaker, line.id);
    assert.equal(clips[line.id].url, `/assets/voices/spoken-v3/${line.id}.mp3`);
    assert.deepEqual(words(line.synthesisText), words(line.text), line.id);
    if (line.id.startsWith('round-') && line.speaker === 'p1') {
      assert.equal(line.text, clips[line.id.replace(/p1$/, 'p2')].text);
    }
  }
});

test('production receipts match every complete, compressed, newly generated MP3', async () => {
  assert.equal(report.clips.length, 57);
  assert.deepEqual(report.failedOrMissing, []);
  for (const row of report.clips) {
    const clip = clips[row.id], line = script.utterances.find(item => item.id === row.id);
    const bytes = await read('public' + clip.url);
    assert.equal(hash(bytes), row.sha256, row.id);
    assert.equal(bytes.length, row.bytes, row.id);
    assert.equal(clip.duration, row.duration, row.id);
    assert.equal(clip.text, row.text, row.id);
    assert.deepEqual(words(row.synthesisText), words(line.text), row.id);
    assert.equal(row.passed, true, row.id);
    assert.equal(row.exactWordMatch, true, row.id);
    assert.equal(row.copied, false, row.id);
    assert.equal(row.userListeningApproved, false, 'do not invent listening approval');
    assert.equal(row.clippedFraction, 0, row.id);
    assert.equal(row.sampleRate, 24000, row.id);
    assert.equal(row.channels, 1, row.id);
    assert.ok(bytes.length <= row.duration * 8000 + 1800, `${row.id}: 64 kbit/s size budget`);
  }
});

test('the approved references define actor identity but no former dialogue is copied', async () => {
  assert.deepEqual(report.copiedRecordings, []);
  assert.equal(report.allRecordingsListeningApproved, false);
  assert.equal(report.processing.tempo, 1);
  assert.equal(report.processing.pitchShift, 0);
  assert.equal(report.asr.forcedLanguage, false);
  assert.equal(report.asr.targetTextPrompt, false);
  assert.equal(report.actors.p1.recipe, 'zero-original');
  assert.equal(report.actors.p1.model, 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512');
  assert.equal(report.actors.p2.model, 'Qwen/Qwen3-TTS-12Hz-1.7B-Base');
  for (const seat of ['p1', 'p2']) {
    const actor = report.actors[seat], ref = actor.reference;
    assert.equal(actor.allRecordingsListeningApproved, false);
    assert.equal(actor.selectedPilot.userSelected, true);
    assert.equal(hash(await read('public/assets/voices/' + ref.file)), ref.sha256);
  }
  assert.equal(hash(await read('public' + clips['faceoff-mode-p1'].url)), report.actors.p1.selectedPilot.sha256,
    'first Jotaro recording is exactly the selected Cosy pilot A');
  assert.equal(hash(await read('public/assets/voices/spoken-v2/faceoff-mode-p2.mp3')), report.actors.p2.selectedPilot.sha256);
});
