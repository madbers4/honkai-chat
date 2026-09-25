import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { robotPresentation } from '../shared/robot-presentation.js';

// Numeric deformation tests need no browser/GPU or decoded texture pixels.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);

function skinBounds(robot, boneName) {
  robot.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  robot.group.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      if (boneName && mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name !== boneName) continue;
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite), 'deformed vertex must stay finite');
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

for (const facing of [-1, 1]) for (const airborne of [false, true]) {
  test(`KO stays on the floor throughout the deformation, facing ${facing}, airborne ${airborne}`, () => {
    const robot = createRobot({ skin: facing === 1 ? 'amber' : 'cyan' });
    const dt = 1 / 60;
    robot.group.position.set(2.4 * facing, airborne ? 1.4 : 0, 0);
    for (let frame = 0; frame < 25; frame++) robot.update({ action: airborne ? 'jump' : 'heavy', facing, actionTime: frame * dt, actionDuration: .81, y: robot.group.position.y, vy: airborne ? 2 : 0 }, dt, frame * dt);
    let y = robot.group.position.y;
    let vy = airborne ? 2 : 0;
    let previous = skinBounds(robot);
    for (let frame = 0; frame <= 150; frame++) {
      if (frame > 0 && y > 0) { vy -= 24 * dt; y = Math.max(0, y + vy * dt); }
      robot.group.position.y = y;
      robot.update({ action: 'ko', facing, actionTime: frame * dt, actionDuration: 1.5, y, vy }, dt, .5 + frame * dt);
      const bounds = skinBounds(robot);
      assert.ok(bounds.min.y >= -0.0001, `frame ${frame}: below floor by ${bounds.min.y}`);
      const shadow = robot.getContactShadow();
      assert.ok(Math.abs(shadow.height - Math.max(0, bounds.min.y)) < .001, `frame ${frame}: shadow ${shadow.height} vs mesh minimum ${bounds.min.y}`);
      assert.ok(Math.abs(shadow.width - (bounds.max.x - bounds.min.x)) < .002, 'shadow must follow actual silhouette');
      const center = bounds.getCenter(new THREE.Vector3());
      const priorCenter = previous.getCenter(new THREE.Vector3());
      assert.ok(center.distanceTo(priorCenter) < .23, `frame ${frame}: discontinuous pose transition`);
      previous = bounds;
      if (frame > 100) assert.ok(bounds.min.y < .002, 'settled KO must rest on the floor, not hover');
      if (frame === 150) {
        assert.ok(bounds.max.y - bounds.min.y > 2, 'ordinary loss must leave the robot upright');
        const housingMin=skinBounds(robot, 'turret').min.y;
        assert.ok(housingMin > .65, 'the head must remain above the chassis, never beside it on the floor');
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(robot.group.getObjectByName('chassis').getWorldQuaternion(new THREE.Quaternion()));
        assert.ok(up.y > .99, 'shutdown preserves a vertical load-bearing chassis');
        assert.ok(skinBounds(robot, 'chassis').min.y > .015, 'the chassis must not prop up the robot on its belly');
        for (const side of ['FL', 'FR', 'RL', 'RR']) assert.ok(skinBounds(robot, `leg_${side}_foot`).min.y < .015, `${side} must remain a supporting foot`);
      }
    }
    robot.dispose();
  });
}

test('combat variants stay finite, supported, and produce distinct joint poses', () => {
  const variants = [
    ['light', '', .105, .34], ['light', 'dashStrike', .13, .48],
    ['heavy', '', .36, .81], ['heavy', 'launcher', .23, .78],
    ['heavy', 'slam', .45, .87], ['special', 'bolt', .30, .72],
    ['special', 'shockwave', .37, .88], ['ultimate', 'overload', 1.3, 1.8],
    ['block', 'parry', .05, .22], ['hit', 'parried', .08, .34], ['hit', 'launched', .12, .42],
    ['heavy', 'grab', .30, .95], ['hit', 'grabbed', .15, .30], ['hit', 'thrown', .14, .48],
    ['hit', 'grabBreak', .06, .25], ['special', 'burst', .065, .50], ['dash', 'feint', .13, .30],
    ['hit', 'burstRepelled', .07, .32], ['hit', 'guardBreak', .18, .95],
  ];
  const signatures = [];
  for (const [action, variant, impact, duration] of variants) {
    const robot = createRobot();
    let signature;
    for (let frame = 0; frame <= Math.ceil(duration * 60); frame++) {
      const elapsed = frame / 60;
      const y = variant === 'slam' ? Math.max(0, 1.2 - elapsed * 3) : variant === 'launched' ? .8 : 0;
      robot.group.position.y = y;
      robot.update({ action, variant, actionTime: elapsed, actionDuration: duration, facing: 1, y, landedTime: variant === 'slam' && elapsed >= .4 ? .4 : null }, 1 / 60, elapsed);
      if (frame % 3 === 0) { const bounds=skinBounds(robot); assert.ok(bounds.min.y >= -.0001, `${variant || action} frame ${frame} minY=${bounds.min.y} support=${robot.getContactShadow().height}`); }
      if (Math.abs(elapsed - impact) < 1 / 60) {
        const values = [];
        robot.group.traverse(o => { if (o.isBone) values.push(...o.quaternion.toArray().map(n => n.toFixed(2))); });
        signature = values.join(',');
      }
    }
    assert.ok(signature);
    signatures.push(signature);
    robot.dispose();
  }
  assert.equal(new Set(signatures).size, variants.length, 'abilities must have distinct mechanical poses');
});

