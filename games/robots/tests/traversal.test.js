import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { AIR_MOVE_SPEED, ARENA_EDGE, ATTACKS, FINISH_RULES, GRAVITY, JUMP_CLEARANCE, JUMP_SPEED, MAX_HP, PLAYER_RADIUS, V5_RULES, WINS_TO_MATCH } from '../shared/constants.js';
import { buildTraversalCase } from '../scripts/traversal-review.js';

const input = (room, p, action = null, move = 0) => room.input(p.id, { seq: p.lastSeq + 1, action, move, block: false, crouch: false });
function fight() {
  const room = new CombatRoom({ random: () => .8 });
  const a = room.addPlayer('Перелёт'), b = room.addPlayer('Опора');
  room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  return { room, a, b };
}
const legacyApex = dt => {
  let y = 0, vy = 8.1, apex = 0;
  for (let i = 0; i < 300; i++) { vy -= GRAVITY * dt; y += vy * dt; apex = Math.max(apex, y); if (y <= 0) break; }
  return apex;
};

for (const facing of [-1, 1]) for (const hz of [30, 60, 120]) {
  test(`voluntary jump clears opponent without pushing or crossing its head, facing ${facing}, ${hz} Hz`, t => {
    const { room, a, b } = fight(); const dt = 1 / hz;
    a.x = -2.1 * facing; b.x = 0;
    input(room, a, 'jump', facing);
    let apex = 0, maxStep = 0, crossingHeight = 0, crossed = false, previous = a.x;
    for (let i = 0; i < hz * 2; i++) {
      if (i) input(room, a, null, i < hz * 1.27 ? facing : 0);
      room.step(dt);
      apex = Math.max(apex, a.y); maxStep = Math.max(maxStep, Math.abs(a.x - previous));
      if (!crossed && a.x * facing >= 0) { crossingHeight = a.y; crossed = true; }
      if (a.y < JUMP_CLEARANCE && !crossed) assert.ok((b.x - a.x) * facing >= PLAYER_RADIUS * 2 - 1e-8);
      assert.equal(b.x, 0, 'voluntary jump must not push a stationary opponent');
      assert.ok(a.y >= 0 && Math.abs(a.x) <= ARENA_EDGE);
      previous = a.x;
    }
    assert.ok(apex >= legacyApex(dt) * 2);
    assert.ok(crossed && crossingHeight > JUMP_CLEARANCE);
    assert.ok(a.x * facing >= PLAYER_RADIUS * 2);
    assert.ok(maxStep <= AIR_MOVE_SPEED * dt + 1e-8, `unexpected lateral assistance ${maxStep}`);
    assert.equal(a.y, 0); assert.equal(a.traversalJump, false); assert.equal(a.hp, MAX_HP);
    t.diagnostic(`apex ${apex.toFixed(3)} m; crossing ${crossingHeight.toFixed(3)} m; step ${maxStep.toFixed(3)} m`);
  });

  test(`released/held jump over an occupied landing spot separates gradually, facing ${facing}, ${hz} Hz`, () => {
    for (const wall of [false, true]) for (const held of [false, true]) {
      const { room, a, b } = fight(); const dt = 1 / hz;
      b.x = wall ? ARENA_EDGE * facing : 0;
      a.x = b.x; a.y = 4.45; a.vy = 0; a.traversalJump = true; a.traversalSide = -facing; a.action = 'jump';
      const targetX = b.x;
      let previous = a.x, side = 0, maxStep = 0;
      for (let i = 0; i < hz * 1.2; i++) {
        input(room, a, null, held && a.y > 0 ? facing : 0); room.step(dt);
        maxStep = Math.max(maxStep, Math.abs(a.x - previous)); previous = a.x;
        if (a.traversalLandingSide) { if (side) assert.equal(a.traversalLandingSide, side); side = a.traversalLandingSide; }
        assert.equal(b.x, targetX, 'landing cannot shove the defender out of the way');
        assert.ok(Math.abs(a.x) <= ARENA_EDGE && a.y >= 0);
      }
      assert.equal(a.y, 0);
      assert.ok(Math.abs(a.x - b.x) >= PLAYER_RADIUS * 2 - 1e-8);
      assert.ok(maxStep <= 8 * dt + 1e-8, `landing teleported ${maxStep} m in ${dt}s`);
      if (wall) assert.ok((a.x - b.x) * facing < 0, 'occupied boundary always chooses the inside landing');
    }
  });
}

