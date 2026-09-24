import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCombatEffects } from '../src/effects.js';
import { CombatRoom } from '../server/combat.js';
import { canAttemptBurst } from '../shared/constants.js';

function setup(t) {
  const originalDocument = globalThis.document;
  // Only the radial glow texture needs a canvas; geometry and simulation are real Three.js.
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  };
  const scene = new THREE.Scene();
  const effects = createCombatEffects(scene);
  t.after(() => {
    effects.dispose();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const state = {
    players: [
      { id: 'p1', skin: 'amber', x: -2, y: 0, facing: 1, action: 'idle', actionTime: 0 },
      { id: 'p2', skin: 'cyan', x: 2, y: 0, facing: -1, action: 'idle', actionTime: 0 },
    ],
    projectiles: [],
  };
  return { scene, effects, state, baseObjects: scene.children.length };
}

function assertFiniteGeometry(scene) {
  scene.traverse(object => {
    assert.ok([...object.position, ...object.scale, ...object.quaternion].every(Number.isFinite), `${object.name}: finite transform`);
    if (!object.geometry) return;
    const geometry = object.geometry;
    const positions = geometry.attributes.position.array;
    for (let index = 0; index < positions.length; index++) {
      assert.ok(Number.isFinite(positions[index]), `${geometry.name}: position ${index} is finite`);
    }
    geometry.computeBoundingSphere();
    assert.ok(Number.isFinite(geometry.boundingSphere.radius), `${geometry.name}: finite bounds`);
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!attribute.isInstancedBufferAttribute) continue;
      assert.ok(attribute.array.every(Number.isFinite), `${geometry.name}: ${name} GPU instance buffer is finite`);
    }
  });
}

test('an earlier initial RAF timestamp never activates uninitialized particle slots', t => {
  const { scene, effects, state } = setup(t);
  // performance.now() during setup may be later than the next RAF presentation timestamp.
  for (const dt of [-0.015, 0, NaN, 1 / 60, 1 / 60]) {
    effects.update(dt, 0, state);
    assertFiniteGeometry(scene);
    const pool = scene.children.find(object => object.geometry?.name === 'combat-particles');
    assert.ok(pool.geometry.attributes.aAlpha.array.every(alpha => alpha === 0));
  }
});

test('combat bursts, shields, projectiles and authoritative ultimate beams keep finite geometry', t => {
  const { scene, effects, state } = setup(t);
  const observed = new Set();
  const types = ['attack', 'dash', 'special', 'ultimate', 'ultimatePulse', 'hit', 'block', 'parry', 'launch', 'slam', 'grab', 'throw', 'grabBreak', 'burst', 'feint', 'land', 'ko'];
  let time = 0;
  for (const type of types) {
    effects.emit({ type, player: 'p1', target: 'p2', x: 2, y: 1.1, damage: 17, action: 'heavy', pulse: 2, counter: type === 'hit' }, state);
    state.players[0].action = type === 'ultimate' || type === 'block' ? type : 'idle';
    for (let step = 0; step < 65; step++) {
      time += 1 / 60;
      state.players[0].actionTime = step / 60;
      state.projectiles = type === 'special'
        ? [{ id: 1, x: -1 + step / 20, y: 1.35, direction: 1, owner: 'p1' }]
        : [];
      effects.update(1 / 60, time, state);
      assertFiniteGeometry(scene);
      scene.traverse(object => { if (object.geometry?.name) observed.add(object.geometry.name); });
    }
  }
  assert.ok(observed.has('pressure-front'));
  assert.ok(observed.has('combat-arc'));
  assert.ok(observed.has('energy-bolt-pool'));
  assert.ok(observed.has('ultimate-beam'));
  effects.clear();
  state.players[0].action = 'idle';
  effects.update(1 / 60, time, state);
  assertFiniteGeometry(scene);
  effects.dispose();
  assert.equal(scene.children.length, 0, 'all effect objects are removed');
});

test('an ultimate snapshot cannot invent a shot and each authoritative pulse renders once', t => {
  const { scene, effects, state } = setup(t);
  state.players[0].action = 'ultimate';
  state.players[0].variant = 'overload';
  const shots = () => scene.children.filter(object => object.visible && object.name.startsWith('ultimate-pulse-'));
  for (const actionTime of [0, 0.95, 1.23, 1.55, 2.28, 2.6]) {
    state.players[0].actionTime = actionTime;
    effects.update(1 / 60, actionTime, state);
    assert.equal(shots().length, 0, 'elapsed animation time only renders a telegraph');
  }
  const observed = [];
  for (let pulse = 0; pulse < 3; pulse++) {
    state.players[0].actionTime = [.95, 1.23, 1.55][pulse];
    const event = { id: 101 + pulse, type: 'ultimatePulse', player: 'p1', x: -2, y: 1.35, facing: 1, range: 5.2, pulse };
    effects.emit(event, state);
    effects.emit(event, state);
    assert.equal(shots().length, 1, 'repeated server event cannot produce a duplicate beam');
    observed.push(shots()[0].name);
    for (let frame = 0; frame < 30; frame++) effects.update(1 / 60, 3 + frame / 60, state);
    assert.equal(shots().length, 0, 'pulse finishes even while the snapshot still says ultimate');
    assertFiniteGeometry(scene);
  }
  assert.deepEqual(observed, ['ultimate-pulse-0', 'ultimate-pulse-1', 'ultimate-pulse-2']);
});