function tipPosition(robot, side) {
  return robot.group.getObjectByName(`leg_${side}_tip`).getWorldPosition(new THREE.Vector3());
}

for (const facing of [-1, 1]) for (const separation of [2, 2.5]) {
  test(`paired grab contacts the opponent and releases without floor penetration (${facing}, ${separation})`, () => {
    const attacker = createRobot({skin:'amber'});
    const victim = createRobot({skin:'cyan'});
    const ax = -facing * separation / 2;
    const vx = facing * separation / 2;
    const catchTime = .26;
    const releaseTime = .56;
    attacker.group.position.x = ax;
    victim.group.position.x = vx;
    for (let frame = 0; frame < 30; frame++) {
      attacker.update({action:'idle',facing},1/60,0);
      victim.update({action:'idle',facing:-facing},1/60,0);
    }
    let priorCenters = [skinBounds(attacker).getCenter(new THREE.Vector3()),skinBounds(victim).getCenter(new THREE.Vector3())];
    for (let frame = 0; frame <= 67; frame++) {
      const t = frame / 60;
      const holding = t >= catchTime && t < releaseTime;
      const released = t >= releaseTime;
      const thrownTime = Math.max(0,t-releaseTime);
      const heldTime = Math.min(.30,Math.max(0,t-catchTime));
      const height = released ? Math.max(0,3.4*thrownTime-12*thrownTime*thrownTime) : 0;
      victim.group.position.set(vx+(released?facing*6.5*thrownTime:0),height,0);
      attacker.update({action:t<.86?'heavy':'idle',variant:t<.86?'grab':'',facing,actionTime:t,actionDuration:.86,y:0,
        grabTarget:holding?'p2':null,grabCatchTime:t>=catchTime?catchTime:null,grabHoldTime:heldTime,
        grabReleaseTime:released&&t<.86?releaseTime:null,grabPartnerX:victim.group.position.x,grabPartnerY:height},1/60,t);
      victim.update({action:holding||released&&thrownTime<.48?'hit':'idle',variant:holding?'grabbed':released&&thrownTime<.48?'thrown':'',facing:-facing,
        actionTime:holding?t-catchTime:thrownTime,actionDuration:holding?.30:.48,y:height,
        grabbedBy:holding?'p1':null,grabHoldTime:heldTime,grabPartnerX:ax,grabPartnerY:0},1/60,t);
      assert.equal(attacker.group.position.x,ax,'pose must not drag the attacker root');
      assert.equal(victim.group.position.y,height,'paired pose must preserve authoritative jump/throw height');
      const actors=[attacker,victim];
      for(let i=0;i<actors.length;i++){
        const bounds=skinBounds(actors[i]);
        assert.ok(bounds.min.y>=-.0001,`paired actor ${i} frame ${frame} penetrates floor`);
        const center=bounds.getCenter(new THREE.Vector3());
        assert.ok(center.distanceTo(priorCenters[i])<.26,`paired actor ${i} frame ${frame} teleports visually`);
        priorCenters[i]=center;
      }
      if (frame===29) for(const side of ['FL','FR']) {
        const sign=side==='FL'?-1:1;
        const expected=new THREE.Vector3(vx-facing*.30,.62,-facing*sign*.38);
        const distance=tipPosition(attacker,side).distanceTo(expected);
        assert.ok(distance<.25,`${side} claw misses paired body anchor by ${distance}`);
      }
    }
    attacker.dispose();victim.dispose();
  });
}

test('grab does not invent a throw when the server reports a whiff', () => {
  const whiff=createRobot();
  const release=createRobot();
  for(let frame=0;frame<=39;frame++){
    const t=frame/60;
    whiff.update({action:'heavy',variant:'grab',facing:1,actionTime:t,actionDuration:.95,grabTarget:null,grabCatchTime:null,grabReleaseTime:null},1/60,t);
    release.update({action:'heavy',variant:'grab',facing:1,actionTime:t,actionDuration:.86,grabTarget:t>=.26&&t<.56?'p2':null,grabHoldTime:Math.min(.30,Math.max(0,t-.26)),grabCatchTime:t>=.26?.26:null,grabReleaseTime:t>=.56?.56:null},1/60,t);
  }
  const whiffHeight=(tipPosition(whiff,'FL').y+tipPosition(whiff,'FR').y)/2;
  const throwHeight=(tipPosition(release,'FL').y+tipPosition(release,'FR').y)/2;
  assert.ok(throwHeight>whiffHeight+.20,'confirmed throw must have a distinct upward release, unlike missed grab recovery');
  whiff.dispose();release.dispose();
});

