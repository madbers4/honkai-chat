import { VOICE_CLIPS } from './voice-clips.js';
export { VOICE_CLIPS } from './voice-clips.js';
export const FACE_OFF_DURATION = 24;
export const FACE_OFF_POSES = Object.freeze(['stance', 'challenge', 'point', 'recoil', 'resolve']);
export const FACE_OFF_REVEAL_AT = 12.8;
const safeName = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : fallback;
function hashSeed(seed) { let result = 2166136261; for (const c of String(seed ?? 0)) result = Math.imul(result ^ c.charCodeAt(0), 16777619); return result >>> 0; }

/** Pure fixed timeline. The server owns elapsed; neither client chooses a
 * random line, extends a beat for TTS, or decides when combat can begin. */
export function buildFaceoff(players = [], seed = 0) {
  const a = players[0] || {}, b = players[1] || {};
  const first = a.id || 'p1', second = b.id || 'p2';
  const nameA = safeName(a.name, 'Первый автоматон'), nameB = safeName(b.name, 'Второй автоматон');
  const key = hashSeed(seed), faults = [
    'ЧУЖИЕ ИМЕНА В ПРОШИВКЕ. У КОГО-ТО БЫЛ ОЧЕНЬ СТРАННЫЙ СЕРВИС.',
    'СТОП. ЭТО НЕ ВАШИ ИМЕНА. ОБНОВЛЕНИЕ ЛИЧНОСТИ БЕЗ ПЕРЕЗАГРУЗКИ.',
    'ЛЕГЕНДАРНЫЙ ПАКЕТ УГРОЗ НАЙДЕН. ГАРАНТИЯ НА ПАФОС ИСТЕКЛА.',
  ];
  const beats = [
    { at: 0, duration: .4, speaker: 'narrator', text: 'ДВА АВТОМАТОНА. СЛИШКОМ МНОГО ПАФОСА.', pose: 'stance' },
    // The original two-actor exchange is one continuous recording. Pose and
    // subtitle beats change above it without splicing the spoken names.
    { at: .4, duration: 4.1, speaker: second, text: 'Вот мы и встретились, Джотаро!', clip: 'greeting', clipOffset: 0, clipDuration: 11.05, pose: 'challenge' },
    { at: 4.5, duration: 1.15, speaker: first, text: 'Дио!', pose: 'point' },
    { at: 5.65, duration: 5.85, speaker: second, text: 'Да и что? Что ты мне сделаешь, а, Джотаро?', pose: 'challenge' },
    { at: 11.5, duration: 1.5, speaker: 'narrator', text: faults[key % faults.length], pose: 'recoil' },
    { at: 13, duration: 2.3, speaker: first, text: `Вообще-то я — ${nameA}.`, ttsText: `Вообще-то я ${nameA}.`, pose: 'resolve' },
    { at: 15.3, duration: 2.3, speaker: second, text: `А я — ${nameB}. Теперь без ошибки.`, ttsText: `А я ${nameB}.`, pose: 'resolve' },
    { at: 17.6, duration: 3.8, speaker: second, text: 'Ха. Ну вперёд, герой!', clip: 'dio-hero', clipOffset: 0, clipDuration: VOICE_CLIPS['dio-hero'].duration, pose: 'point' },
    { at: 21.4, duration: 2.6, speaker: 'narrator', text: 'ИМЕНА ВОССТАНОВЛЕНЫ. АРГУМЕНТЫ — ЗАРЯЖЕНЫ.', pose: 'stance' },
  ];
  return beats.map((beat, index) => Object.freeze({ ...beat, id: `faceoff-${key}-${index}` }));
}

export function activeFaceoffBeat(beats, elapsed) {
  if (!Number.isFinite(elapsed)) return null;
  return beats.find(beat => elapsed >= beat.at && elapsed < beat.at + beat.duration) || null;
}
