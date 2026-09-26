import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefereeDirector, buildRefereeRoundLead } from '../shared/referee-director.js';
import { REFEREE_LINES } from '../shared/referee-lines.js';
import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';

const base = (patch={}) => ({room:'READ23',round:1,phase:'fight',elapsed:10,time:60,events:[],
  players:[{id:'p1',name:'Кабачок',hp:MAX_HP,maxHp:MAX_HP,wins:0,action:'idle'},
    {id:'p2',name:'Сковорода',hp:MAX_HP,maxHp:MAX_HP,wins:0,action:'idle'}],...patch});
const hits = (id,type='hit',patch={}) => ({id,type,player:'p1',target:'p2',variant:'jab',...patch});
function advance(director,seconds,visit=()=>{}) { let out; for(let n=0;n<Math.ceil(seconds*10);n++){out=director.tick(.1);visit(out);}return out; }

test('a frozen workshop simulation keeps a varied automatic human feed without any acknowledgement', () => {
  const director=createRefereeDirector({seed:712,favorite:'p1',realtime:true});
  const state=base({phase:'story',story:{stage:'workshop',sequenceId:'opening'}}),before=JSON.stringify(state);
  const seen=[],categories=new Set();let last;
  const collect=out=>{if(out.current&&out.current.id!==last){
    last=out.current.id;const line=last.split(':').at(-1);
    assert.ok(!seen.slice(-24).includes(line));seen.push(line);categories.add(out.current.category);
    assert.ok(out.current.readSeconds>=4.6);assert.ok(!out.current.text.includes('{'));
  }};
  collect(director.update(state));advance(director,220,collect);
  assert.ok(seen.length>=23,`continued talk across three minutes: ${seen.length}`);
  assert.ok(categories.has('workshop')&&categories.has('introduction')&&categories.has('banter'));
  assert.equal(JSON.stringify(state),before);
});

test('tick owns presentation time in realtime mode and never double-counts network snapshots', () => {
  const director=createRefereeDirector({realtime:true});director.update(base());
  const one=director.update(base({elapsed:10.05}));
  assert.equal(one.clock,10);
  const two=director.tick(.1);assert.equal(two.clock,10.1);
  assert.equal(director.update(base({elapsed:10.1})).clock,10.1);
  assert.ok(director.tick(100).clock<=10.35+.00001,'returning from a hidden tab cannot fast-forward pages of copy');
});

test('event storms keep one readable line and reserve the next slot for the stronger fresh fact', () => {
  const director=createRefereeDirector({seed:8,favorite:'p1',realtime:true});director.update(base());
  const first=director.update(base({events:[hits(1)]})).current;
  for(let id=2;id<=40;id++){
    const events=[hits(id)];if(id===5)events.push(hits(100,'parry',{player:'p2',target:'p1'}));
    // Keep IDs monotonic like a real server; repeated old IDs are deliberately ignored.
    const out=director.update(base({elapsed:10+id/100,events}));director.tick(.02);
    assert.equal(out.current.id,first.id);
  }
  let next=director.update(base({elapsed:10.5,events:[hits(101,'parry',{player:'p2',target:'p1'})]}));
  assert.equal(next.next.category,'parry');
  const stableId=next.next.id,stableSeconds=next.next.readSeconds;
  next=director.update(base({elapsed:10.5,events:[]}));
  assert.equal(next.next.id,stableId);assert.equal(next.next.readSeconds,stableSeconds);
  const published=[];advance(director,first.readSeconds,out=>{if(out.current?.id!==first.id&&out.current)published.push(out.current);});
  assert.ok(published.some(cue=>cue.category==='parry'),'a shower of weak hits cannot bury a parry');
});

test('charge callouts expire when the charge is cancelled and recognize the actual interrupting hit', () => {
  const director=createRefereeDirector({seed:4,realtime:true});director.update(base());
  const first=director.update(base({events:[hits(1)]})).current;
  const charging=base({elapsed:10.1,events:[hits(2,'ultimate',{player:'p2',target:'p1'})]});
  charging.players[1].action='ultimate';charging.players[1].actionTime=.1;
  assert.equal(director.update(charging).next.category,'ultimateCharge');
  const broken=base({elapsed:10.2,events:[hits(3)]});broken.players[1].action='hit';broken.players[1].hp-=10;
  const out=director.update(broken);
  assert.equal(out.current.id,first.id);assert.equal(out.next.category,'ultimateInterrupted');
  assert.equal(out.next.sourceEventId,3);
  const seen=[];advance(director,7,out=>{if(out.current?.id!==first.id&&out.current)seen.push(out.current.category);});
  assert.ok(!seen.includes('ultimateCharge'),'the host must not announce a cancelled charge as still charging');
});

test('whiffing attacks count as activity but cannot manufacture successful contacts or quiet-pose commentary', () => {
  const director=createRefereeDirector({realtime:true});director.update(base());const categories=new Set();let activity;
  for(let id=1;id<100;id++){
    director.update(base({elapsed:10+id*.15,events:[hits(id,'attack')]}));
    const out=director.tick(.15);activity=out.activity;if(out.current)categories.add(out.current.category);
  }
  assert.ok(activity>.5);assert.ok(!categories.has('hit'));assert.ok(!categories.has('quiet'));
});

test('canonical cards and actor dialogue exclusively own their stages, including the manual round gate', () => {
  for(const stage of ['rules','faceoff','roundIntro','refereeIntro']){
    const director=createRefereeDirector({realtime:true});director.update(base({phase:'waiting'}));
    const state=base({phase:'story',story:{stage,sequenceId:'same-opening',ruleIndex:0},events:[hits(123)]});
    assert.equal(director.update(state).current,null);
    const out=advance(director,90);assert.equal(out.current,null);assert.equal(out.next,null);
  }
});

