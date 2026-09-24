import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { reviewCases, sampleReview } from './prepare-model-v5-cases.mjs';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,p){this.type=type;Object.assign(this,p);}};
const bytes=await fs.readFile('public/assets/automaton.glb');
GLTFLoader.prototype.loadAsync=function(){return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');await loadRobotAssets();
const point=new THREE.Vector3(),normal=new THREE.Vector3(),matrix=new THREE.Matrix4(),nm=new THREE.Matrix3();
const round=n=>Number(n.toFixed(6));
const shots=[];
for(const scenario of reviewCases)for(const facing of (['grab','pummelOne','coreRip'].includes(scenario.name)?[1,-1]:[1])){
 const robots=[createRobot(),createRobot({skin:'cyan'})];
 for(let frame=0;frame<=Math.ceil(scenario.contact*60);frame++){
  const time=Math.min(scenario.contact,frame/60),states=sampleReview(scenario.name,time,facing);
  robots.forEach((robot,i)=>{robot.group.position.set(states[i].x,states[i].y,0);robot.update(states[i],1/60,time);});
 }
 const meshes=[],lights=[];
 robots.forEach(robot=>robot.group.traverse(mesh=>{
  let visible=true;for(let parent=mesh;parent;parent=parent.parent)if(!parent.visible)visible=false;
  if(!visible)return;
  if(mesh.isLight){lights.push({type:mesh.isSpotLight?'spot':'point',position:mesh.getWorldPosition(new THREE.Vector3()).toArray(),target:mesh.target?.getWorldPosition(new THREE.Vector3()).toArray(),color:mesh.color.toArray(),intensity:mesh.intensity,distance:mesh.distance,angle:mesh.angle});return;}
  if(!mesh.isMesh||!mesh.geometry.attributes.uv||mesh.material.transparent)return;
  const positions=[],normals=[],uvs=[];const geometry=mesh.geometry;
  for(let i=0;i<geometry.attributes.position.count;i++){
   if(mesh.isSkinnedMesh){mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);const joint=geometry.attributes.skinIndex.getX(i);matrix.multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld,mesh.skeleton.boneInverses[joint]).multiply(mesh.bindMatrix);nm.getNormalMatrix(matrix);}
   else{point.fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);nm.getNormalMatrix(mesh.matrixWorld);}
   normal.fromBufferAttribute(geometry.attributes.normal,i).applyMatrix3(nm).normalize();
   positions.push(...point.toArray().map(round));normals.push(...normal.toArray().map(round));uvs.push(geometry.attributes.uv.getX(i),geometry.attributes.uv.getY(i));
  }
  meshes.push({name:mesh.name,material:mesh.material.name,positions,normals,uvs,indices:geometry.index?Array.from(geometry.index.array):null,color:mesh.material.color.toArray(),emissive:mesh.material.emissive?.toArray()||[0,0,0],intensity:mesh.material.emissiveIntensity||0});
 }));
 shots.push({name:scenario.name+(facing===-1?'-reverse':''),time:scenario.contact,meshes,lights});robots.forEach(robot=>robot.dispose());
}
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/robot-v5-contact-poses.json',JSON.stringify(shots));
// Measure preparation separately from the pressure-release beat.
const robot=createRobot();let start=performance.now();robot.update({action:'defeated',variant:'offer',hp:0},1/60,0);const prepareMs=performance.now()-start;
for(let frame=0;frame<=129;frame++)robot.update({action:'defeated',variant:'overload',hp:0,actionTime:frame/60,actionDuration:3.7},1/60,frame/60);
start=performance.now();robot.update({action:'destroyed',variant:'overload',destructionTime:0,hp:0},1/60,2.15);const explosionMs=performance.now()-start;
robot.dispose();console.log(JSON.stringify({snapshots:shots.length,prepareMs,explosionMs}));
