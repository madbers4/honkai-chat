import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { ACCESSORIES } from '../shared/robot-customization.js';
import { frameCustomizationPreview } from '../src/customization-preview.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,properties){Object.assign(this,properties);}};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);
const base={action:'idle',actionTime:0,facing:1,x:0,y:0,hp:180,maxHp:180,energy:100,guard:100};
const armor=robot=>{let result;robot.group.traverse(mesh=>{if(mesh.isSkinnedMesh&&!mesh.material.userData.signalChannel)result=mesh.material;});return result;};
const shader=material=>{const result={uniforms:{},fragmentShader:'#include <map_fragment>\n#include <metalnessmap_fragment>'};material.onBeforeCompile(result);return result;};
const bones=robot=>{const result=[];robot.group.traverse(o=>{if(o.isBone)result.push([o.name,...o.position.toArray(),...o.quaternion.toArray()]);});return result;};

test('two real robots keep independent enamel, actual core light and HP signals',()=>{
  const a=createRobot(),b=createRobot({skin:'cyan'}),ma=armor(a),mb=armor(b);
  const texture=ma.map,normal=ma.normalMap,metal=ma.metalnessMap;
  a.update({...base,customization:{body:'ruby',core:'violet',accessory:'crown'}});
  b.update({...base,customization:{body:'jade',core:'rose',accessory:'mustache'}});
  const sa=shader(ma),sb=shader(mb);
  assert.notEqual(sa.uniforms.robotPaint,sb.uniforms.robotPaint);
  assert.notDeepEqual(sa.uniforms.robotPaint.value.toArray(),sb.uniforms.robotPaint.value.toArray());
  assert.equal(ma.map,texture);assert.equal(ma.normalMap,normal);assert.equal(ma.metalnessMap,metal);
  assert.equal(sa.uniforms.robotPaintEnabled.value,1);
  const light=a.group.getObjectByName('OriginalReactor_Spill');assert.equal(light.color.getHexString(),'b48aff');assert.ok(light.intensity>0);
  const health=a.group.getObjectByName('OriginalLens_Spill').color.getHex();
  a.update({...base,customization:{body:'copper',core:'lime',accessory:'crown'}});
  assert.equal(a.group.getObjectByName('OriginalLens_Spill').color.getHex(),health,'custom reactor never recolours health lamp');
  assert.equal(b.group.getObjectByName('OriginalReactor_Spill').color.getHexString(),'ff689c');
  const hpColors=new Set();
  for(const hp of[180,90,30]){
    a.update({...base,hp,customization:{core:'lime'}},1/60,1);
    b.update({...base,hp,customization:{core:'rose'}},1/60,1);
    const aSignal=a.group.getObjectByName('OriginalLens_Spill').color.getHex();
    assert.equal(aSignal,b.group.getObjectByName('OriginalLens_Spill').color.getHex());hpColors.add(aSignal);
  }
  assert.equal(hpColors.size,3,'green, amber and red HP bands remain distinct with any custom core');
  const before=sa.uniforms.robotPaint.value.clone();b.dispose();assert.ok(sa.uniforms.robotPaint.value.equals(before));
  a.update(base);assert.equal(sa.uniforms.robotPaintEnabled.value,0,'missing customization restores original authored surface');
  a.dispose();
});

test('wreck material clones retain the chosen enamel without sharing other robots',()=>{
  const robot=createRobot();robot.update({...base,customization:{body:'ruby'}});
  const material=armor(robot),copy=material.clone(),second=copy.clone();
  const originalShader=shader(material),copyShader=shader(copy),secondShader=shader(second);
  assert.equal(copyShader.uniforms.robotPaint,originalShader.uniforms.robotPaint);
  assert.equal(secondShader.uniforms.robotPaint,originalShader.uniforms.robotPaint);
  assert.equal((secondShader.fragmentShader.match(/uniform vec3 robotPaint;/g)||[]).length,1);
  copy.dispose();second.dispose();robot.dispose();
});

test('each attachment follows turret; customization never changes rig or network state',()=>{
  const original=createRobot(),dressed=createRobot();
  for(const accessory of ACCESSORIES){
    const player={...base,action:'special',variant:'shockwave',actionTime:.23,actionDuration:.90,customization:{body:'ivory',core:'cyan',accessory:accessory.id}};
    const before=structuredClone(player);
    original.update({...player,customization:undefined},1/60,.23);dressed.update(player,1/60,.23);
    assert.deepEqual(player,before);assert.deepEqual(bones(dressed),bones(original));
    assert.deepEqual(dressed.group.position.toArray(),[0,0,0]);
    if(accessory.id!=='none'){
      const node=dressed.group.getObjectByName(`RobotAccessory_${accessory.id}`);
      assert.equal(node.parent.parent.name,'turret');assert.equal(node.visible,true);
      node.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(node);
      assert.ok(bounds.min.y>.1,`${accessory.id} clears the floor`);assert.ok(bounds.max.y<4.5,`${accessory.id} stays proportionate`);
      const world=new THREE.Vector3();node.getWorldPosition(world);assert.ok(world.toArray().every(Number.isFinite));
    }
  }
  original.dispose();dressed.dispose();
});

