// During ordinary playback use the interpolated visual root. A paused seek
// updates robots sequentially, so only the new snapshot identifies both ends
// of the pair consistently (the second visual may still be in its old flight).
export function pairedRoot(visual, snapshot, seek) {
  const primary = seek ? snapshot : visual;
  const fallback = seek ? visual : snapshot;
  return { x: primary?.x ?? fallback?.x, y: primary?.y ?? fallback?.y ?? 0 };
}
