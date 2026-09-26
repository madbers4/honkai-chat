import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefereeFeed } from '../src/referee-feed.js';
import { buildFaceoff } from '../shared/faceoff-script.js';
import { buildRoundIntro } from '../shared/round-intro.js';
import { RULE_CARDS, getClubRuleCard } from '../shared/club-story.js';

function dom() {
  const nodes = new Map(), radios = [], globals = new Map();
  const document = { hidden:false, title:'', listeners:{}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {} };
  const make = () => {
    const classes = new Set();
    return { ownerDocument:document, textContent:'', hidden:false, disabled:false, checked:false, value:'', children:[], style:{setProperty(){}}, dataset:{}, listeners:{}, scrollTop:0, clientHeight:200, open:false,
      classList:{add(v){classes.add(v);},remove(v){classes.delete(v);},toggle(v,on){on?classes.add(v):classes.delete(v);},contains:v=>classes.has(v)},
      setAttribute(name,value){this[name]=value;}, appendChild(child){child.parent=this;this.children.push(child);}, append(...children){for(const child of children)this.appendChild(child);},
      replaceChildren(...children){this.children=[];this.append(...children);}, remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);},
      addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}, removeEventListener(){}, focus(){}, close(){this.open=false;},showModal(){this.open=true;},
      async fire(type='click', extra={}){if(!this.disabled)await Promise.all((this.listeners[type]||[]).map(fn=>fn({target:this,preventDefault(){},...extra})));},
      get scrollHeight(){return Math.max(this.clientHeight,this.children.reduce((sum,child)=>sum+child.offsetHeight,0));},
      get offsetHeight(){return this.children.length&&this.className==='ref-feed-track'?this.children.length*120:120;},
      querySelector(selector){
        if(selector.includes('[name="ref-favorite"]'))return radios.find(input=>selector.includes(':checked')?input.checked:selector.includes(`value="${input.value}"`));
        const key=selector.match(/data-ref="(.*?)"/)?.[1]||selector;if(!nodes.has(key))nodes.set(key,make());return nodes.get(key);
      },querySelectorAll(){return radios;},
    };
  };
  document.createElement=make;document.body=make();
  for(const value of ['p1','p2'])radios.push({...make(),value});
  return {document,nodes,radios,make,install(){
    for(const [key,value]of Object.entries({document,location:{href:'http://test/?role=referee&room=ABC234'},history:{replaceState(){}},matchMedia:()=>({matches:false})})){
      globals.set(key,globalThis[key]);globalThis[key]=value;
    }
  },restore(){for(const[key,value]of globals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('stream has bounded plain-text history, deduplicates cues and freezes upward motion', () => {
  const f=dom(),viewport=f.make();viewport.clientHeight=100;const feed=createRefereeFeed(viewport);
  const cue=n=>({id:`cue:${n}`,text:`<robot> line ${n}`,label:'ЭФИР',readSeconds:8});
  for(let n=0;n<10;n++)assert.equal(feed.append(cue(n)),true);
  assert.equal(feed.append(cue(9)),false);assert.equal(viewport.children[0].children.length,8);
  const entries=viewport.children[0].children;assert.equal(entries.at(-1).children[1].textContent,'<robot> line 9');
  assert.equal(entries.at(-1).children[1].innerHTML,undefined);
  const before=viewport.scrollTop;feed.tick(.1,{paused:true,activity:1});assert.equal(viewport.scrollTop,before);
  feed.tick(.1,{activity:1});assert.ok(viewport.scrollTop>before);assert.ok(viewport.scrollTop-before<=4.800001);
  feed.clear();assert.equal(viewport.children[0].children.length,0);feed.dispose();
});

test('recorded subtitles and reduced motion are immediate and manually scrollable', () => {
  const f=dom(),viewport=f.make(),feed=createRefereeFeed(viewport,{reducedMotion:true});
  for(let n=0;n<6;n++)feed.append({id:String(n),text:'Подпись',kind:'recording'});
  assert.equal(viewport.scrollTop,viewport.scrollHeight-viewport.clientHeight);
  viewport.scrollTop=42;feed.tick(.1,{activity:1});assert.equal(viewport.scrollTop,42);feed.dispose();
});

test('referee route prepares sound, shows real dialogue and owns only the round-start ceremony', async t => {
  const {createServer}=await import('vite');
  const vite=await createServer({configFile:false,cacheDir:'artifacts/referee-broadcast-test-cache',server:{middlewareMode:true},appType:'custom'});
  t.after(()=>vite.close());const {mountRefereePage}=await vite.ssrLoadModule('/src/referee-page.js');
  const f=dom();f.install();
  const voices=[],sounds=[],music=[],favoriteRequests=[];let handlers,starts=0,preparations=0,cancelled=0,roundStarts=0,raf,preparationFails=true;
  const audio={muted:true,unlock(){},toggle(){return this.muted=!this.muted;},async prepareCombat(){preparations++;},play(type){sounds.push(type);},updateMusic(s,m){music.push([s,m]);},resetMusic(){},stop(){},disposeMusic(){}};
  const voice={unlock:async()=>true,prepareAll:async()=>{preparations++;if(preparationFails)throw Error('Записи не загрузились. Повторите подготовку.');},update:v=>voices.push(v),cancel(){cancelled++;},setMuted(){},dispose(){}};
  const page=mountRefereePage({room:'ABC234',waitForLayout:async()=>{},createAudioImpl:()=>audio,createVoiceImpl:()=>voice,requestFrame:fn=>{raf=fn;return 1;},cancelFrame(){},
    createArenaImpl:async()=>({update(){},prepareCombat:async()=>{},dispose(){}}),
    createClientImpl:options=>{handlers=options;return{start(){starts++;},stop(){},markReady(){return true;},setFavorite:id=>{favoriteRequests.push(id);return true;},startRound(){roundStarts++;return true;}};}});
  t.after(()=>{page.dispose();f.restore();});
  assert.equal(starts,0,'saved links still need an audio gesture');
  const markup=f.document.body.children[0].innerHTML;
  assert.doesNotMatch(markup,/data-ref="(?:ack|variation)"|Следите за ареной|Следим за ареной|Полный нейтралитет/);
  await f.nodes.get('form').fire('submit');assert.equal(starts,1);assert.equal(preparations,0);
  handlers.onStatus({status:'connected'});handlers.onFavorite(null);assert.deepEqual(favoriteRequests,[]);
  const players=[{id:'p1',name:'ИСКРА',hp:180,maxHp:180,wins:0},{id:'p2',name:'ИНЕЙ',hp:180,maxHp:180,wins:0}];
  const base={room:'ABC234',round:1,phase:'story',time:99,players,events:[]};
  const send=(story,patch={},meta={baseline:false,freshEvents:[]})=>handlers.onSnapshot({...base,story,...patch},meta);
  const latest=()=>f.nodes.get('feed').children[0].children.at(-1);
  send({stage:'workshop',sequenceId:'setup'});assert.equal(f.nodes.get('favorite2').textContent,'ИНЕЙ');
  await f.nodes.get('form').fire('submit');assert.equal(preparations,0);assert.match(f.nodes.get('joinMessage').textContent,/фаворита/);
  f.radios[1].checked=true;await f.nodes.get('form').fire('submit');assert.equal(preparations,2);
  assert.equal(f.nodes.get('join').hidden,false);assert.match(f.nodes.get('joinMessage').textContent,/Записи не загрузились/);
  assert.deepEqual(favoriteRequests,[],'failed preparation cannot release the opening');
  preparationFails=false;await f.nodes.get('form').fire('submit');assert.equal(preparations,4);assert.equal(audio.muted,false);
  assert.deepEqual(favoriteRequests,['p2']);handlers.onFavorite('p2',{prepared:false});handlers.onFavorite('p2',{prepared:true});assert.equal(f.nodes.get('join').hidden,true);
  for(let index=0;index<RULE_CARDS.length;index++){
    send({stage:'rules',ruleIndex:index,sequenceId:'rules',duration:40});
    assert.equal(latest().children[1].textContent,getClubRuleCard(index,players).readAloud);
    assert.equal(f.nodes.get('gate').hidden,true);
  }
  const faceoff=buildFaceoff(players,'ABC234');
  for(const beat of faceoff){
    send({stage:'faceoff',sequenceId:'opening',elapsed:beat.at+.01});
    assert.equal(latest().children[1].textContent,beat.text);assert.equal(voices.at(-1).enabled,true);
    assert.equal(voices.at(-1).sequenceId,'faceoff:opening:broadcast:1');
  }
  const intro=buildRoundIntro(players,'ABC234',2,0);
  for(const beat of intro.beats){
    send({stage:'roundIntro',roundIntro:{sequenceId:'round:2',round:2,matchSerial:0,elapsed:beat.at+.01}});
    assert.equal(latest().children[1].textContent,beat.text);assert.equal(voices.at(-1).enabled,true);
  }
  const gate={stage:'refereeIntro',refereeIntro:{sequenceId:'gate:2',round:2}};
  send(gate,{round:2});assert.equal(f.nodes.get('gate').hidden,false);assert.equal(f.nodes.get('clock').textContent,'—');
  const lead=latest().children[1].textContent;assert.ok(lead.length>20);assert.match(f.nodes.get('favoriteStatus').textContent,/ИНЕЙ/);
  await f.nodes.get('startRound').fire();await f.nodes.get('startRound').fire();assert.equal(roundStarts,1);
  send({...gate,paused:true},{round:2});assert.equal(f.nodes.get('startRound').disabled,true);
  send({stage:'complete'},{phase:'fight'},{baseline:false,freshEvents:[{id:1,type:'hit',target:'p2'}]});assert.deepEqual(sounds,['hit']);
  send({stage:'complete'},{phase:'countdown',countdown:3,players:players.map(p=>({...p,action:'recover'}))});
  send({stage:'complete'},{phase:'countdown',countdown:2.9});
  send({stage:'complete'},{phase:'countdown',countdown:2});
  send({stage:'complete'},{phase:'fight'});
  send({stage:'complete'},{phase:'matchOver',winner:'p2'});
  const allSounds=['hit','recover','countdown','countdown','fight','win'];assert.deepEqual(sounds,allSounds);
  f.document.hidden=true;for(const callback of f.document.listeners.visibilitychange)callback();const cancelledBefore=cancelled;
  send({stage:'faceoff',sequenceId:'hidden',elapsed:0});assert.equal(voices.at(-1).paused,true);
  send({stage:'complete'},{phase:'fight'},{baseline:false,freshEvents:[{id:2,type:'explosion'}]});assert.deepEqual(sounds,allSounds);
  assert.ok(cancelled>=cancelledBefore);f.document.hidden=false;
  handlers.onStatus({status:'reconnecting'});raf(100);assert.equal(f.nodes.get('feed').dataset.paused,'true');
  assert.equal(music.at(-1)[1].connected,false);
});
