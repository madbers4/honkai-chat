import { ATTACKS, VARIANT_ATTACKS, clamp } from '../shared/constants.js';

const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const pulse = (time, start, peak, end) => time < peak ? smooth((time - start) / (peak - start)) : 1 - smooth((time - peak) / (end - peak));

/** Authored phases in simulation seconds. Four planted contacts support the
 * coil gun; the mine has a distinct two-prong placement stroke and unload. */
export function specialChoreography(variant, elapsed, { reducedMotion = false } = {}) {
  const wave = variant === 'shockwave';
  const attack = wave ? VARIANT_ATTACKS.shockwave : ATTACKS.special;
  const t = Math.max(0, Number(elapsed) || 0), release = attack.startup;
  const load = smooth(t / (release - .07)) * (1 - smooth((t - release) / .17));
  const discharge = pulse(t, release - .025, release + .045, release + .28);
  const settle = pulse(t, release + .15, release + .29, attack.duration);
  const brace = smooth(t / .16) * (1 - smooth((t - release - .2) / (attack.duration - release - .2)));
  const placement = wave ? pulse(t, .02, .25, release + .13) : 0;
  const tap = wave ? pulse(t, .29, release, release + .16) : 0;
  const scale = reducedMotion ? .7 : 1;
  return {
    charge: load * 1.15 + discharge * .75,
    bob: scale * (wave ? -.10 * load - .035 * tap + .035 * settle : -.06 * load + .018 * settle),
    lean: scale * (wave ? .11 * load - .045 * discharge : .055 * load - .10 * discharge + .02 * settle),
    thrust: scale * (wave ? .055 * load - .08 * discharge : -.035 * load - .17 * discharge + .025 * settle),
    twist: scale * (wave ? 0 : -.04 * load + .055 * discharge),
    headPitch: scale * (wave ? .18 * load - .065 * discharge : -.06 * load + .16 * discharge - .035 * settle),
    headYaw: scale * (wave ? 0 : .035 * load - .07 * discharge),
    front: { xScale: 1 + .095 * brace, z: .13 * load + (wave ? .23 * tap : 0), lift: wave ? .33 * placement * (1 - tap) : 0 },
    rear: { xScale: 1 + .13 * brace, z: -.045 * brace, lift: 0 },
  };
}

export function electricalReaction(variant, elapsed, duration, height = 0, reducedMotion = false) {
  const p = clamp(elapsed / Math.max(.1, duration), 0, 1);
  const lock = smooth(p / .07) * (1 - smooth((p - .56) / .44));
  const kick = pulse(p, 0, .13, .7);
  const airborne = variant === 'empLift' ? smooth(height / .16) : 0;
  // Two decaying servo catches, never an endless screen-frequency shake.
  const catchMotion = reducedMotion ? 0 : Math.sin(p * Math.PI * 5) * lock * .018;
  return { bob: -.035 * lock, lean: -.10 * kick - .09 * airborne,
    thrust: -.10 * kick, headPitch: .15 * kick + .06 * lock, headYaw: catchMotion,
    roll: catchMotion * .65, tuck: .24 * airborne, spread: 1 + .07 * lock - .13 * airborne };
}
