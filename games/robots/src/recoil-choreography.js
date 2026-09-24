const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const beat = (t, start, peak, end) => t < peak ? ease((t - start) / (peak - start)) : 1 - ease((t - peak) / (end - peak));

/** Ordinary confirmed damage only. The victim snapshot carries stun duration,
 * not the attacker's strike name: weight derives from that authoritative value.
 * Every beat fits even the 50 ms anti-juggle stun; no invented hit or recovery. */
export function recoilChoreography({ elapsed = 0, duration = .32, y = 0, reducedMotion = false } = {}) {
  const span = Math.max(.001, Number.isFinite(duration) ? duration : .32);
  const t = Math.max(0, elapsed);
  const weight = ease((span - .25) / .27);
  const scale = Math.min(1, span / .22);
  const airborne = ease(Math.max(0, y) / .12);
  const drive = beat(t, 0, Math.min(.037, span * .16), span * .77);
  const catchWeight = beat(t, Math.min(.014, span * .07), Math.min(.10, span * .29), span * .90);
  const headFollow = beat(t, Math.min(.029, span * .12), Math.min(.135, span * .39), span * .96);
  const withdraw = beat(t, span * .43, span * .66, span);
  // Small opposing diagonals read successive short hits without guessing a
  // server-side limb identifier. Long impacts primarily drive the center mass.
  const side = span < .285 ? -1 : 1;
  const diagonal = side * (1 - weight * .8) * (reducedMotion ? .35 : 1);
  return {
    weight, drive, catchWeight, headFollow,
    phase: t >= span ? 'ready' : t < Math.min(.04, span * .17) ? 'contact' : t < span * .43 ? 'load' : 'return',
    bob: -mix(.024, .068, weight) * catchWeight * scale * (1 - airborne * .75),
    thrust: -mix(.048, .145, weight) * drive * scale,
    lean: -mix(.065, .12, weight) * drive * scale,
    roll: diagonal * .028 * drive * scale,
    twist: diagonal * .045 * drive * scale,
    // The turret initially stays with its inertia while the chassis gives;
    // only then does its own bearing rotate back and settle once.
    headPitch: (mix(.055, .105, weight) * drive - mix(.085, .18, weight) * headFollow) * scale,
    headYaw: diagonal * .10 * headFollow * scale,
    headRoll: diagonal * .037 * headFollow * scale,
    front: { xScale: 1 + .025 * catchWeight * scale, z: -.015 * withdraw * scale, y: .16 * airborne * drive },
    rear: { xScale: 1 + mix(.025, .075, weight) * catchWeight * scale, z: -mix(.025, .075, weight) * catchWeight * scale, y: .12 * airborne * drive },
  };
}
