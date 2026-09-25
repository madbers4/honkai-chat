import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { buildFaceoff, activeFaceoffBeat, FACE_OFF_DURATION, FACE_OFF_POSES, FACE_OFF_DIALOGUE_CLIPS, VOICE_CLIPS } from '../shared/faceoff-script.js';
import { hasCompleteSpokenCatalog } from '../shared/spoken-catalog.js';

test('faceoff is a deterministic complete sequence with stable identities and whole recordings', () => {
  const players = [{ id: 'p1', name: 'Медный Сом' }, { id: 'p2', name: 'Герой <script>чайника</script>' }];
  const beats = buildFaceoff(players, 'same-seed'); assert.deepEqual(beats, buildFaceoff(players, 'same-seed'));
  assert.equal(new Set(beats.map(b => b.id)).size, beats.length); assert.equal(beats[0].at, 0);
  assert.equal(beats[0].clip, 'faceoff-greeting-open', 'original greeting starts with the first frame');
  assert.ok(beats.every(b => ['p1', 'p2', 'narrator'].includes(b.speaker) && FACE_OFF_POSES.includes(b.pose)));
  for (const [i, beat] of beats.entries()) {
    assert.ok(beat.duration > 0); assert.ok(Math.abs(beat.at + beat.duration - (beats[i + 1]?.at ?? FACE_OFF_DURATION)) < .0001);
    if (beat.clip) assert.ok(beat.clipOffset + beat.clipDuration <= VOICE_CLIPS[beat.clip].duration);
  }
  for (let t = 0; t < FACE_OFF_DURATION; t += .1) assert.ok(activeFaceoffBeat(beats, t));
  assert.equal(activeFaceoffBeat(beats, FACE_OFF_DURATION), null);
  assert.ok(beats.some(b => b.text.includes(players[0].name))); assert.ok(beats.some(b => b.text.includes(players[1].name)));
  assert.deepEqual(beats.filter(b => b.clip && b.chapter === 'dialogue').map(b => b.clip), FACE_OFF_DIALOGUE_CLIPS);
  assert.deepEqual(beats.filter(b => b.clip && b.chapter === 'mode').map(b => b.clip), hasCompleteSpokenCatalog()?['faceoff-greeting-package','faceoff-challenge-p1']:[]);
  const clips = beats.filter(b => b.clip);
  for (let i = 0; i < clips.length; i++) {
    assert.equal(clips[i].clipOffset, 0);
    assert.equal(clips[i].clipDuration, VOICE_CLIPS[clips[i].clip].duration, 'recording is never trimmed');
    assert.ok(clips[i].at + clips[i].clipDuration < (clips[i+1]?.at ?? FACE_OFF_DURATION), 'dialogue recordings cannot overlap');
  }
  assert.deepEqual([...new Set(beats.map(b => b.chapter))], ['establish','mode','dialogue','ready']);
  assert.ok(beats.filter(b => b.ttsText).every(b => b.at + b.duration <= clips[0].at), 'optional mode speech cannot interrupt an original recording');
});

test('all 12 original MP3 copies match their manifest checksum and measured duration', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../public/assets/voices/manifest.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(manifest.clips).length, 12);
  for (const [id, clip] of Object.entries(manifest.clips)) {
    const bytes = await fs.readFile(new URL(`../public${clip.url}`, import.meta.url));
    assert.equal(bytes.length, clip.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    assert.equal(VOICE_CLIPS[id].duration, clip.duration); assert.ok(clip.duration > 0 && clip.duration < 16);
  }
});
