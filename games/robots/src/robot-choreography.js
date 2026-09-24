// Mechanical beats match COMBAT-V5-RULES. Only local joints/weight transfer;
// authoritative movement and airborne height always remain outside this module.
import { V5_ATTACKS } from '../shared/constants.js';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = (t, a, b, c) => t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));
export const ROBOT_BEATS = Object.freeze({ jab: .11, cross: .16, rake: .24, crusher: .34, airJab: .09, airCross: .12, airFinish: .17,
  heavyDrive: V5_ATTACKS.heavyDrive.startup, heavyHook: V5_ATTACKS.heavyHook.startup, heavyPress: V5_ATTACKS.heavyPress.startup });

export function choreographStrike(variant, time, duration, legs) {
  if (['heavyDrive', 'heavyHook', 'heavyPress'].includes(variant)) return choreographHeavy(variant, time, legs);
  const startup = ROBOT_BEATS[variant];
  if (startup === undefined) return null;
  const ready = pulse(time, 0, startup * .58, startup + .005);
  const stroke = smooth((time - startup + .048) / .048);
  const recover = smooth((time - startup - .09) / Math.max(.12, duration - startup - .09));
  const impact = stroke * (1 - recover);
  const over = pulse(time, startup + .028, startup + .075, startup + .18);
  const air = variant.startsWith('air');
  const cross = variant === 'cross' || variant === 'airCross';
  const rake = variant === 'rake';
  const hammer = variant === 'crusher' || variant === 'airFinish';
  const hand = cross ? 'FR' : 'FL';
  const body = { bob: 0, lean: 0, roll: 0, twist: 0, thrust: 0, headPitch: 0, headYaw: 0 };
  const set = (leg, x, y, z, amount) => {
    leg.desired.x = lerp(leg.desired.x, x, amount);
    leg.desired.y = lerp(leg.desired.y, y, amount);
    leg.desired.z = lerp(leg.desired.z, z, amount);
  };
  if (air) for (const leg of legs) {
    leg.desired.x *= .78;
    leg.desired.z *= .80;
    leg.desired.y += leg.front ? .28 : .54;
  }
  for (const leg of legs) {
    if (!leg.front) {
      if (!air) { leg.desired.x *= 1 + ready * .09 + impact * .08; leg.desired.z -= impact * .07; }
      continue;
    }
    if (hammer) {
      set(leg, leg.sign * .67, 1.72, .43, ready);
      set(leg, leg.sign * .46, (air ? .12 : .43) - over * .15, 1.83 + over * .10, impact);
    } else if (leg.side === hand) {
      set(leg, leg.sign * (cross ? .88 : .60), cross ? 1.15 : .93, .27, ready);
      if (rake) {
        const sweep = smooth((time - startup + .045) / .16);
        set(leg, lerp(-.83, .80, sweep), .95 - .18 * sweep, 1.83 + Math.sin(sweep * Math.PI) * .17, impact);
      } else if (cross) {
        set(leg, -.38 - over * .15, 1.04 - over * .12, 1.94, impact);
      } else {
        set(leg, -.19, .83 + over * .045, 1.94 + over * .14, impact);
      }
    } else {
      set(leg, leg.sign * .50, .80, .54, Math.max(ready, impact) * .84);
    }
    // A raised return arc clears the struck housing before setting the foot.
    leg.desired.y += Math.sin(recover * Math.PI) * .18;
  }
  if (hammer) {
    body.bob = -.09 * ready - (air ? .06 : .24) * impact;
    body.lean = -.23 * ready + .35 * impact;
    body.thrust = -.12 * ready + .18 * impact;
    body.headPitch = -.19 * ready + .14 * impact;
  } else if (rake) {
    body.twist = -.28 * ready + .37 * impact;
    body.roll = -.13 * ready + .14 * impact;
    body.lean = -.09 * ready + .17 * impact;
    body.bob = -.12 * impact;
    body.headYaw = -body.twist * .75;
    body.thrust = -.07 * ready + .12 * impact;
  } else if (cross) {
    body.twist = -.22 * ready + .31 * impact;
    body.roll = .12 * ready - .19 * impact;
    body.lean = -.09 * ready + .18 * impact;
    body.bob = -.085 * impact;
    body.thrust = -.07 * ready + .16 * impact;
    body.headYaw = -.18 * impact;
  } else {
    body.twist = .09 * ready - .12 * impact;
    body.roll = .10 * impact;
    body.lean = -.10 * ready + .17 * impact;
    body.thrust = -.085 * ready + .14 * impact;
    body.bob = -.045 * impact;
    body.headYaw = .11 * impact;
  }
  if (air) { body.roll *= 1.45; body.lean += variant === 'airFinish' ? .13 * impact : -.06 * ready; }
  return body;
}

