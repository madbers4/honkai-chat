import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceoffUI } from '../src/faceoff-ui.js';
import { buildFaceoff } from '../shared/faceoff-script.js';

class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...children) { this.children.push(...children); children.forEach(c => c.parent = this); }
  insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parent = this; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  set innerHTML(_) { throw Error('User content must not use HTML parsing'); }
}
const doc = { createElement: tag => new Element(tag, doc) };
const find = (root, name) => root.className?.split(' ').includes(name) ? root : root.children.map(c => find(c, name)).find(Boolean);
test('faceoff presents escaped names, server-clock identity recovery, pause and disposal', () => {
  const mount = new Element('main', doc), ui = createFaceoffUI(mount);
  const players = [{ id: 'p1', name: '<img src=x onerror=alert(1)>' }, { id: 'p2', name: 'Медный Сом' }], beats = buildFaceoff(players, 42);
  const update = (elapsed, patch = {}) => ui.update({ active: true, sequenceId: 'same', elapsed, players, beats, ...patch });
  update(.5); assert.equal(ui.element.hidden, false); assert.equal(ui.element.dataset.revealed, 'false');
  assert.equal(find(ui.element, 'faceoff-real-name').textContent, players[0].name);
  assert.equal(find(ui.element, 'faceoff-line').textContent, beats[1].text);
  update(11.9); assert.equal(ui.element.dataset.glitch, 'true'); assert.equal(find(ui.element, 'faceoff-heading').textContent, 'ОШИБКА ПРОШИВКИ');
  update(13.4); assert.equal(ui.element.dataset.revealed, 'true'); assert.equal(ui.element.dataset.glitch, 'false');
  assert.equal(find(ui.element, 'faceoff-speaker').textContent, players[0].name);
  update(13.4, { paused: true, reducedMotion: true }); assert.equal(ui.element.dataset.reduced, 'true');
  assert.equal(find(ui.element, 'faceoff-countdown').textContent, 'ЖДЁМ ВОЗВРАЩЕНИЯ СОПЕРНИКА');
  assert.equal(find(ui.element, 'faceoff-progress-fill').style.transform, `scaleX(${13.4 / 24})`);
  update(24, { active: false }); assert.equal(ui.element.hidden, true); ui.dispose(); ui.dispose(); assert.equal(mount.children.length, 0);
});
