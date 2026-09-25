import test from 'node:test';
import assert from 'node:assert/strict';
import { combatVoiceCue, createCombatVoice } from '../src/combat-voice.js';
import { VOICE_CLIPS } from '../shared/voice-clips.js';

function fixture() {
  const sources = [], gain = () => ({ connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} } });
  const context = { currentTime: 0, state: 'running', createGain: gain, decodeAudioData: async () => ({ duration: 20 }),
    createBufferSource() { const source = { connect() {}, disconnect() {}, start(...args) { this.started = args; }, stop(...args) { this.stopped = args; } }; sources.push(source); return source; } };
  return { context, sources, destination: gain(), fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) };
}

test('actor cue roles are fixed, variants differ and every edit fits the supplied recording', () => {
  for (const player of ['p1','p2']) for (const variant of ['jab','cross','rake','heavyDrive','heavyHook','heavyPress','airFinish','slam']) {
    const cue = combatVoiceCue({ type: 'attack', player, variant });
    assert.equal(cue.actor, player === 'p1' ? 'jotaro' : 'dio');
    assert.ok(cue.offset >= 0 && cue.offset + cue.duration <= VOICE_CLIPS[cue.clip].duration);
  }
  assert.equal(combatVoiceCue({type:'attack',player:'invented'}), null);
  assert.equal(combatVoiceCue({type:'hit',player:'p1'}), null, 'impact does not duplicate its attack voice');
});
test('only one voice per actor; old fade completion cannot remove its replacement', async () => {
  const f=fixture(), voice=createCombatVoice(f); await voice.preload();
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab',presentationHistorical:true}),false);
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),true);
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);
  f.context.currentTime=.4; voice.play({type:'attack',player:'p1',variant:'cross'});
  assert.equal(voice.stats().active,1); assert.equal(voice.stats().fading,1);
  f.sources[0].onended(); assert.equal(voice.stats().active,1); assert.equal(voice.stats().fading,0);
  voice.play({type:'attack',player:'p2',variant:'jab'}); assert.equal(voice.stats().active,2);
  voice.play({type:'ko',player:'p1'}); assert.equal(voice.stats().active,1);
  voice.stop(); assert.equal(voice.stats().active,0); voice.dispose();
});
test('late audio never replays an old hit; mute, pause and disposal stop future playback', async () => {
  const f=fixture(); let resolveFetch, muted=false;
  const voice=createCombatVoice({...f,muted:()=>muted,fetcher:()=>new Promise(r=>{resolveFetch=r;})});
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);
  resolveFetch({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
  await new Promise(r=>setTimeout(r,0)); assert.equal(f.sources.length,0);
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),true);
  muted=true; voice.stop(); f.context.currentTime=1;
  assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);
  muted=false; f.context.state='suspended'; assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);
  voice.dispose(); f.context.state='running'; assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);
});
test('failed optional audio is bounded to two attempts and never blocks synthesis fallback', async () => {
  const f=fixture(); let calls=0;
  const voice=createCombatVoice({...f,fetcher:async()=>{calls++;throw Error('offline');}});
  for(let i=0;i<5;i++){assert.equal(voice.play({type:'attack',player:'p1',variant:'jab'}),false);await new Promise(r=>setTimeout(r,0));}
  assert.equal(calls,2); voice.dispose();
});
