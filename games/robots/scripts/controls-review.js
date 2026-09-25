import '../src/style.css';
import '../src/balance-ui.css';
import '../src/ultimate.css';
import '../src/combat-controls.css';
import { createArena } from '../src/arena.js';
import { createCombatUI } from '../src/combat-ui.js';
import { createUltimateUI } from '../src/ultimate-ui.js';
import { CombatRoom } from '../server/combat.js';
import { V5_ATTACKS, WINS_TO_MATCH } from '../shared/constants.js';
const style = document.createElement('style');
style.textContent = '#review{position:fixed;z-index:100;left:50%;top:68px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font:10px Arial;color:#eee}#review select{max-width:160px;background:#18282d;color:#eee;border:1px solid #52625f;padding:5px}#review label{display:flex;align-items:center;gap:4px}@media(max-height:550px){#review{top:53px;font-size:8px}}';
document.head.append(style);
const $ = id => document.getElementById(id), ui = createCombatUI(), ultimate = createUltimateUI(), arena = await createArena($('arena'));
let state, playerId;
function scene(kind) {
  const room = new CombatRoom(`CUE-${kind}`), a = room.addPlayer('ЛАТУННЫЙ ГРАФ'), b = room.addPlayer('ГОСПОЖА ИСКРА');
  room.ready(a.id); room.ready(b.id); const step = n => { for (let i = 0; i < n; i++) room.step(1 / 60); };
  step(181); a.x = -1.1; b.x = 1.1; a.energy = b.energy = 85; a.wins = 2; b.wins = 1; room.round = 4;
  playerId = a.id;
  if (kind === 'series') { room.beginAction(a, 'light'); step(11); }
  if (kind === 'heavy') { room.beginAction(a, 'heavy'); step(35); }
  if (kind === 'whiff') { a.x = -3.5; b.x = 3.5; room.beginAction(a, 'heavy'); step(41); }
  if (kind === 'pursue') { room.beginAction(a, 'light'); step(11); room.beginAction(a, 'heavy'); step(18); }
  if (['tech', 'pummel', 'throw'].includes(kind)) {
    room.beginAction(a, 'heavy', true); step(kind === 'tech' ? 17 : 32);
    if (kind === 'tech') playerId = b.id;
    if (kind === 'throw') { room.grabInput(a, 'light'); step(19); room.grabInput(a, 'light'); step(19); }
  }
  if (['burst', 'defend'].includes(kind)) { room.beginAction(a, 'heavy'); step(kind === 'burst' ? 27 : 40); playerId = b.id; }
  if (kind === 'finish') {
    a.wins = WINS_TO_MATCH - 1; b.hp = 1;
    room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' }); step(1);
  }
  state = room.snapshot();
  if (kind === 'paused') state.phase = 'paused';
  $('controls').classList.toggle('finisher-offer', state.phase === 'finishing');
  $('controls').classList.toggle('inactive', state.phase === 'paused');
  for (const p of state.players) {
    $(`name-${p.id}`).textContent = p.name; $(`you-${p.id}`).hidden = p.id !== playerId;
    $(`hp-${p.id}`).style.transform = `scaleX(${p.hp / p.maxHp})`; $(`hp-value-${p.id}`).textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    $(`energy-${p.id}`).style.transform = `scaleX(${p.energy / 100})`; $(`energy-label-${p.id}`).textContent = `${Math.floor(p.energy)}%`;
    $(`guard-${p.id}`).style.transform = `scaleX(${p.guard / 100})`;
    $(`wins-${p.id}`).textContent = Array.from({ length: WINS_TO_MATCH }, (_, i) => i < p.wins ? '◆' : '◇').join(' ');
  }
  $('round-label').textContent = `РАУНД ${state.round}`; $('timer').textContent = Math.ceil(state.time);
  $('ultimate-hint').textContent = '80 ⚡ · НАЖМИ'; $('game-room').textContent = 'ПРОВЕРКА УПРАВЛЕНИЯ';
  ui.reset(); ui.update(state, playerId); ultimate.update(state, playerId); arena.update(state, playerId);
}
$('scene').addEventListener('change', () => scene($('scene').value));
$('motion').addEventListener('change', () => { arena.setReducedMotion($('motion').checked); document.documentElement.style.setProperty('scroll-behavior', 'auto'); });
scene('idle');
// Repeating frozen snapshots models a paused review without changing cue identity.
setInterval(() => { ui.update(state, playerId); ultimate.update(state, playerId); arena.update(state, playerId); }, 1000 / 30);
