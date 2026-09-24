import { CombatRoom } from '../server/combat.js';

export function buildSpecialCase({ variant = 'bolt', facing = 1, skin = 'amber', defense = 'none' } = {}) {
  const room = new CombatRoom({ id: 'SPECIAL', random: () => .8 });
  const a = room.addPlayer('ОПЕРАТОР'), b = room.addPlayer('СОПЕРНИК');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const distance = variant === 'shockwave' ? 3.2 : 5.2;
  a.x = -distance * .5 * facing; b.x = distance * .5 * facing;
  a.facing = facing; b.facing = -facing; a.skin = skin; b.skin = skin === 'amber' ? 'cyan' : 'amber'; a.energy = 100;
  const snapshots = [], events = [], seen = new Set();
  const input = (p, values) => room.input(p.id, { seq: p.lastSeq + 1, move: 0, crouch: false, block: false, ...values });
  for (let frame = 0; frame < 150; frame++) {
    if (frame === 12) input(a, { action: 'special', crouch: variant === 'shockwave' });
    if (defense === 'block') input(b, { block: true });
    if (defense === 'jump' && frame === 34) input(b, { action: 'jump' });
    if (defense === 'retreat' && frame >= 22) input(b, { move: facing });
    room.step(1 / 60); const state = room.snapshot();
    for (const e of state.events) if (!seen.has(e.id)) { seen.add(e.id); events.push({ ...e, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events, release: snapshots.findIndex(s => s.projectiles.length), impact: events.find(e => ['hit','block','parry'].includes(e.type))?.frame,
    charge: variant === 'shockwave' ? 32 : 25, recovery: variant === 'shockwave' ? 64 : 49 };
}
