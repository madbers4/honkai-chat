/** One authoritative clock for the ordinary round-loss and reboot episode.
 * Times are seconds for shutdown and normalized progress for the variable-length
 * reboot. Finishers deliberately do not use this presentation timeline. */
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const bell = (t, a, b, c) => t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));

export const SHUTDOWN_DISCHARGES = Object.freeze([
  Object.freeze({ time: .10, key: 'head', count: 18, force: .82 }),
  Object.freeze({ time: .31, key: 'left', count: 23, force: 1.00 }),
  Object.freeze({ time: .49, key: 'right', count: 21, force: .92 }),
  Object.freeze({ time: .76, key: 'core', count: 27, force: 1.12 }),
  Object.freeze({ time: 1.12, key: 'head', count: 12, force: .60 }),
]);

export function shutdownMotion(elapsed = 0, { reducedMotion = false } = {}) {
  const t = finite(elapsed);
  const front = smooth((t - .12) / .35);
  const rear = smooth((t - .32) / .46);
  const settle = reducedMotion ? 0 : bell(t, .35, .46, .68);
  return {
    // A short entry blend preserves the interrupted punch or airborne pose.
    entry: smooth(t / .22), front, rear,
    // The original chassis has only 14 cm of ground clearance. A larger
    // crouch would rest its belly on the ground and lift all four feet.
    bob: -.062 * front - .028 * rear - .006 * settle,
    lean: .075 * front - .040 * rear,
    roll: 0,
    headPitch: .29 * smooth((t - .08) / .50),
    headYaw: 0, headRoll: 0,
    frontSpread: 1 + .06 * front,
    rearSpread: 1 + .045 * rear,
    feet: smooth(t / .32),
  };
}

export function rebootMotion(progress = 0) {
  const p = clamp(finite(progress));
  return {
    lift: smooth((p - .30) / .61),
    feet: smooth((p - .24) / .62),
    head: smooth((p - .46) / .48),
    servoCheck: bell(p, .38, .49, .64),
    headCheck: bell(p, .64, .72, .84) - .65 * bell(p, .81, .87, .97),
  };
}

export function rebootSignals(progress = 0, { reducedMotion = false } = {}) {
  const p = clamp(finite(progress));
  // Three finite diagnostic pulses, not a looping strobe. The two original
  // lenses keep their common HP colour after self-test has finished.
  const checks = [[.055, .125, .225, 0xef4247], [.275, .345, .445, 0xffab24], [.495, .57, .68, 0x35d96d]];
  let color = 0x552a2d;
  let intensity = 0;
  for (const [start, peak, end, hue] of checks) {
    if (p >= start && p < end) {
      color = hue;
      intensity = bell(p, start, peak, end) * (reducedMotion ? .34 : .63);
    }
  }
  const ready = smooth((p - .68) / .24);
  return { color, intensity, ready, power: smooth((p - .25) / .54) };
}
