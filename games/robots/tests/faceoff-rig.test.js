import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { CombatRoom } from '../server/combat.js';
import { buildFaceoff, activeFaceoffBeat, FACE_OFF_DURATION, faceoffActorPose } from '../shared/faceoff-script.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');await withRobotAssetFixture(loadRobotAssets);
function bounds(robot){robot.group.updateMatrixWorld(true);const box=new THREE.Box3(),point=new THREE.Vector3();robot.group.traverse(mesh=>{if(!mesh.isSkinnedMesh||!mesh.visible)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);assert.ok(point.toArray().every(Number.isFinite));box.expandByPoint(point);}});return box;}
for(const facing of [-1,1])test(`actual faceoff rig stays planted and upright throughout all timed poses (${facing})`,t=>{
  const robot=createRobot();t.after(()=>robot.dispose());const room=new CombatRoom({id:'ACTING'});room.addPlayer('Сом');room.addPlayer('Барон');const players=room.snapshot().players,beats=buildFaceoff(players,8);
  for(let frame=0;frame<FACE_OFF_DURATION*30;frame++){
    const elapsed=frame/30,beat=activeFaceoffBeat(beats,elapsed);
    robot.update({...players[0],facing,action:'faceoff',variant:faceoffActorPose(beat,players[0].id),actionTime:elapsed-beat.at,actionDuration:beat.duration},1/30,elapsed);
    if(frame%7===0){const box=bounds(robot);assert.ok(box.min.y>=-.001,`pose ${beat.pose} t=${elapsed}: ${box.min.y} below floor`);assert.ok(box.max.y-box.min.y>1.9,'upright silhouette');assert.ok(robot.getContactShadow().height<.09,'gesture does not make the machine float');}
  }
});
