import { MAX_HP, WINS_TO_MATCH, ATTACKS } from './constants.js';
import { formatClubText } from './club-story.js';
import { REFEREE_LINES, REFEREE_CATEGORIES } from './referee-lines.js';
export { buildRefereeRoundLead } from './referee-round-lead.js';

const HISTORY = 24, EVENT_HISTORY = 256, QUEUE_LIMIT = 4;
const SCRIPTED = new Set(['rules','faceoff','roundIntro','refereeIntro']);
const RESULT = new Set(['ko','timeout','tie','leadChange','losingStreak','matchPoint','duelPoint','finale','destruction','win','loss']);
const FILLER = new Set(['workshop','quiet','banter','betweenRounds','curtain']);
const paused = s => s?.phase === 'paused' || Boolean(s?.story?.paused);
const scripted = s => SCRIPTED.has(s?.story?.stage);
const leader = players => players?.length === 2 && players[0].wins !== players[1].wins
  ? (players[0].wins > players[1].wins ? players[0].id : players[1].id) : null;
const seedNumber = value => [...String(value)].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261)||1;
const copyState = s => ({ room:s.room,round:s.round,phase:s.phase,time:s.time,winner:s.winner,roundWinner:s.roundWinner,
  elapsed:s.elapsed,paused:paused(s),story:s.story ? {...s.story} : null,
  players:s.players.map(p=>({...p})) });

/** A local teleprompter, not a combat participant. realtime:true uses tick(dt)
 * from the visible referee page; otherwise recorded snapshot time drives it.
 * Unchanged current/next cue IDs and timing never reroll during a read. */
