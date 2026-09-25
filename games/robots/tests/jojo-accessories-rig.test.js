import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,properties){Object.assign(this,properties);}};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);
const base={facing:1,x:0,y:0,hp:180,maxHp:180,energy:100,guard:100};
const poses=[
  {action:'idle',actionDuration:1},
  {action:'faceoff',variant:'reactor',actionDuration:3.5},
  {action:'faceoff',variant:'challenge',actionDuration:2.2},
  {action:'faceoff',variant:'point',actionDuration:2.2},
  {action:'special',variant:'shockwave',actionDuration:.9},
  {action:'heavy',variant:'crusher',actionDuration:.75},
  {action:'ko',actionDuration:2.4,hp:0},
  {action:'recover',actionDuration:1.5},
];

for(const accessory of['clubCap','heartBand'])test(`${accessory}: real tilted turret, front/three-quarter signals, bounded resources and both facings`,t=>{
  const robot=createRobot(),rays=new THREE.Raycaster(),direction=new THREE.Vector3(),point=new THREE.Vector3();
  let minY=Infinity,maxY=-Infinity,rayCount=0;
  try {
    let node,turret;
    for(const facing of[-1,1])for(const pose of poses)for(let i=0;i<=12;i++) {
      const actionTime=pose.actionDuration*i/12;
      robot.update({...base,...pose,actionTime,facing,customization:{accessory}},1/60,actionTime);
      robot.group.updateMatrixWorld(true);
      node=robot.group.getObjectByName(`RobotAccessory_${accessory}`);turret=node.parent.parent;
      assert.equal(turret.name,'turret');
      const bounds=new THREE.Box3().setFromObject(node);
      minY=Math.min(minY,bounds.min.y);maxY=Math.max(maxY,bounds.max.y);
      assert.ok(bounds.min.y>.4&&bounds.max.y<3.3,'attachment cannot touch floor or exceed existing crown/head envelope');
      const anchors=robot.getCombatAnchors();
      for(const name of['head','muzzle','core'])for(const side of[-.28,0,.28])for(const elevation of[0,.22,.4]) {
        direction.set(side,elevation,1).transformDirection(turret.matrixWorld);
        point.copy(anchors[name]).addScaledVector(direction,8);
        rays.set(point,direction.clone().negate());rays.far=7.99;
        assert.equal(rays.intersectObject(node,true).length,0,`${accessory} cannot obscure ${name}: facing${facing} ${pose.action}/${actionTime}`);
        rayCount++;
      }
    }
    assert.ok(node.children.length<=3,'materials are merged into a small fixed mesh set');
    let triangles=0;
    for(const mesh of node.children) {
      assert.ok(mesh.isMesh&&mesh.material.isMeshStandardMaterial&&mesh.material.toneMapped);
      assert.equal(mesh.material.emissive.getHex(),0,'accessory is lit by the room, never self-lit');
      assert.ok(mesh.castShadow&&mesh.receiveShadow);
      triangles+=mesh.geometry.attributes.position.count/3;
    }
    assert.ok(triangles<5000,`bounded accessory geometry: ${triangles}`);
    t.diagnostic(JSON.stringify({accessory,triangles,meshes:node.children.length,minY,maxY,rayCount}));
  } finally { robot.dispose(); }
});
