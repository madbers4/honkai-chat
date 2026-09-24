import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFaceoff, FACE_OFF_DURATION } from '../shared/faceoff-script.js';
import { projectCameraPoint, createCameraChoreography } from '../src/camera-choreography.js';
import { computeFaceoffCamera, blendFaceoffCamera, faceoffFramingPoints, FACEOFF_SAFE_FRAME } from '../src/faceoff-camera.js';

function playersAt(elapsed) {
  const separation=3.6-1.75*Math.min(1,Math.max(0,elapsed)/5);
  return [
    {id:'a',name:'Кефир',x:-separation,y:0,z:0,facing:1,customization:{accessory:'topHat'}},
    {id:'b',name:'Кострюля',x:separation,y:0,z:0,facing:-1,customization:{accessory:'crown'}},
  ];
}
const frameAt=(elapsed,options={})=>computeFaceoffCamera({story:{stage:'faceoff',elapsed,sequenceId:'review'},players:playersAt(elapsed),...options});
const keys=['x','y','z','tx','ty','tz'];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test('whole 24s timeline keeps both full silhouettes between name cards and captions',t=>{
  for(const [width,height]of[[844,390],[1280,720],[1024,768],[390,844]])for(const fov of[28,36,50]){
    const aspect=width/height,extents={x:0,bottom:1,top:-1},distances=[];
    for(let frame=0;frame<=FACE_OFF_DURATION*60;frame++){
      const elapsed=frame/60,players=playersAt(elapsed),camera=frameAt(elapsed,{aspect,fov});
      assert.ok(keys.every(key=>Number.isFinite(camera[key])));
      for(const point of faceoffFramingPoints(players)){
        const q=projectCameraPoint(point,camera,aspect,fov);
        extents.x=Math.max(extents.x,Math.abs(q.x));extents.bottom=Math.min(extents.bottom,q.y);extents.top=Math.max(extents.top,q.y);
        assert.ok(q.x>=FACEOFF_SAFE_FRAME.left-1e-10&&q.x<=FACEOFF_SAFE_FRAME.right+1e-10,`side ${width}×${height} at ${elapsed}: ${q.x}`);
        assert.ok(q.y>=FACEOFF_SAFE_FRAME.bottom-1e-10&&q.y<=FACEOFF_SAFE_FRAME.top+1e-10,`vertical ${width}×${height} at ${elapsed}: ${q.y}`);
      }
      distances.push(camera.z);
    }
    if(fov===36&&width>=844)t.diagnostic(`${width}×${height}: ${JSON.stringify({...extents,minZ:Math.min(...distances),maxZ:Math.max(...distances)})}`);
  }
});

test('the shot has a descending entrance, speaking-side emphasis and a shared finish',t=>{
  const start=frameAt(0),arrived=frameAt(5.3),finish=frameAt(24);
  assert.ok(start.z-arrived.z>2,'an actual dolly, not idle wobble');
  assert.ok(start.y-arrived.y>.65,'arrival lowers to the robots’ eyeline');
  const actors=playersAt(0),beats=buildFaceoff(actors,'review');
  const correctionAt=beats.find(beat=>beat.pose==='recoil').at;
  const opening=beats.filter(beat=>beat.at<correctionAt&&actors.some(actor=>actor.id===beat.speaker));
  assert.equal(new Set(opening.map(beat=>beat.speaker)).size,2,'the entrance gives both fighters their own spoken turn');
  for(const beat of opening){
    const side=Math.sign(actors.find(actor=>actor.id===beat.speaker).x);
    const sampleCount=Math.ceil(beat.duration*120);let directedRun=0,longestRun=0,peak=0,last;
    // A short reply need not settle at the old script's absolute timestamp.
    // It must earn a clear, sustained accent *during its own spoken window*.
    // Keep the original .2m target threshold and require the physical rail to
    // agree; a passing instant after the next speaker starts does not count.
    for(let sample=0;sample<sampleCount;sample++){
      last=frameAt(beat.at+beat.duration*sample/sampleCount,{beats});
      peak=Math.max(peak,side*last.tx);
      directedRun=side*last.tx>.2&&side*last.x>0?directedRun+1:0;
      longestRun=Math.max(longestRun,directedRun);
    }
    const directedDuration=longestRun/sampleCount*beat.duration;
    assert.ok(directedDuration>=Math.min(.12,beat.duration*.1),`${beat.speaker} must receive a sustained directed two-shot within ${beat.at}…${beat.at+beat.duration}`);
    assert.ok(side*(last.tx-frameAt(beat.at,{beats}).tx)>.2,'camera attention visibly transfers to the current speaker');
    t.diagnostic(JSON.stringify({speaker:beat.speaker,at:beat.at,duration:beat.duration,directedDuration,peak}));
  }
  assert.equal(finish.x,0);assert.equal(finish.tx,0);assert.ok(finish.y>arrived.y+.65);
  for(const elapsed of[6,10,14,18]){
    const camera=frameAt(elapsed),players=playersAt(elapsed);
    const head=projectCameraPoint({x:players[0].x,y:2.9,z:0},camera,844/390);
    const foot=projectCameraPoint({x:players[0].x,y:0,z:1.4},camera,844/390);
    assert.ok(head.y-foot.y>.79,'main scene occupies at least 39.5% of screen height');
  }
});