for (const facing of [-1, 1]) test(`grab break releases both poses smoothly, facing ${facing}`, () => {
  const actors = [createRobot(), createRobot({ skin: 'cyan' })];
  const directions = [facing, -facing];
  for (let frame = 0; frame < 28; frame++) {
    const t = frame / 60;
    const holding = t >= .26;
    for (let i = 0; i < actors.length; i++) {
      const robot = actors[i];
      robot.group.position.x = -directions[i] * 1.05;
      robot.update({ action: i === 0 ? 'heavy' : holding ? 'hit' : 'idle',
        variant: i === 0 ? 'grab' : holding ? 'grabbed' : '', facing: directions[i],
        actionTime: i === 0 ? t : Math.max(0, t - .26), actionDuration: i === 0 ? .95 : .30,
        grabTarget: i === 0 && holding ? 'victim' : null, grabbedBy: i === 1 && holding ? 'attacker' : null,
        grabHoldTime: Math.min(.20, Math.max(0, t - .26)), grabReleaseTime: null,
        grabPartnerX: directions[i] * 1.05, grabPartnerY: 0, y: 0 }, 1 / 60, t);
    }
  }
  const previous = actors.map(robot => skinBounds(robot).getCenter(new THREE.Vector3()));
  for (let frame = 0; frame <= 40; frame++) {
    const t = frame / 60;
    for (let i = 0; i < actors.length; i++) {
      const robot = actors[i];
      const x = -directions[i] * (1.05 + Math.min(t, .25) * 1.6);
      robot.group.position.x = x;
      robot.update({ action: t < .25 ? 'hit' : 'idle', variant: t < .25 ? 'grabBreak' : '',
        facing: directions[i], actionTime: t < .25 ? t : t - .25, actionDuration: .25,
        grabTarget: null, grabbedBy: null, grabReleaseTime: null, y: 0 }, 1 / 60, 28 / 60 + t);
      const bounds = skinBounds(robot);
      const center = bounds.getCenter(new THREE.Vector3());
      assert.equal(robot.group.position.x, x, 'break pose must respect the server recoil position');
      assert.ok(bounds.min.y >= -.0001, 'released claws must not penetrate the floor');
      assert.ok(center.distanceTo(previous[i]) < .23, 'grab break must release without a visual teleport');
      previous[i].copy(center);
    }
  }
  actors.forEach(robot => robot.dispose());
});

for (const height of [0, 1.2]) test(`burst preserves root physics and floor contact at height ${height}`, () => {
  const robot=createRobot();
  robot.group.position.set(-2,height,0);
  for(let frame=0;frame<10;frame++)robot.update({action:'hit',actionTime:frame/60,actionDuration:.34,y:height,facing:1},1/60,frame/60);
  for(let frame=0;frame<=30;frame++){
    robot.update({action:'special',variant:'burst',actionTime:frame/60,actionDuration:.50,y:height,facing:1},1/60,frame/60);
    assert.equal(robot.group.position.y,height,'burst must not snap an airborne actor to the floor');
    assert.equal(robot.group.position.x,-2,'burst animation must not teleport the actor');
    const bounds=skinBounds(robot);
    assert.ok(bounds.min.y>=-.0001);
    if(height>0)assert.ok(bounds.min.y>height-.05,'air burst must stay in the air');
    else assert.ok(bounds.min.y<.05,'ground burst must keep supporting feet planted');
  }
  robot.dispose();
});

function signals(robot) {
  const result = {};
  robot.group.traverse(mesh => {
    if (mesh.isSkinnedMesh && mesh.material.userData.signalChannel) result[mesh.material.userData.signalChannel] = mesh;
  });
  return result;
}

test('original upper, lower and reactor surfaces carry separate signals for both skins without leakage', () => {
  const robots = ['amber', 'cyan'].map(skin => createRobot({ skin }));
  const parts = robots.map(signals);
  for (let i = 0; i < robots.length; i++) {
    const robot = robots[i];
    const channels = parts[i];
    assert.deepEqual(Object.keys(channels).sort(), ['health', 'reactor', 'status']);
    const centers = {};
    for (const [name, mesh] of Object.entries(channels)) {
      assert.ok(mesh.geometry.attributes.position.count > 20, 'signal must use original mesh surfaces');
      assert.equal(mesh.material.toneMapped, false, 'signal color must survive scene exposure');
      centers[name] = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).y;
      const boneName = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(0)].name;
      assert.equal(boneName, name === 'reactor' ? 'chassis' : 'turret');
    }
    assert.ok(centers.health > centers.status && centers.status > centers.reactor, 'health must be the original upper lens');
    for (const hp of [100, 61, 60, 26, 25, 1, 0]) for (const action of ['idle', 'ultimate', 'ko']) {
      const player = { hp, action, actionTime: 2, actionDuration: 2, visualReducedMotion: true };
      robot.update(player, 1 / 60, 5);
      const expected = robotPresentation({ ...player, skin: i ? 'cyan' : 'amber' }, 5, { reducedMotion: true });
      for (const [channel, mesh] of Object.entries(channels)) {
        assert.equal(mesh.material.emissive.getHex(), expected[`${channel}Color`]);
        assert.equal(mesh.material.emissiveIntensity, expected[`${channel}Intensity`]);
        assert.ok(mesh.material.emissiveIntensity <= 1.3, 'avoid bleaching signal hues');
      }
    }
  }
  for (const channel of ['health', 'status', 'reactor']) assert.notEqual(parts[0][channel].material, parts[1][channel].material);
  const prior = parts[1].health.material.emissive.getHex();
  robots[0].update({ hp: 100, action: 'idle' }, 1 / 60, 0);
  assert.equal(parts[1].health.material.emissive.getHex(), prior, 'another robot must retain its health signal');
  robots.forEach(robot => robot.dispose());
});