export function createRefereeDirector({ seed=1, favorite='neutral', realtime=false }={}) {
  let randomState,favoriteId,previous,latest,rawTime,clock,highWater,seen,history,queue,current,currentContext;
  let serial,categoryAt,deficits,lastPublication,lastAction,activity,collecting,pendingCritical,streakOwner,streak;
  let nextSlot;
  const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)/4294967296;};
  function reset() {
    randomState=seedNumber(seed);previous=latest=null;rawTime=null;clock=0;highWater=-1;
    seen=new Set();history=[];queue=[];current=currentContext=null;serial=0;categoryAt=new Map();deficits=new Set();
    lastPublication=lastAction=0;activity=0;collecting=false;pendingCritical=null;streakOwner=null;streak=0;nextSlot=0;
    return output();
  }
  function setFavorite(id) {
    const next=id==='p1'||id==='p2'?id:'neutral';
    if (favoriteId!==next) queue=[]; // Never show a queued interpretation of the old secret choice.
    favoriteId=next;return output();
  }
  function context(snapshot,actorId,targetId) {
    const players=snapshot.players||[],a=players.find(p=>p.id==='p1'),b=players.find(p=>p.id==='p2');
    return {actorId,targetId,round:snapshot.round,values:{actor:players.find(p=>p.id===actorId)?.name,
      target:players.find(p=>p.id===targetId)?.name,a:a?.name,b:b?.name,
      winner:players.find(p=>p.id===snapshot.winner)?.name,loser:players.find(p=>p.id!==snapshot.winner)?.name,
      round:snapshot.round,score:`${Number(a?.wins)||0} : ${Number(b?.wins)||0}`}};
  }
  function choose(candidate,variation=false) {
    const bias=favoriteId!=='neutral'&&candidate.actorId===favoriteId?'favored'
      :favoriteId!=='neutral'&&candidate.targetId===favoriteId?'opposed':'any';
    const options=REFEREE_LINES.filter(line=>line.category===candidate.category&&!history.includes(line.id)
      &&(line.bias==='any'||line.bias===bias));
    if(!options.length)return null;
    const personal=options.filter(line=>line.bias===bias&&bias!=='any');
    const available=personal.length?personal:options,line=available[Math.floor(random()*available.length)];
    return {...candidate,lineId:line.id,text:formatClubText(line.text,candidate.values),variation};
  }
  function readSeconds(text) {
    const words=text.split(/\s+/u).length,stops=(text.match(/[.!?—]/gu)||[]).length;
    // More activity trims pauses, not the actual time a human needs to speak.
    return Math.round(Math.max(4.6,Math.min(10.5,1+words/(2.65+activity*.3)+stops*.11))*100)/100;
  }
  const cue=(candidate,id,startedAt=null)=>Object.freeze({id,text:candidate.text,category:candidate.category,
    priority:candidate.priority,readSeconds:candidate.readSeconds,startedAt,
    expiresAt:startedAt===null?candidate.freshUntil:startedAt+candidate.readSeconds,sourceEventId:candidate.sourceEventId??null});
  function fresh(item) {
    if(!item||!latest||item.freshUntil<clock)return false;
    const actor=latest.players.find(p=>p.id===item.actorId),other=latest.players.find(p=>p.id!==item.actorId);
    if(item.category==='disconnect')return paused(latest);
    if(item.category==='reconnect')return !paused(latest);
    if(paused(latest)||scripted(latest))return false;
    if(item.category==='introduction'||item.category==='workshop')return latest.phase==='waiting'||latest.story?.stage==='workshop';
    if(item.category==='banter')return ['waiting','fight','matchOver'].includes(latest.phase)||latest.story?.stage==='workshop';
    if(item.category==='curtain'||item.category==='win'||item.category==='loss')return latest.phase==='matchOver';
    if(item.category==='betweenRounds')return latest.phase==='roundOver';
    if(item.category==='leadChange')return !latest.winner&&leader(latest.players)===item.actorId;
    if(item.category==='matchPoint')return !latest.winner&&actor?.wins===WINS_TO_MATCH-1&&other?.wins<WINS_TO_MATCH-1;
    if(item.category==='duelPoint')return !latest.winner&&latest.players.length===2&&latest.players.every(p=>p.wins===WINS_TO_MATCH-1);
    if(item.category==='losingStreak')return !latest.winner&&streak>=2&&streakOwner!==item.actorId;
    if(RESULT.has(item.category))return item.round===latest.round&&['roundOver','finishing','matchOver'].includes(latest.phase);
    if(latest.phase!=='fight'||item.round!==latest.round)return false;
    if(item.category==='quiet')return clock-lastAction>=5;
    if(item.category==='lowHp')return actor?.hp>0&&actor.hp<=(actor.maxHp||MAX_HP)*.25;
    if(item.category==='comeback')return actor?.hp>other?.hp&&other.hp>0;
    if(item.category==='ultimateCharge')return actor?.action==='ultimate'&&(actor.actionTime||0)<ATTACKS.ultimate.startup;
    return true;
  }
  function output() {
    const next=queue.find(fresh);
    return Object.freeze({current,next:next?cue(next,`pending:${next.key}`):null,
      activity:Math.round(activity*1000)/1000,clock,paused:paused(latest)});
  }
  function publish(candidate) {
    if(!fresh(candidate))return;
    // A pending fact keeps its event, but names and scoreboard are fresh when
    // spoken. Editing a workshop name cannot announce a stale old passport.
    candidate={...candidate,...context(latest,candidate.actorId,candidate.targetId)};
    if(history.includes(candidate.lineId))candidate=choose(candidate);
    else candidate={...candidate,text:formatClubText(REFEREE_LINES.find(l=>l.id===candidate.lineId).text,candidate.values)};
    if(!candidate)return;
    candidate.readSeconds=readSeconds(candidate.text);
    history.push(candidate.lineId);if(history.length>HISTORY)history.shift();
    categoryAt.set(candidate.category,clock);currentContext=candidate;
    current=cue(candidate,`referee:${++serial}:${candidate.lineId}`,clock);
    lastPublication=clock;nextSlot=current.expiresAt+.6+(1-activity)*.75;
  }
  function drain() {
    queue=queue.filter(fresh);
    if(current&&clock<current.expiresAt)return;
    current=null;currentContext=null;
    if(clock<nextSlot&&!queue.some(c=>c.priority>=60))return;
    while(!current&&queue.length)publish(queue.shift());
  }
  function enqueue(category,ctx,sourceEventId,key=`${category}:${sourceEventId??serial}`,critical=false) {
    const definition=REFEREE_CATEGORIES[category];
    if(!definition||queue.some(item=>item.key===key)||currentContext?.key===key)return;
    const cooldown=FILLER.has(category)?13:['hit','block'].includes(category)?12:6;
    if(!critical&&clock-(categoryAt.get(category)??-Infinity)<cooldown)return;
    const ttl=['ultimateCharge','defense'].includes(category)?2.1:RESULT.has(category)?22:FILLER.has(category)?16:definition.priority>=48?11:7;
    const candidate=choose({...ctx,category,key,priority:definition.priority,sourceEventId,freshUntil:clock+ttl});
    if(!candidate)return;
    candidate.readSeconds=readSeconds(candidate.text);
    if(critical&&collecting){
      if(!pendingCritical||candidate.priority>=pendingCritical.priority)pendingCritical=candidate;
      return;
    }
    if(critical)queue=queue.filter(item=>RESULT.has(item.category)&&item.priority<100);
    if(category==='throw')queue=queue.filter(item=>!['grab','pummel'].includes(item.category));
    if(category==='ultimatePulse'||category==='ultimateInterrupted')queue=queue.filter(item=>item.category!=='ultimateCharge');
    queue=queue.filter(item=>item.category!==category);
    queue.push(candidate);queue.sort((a,b)=>b.priority-a.priority||b.freshUntil-a.freshUntil);queue=queue.slice(0,QUEUE_LIMIT);
  }
  function noteEvent(id) {
    if(typeof id==='number'&&Number.isFinite(id))highWater=Math.max(highWater,id);
    seen.add(id);if(seen.size>EVENT_HISTORY)seen.delete(seen.values().next().value);
  }
  function baseline(snapshot) {
    for(const event of snapshot.events||[])noteEvent(event.id);
    previous=copyState(snapshot);rawTime=Number.isFinite(snapshot.elapsed)?snapshot.elapsed:null;
  }
  function eventCandidate(event,snapshot) {
    if(['attack','special','dash','land','slam'].includes(event.type)) {
      lastAction=clock;activity=Math.min(1,activity+.05);
    }
    let actor=event.player,target=event.target??snapshot.players.find(p=>p.id!==event.player)?.id,category;
    if(event.type==='round'){if(event.fight){category='roundStart';actor=favoriteId;target=snapshot.players.find(p=>p.id!==actor)?.id;}}
    else if(event.type==='parry')category='parry';
    else if(event.type==='block'){category=event.guardBreak?'guardBreak':'block';if(!event.guardBreak)[actor,target]=[target,actor];}
    else if(event.type==='grab')category='grab';
    else if(event.type==='grabStrike')category='pummel';
    else if(event.type==='throw')category='throw';
    else if(event.type==='grabBreak'&&event.reason==='tech')category='grabBreak';
    else if(event.type==='burst')category='burst';
    else if(event.type==='feint')category='feint';
    else if(event.type==='ultimate')category='ultimateCharge';
    else if(event.type==='ultimatePulse')category='ultimatePulse';
    else if(event.type==='launch'&&event.variant!=='shockwave')category='airLaunch';
    else if(event.type==='ko'&&snapshot.time>0){category='ko';actor=event.winner;target=event.target;}
    else if(event.type==='finisherStart')category='finale';
    else if(event.type==='destruction')category='destruction';
    else if(event.type==='hit'){
      if(event.punish)category='whiffPunish';
      else if(event.variant==='slam')category='slam';
      else if(event.variant==='shockwave')category='mine';
      else if(event.variant==='bolt'||event.action==='special')category='impulse';
      else if(['heavyHook','heavyPress'].includes(event.variant))category='heavySeries';
      else if(event.variant==='heavyDrive'){category='defense';[actor,target]=[target,actor];}
      else if(['grab','overload','launcher'].includes(event.variant))return;
      else category=event.airborne?'airCombo':'hit';
    }
    if(!category)return;
    lastAction=clock;activity=Math.min(1,activity+(REFEREE_CATEGORIES[category].priority>=60?.22:.09));
    enqueue(category,context(snapshot,actor,target),event.id,`${category}:${event.id}`,['ko','finale','destruction'].includes(category));
    if(['hit','grab','launch'].includes(event.type)){
      const before=previous.players.find(p=>p.id===event.target),now=snapshot.players.find(p=>p.id===event.target);
      if(before?.action==='ultimate'&&before.actionTime<ATTACKS.ultimate.startup&&now?.action!=='ultimate')
        enqueue('ultimateInterrupted',context(snapshot,event.player,event.target),event.id,`interrupt:${event.id}`);
    }
  }
  function clockDelta(snapshot) {
    if(Number.isFinite(snapshot.elapsed))return rawTime==null?0:snapshot.elapsed-rawTime;
    if(snapshot.round===previous.round&&snapshot.phase==='fight'&&previous.phase==='fight')return Math.max(0,previous.time-snapshot.time);
    return 0;
  }
  function advanceClock(dt) { clock+=dt;activity*=Math.exp(-dt/5); }
  function fillSilence() {
    if(!latest||paused(latest)||scripted(latest)||latest.players.length<2||current||queue.length||clock<nextSlot)return;
    const idle=clock-lastPublication,phase=latest.phase;
    let candidates;
    if(phase==='waiting'||latest.story?.stage==='workshop')candidates=['workshop','banter','introduction'];
    else if(phase==='matchOver')candidates=['curtain','banter','loss','win'];
    else if(phase==='roundOver')candidates=['betweenRounds'];
    else if(phase==='fight'&&idle>1.5)candidates=clock-lastAction>5?['quiet','banter']:['banter'];
    if(!candidates)return;
    // Different kinds of prompts alternate; exhausted pools don't loop the same
    // joke, and at most one filler is produced per readable slot.
    const start=Math.floor(random()*candidates.length);
    for(let i=0;i<candidates.length;i++){
      const category=candidates[(start+i)%candidates.length];
      let actor,target;
      if(category==='win'){actor=latest.winner;target=latest.players.find(p=>p.id!==actor)?.id;}
      if(category==='loss'){target=latest.winner;actor=latest.players.find(p=>p.id!==target)?.id;}
      enqueue(category,context(latest,actor,target),null,`fill:${category}:${serial}`);
      if(queue.length)break;
    }
  }
  function tick(dt) {
    if(!realtime||!latest||paused(latest)||!Number.isFinite(dt)||dt<=0)return output();
    // A sleeping/background tab may not catch up by dumping minutes of copy.
    advanceClock(Math.min(dt,.25));
    if(!scripted(latest)){drain();fillSilence();drain();}
    return output();
  }
  function update(snapshot) {
    if(!snapshot||!Array.isArray(snapshot.players))return output();
    const freshRoom=!previous||snapshot.room!==previous.room;
    if(freshRoom){
      reset();clock=Number.isFinite(snapshot.elapsed)?snapshot.elapsed:0;lastPublication=lastAction=clock;nextSlot=clock+7;
      latest=copyState(snapshot);baseline(snapshot);
      if(paused(snapshot)){enqueue('disconnect',context(snapshot),null,'initial:paused',true);publish(queue.shift());}
      else if(snapshot.players.length>=2&&(snapshot.phase==='waiting'||snapshot.story?.stage==='workshop')){
        enqueue('introduction',context(snapshot),null,'initial:introduction');nextSlot=clock;drain();
      }
      return output();
    }
    const delta=clockDelta(snapshot);latest=copyState(snapshot);
    if(delta<-.001||snapshot.round<previous.round){
      queue=[];current=currentContext=null;deficits.clear();streakOwner=null;streak=0;nextSlot=clock+7;baseline(snapshot);return output();
    }
    if(!realtime&&!paused(snapshot)&&!previous.paused)advanceClock(Math.max(0,delta));
    const justPaused=paused(snapshot)&&!previous.paused,justResumed=!paused(snapshot)&&previous.paused;
    if(justPaused){queue=[];current=currentContext=null;enqueue('disconnect',context(snapshot),null,`pause:${serial}`,true);publish(queue.shift());}
    if(justResumed){
      queue=[];current=currentContext=null;nextSlot=clock;
      if(!scripted(snapshot)){enqueue('reconnect',context(snapshot),null,`resume:${serial}`);drain();}
      baseline(snapshot);return output();
    }
    if(snapshot.round!==previous.round){deficits.clear();queue=[];}
    if(scripted(snapshot)){
      queue=[];current=currentContext=null;nextSlot=clock;baseline(snapshot);return output();
    }
    if(delta>3&&!paused(snapshot)&&!previous.paused){
      // A late packet is a fresh baseline, not an invitation to rehearse hits
      // that happened while the display was disconnected or hidden.
      queue=[];current=currentContext=null;nextSlot=clock+4;baseline(snapshot);return output();
    }
    const newEvents=(snapshot.events||[]).filter(event=>event.id!=null&&!seen.has(event.id)&&!(typeof event.id==='number'&&event.id<=highWater));
    for(const event of newEvents)noteEvent(event.id);
    if(!paused(snapshot)){
      collecting=true;
      if(previous.players.length<2&&snapshot.players.length>=2&&(snapshot.phase==='waiting'||snapshot.story?.stage==='workshop')){
        enqueue('introduction',context(snapshot),null,'pair:introduction');nextSlot=clock;
      }
      for(const event of newEvents)if(!Number.isFinite(event.at)||!Number.isFinite(snapshot.elapsed)||snapshot.elapsed-event.at<=2)eventCandidate(event,snapshot);
      for(const player of snapshot.players){
        const before=previous.players.find(p=>p.id===player.id),other=snapshot.players.find(p=>p.id!==player.id);
        if(!before||!other||snapshot.phase!=='fight')continue;
        const max=player.maxHp||MAX_HP,threshold=max*.25,previousOther=previous.players.find(p=>p.id===other.id);
        if(before.hp>threshold&&player.hp>0&&player.hp<=threshold)enqueue('lowHp',context(snapshot,player.id,other.id),null,`low:${snapshot.round}:${player.id}`);
        if(player.hp<other.hp-max*.2||previousOther&&before.hp<previousOther.hp-max*.2)deficits.add(player.id);
        if(deficits.has(player.id)&&previousOther&&before.hp<=previousOther.hp&&player.hp>other.hp&&other.hp>0){
          enqueue('comeback',context(snapshot,player.id,other.id),null,`comeback:${snapshot.round}:${player.id}`);deficits.delete(player.id);
        }
      }
      const endedRound=previous.phase==='fight'&&['roundOver','finishing','matchOver'].includes(snapshot.phase);
      if(endedRound){
        if(snapshot.roundWinner){streak=snapshot.roundWinner===streakOwner?streak+1:1;streakOwner=snapshot.roundWinner;}
        else {streak=0;streakOwner=null;}
        if(!snapshot.roundWinner)enqueue('tie',context(snapshot),null,`tie:${snapshot.round}`,true);
        else if(snapshot.time<=0)enqueue('timeout',context(snapshot,snapshot.roundWinner,snapshot.players.find(p=>p.id!==snapshot.roundWinner)?.id),null,`timeout:${snapshot.round}`,true);
        if(streak>=2&&!snapshot.winner)enqueue('losingStreak',context(snapshot,snapshot.players.find(p=>p.id!==streakOwner)?.id,streakOwner),null,`streak:${snapshot.round}`);
      }
      const currentLeader=leader(snapshot.players),priorLeader=leader(previous.players);
      if(currentLeader&&currentLeader!==priorLeader&&!snapshot.winner)enqueue('leadChange',context(snapshot,currentLeader,snapshot.players.find(p=>p.id!==currentLeader)?.id),null,`lead:${snapshot.round}`);
      if(!snapshot.winner){
        const points=snapshot.players.filter(p=>p.wins===WINS_TO_MATCH-1),oldPoints=previous.players.filter(p=>p.wins===WINS_TO_MATCH-1);
        if(points.length===2&&oldPoints.length<2)enqueue('duelPoint',context(snapshot),null,`duel:${snapshot.round}`);
        else if(points.length===1&&!oldPoints.some(p=>p.id===points[0].id))enqueue('matchPoint',context(snapshot,points[0].id,snapshot.players.find(p=>p.id!==points[0].id)?.id),null,`point:${snapshot.round}`);
      }
      if(snapshot.phase==='matchOver'&&previous.phase!=='matchOver'&&snapshot.winner){
        const loser=snapshot.players.find(p=>p.id!==snapshot.winner)?.id;
        enqueue('win',context(snapshot,snapshot.winner,loser),null,`winner:${snapshot.round}`,true);
        enqueue('loss',context(snapshot,loser,snapshot.winner),null,`lastword:${snapshot.round}`);
      }
      collecting=false;
      if(pendingCritical){
        // A result supersedes stale attack chatter, but never cuts a sentence
        // halfway through. Same-packet KO/finale chooses the most final fact.
        queue=queue.filter(item=>RESULT.has(item.category)&&item.priority<100);
        queue.push(pendingCritical);queue.sort((a,b)=>b.priority-a.priority);queue=queue.slice(0,QUEUE_LIMIT);pendingCritical=null;
      }
      if(!current&&newEvents.length)nextSlot=Math.min(nextSlot,clock);
      drain();fillSilence();drain();
    }
    baseline(snapshot);return output();
  }
  // Kept for old embedding clients; the live teleprompter needs neither button.
  function nextVariation(){if(currentContext){const candidate=choose(currentContext,true);if(candidate)publish(candidate);}return output();}
  function acknowledge(){current=currentContext=null;nextSlot=clock;drain();return output();}
  reset();setFavorite(favorite);
  return Object.freeze({update,tick,setFavorite,nextVariation,acknowledge,reset});
}