test('EMP mines expand at the placement point below bolts and return their field to its pool', t => {
  const { scene, effects, state } = setup(t);
  state.phase = 'fight';
  state.projectiles = [
    { id: 1, x: -1, y: 0.06, direction: 1, owner: 'p1', variant: 'shockwave', speed: 0, age: .15, radius: 3.65 },
    { id: 2, x: 1, y: 1.35, direction: -1, owner: 'p2', variant: 'bolt', speed: 11.5 },
  ];
  effects.update(1 / 60, 1, state);
  const wave = scene.getObjectByName('emp-mine-field');
  const bolt = scene.getObjectByName('energy-bolts');
  assert.ok(wave?.visible && bolt?.visible);
  assert.ok(wave.position.y < 0.1);
  assert.ok(Math.abs(bolt.geometry.attributes.aAnchor.getY(0) - 1.35) < .00001);
  scene.updateMatrixWorld(true);
  assert.ok(new THREE.Box3().setFromObject(wave).max.y < 0.9, 'the initial expanding corona stays close to the floor');
  const corona = wave.children.find(child => child.geometry.type === 'SphereGeometry');
  const startRadius = corona.scale.x;
  const startX = wave.position.x;
  const boltX = bolt.geometry.attributes.aAnchor.getX(0);
  effects.update(1 / 60, 1 + 1 / 60, state);
  assert.equal(wave.position.x, startX, 'the mine never travels between server snapshots');
  assert.ok(corona.scale.x > startRadius, 'its expanding front continues between snapshots');
  assert.ok(bolt.geometry.attributes.aAnchor.getX(0) < boltX, 'the ordinary bolt still travels toward its target');
  assertFiniteGeometry(scene);
  state.projectiles = [];
  effects.update(1 / 60, 1.04, state);
  assert.equal(wave.visible, false);
  assert.equal(effects.getEffectsStats().abilities.mines, 0);
  assert.equal(scene.getObjectByName('emp-mine-field'), wave, 'the fixed pool retains and reuses its field');
});

test('bolt shell and trail ignore growing arena wall time during paused or zero-delta effects updates', t => {
  const { scene, effects, state } = setup(t);
  state.phase = 'fight';
  state.projectiles = [{ id: 7, x: 0, y: 1.35, direction: 1, owner: 'p1', variant: 'bolt', speed: 10.5 }];
  effects.update(.016, 1, state); effects.update(.016, 1.016, state);
  const bolt = scene.getObjectByName('energy-bolts');
  const read = () => ['aAnchor', 'aColor', 'aPhase'].map(key => Array.from(bolt.geometry.attributes[key].array));
  const before = read();
  for (let frame = 0; frame < 180; frame++) effects.update(0, frame + 100, state);
  assert.deepEqual(read(), before);
  state.phase = 'paused';
  for (let frame = 0; frame < 180; frame++) effects.update(.016, frame + 1000, state);
  assert.deepEqual(read(), before);
  state.visualSeekToken = 'new-frame'; state.projectiles[0].x = 3;
  effects.update(0, 2000, state);
  assert.equal(bolt.geometry.attributes.aAnchor.getX(0), 3);
  state.projectiles = []; effects.update(0, 2001, state);
  assert.equal(bolt.visible, false);
});

test('mobile attack trails follow moving claws and slam keeps a bounded pressure front and dust', t => {
  const { scene, effects, state } = setup(t);
  effects.setQuality('low');
  effects.setReducedMotion(true);
  state.phase = 'fight';
  const player = state.players[0];
  Object.assign(player, { action: 'heavy', variant: 'launcher', actionTime: .24,
    combatAnchors: { leftClaw: new THREE.Vector3(0, 1, .5), leftClawBase: new THREE.Vector3(-.2, .8, .5) } });
  effects.emit({ type: 'attack', player: 'p1', action: 'heavy', variant: 'launcher', startup: .24, active: .14 }, state);
  effects.update(1 / 60, .24, state);
  player.actionTime += 1 / 60; player.combatAnchors.leftClaw.y += .2;
  effects.update(1 / 60, .26, state);
  assert.ok(effects.getEffectsStats().trailVertices > 0, 'physical claw sweep remains readable in low/reduced mode');
  assert.equal(scene.getObjectByName('launcher-rise'), undefined, 'no disconnected decorative attack circle');
  effects.emit({ type: 'slam', player: 'p1', x: 0, y: 0.06, variant: 'slam', range: 3.15 }, state);
  effects.emit({ type: 'parry', player: 'p2', target: 'p1', x: 1, y: 1.1 }, state);
  effects.update(1 / 60, 0.12, state);
  assert.equal(effects.getEffectsStats().waveActive, 1);
  assert.ok(effects.getEffectsStats().plumeActive > 0);
  const debris = scene.children.find(object => object.isInstancedMesh);
  assert.equal(debris.count, 0, 'dust and floor pressure do not invent robot metal fragments');
  for (let frame = 0; frame < 75; frame++) {
    effects.update(1 / 60, 0.12 + frame / 60, state);
    assertFiniteGeometry(scene);
  }
  assert.equal(debris.count, 0, 'all physical fragments expire');
});