test('round KO preserves the trophy; final destruction hides it; reboot restores it',()=>{
  const robot=createRobot(),customization={body:'cobalt',core:'lime',accessory:'topHat'};
  for(let i=0;i<90;i++)robot.update({...base,action:'ko',actionTime:i/60,hp:0,customization},1/60,i/60);
  const node=robot.group.getObjectByName('RobotAccessory_topHat'),mount=node.parent;
  assert.ok(mount.visible&&node.visible);
  robot.update({...base,action:'destroyed',actionTime:.6,destructionTime:.6,hp:0,customization},1/60,.6);
  assert.equal(mount.visible,false,'no floating trophy after original model has fractured');
  assert.equal(robot.group.getObjectByName('OriginalReactor_Spill').intensity,0);
  robot.update({...base,action:'recover',actionTime:.6,customization},1/60,.6);assert.equal(mount.visible,true);
  assert.equal(node.parent.parent.name,'turret');robot.dispose();
});

test('reduced motion fixes the propeller, paused cosmetics still respond, disposal is idempotent',()=>{
  const robot=createRobot();let now=0;
  for(let pass=0;pass<3;pass++)for(const item of ACCESSORIES){now+=.1;robot.update({...base,customization:{accessory:item.id}},1/60,now);}
  const mount=robot.group.getObjectByName('RobotCustomization_Mount');assert.equal(mount.children.length,ACCESSORIES.length-1,'bounded lazy cache of catalogue attachments');
  const player={...base,visualPaused:true,visualReducedMotion:true,customization:{body:'ruby',core:'violet',accessory:'propeller'}};
  robot.update(player,0,10);const rotor=robot.group.getObjectByName('AccessoryPropeller_Rotor'),stopped=rotor.rotation.y;
  robot.update(player,0,20);assert.equal(rotor.rotation.y,stopped);
  robot.update({...player,customization:{...player.customization,core:'rose'}},0,20);
  assert.equal(robot.group.getObjectByName('OriginalReactor_Spill').color.getHexString(),'ff689c');
  const resources=new Set();mount.traverse(node=>{if(node.geometry)resources.add(node.geometry);if(node.material){resources.add(node.material);if(node.material.alphaMap)resources.add(node.material.alphaMap);}});
  const count=new Map([...resources].map(resource=>[resource,0]));resources.forEach(resource=>resource.addEventListener('dispose',()=>count.set(resource,count.get(resource)+1)));
  robot.dispose();robot.dispose();assert.equal(mount.parent,null);
  for(const times of count.values())assert.equal(times,1,'every live accessory GPU resource is released once');
});

test('every actual trophy and toe fits a full turn in desktop, phone and 300px embedded preview',t=>{
  const robot=createRobot(),camera=new THREE.PerspectiveCamera(35,1,.05,40),point=new THREE.Vector3();
  let minY=1,maxY=-1,maxX=0;
  for(const [width,height]of[[528,530],[395,378],[440,300]]){
    frameCustomizationPreview(camera,width,height);
    for(const accessory of ACCESSORIES){
      robot.update({...base,customization:{accessory:accessory.id}},1/60,0);
      for(let turn=0;turn<12;turn++){
        robot.group.rotation.y=turn*Math.PI/6;robot.group.updateMatrixWorld(true);
        robot.group.traverseVisible(mesh=>{
          if(!mesh.isMesh||(!mesh.isSkinnedMesh&&!mesh.parent?.name.startsWith('RobotAccessory_')&&mesh.parent?.name!=='AccessoryPropeller_Rotor'))return;
          for(let i=0;i<mesh.geometry.attributes.position.count;i++){
            mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).project(camera);
            minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);maxX=Math.max(maxX,Math.abs(point.x));
          }
        });
      }
    }
  }
  t.diagnostic(JSON.stringify({minY,maxY,maxX}));robot.dispose();
  assert.ok(maxX<.95,'side clearance for all rotations');
  assert.ok(minY>-.75,'lower toes clear the rotation controls');
  assert.ok(maxY<.95,'tallest trophy clears the roof');
});
