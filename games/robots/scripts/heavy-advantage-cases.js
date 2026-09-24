import { CombatRoom } from '../server/combat.js';
import { ARENA_EDGE, HEAVY_RULES, V5_ATTACKS } from '../shared/constants.js';

export const HEAVY_ADVANTAGE_CASES = { series: 'Тяжёлая серия', block: 'Защититься блоком', jump: 'Перепрыгнуть', retreat: 'Отскок назад', jab: 'Ответный джеб запрещён', late: 'Поздний крюк / блок', whiff: 'Промах', slam: 'Пике / отскок жертвы' };
export function buildHeavyAdvantageCase(type = 'series', facing = 1, { corner = false, late = type === 'late' } = {}) {
  const room = new CombatRoom({ id: 'HEAVY-ADVANTAGE', random: () => .8 });
  const a = room.addPlayer('ТЯЖЁЛЫЙ'), b = room.addPlayer('ЗАЩИТА'); room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const distance = type === 'whiff' ? 4.3 : 2.45;
  a.x = (corner ? ARENA_EDGE - distance : -distance / 2) * facing; b.x = (corner ? ARENA_EDGE : distance / 2) * facing;
  a.facing = facing; b.facing = -facing;
  const send = (player, action = null, extra = {}) => room.input(player.id, { seq: player.lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
  const onceKeys = new Set(), seen = new Set(), snapshots = [], events = [];
  const once = (key, condition, run) => { if (condition && !onceKeys.has(key)) { onceKeys.add(key); run(); } };
  for (let frame = 0; frame < 240; frame++) {
    once('start', frame === 18, () => send(a, type === 'slam' ? 'jump' : 'heavy'));
    if (type === 'slam') once('slam', a.action === 'jump' && a.y > 1.0, () => send(a, 'heavy'));
    const ageSinceConfirm = HEAVY_RULES.cancelWindow - a.cancelWindow;
    if (!['whiff', 'slam'].includes(type)) {
      // The early route buffers just before contact: only the server's real
      // hit confirm and earliest legal cancel may consume it. The late route
      // waits near the end of the actual serialized cancel window.
      once('hook', a.variant === 'heavyDrive' && (late ? a.cancelWindow > 0 && ageSinceConfirm >= .23 : a.actionTime >= V5_ATTACKS.heavyDrive.startup - .05), () => send(a, 'heavy'));
      once('press', a.variant === 'heavyHook' && (late ? a.cancelWindow > 0 && ageSinceConfirm >= .23 : a.actionTime >= V5_ATTACKS.heavyHook.startup - .05), () => send(a, 'heavy'));
    }
    if (b.defenseOnly > 0) {
      if (['block', 'late'].includes(type)) send(b, null, { block: true });
      if (type === 'jab') send(b, 'light');
      once('jump', type === 'jump', () => send(b, 'jump'));
      once('retreat', type === 'retreat', () => send(b, 'dash', { move: facing }));
    }
    room.step(1 / 60); const state = room.snapshot();
    for (const event of state.events) if (!seen.has(event.id)) { seen.add(event.id); events.push({ ...event, frame }); }
    snapshots.push(state);
  }
  return { snapshots, events, contacts: events.filter(event => ['hit', 'block', 'parry'].includes(event.type)) };
}