test('normal and recut short dialogue produce continuous bounded rail movement',t=>{
  const actors=playersAt(0),ordinary=buildFaceoff(actors,'review');
  const recut=[
    {at:0,duration:.25,speaker:'narrator'},
    {at:.25,duration:2.15,speaker:'b',pose:'challenge'},
    {at:2.4,duration:.45,speaker:'a',pose:'point'},
    {at:2.85,duration:4.6,speaker:'b',pose:'challenge'},
    {at:7.45,duration:.4,speaker:'a',pose:'point'},
    {at:7.85,duration:3.35,speaker:'b',pose:'challenge'},
    ...ordinary.filter(beat=>beat.at>=11.5),
  ];
  for(const beats of[ordinary,recut]){
    let previous,velocity,maxStep=0,maxAcceleration=0;
    for(let i=0;i<=24*120;i++){
      const now=frameAt(i/120,{beats});
      if(previous){
        const nextVelocity=Object.fromEntries(keys.map(key=>[key,now[key]-previous[key]]));
        maxStep=Math.max(maxStep,distance(now,previous));
        if(velocity)maxAcceleration=Math.max(maxAcceleration,...keys.map(key=>Math.abs(nextVelocity[key]-velocity[key])));
        velocity=nextVelocity;
      }
      previous=now;
    }
    t.diagnostic(JSON.stringify({maxStep,maxAcceleration}));
    assert.ok(maxStep<.045,'no fast rail snap at a cut or end of approach');
    assert.ok(maxAcceleration<.002,'no one-frame second derivative spike');
    for(const beat of beats){
      const before=frameAt(beat.at-1e-6,{beats}),after=frameAt(beat.at+1e-6,{beats});
      assert.ok(distance(before,after)<.00002,'exact beat boundary is continuous');
    }
  }
});

test('pause, reordered seeks and render rates cannot introduce local camera history',()=>{
  const elapsed=14.75,players=playersAt(elapsed),story={stage:'faceoff',elapsed,paused:true};
  const expected=computeFaceoffCamera({story,players}),input=structuredClone({story,players});
  for(const t of[24,0,7,11.3,1.35,19,5,elapsed])frameAt(t);
  for(let i=0;i<50;i++)assert.deepEqual(computeFaceoffCamera({story,players}),expected);
  assert.deepEqual({story,players},input,'camera cannot decorate or mutate gameplay snapshots');
  for(const hz of[30,60,120]){
    let result;
    for(let n=0;n<=15*hz;n++)result=frameAt(n/hz);
    assert.deepEqual(result,frameAt(15));
  }
});

test('reduced motion holds one fixed full approach frame and ignores speaking cuts',()=>{
  for(const aspect of[844/390,1280/720,390/844]){
    const held=frameAt(0,{reduced:true,aspect});
    for(let elapsed=0;elapsed<=24;elapsed+=.25){
      const current=frameAt(elapsed,{reduced:true,aspect,beats:[]});
      assert.deepEqual(current,held);
      for(const point of faceoffFramingPoints(playersAt(elapsed))){
        const q=projectCameraPoint(point,current,aspect);
        assert.ok(Math.abs(q.x)<=.90&&q.y>=-.60&&q.y<=.50);
      }
    }
  }
});

