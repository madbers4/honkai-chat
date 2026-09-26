import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPOKEN_CLIP_IDS, SPOKEN_FACEOFF_TURNS, hasCompleteSpokenCatalog, VOICE_START_GRACE, VOICE_BREATHING_ROOM } from '../shared/spoken-catalog.js';
import { buildFaceoff, faceoffDuration, getFaceoffDuration, activeFaceoffBeat } from '../shared/faceoff-script.js';
import { buildRoundIntro, activeRoundIntroBeat } from '../shared/round-intro.js';
import { storyVoicePreload } from '../shared/story-voice-preload.js';
import { faceoffShotState, computeFaceoffCamera } from '../src/faceoff-camera.js';
import { createStoryVoice } from '../src/story-voice.js';
import { StorySession } from '../server/story-session.js';
import { CombatRoom } from '../server/combat.js';
import { COUNTDOWN_SECONDS } from '../shared/constants.js';

const script=JSON.parse(readFileSync(new URL('../scripts/voice-production/spoken-script.json',import.meta.url),'utf8'));
// Explicit test-only catalogue: artificial durations stress long expressive
// lines. No production metadata or MP3 is invented or written by these tests.
const fixture=()=>Object.fromEntries(script.utterances.map((utterance,i)=>[utterance.id,{
  url:`/assets/voices/test-fixture/${utterance.id}.mp3`,text:utterance.text,speaker:utterance.speaker,
  duration:i===0?5.05:i===1?4.75:1.13+(i%7)*1.173,
}]));
const players=[{id:'one',name:'Настоящее имя'},{id:'two',name:'Второе имя'}];
const gap=VOICE_START_GRACE+VOICE_BREATHING_ROOM;

test('55 planned IDs activate atomically; missing or invalid catalogues retain only silent captions',()=>{
  const catalog=fixture();assert.equal(SPOKEN_CLIP_IDS.length,55);
  assert.deepEqual([...SPOKEN_CLIP_IDS].sort(),script.utterances.map(line=>line.id).sort());
  assert.deepEqual(SPOKEN_FACEOFF_TURNS.map(turn=>turn.id),script.faceoffOrder);
  assert.ok(hasCompleteSpokenCatalog(catalog));
  for(const patch of[undefined,{duration:NaN},{duration:0},{speaker:'p2'},{url:'https://outside.invalid/file.mp3'},{text:''}]) {
    const partial={...catalog,'faceoff-mode-p1':patch?{...catalog['faceoff-mode-p1'],...patch}:undefined};
    assert.equal(hasCompleteSpokenCatalog(partial),false);
    assert.ok(buildFaceoff(players,'x',{catalog:partial}).every(beat=>!beat.clip&&!beat.ttsText&&beat.text));
    assert.ok(!buildFaceoff(players,'x',{catalog:partial}).some(beat=>SPOKEN_CLIP_IDS.includes(beat.clip)));
  }
  for(const absent of[{},null]){
    const scene=buildFaceoff(players,'missing',{catalog:absent});
    assert.ok(scene.every(beat=>!beat.clip&&!beat.ttsText));assert.ok(Number.isFinite(faceoffDuration(scene)));
    for(const round of[1,2])assert.ok(buildRoundIntro(players,'missing',round,0,{catalog:absent}).beats.every(beat=>beat.audioUnavailable&&!beat.clip&&!beat.ttsText));
  }
});

test('seven complete original turns begin at frame zero with acting and measured timing',()=>{
  const catalog=fixture();catalog['faceoff-mode-p1'].text='Точный утверждённый текст записи!';catalog['faceoff-taunt-p2'].duration=34.127;
  const beats=buildFaceoff(players,'cinema',{catalog}),spoken=beats.filter(beat=>beat.clip),duration=faceoffDuration(beats);
  assert.deepEqual(spoken.map(beat=>beat.clip),script.faceoffOrder);assert.equal(spoken.length,7);
  assert.ok(duration>48);assert.equal(duration,getFaceoffDuration(catalog));
  assert.equal(beats[0].clip,'faceoff-greeting-open');assert.equal(beats[0].at,0);assert.ok(!beats.at(-1).clip&&!beats.at(-1).ttsText);
  for(const [i,beat]of beats.entries()) {
    assert.ok(Math.abs(beat.at+beat.duration-(beats[i+1]?.at??duration))<1e-8);
    if(!beat.clip)continue;
    const entry=catalog[beat.clip];assert.equal(beat.text,entry.text);assert.equal(beat.clipOffset,0);assert.equal(beat.clipDuration,entry.duration);
    assert.ok(beat.duration+1e-8>=entry.duration+gap);assert.equal(beat.speaker,players[entry.speaker==='p1'?0:1].id);
    assert.equal(activeFaceoffBeat(beats,beat.at+.38+entry.duration)?.id,beat.id);
  }
  const late=spoken.at(-1),story={elapsed:late.at+1};
  assert.ok(story.elapsed>48);assert.equal(faceoffShotState({story,players,beats}).primary,'two');
  assert.ok(Object.values(computeFaceoffCamera({story,players,beats})).every(Number.isFinite));
});