for (const facing of [-1, 1]) test(`damage emitters follow the actual articulated joints through air and KO (${facing})`, () => {
  const robot = createRobot();
  const anchors = robot.getDamageAnchors();
  const references = Object.fromEntries(Object.entries(anchors).map(([name, point]) => [name, point]));
  const owners = { core: 'chassis', head: 'turret', left: 'leg_FL_knee', right: 'leg_FR_knee' };
  const direction = new THREE.Vector3(0, .20, 1).normalize();
  let traveled = 0;
  const first = anchors.head.clone();
  for (let frame = 0; frame < 180; frame++) {
    const action = frame < 30 ? 'heavy' : frame < 60 ? 'jump' : 'ko';
    const y = frame >= 30 && frame < 70 ? Math.max(0, 1.2 - Math.max(0, frame - 60) * .15) : 0;
    robot.group.position.set(facing * 2.3, y, .18);
    robot.update({ action, facing, hp: action === 'ko' ? 0 : 20, actionTime: (frame % 60) / 60 + (frame >= 120 ? 1 : 0), y }, 1 / 60, frame / 60);
    assert.equal(robot.getDamageAnchors(), anchors, 'anchors must reuse their container');
    for (const [name, owner] of Object.entries(owners)) {
      assert.equal(anchors[name], references[name], 'anchor vectors must be reused');
      assert.ok(anchors[name].toArray().every(Number.isFinite));
      if (frame % 6 === 0) {
        const surface = anchors[name].clone().addScaledVector(direction, -.025);
        const point = new THREE.Vector3();
        let maxProjection = -Infinity;
        let closestVertex = Infinity;
        robot.group.traverse(mesh => {
          if (!mesh.isSkinnedMesh) return;
          for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
            if (mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name !== owner) continue;
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
            maxProjection = Math.max(maxProjection, point.dot(direction));
            closestVertex = Math.min(closestVertex, point.distanceTo(surface));
          }
        });
        assert.ok(closestVertex < .0001, `${name} must emerge from an actual deformed source vertex`);
        assert.ok(anchors[name].dot(direction) > maxProjection + .017, `${name} must lie just outside the camera-facing metal surface`);
      }
    }
    traveled = Math.max(traveled, anchors.head.distanceTo(first));
  }
  assert.ok(traveled > 1, 'test must cover large actual emitter displacement');
  robot.dispose();
});

test('damaged idle and gait remain supported and return smoothly to the healthy pose after repair', () => {
  const healthy = createRobot();
  const damaged = createRobot();
  let maxDifference = 0;
  for (let frame = 0; frame < 420; frame++) {
    const t = frame / 60;
    const action = frame < 120 ? 'walk' : 'idle';
    const state = { action, actionTime: t, vx: action === 'walk' ? 2.3 : 0, facing: 1 };
    for (const robot of [healthy, damaged]) robot.group.position.x = Math.min(t, 2) * 2.3;
    healthy.update({ ...state, hp: 100 }, 1 / 60, t);
    damaged.update({ ...state, hp: frame < 270 ? 18 : 100 }, 1 / 60, t);
    if (frame < 270) maxDifference = Math.max(maxDifference, healthy.group.getObjectByName('turret').quaternion.angleTo(damaged.group.getObjectByName('turret').quaternion));
    if (frame % 10 === 0) {
      const bounds = skinBounds(damaged);
      assert.ok(bounds.min.y >= -.0001 && bounds.min.y < .06, 'damaged mechanics must stay supported');
    }
  }
  assert.ok(maxDifference > .03, 'damage must visibly affect mechanical acting');
  assert.ok(healthy.group.getObjectByName('turret').quaternion.angleTo(damaged.group.getObjectByName('turret').quaternion) < .002, 'healing must clear the damaged servo pose');
  healthy.dispose(); damaged.dispose();
});

test('paused inspection freezes acting and signals while seeking a new pose remains possible', () => {
  const robot = createRobot();
  const player = { action: 'idle', hp: 18, actionTime: 3.86, visualPaused: true };
  robot.update(player, 0, 3.86);
  const bone = robot.group.getObjectByName('turret');
  const quaternion = bone.quaternion.clone();
  const intensity = signals(robot).health.material.emissiveIntensity;
  const anchor = robot.getDamageAnchors().head.clone();
  robot.group.position.x += 1;
  for (let frame = 0; frame < 60; frame++) robot.update(player, 0, 10 + frame);
  assert.ok(bone.quaternion.angleTo(quaternion) < 1e-6, 'pause must not advance servo faults');
  assert.equal(signals(robot).health.material.emissiveIntensity, intensity);
  assert.ok(Math.abs(robot.getDamageAnchors().head.x - anchor.x - 1) < 1e-5, 'frozen anchors still follow root relocation');
  robot.update({ ...player, action: 'heavy', variant: 'launcher', actionTime: .24, hp: 100 }, 0, .24);
  assert.ok(bone.quaternion.angleTo(quaternion) > .05, 'seek must apply the selected pose');
  assert.equal(signals(robot).health.material.emissive.getHex(), robotPresentation({ hp: 100 }, 0).healthColor);
  robot.dispose();
});

test('entering pause preserves an in-flight pose and ignores partner interpolation drift', () => {
  const robot = createRobot();
  let player;
  for (let frame = 0; frame < 7; frame++) {
    player = { action: 'heavy', variant: 'grab', actionTime: frame / 60, actionDuration: .95, hp: 45, grabPartnerX: 2.1 };
    robot.update(player, 1 / 60, frame / 60);
  }
  const quaternions = new Map();
  robot.group.traverse(bone => { if (bone.isBone) quaternions.set(bone, bone.quaternion.clone()); });
  for (let frame = 0; frame < 30; frame++) robot.update({ ...player, visualPaused: true, grabPartnerX: 2.1 + frame * .00001 }, 0, 1 + frame);
  for (const [bone, quaternion] of quaternions) assert.deepEqual(bone.quaternion.toArray(), quaternion.toArray(), `${bone.name} must freeze on live-to-pause transition`);
  robot.dispose();
});

