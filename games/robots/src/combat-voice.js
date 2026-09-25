import { assetUrl } from './app-paths.js';
import { COMBAT_VOICE_CLIPS } from '../shared/combat-voice-clips.js';

const FINISH = new Set(['rake', 'crusher', 'airFinish', 'heavyPress', 'slam']);
const SECOND = new Set(['cross', 'airCross', 'heavyHook']);
const ATTACKS = new Set(['jab', 'cross', 'rake', 'dashStrike', 'launcher', 'crusher',
  'airJab', 'airCross', 'airFinish', 'heavyDrive', 'heavyHook', 'heavyPress', 'slam']);
const BOUNDARIES = new Set(['round', 'fight']);
const MAX_SEEN = 256;
const BREATH = .06;

/** These are whole, offline-edited files. One attack-start owns its cry:
 * hit/block/launch/slam/ultimatePulse must not voice that attack again. */
export function combatVoiceCue(event = {}) {
  if (event.type === 'destruction') return { actor: 'explosion', clip: 'explosion', gain: .7 };
  const actor = event.player === 'p1' ? 'jotaro' : event.player === 'p2' ? 'dio' : null;
  if (!actor) return null;
  if (event.type === 'ultimate') return { actor, clip: actor === 'jotaro' ? 'jotaro-barrage' : 'dio-ultimate', gain: 1.5 };
  if (event.type === 'finisherStart') return { actor, clip: actor === 'dio' ? 'dio-barrage' : 'jotaro-finisher', gain: 1.5 };
  if (event.type !== 'grabStrike' && (event.type !== 'attack' || !ATTACKS.has(event.variant))) return null;
  if (FINISH.has(event.variant)) return { actor, clip: `${actor}-finisher`, gain: 1.5 };
  // The second held strike can use one complete short run, rather than restarting
  // the first MUDA for every contact. Jotaro's supplied run is reserved for his ult.
  if (actor === 'dio' && event.type === 'grabStrike' && event.chain > 1) {
    return { actor, clip: 'dio-barrage', gain: 1.4 };
  }
  const second = SECOND.has(event.variant) || event.chain > 1
    || (Number.isInteger(event.id) && event.id % 2 === 1);
  return { actor, clip: `${actor}-single-${second ? 'b' : 'a'}`, gain: 1.5 };
}

export function createCombatVoice({ context, destination, fetcher = globalThis.fetch,
  muted = () => false, loadTimeoutMs = 10000 }) {
  const cache = new Map(), active = new Map(), fades = new Set(), nextVoiceAt = new Map(), seen = new Set();
  let disposed = false;

  function load(id) {
    if (disposed) return Promise.resolve();
    let entry = cache.get(id);
    if (entry?.pending) return entry.pending;
    if (entry?.buffer || (entry?.attempts ?? 0) >= 2) return Promise.resolve();
    if (!entry) { entry = { attempts: 0 }; cache.set(id, entry); }
    entry.attempts++;
    const controller = new AbortController();
    let timer, rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    entry.cancel = () => { controller.abort(); rejectDeadline(new Error('Optional combat voice cancelled')); };
    timer = setTimeout(entry.cancel, loadTimeoutMs);
    const request = (async () => {
      const response = await fetcher(assetUrl(COMBAT_VOICE_CLIPS[id].url), { signal: controller.signal });
      if (!response.ok) throw new Error('Optional combat voice unavailable');
      const bytes = await response.arrayBuffer();
      if (disposed || controller.signal.aborted) return null;
      return context.decodeAudioData(bytes);
    })();
    entry.pending = Promise.race([request, deadline]).then(buffer => {
      if (buffer && !disposed && !controller.signal.aborted) entry.buffer = buffer;
    }).catch(() => {}).finally(() => {
      clearTimeout(timer); entry.pending = null; entry.cancel = null;
    });
    return entry.pending;
  }

  function finish(record) {
    if (!record || record.done) return;
    record.done = true;
    if (active.get(record.actor) === record) active.delete(record.actor);
    fades.delete(record);
    record.source.onended = null;
    try { record.source.disconnect(); record.gain.disconnect(); } catch {}
  }

  function retire(record, immediate = false) {
    if (!record || record.done) return;
    if (active.get(record.actor) === record) active.delete(record.actor);
    if (immediate) {
      try { record.source.stop(); } catch {}
      finish(record); return;
    }
    if (record.fading) return;
    record.fading = true; fades.add(record);
    const now = context.currentTime;
    record.gain.gain.cancelScheduledValues(now);
    record.gain.gain.setTargetAtTime(0, now, .007);
    try { record.source.stop(now + .03); } catch { finish(record); }
  }

  function stop(immediate = false) {
    for (const record of new Set([...active.values(), ...fades])) retire(record, immediate);
    nextVoiceAt.clear(); seen.clear();
  }

  function remember(event) {
    if (event.id == null) return true;
    // Include the server timestamp: IDs alone can be reused in a new room.
    const key = `${event.id}:${event.at ?? ''}:${event.player ?? ''}:${event.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
    return true;
  }

  function play(event = {}) {
    if (disposed || event.presentationHistorical) return false;
    if (!remember(event)) return false;
    // Historical KO/round events must not cut a current live voice.
    if (BOUNDARIES.has(event.type)) { stop(); remember(event); return false; }
    if (event.type === 'ko') {
      const actor = event.player === 'p1' ? 'jotaro' : event.player === 'p2' ? 'dio' : null;
      retire(active.get(actor)); nextVoiceAt.delete(actor); return false;
    }
    if (muted() || context.state !== 'running') return false;
    const cue = combatVoiceCue(event);
    if (!cue) return false;
    const buffer = cache.get(cue.clip)?.buffer;
    // A completed download only warms the cache; never queues an old punch.
    if (!buffer) { void load(cue.clip); return false; }
    const now = context.currentTime;
    const old = active.get(cue.actor);
    if (old && old.until > now) return false;
    if (old) finish(old); // onended can arrive one frame after the real end.
    if (now < (nextVoiceAt.get(cue.actor) ?? -Infinity)) return false;
    if (!Number.isFinite(buffer.duration) || buffer.duration <= .03) return false;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(cue.gain, now);
    source.connect(gain); gain.connect(destination);
    const record = { actor: cue.actor, source, gain, until: now + buffer.duration, done: false, fading: false };
    active.set(cue.actor, record);
    source.onended = () => finish(record);
    nextVoiceAt.set(cue.actor, record.until + (cue.actor === 'explosion' ? 0 : BREATH));
    try {
      // No offset or duration argument: preserve the complete prepared word/run.
      source.start(now);
      return true;
    } catch {
      finish(record); nextVoiceAt.delete(cue.actor); return false;
    }
  }

  return { play, preload: () => Promise.all(Object.keys(COMBAT_VOICE_CLIPS).map(load)),
    stop: () => stop(),
    stats: () => ({ active: active.size, fading: fades.size,
      loaded: [...cache.values()].filter(entry => entry.buffer).length, seen: seen.size }),
    dispose() {
      if (disposed) return;
      disposed = true; stop(true);
      for (const entry of cache.values()) entry.cancel?.();
      cache.clear();
    },
  };
}
