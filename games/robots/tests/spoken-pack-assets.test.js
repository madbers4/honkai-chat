import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GENERATED_VOICE_CLIPS } from '../shared/generated-voice-clips.js';

const script = JSON.parse(readFileSync(new URL('../scripts/voice-production/spoken-script.json', import.meta.url), 'utf8'));
const bytesFor = clip => readFileSync(new URL(`../public${clip.url}`, import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Read actual MPEG-2 mono frames and LAME gapless trim without requiring a
// local audio model or ffmpeg on CI. A padded MP3 container is longer than the
// decoded words, which would otherwise make the server's dialogue clock drift.
function decodedDuration(bytes) {
  assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
  const tagSize = [...bytes.subarray(6, 10)].reduce((n, b) => n * 128 + (b & 127), 0);
  const start = 10 + tagSize, info = start + 13;
  assert.equal(bytes.toString('ascii', info, info + 4), 'Info');
  assert.equal(bytes.readUInt32BE(info + 4), 15);
  const frames = bytes.readUInt32BE(info + 8), encoder = info + 120;
  assert.match(bytes.toString('ascii', encoder, encoder + 9), /^(Lavc|LAME)/);
  const delay = (bytes[encoder + 21] << 4) | (bytes[encoder + 22] >> 4);
  const padding = ((bytes[encoder + 22] & 15) << 8) | bytes[encoder + 23];
  const bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let offset = start, counted = 0;
  while (offset < bytes.length) {
    const h = bytes.readUInt32BE(offset);
    assert.equal(h >>> 21, 2047, 'unbroken MPEG frame sync');
    assert.equal((h >>> 19) & 3, 2, 'MPEG-2');
    assert.equal((h >>> 17) & 3, 1, 'Layer III');
    assert.equal((h >>> 10) & 3, 1, '24 kHz');
    assert.equal((h >>> 6) & 3, 3, 'mono');
    const rate = bitrates[(h >>> 12) & 15];
    assert.ok(rate > 0);
    offset += Math.floor(72000 * rate / 24000) + ((h >>> 9) & 1);
    counted++;
  }
  assert.equal(offset, bytes.length, 'no truncated last frame');
  assert.equal(counted, frames + 1, 'all declared audio frames plus Info');
  return (frames * 576 - delay - padding) / 24000;
}

test('every scripted spoken line ships complete audio with an accurate server duration and exact subtitle', () => {
  assert.equal(script.utterances.length, 57);
  const hashes = new Set();
  for (const line of script.utterances) {
    const clip = GENERATED_VOICE_CLIPS[line.id];
    assert.ok(clip, `missing recording: ${line.id}`);
    assert.equal(clip.text, line.text, line.id);
    assert.equal(clip.speaker, line.speaker, line.id);
    assert.match(clip.url, /^\/assets\/voices\/spoken-v2\/[a-z0-9-]+\.mp3$/, 'new URLs cannot reuse cached legacy audio');
    const bytes = bytesFor(clip), duration = decodedDuration(bytes);
    assert.ok(Math.abs(clip.duration - duration) < .0001, `${line.id}: catalog ${clip.duration}, decoded ${duration}`);
    assert.ok(duration > .15 && duration < 15, `${line.id}: plausible complete utterance`);
    const digest = sha256(bytes);
    assert.ok(!hashes.has(digest), `${line.id}: different lines/voices must not be duplicated placeholders`);
    hashes.add(digest);
  }
});

test('both listening-approved takes and all original combat effects remain byte-identical', () => {
  const dio = GENERATED_VOICE_CLIPS['faceoff-mode-p2'];
  assert.ok(dio);
  assert.equal(dio.text, 'Твой гарантийный талон уже мёртв!');
  assert.equal(sha256(bytesFor(dio)), '639de7c08eddd6c2aff517a6d0edc4f316e1a47c697c58e87f0137d7e43a1ed1');
  const jotaro = GENERATED_VOICE_CLIPS['faceoff-challenge-p1'];
  assert.ok(jotaro);
  assert.equal(jotaro.text, 'Хватит пафоса! Покажи, на что СПОСОБЕН!');
  assert.equal(sha256(bytesFor(jotaro)), 'b70455f4432e6b4cc56d989c0cf17734e87e21a7bf5f2440cc35cec814642544');
  const original = JSON.parse(readFileSync(new URL('../public/assets/voices/manifest.json', import.meta.url), 'utf8'));
  for (const id of script.scope.preservedAssetIds) {
    const clip = original.clips[id];
    assert.ok(clip, id);
    assert.equal(sha256(bytesFor(clip)), clip.sha256, `original combat effect changed: ${id}`);
  }
});
