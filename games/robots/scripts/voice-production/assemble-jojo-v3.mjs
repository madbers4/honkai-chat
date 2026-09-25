// Assemble only verified new recordings. Rejected Qwen p1 takes are never selected.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const key of ['--p1-report', '--p1-audio', '--p2-report', '--p2-audio', '--asr']) {
  if (!args.get(key)) throw new Error(`Required ${key}`);
}
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const words = text => text.toLowerCase().replaceAll('ё', 'е').match(/[a-zа-я0-9]+/g);
const script = read(path.join(root, 'scripts/voice-production/spoken-script.json'));
const p1 = read(args.get('--p1-report')), p2 = read(args.get('--p2-report')), asr = read(args.get('--asr'));
assert.equal(p1.recipe, 'zero-original');
assert.equal(p1.modelRevision, '29e01c4e8d000f4bcd70751be16fa94bf3d85a18');
assert.equal(p1.reference.sha256, '17bad1ef01499370b836f7a5d5761b9150d6fa23036124c095e951a54e883741');
assert.equal(p2.revision, 'fd4b254389122332181a7c3db7f27e918eec64e3');
assert.equal(p2.references.p2.sha256, '780ac5cb344f3a1c9cbe514b718b183a78bac98315de0047f4726cab66bb3361');
assert.equal(script.utterances.length, 57);
assert.equal(asr.clips.length, 57);
assert.deepEqual(asr.failed, []);
assert.equal(asr.forcedLanguage, false);
assert.equal(asr.targetTextPrompt, false);
const oldRoot = path.join(root, 'public/assets/voices/spoken-v2');
const planned = script.utterances.map(line => {
  const input = line.speaker === 'p1' ? p1 : p2;
  const candidates = input.clips.filter(row => row.id === line.id && row.speaker === line.speaker);
  assert.equal(candidates.length, 1, line.id);
  const row = candidates[0], checks = asr.clips.filter(check => check.id === line.id);
  assert.equal(checks.length, 1, line.id);
  const check = checks[0];
  assert.equal(row.text, line.text, line.id);
  assert.deepEqual(words(row.synthesisText), words(line.text), line.id);
  const source = path.join(args.get(line.speaker === 'p1' ? '--p1-audio' : '--p2-audio'), `${line.id}.mp3`);
  const bytes = readFileSync(source), hash = sha(bytes);
  assert.equal(hash, row.sha256, line.id);
  assert.equal(hash, check.sha256, line.id);
  assert.equal(bytes.length, row.bytes, line.id);
  assert.notEqual(hash, sha(readFileSync(path.join(oldRoot, `${line.id}.mp3`))), `v2 copied: ${line.id}`);
  assert.equal(check.text, line.text, line.id);
  assert.equal(check.exactWordMatch, true, line.id);
  assert.equal(row.channels, 1, line.id);
  assert.equal(row.sampleRate, 24000, line.id);
  assert.equal(row.clippedFraction, 0, line.id);
  assert.ok(row.truePeakDBFS < -1 && row.leadingSilence <= .2 && row.trailingSilence <= .2, line.id);
  assert.ok(row.duration > .2 && row.duration < 15, line.id);
  assert.ok(bytes.length <= row.duration * 8000 + 1800, line.id);
  return { source, row: { ...row, ...check, sourceEngine: line.speaker === 'p1' ? 'CosyVoice3' : 'Qwen3-TTS',
    copied: false, userListeningApproved: false, passed: true } };
});
assert.equal(planned.filter(x => x.row.speaker === 'p1').length, 28);
assert.equal(planned.filter(x => x.row.speaker === 'p2').length, 29);
assert.equal(planned.find(x => x.row.id === 'faceoff-mode-p1').row.sha256,
  'ce38180ec99e01abb523c5416d3bcd865e055b19a2520e496aea7558aa019997', 'selected Cosy pilot A is preserved exactly');
const report = {
  version: 3, status: 'complete-technical-validation',
  actors: {
    p1: { model: p1.model, revision: p1.modelRevision, recipe: p1.recipe,
      selectedPilot: { id: 'jotaro-a-reference', sha256: 'ce38180ec99e01abb523c5416d3bcd865e055b19a2520e496aea7558aa019997', userSelected: true },
      reference: { file: 'jotaro-dio.mp3', sha256: p1.reference.sha256, range: null, text: 'Ублюдок! Дио!' },
      sourceReportSha256: sha(readFileSync(args.get('--p1-report'))), generatorSha256: p1.generatorSha256,
      allRecordingsListeningApproved: false },
    p2: { model: p2.model, revision: p2.revision, recipe: 'original-full-icl',
      selectedPilot: { id: 'faceoff-mode-p2-v2', sha256: '639de7c08eddd6c2aff517a6d0edc4f316e1a47c697c58e87f0137d7e43a1ed1', userSelected: true },
      reference: p2.references.p2, sourceReportSha256: sha(readFileSync(args.get('--p2-report'))),
      generatorSha256: p2.generatorSha256, allRecordingsListeningApproved: false },
  },
  reviewScope: 'User selected Cosy pilot A for Jotaro and the earlier expressive Dio recipe. Every new line passed unprompted ASR and signal checks; this is not listening approval of all 57 performances.',
  asr: { model: asr.model, revision: asr.revision, forcedLanguage: false, targetTextPrompt: false, numBeams: asr.numBeams },
  processing: { tempo: 1, pitchShift: 0, sampleRate: 24000, channels: 1, mp3Kbps: 64 },
  copiedRecordings: [], failedOrMissing: [], allRecordingsListeningApproved: false,
  totalBytes: planned.reduce((sum, { row }) => sum + row.bytes, 0),
  previousBytes: script.utterances.reduce((sum, line) => sum + readFileSync(path.join(oldRoot, `${line.id}.mp3`)).length, 0),
  clips: planned.map(x => x.row),
};
// All checks above complete before any active asset/catalog is changed.
const output = path.join(root, 'public/assets/voices/spoken-v3');
mkdirSync(output, { recursive: true });
for (const { source, row } of planned) {
  const destination = path.join(output, `${row.id}.mp3`);
  if (path.resolve(source) !== path.resolve(destination)) copyFileSync(source, destination);
}
for (const [seat, actor] of [['p1', 'jotaro'], ['p2', 'dio']]) {
  const catalog = Object.fromEntries(report.clips.filter(row => row.speaker === seat).map(row => [row.id, {
    url: `/assets/voices/spoken-v3/${row.id}.mp3`, text: row.text, speaker: seat, duration: row.duration,
  }]));
  writeFileSync(path.join(root, `shared/generated-${actor}-voice-clips.js`),
    `// New JoJo dialogue; selected actor recipe and evidence: docs/JOJO-AUDIO-V3.md.\nexport const GENERATED_${actor.toUpperCase()}_VOICE_CLIPS = Object.freeze(${JSON.stringify(catalog, null, 2)});\n`);
}
writeFileSync(path.join(root, 'scripts/voice-production/jojo-v3-final-analysis.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ clips: report.clips.length, bytes: report.totalBytes, previousBytes: report.previousBytes }));