test('grab anticipation adds no detached slash and only paired authoritative state establishes contact', t => {
  const { scene, effects, state } = setup(t);
  effects.emit({ type: 'attack', player: 'p1', action: 'heavy', variant: 'grab', x: -2, y: 1.1, facing: 1, startup: 0.26 }, state);
  effects.update(1 / 60, 0, state);
  assert.equal(effects.getEffectsStats().trailVertices, 0, 'the rig owns the anticipatory grip gesture');
  assert.equal(scene.getObjectByName('grab-catch'), undefined);
  assert.equal(scene.getObjectByName('paired-grab'), undefined);
  state.players[0].action = 'heavy';
  state.players[0].variant = 'grab';
  state.players[0].actionTime = 0.8;
  for (let frame = 0; frame < 20; frame++) effects.update(1 / 60, frame / 60, state);
  assert.equal(scene.getObjectByName('grab-telegraph'), undefined);
  assert.equal(scene.getObjectByName('paired-grab'), undefined, 'an elapsed grab animation cannot invent a catch');

  for (const facing of [-1, 1]) {
    Object.assign(state.players[0], { x: -facing, facing, grabTarget: 'p2', grabHoldTime: 0.1 });
    Object.assign(state.players[1], { x: facing, action: 'hit', variant: 'grabbed', grabbedBy: 'p1', grabTechWindow: 0.14, grabHoldTime: 0.1 });
    effects.emit({ type: 'grab', player: 'p1', target: 'p2', x: facing, y: 1.1, facing, duration: 0.3 }, state);
    effects.update(1 / 60, 1, state);
    const paired = scene.getObjectByName('paired-grab');
    assert.ok(paired);
    const contactLine = paired.children.find(object => object.isLineSegments);
    const position = contactLine.geometry.attributes.position;
    assert.ok(Math.abs(position.getX(0) - (-facing + facing * 0.65)) < 0.0001);
    assert.ok(Math.abs(position.getX(1) - (facing - facing * 0.3)) < 0.0001);
    assertFiniteGeometry(scene);
    state.players[0].grabTarget = null;
    state.players[1].grabbedBy = null;
    effects.update(1 / 60, 1.02, state);
    assert.equal(scene.getObjectByName('paired-grab'), undefined, 'release clears both contact rails immediately');
  }
  state.players[0].grabTarget = 'missing-player';
  effects.update(1 / 60, 1.1, state);
  assert.equal(scene.getObjectByName('paired-grab'), undefined, 'a disconnected or removed partner leaves no phantom tether');
});

test('throw release renders once alongside its normal damage hit and tech recoils both ways', t => {
  const { scene, effects, state } = setup(t);
  const pool = scene.children.find(object => object.geometry?.name === 'combat-particles');
  const particleCount = () => pool.geometry.attributes.aAlpha.array.filter(alpha => alpha > 0).length;
  effects.emit({ type: 'throw', player: 'p1', target: 'p2', x: 1, y: 1.1, facing: 1, damage: 15 }, state);
  effects.update(0, 0, state);
  assert.ok(particleCount() > 0);
  const before = particleCount();
  const objectsBefore = scene.children.length;
  effects.emit({ type: 'hit', player: 'p1', target: 'p2', x: 1, y: 1.1, variant: 'grab', damage: 15 }, state);
  effects.update(0, 0, state);
  assert.equal(particleCount(), before, 'the UI damage event cannot duplicate the throw burst');
  assert.equal(scene.children.length, objectsBefore);
  effects.clear();
  effects.emit({ type: 'grabBreak', player: 'p2', target: 'p1', x: 0, y: 1.1, reason: 'tech' }, state);
  effects.update(0.05, 0.05, state);
  const heads = pool.geometry.attributes.aHead, alpha = pool.geometry.attributes.aAlpha;
  const x = Array.from({ length: heads.count }, (_, i) => alpha.getX(i) > 0 ? heads.getX(i) : null).filter(value => value != null);
  assert.ok(x.some(value => value < 0) && x.some(value => value > 0), 'tech vents separate in both recoil directions');
  assertFiniteGeometry(scene);
});

test('airborne defensive burst has no beam, floor explosion or debris and immunity expires', t => {
  const { scene, effects, state } = setup(t);
  effects.setQuality('low');
  effects.setReducedMotion(true);
  Object.assign(state.players[0], { action: 'special', variant: 'burst', x: 0, y: 1.4, burstInvulnerable: 0.22 });
  const shake = effects.emit({ type: 'burst', player: 'p1', target: 'p2', x: 0, y: 2.5, radius: 3.4 }, state);
  assert.equal(shake, 0, 'a defensive discharge does not imitate an offensive impact shake');
  effects.update(1 / 60, 0.02, state);
  const plumes = scene.getObjectByName('rupture-and-contact-smoke').geometry.attributes.aCenter;
  assert.ok(plumes.getY(0) >= 2.5);
  assert.equal(effects.getEffectsStats().waveActive, 0);
  assert.ok(scene.getObjectByName('burst-immunity'));
  assert.ok(!scene.children.some(object => object.name.startsWith('ultimate-pulse-')));
  assert.equal(scene.children.find(object => object.isInstancedMesh).count, 0, 'no destructive debris');
  state.players[0].burstInvulnerable = 0;
  effects.update(1 / 60, 0.25, state);
  assert.equal(scene.getObjectByName('burst-immunity'), undefined);
  for (let frame = 0; frame < 40; frame++) effects.update(1 / 60, 0.25 + frame / 60, state);
  assert.equal(effects.getEffectsStats().plumeActive, 0, 'a stale burst snapshot cannot emit another discharge');
  state.players[0].y = 0;
  effects.emit({ type: 'burst', player: 'p1', x: 0, y: 2.5, radius: 3.4 }, state);
  effects.update(1 / 60, 1, state);
  assert.equal(effects.getEffectsStats().waveActive, 0, 'a delayed aerial event uses its real origin even if the latest snapshot has landed');
  assertFiniteGeometry(scene);
});

