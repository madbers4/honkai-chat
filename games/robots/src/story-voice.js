import { assetUrl as defaultAssetUrl } from './app-paths.js';
import { VOICE_CLIPS } from '../shared/voice-clips.js';
import { VOICE_START_GRACE } from '../shared/spoken-catalog.js';

const LATE_GRACE = VOICE_START_GRACE;

/** One voice at a time, driven by the server's scene clock. Optional speech
 * only uses a Russian voice explicitly declared LOCAL by the browser. */
export function createStoryVoice({ assetUrl = defaultAssetUrl, onStatus = () => {},
  makeContext = () => { const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext; return AudioCtx ? new AudioCtx() : null; },
  fetcher = globalThis.fetch?.bind(globalThis), speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance, visibility = globalThis.document,
  loadTimeoutMs = 10000, clipCatalog = VOICE_CLIPS } = {}) {
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
        ttsEnabled ? ttsAvailable ? 'Дополнительные реплики — голосом устройства. Записи включены.' : 'Русского голоса на устройстве нет. Записи и субтитры работают.' : 'Записи и авторская озвучка · имена в субтитрах',
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
    if (!clipCatalog[clip] || disposed) return null;
    let entry = cache.get(clip);
    if (!entry) {
      entry = { buffer: null, bytes: null, pending: null, failed: false }; cache.set(clip, entry);
      entry.pending = Promise.resolve().then(async () => {
        if (!fetcher) throw new Error('Audio transport unavailable');
        // A stalled optional recording must not leave a request alive after
        // leaving the arena. Retry once; never replay an expired dialogue beat.
        for (let attempt = 0; attempt < 2 && !disposed; attempt++) {
          const controller = new AbortController(); entry.controller = controller;
          const timer = setTimeout(() => controller.abort(), loadTimeoutMs);
          try {
            const response = await fetcher(assetUrl(clipCatalog[clip].url), { signal: controller.signal });
            if (!response.ok) throw new Error('Recording unavailable');
            entry.bytes = await response.arrayBuffer(); return;
          } catch (error) {
            if (attempt === 1 || disposed) throw error;
          } finally { clearTimeout(timer); entry.controller = null; }
        }
      }).catch(() => { entry.failed = true; if (!disposed) { fault = 'Запись недоступна. Сцена продолжается с субтитрами.'; report(); } });
    }
    await entry.pending;
    if (disposed || entry.failed || !ctx) return null;
    if (!entry.buffer && entry.bytes) {
      entry.decoding ??= ctx.decodeAudioData(entry.bytes.slice(0)).then(buffer => { entry.buffer = buffer; entry.bytes = null; return buffer; }).catch(() => { entry.failed = true; fault = 'Не удалось прочитать запись. Субтитры остаются.'; report(); return null; });
      await entry.decoding;
    }
    return entry.buffer;
  }
  function preload(beats = []) { return Promise.all([...new Set(beats.map(b => b.clip).filter(id => clipCatalog[id]))].map(load)); }
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
  function playClip(beat, elapsed, resumedAt = null) {
    const buffer = cache.get(beat.clip)?.buffer;
    if (!buffer) { void load(beat.clip); return false; }
    const startedAt = resumedAt ?? elapsed;
    const age = Math.max(0, elapsed - startedAt), offset = Math.max(0, beat.clipOffset || 0) + age;
    const remaining = Math.min(buffer.duration - offset, (beat.clipDuration ?? beat.duration) - age);
    if (remaining <= .02) return true;
    // Ordinary packet jitter must not cut the first syllable. A previous
    // whole line can finish inside the next beat's grace window; pausing
    // resumes from the actual playback start, not its nominal script time.
    if (active) return false;
    try {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(master);
      const record = { beat, source, sequence, startedAt, endsAt: elapsed + remaining }; active = record;
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
      const record = { beat, utterance, sequence, endsAt: endOf(beat) }; active = record;
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
      if (active) { pausedRecord = active.utterance ? null : { beat: active.beat, sequence, startedAt: active.startedAt, endsAt: active.endsAt }; stopActive(); }
      return;
    }
    if (pausedRecord) {
      const old = pausedRecord; pausedRecord = null;
      if (old.sequence === sequence && elapsed < old.endsAt) playClip(old.beat, elapsed, old.startedAt);
    }
    if (active && (active.sequence !== sequence || elapsed >= active.endsAt)) stopActive();
    for (const beat of beats) {
      if (seen.has(beat.id) || elapsed < beat.at) continue;
      if (elapsed - beat.at > LATE_GRACE + 1e-8 || elapsed >= endOf(beat)) { seen.add(beat.id); continue; }
      // Packed original/generated recordings take precedence over optional
      // device speech. The latter only reads beats without an authored clip.
      let played = false;
      if (beat.clip) played = playClip(beat, elapsed);
      else if (beat.ttsText) played = speak(beat);
      if (played || !beat.clip) seen.add(beat.id);
    }
  }
  const onHidden = () => { if (visibility?.hidden) cancel(); };
  visibility?.addEventListener?.('visibilitychange', onHidden);
  speech?.addEventListener?.('voiceschanged', voices); voices();
  return { unlock, preload, update, cancel, getCapabilities: capabilities,
    setMuted(value) { muted = Boolean(value); if (master) master.gain.value = muted ? 0 : .62; if (muted) cancel(); report(); },
    setTtsEnabled(value) { ttsEnabled = Boolean(value); if (!ttsEnabled && active?.utterance) stopActive(); voices(); },
    dispose() { if (disposed) return; cancel(); disposed = true; visibility?.removeEventListener?.('visibilitychange', onHidden); speech?.removeEventListener?.('voiceschanged', voices); for (const entry of cache.values()) entry.controller?.abort(); cache.clear(); seen.clear(); try { master?.disconnect(); void ctx?.close(); } catch {} },
  };
}
