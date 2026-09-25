import { assetUrl } from './app-paths.js';
import { VOICE_CLIPS } from '../shared/voice-clips.js';

const FINISH = new Set(['rake', 'crusher', 'airFinish', 'heavyPress', 'slam']);
const SECOND = new Set(['cross', 'airCross', 'heavyHook']);
// Each cue stays inside an active region of the supplied recording. Small
// envelopes remove edit clicks; the two actors never stack copies of themselves.
export function combatVoiceCue(event) {
  const side = event.player === 'p2' ? 'dio' : event.player === 'p1' ? 'jotaro' : null;
  if (!side) return null;
  if (event.type === 'ultimate') return { actor: side, clip: 'duo-super', offset: 4.03, duration: 2.8, priority: 2 };
  if (event.type === 'destruction') return { actor: 'explosion', clip: 'explosion', offset: .1, duration: 2.3, priority: 3 };
  if (!['attack', 'grabStrike'].includes(event.type)) return null;
  const finish = FINISH.has(event.variant), second = SECOND.has(event.variant) || event.chain > 1;
  if (side === 'dio') return { actor: side, clip: finish ? 'dio-attack-2' : 'dio-attack-1',
    offset: finish ? 9.87 : second ? 1.05 : .345, duration: finish ? 1.25 : .58, priority: finish ? 1 : 0 };
  return { actor: side, clip: finish ? 'jotaro-attack-3' : second ? 'jotaro-attack-2' : 'jotaro-attack-1',
    offset: finish ? 5.15 : second ? 1.94 : .37, duration: finish ? 1.2 : .55, priority: finish ? 1 : 0 };
}

export function createCombatVoice({ context, destination, fetcher = globalThis.fetch, muted = () => false }) {
  const cache = new Map(), active = new Map(), fades = new Set();
  let disposed = false;
  const clipIds = ['jotaro-attack-1', 'jotaro-attack-2', 'jotaro-attack-3', 'dio-attack-1', 'dio-attack-2', 'duo-super', 'explosion'];
  async function load(id) {
    if (disposed || cache.get(id)?.buffer || cache.get(id)?.pending || (cache.get(id)?.attempts ?? 0) >= 2) return;
    const entry = cache.get(id) || { attempts: 0 }; cache.set(id, entry);
    entry.attempts++;
    const controller = new AbortController(); entry.controller = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    entry.pending = (async () => {
      const response = await fetcher(assetUrl(VOICE_CLIPS[id].url), { signal: controller.signal });
      if (!response.ok) throw new Error('Voice clip unavailable');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (!disposed) entry.buffer = buffer;
    })().catch(() => {}).finally(() => { clearTimeout(timer); entry.pending = null; entry.controller = null; });
    await entry.pending;
  }
  function finish(record) {
    if (active.get(record.actor) === record) active.delete(record.actor);
    fades.delete(record); record.source.onended = null;
    try { record.source.disconnect(); record.gain.disconnect(); } catch {}
  }
  function retire(record, immediate = false) {
    if (!record) return;
    active.delete(record.actor);
    if (immediate) { try { record.source.stop(); } catch {} finish(record); return; }
    fades.add(record);
    const now = context.currentTime;
    record.gain.gain.cancelScheduledValues(now);
    record.gain.gain.setTargetAtTime(0, now, .008);
    try { record.source.stop(now + .025); } catch { finish(record); }
  }
  function play(event) {
    if (event.type === 'ko') retire(active.get(event.player === 'p1' ? 'jotaro' : event.player === 'p2' ? 'dio' : ''), true);
    if (['round', 'fight', 'win'].includes(event.type)) stop();
    if (disposed || event.presentationHistorical || muted() || context.state !== 'running') return false;
    const cue = combatVoiceCue(event); if (!cue) return false;
    const buffer = cache.get(cue.clip)?.buffer;
    // No deferred playback: a late download must never speak for an old punch.
    if (!buffer) { void load(cue.clip); return false; }
    const now = context.currentTime, old = active.get(cue.actor);
    if (old && (now - old.at < .18 || old.priority > cue.priority)) return false;
    retire(old);
    const duration = Math.min(cue.duration, buffer.duration - cue.offset);
    if (duration <= .03) return false;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(cue.actor === 'explosion' ? .7 : 1.65, now + .012);
    gain.gain.setValueAtTime(cue.actor === 'explosion' ? .7 : 1.65, now + Math.max(.015, duration - .045));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain); gain.connect(destination);
    const record = { actor: cue.actor, source, gain, at: now, priority: cue.priority };
    active.set(cue.actor, record); source.onended = () => finish(record);
    source.start(now, cue.offset, duration); return true;
  }
  function stop() { for (const record of new Set([...active.values(), ...fades])) retire(record, true); }
  return { play, preload: () => Promise.all(clipIds.map(load)), stop,
    stats: () => ({ active: active.size, fading: fades.size, loaded: [...cache.values()].filter(e => e.buffer).length }),
    dispose() { if (disposed) return; disposed = true; stop(); for (const entry of cache.values()) entry.controller?.abort(); cache.clear(); },
  };
}
