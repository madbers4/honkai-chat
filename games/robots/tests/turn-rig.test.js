import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { buildTurnCase } from '../scripts/turn-cases.js';
import { turnStartup } from '../src/mechanical-turn.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { Object.assign(this, properties); } };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);
const sides = ['FL', 'FR', 'RL', 'RR'];
const feet = robot => sides.map(side => robot.group.getObjectByName(`leg_${side}_tip`).getWorldPosition(new THREE.Vector3()));
function bounds(robot) {
  const box = new THREE.Box3(), p = new THREE.Vector3();
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite)); box.expandByPoint(p);
    }
  });
  return box;
}
function update(robot, p, partner, dt, time, extra = {}) {
  robot.group.position.set(p.x, p.y, 0);
  robot.update({ ...p, grabPartnerX: partner?.x, grabPartnerY: partner?.y, ...extra }, dt, time);
  assert.deepEqual(robot.group.position.toArray(), [p.x, p.y, 0], 'visual turn preserves the network root');
}

for (const facing of [-1, 1]) for (const type of ['back', 'crossing', 'punish']) test(`real ${type} turn preserves mesh, floor and combat-facing (${facing})`, t => {
  const data = buildTurnCase(type, facing), robots = [createRobot(), createRobot({ skin: 'cyan' })];
  assert.equal(data.turns.length, 2, 'real inputs must cross both fighters');
  let previous, previousWorld, maxStep = 0, maxYawStep = 0, priorYaw, maxStanceDrift = 0, checkedAttack = 0, maxUrgentStep = 0;
  const priorRobotYaw = [], priorActions = [];
  for (let frame = 0; frame < data.snapshots.length; frame++) {
    const state = data.snapshots[frame];
    robots.forEach((robot, i) => update(robot, state.players[i], state.players[1-i], 1 / 60, frame / 60));
    const p = state.players[0], current = feet(robots[0]), yaw = robots[0].group.children[0].rotation.y;
    const start = data.turns.find(turn => turn.id === 'p1').frame;
    if (frame >= start && frame <= start + 50 && previous) {
      const largest = Math.max(...current.map((foot, i) => foot.clone().sub(robots[0].group.position).distanceTo(previous[i])));
      maxStep = Math.max(maxStep, largest);
      maxYawStep = Math.max(maxYawStep, Math.abs(yaw - priorYaw));
      if (type === 'back' && frame > start + 1 && frame < start + 44) {
        const movement = current.map((foot, i) => foot.distanceTo(previousWorld[i])).sort((a,b)=>a-b);
        maxStanceDrift = Math.max(maxStanceDrift, movement[1]);
      }
    }
    if (frame % 6 === 0) robots.forEach(robot => assert.ok(bounds(robot).min.y >= -.0001, 'original articulated surfaces clear the floor'));
    for (let i=0;i<2;i++) if (['light','heavy'].includes(state.players[i].action) && frame > start && type === 'punish') {
      const aim = state.players[i].facing * (Math.PI / 2 - .45);
      const attackYaw = robots[i].group.children[0].rotation.y;
      if(priorActions[i]!==state.players[i].action)assert.ok(Math.abs(attackYaw-priorRobotYaw[i])<.001,'first startup frame retains its observed direction');
      if(state.players[i].actionTime >= turnStartup(state.players[i])-.012)
        assert.ok(Math.abs(attackYaw - aim) < .001, 'urgent turn finishes before authoritative active time');
      maxUrgentStep=Math.max(maxUrgentStep,Math.abs(attackYaw-priorRobotYaw[i]));
      checkedAttack++;
    }
    for(let i=0;i<2;i++){priorRobotYaw[i]=robots[i].group.children[0].rotation.y;priorActions[i]=state.players[i].action;}
    previousWorld = current.map(foot => foot.clone());
    previous = current.map(foot => foot.sub(robots[0].group.position)); priorYaw = yaw;
  }
  t.diagnostic(JSON.stringify({ maxStep, maxYawStep, maxStanceDrift, maxUrgentStep }));
  assert.ok(maxStep < .32, 'turning toes cannot pop between render frames');
  assert.ok(maxYawStep < .22, 'turn cannot complete as a one-frame rigid spin');
  if(type==='back')assert.ok(maxStanceDrift < .06,'at least two original toes must carry weight without sliding');
  if(type==='punish'){
    assert.ok(checkedAttack > 5,'the replay must exercise an actual attack during the turn');
    assert.ok(maxUrgentStep<.45,'jab startup distributes its urgent reversal across frames instead of snapping');
  }
  robots.forEach(robot => robot.dispose());
});

