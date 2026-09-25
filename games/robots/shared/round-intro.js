import { PREMATCH_EXCHANGES } from './club-story.js';
import { GENERATED_VOICE_CLIPS } from './generated-voice-clips.js';
import { hasCompleteSpokenCatalog, roundSpokenId, spokenBeatDuration } from './spoken-catalog.js';

// A full recording may begin within the voice controller's .38 s late grace.
// Leave that startup budget after even the longest (2.9881 s) round recording.
export const ROUND_INTRO_BEAT_DURATION = 3.4;
export const ROUND_INTRO_DURATION = 2 * ROUND_INTRO_BEAT_DURATION;

const counter = (value, minimum) => Number.isFinite(Number(value))
  ? Math.max(minimum, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)))) : minimum;

function hash(value) {
  let state = 2166136261;
  for (const character of String(value)) state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
  return state;
}

function permutation(seed) {
  let state = seed;
  const result = PREMATCH_EXCHANGES.map((_, index) => index);
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = Math.floor((state / 4294967296) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  // A stable partition of this one fixed deck makes the two recorded pairs
  // audible in rounds 1–2. It remains a permutation, including across cycles.
  return [...result.filter(index => PREMATCH_EXCHANGES[index].clips),
    ...result.filter(index => !PREMATCH_EXCHANGES[index].clips)];
}

// Strip the AUTHOR'S speaker wrapper before any player names are involved.
// The actor is displayed by the UI, and TTS gets just one short spoken line.
function spokenLine(template) {
  const line = String(template).replace(/^\{[ab]\}:\s*«/, '').replace(/»[.!?]*$/, '').trim();
  return /[.!?…]$/.test(line) ? line : `${line}.`;
}

/** One stable shuffled deck per match: no repetition in any 12 consecutive
 * rounds, including across the cycle boundary. No time/random/client state. */
export function buildRoundIntro(players = [], room = '', round = 1, matchSerial = 0, { catalog = GENERATED_VOICE_CLIPS } = {}) {
  const roundNumber = counter(round, 1), matchNumber = counter(matchSerial, 0);
  const roomKey = typeof room === 'string' || typeof room === 'number' ? String(room) : String(room?.id ?? room?.code ?? '');
  const seed = hash(JSON.stringify([roomKey, matchNumber]));
  const order = permutation(seed), exchange = PREMATCH_EXCHANGES[order[(roundNumber - 1) % order.length]];
  const roster = Array.isArray(players) ? players : [];
  const firstSeat = (roundNumber - 1) % 2;
  const speaker = seat => roster[seat]?.id ?? `p${seat + 1}`;
  const id = `round-intro-${seed.toString(36)}-${matchNumber}-${roundNumber}`;
  const lines = [spokenLine(exchange.first), spokenLine(exchange.reply)];
  const complete=hasCompleteSpokenCatalog(catalog);
  let at=0;
  const beats=lines.map((_, index) => {
      const seat = index === 0 ? firstSeat : 1 - firstSeat;
      // Semantic turn is fixed; only the voice/seat alternates. The old pack
      // lacks setup.p2/reply.p1: use optional device speech in that fallback,
      // never turn its recorded answer into the setup on an even round.
      const clip = complete ? roundSpokenId(exchange.id,index===0?'setup':'reply',seat)
        : seat===index ? exchange.clips?.[index===0?'a':'b'] : null;
      const recording = clip ? catalog[clip] : null;
      const text = recording ? recording.text : lines[index];
      const duration=recording?spokenBeatDuration(recording,ROUND_INTRO_BEAT_DURATION):ROUND_INTRO_BEAT_DURATION;
      const beat={
        id: `${id}-${index}`, at, duration,
        speaker: speaker(seat), text, ttsText: text, pose: index === 0 ? 'resolve' : 'point',
        ...(recording ? { clip, clipOffset: 0, clipDuration: recording.duration } : {}),
      };
      at+=duration;return beat;
    });
  return { id, exchangeId: exchange.id, round: roundNumber, title: exchange.setup, duration: at, beats };
}

export function activeRoundIntroBeat(intro, elapsed = 0) {
  const time = Number(elapsed);
  if (!Number.isFinite(time) || time < 0 || time >= (intro?.duration ?? ROUND_INTRO_DURATION)) return null;
  return intro?.beats?.find(beat => time >= beat.at && time < beat.at + beat.duration) || null;
}