test('all 48 round takes preserve setup then reply while alternating fixed player voices',()=>{
  const catalog=fixture(),seen=new Set();
  for(let seed=0;seed<24;seed++)for(let round=1;round<=24;round++){
    const intro=buildRoundIntro(players,`deck-${seed}`,round,0,{catalog}),exchange=script.roundExchanges.find(pair=>pair.id===intro.exchangeId);
    assert.deepEqual(intro,buildRoundIntro(players,`deck-${seed}`,round,0,{catalog}));
    for(const[index,beat]of intro.beats.entries()){
      const seat=index===0?(round-1)%2:1-(round-1)%2,turn=index===0?'setup':'reply',id=exchange.utterances[turn][`p${seat+1}`];
      assert.equal(beat.clip,id);seen.add(id);assert.equal(beat.speaker,players[seat].id);assert.equal(beat.text,catalog[id].text);
      assert.equal(beat.text,exchange[`${turn}Text`]);assert.equal(beat.ttsText,undefined);
      assert.ok(beat.duration+1e-8>=catalog[id].duration+gap);assert.equal(beat.clipOffset,0);
      assert.equal(activeRoundIntroBeat(intro,beat.at+.38+beat.clipDuration)?.id,beat.id);
    }
    assert.equal(intro.beats[1].at,intro.beats[0].duration);assert.equal(intro.duration,intro.beats[1].at+intro.beats[1].duration);
  }
  assert.equal(seen.size,48);
});

test('server duration and round countdown use the selected adaptive scenes, including pause and late dialogue',()=>{
  const catalog=fixture(),room=new CombatRoom({id:'ADAPTIVE'});room.addPlayer('a');room.addPlayer('b');
  catalog['faceoff-taunt-p2'].duration=40;
  const story=new StorySession(room,{ruleCount:1,buildFaceoff:(p,s)=>buildFaceoff(p,s,{catalog}),buildRoundIntro:(p,s,r,m)=>buildRoundIntro(p,s,r,m,{catalog})});
  story.ready('p1');story.ready('p2');for(const actor of ['p1','p2'])story.advance({actor,sequenceId:story.sequenceId,ruleIndex:0});
  const total=faceoffDuration(story.beats);assert.equal(story.snapshot().duration,total);
  for(let i=0;i<48*60;i++)story.step(1/60);assert.equal(story.stage,'faceoff');
  room.setConnected('p2',false);const held=story.elapsed;story.step(.1);assert.equal(story.elapsed,held);room.setConnected('p2',true);
  while(story.stage==='faceoff')story.step(1/60);
  const intro=story.roundIntro;assert.equal(room.countdown,COUNTDOWN_SECONDS+intro.duration);assert.equal(story.snapshot().roundIntro.duration,intro.duration);
  for(let i=0;i<Math.ceil((intro.beats[1].at+.4)*60);i++)room.step(1/60);
  const snapshot=story.decorate(room.snapshot());assert.equal(snapshot.story.stage,'roundIntro');
  assert.ok(Math.abs(snapshot.story.elapsed-intro.beats[1].at-.4)<.018);
  assert.equal(snapshot.players.find(p=>p.id===intro.beats[1].speaker).variant,'point');
});

