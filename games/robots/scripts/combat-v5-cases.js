import { WINS_TO_MATCH } from '../shared/constants.js';
import { CombatRoom } from '../server/combat.js';
import { V3_RULES, V5_RULES, V5_ATTACKS } from '../shared/constants.js';

export const V5_CASES = {
  combo: 'Джеб / кросс / рассечение', crusher: 'Дробитель', air: 'Воздушная серия',
  pummel: 'Захват / удары / бросок', backthrow: 'Бросок за спину', tech: 'Выход из захвата',
  recover: 'Поломка / подъём', finish: 'Сорванное ядро', overload: 'Расплавление', brutality: 'Бруталити',
};

// These sequences submit actual inputs to the production authoritative engine.
// Only initial positions, health and score are staged to reach useful cases quickly.
export function buildV5Case(type, facing = 1) {
  const room = new CombatRoom({ id: `V5_${type}`, random: () => .5 });
  room.addPlayer('ИСКРА'); room.addPlayer('ИНЕЙ'); room.ready('p1'); room.ready('p2');
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  const a = room.player('p1'), b = room.player('p2');
  a.x = -1.05 * facing; b.x = 1.05 * facing; a.facing = facing; b.facing = -facing;
  if (['finish', 'overload', 'brutality'].includes(type)) a.wins = WINS_TO_MATCH - 1;
  if (['finish', 'overload', 'recover'].includes(type)) b.hp = 5;
  if (type === 'brutality') b.hp = 20;
  const snapshots = [], events = [], seen = new Set(), fired = new Set();
  const send = (who, action, held = {}) => room.input(who.id, {
    seq: who.lastSeq + 1, move: 0, crouch: false, block: false, action, ...held,
  });
  const once = (key, condition, run) => { if (condition && !fired.has(key)) { fired.add(key); run(); } };
  const duration = ['finish', 'overload', 'brutality', 'recover'].includes(type) ? 10 : type === 'air' ? 4 : 3.6;
  for (let frame = 0; frame <= duration * 60; frame++) {
    const grapple = ['pummel', 'backthrow', 'tech'].includes(type);
    once('start', frame === 0, () => send(a, grapple ? 'heavy' : 'light', { crouch: grapple }));
    if (grapple) {
      if (type === 'tech') once('tech', Boolean(b.grabbedBy) && b.grabHoldTime >= .13, () => send(b, 'light'));
      else {
        once('strike1', Boolean(a.grabTarget) && a.grabHoldTime >= V3_RULES.grabTech + .03, () => send(a, 'light'));
        once('strike2', Boolean(a.grabTarget) && a.grabStrikes === 1 && a.grabStrikeTime == null && a.grabHoldTime > .61, () => send(a, 'light'));
        once('throw', Boolean(a.grabTarget) && a.grabStrikes === V5_RULES.grabStrikeLimit && a.grabStrikeTime == null,
          () => send(a, 'heavy', { move: type === 'backthrow' ? -a.facing : 0 }));
      }
    }
    if (['combo', 'crusher', 'brutality'].includes(type)) {
      once('cross', a.variant === 'jab' && a.cancelWindow > 0 && a.actionTime >= V5_ATTACKS.jab.startup + .06, () => send(a, 'light'));
      once('ender', a.variant === 'cross' && a.cancelWindow > 0 && a.actionTime >= V5_ATTACKS.cross.startup + .06,
        () => send(a, type === 'crusher' ? 'heavy' : 'light'));
    }
    if (type === 'air') {
      once('launch', a.variant === 'jab' && a.cancelWindow > 0 && a.actionTime >= .18, () => send(a, 'heavy'));
      once('pursuit', a.variant === 'launcher' && a.jumpCancelWindow > 0 && a.actionTime >= .30, () => send(a, 'jump'));
      once('air1', a.y > .45 && b.y > .5 && a.action === 'jump', () => send(a, 'light'));
      once('air2', a.variant === 'airJab' && a.cancelWindow > 0 && a.actionTime >= .15, () => send(a, 'light'));
      once('air3', a.variant === 'airCross' && a.cancelWindow > 0 && a.actionTime >= .18, () => send(a, 'light'));
    }
    if (type === 'finish') once('manual-finish', room.finish?.stage === 'offer' && room.finish.elapsed >= .65, () => send(a, 'heavy'));
    room.step(1 / 60);
    const snapshot = room.snapshot();
    for (const event of snapshot.events) if (!seen.has(event.id)) {
      seen.add(event.id); events.push({ ...event, frame });
    }
    snapshots.push(snapshot);
  }
  const contactFrames = new Set();
  const contacts = events.filter(event => {
    if (!['hit', 'grab', 'grabStrike', 'throw', 'grabBreak', 'destruction', 'finisherImpact'].includes(event.type) || contactFrames.has(event.frame)) return false;
    contactFrames.add(event.frame); return true;
  });
  if (type === 'backthrow') {
    const release = events.find(event => event.type === 'throw')?.frame ?? snapshots.length;
    const overhead = snapshots.findIndex((state, frame) => frame > release &&
      (state.players[1].x - state.players[0].x) * facing <= 0 && state.players[1].y > 1);
    if (overhead >= 0) contacts.push({ frame: overhead, type: 'overhead', variant: 'back' });
    const landing = events.find(event => event.type === 'land' && event.frame > release);
    if (landing) contacts.push(landing);
  }
  const recovery = snapshots.findIndex(state => state.players.some(p => p.action === 'recover' && p.actionTime > .65));
  if (recovery >= 0) contacts.push({ frame: recovery, type: 'recover', variant: '' });
  contacts.sort((a, b) => a.frame - b.frame);
  return { snapshots, events, contacts };
}
