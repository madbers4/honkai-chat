import { createArena } from '../src/arena.js';
import { buildHeavyCase } from './heavy-review.js';
import { buildGrappleCase } from './grapple-cases.js';
import { buildSpecialCase } from './special-review.js';

const $ = id => document.getElementById(id);
let errors = 0;
const originalError = console.error;
console.error = (...args) => { $('errors').textContent = `Ошибок: ${++errors} · ${String(args[0]).slice(0, 90)}`; originalError(...args); };
addEventListener('error', event => { $('errors').textContent = `Ошибка: ${event.message}`; });
const arena = await createArena($('stage'), { allowEffectReview: true });
$('errors').textContent = 'Ошибок: 0';
const supported = new Set(['hit', 'block', 'parry', 'grabStrike']);
let data, contacts, frame = 0, facing = 1, playing = false, token = 0, accumulator = 0, last = performance.now(), selectedContact = 0;

function show(index, seek = false) {
  frame = Math.max(0, Math.min(data.snapshots.length - 1, index));
  if (seek) { token++; arena.update(null, null); }
  const snapshot = data.snapshots[frame], contact = contacts.findLast(event => event.frame <= frame && frame - event.frame <= 18);
  // This is the arena's explicit local effect-review hook: the event still
  // comes from CombatRoom, never from a fabricated punch or a synthetic timer.
  const visualEffectFrame = !playing && contact ? { event: contact,
    state: { ...data.snapshots[contact.frame], visualSeekToken: token }, age: (frame - contact.frame) / 60 } : undefined;
  arena.update({ ...snapshot, phase: playing ? snapshot.phase : 'paused', visualSeekToken: token,
    events: playing ? data.events.filter(event => event.frame === frame) : [], visualEffectFrame }, 'p1');
  $('scrub').value = frame;
  $('clock').textContent = `${(frame / 60).toFixed(2)} с`;
  $('readout').textContent = `Контакты: ${contacts.length ? contacts.map(event => `${event.type}/${event.variant} @ ${event.frame}`).join(' · ') : 'нет — эффектов попадания быть не должно'}\n${snapshot.players.map(player => `${player.name}: ${player.hp} HP · ${player.variant || player.action}`).join(' / ')}\nРеальные события CombatRoom. Сначала смотрите на скорости 1×, затем контакт и +100 мс.`;
}
function pauseAt(index) { playing = false; $('play').textContent = 'Продолжить'; show(index, true); }
function contactFrame() { return contacts[selectedContact]?.frame ?? 24; }
function reset(play = false) {
  const kind = $('case').value;
  data = kind === 'grab' ? buildGrappleCase('two', facing)
    : kind === 'bolt' || kind === 'mine' ? buildSpecialCase({ variant: kind === 'mine' ? 'shockwave' : 'bolt', facing })
    : buildHeavyCase(kind === 'heavy' ? 'series' : kind, facing);
  contacts = data.events.filter(event => supported.has(event.type) && !(event.type === 'hit' && event.variant === 'grab'));
  selectedContact = 0; accumulator = 0; $('scrub').max = data.snapshots.length - 1;
  playing = play; $('play').textContent = play ? 'Пауза' : 'Продолжить'; show(play ? 0 : Math.max(0, contactFrame() - 1), true);
}
$('case').onchange = () => reset();
$('flip').onclick = () => { facing *= -1; reset(); };
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Пауза' : 'Продолжить'; show(frame, true); };
$('replay').onclick = () => reset(true);
$('previous').onclick = () => pauseAt(contactFrame() - 1);
$('contact').onclick = () => pauseAt(contactFrame() + 1);
$('after').onclick = () => pauseAt(contactFrame() + 6);
$('next').onclick = () => { selectedContact = contacts.length ? (selectedContact + 1) % contacts.length : 0; pauseAt(contactFrame() + 1); };
$('scrub').oninput = () => pauseAt(Number($('scrub').value));
$('low').onchange = () => { arena.setQuality($('low').checked ? 'low' : 'high'); show(frame, true); };
$('calm').onchange = () => { arena.setReducedMotion($('calm').checked); show(frame, true); };
$('phone').onchange = () => { document.body.classList.toggle('phone', $('phone').checked); arena.resize(); };
reset();
function loop(now) {
  const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
  if (playing) {
    accumulator += dt * Number($('speed').value);
    while (accumulator >= 1 / 60) {
      accumulator -= 1 / 60;
      if (frame < data.snapshots.length - 1) show(frame + 1); else { pauseAt(frame); break; }
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
addEventListener('pagehide', () => arena.dispose(), { once: true });
