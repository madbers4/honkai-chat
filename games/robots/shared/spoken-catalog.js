import { GENERATED_VOICE_CLIPS } from './generated-voice-clips.js';
import { PREMATCH_EXCHANGES } from './club-story.js';

export const VOICE_START_GRACE = .38;
export const VOICE_BREATHING_ROOM = .12;
export const SPOKEN_FACEOFF_TURNS = Object.freeze([
  { id:'faceoff-greeting-open', seat:1, chapter:'establish', shot:'portrait', pose:'challenge', minimum:2.2 },
  { id:'faceoff-greeting-answer', seat:0, chapter:'establish', shot:'portrait', pose:'point', minimum:1.6 },
  { id:'faceoff-greeting-package', seat:1, chapter:'mode', shot:'claw', pose:'actuators', minimum:3.1, system:'ПРИВОДЫ / БЛОКИРОВКИ СНЯТЫ' },
  { id:'faceoff-challenge-p1', seat:0, chapter:'mode', shot:'core', pose:'reactor', minimum:3.5, system:'РЕАКТОР / БОЕВОЙ КОНТУР' },
  { id:'faceoff-taunt-p2', seat:1, chapter:'dialogue', shot:'portrait', pose:'challenge', minimum:2.2 },
  // Stable ID: formerly a synthesized mode line, now the original exclamation.
  { id:'faceoff-mode-p1', seat:0, chapter:'dialogue', shot:'portrait', pose:'resolve', minimum:2.2 },
  { id:'faceoff-fight-p2', seat:1, chapter:'dialogue', shot:'portrait', pose:'point', minimum:2.2 },
].map(Object.freeze));
export const roundSpokenId = (exchange, turn, seat) => `round-${exchange}-${turn}-p${seat+1}`;
const required = [
  ...SPOKEN_FACEOFF_TURNS.map(turn => [turn.id, `p${turn.seat+1}`]),
  ...PREMATCH_EXCHANGES.flatMap(pair => ['setup','reply'].flatMap(turn => [0,1].map(seat => [roundSpokenId(pair.id,turn,seat),`p${seat+1}`]))),
];
export const SPOKEN_CLIP_IDS = Object.freeze(required.map(([id]) => id));

/** All-or-nothing pack activation prevents mixing a partial production drop
 * with the old dialogue. Durations must come from measured real recordings. */
export function hasCompleteSpokenCatalog(catalog = GENERATED_VOICE_CLIPS) {
  if (!catalog || typeof catalog !== 'object') return false;
  if (!required.every(([id,speaker]) => {
    const clip=catalog[id];
    return clip && clip.speaker===speaker && typeof clip.text==='string' && clip.text.trim().length>0
      && Number.isFinite(clip.duration) && clip.duration>0 && typeof clip.url==='string'
      && /^\/assets\/voices\/[^?#]+\.mp3$/.test(clip.url) && !clip.url.includes('..');
  })) return false;
  return PREMATCH_EXCHANGES.every(pair => ['setup','reply'].every(turn =>
    catalog[roundSpokenId(pair.id,turn,0)].text===catalog[roundSpokenId(pair.id,turn,1)].text));
}

export function spokenBeatDuration(recording, minimum = 0) {
  return Math.max(minimum, recording.duration + VOICE_START_GRACE + VOICE_BREATHING_ROOM);
}