test('pause freezes reading and reconnect / stale transport gaps do not retell missed hits', () => {
  const director=createRefereeDirector({realtime:true});director.update(base());director.update(base({events:[hits(1)]}));
  const pause=director.update(base({phase:'paused',elapsed:10.1}));
  assert.equal(pause.current.category,'disconnect');assert.deepEqual(advance(director,50),pause);
  const resume=director.update(base({elapsed:14,events:[hits(2)]}));
  assert.equal(resume.current.category,'reconnect');assert.equal(resume.next,null);
  advance(director,8);
  const gap=director.update(base({elapsed:30,events:[hits(3)]}));
  assert.equal(gap.current,null);assert.equal(gap.next,null);
  assert.equal(director.update(base({elapsed:30,events:[hits(3)]})).current,null);
});

test('match point, a real losing streak and equal match points come from score changes, not the favorite', () => {
  const director=createRefereeDirector({realtime:true,favorite:'p2'});
  let state=base();state.players[0].wins=2;director.update(state);
  for(let round=1;round<=2;round++){
    state=base({round,elapsed:10+round*.3,phase:'fight'});state.players[0].wins=round+1;
    director.update(state);
    const end=structuredClone(state);end.phase='roundOver';end.roundWinner='p1';end.players[0].wins++;end.players[1].hp=0;
    end.events=[hits(round*10,'ko',{player:'p2',target:'p2',winner:'p1'})];
    const out=director.update(end);
    if(round===2){
      const cues=[];advance(director,22,item=>{if(item.current)cues.push(item.current.category);});
      assert.ok(cues.includes('matchPoint'));assert.ok(cues.includes('losingStreak'));
    } else assert.equal(out.current.category,'ko');
    director.acknowledge();
  }
  const tied=base({elapsed:11,round:3,phase:'roundOver',roundWinner:'p2'});tied.players.forEach(p=>p.wins=WINS_TO_MATCH-1);
  const equal=director.update(tied);
  assert.ok([equal.current,equal.next].some(cue=>cue?.category==='duelPoint'));
});

test('victory and the losing fighter get their own complete reading before the closing prompts', () => {
  const director=createRefereeDirector({seed:3,realtime:true,favorite:'p2'});director.update(base());
  const result=base({phase:'matchOver',winner:'p1',roundWinner:'p1'});result.players[0].wins=5;result.players[1].wins=2;
  const seen=[];let previousId;
  const collect=out=>{if(out.current&&out.current.id!==previousId){previousId=out.current.id;seen.push(out.current);}};
  collect(director.update(result));advance(director,60,collect);
  assert.equal(seen[0].category,'win');assert.equal(seen[1].category,'loss');
  assert.ok(seen.some(cue=>cue.category==='curtain'));assert.ok(seen[0].text.includes('Кабачок'));
});

test('favorite changes emotional wording consistently without changing facts or leaking preference metadata', () => {
  let different=0;
  for(let seed=0;seed<30;seed++){
    const one=createRefereeDirector({seed,favorite:'p1'}),two=createRefereeDirector({seed,favorite:'p2'});
    const state=base(),hit=base({events:[hits(1,'parry')]});const source=JSON.stringify(hit);
    one.update(state);two.update(state);
    const a=one.update(hit),b=two.update(hit);
    assert.equal(a.current.category,b.current.category);assert.equal(a.current.sourceEventId,b.current.sourceEventId);
    if(a.current.text!==b.current.text)different++;
    assert.ok(!/favorite|favored|opposed|targetId|actorId/.test(JSON.stringify({...a,current:{...a.current,text:''}})));
    assert.equal(JSON.stringify(hit),source);
  }
  assert.equal(different,30,'the secret side should be audible in all fresh favorable/adverse observations');
});

test('round lead is stable, private, side-aware and safe for arbitrary player names and reordered rosters', () => {
  const state=base({round:7,story:{stage:'refereeIntro',refereeIntro:{sequenceId:'room:match1:round7'}}});
  state.players[0].name='<script>{b}\u202eКабачок';state.players[0].wins=4;state.players[1].wins=2;
  const frozen=JSON.stringify(state),a=buildRefereeRoundLead(state,'p1'),b=buildRefereeRoundLead(state,'p2');
  assert.equal(a,buildRefereeRoundLead(state,'p1'));assert.notEqual(a,b);
  assert.ok(/матчпойнт|шаге от победы/i.test(a));assert.ok(/Матчпойнт|одна победа/.test(b));
  assert.ok(!/[<>\u202e{}]/u.test(a+b));assert.ok(!/undefined|NaN/.test(a+b));
  const reordered={...state,players:[...state.players].reverse()};assert.equal(buildRefereeRoundLead(reordered,'p1'),a);
  assert.equal(JSON.stringify(state),frozen);
  state.players[1].wins=4;const decider=buildRefereeRoundLead(state,'p1');assert.match(decider,/Решающий|Четыре — четыре/);
});

test('every partisan context offers sympathy as well as grudging recognition, with no invented damage in pulses', () => {
  for(const category of ['lowHp','comeback','leadChange','matchPoint','losingStreak','parry','heavySeries','win','loss']){
    const lines=REFEREE_LINES.filter(line=>line.category===category);
    assert.equal(lines.filter(line=>line.bias==='favored').length,2);assert.equal(lines.filter(line=>line.bias==='opposed').length,2);
  }
  assert.ok(REFEREE_LINES.filter(line=>line.category==='ultimatePulse').every(line=>!/нанёс|пробил|попал!/u.test(line.text)));
});
