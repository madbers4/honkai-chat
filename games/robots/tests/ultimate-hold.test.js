import test from 'node:test';
import assert from 'node:assert/strict';
import { createUltimateHold, ultimateAvailability } from '../src/ultimate-hold.js';
import { createControls } from '../src/input.js';

test('hold commits once at .65s, never spends on early release, and cancelling requires a fresh edge', () => {
  let time = 0, state = { ready: true, key: 'round1' }, commits = 0;
  const history = [], hold = createUltimateHold({ availability: () => state, commit: () => commits++, progress: p => history.push(p), now: () => time });
  hold.begin(1); time = 640; hold.update(); assert.equal(commits, 0); hold.release(1); time = 800; hold.update(); assert.equal(commits, 0);
  hold.begin('keyboard'); time = 1450; hold.update(); hold.update(); assert.equal(commits, 1);
  hold.release('keyboard'); hold.begin(2); state = { ready: false, key: 'round1' }; hold.update(); state.ready = true; time = 2400; hold.update(); assert.equal(commits, 1);
  hold.begin(3); state.key = 'round2'; hold.update(); time = 3200; hold.update(); assert.equal(commits, 1);
  state.immediate = true; hold.begin(4); assert.equal(commits, 2, '3-second finisher invitation remains a tap');
  assert.ok(history.some(h => h.amount > .9));
});

test('new hit, defense-only, death, cooldown and changed round invalidate arming', () => {
  const player = { id: 'p1', hp: 180, y: 0, energy: 80, action: 'idle', cooldowns: {} }, state = { room: 'TEST', round: 1, phase: 'fight', players: [player] };
  assert.equal(ultimateAvailability(state, 'p1').ready, true);
  for (const patch of [{ hp: 0 }, { action: 'hit' }, { defenseOnly: .3 }, { y: .4 }, { energy: 79 }, { cooldowns: { ultimate: .1 } }, { grabbedBy: 'p2' }]) {
    const copy = { ...state, players: [{ ...player, ...patch }] }; assert.equal(ultimateAvailability(copy, 'p1').ready, false, JSON.stringify(patch));
  }
  assert.notEqual(ultimateAvailability(state, 'p1').key, ultimateAvailability({ ...state, round: 2 }, 'p1').key);
});

function fakeSurface() {
  function element(action) {
    const listeners = new Map(), classes = new Set();
    return { dataset: { action }, style: {}, matches: () => false, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      classList: { add: v => classes.add(v), remove: v => classes.delete(v) },
      addEventListener(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); }, removeEventListener() {},
      fire(name, patch = {}) { for (const fn of listeners.get(name) || []) fn({ preventDefault() {}, target: this, ...patch }); } };
  }
  const buttons = ['ultimate', 'light', 'heavy', 'block'].map(element), stick = element(), nub = element(), doc = element(), win = element();
  Object.assign(doc, { hidden: false, querySelector: query => query === '#joystick' ? stick : query === '#stick-nub' ? nub : buttons.find(b => query.includes(b.dataset.action)), querySelectorAll: query => query === '[data-action]' ? buttons : [] });
  return { doc, win, ultimate: buttons[0] };
}

test('real controls honor touch/keyboard holds and cancel on pointercancel, blur, hidden, orientation and disabled state', t => {
  const names = ['document', 'window', 'matchMedia', 'setInterval', 'clearInterval', 'performance'];
  const old = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  const { doc, win, ultimate } = fakeSurface(); let now = 0, tick, portrait = false, enabled = true;
  Object.assign(globalThis, { document: doc, window: win, matchMedia: () => ({ matches: portrait }), performance: { now: () => now }, setInterval: fn => (tick = fn, 1), clearInterval() {} });
  const packets = [], controls = createControls({ send: p => packets.push(p), onAction: () => true, enabled: () => enabled, ultimateState: () => ({ ready: true, key: '1' }) });
  t.after(() => { controls.dispose(); for (const name of names) globalThis[name] = old[name]; });
  const fireCount = () => packets.filter(p => p.action === 'ultimate').length;
  ultimate.fire('pointerdown', { pointerId: 7 }); now = 400; tick(); ultimate.fire('pointerup', { pointerId: 7 }); now = 800; tick(); assert.equal(fireCount(), 0);
  ultimate.fire('pointerdown', { pointerId: 8 }); now = 1450; tick(); tick(); assert.equal(fireCount(), 1); ultimate.fire('pointerup', { pointerId: 8 });
  win.fire('keydown', { code: 'KeyU' }); now += 650; tick(); assert.equal(fireCount(), 2); win.fire('keyup', { code: 'KeyU' });
  for (const cancel of [() => ultimate.fire('pointercancel', { pointerId: 9 }), () => win.fire('blur'), () => { doc.hidden = true; doc.fire('visibilitychange'); }, () => { portrait = true; win.fire('resize'); }, () => { enabled = false; }]) {
    doc.hidden = false; portrait = false; enabled = true; ultimate.fire('pointerdown', { pointerId: 9 }); now += 300; cancel(); tick(); now += 500; tick(); assert.equal(fireCount(), 2);
  }
});
