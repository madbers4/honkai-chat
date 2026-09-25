const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const pulse = (time, start, peak, end) => time < peak ? smooth((time - start) / (peak - start)) : 1 - smooth((time - peak) / (end - peak));

export { faceoffPowerEnvelope } from '../shared/faceoff-script.js';

/** Mechanical acting, not a combat attack: planted three-legged support,
 * one expressive claw, delayed turret reaction and a readable held pose. */
export function choreographFaceoff(variant, elapsed, duration, legs, { reducedMotion = false } = {}) {
  const t = Math.max(0, Number(elapsed) || 0), end = Math.max(.4, Number(duration) || 2.3);
  const inPose = smooth(t / .42), outPose = 1 - smooth((t - end + .33) / .33), hold = inPose * outPose;
  const beat = pulse(t, .16, .42, 1.10), nod = pulse(t, .38, .62, 1.1);
  const idle = reducedMotion ? 0 : Math.sin(t * 2.3) * .01;
  const pose = { bob: idle, lean: 0, roll: 0, twist: 0, thrust: 0, headPitch: 0, headYaw: 0, headRoll: 0 };
  for (const leg of legs) { leg.desired.x *= 1 + hold * .045; if (!leg.front) leg.desired.z -= .035 * hold; }
  if (variant === 'arrival') {
    const settle = pulse(t, .12, .65, end);
    pose.bob -= .045 * settle; pose.headPitch = -.045 * hold; pose.headYaw = .06 * hold;
    for (const leg of legs) {
      const phase = leg.front ? 0 : .18;
      const step = pulse(t, phase, phase + .26, phase + .65);
      leg.desired.y += .12 * step; leg.desired.z += .06 * step;
    }
  } else if (variant === 'reactor') {
    // A contained chassis compression feeds the core; the face rises only
    // after the heavy body settles. No shaking or instant pose reset.
    const charge = pulse(t, .12, 1.20, end - .1);
    const lock = pulse(t, .72, 1.65, end - .08);
    pose.bob -= .10 * charge; pose.lean = -.035 * charge;
    pose.headPitch = -.12 * charge + .17 * lock; pose.headRoll = -.025 * hold;
    for (const leg of legs) {
      leg.desired.x *= 1 + .10 * charge;
      if (leg.front) { leg.desired.z += .13 * charge; leg.desired.y += .06 * charge; }
    }
  } else if (variant === 'actuators') {
    const first = pulse(t, .1, .65, 1.52), second = pulse(t, .8, 1.35, 2.3);
    pose.bob -= .045 * hold; pose.twist = .045 * (first - second);
    pose.headYaw = -.08 * first + .07 * second; pose.headPitch = .07 * hold;
    for (const leg of legs) if (leg.front) {
      const work = leg.side === 'FL' ? first : second;
      leg.desired.y += .47 * work; leg.desired.z += .21 * work;
      leg.desired.x *= 1 - .18 * work;
    }
  } else if (variant === 'armed') {
    pose.bob -= .06 * hold; pose.lean = .035 * hold; pose.headPitch = .04 * hold;
    for (const leg of legs) {
      leg.desired.x *= 1 + .055 * hold;
      if (leg.front) { leg.desired.y += .17 * hold; leg.desired.z += .15 * hold; }
    }
  } else if (variant === 'challenge') {
    pose.bob -= .055 * hold; pose.lean = -.045 * hold; pose.thrust = .02 * hold;
    pose.headPitch = -.10 * hold; pose.headYaw = -.12 * hold; pose.headRoll = -.075 * hold + .025 * nod;
    for (const leg of legs) if (leg.side === 'FR') { leg.desired.x *= 1 + .15 * hold; leg.desired.y += .52 * hold; leg.desired.z += .36 * hold + .08 * beat; }
  } else if (variant === 'point') {
    pose.bob -= .06 * hold; pose.lean = .055 * hold; pose.twist = -.055 * hold; pose.thrust = .035 * hold;
    pose.headPitch = .055 * hold; pose.headYaw = .10 * hold;
    for (const leg of legs) if (leg.side === 'FL') { leg.desired.x = leg.home.x * (1 - .40 * hold); leg.desired.y += .66 * hold; leg.desired.z += .56 * hold + .12 * beat; }
  } else if (variant === 'recoil') {
    const surprise = pulse(t, 0, .15, .75), recover = smooth(t / .8);
    pose.bob -= .08 * surprise; pose.lean = -.12 * surprise; pose.thrust = -.04 * surprise;
    pose.headPitch = -.13 * surprise; pose.headYaw = .12 * surprise; pose.headRoll = .11 * surprise;
    if (!reducedMotion) pose.headYaw += Math.sin(t * 13) * .035 * (1 - recover);
  } else if (variant === 'resolve') {
    pose.bob += .035 * hold; pose.lean = -.02 * hold; pose.headPitch = .085 * nod - .04 * hold;
    pose.headYaw = -.07 * hold; pose.headRoll = .035 * hold;
    for (const leg of legs) if (leg.side === 'FR') { leg.desired.x = leg.home.x * (1 - .34 * hold); leg.desired.y += .43 * hold; leg.desired.z -= .13 * hold; }
  } else { pose.headYaw = -.035 * hold; pose.headPitch = -.02 * hold; }
  return pose;
}