test('disposing signal instances releases private materials but preserves shared mesh and textures', () => {
  const first = createRobot();
  const second = createRobot();
  const materials = new Set();
  const geometries = new Set();
  let privateDisposals = 0;
  let sharedDisposals = 0;
  first.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    materials.add(mesh.material);
    if (mesh.isSkinnedMesh) geometries.add(mesh.geometry);
  });
  for (const material of materials) material.addEventListener('dispose', () => privateDisposals++);
  for (const geometry of geometries) geometry.addEventListener('dispose', () => sharedDisposals++);
  first.dispose(); first.dispose();
  assert.equal(privateDisposals, materials.size);
  assert.equal(sharedDisposals, 0);
  second.update({ hp: 45, action: 'walk' }, 1 / 60, 1);
  assert.ok(skinBounds(second).min.y >= -.0001, 'remaining clone must stay usable');
  second.dispose();
});

test('V5 mounts real bounded lights and combat anchors on original moving mechanisms', () => {
  const robot = createRobot();
  const anchors = robot.getCombatAnchors();
  const lights = [];
  robot.group.traverse(o => { if (o.isLight) lights.push(o); });
  assert.equal(lights.length, 2);
  assert.ok(lights.some(light => light.isSpotLight) && lights.some(light => light.isPointLight));
  for (const light of lights) { assert.equal(light.castShadow, false); assert.ok(light.distance > 2 && light.distance < 7); }
  const start = anchors.leftClaw.clone();
  for (let i = 0; i < 15; i++) robot.update({ action: 'heavy', variant: 'launcher', actionTime: i / 60, hp: 18, facing: -1 }, 1 / 60, i / 60);
  assert.equal(robot.getCombatAnchors(), anchors);
  assert.ok(anchors.leftClaw.distanceTo(start) > .5);
  assert.ok(anchors.leftClaw.distanceTo(robot.group.getObjectByName('leg_FL_tip').getWorldPosition(new THREE.Vector3())) < .00001);
  const spot = lights.find(light => light.isSpotLight);
  assert.ok(spot.getWorldPosition(new THREE.Vector3()).distanceTo(anchors.muzzle) < .00001);
  assert.equal(spot.color.getHex(), robotPresentation({ hp: 18 }).healthColor);
  robot.update({ hp: 100, visualQuality: 'low' }, 1 / 60, 1);
  assert.equal(lights.filter(light => light.visible).length, 1);
  robot.update({ action: 'destroyed' }, 1 / 60, 2);
  assert.equal(lights.reduce((sum, light) => sum + light.intensity, 0), 0);
  robot.dispose();
});

test('V5 combo contacts have different leading claws, swept silhouettes and grounded weight transfer', () => {
  const poses = {};
  for (const [variant, startup, duration] of [['jab', .11, .38], ['cross', .16, .49], ['rake', .24, .68], ['crusher', .34, 1.02]]) {
    const robot = createRobot();
    let previousClaw;
    let strokeSpeed = 0;
    for (let frame = 0; frame <= Math.ceil(duration * 120); frame++) {
      const t = frame / 120;
      robot.group.position.x = .18 * Math.min(t / startup, 1);
      robot.update({ action: variant === 'crusher' ? 'heavy' : 'light', variant, actionTime: t, actionDuration: duration, facing: 1, y: 0 }, 1 / 120, t);
      const anchors = robot.getCombatAnchors();
      const leading = variant === 'cross' ? anchors.rightClaw : anchors.leftClaw;
      if (previousClaw && t >= startup - .05 && t <= startup + .03) strokeSpeed = Math.max(strokeSpeed, leading.distanceTo(previousClaw) * 120);
      previousClaw = leading.clone();
      if (frame === Math.round((startup + .02) * 120)) poses[variant] = { left: anchors.leftClaw.clone(), right: anchors.rightClaw.clone(), chassis: robot.group.getObjectByName('chassis').quaternion.clone() };
      if (frame % 4 === 0) assert.ok(skinBounds(robot).min.y >= -.0001);
      assert.equal(robot.group.position.x, .18 * Math.min(t / startup, 1), 'attack acting cannot create a gameplay step');
    }
    assert.ok(strokeSpeed > 3, `${variant} needs an accelerated active stroke`);
    robot.dispose();
  }
  assert.ok(poses.jab.left.x > poses.jab.right.x + .35, 'jab leads with left claw');
  assert.ok(poses.cross.right.x > poses.cross.left.x + .35, 'cross leads with opposite claw');
  assert.ok(poses.rake.chassis.angleTo(poses.jab.chassis) > .15, 'rake sweeps through different torso torque');
  assert.ok(Math.abs(poses.crusher.left.y - poses.crusher.right.y) < .23, 'crusher is a two-claw downward beat');
});

