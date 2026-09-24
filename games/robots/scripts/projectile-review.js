import { CombatRoom } from '../server/combat.js';

export function buildProjectileCase({ facing = 1, skin = 'amber', variant = 'bolt', block = false } = {}) {
  const room = new CombatRoom({ id: 'BOLT', random: () => .8 });
  const a = room.addPlayer('ИМПУЛЬС'), b = room.addPlayer('МИШЕНЬ');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.x = -3.5 * facing; b.x = 3.5 * facing; a.facing = facing; b.facing = -facing;
  a.skin = skin; b.skin = skin === 'amber' ? 'cyan' : 'amber'; a.energy = 100;
  const snapshots = [], events = [], seen = new Set();
  for (let frame = 0; frame < 130; frame++) {
    if (frame === 8) room.input(a.id, { seq: a.lastSeq + 1, move: 0, action: 'special', crouch: variant === 'shockwave', block: false });
    if (block) room.input(b.id, { seq: b.lastSeq + 1, move: 0, block: true, crouch: false });
    room.step(1 / 60);
    const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events, flight: snapshots.findIndex(s => s.projectiles.length), contact: events.find(e => ['hit', 'block'].includes(e.type))?.frame };
}
