import { createUltimatePress } from './ultimate-hold.js';

export function createControls({ send, onAction, enabled, ultimateState = () => ({ ready: true, key: 'default' }), onUltimateHold }) {
  const keys = new Set(), actionPointers = new Map(), listeners = [];
  const listen = (target, name, fn) => { target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn)); };
  let seq = 0, stickPointer = null, stickMove = 0, stickCrouch = false, jumpLatched = false;
  const stick = document.querySelector('#joystick'), nub = document.querySelector('#stick-nub');
  const canSend = () => enabled() && !document.hidden && !matchMedia('(orientation: portrait) and (max-width: 700px)').matches;
  const intent = () => ({
    move: stickPointer !== null ? stickMove : (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
    crouch: stickCrouch || keys.has('KeyS') || keys.has('ArrowDown'),
    block: [...actionPointers.values()].includes('block') || keys.has('Space'),
  });
  const input = (action = null) => {
    if (!canSend()) return;
    const held = intent();
    // Invalid energy/cooldown taps give immediate feedback without interrupting the held joystick.
    const accepted = !action || onAction(action, held) !== false;
    send({ type: 'input', seq: ++seq, ...held, action: accepted ? action : null });
  };
  const ultimate = createUltimatePress({ availability: () => canSend() ? ultimateState() : { ready: false }, commit: () => input('ultimate'), progress: onUltimateHold });
  const pressUltimate = source => { if (onAction('ultimate', intent()) !== false) ultimate.begin(source); };
  const neutral = () => {
    ultimate.cancel();
    keys.clear(); actionPointers.clear(); stickPointer = null; stickMove = 0; stickCrouch = false; jumpLatched = false;
    if (nub) nub.style.transform = '';
    document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
    send({ type: 'input', seq: ++seq, move: 0, crouch: false, block: false, action: null });
  };
  const bindings = { KeyW:'jump', ArrowUp:'jump', KeyJ:'light', KeyK:'heavy', KeyL:'special', KeyU:'ultimate', ShiftLeft:'dash', ShiftRight:'dash' };
  const keydown = e => {
    if (e.target.matches('input,textarea') || !canSend()) return;
    if (bindings[e.code] || ['Space','KeyA','KeyD','KeyS','ArrowLeft','ArrowRight','ArrowDown'].includes(e.code)) e.preventDefault();
    if (e.repeat || keys.has(e.code)) return;
    keys.add(e.code);
    if (e.code === 'KeyU') pressUltimate('keyboard'); else input(bindings[e.code] || null);
    if (bindings[e.code]) document.querySelector(`[data-action="${bindings[e.code]}"]`)?.classList.add('pressed');
    if (e.code === 'Space') document.querySelector('[data-action="block"]')?.classList.add('pressed');
  };
  const keyup = e => {
    if (e.code === 'KeyU') ultimate.release('keyboard');
    keys.delete(e.code); input();
    const action = bindings[e.code] || (e.code === 'Space' ? 'block' : null);
    if (action) document.querySelector(`[data-action="${action}"]`)?.classList.remove('pressed');
  };
  const updateStick = e => {
    const rect = stick.getBoundingClientRect(), max = rect.width * .32;
    let x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(x, y); if (length > max) { x *= max / length; y *= max / length; }
    nub.style.transform = `translate(${x}px, ${y}px)`;
    stickMove = Math.abs(x) < max * .2 ? 0 : Math.max(-1, Math.min(1, x / (max * .7)));
    stickCrouch = y > max * .65;
    if (y < -max * .6 && !jumpLatched) { jumpLatched = true; input('jump'); }
    else { if (y > -max * .3) jumpLatched = false; input(); }
  };
  listen(stick, 'pointerdown', e => {
    if (!canSend() || stickPointer !== null) return;
    e.preventDefault(); stickPointer = e.pointerId; stick.setPointerCapture(e.pointerId); stick.classList.add('pressed'); updateStick(e);
  });
  listen(stick, 'pointermove', e => { if (e.pointerId === stickPointer) updateStick(e); });
  const releaseStick = e => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null; stickMove = 0; stickCrouch = false; jumpLatched = false; nub.style.transform = ''; stick.classList.remove('pressed'); input();
  };
  ['pointerup','pointercancel','lostpointercapture'].forEach(event => listen(stick, event, releaseStick));
  document.querySelectorAll('[data-action]').forEach(button => {
    listen(button, 'pointerdown', e => {
      if (!canSend() || actionPointers.has(e.pointerId)) return;
      e.preventDefault(); button.setPointerCapture(e.pointerId); actionPointers.set(e.pointerId, button.dataset.action); button.classList.add('pressed');
      if (button.dataset.action === 'ultimate') pressUltimate(e.pointerId);
      else input(button.dataset.action === 'block' ? null : button.dataset.action);
    });
    const release = e => { ultimate.release(e.pointerId); actionPointers.delete(e.pointerId); button.classList.remove('pressed'); input(); };
    ['pointerup','pointercancel','lostpointercapture'].forEach(event => listen(button, event, release));
  });
  listen(window, 'keydown', keydown); listen(window, 'keyup', keyup);
  listen(window, 'blur', neutral); listen(window, 'pagehide', neutral);
  listen(document, 'visibilitychange', () => { if (document.hidden) neutral(); });
  listen(window, 'resize', () => { if (!canSend()) neutral(); });
  const interval = setInterval(() => { ultimate.update(); input(); }, 1000 / 30);
  return { neutral, intent, resetSequence() { seq = 0; }, dispose() { clearInterval(interval); neutral(); for (const remove of listeners) remove(); } };
}