for (const facing of [-1, 1]) test(`V5 extended grab holds a real brace through two pummels and back throw (${facing})`, () => {
  const attacker = createRobot(); const victim = createRobot({ skin: 'cyan' });
  const ax = -facing * 6; const vx = ax + facing * 2.1;
  attacker.group.position.x = ax; victim.group.position.x = vx;
  let reaction = 0;
  for (let frame = 0; frame <= 108; frame++) {
    const t = frame / 60;
    const hold = t >= .26 && t < 1.40;
    const strike = t >= .90 && t <= 1.20 ? t - .90 : t >= .54 && t <= .84 ? t - .54 : null;
    const count = t >= .90 ? 2 : t >= .54 ? 1 : 0;
    const thrown = Math.max(0, t - 1.40);
    const y = Math.max(0, 12 * thrown - 12 * thrown * thrown);
    victim.group.position.set(vx - facing * 10.5 * Math.max(0, thrown - .16), y, 0);
    const paired = { grabHoldTime: Math.max(0, t - .26), grabStrikeTime: strike, grabStrikes: count, grabThrowTime: t >= 1.20 && hold ? t - 1.20 : null, throwStyle: 'back', grabThrowDirection: -facing };
    attacker.update({ ...paired, action: 'heavy', variant: 'grab', facing, actionTime: t, actionDuration: 1.7, y: 0, grabTarget: hold ? 'victim' : null, grabReleaseTime: t >= 1.4 ? 1.4 : null, grabPartnerX: victim.group.position.x, grabPartnerY: y }, 1 / 60, t);
    victim.update({ ...paired, action: hold || thrown > 0 ? 'hit' : 'idle', variant: hold ? 'grabbed' : thrown > 0 ? 'thrown' : '', facing: -facing, actionTime: hold ? t - .26 : thrown, actionDuration: hold ? 1.25 : .48, y, grabbedBy: hold ? 'attacker' : null, grabPartnerX: ax, grabPartnerY: 0 }, 1 / 60, t);
    assert.equal(attacker.group.position.x, ax);
    assert.equal(victim.group.position.y, y);
    if (frame % 3 === 0) { assert.ok(skinBounds(attacker).min.y >= -.0001); assert.ok(skinBounds(victim).min.y >= -.0001); }
    if (strike !== null && strike > .07 && strike < .22) {
      const brace = facing === 1 ? 'rightClaw' : 'leftClaw';
      const sign = brace === 'leftClaw' ? -1 : 1;
      const target = new THREE.Vector3(vx - facing * .30, .62, -facing * sign * .38);
      assert.ok(attacker.getCombatAnchors()[brace].distanceTo(target) < .30, 'one claw must keep a grip while the other pummels');
      reaction = Math.max(reaction, Math.abs(victim.group.getObjectByName('chassis').rotation.z));
    }
  }
  assert.ok(reaction > .06, 'victim must recoil on mirrored pummel time');
  attacker.dispose(); victim.dispose();
});

for (const facing of [-1, 1]) test(`V5 ordinary KO rises continuously through recovery, facing ${facing}`, () => {
  const robot = createRobot();
  for (let frame = 0; frame <= 120; frame++) robot.update({ action: 'ko', facing, actionTime: frame / 60, hp: 0 }, 1 / 60, frame / 60);
  let previous = skinBounds(robot).getCenter(new THREE.Vector3());
  const parkedChassis = robot.group.getObjectByName('chassis').getWorldPosition(new THREE.Vector3()).y;
  for (let frame = 0; frame <= 108; frame++) {
    const time = frame / 60;
    robot.update({ action: time <= 1.6 ? 'recover' : 'idle', facing, hp: 100, actionTime: time, actionDuration: 1.6 }, 1 / 60, 2 + time);
    const bounds = skinBounds(robot); const center = bounds.getCenter(new THREE.Vector3());
    assert.ok(bounds.min.y >= -.0001, 'reboot cannot push any original geometry below ground');
    assert.ok(center.distanceTo(previous) < .14, 'reboot must not snap from corpse to standing');
    for (const side of ['FL', 'FR', 'RL', 'RR']) assert.ok(skinBounds(robot, `leg_${side}_foot`).min.y < .02, `${side} supports the chassis throughout reboot`);
    previous = center;
  }
  assert.ok(robot.group.getObjectByName('chassis').getWorldPosition(new THREE.Vector3()).y > parkedChassis + .06, 'servos must lift the chassis out of its parked pose');
  robot.dispose();
});

for (const facing of [-1, 1]) for (const hp of [0, 35]) test(`shutdown load stays on all four feet and freezes after settling (${facing}, ${hp} HP)`, () => {
  const robot = createRobot();
  for (let frame = 0; frame < 30; frame++) robot.update({ action: 'heavy', variant: 'launcher', facing, hp: 35, actionTime: frame / 60 }, 1 / 60, frame / 60);
  let previous = skinBounds(robot).getCenter(new THREE.Vector3());
  for (let frame = 0; frame <= 120; frame++) {
    const t = frame / 60;
    robot.update({ action: 'ko', facing, hp, actionTime: t, actionDuration: 1.5 }, 1 / 60, t);
    const box = skinBounds(robot);
    const center = box.getCenter(new THREE.Vector3());
    assert.ok(center.distanceTo(previous) < .10, 'loss must continue from the interrupted punch without a snap');
    assert.ok(box.min.y >= -.0001);
    previous.copy(center);
    if (t > .8) for (const side of ['FL', 'FR', 'RL', 'RR']) {
      const foot = skinBounds(robot, `leg_${side}_foot`);
      assert.ok(foot.min.y < .015, `${side} parked foot must contact the floor`);
    }
  }
  const joints = new Map();
  robot.group.traverse(bone => { if (bone.isBone) joints.set(bone, bone.quaternion.clone()); });
  for (const time of [3, 8, 30]) robot.update({ action: 'ko', facing, hp, actionTime: time }, 1 / 60, time);
  for (const [bone, quaternion] of joints) assert.deepEqual(bone.quaternion.toArray(), quaternion.toArray(), `${bone.name}: unpowered joints cannot idle or vibrate`);
  robot.dispose();
});

