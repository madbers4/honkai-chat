import { buildFaceoff, activeFaceoffBeat, faceoffDuration, FACE_OFF_DURATION } from '../shared/faceoff-script.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const radians = Math.PI / 180;
const components = ['x', 'y', 'z', 'tx', 'ty', 'tz'];
const ease = value => { const t = clamp(value, 0, 1); return t*t*t*(10+t*(-15+6*t)); };
export const FACEOFF_SAFE_FRAME = Object.freeze({ left: -.91, right: .91, bottom: -.52, top: .63 });
export const FACEOFF_CUT_SECONDS = .9;

function actorsFor(players) {
  const source = Array.isArray(players) && players.length ? players.slice(0, 2) : [{ x: -4.3 }, { x: 4.3 }];
  return source.map((player, index) => ({ id: player?.id ?? `p${index+1}`,
    x: finite(player?.x, index ? 4.3 : -4.3), y: Math.max(0, finite(player?.y, 0)), z: finite(player?.z, 0), customization: player?.customization }));
}

/** Full physical envelope for all non-detail shots. Explicit core/claw inserts
 * frame the intended mechanism; they are never mistaken for cropped full shots. */
export function faceoffFramingPoints(players, detail = null) {
  const points=[];
  for(const player of actorsFor(players)) {
    const top=player.customization?.accessory==='topHat'?3.20:['crown','colander','propeller'].includes(player.customization?.accessory)?3.07:2.80;
    // The original reactor lives in the lower chassis, not in the turret.
    // Keep its housing and front supports above captions; the head is outside
    // this intentionally labelled mechanism insert.
    const boxes=detail==='core'?[{halfX:1.02,low:.14,high:1.48,halfZ:1.05},{halfX:1.45,low:.18,high:.82,halfZ:1.8}]
      :detail==='claw'?[{halfX:1.84,low:-.035,high:1.66,halfZ:1.74}]
      :[{halfX:1.90,low:-.035,high:1.32,halfZ:2.02},{halfX:2.12,low:.75,high:1.85,halfZ:1.50},{halfX:.98,low:.8,high:2.03,halfZ:1},{halfX:.81,low:1.55,high:top,halfZ:.83}];
    for(const box of boxes)for(const x of[-box.halfX,box.halfX])for(const y of[box.low,box.high])for(const z of[-box.halfZ,box.halfZ])
      points.push({x:player.x+x,y:player.y+y,z:player.z+z});
  }
  return points;
}
function smoothMaximum(values, softness) {
  const largest=Math.max(...values);
  return largest+softness*Math.log(values.reduce((sum,value)=>sum+Math.exp((value-largest)/softness),0));
}
function framedShot({target,yaw,pitch,distance}, actors, aspect, fov, detail=null) {
  const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const back={x:sy*cp,y:sp,z:cy*cp},right={x:cy,y:0,z:-sy},up={x:-sy*sp,y:cp,z:-cy*sp};
  const tangent=Math.tan(fov*radians/2),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z,needed=[distance];
  for(const point of faceoffFramingPoints(actors,detail)) {
    const relative={x:point.x-target.x,y:point.y-target.y,z:point.z-target.z},depthOffset=dot(relative,back),vertical=dot(relative,up);
    needed.push(depthOffset+Math.abs(dot(relative,right))/(FACEOFF_SAFE_FRAME.right*tangent*aspect));
    needed.push(depthOffset+Math.abs(vertical)/((vertical>=0?FACEOFF_SAFE_FRAME.top:-FACEOFF_SAFE_FRAME.bottom)*tangent));
  }
  const safeDistance=smoothMaximum(needed,.025);
  return {x:target.x+back.x*safeDistance,y:target.y+back.y*safeDistance,z:target.z+back.z*safeDistance,tx:target.x,ty:target.y,tz:target.z};
}
function scriptFor(beats,story,actors) {
  return (beats??story?.beats??buildFaceoff(actors,story?.sequenceId))
    .filter(beat=>Number.isFinite(beat?.at)&&Number.isFinite(beat?.duration)&&beat.duration>0).slice(0,64).sort((a,b)=>a.at-b.at);
}

