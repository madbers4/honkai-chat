import { withRobotAssetFixture } from './robot-asset-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFaceoff, FACE_OFF_DURATION, faceoffActorX, faceoffActorPose } from '../shared/faceoff-script.js';
import { projectCameraPoint, createCameraChoreography } from '../src/camera-choreography.js';
import { computeFaceoffCamera, blendFaceoffCamera, faceoffFramingPoints, faceoffShotState, FACEOFF_SAFE_FRAME } from '../src/faceoff-camera.js';

function playersAt(elapsed) { return [{id:'a',name:'Кефир',x:faceoffActorX(0,elapsed),y:0,z:0,facing:1,customization:{accessory:'topHat'}},
  {id:'b',name:'Кастрюля',x:faceoffActorX(1,elapsed),y:0,z:0,facing:-1,customization:{accessory:'crown'}}]; }
const frameAt=(elapsed,options={})=>computeFaceoffCamera({story:{stage:'faceoff',elapsed,sequenceId:'review'},players:playersAt(elapsed),...options});
const keys=['x','y','z','tx','ty','tz'],distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const inside=(q,message)=>{
  assert.ok(q.x>=FACEOFF_SAFE_FRAME.left-1e-9&&q.x<=FACEOFF_SAFE_FRAME.right+1e-9,`${message}: x ${q.x}`);
  assert.ok(q.y>=FACEOFF_SAFE_FRAME.bottom-1e-9&&q.y<=FACEOFF_SAFE_FRAME.top+1e-9,`${message}: y ${q.y}`);
};

test('the complete selected scene frames full heroes or the labelled mechanism at desktop and phone ratios',()=>{
  for(const [width,height]of[[844,390],[1280,720],[1024,768],[390,844]])for(const fov of[28,36,50])for(let i=0;i<=FACE_OFF_DURATION*30;i++){
    const elapsed=i/30,players=playersAt(elapsed),aspect=width/height,camera=frameAt(elapsed,{aspect,fov});
    assert.ok(keys.every(key=>Number.isFinite(camera[key])));assert.ok(camera.y>.35&&camera.z>1,'camera never travels through the floor or source wall');
    const shot=faceoffShotState({story:{elapsed},players});
    if(shot.transition)continue;
    for(const point of faceoffFramingPoints(shot.framedPlayers,shot.detail))inside(projectCameraPoint(point,camera,aspect,fov),`${width}×${height}/${shot.shot}/${elapsed}`);
  }
});

test('the voiced opening uses both portraits, mechanism inserts and a final two-shot',()=>{
  const beats=buildFaceoff(playersAt(0),'review'),clawBeat=beats.find(beat=>beat.shot==='claw');
  const portraitA=beats.find(beat=>beat.shot==='portrait'&&beat.speaker==='a');
  const portraitB=beats.find(beat=>beat.shot==='portrait'&&beat.speaker==='b');
  const coreBeat=beats.find(beat=>beat.shot==='core');
  const a=frameAt(portraitA.at+1.4),b=frameAt(portraitB.at+1.4),core=frameAt(coreBeat.at+1.5),claw=frameAt(clawBeat.at+1.7),finish=frameAt(FACE_OFF_DURATION);
  assert.equal(beats[0].shot,'portrait');assert.equal(beats[0].clip,'faceoff-greeting-open');
  assert.ok(a.tx<0&&b.tx>0,'both players own a clear hero shot');
  assert.ok(core.z<a.z-1.3&&claw.z>core.z+.6,'detail inserts change scale, not just labels');
  assert.equal(core.ty,.86,'core insert targets the lower reactor housing rather than the face');
  assert.equal(finish.x,0);assert.equal(finish.tx,0);
  for(const elapsed of beats.filter(beat=>beat.shot==='portrait').map(beat=>beat.at+Math.min(1.4,beat.duration-.01))){
    const actors=playersAt(elapsed),shot=faceoffShotState({story:{elapsed},players:actors});
    const actor=shot.framedPlayers[0],camera=frameAt(elapsed);
    const head=projectCameraPoint({x:actor.x,y:2.9,z:0},camera,844/390),foot=projectCameraPoint({x:actor.x,y:0,z:1.4},camera,844/390);
    assert.ok(head.y-foot.y>.8,'hero occupies at least 40% of phone height');
  }
});

