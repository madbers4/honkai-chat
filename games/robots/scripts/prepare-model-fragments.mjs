// Editable rigid-piece trajectories from exactly the runtime original meshes.
import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,p){this.type=type;Object.assign(this,p);}};
const bytes=await fs.readFile('public/assets/automaton.glb');
GLTFLoader.prototype.loadAsync=function(){return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');await loadRobotAssets();
const library={fps:30,description:'Every fragment contains supplied rigid-weighted triangles. Matrices are runtime world transforms, deterministic 120 Hz contact integration.',meshes:[],clips:[]};
const values=array=>Array.from(array,n=>Number(n.toFixed(7)));
for(const variant of ['overload','coreRip','brutality']){
 const robot=createRobot({skin:'cyan'});
 for(let frame=0;frame<=129;frame++)robot.update({action:'defeated',variant,hp:0,facing:-1,grabPartnerX:-2.1,actionTime:frame/60,actionDuration:3.7},1/60,frame/60);
 robot.update({action:'destroyed',variant,hp:0,facing:-1,destructionTime:0},1/60,2.15);
 const pieces=[];robot.group.traverse(mesh=>{if(mesh.userData.originalRobotFragment)pieces.push(mesh);});
 if(!library.meshes.length)library.meshes=pieces.map(mesh=>({name:mesh.name,material:mesh.material.name,position:values(mesh.geometry.attributes.position.array),normal:values(mesh.geometry.attributes.normal.array),uv:values(mesh.geometry.attributes.uv.array)}));
 const frames=[];
 for(let frame=0;frame<=120;frame++){
  robot.update({action:'destroyed',variant,hp:0,facing:-1,destructionTime:frame/30},1/30,2.15+frame/30);
  frames.push(pieces.map(mesh=>values(mesh.matrixWorld.elements)));
 }
 library.clips.push({name:variant,frames});robot.dispose();
}
await fs.writeFile('assets-source/combat-fragment-library.json',JSON.stringify(library));
console.log(`Saved ${library.meshes.length} original fragments and ${library.clips.length} editable destruction takes.`);