/** Public shot metadata also drives names, the insert label and visual QA. */
export function faceoffShotState({story={},players=[],beats,reduced=false}={}) {
  const actors=actorsFor(players),script=scriptFor(beats,story,actors);
  const elapsed=clamp(finite(story?.elapsed,0),0,faceoffDuration(script)||FACE_OFF_DURATION),beat=activeFaceoffBeat(script,elapsed)??script.at(-1);
  const portrait=!reduced&&['portrait','core','claw'].includes(beat?.shot);
  const primary=portrait?actors.find(player=>player.id===beat.speaker):null;
  return {chapter:beat?.chapter??'establish',shot:reduced?'wide':beat?.shot??'wide',primary:primary?.id??null,
    detail:!reduced&&['core','claw'].includes(beat?.shot)?beat.shot:null,
    transition:!!beat&&beat.at>0&&elapsed-beat.at<FACEOFF_CUT_SECONDS,
    framedPlayers:primary?[primary]:actors};
}

/** Pure server time: every cut can be reconstructed after pause/reconnect/seek.
 * Portraits are full-body hero shots; only labelled mechanism inserts crop. */
export function computeFaceoffCamera({story={},players=[],beats,aspect=16/9,fov=36,reduced=false}={}) {
  const actors=actorsFor(players),mid=actors.reduce((sum,p)=>sum+p.x,0)/actors.length;
  const middleY=Math.max(...actors.map(p=>p.y)),middleZ=actors.reduce((sum,p)=>sum+p.z,0)/actors.length;
  const ratio=Number.isFinite(aspect)&&aspect>0?aspect:16/9,field=Number.isFinite(fov)&&fov>0&&fov<179?fov:36;
  const script=scriptFor(beats,story,actors);
  const elapsed=clamp(finite(story?.elapsed,0),0,faceoffDuration(script)||FACE_OFF_DURATION);
  const wide=(progress=0,ending=false)=>framedShot({target:{x:mid,y:1.43+middleY,z:middleZ-.1},yaw:mix(-7,0,progress)*radians,
    pitch:mix(11,ending?8:5.5,progress)*radians,distance:mix(15.8,ending?11.6:11.8,progress)},actors,ratio,field);
  if(reduced) {
    const spread=Math.max(4.3,...actors.map(p=>Math.abs(p.x-mid)));
    const held=actors.map((p,i)=>({...p,x:mid+(i?1:-1)*spread}));
    return framedShot({target:{x:mid,y:1.45+middleY,z:middleZ-.1},yaw:0,pitch:8*radians,distance:15.8},held,ratio,field);
  }
  let frame=wide(ease(elapsed/2));
  for(const beat of script) {
    if(beat.at>elapsed)break;
    const age=clamp(elapsed-beat.at,0,beat.duration),progress=ease(age/beat.duration);
    const actor=actors.find(p=>p.id===beat.speaker),side=actor?Math.sign(actor.x-mid)||1:0;
    let shot;
    if(actor&&['portrait','core','claw'].includes(beat.shot)) {
      const detail=['core','claw'].includes(beat.shot)?beat.shot:null;
      const targetY=detail==='core'?.86:detail==='claw'?.76:1.43;
      const yaw=-side*mix(detail?22:16,detail?14:10,progress)*radians;
      shot=framedShot({target:{x:actor.x,y:targetY+actor.y,z:actor.z+.04},yaw,pitch:(detail==='claw'?9:4.5)*radians,
        distance:detail==='core'?5.1:detail==='claw'?7.3:9.4},[actor],ratio,field,detail);
    } else shot=wide(beat.chapter==='ready'?1:ease(elapsed/2),beat.chapter==='ready');
    // Calm 900ms match cuts have zero velocity/acceleration at both seams.
    // Earlier shots settle to their final composition; no per-client history.
    const weight=beat.at===0?1:ease(age/FACEOFF_CUT_SECONDS);
    frame=Object.fromEntries(components.map(key=>[key,mix(frame[key],shot[key],weight)]));
  }
  return frame;
}

export function blendFaceoffCamera(from,combat,progress) {
  const weight=ease(finite(progress,0));
  return Object.fromEntries(components.map(key=>[key,weight===0?from[key]:weight===1?combat[key]:mix(from[key],combat[key],weight)]));
}