test('match cuts remain continuous with bounded speed and acceleration',t=>{
  let previous,velocity,maxStep=0,maxAcceleration=0;
  for(let i=0;i<=FACE_OFF_DURATION*120;i++){
    const now=frameAt(i/120);
    if(previous){const nextVelocity=Object.fromEntries(keys.map(key=>[key,now[key]-previous[key]]));maxStep=Math.max(maxStep,distance(now,previous));
      if(velocity)maxAcceleration=Math.max(maxAcceleration,...keys.map(key=>Math.abs(nextVelocity[key]-velocity[key])));velocity=nextVelocity;}
    previous=now;
  }
  t.diagnostic(JSON.stringify({maxStep,maxAcceleration}));assert.ok(maxStep<.13);assert.ok(maxAcceleration<.009);
  for(const beat of buildFaceoff(playersAt(0),'review'))assert.ok(distance(frameAt(beat.at-1e-6),frameAt(beat.at+1e-6))<.00003,'no position discontinuity at a cut');
});

test('pause, reordered seeks and all render rates reproduce the same cinematic frame',()=>{
  const elapsed=34.75,players=playersAt(elapsed),story={stage:'faceoff',elapsed,paused:true},input=structuredClone({story,players});
  const expected=computeFaceoffCamera({story,players});
  for(const time of[48,0,7,11.3,1.35,39,5,elapsed])frameAt(time);
  for(let i=0;i<50;i++)assert.deepEqual(computeFaceoffCamera({story,players}),expected);
  assert.deepEqual({story,players},input);
  for(const hz of[30,60,120]){let result;for(let n=0;n<=15*hz;n++)result=frameAt(n/hz);assert.deepEqual(result,frameAt(15));}
});

test('reduced motion uses one fixed full two-shot for the entire approach and all dialogue',()=>{
  for(const aspect of[844/390,1280/720,390/844]){const held=frameAt(0,{reduced:true,aspect});
    for(let elapsed=0;elapsed<=FACE_OFF_DURATION;elapsed+=.25){const current=frameAt(elapsed,{reduced:true,aspect,beats:[]});assert.deepEqual(current,held);
      for(const point of faceoffFramingPoints(playersAt(elapsed)))inside(projectCameraPoint(point,current,aspect),'reduced frame');}}
});

test('translated scenes and malformed optional timing remain finite without mutating input',()=>{
  const elapsed=9,ordinary=frameAt(elapsed),players=playersAt(elapsed).map(p=>({...p,x:p.x+2.1,y:.35,z:-.4}));
  const shifted=computeFaceoffCamera({story:{elapsed},players});
  for(const [fields,delta]of[[['x','tx'],2.1],[['y','ty'],.35],[['z','tz'],-.4]])for(const key of fields)assert.ok(Math.abs(shifted[key]-ordinary[key]-delta)<1e-12);
  for(const options of[{}, {story:null,players:null}, {story:{elapsed:NaN},aspect:NaN,fov:Infinity}, {story:{elapsed:999},players:[{x:Infinity,y:NaN}]}, {story:{elapsed:-10},beats:[null,{at:0,duration:NaN}]}])
    assert.ok(keys.every(key=>Number.isFinite(computeFaceoffCamera(options)[key])));
});

