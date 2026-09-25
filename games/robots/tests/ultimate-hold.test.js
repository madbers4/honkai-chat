import test from 'node:test';
import assert from 'node:assert/strict';
import { createUltimatePress, ultimateAvailability } from '../src/ultimate-hold.js';
import { createControls } from '../src/input.js';

test('tap commits immediately, consumes invalid presses, and never re-fires a held source', () => {
  let state = { ready: true }, commits = 0;
  const press = createUltimatePress({ availability: () => state, commit: () => commits++ });
  assert.equal(press.begin(1), true); assert.equal(commits, 1);
  press.begin(1); press.begin(2); press.update(); assert.equal(commits, 1);
  press.release(2); press.begin(3); assert.equal(commits, 1, 'a different finger cannot release the owner');
  press.release(1); state.ready = false; assert.equal(press.begin('keyboard'), false);
  state.ready = true; press.update(); press.begin('keyboard'); assert.equal(commits, 1);
  press.release('keyboard'); press.begin('keyboard'); assert.equal(commits, 2);
  press.cancel(); state = { ready: false, immediate: true }; press.begin(4); assert.equal(commits, 3);
  press.update(); press.begin(4); assert.equal(commits, 3, 'finisher also consumes one edge');
});

test('hit, defense-only, death, cooldown and changed round guard a fresh activation', () => {
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
      addEventListener(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); }, removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn)); },
      fire(name, patch = {}) { for (const fn of listeners.get(name) || []) fn({ preventDefault() {}, target: this, ...patch }); } };
  }
  const buttons = ['ultimate', 'light', 'heavy', 'block'].map(element), stick = element(), nub = element(), doc = element(), win = element();
  Object.assign(doc, { hidden: false, querySelector: query => query === '#joystick' ? stick : query === '#stick-nub' ? nub : buttons.find(b => query.includes(b.dataset.action)), querySelectorAll: query => query === '[data-action]' ? buttons : [] });
  return { doc, win, ultimate: buttons[0] };
}

test('real controls send exactly one immediate action per tap and clean up every device lifecycle', t => {
  const names = ['document', 'window', 'matchMedia', 'setInterval', 'clearInterval', 'performance'];
  const old = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  const { doc, win, ultimate } = fakeSurface(); let now = 0, tick, portrait = false, enabled = true;
  Object.assign(globalThis, { document: doc, window: win, matchMedia: () => ({ matches: portrait }), performance: { now: () => now }, setInterval: fn => (tick = fn, 1), clearInterval() {} });
  const packets = [], controls = createControls({ send: p => packets.push(p), onAction: () => true, enabled: () => enabled, ultimateState: () => ({ ready: true, key: '1' }) });
  t.after(() => { controls.dispose(); for (const name of names) globalThis[name] = old[name]; });
  const fireCount = () => packets.filter(p => p.action === 'ultimate').length;
  ultimate.fire('pointerdown', { pointerId: 7 }); assert.equal(fireCount(), 1);
  ultimate.fire('pointerdown', { pointerId: 7 }); ultimate.fire('pointerdown', { pointerId: 8 }); tick(); assert.equal(fireCount(), 1);
  ultimate.fire('pointerup', { pointerId: 8 }); ultimate.fire('pointerup', { pointerId: 7 });
  ultimate.fire('pointerdown', { pointerId: 9 }); assert.equal(fireCount(), 2); ultimate.fire('pointercancel', { pointerId: 9 });
  win.fire('keydown', { code: 'KeyU' }); win.fire('keydown', { code: 'KeyU', repeat: true }); win.fire('keydown', { code: 'KeyU' });
  tick(); assert.equal(fireCount(), 3); win.fire('keyup', { code: 'KeyU' });
  for (const cancel of [() => win.fire('blur'), () => win.fire('pagehide'), () => { doc.hidden = true; doc.fire('visibilitychange'); }, () => { portrait = true; win.fire('resize'); }, () => { enabled = false; }]) {
    doc.hidden = false; portrait = false; enabled = true;
    const before = fireCount(); ultimate.fire('pointerdown', { pointerId: 10 }); assert.equal(fireCount(), before + 1);
    cancel(); tick(); now += 1000; tick(); assert.equal(fireCount(), before + 1, 'cancel cannot replay a committed action');
    ultimate.fire('pointerup', { pointerId: 10 });
  }
  doc.hidden = false; portrait = false; enabled = true;
  controls.dispose(); const count = packets.length;
  ultimate.fire('pointerdown', { pointerId: 11 }); win.fire('keydown', { code: 'KeyU' }); win.fire('pagehide');
  assert.equal(packets.length, count, 'disposed controls remove pointer and global lifecycle listeners');
});
