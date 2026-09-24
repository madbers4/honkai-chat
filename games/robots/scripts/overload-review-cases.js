import { CombatRoom } from '../server/combat.js';
export function buildOverloadCase(type = 'contact', facing = 1) {
  const room = new CombatRoom({ id: 'OVERLOAD', random: () => .8 }), a = room.addPlayer('РЕАКТОР'), b = room.addPlayer('ЦЕЛЬ');
  room.ready(a.id); room.ready(b.id); for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.x = (type === 'interrupt' ? -1.05 : -2) * facing; b.x = -a.x; a.facing = facing; b.facing = -facing; a.energy = 80;
  const snapshots = [], events = [], seen = new Set();
  const input = (p, patch = {}) => room.input(p.id, { seq: p.lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...patch });
  for (let frame = 0; frame < 240; frame++) {
    if (frame === 12) input(a, { action: 'ultimate' });
    if (type === 'block') input(b, { block: true });
    if (type === 'escape' && frame >= 36) input(b, { move: facing, action: frame === 36 ? 'dash' : null });
    if (type === 'interrupt' && frame === 36) input(b, { action: 'light' });
    room.step(1 / 60); const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events };
}