test('normal finish and early mutual skip blend continuously to the combat camera',()=>{
  const combat=createCameraChoreography().update(0,playersAt(FACE_OFF_DURATION));
  for(const elapsed of[3.5,8.3,13,FACE_OFF_DURATION]){const from=frameAt(elapsed),saved=structuredClone(from);
    assert.deepEqual(blendFaceoffCamera(from,combat,0),from);assert.deepEqual(blendFaceoffCamera(from,combat,1),combat);
    assert.ok(distance(from,blendFaceoffCamera(from,combat,.0001))<1e-9);assert.ok(distance(combat,blendFaceoffCamera(from,combat,.9999))<1e-9);
    for(let i=0;i<=180;i++){const result=blendFaceoffCamera(from,combat,i/180);for(const key of keys)assert.ok(result[key]>=Math.min(from[key],combat[key])-1e-12&&result[key]<=Math.max(from[key],combat[key])+1e-12);}assert.deepEqual(from,saved);
  }
});

test('actual GLB heroes and trophies are uncropped; intentional inserts retain their real mechanism anchors',async t=>{
  const THREE=await import('three');globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  globalThis.ProgressEvent=class{constructor(type,properties){Object.assign(this,properties);}};
  const{loadRobotAssets,createRobot}=await import('../src/robot.js');await withRobotAssetFixture(loadRobotAssets);
  const robots=[createRobot(),createRobot({skin:'cyan'})],beats=buildFaceoff(playersAt(0),'review'),point=new THREE.Vector3();let checked=0,anchors=0;
  try{for(let i=0;i<=FACE_OFF_DURATION*60;i++){
    const elapsed=i/60,players=playersAt(elapsed),beat=beats.findLast(b=>b.at<=elapsed&&elapsed<b.at+b.duration);
    robots.forEach((robot,index)=>{const p=players[index];robot.group.position.set(p.x,0,0);robot.update({...p,hp:180,maxHp:180,action:'faceoff',variant:faceoffActorPose(beat,p.id),actionTime:elapsed-(beat?.at??0),actionDuration:beat?.duration??3},1/60,elapsed);robot.group.updateMatrixWorld(true);});
    if(i%30)continue;const shot=faceoffShotState({story:{elapsed},players,beats});if(shot.transition)continue;
    for(const aspect of[844/390,1280/720]){const camera=frameAt(elapsed,{beats,aspect});
      robots.forEach((robot,index)=>{if(shot.primary&&shot.primary!==players[index].id)return;
        if(shot.detail){
          const actual=robot.getCombatAnchors(),keys=shot.detail==='core'?['core','leftClawBase','rightClawBase']:['leftClaw','rightClaw'];
          for(const key of keys){
            const q=projectCameraPoint(actual[key],camera,aspect);
            if(shot.detail==='core'){
              inside(q,`actual core support ${key} at ${elapsed}`);
              if(key==='core')assert.ok(q.y>-.30&&q.y<.12,`reactor remains central and above subtitles: ${elapsed}/${q.y}`);
            }else assert.ok(Math.abs(q.x)<.95&&q.y>-.68&&q.y<.73,`actual ${key} cropped at ${elapsed}: ${JSON.stringify(q)}`);
            anchors++;
          }
          // Test the actual luminous sphere, not only a pivot or loose box.
          if(shot.detail==='core')robot.group.traverseVisible(mesh=>{
            if(!mesh.isSkinnedMesh||mesh.material.userData.signalChannel!=='reactor')return;
            for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
              mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
              const q=projectCameraPoint(point,camera,aspect);
              inside(q,`actual reactor surface at ${elapsed}`);
              assert.ok(q.y>-.44,'reactor surface clears the mobile subtitle zone');
            }
          });
          return;
        }
        robot.group.traverseVisible(mesh=>{if(!mesh.isMesh||(!mesh.isSkinnedMesh&&!mesh.parent?.name.startsWith('RobotAccessory_')))return;
          for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);inside(projectCameraPoint(point,camera,aspect),`actual hero ${index} at ${elapsed}`);checked++;}});
      });
    }
  }assert.ok(checked>1000000);assert.ok(anchors>10);t.diagnostic(JSON.stringify({checked,anchors}));}finally{robots.forEach(robot=>robot.dispose());}
});
