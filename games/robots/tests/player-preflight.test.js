import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerPreflight } from '../src/player-preflight.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(prepare = async () => {}) {
  const commits = [], states = [];
  const flow = createPlayerPreflight({ prepare, commit: () => commits.push('ready'), changed: state => states.push(state) });
  return { flow, commits, states };
}
function finishWorkshop(flow) { flow.savePassport('Барон Кабачок'); flow.saveAppearance(); flow.soundChecked(); }

test('cached identity does not skip appearance or the phone sound check', async () => {
  const { flow, commits } = fixture();
  assert.equal(flow.edit('appearance'), false);
  assert.equal(flow.edit('sound'), false);
  assert.equal(flow.savePassport('   '), false);
  flow.savePassport('Старое сохранённое имя');
  flow.soundChecked();
  assert.equal(await flow.confirm(), false);
  assert.equal(flow.edit('sound'), false);
  flow.saveAppearance();
  assert.equal(await flow.confirm(), false);
  flow.soundChecked();
  assert.equal(await flow.confirm(), true);
  assert.deepEqual(commits, ['ready']);
});

test('ready waits for assets; double taps cannot send it twice', async () => {
  const wait = deferred(), { flow, commits } = fixture(() => wait.promise);
  finishWorkshop(flow);
  const first = flow.confirm();
  assert.equal(flow.snapshot().busy, true);
  assert.deepEqual(commits, []);
  assert.equal(await flow.confirm(), false);
  assert.equal(flow.edit('passport'), false);
  wait.resolve(); assert.equal(await first, true);
  assert.equal(await flow.confirm(), false);
  assert.deepEqual(commits, ['ready']);
});

test('failed asset preparation is retryable but never readies the player', async () => {
  let attempts = 0;
  const { flow, commits } = fixture(async progress => { progress('Озвучка 12 / 57'); if (++attempts === 1) throw Error('Missing MP3'); });
  finishWorkshop(flow);
  assert.equal(await flow.confirm(), false);
  assert.equal(flow.snapshot().busy, false);
  assert.match(flow.snapshot().error, /повтори/);
  assert.deepEqual(commits, []);
  assert.equal(await flow.confirm(), true);
  assert.equal(attempts, 2); assert.deepEqual(commits, ['ready']);
});

test('leaving or disconnecting during preload invalidates late success and progress', async () => {
  for (const action of ['cancel', 'reset']) {
    const wait = deferred(); let progress;
    const { flow, commits } = fixture(callback => { progress = callback; return wait.promise; });
    finishWorkshop(flow); const first = flow.confirm();
    flow[action](); progress('Поздний callback'); wait.resolve();
    assert.equal(await first, false);
    assert.equal(flow.snapshot().progress, '');
    assert.deepEqual(commits, []);
    if (action === 'reset') assert.equal(await flow.confirm(), false);
  }
});

test('muting after the sound check or during loading requires a new audible check', async () => {
  const wait = deferred(), { flow, commits } = fixture(() => wait.promise);
  finishWorkshop(flow); const first = flow.confirm();
  flow.soundMuted(); wait.resolve(); assert.equal(await first, false);
  assert.equal(await flow.confirm(), false); assert.deepEqual(commits, []);
  flow.soundChecked(); assert.equal(await flow.confirm(), true);
});

test('editing appearance requires saving it and rechecking sound again', async () => {
  const { flow } = fixture(); finishWorkshop(flow);
  assert.equal(flow.edit('appearance'), true);
  assert.equal(flow.snapshot().appearance, false); assert.equal(flow.snapshot().heard, false);
  assert.equal(flow.edit('sound'), false);
  flow.saveAppearance(); assert.equal(await flow.confirm(), false);
  flow.soundChecked(); assert.equal(await flow.confirm(), true);
});

test('the room/stage check can reject commit even after assets loaded', async () => {
  const flow = createPlayerPreflight({ prepare: async () => {}, commit: () => false });
  finishWorkshop(flow);
  assert.equal(await flow.confirm(), false); assert.equal(flow.snapshot().committed, false);
  assert.match(flow.snapshot().error, /соединение/);
});
