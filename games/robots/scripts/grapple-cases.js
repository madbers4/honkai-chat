import { CombatRoom } from '../server/combat.js';
import { V3_RULES } from '../shared/constants.js';

export const GRAPPLE_CASES = {
  two: 'Два удара / бросок', one: 'Один удар', hold: 'Удержание',
  early: 'Ранний бросок', back: 'Через спину', tech: 'Выход', whiff: 'Промах',
};

// Production inputs and snapshots. Only the initial separation is staged.
export function buildGrappleCase(type = 'two', facing = 1, distance = 2.1) {
  const room = new CombatRoom({ id: `grapple_${type}`, random: () => .5 });
  room.addPlayer('ИСКРА'); room.addPlayer('ИНЕЙ'); room.ready('p1'); room.ready('p2');
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const a = room.player('p1'), b = room.player('p2');
  const separation = type === 'whiff' ? 3.05 : distance;
  a.x = -separation * facing / 2; b.x = separation * facing / 2; a.facing = facing; b.facing = -facing;
  const snapshots = [], events = [], seen = new Set(), fired = new Set();
  const send = (who, action, held = {}) => room.input(who.id, { seq: who.lastSeq + 1, move: 0, crouch: false, block: false, action, ...held });
  const once = (key, condition, run) => { if (condition && !fired.has(key)) { fired.add(key); run(); } };
  for (let frame = 0; frame <= 228; frame++) {
    once('start', frame === 0, () => send(a, 'heavy', { crouch: true }));
    once('tech', type === 'tech' && b.grabbedBy && b.grabHoldTime >= .15, () => send(b, 'light'));
    const strike = ['one', 'two', 'back'].includes(type);
    once('strike1', strike && a.grabTarget && a.grabHoldTime >= V3_RULES.grabTech + .035, () => send(a, 'light'));
    once('strike2', ['two', 'back'].includes(type) && a.grabTarget && a.grabStrikes === 1 && a.grabStrikeTime == null && a.grabHoldTime > .65, () => send(a, 'light'));
    const pummelsDone = type === 'one' ? a.grabStrikes === 1 : a.grabStrikes === 2;
    once('throw', a.grabTarget && (type === 'early' || strike && pummelsDone && a.grabStrikeTime == null),
      () => send(a, 'heavy', { move: type === 'back' ? -a.facing : 0 }));
    room.step(1 / 60);
    const snapshot = room.snapshot();
    for (const event of snapshot.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(snapshot);
  }
  const contacts = events.filter(event => ['grab', 'grabStrike', 'throw', 'grabBreak', 'land'].includes(event.type));
  return { snapshots, events, contacts };
}