test('translated sets frame together; damaged timing and missing actors stay finite',()=>{
  const elapsed=9,ordinary=frameAt(elapsed),players=playersAt(elapsed).map(player=>({...player,x:player.x+2.1,y:player.y+.35,z:player.z-.4}));
  const shifted=computeFaceoffCamera({story:{elapsed},players});
  for(const key of['x','tx'])assert.ok(Math.abs(shifted[key]-ordinary[key]-2.1)<1e-12);
  for(const key of['y','ty'])assert.ok(Math.abs(shifted[key]-ordinary[key]-.35)<1e-12);
  for(const key of['z','tz'])assert.ok(Math.abs(shifted[key]-ordinary[key]+.4)<1e-12);
  for(const options of[{}, {story:null,players:null}, {story:{elapsed:NaN},aspect:NaN,fov:Infinity},
    {story:{elapsed:999},players:[{x:Infinity,y:NaN}]}, {story:{elapsed:-10},beats:[null,{at:0,duration:NaN}]}]){
    const camera=computeFaceoffCamera(options);assert.ok(keys.every(key=>Number.isFinite(camera[key])));
  }
  for(const aspect of[.25,4.5])for(const fov of[18,80]){
    const camera=frameAt(0,{aspect,fov});
    for(const point of faceoffFramingPoints(playersAt(0))){
      const q=projectCameraPoint(point,camera,aspect,fov);
      assert.ok(Math.abs(q.x)<=.90&&q.y>=-.60&&q.y<=.50,'respect the actual positive viewport/FOV, with no hidden aspect clamp');
    }
  }
});

test('countdown blend supports a normal ending and early mutual skip without a seam',()=>{
  const combat=createCameraChoreography().update(0,playersAt(24));
  for(const elapsed of[3.5,13,24]){
    const from=frameAt(elapsed),saved=structuredClone(from);
    assert.deepEqual(blendFaceoffCamera(from,combat,0),from);
    assert.deepEqual(blendFaceoffCamera(from,combat,1),combat);
    assert.ok(distance(from,blendFaceoffCamera(from,combat,.0001))<1e-9);
    assert.ok(distance(combat,blendFaceoffCamera(from,combat,.9999))<1e-9);
    for(let i=0;i<=180;i++){
      const result=blendFaceoffCamera(from,combat,i/180);
      for(const key of keys)assert.ok(result[key]>=Math.min(from[key],combat[key])-1e-12&&result[key]<=Math.max(from[key],combat[key])+1e-12);
    }
    assert.deepEqual(from,saved);
  }
});

test('real robot meshes and bone-mounted trophies clear both overlays throughout the script',async t=>{
  const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const fs=await import('node:fs/promises');
  globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  globalThis.ProgressEvent=class{constructor(type,properties){Object.assign(this,properties);}};
  const bytes=await fs.readFile(new URL('../public/assets/automaton.glb',import.meta.url)),originalLoad=GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync=function(){return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
  const {loadRobotAssets,createRobot}=await import('../src/robot.js');
  try{await loadRobotAssets();}finally{GLTFLoader.prototype.loadAsync=originalLoad;}
  const robots=[createRobot(),createRobot({skin:'cyan'})],beats=buildFaceoff(playersAt(0),'review'),point=new THREE.Vector3();
  const extents={x:0,bottom:1,top:-1};let checked=0;
  try{
    for(let frame=0;frame<=24*60;frame++){
      const elapsed=frame/60,players=playersAt(elapsed),beat=beats.findLast(value=>value.at<=elapsed&&elapsed<value.at+value.duration);
      robots.forEach((robot,index)=>{
        const player=players[index];robot.group.position.set(player.x,0,0);
        robot.update({...player,hp:180,maxHp:180,action:'faceoff',variant:beat?.speaker===player.id?beat.pose:'stance',actionTime:elapsed-(beat?.at??0),actionDuration:beat?.duration??24},1/60,elapsed);
        robot.group.updateMatrixWorld(true);
      });
      if(frame%30!==0)continue;
      for(const aspect of[844/390,1280/720]){
        const camera=frameAt(elapsed,{beats,aspect});
        for(const robot of robots)robot.group.traverseVisible(mesh=>{
          if(!mesh.isMesh||(!mesh.isSkinnedMesh&&!mesh.parent?.name.startsWith('RobotAccessory_')))return;
          for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
            mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
            const q=projectCameraPoint(point,camera,aspect);
            extents.x=Math.max(extents.x,Math.abs(q.x));extents.bottom=Math.min(extents.bottom,q.y);extents.top=Math.max(extents.top,q.y);checked++;
            assert.ok(Math.abs(q.x)<=.90,`real side cropped at ${elapsed}`);
            assert.ok(q.y>=-.60&&q.y<=.50,`real model behind text at ${elapsed}: ${q.y}`);
          }
        });
      }
    }
    assert.ok(checked>100000);t.diagnostic(JSON.stringify({...extents,checked}));
  }finally{robots.forEach(robot=>robot.dispose());}
});
