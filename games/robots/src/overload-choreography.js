import { ATTACKS, ULTIMATE_PULSES } from '../shared/constants.js';
const smooth = v => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };
const beat = (t, start, peak, end) => t < peak ? smooth((t - start) / (peak - start)) : 1 - smooth((t - peak) / (end - peak));

/** Feet first, pressure second, discharge last. A spring recovery connects
 * all three beats instead of restarting the same one-shot pose. */
export function choreographOverload(time, legs, reduced = false, releasedAt = null) {
  const release = releasedAt ?? ULTIMATE_PULSES[2].time;
  const brace = smooth(time / .42), returnToStand = smooth((time - release - .20) / .53);
  const load = smooth((time - .20) / (ATTACKS.ultimate.startup - .28)) * (1 - smooth((time - release - .01) / .38));
  const pulses = ULTIMATE_PULSES.map((p, i) => releasedAt != null && p.time > releasedAt + .025 ? 0 : beat(time, p.time, p.time + (i === 2 ? .055 : .035), p.time + (i === 2 ? .43 : .23)));
  const recoil = pulses[0] * .58 + pulses[1] * .76 + pulses[2];
  const anticipation = beat(time, ATTACKS.ultimate.startup - .40, ATTACKS.ultimate.startup - .09, ATTACKS.ultimate.startup);
  const support = brace * (1 - returnToStand);
  const pose = { bob: -.17 * support - .035 * recoil, thrust: -.06 * load - .19 * recoil,
    lean: -.055 * load - .14 * recoil, roll: .022 * (pulses[0] - pulses[1]), twist: 0,
    headPitch: -.13 * load + .12 * recoil - .055 * anticipation,
    headYaw: (pulses[0] - pulses[1]) * .10, headRoll: (pulses[1] - pulses[0]) * .045,
    charge: load * 1.5 + recoil * .8, open: load * .09 };
  for (const leg of legs) {
    const stepStart = leg.sign < 0 ? .025 : .145;
    const spread = smooth((time - stepStart) / .23) * (1 - returnToStand);
    leg.desired.x *= 1 + spread * (leg.front ? .19 : .14);
    leg.desired.z += spread * (leg.front ? .13 : -.12);
    // Each front claw deliberately reseats; rear pair always supports the hull.
    if (leg.front && !reduced) leg.desired.y += beat(time, stepStart, stepStart + .085, stepStart + .23) * .16;
  }
  return pose;
}

export function choreographOverloadHit(time, duration, legs, reduced = false) {
  const shock = 1 - smooth(time / Math.max(.16, duration));
  const lock = smooth(time / .045) * (1 - smooth((time - duration + .12) / .12));
  const tremor = reduced ? 0 : Math.sin(time * 54) * Math.exp(-time * 5);
  for (const leg of legs) {
    leg.desired.x *= 1 + .11 * shock;
    leg.desired.z += (leg.front ? -.08 : -.025) * shock;
    // Contact stays weighted. Only an already airborne robot moves its root.
    if (leg.front) leg.desired.y += .04 * Math.max(0, tremor);
  }
  return { bob: -.13 * shock, thrust: -.07 * shock, lean: -.12 * shock,
    roll: .025 * tremor, twist: .018 * tremor, headPitch: .20 * shock,
    headYaw: .065 * tremor, headRoll: -.10 * lock + .035 * tremor, charge: .9 * lock };
}
