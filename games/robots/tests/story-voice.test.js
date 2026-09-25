import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryVoice } from '../src/story-voice.js';
import { SPOKEN_CLIP_IDS } from '../shared/spoken-catalog.js';
const first='faceoff-mode-p1',second='faceoff-taunt-p2';
const catalog=Object.fromEntries(SPOKEN_CLIP_IDS.map(id=>[id,{url:`/assets/voices/spoken-v3/${id}.mp3`,speaker:id===second||id.endsWith('-p2')?'p2':'p1',duration:8,text:'Записанная реплика.'}]));
const clip={id:'greet',at:1,duration:8.5,clip:first,clipOffset:.2,clipDuration:8};
const frame=(elapsed,patch={})=>({sequenceId:'scene-1',elapsed,beats:[clip],enabled:true,...patch});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,options={}){
  const sources=[],spoken=[],statuses=[],urls=[],handlers=new Map();
  const visibility={hidden:false,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)};
  const ctx={state:'suspended',destination:{},resume:async()=>{ctx.state='running';},close:async()=>{ctx.state='closed';},
    createGain:()=>({gain:{value:0},connect(){},disconnect(){}}),decodeAudioData:async()=>({duration:12}),
    createBufferSource(){const source={connect(){},disconnect(){},stop(){source.stopped=true;},start(...values){source.startArgs=values;}};sources.push(source);return source;}};
  // Passing the retired options must not resurrect device speech.
  const voice=createStoryVoice({makeContext:()=>ctx,clipCatalog:catalog,speech:{getVoices:()=>[{name:'Female Russian',lang:'ru-RU',localService:true}],speak:value=>spoken.push(value)},
    Utterance:class{constructor(text){this.text=text;}},visibility,assetUrl:path=>'/robots'+path,onStatus:value=>statuses.push(value),
    fetcher:async url=>{urls.push(url);return{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};},...options});
  t.after(()=>voice.dispose());return{voice,sources,spoken,statuses,urls,handlers,visibility,ctx};
}

test('mandatory preparation decodes every active actor clip before ready without playing it',async t=>{
  const h=harness(t);let decoding=0,peak=0,decoded=0;
  h.ctx.decodeAudioData=async()=>{peak=Math.max(peak,++decoding);await flush();decoding--;decoded++;return{duration:12};};
  const a=h.voice.prepareAll(),b=h.voice.prepareAll();assert.equal(a,b);
  const result=await a;assert.equal(result.loaded,SPOKEN_CLIP_IDS.length);
  assert.equal(decoded,SPOKEN_CLIP_IDS.length);assert.ok(peak<=3);
  assert.equal(h.sources.length,0);assert.equal(h.urls.length,SPOKEN_CLIP_IDS.length);
  await h.voice.prepareAll();assert.equal(decoded,SPOKEN_CLIP_IDS.length,'retains decoded buffers');
});

test('mandatory preparation refuses missing audio and explicit retry can complete it',async t=>{
  let offline=true;
  const h=harness(t,{fetcher:async()=>({ok:!offline,arrayBuffer:async()=>new ArrayBuffer(4)})});
  await assert.rejects(h.voice.prepareAll(),/реплики/);
  offline=false;assert.equal((await h.voice.prepareAll()).loaded,SPOKEN_CLIP_IDS.length);
  assert.equal(h.sources.length,0);
});

test('a hung native decoder fails readiness and its late result cannot replace a retried recording',async t=>{
  const h=harness(t,{loadTimeoutMs:5});let oldResolve,attempt=0;
  h.ctx.decodeAudioData=()=>++attempt===1?new Promise(resolve=>{oldResolve=resolve;}):Promise.resolve({duration:12,id:'fresh'});
  await assert.rejects(h.voice.prepareAll(),/реплики/);
  assert.equal(h.sources.length,0);
  assert.equal((await h.voice.prepareAll()).loaded,SPOKEN_CLIP_IDS.length);
  oldResolve({duration:99,id:'obsolete'});await flush();
  h.voice.update(frame(1,{beats:[{...clip,clip:SPOKEN_CLIP_IDS[0]}]}));
  assert.equal(h.sources[0].buffer.id,'fresh');
});

test('a pending AudioContext resume is bounded and can be retried by a new sound gesture',async t=>{
  const h=harness(t,{loadTimeoutMs:5});h.ctx.resume=()=>new Promise(()=>{});
  await assert.rejects(h.voice.prepareAll(),/Проверить звук/);
  assert.equal(h.urls.length,0);
  h.ctx.resume=async()=>{h.ctx.state='running';};
  assert.equal((await h.voice.prepareAll()).loaded,SPOKEN_CLIP_IDS.length);
});

