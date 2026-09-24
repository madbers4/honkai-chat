import { CombatRoom } from '../server/combat.js';

export const RECOIL_CASES = { jab: 'Джеб', cross: 'Джеб → кросс', drive: 'Сильный удар', heavy: 'Тяжёлая серия', repeat: 'Быстрая повторная серия' };

// Only starting spacing is staged. Hits, hitstop, repeat interruption and
// durations are recorded from the production input handler and CombatRoom.
export function buildRecoilCase(type = 'jab', facing = 1) {
  const room = new CombatRoom({ id: 'RECOIL', random: () => .8 });
  const a = room.addPlayer('УДАР'), b = room.addPlayer('РЕАКЦИЯ');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const separation = ['heavy', 'drive'].includes(type) ? 2.5 : 2.1;
  a.x = -separation / 2 * facing; b.x = separation / 2 * facing; a.facing = facing; b.facing = -facing;
  const send = action => room.input(a.id, { seq: a.lastSeq + 1, move: 0, block: false, crouch: false, action });
  const fired = new Set(), seen = new Set(), snapshots = [], events = [];
  const once = (key, condition, run) => { if (condition && !fired.has(key)) { fired.add(key); run(); } };
  for (let frame = 0; frame < 3.5 * 60; frame++) {
    once('start', frame === 15, () => send(['heavy', 'drive'].includes(type) ? 'heavy' : 'light'));
    if (['cross', 'repeat'].includes(type)) once('cross', a.variant === 'jab' && a.cancelWindow > 0 && a.actionTime >= (type === 'repeat' ? .12 : .20), () => send('light'));
    if (type === 'repeat') once('rake', a.variant === 'cross' && a.cancelWindow > 0, () => send('light'));
    if (type === 'heavy') {
      once('hook', a.variant === 'heavyDrive' && a.cancelWindow > 0 && a.actionTime >= .42, () => send('heavy'));
      once('press', a.variant === 'heavyHook' && a.cancelWindow > 0 && a.actionTime >= .36, () => send('heavy'));
    }
    room.step(1 / 60);
    const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events, contacts: events.filter(event => event.type === 'hit') };
}
