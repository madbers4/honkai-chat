import test from 'node:test';
import assert from 'node:assert/strict';
import { installMenuViewport } from '../src/menu-viewport.js';

function fixture(withViewport = true) {
  const host = new EventTarget();
  host.innerHeight = 844;
  let frameId = 0;
  const frames = new Map();
  host.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  host.cancelAnimationFrame = id => frames.delete(id);
  if (withViewport) host.visualViewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const styles = new Map(), classes = new Set();
  const doc = { documentElement: {
    style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
    classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); }, remove: key => classes.delete(key) },
  } };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { host, doc, frames, styles, classes, flush };
}

test('keyboard visual viewport resize and pan keep menus within visible bounds', () => {
  const f = fixture();
  const dispose = installMenuViewport({ window: f.host, document: f.doc });
  assert.equal(f.styles.get('--menu-viewport-height'), '844px');
  f.host.visualViewport.height = 218.4;
  f.host.visualViewport.offsetTop = 105.7;
  f.host.visualViewport.dispatchEvent(new Event('resize'));
  f.host.visualViewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.frames.size, 1, 'resize and pan share one layout update');
  f.flush();
  assert.equal(f.styles.get('--menu-viewport-height'), '218px');
  assert.equal(f.styles.get('--menu-viewport-top'), '106px');
  assert.ok(f.classes.has('menu-viewport-short'), 'short keyboard area releases fixed form rows');
  f.host.visualViewport.height = 844;
  f.host.visualViewport.offsetTop = 0;
  f.host.visualViewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--menu-viewport-height'), '844px');
  assert.ok(!f.classes.has('menu-viewport-short'));
  dispose();
  assert.equal(f.styles.size, 0);
  f.host.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(f.frames.size, 0);
});

test('older browsers use window height and release a pending update on disposal', () => {
  const f = fixture(false);
  const dispose = installMenuViewport({ window: f.host, document: f.doc });
  f.host.innerHeight = 360;
  f.host.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--menu-viewport-height'), '360px');
  assert.equal(f.styles.get('--menu-viewport-top'), '0px');
  f.host.dispatchEvent(new Event('resize'));
  dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.styles.size, 0);
});