for (const facing of [-1, 1]) for (const time of [0, .32, .8, 1.2, 1.6]) test(`late reboot reproduces the planted live pose (${facing}, ${time}s)`, () => {
  const live = createRobot();
  const late = createRobot();
  for (let frame = 0; frame <= 120; frame++) live.update({ action: 'ko', facing, hp: 0, actionTime: frame / 60 }, 1 / 60, frame / 60);
  for (let frame = 0; frame <= Math.ceil(time * 60); frame++) {
    live.update({ action: 'recover', facing, hp: 100, actionTime: Math.min(frame / 60, time), actionDuration: 1.6 }, 1 / 60, 2 + time);
  }
  late.update({ action: 'recover', facing, hp: 100, actionTime: time, actionDuration: 1.6 }, 1 / 60, 2 + time);
  for (const key of ['head', 'core', 'leftClaw', 'rightClaw']) assert.ok(late.getCombatAnchors()[key].distanceTo(live.getCombatAnchors()[key]) < .002, `${key}: reconnect must not begin from an invented sideways corpse`);
  late.update({ action: 'recover', facing, hp: 100, actionTime: 1.6, actionDuration: 1.6 }, 1 / 60, 3.6);
  late.update({ action: 'recover', facing, hp: 100, actionTime: time, actionDuration: 1.6, visualPaused: true }, 0, 2 + time);
  for (const key of ['head', 'core', 'leftClaw', 'rightClaw']) assert.ok(late.getCombatAnchors()[key].distanceTo(live.getCombatAnchors()[key]) < .002, `${key}: rewinding the reboot restores the same pose`);
  assert.ok(skinBounds(late).min.y >= -.0001);
  live.dispose(); late.dispose();
});

test('reboot pause fixes diagnostic lamps and original joints; winner is not forced into a loser pose', () => {
  const robot = createRobot();
  for (let frame = 0; frame <= 40; frame++) robot.update({ action: 'victory', actionTime: frame / 60 }, 1 / 60, frame / 60);
  const before = skinBounds(robot).getCenter(new THREE.Vector3());
  robot.update({ action: 'recover', hp: 100, actionTime: 0, actionDuration: 1.6 }, 1 / 60, 1);
  assert.ok(skinBounds(robot).getCenter(new THREE.Vector3()).distanceTo(before) < .01, 'the winning robot preserves its victory pose at reboot entry');
  const state = { action: 'recover', hp: 100, actionTime: .55, actionDuration: 1.6, visualPaused: true };
  robot.update(state, 0, 1.55);
  const bones = new Map(); robot.group.traverse(bone => { if (bone.isBone) bones.set(bone, bone.quaternion.toArray()); });
  const lamps = Object.fromEntries(Object.entries(signals(robot)).map(([key, mesh]) => [key, [mesh.material.emissive.getHex(), mesh.material.emissiveIntensity]]));
  for (let frame = 0; frame < 60; frame++) robot.update(state, 0, 5 + frame);
  for (const [bone, quaternion] of bones) assert.deepEqual(bone.quaternion.toArray(), quaternion);
  for (const [key, mesh] of Object.entries(signals(robot))) assert.deepEqual([mesh.material.emissive.getHex(), mesh.material.emissiveIntensity], lamps[key]);
  robot.dispose();
});

test('V5 destruction retains every original triangle, settles deterministically and resets on rematch', () => {
  const robots = [createRobot(), createRobot()];
  let originalTriangles = 0;
  robots[0].group.traverse(mesh => { if (mesh.isSkinnedMesh) originalTriangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3; });
  for (const robot of robots) {
    for (let frame = 0; frame < 130; frame++) robot.update({ action: 'defeated', variant: 'coreRip', actionTime: frame / 60, actionDuration: 3.7, hp: 0, facing: -1, grabPartnerX: -2.1 }, 1 / 60, frame / 60);
    robot.update({ action: 'destroyed', variant: 'coreRip', destructionTime: 0, hp: 0 }, 1 / 60, 2.15);
  }
  const chunks = robots.map(robot => { const list = []; robot.group.traverse(mesh => { if (mesh.userData.originalRobotFragment) list.push(mesh); }); return list; });
  assert.ok(chunks[0].length >= 20 && chunks[0].length < 40);
  assert.equal(chunks[0].reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0), originalTriangles);
  for (let frame = 0; frame <= 240; frame++) {
    const t = frame / 60;
    robots.forEach(robot => robot.update({ action: 'destroyed', variant: 'coreRip', destructionTime: t, hp: 0 }, 1 / 60, 2.15 + t));
    if (frame % 12 === 0) for (let j = 0; j < chunks[0].length; j++) {
      const mesh = chunks[0][j]; const point = new THREE.Vector3();
      assert.ok(mesh.position.distanceTo(chunks[1][j].position) < 1e-9, 'breakup must be deterministic');
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y >= -.0001, 'actual original fragment surface must stay above ground');
        assert.ok(Math.abs(point.x) < 8 && Math.abs(point.z) < 8, 'fragment flight must stay bounded');
      }
    }
  }
  const settled = chunks[0].map(mesh => mesh.position.clone());
  const shadows = robots[0].group.getObjectByName('wreck-contact-shadows');
  assert.equal(shadows.count, chunks[0].length, 'one ground contact per real fragment in one instanced pass');
  assert.ok(shadows.instanceMatrix.array.every(Number.isFinite));
  assert.ok(shadows.geometry.attributes.contactOpacity.array.some(value => value > .4), 'settled fragments have visible ground contact');
  let shadowDisposals = 0;
  shadows.geometry.addEventListener('dispose', () => shadowDisposals++);
  shadows.material.addEventListener('dispose', () => shadowDisposals++);
  let shadowMeshDisposals = 0;
  shadows.addEventListener('dispose', () => shadowMeshDisposals++);
  robots[0].update({ action: 'destroyed', destructionTime: 7 }, 1 / 60, 10);
  chunks[0].forEach((mesh, i) => assert.ok(mesh.position.distanceTo(settled[i]) < .001, 'wreck must come to rest'));
  robots[0].update({ action: 'recover', actionTime: 0, actionDuration: 1.6, hp: 100 }, 1 / 60, 11);
  assert.equal(robots[0].group.getObjectByName('OriginalAutomaton_Wreck').visible, false);
  const skins = []; robots[0].group.traverse(mesh => { if (mesh.isSkinnedMesh) skins.push(mesh); });
  assert.ok(skins.every(mesh => mesh.parent.visible), 'rematch restores the intact robot');
  robots.forEach(robot => robot.dispose());
  robots[0].dispose();
  assert.equal(shadowDisposals, 2, 'private contact resources are released with the wreck');
  assert.equal(shadowMeshDisposals, 1, 'instanced contact buffers are released exactly once with the wreck');
});

