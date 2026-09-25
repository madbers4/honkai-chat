import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GENERATED_VOICE_CLIPS as clips } from '../shared/generated-voice-clips.js';

const read = path => readFile(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const script = JSON.parse(await read('scripts/voice-production/spoken-script.json'));
const report = JSON.parse(await read('scripts/voice-production/spoken-current-analysis.json'));
const historical = JSON.parse(await read('scripts/voice-production/jojo-v3-final-analysis.json'));
const originals = JSON.parse(await read('scripts/voice-production/faceoff-original-v4-analysis.json'));
const words = text => text.toLowerCase().replaceAll('ё', 'е').match(/[a-zа-я0-9]+/g);

test('both fixed actors cover the original cinematic and retained round roles', () => {
  assert.equal(script.utterances.length, 55);
  assert.deepEqual(Object.keys(clips).sort(), script.utterances.map(line => line.id).sort());
  assert.equal(script.utterances.filter(line => line.speaker === 'p1').length, 27);
  assert.equal(script.utterances.filter(line => line.speaker === 'p2').length, 28);
  for (const line of script.utterances) {
    assert.equal(clips[line.id].text, line.text, line.id);
    assert.equal(clips[line.id].speaker, line.speaker, line.id);
    assert.equal(clips[line.id].url, `/assets/voices/${line.id.startsWith('faceoff-')?'faceoff-v4':'spoken-v3'}/${line.id}.mp3`);
    assert.deepEqual(words(line.synthesisText), words(line.text), line.id);
    if (line.id.startsWith('round-') && line.speaker === 'p1') {
      assert.equal(line.text, clips[line.id.replace(/p1$/, 'p2')].text);
    }
  }
});

test('production receipts match every complete compressed MP3 and honest provenance', async () => {
  assert.equal(report.clips.length, 55);
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
    if (row.id.startsWith('round-')) {
      assert.equal(row.exactWordMatch, true, row.id);
      assert.equal(row.copied, false, row.id);
      assert.equal(row.sha256, historical.clips.find(clip=>clip.id===row.id).sha256,
        'approved voice recipes are retained without unnecessary regeneration');
    } else {
      assert.equal(row.copied, true, row.id);
      assert.equal(row.sourceEngine, 'original-user-recording');
      assert.equal(hash(await read(`public/assets/voices/${row.source}.mp3`)), row.sourceSha256);
      assert.equal(row.exactWordMatch, originals.clips.find(clip=>clip.id===row.id).exactWordMatch,
        'original proper-name ASR failures must not be relabelled as exact matches');
      assert.ok(row.trim[0]>=0 && row.trim[1]>row.trim[0]);
      assert.ok(Math.abs(row.duration-(row.trim[1]-row.trim[0]))<1/24000);
    }
    assert.equal(row.userListeningApproved, false, 'do not invent listening approval');
    assert.equal(row.clippedFraction, 0, row.id);
    assert.equal(row.sampleRate, 24000, row.id);
    assert.equal(row.channels, 1, row.id);
    assert.ok(bytes.length <= row.duration * 8000 + 1800, `${row.id}: 64 kbit/s size budget`);
  }
});

test('original performances are explicitly distinguished from the retained TTS recipes', async () => {
  assert.deepEqual(report.copiedRecordings, script.faceoffOrder);
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
  assert.notEqual(hash(await read('public' + clips['faceoff-mode-p1'].url)), report.actors.p1.selectedPilot.sha256,
    'the rejected armour line is replaced by the original exclamation');
  assert.equal(clips['faceoff-mode-p1'].text, 'Ублюдок! Дио!');
  assert.equal(hash(await read('public/assets/voices/spoken-v2/faceoff-mode-p2.mp3')), report.actors.p2.selectedPilot.sha256);
});

test('the complete greeting is divided only at actor changes and never loses source samples', () => {
  const opening = originals.clips.slice(0,3);
  assert.deepEqual(opening.map(clip=>clip.speaker),['p2','p1','p2']);
  assert.ok(opening.every(clip=>clip.source==='greeting'));
  assert.equal(opening[0].trim[0],0);
  assert.equal(opening[0].trim[1],opening[1].trim[0]);
  assert.equal(opening[1].trim[1],opening[2].trim[0]);
  assert.ok(Math.abs(opening[2].trim[1]-11.436979166666667)<1e-8);
  assert.ok(originals.totalBytes<250000);
});
