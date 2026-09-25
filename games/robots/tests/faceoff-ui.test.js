import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceoffUI } from '../src/faceoff-ui.js';
import { buildFaceoff, FACE_OFF_DURATION, faceoffActorX } from '../shared/faceoff-script.js';
import { faceoffPowerEnvelope } from '../src/faceoff-choreography.js';
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.attrs={};this.classList={toggle:(key,value)=>{this[key]=value;}};}
  setAttribute(key,value){this.attrs[key]=value;} append(...children){this.children.push(...children);children.forEach(c=>c.parent=this);}
  remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);} set innerHTML(_){throw Error('User content must not use HTML parsing');}
}
const doc={createElement:tag=>new Element(tag,doc)};
const find=(root,name)=>root.className?.split(' ').includes(name)?root:root.children.map(c=>find(c,name)).find(Boolean);
test('real names stay present through establishment, mode, quoted recordings and final stance',()=>{
  const mount=new Element('main',doc),ui=createFaceoffUI(mount);
  const players=[{id:'p1',name:'<img src=x onerror=alert(1)>'},{id:'p2',name:'Медный Сом'}],beats=buildFaceoff(players,42);
  const update=(elapsed,patch={})=>ui.update({active:true,sequenceId:'same',elapsed,players:players.map((p,i)=>({...p,x:faceoffActorX(i,elapsed)})),beats,...patch});
  update(.5);assert.equal(ui.element.hidden,false);assert.equal(ui.element.dataset.chapter,'establish');
  assert.equal(find(ui.element,'faceoff-real-name').textContent,players[0].name);assert.equal(find(ui.element,'faceoff-line').textContent,beats[0].text);
  update(beats.find(beat=>beat.shot==='core').at+1);assert.equal(ui.element.dataset.chapter,'mode');assert.equal(find(ui.element,'faceoff-heading').textContent,'БОЕВАЯ ГОТОВНОСТЬ');assert.equal(ui.element.dataset.shot,'core');
  assert.equal(find(ui.element,'faceoff-mechanism').hidden,false);assert.equal(find(ui.element,'faceoff-speaker').textContent,players[0].name);
  update(beats.find(beat=>beat.chapter==='dialogue').at+1);assert.equal(ui.element.dataset.chapter,'dialogue');assert.equal(find(ui.element,'faceoff-real-name').textContent,players[0].name);
  assert.match(find(ui.element,'faceoff-identity-state').textContent,/РОЛЬ В ДУЭЛИ/);assert.equal(find(ui.element,'faceoff-mechanism').hidden,true);
  const pausedAt=FACE_OFF_DURATION*.7;
  update(pausedAt,{paused:true,reducedMotion:true});assert.equal(ui.element.dataset.reduced,'true');assert.equal(ui.element.dataset.shot,'wide');
  assert.equal(find(ui.element,'faceoff-countdown').textContent,'ЖДЁМ ВОЗВРАЩЕНИЯ СОПЕРНИКА');assert.equal(find(ui.element,'faceoff-progress-fill').style.transform,`scaleX(${pausedAt/FACE_OFF_DURATION})`);
  update(beats.at(-1).at+.1);assert.equal(ui.element.dataset.chapter,'ready');update(FACE_OFF_DURATION,{active:false});assert.equal(ui.element.hidden,true);ui.dispose();ui.dispose();assert.equal(mount.children.length,0);
});

test('startup power envelopes are bounded, deterministic and do not invent gameplay energy',()=>{
  for(const variant of['reactor','actuators','armed','point'])for(const reducedMotion of[false,true])for(let i=0;i<=210;i++){
    const t=i/60,actual=faceoffPowerEnvelope(variant,t,3.5,{reducedMotion});
    assert.deepEqual(actual,faceoffPowerEnvelope(variant,t,3.5,{reducedMotion}));
    assert.ok(Object.values(actual).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    if(variant==='point')assert.deepEqual(actual,{core:0,drives:0,armed:0});
  }
  assert.deepEqual(faceoffPowerEnvelope('reactor',4,3.5),{core:0,drives:0,armed:0});
  assert.ok(faceoffPowerEnvelope('reactor',1.5,3.5).core>.99);
});