// A heavy is a sequence of mechanical poses, not an enlarged jab. The two rear
// feet carry the chassis while a foreleg strikes. Each return has its own lifted
// arc and the rear feet compensate for the exact server-authoritative advance.
function choreographHeavy(variant, time, legs) {
  const attack = V5_ATTACKS[variant], t = Math.max(0, time), hit = attack.startup;
  const press = variant === 'heavyPress', hook = variant === 'heavyHook';
  const peak = hit - (press ? .12 : .10);
  const recoilAt = hit + .075;
  const settleAt = attack.duration;
  const pose = (keys, values) => {
    let n = 0;
    while (n < keys.length - 1 && t > keys[n + 1]) n++;
    if (n === keys.length - 1) return values[n];
    return lerp(values[n], values[n + 1], smooth((t - keys[n]) / (keys[n + 1] - keys[n])));
  };
  const keys = [0, peak, hit, recoilAt, settleAt];
  const load = pulse(t, 0, peak, hit + .02);
  const force = pulse(t, hit - .09, hit, attack.duration - .10);
  const follow = pulse(t, hit, recoilAt, attack.duration - .07);
  const displacement = clamp(t - attack.stepStart, 0, attack.stepEnd - attack.stepStart) * attack.stepSpeed;
  const body = {
    bob: pose(keys, [0, press ? -.13 : -.10, press ? -.19 : -.09, press ? -.24 : -.13, 0]),
    lean: pose(keys, [hook ? .12 : 0, press ? -.24 : -.12, press ? .22 : .19, press ? .27 : .14, 0]),
    roll: (hook ? -.09 : .09) * load + (hook ? .12 : -.10) * force,
    twist: (hook ? -.16 : .08) * load + (hook ? .20 : -.09) * force,
    thrust: -.065 * load + (press ? .10 : .15) * force + .025 * follow,
    headPitch: press ? -.20 * load + .13 * force : .07 * load - .09 * force,
    headYaw: hook ? -.14 * force : .07 * force,
  };
  if (press) { body.roll *= .2; body.twist *= .2; }
  for (const leg of legs) {
    const h = leg.home ?? leg.desired;
    const hx = h.x, hy = h.y, hz = h.z;
    if (!leg.front) {
      // Push from a planted foot, then deliberately step it underneath again.
      const start = hit + (leg.side === 'RL' ? .09 : .20);
      const end = Math.min(settleAt - .025, start + .24);
      const replant = smooth((t - start) / (end - start));
      leg.desired.z = hz - displacement * (1 - replant);
      leg.desired.y = hy + Math.sin(replant * Math.PI) * (press ? .13 : .10);
      leg.desired.x = hx * (1 + .10 * load + .07 * force);
      continue;
    }
    const returnArc = Math.sin(smooth((t - recoilAt) / (settleAt - recoilAt)) * Math.PI);
    if (press) {
      // The preceding hook remains visible at the start of the press, while
      // the opposite claw has already recovered into its brace.
      const initialX = leg.side === 'FL' ? .48 : hx;
      const initialY = leg.side === 'FL' ? .96 : hy;
      const initialZ = leg.side === 'FL' ? 1.96 : hz;
      leg.desired.x = pose(keys, [initialX, leg.sign * .69, leg.sign * .48, leg.sign * .53, hx]);
      leg.desired.y = pose(keys, [initialY, 1.84, .58, .38, hy]) + returnArc * .20;
      leg.desired.z = pose(keys, [initialZ, .45, 2.00, 2.04, hz]);
    } else if (leg.side === (hook ? 'FL' : 'FR')) {
      // Drive: bent right claw punches through the center. Hook: left claw
      // takes an outside-to-inside diagonal path rather than a repeated punch.
      leg.desired.x = pose(keys, [hx, hook ? -1.08 : .68, hook ? .38 : .14, hook ? .58 : .08, hx]);
      leg.desired.y = pose(keys, [hy, hook ? .64 : 1.05, hook ? 1.05 : .87, hook ? 1.12 : .77, hy]) + returnArc * .22;
      leg.desired.z = pose(keys, [hz, hook ? .40 : .22, 2.04, 2.10, hz]);
    } else if (hook) {
      // Set the drive hand down before the hook loads the other shoulder.
      const plant = smooth(t / Math.max(.12, peak));
      leg.desired.x = lerp(.08, hx, plant);
      leg.desired.y = lerp(.77, hy, plant) + Math.sin(plant * Math.PI) * .16;
      leg.desired.z = lerp(2.10, hz - displacement * .35, plant);
      leg.desired.z = lerp(leg.desired.z, hz, smooth((t - recoilAt) / (settleAt - recoilAt)));
    } else {
      leg.desired.x = hx * (1 + .035 * load);
      leg.desired.z = hz - displacement * (1 - smooth((t - recoilAt) / (settleAt - recoilAt)));
      leg.desired.y = hy + returnArc * .08;
    }
  }
  return body;
}