test('real grab, tech, burst and feint sequences leave no obsolete shields or paired effects', t => {
  const { scene, effects, baseObjects } = setup(t);
  const scenarios = {
    grab: { expected: 'throw', actions: [[0, 'p2', null, { block: true }], [0, 'p1', 'heavy', { crouch: true }]] },
    tech: { expected: 'grabBreak', actions: [[0, 'p1', 'heavy', { crouch: true }], [21, 'p2', 'light']] },
    burst: { expected: 'burst', reactiveBurst: true, actions: [[0, 'p1', 'heavy']] },
    airburst: { expected: 'burst', actions: [[0, 'p1', 'light'], [12, 'p1', 'heavy'], [32, 'p2', 'dash']] },
    feint: { expected: 'feint', actions: [[0, 'p1', 'heavy'], [9, 'p1', 'dash'], [8, 'p2', 'heavy']] },
  };
  for (const [name, scenario] of Object.entries(scenarios)) {
    effects.clear();
    const room = new CombatRoom({ id: `FX_${name}`, random: () => 0.25 });
    room.addPlayer('one'); room.addPlayer('two'); room.ready('p1'); room.ready('p2');
    for (let frame = 0; frame < 180; frame++) room.step(1 / 60);
    const one = room.player('p1'), two = room.player('p2');
    one.x = -1.07; two.x = 1.07;
    if (name.includes('burst')) two.energy = 85;
    if (name === 'feint') { one.x = -1.6; two.x = 1.6; }
    const seen = new Set(), observed = [];
    let burstRequested = false;
    for (let frame = 0; frame < 169; frame++) {
      for (const [at, id, action, held = {}] of scenario.actions) {
        if (at === frame) room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, crouch: false, block: false, action, ...held });
      }
      if (scenario.reactiveBurst && !burstRequested && canAttemptBurst(two)) {
        assert.equal(two.variant, 'heavyStagger', 'burst begins during the real heavy microstun');
        assert.ok(observed.some(event => event.type === 'hit' && event.variant === 'heavyDrive' && event.target === two.id));
        room.input(two.id, { seq: two.lastSeq + 1, move: 0, crouch: false, block: false, action: 'dash' });
        burstRequested = true;
      }
      room.step(1 / 60);
      const state = room.snapshot();
      for (const event of state.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id); observed.push(event); effects.emit(event, state);
      }
      effects.update(1 / 60, frame / 60, state);
      const paired = state.players.some(player => player.grabTarget && state.players.some(other => other.id === player.grabTarget && other.grabbedBy === player.id));
      assert.equal(Boolean(scene.getObjectByName('paired-grab')), paired, `${name}: paired effect follows the actual paired state`);
      if (!state.players.some(player => player.action === 'block')) assert.equal(scene.getObjectByName('block-shield'), undefined);
      if (!state.players.some(player => player.variant === 'burst' && player.burstInvulnerable > 0)) assert.equal(scene.getObjectByName('burst-immunity'), undefined);
      if (name === 'grab' || name === 'tech') assert.equal(scene.getObjectByName('attack-swing'), undefined, `${name}: no generic heavy slash`);
      assertFiniteGeometry(scene);
    }
    assert.ok(observed.some(event => event.type === scenario.expected), `${name}: the real mechanic occurred`);
    if (scenario.reactiveBurst) {
      assert.ok(burstRequested);
      assert.equal(observed.filter(event => event.type === 'burst').length, 1, 'one confirmed heavy produces one requested escape');
    }
    if (name === 'airburst') assert.ok(observed.find(event => event.type === 'burst').y > 1.3);
    assert.equal(scene.children.length, baseObjects, `${name}: only reusable combat/damage pools remain after recovery`);
  }
});

test('feint retreats without an offensive trail and punish stays distinct from parry counter', t => {
  const { scene, effects, state } = setup(t);
  effects.setReducedMotion(true);
  effects.emit({ type: 'attack', player: 'p1', action: 'heavy', variant: '', x: 0, y: 1.1, facing: 1, startup: 0.36 }, state);
  effects.emit({ type: 'feint', player: 'p1', x: 0, y: 1.1, facing: 1, duration: 0.3 }, state);
  effects.update(0, 0, state);
  const retreat = scene.getObjectByName('mechanical-spark-streaks').geometry.attributes.aHead;
  const initialX = retreat.getX(0);
  effects.update(0.05, 0.05, state);
  assert.ok(retreat.getX(0) < initialX);
  assert.equal(scene.getObjectByName('dash-strike-trail'), undefined);
  effects.emit({ type: 'hit', player: 'p1', target: 'p2', x: 1, y: 1.1, damage: 10, punish: true, counter: false }, state);
  effects.update(1 / 60, 0.1, state);
  assert.equal(effects.getEffectsStats().punishHits, 1);
  assert.equal(effects.getEffectsStats().counterHits, 0);
  for (let frame = 0; frame < 26; frame++) effects.update(1 / 60, 0.1 + frame / 60, state);
  assert.equal(scene.getObjectByName('attack-swing'), undefined, 'the cancelled heavy cannot leave a delayed offensive slash');
  assertFiniteGeometry(scene);
});

function damageState(state) {
  Object.assign(state, { room: 'DAMAGE_TEST', round: 1, phase: 'fight' });
  for (const player of state.players) {
    player.hp = 100;
    // Deliberately distant from player.x/y: no hardcoded torso emitter can pass.
    player.damageAnchors = {
      core: new THREE.Vector3(7, 2.1, 0.3), head: new THREE.Vector3(7.2, 3.2, 0.1),
      left: new THREE.Vector3(6.1, 1.8, 0.7), right: new THREE.Vector3(7.8, 1.7, -0.6),
    };
  }
  return state.players[0];
}

function advance(effects, state, seconds, dt = 1 / 60) {
  for (let frame = 0; frame < Math.ceil(seconds / dt); frame++) effects.update(dt, frame * dt, state);
}

