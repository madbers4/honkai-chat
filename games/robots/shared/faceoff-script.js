import { GENERATED_VOICE_CLIPS } from './generated-voice-clips.js';
import { hasCompleteSpokenCatalog, spokenBeatDuration, SPOKEN_FACEOFF_TURNS } from './spoken-catalog.js';
export { VOICE_CLIPS } from './voice-clips.js';

const READY_DURATION = 3.482;
const turnDuration = (turn,catalog) => Number.isFinite(catalog?.[turn.id]?.duration) && catalog[turn.id].duration>0
  ? spokenBeatDuration(catalog[turn.id],turn.minimum) : Math.max(3.4,turn.minimum);
export function getFaceoffDuration(catalog = GENERATED_VOICE_CLIPS) {
  return SPOKEN_FACEOFF_TURNS.reduce((sum,turn)=>sum+turnDuration(turn,catalog),6.4)+READY_DURATION;
}
export const FACE_OFF_DURATION = getFaceoffDuration();
export const faceoffDuration = beats => Math.max(0, ...(beats || []).map(beat => Number.isFinite(beat?.at) && Number.isFinite(beat?.duration) ? beat.at + beat.duration : 0));
export const FACE_OFF_REVEAL_AT = 0;
export const FACE_OFF_POSES = Object.freeze(['stance', 'arrival', 'challenge', 'point', 'recoil', 'resolve', 'reactor', 'actuators', 'armed']);
export const FACE_OFF_CHAPTERS = Object.freeze({ establish: 'ВЫХОД НА АРЕНУ', mode: 'БОЕВАЯ ГОТОВНОСТЬ', dialogue: 'ДЖОТАРО × ДИО', ready: 'ДО СТОЛКНОВЕНИЯ' });
export const FACE_OFF_DIALOGUE_CLIPS = Object.freeze(SPOKEN_FACEOFF_TURNS.slice(2).map(turn=>turn.id));
const safeName = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : fallback;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(10+t*(-15+6*t)); };
function hashSeed(seed) { let result = 2166136261; for (const c of String(seed ?? 0)) result = Math.imul(result ^ c.charCodeAt(0), 16777619); return result >>> 0; }
function entranceBeats(players,key) {
  const first=players[0]||{},second=players[1]||{};
  return [
    {at:0,duration:2,chapter:'establish',shot:'wide',speaker:'narrator',text:'БЕЛОБОГ. ПОДПОЛЬЕ. ГАРАНТИЯ ЗАКОНЧИЛАСЬ НА ВХОДЕ.',pose:'arrival',both:true},
    {at:2,duration:2.2,chapter:'establish',shot:'portrait',speaker:first.id||'p1',text:`${safeName(first.name,'Первый автоматон')}. Претензии принимаются после боя.`,pose:'resolve'},
    {at:4.2,duration:2.2,chapter:'establish',shot:'portrait',speaker:second.id||'p2',text:`${safeName(second.name,'Второй автоматон')}. Запасных деталей не обещает.`,pose:'challenge'},
  ].map((beat,index)=>Object.freeze({...beat,id:`faceoff-${key}-${index}`}));
}

/** One shared clock; missing or incomplete audio retains captions without
 * ever substituting archived actors or device speech. */
export function buildFaceoff(players = [], seed = 0, { catalog = GENERATED_VOICE_CLIPS } = {}) {
  const complete=hasCompleteSpokenCatalog(catalog),key=hashSeed(seed),beats=entranceBeats(players,key);
  let at=6.4;
  for(const turn of SPOKEN_FACEOFF_TURNS) {
    const recording=catalog?.[turn.id],duration=turnDuration(turn,catalog);
    const text=typeof recording?.text==='string'&&recording.text.trim()?recording.text:'Запись реплики недоступна. Сцена продолжается.';
    beats.push(Object.freeze({id:'faceoff-'+key+'-'+beats.length,at,duration,chapter:turn.chapter,shot:turn.shot,
      speaker:players[turn.seat]?.id||'p'+(turn.seat+1),text,pose:turn.pose,
      ...(turn.system?{system:turn.system}:{}),
      ...(complete?{clip:turn.id,clipOffset:0,clipDuration:recording.duration}:{audioUnavailable:true})}));
    at+=duration;
  }
  beats.push(Object.freeze({id:'faceoff-'+key+'-'+beats.length,at,duration:READY_DURATION,chapter:'ready',shot:'wide',speaker:'narrator',
    text:'ПОРА ПРОВЕРИТЬ БРОНЮ НА ПРОЧНОСТЬ.',pose:'armed',both:true}));
  return beats;
}

export function activeFaceoffBeat(beats, elapsed) {
  if (!Number.isFinite(elapsed)) return null;
  return beats.find(beat => elapsed >= beat.at && elapsed < beat.at + beat.duration) || null;
}

export function faceoffActorPose(beat, playerId) {
  return beat?.both || beat?.speaker === playerId ? beat?.pose || 'stance' : 'stance';
}

export function faceoffActorX(index, elapsed) {
  return (index ? 1 : -1) * (4.3 - 2.45 * smooth(Math.max(0, elapsed) / 6.4));
}

/** Presentation-only power signal, 0..1. The caller adds light/emission; this
 * never changes energy, HP or the authoritative signal colour. Frozen server
 * actionTime gives identical values on pause, seek and reconnect. */
export function faceoffPowerEnvelope(variant, elapsed, duration, { reducedMotion = false } = {}) {
  const t = Math.max(0, Number(elapsed) || 0), end = Math.max(.4, Number(duration) || 3);
  if (!['reactor', 'actuators', 'armed'].includes(variant) || t >= end) return { core: 0, drives: 0, armed: 0 };
  const hold = reducedMotion ? .68 : smooth(t / .6) * (1 - smooth((t - end + .38) / .38));
  if (variant === 'reactor') return { core: hold, drives: hold * .24, armed: 0 };
  if (variant === 'actuators') return { core: hold * .58, drives: hold, armed: 0 };
  return { core: hold * .72, drives: hold * .45, armed: hold };
}
