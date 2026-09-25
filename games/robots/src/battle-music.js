import { assetUrl } from './app-paths.js';

export const BATTLE_MUSIC = Object.freeze({ url: '/assets/music/club-ost-290.mp3', duration: 290, quiet: .055, fight: .24 });
const loudPhases = new Set(['fight', 'countdown', 'finishing']);
const quietPhases = new Set(['waiting', 'story', 'roundOver', 'matchOver']);

/** A single streamed media element, never a decoded five-minute AudioBuffer. */
export function createBattleMusic({ context, createAudio = () => new Audio(), url = assetUrl(BATTLE_MUSIC.url) } = {}) {
  let element, source, gain, unlocked = false, disposed = false, playing = false, pending = null, blocked = false;
  let generation = 0, target = 0;
  let state = { phase: null, paused: false, connected: false, hidden: false, muted: false };
  const volume = () => loudPhases.has(state.phase) ? BATTLE_MUSIC.fight : quietPhases.has(state.phase) ? BATTLE_MUSIC.quiet : 0;
  const wanted = () => !disposed && unlocked && volume() > 0 && state.connected && !state.hidden && !state.muted && !state.paused;
  function setGain(value, immediate = false) {
    if (!gain || target === value) return;
    const now = context.currentTime, parameter = gain.gain;
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
    else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
    if (immediate) parameter.setValueAtTime(value, now);
    else parameter.linearRampToValueAtTime(value, now + (value < target ? .25 : .6));
    target = value;
  }
  function pause() {
    generation++;
    setGain(0, true);
    if (element && (playing || pending || !element.paused)) element.pause();
    playing = false;
  }
  function mediaError() { blocked = true; pause(); }
  function ensureElement() {
    if (element) return;
    element = createAudio(); element.preload = 'none'; element.loop = true;
    element.addEventListener('error', mediaError);
    gain = context.createGain(); gain.gain.value = 0;
    source = context.createMediaElementSource(element);
    source.connect(gain); gain.connect(context.destination);
    element.src = url;
  }
  function sync() {
    if (!wanted()) { if (playing || pending || target) pause(); return; }
    if (blocked) return;
    ensureElement();
    setGain(volume());
    if (playing || pending) return;
    const attempt = generation;
    // Keep the unresolved request until it settles, including pause→resume
    // races. New snapshots must never issue parallel play() promises.
    try {
      const result = element.play();
      pending = Promise.resolve(result).then(() => {
        if (!wanted() || attempt !== generation) { element.pause(); return; }
        playing = true;
      }, () => { if (wanted() && attempt === generation) { blocked = true; setGain(0, true); } })
        .finally(() => { pending = null; if (!disposed && attempt !== generation) sync(); });
    } catch { blocked = true; setGain(0, true); }
  }
  return Object.freeze({
    update(next) { if (disposed) return; state = { ...state, ...next }; sync(); },
    unlock() {
      if (disposed) return;
      unlocked = true; blocked = false;
      if (element?.error) element.load();
      sync();
    },
    reset() {
      if (disposed) return;
      state = { ...state, phase: null, connected: false }; blocked = false; pause();
      if (element) { try { element.currentTime = 0; } catch {} }
    },
    dispose() {
      if (disposed) return;
      disposed = true; pause();
      element?.removeEventListener('error', mediaError);
      if (element) { element.removeAttribute('src'); element.load(); }
      source?.disconnect(); gain?.disconnect();
    },
  });
}
