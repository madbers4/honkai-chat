import { CombatRoom } from '../server/combat.js';
import { buildGrappleCase } from './grapple-cases.js';
export const TURN_CASES = { back: 'Бросок через спину', crossing: 'Прыжок через соперника', punish: 'Удар после смены стороны' };
export function buildTurnCase(type = 'back', facing = 1) {
  if (type === 'back') return annotate(buildGrappleCase('back', facing));
  const room = new CombatRoom({ id: 'turn-review', random: () => .5 });
  room.addPlayer('ИСКРА'); room.addPlayer('ИНЕЙ'); room.ready('p1'); room.ready('p2');
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const a = room.player('p1'), b = room.player('p2');
  a.x = -1.05 * facing; b.x = 1.05 * facing; a.facing = facing; b.facing = -facing;
  const snapshots = [], events = [], seen = new Set(); let crossed = -1;
  const send = (p, action, move = 0) => room.input(p.id, { seq: p.lastSeq + 1, action, move, block: false, crouch: false });
  for (let frame = 0; frame <= 150; frame++) {
    if (frame === 0) send(a, 'jump', facing);
    if (frame === 15) send(a, 'dash', facing);
    if (frame === 12 || frame === 20) send(b, null, -facing);
    if (frame === (type === 'punish' ? 27 : 42)) send(b, null, 0);
    if (frame > 0 && frame % 8 === 0) send(a, null, frame < 42 ? facing : 0);
    if (crossed < 0 && a.facing === -facing) crossed = frame;
    if (type === 'punish' && frame === crossed + 6 && crossed >= 0) send(b, 'light');
    room.step(1 / 60); const snapshot = room.snapshot(); snapshots.push(snapshot);
    for (const event of snapshot.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
  }
  return annotate({ snapshots, events, contacts: [] });
}
function annotate(data) {
  data.turns = [];
  data.snapshots.forEach((s, frame) => { if (frame) s.players.forEach((p, i) => {
    if (p.facing !== data.snapshots[frame - 1].players[i].facing) data.turns.push({ frame, id: p.id, action: p.action });
  }); });
  return data;
}
