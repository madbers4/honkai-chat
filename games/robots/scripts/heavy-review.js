import { CombatRoom } from '../server/combat.js';
import { V5_ATTACKS } from '../shared/constants.js';

export const HEAVY_CASES = { series: 'Тяжёлая серия', single: 'Одно нажатие', stop: 'Остановиться после крюка', block: 'Блок', whiff: 'Промах', parry: 'Парирование', late: 'Поздняя серия / блок', burst: 'Сброс серии', light: 'Быстрая серия' };

// Recorded from production input + fixed-step simulation. No pose or hit is
// manufactured: only the initial root placement is staged for the review.
export function buildHeavyCase(type = 'series', facing = 1) {
  const room = new CombatRoom({ id: 'HEAVY', random: () => .8 });
  const a = room.addPlayer('ПРОБОЙ'), b = room.addPlayer('ОПОРА');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const distance = type === 'whiff' ? 4.2 : 2.5;
  a.x = -distance / 2 * facing; b.x = distance / 2 * facing; a.facing = facing; b.facing = -facing;
  if (type === 'burst') b.energy = 60;
  const send = (p, action = null, extra = {}) => room.input(p.id, { seq: p.lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
  const fired = new Set(), seen = new Set(), snapshots = [], events = [];
  const once = (key, condition, run) => { if (condition && !fired.has(key)) { fired.add(key); run(); } };
  for (let frame = 0; frame < 4 * 60; frame++) {
    if (type === 'block') send(b, null, { block: true });
    once('start', frame === (type === 'block' ? 12 : 0), () => send(a, type === 'light' ? 'light' : 'heavy'));
    if (['series', 'stop', 'late', 'burst'].includes(type)) {
      const lag = type === 'late' ? .23 : .13;
      once('hook', a.variant === 'heavyDrive' && a.cancelWindow > 0 && a.actionTime >= V5_ATTACKS.heavyDrive.startup + lag, () => send(a, 'heavy'));
      if (type !== 'stop') once('press', a.variant === 'heavyHook' && a.cancelWindow > 0 && a.actionTime >= V5_ATTACKS.heavyHook.startup + .13, () => send(a, 'heavy'));
    }
    if (type === 'late' && fired.has('hook')) send(b, null, { block: true });
    if (type === 'parry' && a.variant === 'heavyDrive' && a.actionTime >= V5_ATTACKS.heavyDrive.startup - .08) send(b, null, { block: true });
    once('burst', type === 'burst' && b.action === 'hit' && a.variant === 'heavyHook', () => send(b, 'dash'));
    if (type === 'light') {
      once('cross', a.variant === 'jab' && a.cancelWindow > 0 && a.actionTime >= .18, () => send(a, 'light'));
      once('rake', a.variant === 'cross' && a.cancelWindow > 0 && a.actionTime >= .22, () => send(a, 'light'));
    }
    room.step(1 / 60);
    const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  const contacts = events.filter(e => ['hit', 'block', 'parry', 'burst'].includes(e.type));
  return { snapshots, events, contacts };
}
