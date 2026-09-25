// Resolution is a pixel budget, not a guess about GPU power from screen width.
// Phones keep the same lighting/materials as desktop unless the player opts out.
export const GRAPHICS_PRESETS = Object.freeze({
  sharp: Object.freeze({ label: 'Чёткое', ratio: 3, pixels: 4_000_000, effects: 'high' }),
  balanced: Object.freeze({ label: 'Сбалансированное', ratio: 1.75, pixels: 2_250_000, effects: 'high' }),
  economy: Object.freeze({ label: 'Экономное', ratio: 1, pixels: 1_250_000, effects: 'low' }),
});
const STORAGE_KEY = 'belobog-graphics-v1';
const CHANGE_EVENT = 'belobog-graphics-change';

export function graphicsPreset(value) {
  if (value === 'low') return 'economy';
  return Object.hasOwn(GRAPHICS_PRESETS, value) ? value : 'sharp';
}
export function graphicsPixelRatio({ width, height, dpr = 1, preset = 'sharp', maxTextureSize = 8192 }) {
  const finite = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const w = finite(width, 1), h = finite(height, 1), native = finite(dpr, 1);
  const config = GRAPHICS_PRESETS[graphicsPreset(preset)];
  return Math.min(native, config.ratio, Math.sqrt(config.pixels / (w * h)), finite(maxTextureSize, 8192) / Math.max(w, h));
}
export function readGraphicsPreference(storage) {
  try { return graphicsPreset((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)); }
  catch { return 'sharp'; }
}
export function saveGraphicsPreference(value) {
  const preset = graphicsPreset(value);
  try { globalThis.localStorage?.setItem(STORAGE_KEY, preset); } catch { /* Session choice still works in private browsing. */ }
  globalThis.window?.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: preset }));
  return preset;
}
export function observeGraphicsPreference(update, target = globalThis.window) {
  const local = event => update(graphicsPreset(event.detail));
  const remote = event => { if (event.key === STORAGE_KEY || event.key === null) update(readGraphicsPreference()); };
  target?.addEventListener(CHANGE_EVENT, local); target?.addEventListener('storage', remote);
  return () => { target?.removeEventListener(CHANGE_EVENT, local); target?.removeEventListener('storage', remote); };
}