test('disposal releases decode jobs and cancels readiness even when native decoders never settle',async t=>{
  const h=harness(t);h.ctx.decodeAudioData=()=>new Promise(()=>{});
  const pending=h.voice.prepareAll();await flush();h.voice.dispose();
  await assert.rejects(pending,/реплики|отменена/);assert.equal(h.sources.length,0);
});

test('unlocking a byte-warmed scene shares the global decoder limit with mandatory preparation',async t=>{
  const h=harness(t,{concurrency:2});let active=0,peak=0;
  await h.voice.preload(SPOKEN_CLIP_IDS.slice(0,9).map(clip=>({clip})));
  h.ctx.decodeAudioData=async()=>{peak=Math.max(peak,++active);await flush();active--;return{duration:12};};
  const prepared=h.voice.prepareAll();await h.voice.unlock();
  assert.equal((await prepared).loaded,SPOKEN_CLIP_IDS.length);assert.ok(peak<=2,`peak decoders: ${peak}`);
});

test('suspending audio during preparation never reports readiness',async t=>{
  const h=harness(t);
  h.ctx.decodeAudioData=async()=>{h.ctx.state='suspended';return{duration:12};};
  await assert.rejects(h.voice.prepareAll(),/Проверить звук/);
});
test('current actor recordings preload under /robots and repeated packets never duplicate a line',async t=>{
  const h=harness(t);await h.voice.unlock();await h.voice.preload([clip,clip]);
  assert.deepEqual(h.urls,[`/robots${catalog[first].url}`]);
  for(const time of[0,1.1,1.1,1.2])h.voice.update(frame(time));
  assert.equal(h.sources.length,1);assert.deepEqual(h.sources[0].startArgs,[0,.2,8]);
  assert.equal(h.voice.getCapabilities().lastClip,first);assert.equal(h.voice.getCapabilities().started,1);
});
test('late join/mute never replay past dialogue; pause resumes the actual recording offset',async t=>{
  const h=harness(t);await h.voice.unlock();await h.voice.preload([clip]);
  h.voice.update(frame(3));assert.equal(h.sources.length,0);
  h.voice.update(frame(1,{sequenceId:'new'}));h.voice.update(frame(3,{sequenceId:'new',paused:true}));assert.ok(h.sources[0].stopped);
  h.voice.update(frame(3,{sequenceId:'new',paused:true}));assert.equal(h.sources.length,1);
  h.voice.update(frame(3,{sequenceId:'new'}));assert.equal(h.sources[1].startArgs[1],2.2);
  h.voice.setMuted(true);assert.ok(h.sources[1].stopped);h.voice.setMuted(false);h.voice.update(frame(3.1,{sequenceId:'new'}));assert.equal(h.sources.length,2);
});
test('system female voice and injected ttsText never speak, and the retired API cannot be enabled',async t=>{
  const h=harness(t);await h.voice.unlock();assert.equal(h.voice.setTtsEnabled,undefined);
  const name={id:'name',at:0,duration:3,ttsText:'Это не должно читаться голосом телефона.'};
  h.voice.update(frame(0,{beats:[name]}));h.voice.update(frame(.1,{beats:[name]}));
  assert.equal(h.spoken.length,0);assert.equal(h.sources.length,0);assert.equal(h.handlers.has('voiceschanged'),false);
  assert.equal(h.voice.getCapabilities().mode,'recordings');assert.match(h.voice.getCapabilities().message,/имена в субтитрах/);
});
test('a missing scene pack reports caption-only playback without consulting device speech or downloading archives',async t=>{
  const h=harness(t);await h.voice.unlock();
  const beats=[{id:'unavailable',at:0,duration:3,audioUnavailable:true,text:'Сцена с субтитрами.'}];
  await h.voice.preload(beats);h.voice.update(frame(0,{beats}));
  assert.equal(h.voice.getCapabilities().mode,'subtitles');assert.match(h.voice.getCapabilities().message,/недоступны/);
  assert.equal(h.voice.getCapabilities().retryAvailable,false);assert.deepEqual(h.urls,[]);assert.equal(h.spoken.length,0);
});
test('archived IDs and battle effects are never downloaded by the story voice, even if injected into its catalogue',async t=>{
  const h=harness(t,{clipCatalog:{...catalog,greeting:{...catalog[first],url:'/assets/voices/greeting.mp3'},'jotaro-mode':{...catalog[first],url:'/assets/voices/generated/jotaro-mode.mp3'},'duo-super':catalog[first]}});
  await h.voice.unlock();const old=['greeting','jotaro-mode','duo-super'].map((clip,i)=>({id:String(i),at:i,duration:1,clip}));await h.voice.preload(old);
  old.forEach(beat=>h.voice.update(frame(beat.at,{beats:old})));assert.deepEqual(h.urls,[]);assert.equal(h.sources.length,0);assert.equal(h.spoken.length,0);
});
test('hidden page, disabled referee stage and disposal stop owned audio without fallback',async t=>{
  const h=harness(t);await h.voice.unlock();await h.voice.preload([clip]);h.voice.update(frame(1));
  h.visibility.hidden=true;h.handlers.get('visibilitychange')();assert.ok(h.sources[0].stopped);h.visibility.hidden=false;h.voice.update(frame(1.2));assert.equal(h.sources.length,1);
  h.voice.update(frame(1,{sequenceId:'s2'}));h.voice.update(frame(1.1,{sequenceId:'s2',enabled:false}));assert.ok(h.sources[1].stopped);
  h.voice.dispose();assert.equal(h.ctx.state,'closed');assert.equal(h.handlers.size,0);h.voice.update(frame(1,{sequenceId:'s3'}));assert.equal(h.sources.length,2);
});
test('subtitle changes do not truncate recorded words, and leaving a pause discards its resume',async t=>{
  const h=harness(t);await h.voice.unlock();await h.voice.preload([clip]);const next={id:'caption',at:5,duration:2,text:'Субтитр'};
  h.voice.update(frame(1,{beats:[clip,next]}));h.voice.update(frame(5.2,{beats:[clip,next]}));assert.ok(!h.sources[0].stopped);
  h.voice.update(frame(6,{paused:true}));h.voice.update(frame(6,{paused:true,enabled:false}));h.voice.update(frame(6.1));assert.equal(h.sources.length,1);
});
test('jitter never trims the first syllable and an overlapping next line waits for the first ending',async t=>{
  const h=harness(t);await h.voice.unlock();const a={id:'a',at:6.4,duration:3.5,clip:first,clipDuration:3.2},b={id:'b',at:9.9,duration:3.1,clip:second,clipDuration:2.55};await h.voice.preload([a,b]);
  const next=(elapsed,paused=false)=>h.voice.update(frame(elapsed,{beats:[a,b],paused}));
  next(6.75);assert.deepEqual(h.sources[0].startArgs,[0,0,3.2]);next(7.5,true);next(7.5);assert.equal(h.sources[1].startArgs[1],.75);
  next(9.9);assert.equal(h.sources.length,2);next(9.96);assert.equal(h.sources.length,3);assert.deepEqual(h.sources[2].startArgs,[0,0,2.55]);
});
test('timeouts settle even if a transport ignores abort, and queued downloads dispose without starting',async()=>{
  let requests=0;const voice=createStoryVoice({clipCatalog:catalog,fetcher:()=>{requests++;return new Promise(()=>{});},loadTimeoutMs:5,concurrency:1,visibility:null});
  await voice.preload([clip]);assert.equal(requests,2);assert.ok(voice.getCapabilities().retryAvailable);await voice.preload([clip]);assert.equal(requests,2);
  const pending=voice.preload([second,'faceoff-greeting-open'].map(clip=>({clip})));await flush();voice.dispose();await pending;assert.equal(requests,3);
});
test('bounded download concurrency keeps scene order; unlocking decodes bytes warmed before the gesture',async t=>{
  let active=0,peak=0;const requests=[];
  const h=harness(t,{concurrency:2,fetcher:(url,options)=>new Promise(resolve=>{active++;peak=Math.max(peak,active);requests.push({url,options,resolve:()=>{active--;resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});}});})});
  const beats=SPOKEN_CLIP_IDS.slice(0,6).map(clip=>({clip})),pending=h.voice.preload(beats);assert.equal(requests.length,2);
  for(let i=0;i<6;i++){requests[i].resolve();await flush();}await pending;assert.equal(peak,2);assert.ok(requests.every(r=>r.options.cache==='no-cache'));
  await h.voice.unlock();await flush();h.voice.update(frame(1));assert.equal(h.sources.length,1,'pre-gesture bytes are decoded by unlock, before the first voiced beat');
});
test('retry recovers a failed recording but never catches up a line whose start is already past',async t=>{
  let requests=0,recovered=false;const h=harness(t,{fetcher:async()=>{requests++;return{ok:recovered,arrayBuffer:async()=>new ArrayBuffer(1)};}});await h.voice.unlock();await h.voice.preload([clip]);assert.equal(requests,2);
  h.voice.update(frame(1.5));assert.equal(h.sources.length,0);recovered=true;await h.voice.retry();assert.equal(requests,3);assert.equal(h.voice.getCapabilities().retryAvailable,false);
  h.voice.update(frame(1.6));assert.equal(h.sources.length,0);h.voice.update(frame(1,{sequenceId:'next'}));assert.equal(h.sources.length,1);
});