test('pause, interrupted reversal, late join and seek are coherent at 30/60/120 Hz', t => {
  const samples = [];
  for (const fps of [30,60,120]) {
    const robot = createRobot(); let maxStep = 0, previous;
    for (let frame = 0; frame <= fps; frame++) {
      const time = frame / fps, p = { action:'idle',actionTime:time,x:0,y:0,facing:time < .2 ? 1 : time < .4 ? -1 : 1,hp:100 };
      update(robot,p,null,1/fps,time);
      const current = feet(robot);
      if(previous)maxStep=Math.max(maxStep,...current.map((foot,i)=>foot.distanceTo(previous[i])));
      previous=current;
      if(frame===Math.round(fps*.5)){
        // First paused call is allowed to settle the ordinary body springs;
        // subsequent calls must preserve every articulated foot exactly.
        update(robot,p,null,0,time,{visualPaused:true});const stopped=feet(robot);
        for(let i=0;i<5;i++)update(robot,p,null,0,time,{visualPaused:true});
        feet(robot).forEach((foot,i)=>assert.ok(foot.distanceTo(stopped[i])<1e-9));
      }
    }
    t.diagnostic(`reversal ${fps}: ${maxStep}`); assert.ok(maxStep<.45,`reversal discontinuity at ${fps} Hz`);
    const late=createRobot();update(late,{action:'idle',actionTime:.6,x:0,y:0,facing:-1},null,1/fps,.6);
    assert.equal(late.group.children[0].rotation.y,-(Math.PI/2-.45),'late observation has no invented turn history');
    update(robot,{action:'idle',actionTime:.1,x:0,y:0,facing:-1},null,1/fps,.1,{visualSeekToken:1});
    assert.equal(robot.group.children[0].rotation.y,-(Math.PI/2-.45),'seek resets the previous direction');
    samples.push({fps,maxStep});robot.dispose();late.dispose();
  }
  t.diagnostic(JSON.stringify(samples));
});

test('real back throw and reduced motion retain grounded support at 30/60/120 render Hz', t => {
  const data = buildTurnCase('back'), finalFeet = [], metrics = [];
  for(const reduced of [false,true])for(const fps of [30,60,120]){
    const robot=createRobot();let previous,maxStep=0;
    for(let n=0;n<=fps*3;n++){
      const time=n/fps,frame=Math.min(data.snapshots.length-1,Math.floor(time*60+1e-7));
      const s=data.snapshots[frame],p={...s.players[0],actionTime:s.players[0].actionTime+time-frame/60};
      update(robot,p,s.players[1],1/fps,time,{visualReducedMotion:reduced});
      const current=feet(robot);
      if(previous&&time>1.84&&time<2.65)maxStep=Math.max(maxStep,...current.map((foot,i)=>foot.distanceTo(previous[i])));
      if(n%10===0)assert.ok(bounds(robot).min.y>=-.0001);
      previous=current;
    }
    assert.ok(maxStep*fps/60<.36,'render rate must not create a faster one-frame toe sweep');
    finalFeet.push(feet(robot));metrics.push({fps,reduced,maxStepPer60:maxStep*fps/60});robot.dispose();
  }
  for(const sample of finalFeet.slice(1))sample.forEach((foot,i)=>assert.ok(foot.distanceTo(finalFeet[0][i])<.02,'new stance agrees across render rates and motion modes'));
  t.diagnostic(JSON.stringify(metrics));
});

test('moving ground fighter keeps two world supports during an actual crossing', t => {
  const data=buildTurnCase('crossing'),robot=createRobot({skin:'cyan'}),start=data.turns.find(turn=>turn.id==='p2').frame;
  let prior,maxSupportDrift=0,maxStep=0,renderX=data.snapshots[0].players[1].x;
  for(let frame=0;frame<data.snapshots.length;frame++){
    const s=data.snapshots[frame],priorX=renderX;renderX+=(s.players[1].x-renderX)*(1-Math.exp(-23/60));
    const p={...s.players[1],x:renderX};update(robot,p,s.players[0],1/60,frame/60);const current=feet(robot);
    if(prior&&frame>start+1&&frame<start+43){
      const movement=current.map((foot,i)=>foot.distanceTo(prior[i])).sort((a,b)=>a-b);
      // Forced separation translates the stance with the chassis. Normal
      // walking must retain two contacts; collision displacement is not gait.
      if(Math.abs(renderX-priorX)<=.12)maxSupportDrift=Math.max(maxSupportDrift,movement[1]);
      maxStep=Math.max(maxStep,movement[3]);
    }
    if(frame%6===0)assert.ok(bounds(robot).min.y>=-.0001);prior=current;
  }
  t.diagnostic(JSON.stringify({maxSupportDrift,maxStep}));
  assert.ok(maxStep<.53,'collision recovery must not sweep a whole leg across the robot in one frame');
  assert.ok(maxSupportDrift<.08,'moving root must not drag every supporting foot along the floor');
  robot.dispose();
});
