import { CombatRoom } from '../server/combat.js';

export const SLAM_CASES = {
  early: 'Низкий прыжок', apex: 'С верхней точки', late: 'Позднее пикирование',
  block: 'Контакт в блок', airMiss: 'Соперник в воздухе', miss: 'Промах по дистанции',
};

// All movement, contact timing, hit/block and recovery come from CombatRoom.
// Only the initial horizontal distance is staged for a repeatable camera view.
export function buildSlamCase(type = 'apex', facing = 1) {
  const room = new CombatRoom({ id: 'SLAM', random: () => .8 });
  const a = room.addPlayer('ПИКИРОВАНИЕ'), b = room.addPlayer('ОПОРА');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const distance = type === 'miss' ? 4.2 : 2.5;
  a.x = -distance / 2 * facing; b.x = distance / 2 * facing; a.facing = facing; b.facing = -facing;
  const send = (p, action = null, extra = {}) => room.input(p.id, { seq: p.lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
  const snapshots = [], events = [], seen = new Set();
  const heavyFrame = type === 'early' ? 18 : type === 'late' ? 45 : 33;
  for (let frame = 0; frame < 180; frame++) {
    if (type === 'block') send(b, null, { block: true });
    if (frame === 12) send(a, 'jump');
    if (frame === heavyFrame) send(a, 'heavy');
    if (type === 'airMiss' && frame === heavyFrame - 2) send(b, 'jump');
    room.step(1 / 60);
    const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events, contacts: events.filter(event => event.type === 'slam') };
}