test('health crossings vent once, heals and new rounds rearm, and missing anchors emit nothing', t => {
  const { scene, effects, state } = setup(t);
  const player = damageState(state);
  effects.update(0, 0, state);
  player.hp = 55; effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().thresholdVents, 1);
  for (let i = 0; i < 30; i++) effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().thresholdVents, 1, 'snapshots cannot replay a crossing');
  player.hp = 18; effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().thresholdVents, 2);
  player.hp = 100; effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().smokeActive + effects.getDamageStats().electricalActive + effects.getDamageStats().sparkActive, 0, 'healing clears old damage effects');
  player.hp = 55; effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().thresholdVents, 3);
  state.round++; player.hp = 100; effects.update(0, 0, state);
  player.hp = 55; effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().thresholdVents, 4, 'new round can discharge again');
  delete player.damageAnchors; player.hp = 18;
  const before = effects.getDamageStats();
  advance(effects, state, 5);
  assert.equal(effects.getDamageStats().sparksEmitted, before.sparksEmitted, 'no fake attachment fallback');
  assert.equal(effects.getDamageStats().smokeActive, 0);
  assertFiniteGeometry(scene);
});

test('pause, countdown and waiting stop new damage while old wisps fade', t => {
  const { scene, effects, state } = setup(t);
  const player = damageState(state);
  effects.update(0, 0, state); player.hp = 18; effects.update(0, 0, state);
  const emitted = effects.getDamageStats().sparksEmitted;
  for (const phase of ['paused', 'countdown', 'waiting']) {
    state.phase = phase;
    effects.emit({ id: phase, type: 'hit', target: player.id, damage: 16 }, state);
    advance(effects, state, 3);
    const stats = effects.getDamageStats();
    assert.equal(stats.sparksEmitted, emitted, `${phase}: no new impact/ambient faults`);
    assert.equal(stats.smokeActive + stats.electricalActive + stats.sparkActive, 0, `${phase}: old damage fades`);
  }
  state.phase = 'fight'; advance(effects, state, 2);
  assert.ok(effects.getDamageStats().ambientFaults > 0, 'living damaged robot resumes intermittent faults');
  assertFiniteGeometry(scene);
});

test('stale queued hit and KO events cannot cross a round or room reset', t => {
  const { effects, state } = setup(t);
  const player = damageState(state);
  effects.update(0, 0, state);
  for (const field of ['round', 'room']) {
    effects.emit({ id: 'stale-hit', type: 'hit', target: player.id, damage: 17 }, state);
    effects.emit({ id: 'stale-ko', type: 'ko', target: player.id }, state);
    state[field] = field === 'round' ? state.round + 1 : 'NEW_ROOM';
    effects.update(0, 0, state);
    assert.equal(effects.getDamageStats().impactFaults, 0);
    assert.equal(effects.getDamageStats().koDischarges, 0);
    assert.equal(effects.getDamageStats().sparkActive, 0);
    assert.equal(effects.getDamageStats().contactLightsActive, 0, 'a stale burst cannot illuminate the new room');
  }
  const hit = { id: 'fresh-hit', type: 'hit', target: player.id, damage: 7 };
  effects.emit(hit, state); effects.emit(hit, state); effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().impactFaults, 1, 'valid new-round events still emit once');
  assert.equal(effects.getDamageStats().contactLightsActive, 1);
  advance(effects, state, .25);
  effects.emit(hit, state); effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().contactLightsActive, 0, 'repeated authoritative ID cannot restart the contact flash');
  effects.emit({ id: 'pending-before-hide', type: 'hit', target: player.id }, state);
  effects.clear(); effects.update(0, 0, state);
  assert.equal(effects.getDamageStats().impactFaults, 0, 'visibility reset discards queued effects');
  assert.equal(effects.getDamageStats().contactLightsActive, 0);
});

test('paused charge and deferred swings remain static without replenishing particles', t => {
  const { scene, effects, state } = setup(t);
  damageState(state);
  state.players[0].action = 'ultimate';
  effects.emit({ type: 'attack', player: 'p2', action: 'heavy', startup: .36 }, state);
  effects.update(1 / 60, 2, state);
  const charge = scene.getObjectByName('overload-charge-ring');
  const rotation = charge.rotation.toArray(), scale = charge.scale.toArray();
  state.phase = 'paused';
  advance(effects, state, 3);
  assert.deepEqual(charge.rotation.toArray(), rotation);
  assert.deepEqual(charge.scale.toArray(), scale);
  assert.equal(scene.getObjectByName('attack-swing'), undefined, 'delayed attack does not execute during pause');
  const pool = scene.children.find(object => object.geometry?.name === 'combat-particles');
  assert.ok(pool.geometry.attributes.aAlpha.array.every(alpha => alpha === 0), 'charge does not replenish particles');
  assertFiniteGeometry(scene);
});

test('KO has one finite shutdown discharge sequence and becomes quiet, including late observations', t => {
  const { scene, effects, state } = setup(t);
  const player = damageState(state);
  effects.update(0, 0, state);
  player.hp = 0; player.action = 'ko'; state.phase = 'roundOver';
  const event = { id: 91, type: 'ko', target: player.id };
  effects.emit(event, state); effects.update(1 / 60, 0, state);
  effects.emit(event, state); effects.update(1 / 60, 0, state);
  assert.equal(effects.getDamageStats().koDischarges, 1, 'threshold plus event still means one discharge');
  for (let frame = 0; frame <= 90; frame++) {
    player.actionTime = frame / 60;
    effects.update(1 / 60, player.actionTime, state);
  }
  assert.ok(effects.getDamageStats().sparksEmitted >= 90, 'ordinary shutdown is an emphatic sequence at several mechanisms');
  assert.equal(effects.getDamageStats().arcsEmitted, 5, 'each planned mechanism discharges once');
  advance(effects, state, 3);
  const quiet = effects.getDamageStats();
  assert.equal(quiet.smokeActive + quiet.electricalActive + quiet.sparkActive, 0);
  advance(effects, state, 10);
  assert.deepEqual(effects.getDamageStats(), quiet, 'corpse does not run perpetual faults');
  effects.clear(); advance(effects, state, 3);
  assert.equal(effects.getDamageStats().sparksEmitted + effects.getDamageStats().smokeEmitted, 0, 'a corpse first observed after reconnect remains quiet');
  assert.equal(effects.getDamageStats().contactLightsActive, 0, 'reconnecting to an old KO never relights its discharged circuits');
  assertFiniteGeometry(scene);
});