test('compact spawn, pursuit height, one jump per flight and packet timeout keep existing combat rules', () => {
  const { room, a, b } = fight();
  assert.equal(a.x, -2.7); assert.equal(b.x, 2.7);
  input(room, a, 'jump', -1); room.step(1 / 60);
  assert.ok(Math.abs(a.vy - (JUMP_SPEED - GRAVITY / 60)) < 1e-9);
  const firstVy = a.vy;
  for (let frame = 0; frame < 90; frame++) {
    if (frame < 30) input(room, a, 'jump', -1);
    room.step(1 / 60);
    if (frame < 30) assert.ok(a.vy < firstVy, 'repeated jump commands cannot reset gravity');
  }
  assert.equal(a.y, 0);
  const stopped = a.x;
  for (let i = 0; i < 30; i++) room.step(1 / 60);
  assert.equal(a.x, stopped, 'missing movement packets do not keep travelling');
  const chase = fight();
  chase.a.jumpCancelWindow = .25; chase.a.action = 'heavy'; chase.a.variant = 'launcher';
  input(chase.room, chase.a, 'jump'); chase.room.step(1 / 60);
  assert.ok(Math.abs(chase.a.vy - (V5_RULES.pursuitJumpSpeed - GRAVITY / 60)) < 1e-9);
  assert.equal(chase.a.traversalJump, false, 'confirmed launcher keeps its distinct low pursuit arc');
});

test('real edge projectiles survive beyond the former wall and hit once in both directions', () => {
  for (const facing of [-1, 1]) {
    const data = buildTraversalCase('bolt', facing);
    const hits = data.events.filter(e => e.type === 'hit' && e.variant === 'bolt');
    assert.equal(hits.length, 1);
    assert.equal(data.snapshots.at(-1).players[1].hp, MAX_HP - ATTACKS.special.damage);
    assert.ok(data.snapshots.some(s => s.projectiles.some(p => Math.abs(p.x) > 7)), 'the bolt actually traversed the newly opened floor');
    assert.ok(data.snapshots.every(s => s.players.every(p => Math.abs(p.x) <= ARENA_EDGE)));
    assert.equal(data.snapshots.at(-1).projectiles.length, 0);
  }
});

test('all replay trajectories stay bounded; airborne wall traversal never switches to the outside', () => {
  for (const facing of [-1, 1]) {
    const data = buildTraversalCase('edge', facing);
    let previous = data.snapshots[0].players[0].x;
    for (const state of data.snapshots) {
      const [a,b] = state.players;
      assert.ok(Math.abs(a.x - previous) <= 8 / 60 + .001); previous = a.x;
      assert.equal(b.x, ARENA_EDGE * facing);
      assert.ok(state.players.every(p => Math.abs(p.x) <= ARENA_EDGE && p.y >= 0));
    }
    assert.ok((data.snapshots.at(-1).players[1].x - data.snapshots.at(-1).players[0].x) * facing >= PLAYER_RADIUS * 2 - .001);
  }
});

test('finishing from either new edge or opposite edges stages real roots inside the floor', () => {
  for (const facing of [-1,1]) for (const spread of ['near','far']) {
    const { room, a, b } = fight();
    b.x=ARENA_EDGE*facing; a.x=(spread==='far'?-ARENA_EDGE:ARENA_EDGE-2.1)*facing;
    a.wins=WINS_TO_MATCH-1; b.hp=0; room.step(1/60);
    assert.equal(room.phase,'finishing');
    assert.equal(room.startFinisher('coreRip'),true);
    for(let i=0;i<240;i++) {
      room.step(1/60);
      for(const p of room.players) assert.ok(Math.abs(p.x)<=ARENA_EDGE && p.y>=0,'finisher may not leave the expanded arena');
    }
    assert.equal(room.phase,'matchOver');
    assert.ok(Math.abs(Math.abs(a.x-b.x)-FINISH_RULES.distance)<1e-8);
    assert.equal(b.action,'destroyed');
  }
});
