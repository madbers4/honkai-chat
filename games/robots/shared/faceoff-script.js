import { VOICE_CLIPS } from './voice-clips.js';
export { VOICE_CLIPS } from './voice-clips.js';

export const FACE_OFF_DURATION = 48;
export const FACE_OFF_REVEAL_AT = 0;
export const FACE_OFF_POSES = Object.freeze(['stance', 'arrival', 'challenge', 'point', 'recoil', 'resolve', 'reactor', 'actuators', 'armed']);
export const FACE_OFF_CHAPTERS = Object.freeze({ establish: 'ВЫХОД НА АРЕНУ', mode: 'КАБАЧКОВОЕ ПРОТИВОСТОЯНИЕ', dialogue: 'ПАКЕТ ПАФОСА', ready: 'АРГУМЕНТЫ ЗАРЯЖЕНЫ' });
export const FACE_OFF_DIALOGUE_CLIPS = Object.freeze(['greeting', 'jotaro-dio', 'dio-angry', 'jotaro-not-simple', 'dio-hero']);
const safeName = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : fallback;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(10+t*(-15+6*t)); };
function hashSeed(seed) { let result = 2166136261; for (const c of String(seed ?? 0)) result = Math.imul(result ^ c.charCodeAt(0), 16777619); return result >>> 0; }

/** One clock for server blocking, camera, acting and complete original audio.
 * Changing a shot never slices a recording or substitutes its spoken names. */
export function buildFaceoff(players = [], seed = 0) {
  const a = players[0] || {}, b = players[1] || {};
  const first = a.id || 'p1', second = b.id || 'p2';
  const nameA = safeName(a.name, 'Первый автоматон'), nameB = safeName(b.name, 'Второй автоматон');
  const key = hashSeed(seed);
  const beats = [
    { at: 0, duration: 2, chapter: 'establish', shot: 'wide', speaker: 'narrator', text: 'БЕЛОБОГ. ПОДПОЛЬЕ. ГАРАНТИЯ ЗАКОНЧИЛАСЬ НА ВХОДЕ.', pose: 'arrival', both: true },
    { at: 2, duration: 2.2, chapter: 'establish', shot: 'portrait', speaker: first, text: `${nameA}. Претензии принимаются после боя.`, pose: 'resolve' },
    { at: 4.2, duration: 2.2, chapter: 'establish', shot: 'portrait', speaker: second, text: `${nameB}. Запасных деталей не обещает.`, pose: 'challenge' },
    { at: 6.4, duration: 3.5, chapter: 'mode', shot: 'core', speaker: first, text: VOICE_CLIPS['jotaro-mode'].text, clip: 'jotaro-mode', clipOffset: 0, clipDuration: VOICE_CLIPS['jotaro-mode'].duration, pose: 'reactor', system: 'РЕАКТОР / БОЕВОЙ КОНТУР' },
    { at: 9.9, duration: 3.1, chapter: 'mode', shot: 'claw', speaker: second, text: VOICE_CLIPS['dio-mode'].text, clip: 'dio-mode', clipOffset: 0, clipDuration: VOICE_CLIPS['dio-mode'].duration, pose: 'actuators', system: 'ПРИВОДЫ / БЛОКИРОВКИ СНЯТЫ' },
    // The greeting already contains both actors. It plays through three shots.
    { at: 13, duration: 4.1, chapter: 'dialogue', shot: 'portrait', speaker: second, text: 'Вот мы и встретились, Джотаро!', clip: 'greeting', clipOffset: 0, clipDuration: VOICE_CLIPS.greeting.duration, pose: 'challenge' },
    { at: 17.1, duration: 1.15, chapter: 'dialogue', shot: 'two-shot', speaker: first, text: 'Дио!', pose: 'point' },
    { at: 18.25, duration: VOICE_CLIPS.greeting.duration - 5.25 + .4, chapter: 'dialogue', shot: 'portrait', speaker: second, text: 'Пакет пафоса в прошивке. Имена бойцов — настоящие.', pose: 'challenge', annotation: true },
  ];
  let at = 13 + VOICE_CLIPS.greeting.duration + .4;
  const lines = [
    ['jotaro-dio', first, 'ДИО.', 'point', .35],
    ['dio-angry', second, 'Протокол дипломатии: отклонён.', 'challenge', .4],
    ['jotaro-not-simple', first, 'Сложность соперника недооценена.', 'resolve', .35],
    ['dio-hero', second, 'Ну вперёд, герой!', 'point', .45],
  ];
  for (const [clip, speaker, text, pose, breathingRoom] of lines) {
    const duration = VOICE_CLIPS[clip].duration + breathingRoom;
    beats.push({ at, duration, chapter: 'dialogue', shot: 'portrait', speaker, text, pose, clip, clipOffset: 0, clipDuration: VOICE_CLIPS[clip].duration, annotation: ['dio-angry','jotaro-not-simple'].includes(clip) });
    at += duration;
  }
  beats.push({ at, duration: FACE_OFF_DURATION - at, chapter: 'ready', shot: 'wide', speaker: 'narrator', text: 'ПАФОС ЗАГРУЖЕН. ТЕПЕРЬ ПОКАЖИТЕ, ЧТО УМЕЕТЕ.', pose: 'armed', both: true });
  return beats.map((beat, index) => Object.freeze({ ...beat, id: `faceoff-${key}-${index}` }));
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
