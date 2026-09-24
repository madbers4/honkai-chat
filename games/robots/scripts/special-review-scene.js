import { createArena } from '../src/arena.js';
import { buildSpecialCase } from './special-review.js';
const $ = id => document.getElementById(id);
let errors = 0; const originalError = console.error;
console.error = (...values) => { $('errors').textContent = `Ошибок: ${++errors} ${String(values[0]).slice(0,120)}`; originalError(...values); };
addEventListener('error', e => { $('errors').textContent = `Ошибка: ${e.message}`; });
const arena = await createArena($('stage'), { allowEffectReview: true });
let data, facing = 1, skin = 'amber', frame = 0, playing = false, token = 0, accumulator = 0, last = performance.now();
const firstFrame = new Map();
function show(index, seek = false) {
  frame = Math.max(0, Math.min(149, index)); const s = data.snapshots[frame];
  if (seek) { token++; arena.update(null, null); }
  const event = data.events.find(e => e.frame === data.impact);
  const fxFrame = !playing && event && frame >= data.impact && frame - data.impact < 23
    ? { event, state: { ...data.snapshots[data.impact], visualSeekToken: token }, age: (frame - data.impact) / 60 } : undefined;
  arena.update({ ...s, phase: playing ? s.phase : 'paused', visualSeekToken: token,
    events: playing ? s.events.filter(e => firstFrame.get(e.id) === frame) : [], visualEffectFrame: fxFrame }, 'p1');
  $('scrub').value = frame; $('clock').textContent = `${(frame / 60).toFixed(2)}с`;
  $('info').textContent = `Кадр ${frame} · выпуск ${data.release} · контакт ${data.impact ?? 'избежали'}\n${s.players.map(p => `${p.name}: ${p.hp}/${p.maxHp} HP · ${p.variant || p.action} · y=${p.y.toFixed(2)}`).join('\n')}\n${s.projectiles.map(p => `${p.variant}: x=${p.x.toFixed(2)} · age=${p.age?.toFixed(2)}`).join('\n')}`;
}
function pose(index) { playing = false; $('play').textContent = 'Продолжить'; show(index, true); }
function reset(play = false) {
  data = buildSpecialCase({ variant: $('variant').value, defense: $('defense').value, facing, skin });
  firstFrame.clear(); data.events.forEach(e => firstFrame.set(e.id, e.frame));
  playing = play; $('play').textContent = play ? 'Пауза' : 'Продолжить'; accumulator = 0; show(play ? 0 : data.charge, true);
}
$('variant').onchange = () => reset(); $('defense').onchange = () => reset();
$('flip').onclick = () => { facing *= -1; reset(); }; $('skin').onclick = () => { skin = skin === 'amber' ? 'cyan' : 'amber'; reset(); };
$('charge').onclick = () => pose(data.charge); $('release').onclick = () => pose(data.release + ($('variant').value === 'shockwave' ? 8 : 1));
$('impact').onclick = () => pose(data.impact ?? data.release + 16); $('lift').onclick = () => pose((data.impact ?? data.release) + 10);
$('recover').onclick = () => pose(data.recovery); $('scrub').oninput = () => pose(Number($('scrub').value));
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Пауза' : 'Продолжить'; show(frame); };
$('replay').onclick = () => reset(true); $('low').onchange = () => { arena.setQuality($('low').checked ? 'low' : 'high'); show(frame,true); };
$('calm').onchange = () => { arena.setReducedMotion($('calm').checked); show(frame,true); };
$('glow').onchange = () => arena.setGlowEnabled($('glow').checked);
$('phone').onchange = () => { document.body.classList.toggle('phone',$('phone').checked); arena.resize(); };
reset();
function loop(now) {
  const dt = Math.max(0,Math.min(.1,(now-last)/1000)); last = now;
  if (playing) { accumulator += dt; while (accumulator >= 1/60) { accumulator -= 1/60; if (frame < 149) show(frame+1); else { pose(frame); break; } } }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
