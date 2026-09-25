import { createArena } from '../src/arena.js';
import { CombatRoom } from '../server/combat.js';
import { buildFaceoff, activeFaceoffBeat, FACE_OFF_DURATION, faceoffActorPose, faceoffActorX } from '../shared/faceoff-script.js';
import { faceoffShotState } from '../src/faceoff-camera.js';
import { createFaceoffUI } from '../src/faceoff-ui.js';
import { createStoryVoice } from '../src/story-voice.js';

const $=id=>document.getElementById(id),canvas=document.createElement('div');canvas.style.cssText='position:fixed;inset:0';document.body.prepend(canvas);
const arena=await createArena(canvas);
const room=new CombatRoom({id:'CINEMA'});room.addPlayer('Медный Сом');room.addPlayer('Барон Коротыш');
const players=room.snapshot().players;players[0].customization={body:'cobalt',core:'cyan',accessory:'topHat'};players[1].customization={body:'ruby',core:'amber',accessory:'crown'};
const beats=buildFaceoff(players,'actual-recording-review'),ui=createFaceoffUI($('stage'));
const params=new URLSearchParams(location.search);
let elapsed=Number(params.get('time'))||0,playing=false,sequence=1,last=performance.now(),status={},decodes=0,starts=0,stops=0,audioState='not unlocked';
const voice=createStoryVoice({onStatus:value=>status=value,makeContext:()=>{
  const ctx=new AudioContext(),decode=ctx.decodeAudioData.bind(ctx),source=ctx.createBufferSource.bind(ctx);
  ctx.decodeAudioData=async bytes=>{const buffer=await decode(bytes);decodes++;return buffer;};
  ctx.createBufferSource=()=>{const node=source(),start=node.start.bind(node),stop=node.stop.bind(node);node.start=(...args)=>{starts++;start(...args);};node.stop=(...args)=>{stops++;stop(...args);};return node;};
  ctx.addEventListener('statechange',()=>audioState=ctx.state);return ctx;
}});
void voice.preload(beats);
$('seek').max=FACE_OFF_DURATION;$('shot').replaceChildren();
for(const beat of beats)$('shot').add(new Option(`${beat.at.toFixed(2)} / ${beat.chapter} / ${beat.shot}`,String(beat.at+Math.min(1.4,beat.duration*.6))));
$('unlock').onclick=async()=>{await voice.unlock();await voice.preload(beats);$('unlock').textContent=voice.getCapabilities().unlocked?'Звук включён':'Включить звук';};
$('tts').onchange=()=>voice.setTtsEnabled($('tts').checked);$('mute').onchange=()=>voice.setMuted($('mute').checked);
$('toggle').onclick=()=>$('tools').hidden=!$('tools').hidden;
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Пауза':'Воспроизвести';};
function seek(t){playing=false;elapsed=t;sequence++;voice.cancel();$('play').textContent='Воспроизвести';}
$('seek').oninput=()=>seek(Number($('seek').value));$('shot').onchange=()=>seek(Number($('shot').value));$('reset').onclick=()=>seek(0);
$('quality').onchange=()=>{const value=$('quality').value;arena.setQuality(value==='low'?'low':'high');arena.setReducedMotion(value==='reduced');};
function render(now){
  requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000);last=now;
  if(playing){elapsed=Math.min(FACE_OFF_DURATION,elapsed+dt);if(elapsed>=FACE_OFF_DURATION)playing=false;}
  const beat=activeFaceoffBeat(beats,elapsed),reducedMotion=$('quality').value==='reduced';
  const actors=players.map((p,i)=>({...p,x:faceoffActorX(i,elapsed),y:0,facing:i?-1:1,action:'faceoff',variant:faceoffActorPose(beat,p.id),actionTime:elapsed-(beat?.at||0),actionDuration:beat?.duration||3}));
  const story={stage:'faceoff',sequenceId:sequence,elapsed,paused:!playing};
  arena.update({...room.snapshot(),phase:playing?'story':'paused',events:[],players:actors,story,visualSeekToken:sequence},'p1');
  voice.update({sequenceId:sequence,elapsed,paused:!playing,beats,enabled:true});
  ui.update({active:true,sequenceId:sequence,elapsed,paused:false,players:actors,beats,voiceStatus:status,reducedMotion});
  $('seek').value=elapsed;const shot=faceoffShotState({story,players:actors,beats,reduced:reducedMotion});
  $('stats').textContent=`${elapsed.toFixed(2)} / ${FACE_OFF_DURATION} с · ${beat?.pose||'конец'}\n${shot.chapter} / ${shot.shot} / ${shot.primary||'оба'}\nAudio ${audioState} · decoded ${decodes}\nStarts ${starts} · stops ${stops}\n${status.message||''}`;
}
requestAnimationFrame(render);
addEventListener('pagehide',()=>{voice.dispose();ui.dispose();arena.dispose();},{once:true});
