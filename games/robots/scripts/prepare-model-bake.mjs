// Bake the exact runtime FK result of CCD/secondary motion for Blender editing.
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
globalThis.ProgressEvent=class{constructor(type,p){this.type=type;Object.assign(this,p);}};
const bytes=await fs.readFile('public/assets/automaton.glb');
GLTFLoader.prototype.loadAsync=function(){return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const {loadRobotAssets,createRobot}=await import('../src/robot.js');
const template=await loadRobotAssets();
const rest={};template.traverse(o=>{if(o.isBone)rest[o.name]={q:o.quaternion.clone(),p:o.position.clone()};});
const fps=30;
const durations={idle:2,walk:1,jump:.8,crouch:.8,light:.34,heavy:.81,dash:.3,block:1,special:.72,ultimate:1.8,hit:.32,ko:1.8,victory:2};
const clips=[...Object.entries(durations).map(([action,duration])=>({name:action,action,duration})),
  {name:'dashStrike',action:'light',variant:'dashStrike',duration:.48},
  {name:'launcher',action:'heavy',variant:'launcher',duration:.86},
  {name:'slam',action:'heavy',variant:'slam',duration:.86},
  {name:'shockwave',action:'special',variant:'shockwave',duration:.88},
  {name:'bolt',action:'special',variant:'bolt',duration:.72},
  {name:'overload',action:'ultimate',variant:'overload',duration:1.8},
  {name:'grab',action:'heavy',variant:'grab',duration:1.70},
  {name:'grabWhiff',action:'heavy',variant:'grab',duration:.95},
  {name:'grabbed',action:'hit',variant:'grabbed',duration:.30},
  {name:'thrown',action:'hit',variant:'thrown',duration:.48},
  {name:'grabBreak',action:'hit',variant:'grabBreak',duration:.25},
  {name:'burst',action:'special',variant:'burst',duration:.50},
  {name:'burstAir',action:'special',variant:'burst',duration:.50},
  {name:'feint',action:'dash',variant:'feint',duration:.30},
  {name:'idleDamaged',action:'idle',hp:45,duration:4.8},
  {name:'idleCritical',action:'idle',hp:18,duration:4.8},
  {name:'walkDamaged',action:'walk',hp:45,duration:1.4},
  {name:'walkCritical',action:'walk',hp:18,duration:1.4},
  {name:'healthRecovery',action:'idle',hp:100,setupHp:18,duration:2},
  {name:'guardBreak',action:'hit',variant:'guardBreak',hp:45,duration:.95},
  {name:'burstRepelled',action:'hit',variant:'burstRepelled',duration:.32},
  {name:'parried',action:'hit',variant:'parried',duration:.34},
  {name:'launched',action:'hit',variant:'launched',duration:.48},
  ...Object.entries({jab:.38,cross:.49,rake:.68,crusher:1.02,airJab:.30,airCross:.36,airFinish:.48}).map(([variant,duration])=>({name:variant,action:variant==='crusher'?'heavy':'light',variant,duration})),
  {name:'airDash',action:'dash',variant:'airDash',duration:.18},
  {name:'land',action:'land',duration:.16},
  {name:'recover',action:'recover',duration:1.6},
  {name:'powerUp',action:'recover',duration:.75},
  ...[1,2].flatMap(strike=>[{name:'grabPummel'+strike,action:'heavy',variant:'grab',duration:.30},{name:'caughtPummel'+strike,action:'hit',variant:'grabbed',duration:.30}]),
  {name:'throwBack',action:'heavy',variant:'grab',duration:.50},
  {name:'thrownBack',action:'hit',variant:'thrown',duration:.65},
  ...['coreRip','overload','brutality'].flatMap(type=>[{name:'finisher'+type[0].toUpperCase()+type.slice(1),action:'finisher',variant:type,duration:2.15},{name:'defeated'+type[0].toUpperCase()+type.slice(1),action:'defeated',variant:type,duration:2.15,hp:0}])];
const result={fps,description:'Baked from the real src/robot.js controller; bone-local quaternion deltas from bind pose.',clips:[]};
for(const {name,action,variant='',duration,hp=100,setupHp=hp} of clips){
  const robot=createRobot();
  for(let f=0;f<60;f++)robot.update({action:'idle',hp:setupHp},1/60,0);
  if(name==='recover')for(let f=0;f<120;f++)robot.update({action:'ko',hp:0,actionTime:f/60},1/60,f/60);
  if(name.includes('Pummel')||name==='throwBack')for(let f=0;f<30;f++)robot.update({action:name.startsWith('caught')?'hit':'heavy',variant:name.startsWith('caught')?'grabbed':'grab',actionTime:.26+f/60,grabTarget:'p2',grabbedBy:name.startsWith('caught')?'p2':null,grabHoldTime:f/60,grabPartnerX:2.1,facing:1},1/60,f/60);
  const signalMaterials={};
  robot.group.traverse(o=>{if(o.isSkinnedMesh&&o.material.userData.signalChannel)signalMaterials[o.material.userData.signalChannel]=o.material;});
  if(['thrown','grabBreak','burst','burstAir','feint'].includes(name))for(let f=0;f<12;f++){
    const prior=name==='feint'?'heavy':'hit';
    const priorVariant=['thrown','grabBreak'].includes(name)?'grabbed':'';
    robot.group.position.y=name==='burstAir'?1.2:0;
    robot.update({action:prior,variant:priorVariant,actionTime:f/60,actionDuration:prior==='heavy'?.81:.34,y:robot.group.position.y,facing:1,grabHoldTime:f/60},1/60,f/60);
  }
  const frames=[];
  const signals=[];
  const extraction=[];
  const roots=[];
  const count=Math.ceil(duration*fps)+1;
  for(let f=0;f<count;f++){
    const t=f/fps;
    const y=variant.startsWith('air')?1.25:variant==='slam'?Math.max(0,(.44-t)*4.1):action==='jump'?Math.sin(Math.min(t/duration,1)*Math.PI)*1.5:name==='burstAir'?1.2:name==='thrown'?Math.max(0,3.4*t-12*t*t):name==='thrownBack'?Math.max(0,12*t-12*t*t):variant==='launched'?Math.max(0,9.3*t-12*t*t):0;
    robot.group.position.x=action==='walk'?t*2.3:variant==='feint'?-4.8*Math.min(t,.20):0;
    robot.group.position.y=y;
    const pairedStrike=t>=.90&&t<=1.20?t-.90:t>=.54&&t<=.84?t-.54:null;
    const pairing=name==='grab'?{grabTarget:t>=.26&&t<1.40?'p2':null,grabHoldTime:Math.max(0,t-.26),grabCatchTime:t>=.26?.26:null,grabReleaseTime:t>=1.40?1.40:null,grabPartnerX:2.1,grabPartnerY:0,grabStrikeTime:pairedStrike,grabStrikes:t>=.9?2:t>=.54?1:0,grabThrowTime:t>=1.20&&t<1.40?t-1.20:null}:name==='grabbed'?{grabbedBy:'p1',grabHoldTime:t}:{};
    if(name.includes('Pummel'))Object.assign(pairing,{actionTime:.54+t,grabTarget:name.startsWith('grab')?'p2':null,grabbedBy:name.startsWith('caught')?'p2':null,grabHoldTime:.28+t,grabStrikeTime:t,grabStrikes:Number(name.at(-1)),grabPartnerX:2.1});
    if(name==='throwBack')Object.assign(pairing,{actionTime:1.20+t,grabTarget:t<.20?'p2':null,grabHoldTime:.94+t,grabThrowTime:t<.2?t:null,grabReleaseTime:t>=.20?1.4:null,throwStyle:'back',grabPartnerX:2.1});
    if(name==='thrownBack')Object.assign(pairing,{throwStyle:'back'});
    if(['finisher','defeated'].includes(action))Object.assign(pairing,{grabPartnerX:2.1,grabPartnerY:0});
    robot.update({action,variant,hp,guard:variant==='guardBreak'?0:100,actionTime:t,actionDuration:duration,facing:1,combo:1,vx:action==='walk'?2.3:variant==='feint'&&t<.2?-4.8:0,y,vy:action==='jump'?5-10*t/duration:0,landedTime:variant==='slam'&&t>=.44?.44:null,...pairing},1/fps,t);
    const pose={};
    robot.group.traverse(o=>{if(o.isBone&&!o.name.endsWith('_tip')){
      const q=rest[o.name].q.clone().invert().multiply(o.quaternion);
      pose[o.name]={q:q.toArray().map(n=>Number(n.toFixed(7)))};
      if(o.name==='chassis'){
        const displacement=o.position.clone().sub(rest[o.name].p);
        // Contact correction belongs to the visual model root in the browser;
        // carry it into the source root bone so the baked KO is grounded too.
        displacement.y+=robot.group.children[0].children[0].position.y;
        pose[o.name].p=displacement.toArray().map(n=>Number(n.toFixed(7)));
      }
    }});
    frames.push(pose);
    signals.push(Object.fromEntries(Object.entries(signalMaterials).map(([channel,material])=>[channel,{color:material.emissive.toArray().map(n=>Number(n.toFixed(7))),intensity:material.emissiveIntensity}])));
    const core=robot.group.getObjectByName('OriginalReactor_Extraction');
    const shift=core.getWorldPosition(new THREE.Vector3()).sub(core.parent.getWorldPosition(new THREE.Vector3()));
    // Undo the arena turntable, leaving a model-space offset for Blender.
    shift.applyQuaternion(robot.group.children[0].quaternion.clone().invert());
    extraction.push(shift.toArray());roots.push({x:robot.group.position.x,y});
  }
  result.clips.push({name,action,variant,hp,duration,frames,signals,extraction,roots});
  robot.dispose();
}
await fs.writeFile('assets-source/combat-animation-library.json',JSON.stringify(result));
console.log(`Baked ${result.clips.length} combat clips at ${fps} fps.`);
