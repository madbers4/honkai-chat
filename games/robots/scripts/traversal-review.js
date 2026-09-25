import { CombatRoom } from '../server/combat.js';
import { ARENA_EDGE } from '../shared/constants.js';

export const TRAVERSAL_CASES = {
  cross: 'Перелёт через соперника', far: 'Оба края · высокий прыжок',
  edge: 'Посадка у стены', drop: 'Отпустить над соперником',
  bolt: 'Импульс у края', close: 'Ближний бой',
};

// Every frame is an actual authoritative simulation tick. Only the opening
// positions/customizations (and the drop-case apex) are staged for inspection.
export function buildTraversalCase(type = 'cross', facing = 1) {
  const room = new CombatRoom({ id: `TRAVEL_${type}`, random: () => .8 });
  const a = room.addPlayer('ЦИЛИНДР'), b = room.addPlayer('КОРОНА');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.customization = { body: 'cobalt', core: 'cyan', accessory: 'topHat' };
  b.customization = { body: 'ruby', core: 'amber', accessory: 'crown' };
  a.x = -2.1 * facing; b.x = 0;
  if (type === 'far') { a.x = -ARENA_EDGE * facing; b.x = ARENA_EDGE * facing; }
  if (type === 'edge' || type === 'bolt') {
    a.x = (ARENA_EDGE - (type === 'bolt' ? 3.1 : 2.1)) * facing;
    b.x = ARENA_EDGE * facing;
  }
  if (type === 'close') { a.x = -1.05; b.x = 1.05; }
  a.facing = facing; b.facing = -facing;
  const send = (p, action = null, move = 0) => room.input(p.id, {
    seq: p.lastSeq + 1, move, block: false, crouch: false, action,
  });
  const snapshots = [], events = [], seen = new Set();
  for (let frame = 0; frame < 144; frame++) {
    if (type === 'drop' && frame === 12) {
      a.x = b.x; a.y = 4.45; a.vy = 0; a.traversalJump = true;
      a.traversalSide = -facing; a.traversalLandingSide = 0; a.action = 'jump';
    }
    const jumping = ['cross', 'edge', 'far'].includes(type) && frame === 12;
    send(a, jumping ? 'jump' : type === 'bolt' && frame === 12 ? 'special' : null,
      ['cross', 'edge'].includes(type) && frame >= 12 && frame < 87 ? facing : 0);
    send(b, type === 'far' && frame === 12 ? 'jump' : null);
    room.step(1 / 60);
    const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) {
      seen.add(event.id); events.push({ ...event, frame });
    }
    snapshots.push(state);
  }
  return { snapshots, events };
}