test('shutdown sparks follow authoritative action time without pause or packet catch-up bursts', t => {
  const { effects, state } = setup(t);
  const player = damageState(state);
  effects.update(0, 0, state);
  Object.assign(player, { hp: 35, action: 'ko', actionTime: 0 }); state.phase = 'roundOver';
  effects.update(1 / 60, 0, state);
  player.actionTime = .11; effects.update(1 / 60, .11, state);
  const first = effects.getDamageStats().sparksEmitted;
  assert.ok(first > 0, 'timeout loss must discharge even though HP remains positive');
  state.phase = 'paused';
  advance(effects, state, 5);
  assert.equal(effects.getDamageStats().sparksEmitted, first, 'pause cannot start another scheduled discharge');
  state.phase = 'roundOver'; player.actionTime = .9; effects.update(1 / 60, .9, state);
  assert.equal(effects.getDamageStats().sparksEmitted, first, 'past mechanical beats are skipped instead of replayed together');
  player.actionTime = 1.13; effects.update(1 / 60, 1.13, state);
  assert.ok(effects.getDamageStats().sparksEmitted > first, 'future beat still works after a delayed snapshot');
  const count = effects.getDamageStats().sparksEmitted;
  for (let frame = 0; frame < 30; frame++) effects.update(1 / 60, 20 + frame, state);
  assert.equal(effects.getDamageStats().sparksEmitted, count, 'repeated snapshots cannot replenish a spent beat');
});

test('damage pools stay bounded through a long critical fight and low/reduced modes emit less', t => {
  const { scene, effects, state, baseObjects } = setup(t);
  damageState(state);
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  t.after(() => { Math.random = originalRandom; });
  const results = [];
  for (const mode of ['high', 'low', 'reduced']) {
    effects.clear(); effects.setQuality(mode); effects.setReducedMotion(mode === 'reduced');
    for (const player of state.players) player.hp = 18;
    for (let frame = 0; frame < 3600; frame++) {
      effects.update(1 / 30, frame / 30, state);
      const stats = effects.getDamageStats();
      assert.ok(stats.smokeActive <= 24 && stats.electricalActive <= 8 && stats.sparkActive <= 80);
      if (mode === 'reduced') assert.equal(stats.electricalActive, 0);
    }
    results.push(effects.getDamageStats());
    assert.equal(scene.children.find(object => object.geometry?.name === 'combat-particles').geometry.attributes.aHead.count, 680);
    assert.equal(scene.children.length, baseObjects, 'long runs do not allocate unbounded scene objects');
    assertFiniteGeometry(scene);
  }
  for (const result of results.slice(1)) {
    assert.ok(result.sparksEmitted < results[0].sparksEmitted);
    assert.ok(result.smokeEmitted < results[0].smokeEmitted);
    assert.ok(result.ambientFaults < results[0].ambientFaults);
  }
  assert.equal(results[2].arcsEmitted, 0);
});

