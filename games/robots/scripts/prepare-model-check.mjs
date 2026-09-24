// Offline geometry/animation validation. Texture decoding is irrelevant to this
// numeric check; native Blender and the browser QA page verify actual materials.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const data = await fs.readFile('public/assets/automaton.glb');
const originalLoad = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),''); };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await loadRobotAssets();
GLTFLoader.prototype.loadAsync = originalLoad;
const a = createRobot({skin:'amber'});
const b = createRobot({skin:'cyan'});
const cases = ['idle','walk','jump','crouch','light','heavy','dash','block','special','ultimate','hit','ko','victory'];
const report=[];
let bones=0;
a.group.traverse(o=>{if(o.isBone)bones++;if(o.isSkinnedMesh){const s=o.geometry.attributes.skinWeight;for(let i=0;i<s.count;i++)assert.equal(s.getX(i)+s.getY(i)+s.getZ(i)+s.getW(i),1);}});
assert.equal(bones,22);
for(const action of cases){
  const start=performance.now();
  for(let frame=0;frame<90;frame++){
    const p=frame/90;
    const player={action,actionTime:p,actionDuration:1,vx:action==='walk'?2.3:0,vy:action==='jump'?3-6*p:0,y:action==='jump'?Math.sin(p*Math.PI):0,facing:1,combo:1};
    a.group.position.x=action==='walk'?frame*.035:0;
    a.update(player,1/60,frame/60);
    b.update({...player,facing:-1},1/60,frame/60);
    for(const robot of [a,b]){
      robot.group.updateMatrixWorld(true);
      robot.group.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite),`${action}: nonfinite transform`);if(o.isSkinnedMesh)o.skeleton.update();});
    }
  }
  const box=new THREE.Box3().setFromObject(a.group,true);
  const size=box.getSize(new THREE.Vector3());
  assert.ok(size.x>1&&size.x<7&&size.y>.25&&size.y<4.5&&size.z>1&&size.z<7,`${action}: exploded or collapsed bounds ${size.toArray()}`);
  report.push({action,meanMsForTwoRobots:Number(((performance.now()-start)/90).toFixed(2)),size:size.toArray().map(x=>Number(x.toFixed(2)))});
}
a.dispose();b.dispose();
console.log(JSON.stringify({glbBytes:data.length,joints:bones,actions:report},null,2));