test('preload requests only the selected current and next sequence, never the entire 55-file pack',async t=>{
  const catalog=fixture(),opening=storyVoicePreload({players,room:'x',story:{stage:'rules'}},{catalog});
  assert.equal(opening.filter(beat=>beat.clip).length,9);
  const current=storyVoicePreload({players,room:'x',round:7,story:{stage:'roundIntro',roundIntro:{round:7,matchSerial:2}}},{catalog});
  assert.equal(current.length,4);assert.deepEqual(current,[...buildRoundIntro(players,'x',7,2,{catalog}).beats,...buildRoundIntro(players,'x',8,2,{catalog}).beats]);
  const rematch=storyVoicePreload({players,room:'x',round:9,phase:'matchOver',story:{stage:'complete',roundIntro:{round:9,matchSerial:2}}},{catalog});
  assert.deepEqual(rematch,buildRoundIntro(players,'x',1,3,{catalog}).beats,'result screen warms the new deck before the rematch countdown');
  for(const phase of ['finishing','paused']) assert.deepEqual(storyVoicePreload({players,room:'x',round:9,phase,finish:{stage:'offer'},story:{stage:'complete',roundIntro:{round:9,matchSerial:2}}},{catalog}),rematch,'even an immediate rematch has its dialogue warmed during the finale');
  assert.equal(storyVoicePreload({story:{stage:'roundIntro',refereeConnected:true}},{catalog}).length,4,'the recorded exchange and next pair stay warm with a referee too');
  const urls=[],voice=createStoryVoice({clipCatalog:catalog,fetcher:async url=>{urls.push(url);return{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}}});
  t.after(()=>voice.dispose());await voice.preload(current);await voice.preload(current);
  assert.equal(urls.length,4);assert.ok(urls.every(url=>current.some(beat=>catalog[beat.clip].url===url)));
});

test('actual voice scheduler gives every new line its full first syllable and ending at the maximum late grace',async t=>{
  const catalog=fixture(),beats=buildFaceoff(players,'jitter',{catalog}),records=[];let clock=0;
  const ctx={state:'running',destination:{},resume:async()=>{},close(){},createGain:()=>({gain:{},connect(){},disconnect(){}}),decodeAudioData:async()=>({duration:60}),
    createBufferSource(){const record={};records.push(record);return{connect(){},disconnect(){},start(at,offset,duration){Object.assign(record,{start:clock,offset,duration});},stop(){record.stop=clock;}};}};
  const voice=createStoryVoice({clipCatalog:catalog,makeContext:()=>ctx,visibility:null,speech:null,fetcher:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})});
  t.after(()=>voice.dispose());await voice.unlock();await voice.preload(beats);
  for(const beat of beats.filter(beat=>beat.clip)){
    clock=beat.at+.38;voice.update({sequenceId:'full',elapsed:clock,beats});
    clock+=beat.clipDuration;voice.update({sequenceId:'full',elapsed:clock,beats});
  }
  clock=faceoffDuration(beats);voice.update({sequenceId:'full',elapsed:clock,beats});
  assert.equal(records.length,7);
  for(const[i,record]of records.entries()){
    const beat=beats.filter(beat=>beat.clip)[i];assert.equal(record.offset,0);assert.equal(record.duration,beat.clipDuration);
    assert.ok(record.stop+1e-8>=record.start+record.duration,'whole delayed recording completes before the next one');
  }
});

test('a cold rematch opener survives a 500ms fetch because the finale warms the next deck first',async t=>{
  const catalog=fixture(),room='AUDIT0',warm=new Set();
  for(let round=1;round<=5;round++)for(const beat of storyVoicePreload({players,room,round,story:{stage:'roundIntro',roundIntro:{round,matchSerial:0}}},{catalog}))warm.add(beat.clip);
  const upcoming=buildRoundIntro(players,room,1,1,{catalog});assert.ok(!warm.has(upcoming.beats[0].clip));
  const started=[],pending=[];
  const ctx={state:'running',destination:{},resume:async()=>{},close(){},createGain:()=>({gain:{},connect(){},disconnect(){}}),decodeAudioData:async()=>({duration:60}),
    createBufferSource:()=>({connect(){},disconnect(){},stop(){},start(...args){started.push(args);}})};
  const voice=createStoryVoice({clipCatalog:catalog,makeContext:()=>ctx,speech:null,visibility:null,
    fetcher:()=>new Promise(resolve=>pending.push(resolve))});t.after(()=>voice.dispose());await voice.unlock();
  const ready=voice.preload(storyVoicePreload({players,room,round:5,phase:'finishing',finish:{stage:'offer'},story:{stage:'complete',roundIntro:{round:5,matchSerial:0}}},{catalog}));
  await Promise.resolve();assert.equal(pending.length,2);
  // Complete the delayed network responses during the server's multi-second
  // finale. The rematch has not begun and no obsolete opening is played.
  voice.update({sequenceId:'finale',elapsed:.5,beats:[],enabled:false});assert.equal(started.length,0);
  for(const resolve of pending)resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});await ready;
  voice.update({sequenceId:'instant-rematch',elapsed:.01,beats:upcoming.beats});
  assert.equal(started.length,1);assert.equal(started[0][1],0);assert.equal(started[0][2],upcoming.beats[0].clipDuration);
});