test('damage emitters follow the real rig through facing, air motion and KO deformation', async t => {
  const { scene, effects, state } = setup(t);
  const fs = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const saved = new Map(['self', 'createImageBitmap', 'ProgressEvent'].map(key => [key, globalThis[key]]));
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
  const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  const originalLoad = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
  t.after(() => {
    GLTFLoader.prototype.loadAsync = originalLoad;
    for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  const { loadRobotAssets, createRobot } = await import('../src/robot.js');
  await loadRobotAssets(); GLTFLoader.prototype.loadAsync = originalLoad;
  const robot = createRobot(); t.after(() => robot.dispose());
  const player = damageState(state);
  robot.group.position.set(-1.7, 0, 0.1);
  robot.update(player, 1 / 60, 0);
  player.damageAnchors = robot.getDamageAnchors();
  effects.update(0, 0, state); player.hp = 55; effects.update(0, 0, state);
  const pool = scene.children.find(object => object.geometry?.name === 'combat-particles');
  const position = pool.geometry.attributes.aHead;
  const legKey = player.damageAnchors.left.z >= player.damageAnchors.right.z ? 'left' : 'right';
  const left = player.damageAnchors[legKey];
  assert.ok(new THREE.Vector3().fromBufferAttribute(position, 600).distanceTo(left) < 0.00001, 'new sparks start at the actual articulated knee');
  const smoke = scene.getObjectByName('damage-smoke').geometry.attributes.position;
  const electrical = scene.getObjectByName('damage-electrical').geometry.attributes.position;
  const oldAnchor = left.clone();
  for (const [facing, action, y, actionTime] of [[-1, 'jump', 1.1, .1], [-1, 'ko', .8, .2]]) {
    robot.group.position.set(0.9, y, 0.1);
    Object.assign(player, { facing, action, y, actionTime });
    robot.update(player, 1 / 60, actionTime);
    effects.update(.01, actionTime, { ...state, phase: 'paused' });
    assert.equal(player.damageAnchors, robot.getDamageAnchors(), 'anchors reuse the same live world-space object');
    assert.ok(left.distanceTo(oldAnchor) > .5, 'test moved and deformed the source robot');
    assert.ok(Math.abs(smoke.getX(0) - left.x) < .00001 && Math.abs(smoke.getZ(0) - left.z) < .00001, 'young smoke remains attached to the moving real bone');
    assert.ok(Math.abs(electrical.getX(0) - left.x) < .00001 && Math.abs(electrical.getY(0) - left.y) < .00001, 'short electrical leak follows the joint throughout its lifetime');
    assertFiniteGeometry(scene);
  }
});

test('streak sparks have finite visible length, directional ejection and one short floor ricochet', t => {
  const { scene, effects, state } = setup(t);
  state.phase = 'fight';
  effects.emit({ id: 101, type: 'hit', player: 'p1', target: 'p2', x: 0, y: .08, facing: 1, damage: 18 }, state);
  effects.update(1 / 60, 0, state);
  const pool = scene.getObjectByName('mechanical-spark-streaks');
  assert.ok(pool.isMesh && pool.geometry.isInstancedBufferGeometry, 'sparks are tapered geometry, not points');
  const { aHead: heads, aTail: tails, aAlpha: alpha } = pool.geometry.attributes;
  const head = new THREE.Vector3(), tail = new THREE.Vector3();
  let visible = 0;
  for (let i = 0; i < 600; i++) if (alpha.getX(i) > 0) {
    head.fromBufferAttribute(heads, i); tail.fromBufferAttribute(tails, i);
    assert.ok(head.distanceTo(tail) >= .05 && head.distanceTo(tail) <= .55, 'streak has a readable bounded ballistic tail');
    assert.ok(head.x > tail.x, 'hot leading edge follows the ejection direction'); visible++;
  }
  assert.ok(visible >= 12);
  advance(effects, state, 1.5);
  assert.ok(alpha.array.every(value => value === 0), 'all hot fragments cool and expire');
  assertFiniteGeometry(scene);
});

test('pummel and final rupture render once and snapshots cannot invent destruction', t => {
  const { scene, effects, state, baseObjects } = setup(t);
  damageState(state);
  state.phase = 'finishing';
  Object.assign(state.players[0], { action: 'finisher', variant: 'coreRip', actionTime: 1.25 });
  Object.assign(state.players[1], { action: 'defeated', variant: 'coreRip', hp: 0 });
  const events = [
    { id: 201, type: 'grabStrike', player: 'p1', target: 'p2', damage: 4 },
    { id: 202, type: 'finisherImpact', player: 'p1', target: 'p2', variant: 'coreRip' },
    { id: 203, type: 'destruction', player: 'p1', target: 'p2', variant: 'coreRip' },
  ];
  for (const event of events) for (let repeat = 0; repeat < 7; repeat++) effects.emit(event, state);
  effects.update(1 / 60, 1, state);
  let stats = effects.getEffectsStats();
  assert.equal(stats.grabStrikes, 1); assert.equal(stats.finisherImpacts, 1); assert.equal(stats.destructions, 1);
  assert.ok(stats.plumeActive >= 10 && stats.waveActive === 1);
  assert.equal(scene.children.find(object => object.isInstancedMesh).count, 0, 'actual robot owns model chunks; FX adds no replacement cubes');
  Object.assign(state.players[1], { action: 'destroyed', destructionTime: 2 });
  state.players[0].action = 'victory'; state.players[0].actionTime = 3;
  advance(effects, state, 4);
  stats = effects.getEffectsStats();
  assert.equal(stats.plumeActive + stats.waveActive + stats.trailVertices, 0, 'smoke clears to reveal the wreck');
  assert.equal(stats.destructions, 1);
  effects.clear();
  effects.emit(events[2], state); effects.emit(events[1], state);
  effects.update(0, 0, state);
  assert.equal(effects.getEffectsStats().destructions, 0, 'a reconnect with old destruction history keeps the wreck quiet');
  state.round++; state.phase = 'fight';
  Object.assign(state.players[1], { action: 'idle', hp: 100, destructionTime: null });
  effects.update(0, 0, state);
  assert.equal(scene.children.length, baseObjects);
  assertFiniteGeometry(scene);
});

test('new pools remain bounded through repeated final blasts, pauses and round resets', t => {
  const { scene, effects, state, baseObjects } = setup(t);
  damageState(state); state.phase = 'finishing';
  for (const mode of ['high', 'low', 'reduced']) {
    effects.clear(); effects.setQuality(mode); effects.setReducedMotion(mode === 'reduced');
    for (let frame = 0; frame < 1800; frame++) {
      if (frame % 30 === 0) effects.emit({ id: frame, type: 'destruction', player: 'p1', target: 'p2' }, state);
      effects.update(1 / 30, frame / 30, state);
      const stats = effects.getEffectsStats();
      assert.ok(stats.plumeActive <= 48 && stats.waveActive <= 4 && stats.trailVertices <= stats.trailCapacity);
      assert.equal(scene.children.length, baseObjects);
      if (frame % 150 === 0) assertFiniteGeometry(scene);
    }
    state.phase = 'paused';
    const before = effects.getEffectsStats().destructions;
    effects.emit({ id: 'paused', type: 'destruction', player: 'p1', target: 'p2' }, state);
    advance(effects, state, 4);
    assert.equal(effects.getEffectsStats().destructions, before);
    assert.equal(effects.getEffectsStats().plumeActive, 0);
    state.round++; state.phase = 'finishing'; effects.update(0, 0, state);
    assert.equal(effects.getEffectsStats().destructions, 0, 'new round clears cinematic ownership');
  }
});

test('claw ribbons sample actual GLB tip and foot trajectories instead of arbitrary circles', async t => {
  const { scene, effects, state } = setup(t);
  const fs = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const saved = new Map(['self', 'createImageBitmap', 'ProgressEvent'].map(key => [key, globalThis[key]]));
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
  const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  const originalLoad = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
  t.after(() => { GLTFLoader.prototype.loadAsync = originalLoad; for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const { loadRobotAssets, createRobot } = await import('../src/robot.js');
  await loadRobotAssets(); GLTFLoader.prototype.loadAsync = originalLoad;
  const robot = createRobot(); t.after(() => robot.dispose());
  state.phase = 'fight';
  const player = state.players[0]; Object.assign(player, { action: 'heavy', variant: 'launcher', facing: 1, actionDuration: .86, hp: 100 });
  let observed = 0;
  for (let frame = 0; frame < 34; frame++) {
    player.actionTime = frame / 60; player.x = -.8 + frame * .009;
    robot.group.position.set(player.x, .45, 0); player.y = .45;
    robot.update(player, 1 / 60, frame / 60);
    player.combatAnchors = robot.getCombatAnchors();
    effects.update(1 / 60, frame / 60, state);
    const trail = scene.getObjectByName('claw-contact-trails').geometry;
    if (trail.drawRange.count > 0 && player.actionTime >= .22 && player.actionTime <= .39) {
      const latest = new THREE.Vector3().fromBufferAttribute(trail.attributes.position, 0);
      assert.ok(latest.distanceTo(player.combatAnchors.leftClaw) < .011, 'ribbon leading edge tracks the actual claw tip within the sub-centimeter sample threshold');
      observed++;
    }
  }
  assert.ok(observed >= 5, 'an actual active trajectory was sampled over several frames');
  assert.ok(effects.getEffectsStats().trailSamples > 8);
  state.phase = 'paused'; advance(effects, state, .3);
  assert.equal(effects.getEffectsStats().trailVertices, 0, 'paused pose cannot grow a detached phantom trail');
  assertFiniteGeometry(scene);
});

test('cold victory, destroyed, paused and legacy snapshots never dereference a missing attack', t => {
  const { scene, effects } = setup(t);
  assert.equal(effects.getEffectsStats().trailVertices, 0);
  for (const phase of [undefined, 'fight', 'paused', 'finishing', 'matchOver']) {
    for (const player of [{}, { action: 'idle' }, { action: 'victory' }, { action: 'destroyed', hp: 0, destructionTime: 9 }]) {
      effects.update(1 / 60, 3, { phase, players: [{ id: 'p1', ...player }] });
      assertFiniteGeometry(scene);
    }
  }
  effects.update(0, 0, null);
  assertFiniteGeometry(scene);
});

test('industrial set stays merged, receives robot spill light and disposes its resources', async () => {
  const { createIndustrialEnvironment } = await import('../src/environment.js');
  const scene = new THREE.Scene();
  const { createDeckSurface } = await import('../src/deck-surface.js');
  const environment = createIndustrialEnvironment(scene, new THREE.Texture({ width: 2172, height: 724 }), createDeckSurface({ resolution: 512 }));
  assert.ok(environment.group.children.length <= 15, 'detailed pipes and deck do not become hundreds of draw calls');
  const deck = environment.group.getObjectByName('industrial-deck');
  assert.ok(deck.receiveShadow && deck.material.isMeshStandardMaterial);
  assert.ok(deck.material.roughnessMap && deck.material.metalnessMap, 'paint and exposed steel have distinct response to robot light');
  const geometries = new Set(), materials = new Set();
  environment.group.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  let disposed = 0;
  for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => disposed++);
  assertFiniteGeometry(scene);
  environment.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, geometries.size + materials.size);
});

test('Belobog masonry and floor cover airborne and backthrow camera frusta without scaling the source wall', async () => {
  const { createIndustrialEnvironment } = await import('../src/environment.js');
  const scene = new THREE.Scene();
  const { createDeckSurface } = await import('../src/deck-surface.js');
  const environment = createIndustrialEnvironment(scene, new THREE.Texture({ width: 2172, height: 724 }), createDeckSurface({ resolution: 512 }));
  const original = environment.group.getObjectByName('original-belobog-wall');
  original.geometry.computeBoundingBox();
  assert.equal(original.geometry.boundingBox.max.x - original.geometry.boundingBox.min.x, 24, 'original artwork retains its scale and aspect');
  const masonry = new THREE.Box3().setFromObject(environment.group.getObjectByName('industrial-brick'));
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 3.52);
  const raycaster = new THREE.Raycaster(), point = new THREE.Vector3();
  for (const aspect of [1.3, 16 / 9, 844 / 390, 2.7, 32 / 9]) for (const height of [0, 1.8, 3.0]) for (const facing of [-1, 1]) {
    const camera = new THREE.PerspectiveCamera(36, aspect, .1, 70);
    const z = Math.max(10.7 + Math.max(0, height - .4) * 1.5, 17.2 / (2 * Math.tan(THREE.MathUtils.degToRad(18)) * aspect)) + .8;
    camera.position.set(facing * 1.5, 4.2, z); camera.lookAt(facing * 1.275, 1.7, -.2); camera.updateMatrixWorld(true);
    for (const x of [-1, 1]) for (const y of [0, .7, 1]) {
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera); raycaster.ray.intersectPlane(plane, point);
      assert.ok(point.x > masonry.min.x && point.x < masonry.max.x && point.y < masonry.max.y, 'frustum reveals continuing masonry instead of empty cyan background');
    }
  }
  environment.dispose();
});