test('V5 air strikes and landing keep real height and have separate contact silhouettes', () => {
  const signatures = [];
  for (const [variant, duration] of [['airJab', .30], ['airCross', .36], ['airFinish', .48], ['airDash', .18]]) {
    const robot = createRobot();
    for (let frame = 0; frame <= 60; frame++) {
      const t = frame / 120;
      const y = Math.max(0, .9 + 1.5 * t - 12 * t * t);
      robot.group.position.y = y;
      const landingRecovery = y <= .02 ? Math.max(0, .16 - Math.max(0, t - .35)) : 0;
      robot.update({ action: variant === 'airDash' ? 'dash' : 'light', variant, y, actionTime: t, actionDuration: duration, landingRecovery }, 1 / 120, t);
      assert.equal(robot.group.position.y, y);
      if (frame % 4 === 0) assert.ok(skinBounds(robot).min.y >= -.0001);
      if (frame === 20) signatures.push([...robot.getCombatAnchors().leftClaw.toArray(), ...robot.getCombatAnchors().rightClaw.toArray()].map(n => n.toFixed(2)).join(','));
    }
    robot.dispose();
  }
  assert.equal(new Set(signatures).size, 4);
});

test('V5 reconnect reconstructs the canonical defeated pose before showing a late wreck', () => {
  const live = createRobot(); const reconnect = createRobot();
  for (let frame = 0; frame <= 129; frame++) live.update({ action: 'defeated', variant: 'overload', facing: -1, hp: 0, actionTime: frame / 60, actionDuration: 3.7 }, 1 / 60, frame / 60);
  const state = { action: 'destroyed', variant: 'overload', facing: -1, hp: 0, destructionTime: 1.1 };
  live.update(state, 1 / 60, 3.25); reconnect.update(state, 1 / 60, 3.25);
  const pieces = [];
  live.group.traverse(mesh => { if (mesh.userData.originalRobotFragment) pieces.push(mesh); });
  for (const piece of pieces) {
    const restored = reconnect.group.getObjectByName(piece.name);
    assert.ok(restored.position.distanceTo(piece.position) < .0001, 'late reconnect must reconstruct the same wreck');
    assert.ok(restored.quaternion.angleTo(piece.quaternion) < .00001);
  }
  live.dispose(); reconnect.dispose();
});

for (const facing of [-1, 1]) test(`V5 core rip grips the actual extracted source geometry, facing ${facing}`, () => {
  const winner = createRobot(); const target = createRobot({ skin: 'cyan' });
  winner.group.position.x = -facing * 1.05; target.group.position.x = facing * 1.05;
  const source = signals(target).reactor;
  const extracted = target.group.getObjectByName('OriginalReactor_Extraction');
  assert.equal(extracted.geometry.attributes.position.count, source.geometry.attributes.position.count);
  assert.equal(extracted.geometry.index.count, source.geometry.index.count, 'the ripped core must preserve source topology');
  for (let frame = 0; frame <= 129; frame++) {
    const t = frame / 60;
    winner.update({ action: 'finisher', variant: 'coreRip', facing, actionTime: t, actionDuration: 3.7, grabPartnerX: target.group.position.x }, 1 / 60, t);
    target.update({ action: 'defeated', variant: 'coreRip', facing: -facing, hp: 0, actionTime: t, actionDuration: 3.7, grabPartnerX: winner.group.position.x }, 1 / 60, t);
    assert.equal(winner.group.position.x, -facing * 1.05); assert.equal(target.group.position.x, facing * 1.05);
    if (frame % 6 === 0) { assert.ok(skinBounds(winner).min.y >= -.0001); assert.ok(skinBounds(target).min.y >= -.0001); }
    if (t > 1.25) {
      assert.equal(source.visible, false); assert.equal(extracted.visible, true);
      const core = target.getCombatAnchors().core;
      assert.ok(winner.getCombatAnchors().leftClaw.distanceTo(core) < .55, 'left claw must remain around the exposed source core');
      assert.ok(winner.getCombatAnchors().rightClaw.distanceTo(core) < .55, 'right claw must remain around the exposed source core');
    }
  }
  const rupture = target.getCombatAnchors().core.clone();
  target.update({ action: 'destroyed', variant: 'coreRip', facing: -facing, destructionTime: 0, hp: 0 }, 1 / 60, 2.15);
  assert.deepEqual(target.getCombatAnchors().core.toArray(), rupture.toArray(), 'destruction event keeps the real rupture origin');
  winner.dispose(); target.dispose();
});
