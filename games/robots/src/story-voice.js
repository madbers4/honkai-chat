import { assetUrl as defaultAssetUrl } from './app-paths.js';
import { VOICE_CLIPS } from '../shared/voice-clips.js';

const LATE_GRACE = .38;

/** One voice at a time, driven by the server's scene clock. Optional speech
 * only uses a Russian voice explicitly declared LOCAL by the browser. */
export function createStoryVoice({ assetUrl = defaultAssetUrl, onStatus = () => {},
  makeContext = () => { const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext; return AudioCtx ? new AudioCtx() : null; },
  fetcher = globalThis.fetch?.bind(globalThis), speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance, visibility = globalThis.document } = {}) {
  let ctx = null, master = null, unlocked = false, muted = false, ttsEnabled = false, disposed = false;
  let active = null, pausedRecord = null, sequence = null, frame = null, localVoice = null, statusKey = '', fault = '';
  const cache = new Map(), seen = new Set();
  function voices() {
    let available = [];
    try { available = speech?.getVoices?.() || []; } catch {}
    localVoice = available.find(v => /^ru(?:-|_|$)/i.test(v.lang) && v.localService === true) || null;
    report();
  }
  function capabilities() {
    const ttsAvailable = Boolean(localVoice && Utterance && speech?.speak);
    return { unlocked, muted, ttsEnabled, ttsAvailable, voiceName: localVoice?.name || '',
      message: muted ? 'Звук выключен' : fault || !unlocked ? fault || 'Нажми «Включить звук» перед сценой' :
        ttsEnabled ? ttsAvailable ? 'Имена — голосом устройства. Реплики — из записей.' : 'Русского голоса на устройстве нет. Записи и субтитры работают.' : 'Оригинальные реплики · имена в субтитрах',
      mode: muted ? 'muted' : ttsEnabled && ttsAvailable ? 'local-tts' : 'recordings' };
  }
  function report() { const value = capabilities(), key = JSON.stringify(value); if (key !== statusKey && !disposed) { statusKey = key; onStatus(value); } }
  function stopActive() {
    const old = active; active = null;
    if (!old) return;
    if (old.source) { old.source.onended = null; try { old.source.stop(); } catch {} try { old.source.disconnect(); } catch {} }
    if (old.utterance) { old.utterance.onend = old.utterance.onerror = null; try { speech.cancel(); } catch {} }
  }
  function cancel() { stopActive(); pausedRecord = null; }
  async function load(clip) {
    if (!VOICE_CLIPS[clip] || disposed) return null;
    let entry = cache.get(clip);
    if (!entry) {
      entry = { buffer: null, bytes: null, pending: null, failed: false }; cache.set(clip, entry);
      entry.pending = Promise.resolve().then(async () => {
        if (!fetcher) throw new Error('Audio transport unavailable');
        const response = await fetcher(assetUrl(VOICE_CLIPS[clip].url));
        if (!response.ok) throw new Error('Recording unavailable');
        entry.bytes = await response.arrayBuffer();
      }).catch(() => { entry.failed = true; fault = 'Запись недоступна. Сцена продолжается с субтитрами.'; report(); });
    }
    await entry.pending;
    if (disposed || entry.failed || !ctx) return null;
    if (!entry.buffer && entry.bytes) {
      entry.decoding ??= ctx.decodeAudioData(entry.bytes.slice(0)).then(buffer => { entry.buffer = buffer; entry.bytes = null; return buffer; }).catch(() => { entry.failed = true; fault = 'Не удалось прочитать запись. Субтитры остаются.'; report(); return null; });
      await entry.decoding;
    }
    return entry.buffer;
  }
  function preload(beats = []) { return Promise.all([...new Set(beats.map(b => b.clip).filter(id => VOICE_CLIPS[id]))].map(load)); }
  async function unlock() {
    if (disposed) return false;
    try {
      ctx ??= makeContext();
      if (!ctx) { fault = 'Этот браузер не воспроизводит сцену голосом. Субтитры остаются.'; report(); return false; }
      if (!master) { master = ctx.createGain(); master.gain.value = muted ? 0 : .62; master.connect(ctx.destination); }
      await ctx.resume(); unlocked = ctx.state === 'running';
      if (unlocked) { fault = ''; void preload(frame?.beats || []); }
      report(); return unlocked;
    } catch { fault = 'Браузер ждёт нажатия для звука. Нажми «Включить звук».'; report(); return false; }
  }
  function endOf(beat) { return beat.at + (beat.clip ? beat.clipDuration ?? beat.duration : beat.duration); }
  function playClip(beat, elapsed, resumed = false) {
    const buffer = cache.get(beat.clip)?.buffer;
    if (!buffer) { void load(beat.clip); return false; }
    const age = Math.max(0, elapsed - beat.at), offset = Math.max(0, beat.clipOffset || 0) + age;
    const remaining = Math.min(buffer.duration - offset, endOf(beat) - elapsed);
    if (remaining <= .02) return true;
    stopActive();
    try {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(master);
      const record = { beat, source, sequence, resumed }; active = record;
      source.onended = () => { if (active === record) active = null; try { source.disconnect(); } catch {} };
      source.start(0, offset, remaining); return true;
    } catch { fault = 'Звук записи недоступен. Субтитры остаются.'; active = null; report(); return true; }
  }
  function speak(beat) {
    if (!ttsEnabled || !localVoice || !Utterance || !speech?.speak) return false;
    stopActive();
    try {
      const utterance = new Utterance(String(beat.ttsText).slice(0, 160)); utterance.voice = localVoice; utterance.lang = localVoice.lang;
      utterance.rate = 1.06; utterance.pitch = 1; utterance.volume = .78;
      const record = { beat, utterance, sequence }; active = record;
      utterance.onend = () => { if (active === record) active = null; };
      utterance.onerror = () => { if (active === record) active = null; fault = 'Голос устройства недоступен. Записи и субтитры продолжаются.'; report(); };
      speech.speak(utterance); return true;
    } catch { active = null; fault = 'Голос устройства недоступен. Записи и субтитры продолжаются.'; report(); return false; }
  }
  function update(next = {}) {
    if (disposed) return;
    const elapsed = Math.max(0, Number(next.elapsed) || 0), beats = Array.isArray(next.beats) ? next.beats : [];
    frame = { ...next, elapsed, beats };
    if (sequence !== next.sequenceId) { cancel(); seen.clear(); sequence = next.sequenceId; void preload(beats); }
    if (seen.size > 512) { const keep = [...seen].slice(-256); seen.clear(); keep.forEach(id => seen.add(id)); }
    const silent = next.enabled === false || muted || visibility?.hidden || !unlocked;
    if (silent) {
      cancel(); for (const beat of beats) if (elapsed >= beat.at) seen.add(beat.id); return;
    }
    if (next.paused) {
      if (active) { pausedRecord = active.utterance ? null : { beat: active.beat, sequence }; stopActive(); }
      return;
    }
    if (pausedRecord) {
      const old = pausedRecord; pausedRecord = null;
      if (old.sequence === sequence && elapsed < endOf(old.beat)) playClip(old.beat, elapsed, true);
    }
    if (active && (active.sequence !== sequence || elapsed >= endOf(active.beat))) stopActive();
    for (const beat of beats) {
      if (seen.has(beat.id) || elapsed < beat.at) continue;
      if (elapsed - beat.at > LATE_GRACE || elapsed >= endOf(beat)) { seen.add(beat.id); continue; }
      // TTS is only used for authored name beats, never as voice cloning or a
      // remote service. A late/missing voice simply leaves readable subtitles.
      let played = false;
      if (beat.ttsText) played = speak(beat);
      if (!played && beat.clip) played = playClip(beat, elapsed);
      if (played || !beat.clip) seen.add(beat.id);
    }
  }
  const onHidden = () => { if (visibility?.hidden) cancel(); };
  visibility?.addEventListener?.('visibilitychange', onHidden);
  speech?.addEventListener?.('voiceschanged', voices); voices();
  return { unlock, preload, update, cancel, getCapabilities: capabilities,
    setMuted(value) { muted = Boolean(value); if (master) master.gain.value = muted ? 0 : .62; if (muted) cancel(); report(); },
    setTtsEnabled(value) { ttsEnabled = Boolean(value); if (!ttsEnabled && active?.utterance) stopActive(); voices(); },
    dispose() { if (disposed) return; cancel(); disposed = true; visibility?.removeEventListener?.('visibilitychange', onHidden); speech?.removeEventListener?.('voiceschanged', voices); cache.clear(); seen.clear(); try { master?.disconnect(); void ctx?.close(); } catch {} },
  };
}
