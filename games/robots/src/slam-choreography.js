import { GRAVITY, SIMULATION_HZ, VARIANT_ATTACKS } from '../shared/constants.js';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const beat = (t, peak, end) => t < peak ? ease(t / peak) : 1 - ease((t - peak) / (end - peak));

/** Renderer-only prediction for this committed dive; null preserves the normal jump path. */
export function slamRenderHeight(player, predictionAge = 0) {
  if (player?.variant !== 'slam') return null;
  if (Number.isFinite(player.landedTime)) return 0;
  const age = Math.max(0, Math.min(.05, predictionAge));
  // Match the server's semi-implicit fixed step between 30 Hz snapshots.
  // Exponential following cannot catch a fast descending target before floor
  // contact, especially once impact hitstop slows articulation to five percent.
  const windup = Math.min(age, Math.max(0, VARIANT_ATTACKS.slam.startup - (player.actionTime ?? 0)));
  const fall = age - windup;
  const windupY = (player.y ?? 0) + (player.vy ?? 0) * windup - GRAVITY * windup * (windup + 1 / SIMULATION_HZ) * .5;
  const fallSpeed = Math.min((player.vy ?? 0) - GRAVITY * windup, -VARIANT_ATTACKS.slam.diveSpeed);
  return Math.max(0, windupY + fallSpeed * fall - GRAVITY * 1.6 * fall * (fall + 1 / SIMULATION_HZ) * .5);
}

/** Remove the preceding jump's follow lag during the existing gather, before descent. */
export function createSlamRootFollower() {
  let lastAge = -1, entryAge = 0, entryOffset = 0;
  return {
    reset() { lastAge = -1; entryOffset = 0; },
    update(player, predictionAge, fallbackY) {
      const target = slamRenderHeight(player, predictionAge);
      if (target === null) { this.reset(); return null; }
      const age = (player.actionTime ?? 0) + predictionAge;
      if (lastAge < 0 || age < lastAge - .04) {
        entryAge = age;
        entryOffset = age < VARIANT_ATTACKS.slam.startup ? fallbackY - target : 0;
      }
      lastAge = age;
      if (Number.isFinite(player.landedTime)) return 0;
      const transition = Math.max(.025, VARIANT_ATTACKS.slam.startup - entryAge);
      return Math.max(0, target + entryOffset * (1 - ease((age - entryAge) / transition)));
    },
  };
}

/** Articulation only. Authoritative root height, velocity and contact are never replaced. */
export function slamChoreography({ elapsed = 0, y = 0, vy = 0, vx = 0, facing = 1, landedTime = null, reducedMotion = false } = {}) {
  const landed = Number.isFinite(landedTime);
  const age = landed ? Math.max(0, elapsed - landedTime) : 0;
  const descending = ease((elapsed - .055) / .065);
  // A short hop must open its supports sooner than a dive from the apex. The
  // deployment follows remaining flight, not a decorative impact timestamp.
  const toFloor = Math.max(0, y) / Math.max(VARIANT_ATTACKS.slam.diveSpeed, -vy);
  const deploy = landed ? 1 : ease((.155 - toFloor) / .13) * ease(elapsed / .075);
  const gather = mix(.52, 1, ease(elapsed / .055)) * (1 - deploy);
  const release = landed ? ease((age - .19) / (VARIANT_ATTACKS.slam.recovery - .19)) : 0;
  const brace = deploy * (1 - release);
  const compression = landed ? beat(age, .057, .255) : 0;
  const settle = landed ? beat(Math.max(0, age - .16), .10, .26) : 0;
  const directionLean = Math.max(-.025, Math.min(.025, vx * facing * .008));
  const diveLean = (.14 * descending + directionLean) * (1 - deploy);
  // The head lags the load by one beat while all four toes carry the chassis.
  // Reduced motion keeps the readable squat, removing its small return overshoot.
  const headLag = landed ? beat(age, .092, .33) : 0;
  return {
    phase: landed ? age < .12 ? 'absorb' : 'settle' : deploy > .55 ? 'brace' : descending > .5 ? 'dive' : 'gather',
    bob: .035 * gather - .215 * compression + (reducedMotion ? 0 : .021 * settle),
    lean: diveLean + .025 * brace + .046 * compression,
    headPitch: -.075 * gather - .11 * descending * (1 - deploy) + .083 * headLag,
    front: { xScale: 1 - .27 * gather + .13 * brace, y: .66 * gather, z: -.17 * gather + .15 * brace },
    rear: { xScale: 1 - .22 * gather + .10 * brace, y: .46 * gather, z: .14 * gather - .10 * brace },
    gather, brace, compression,
  };
}
