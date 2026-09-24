import { V3_RULES, V5_RULES } from '../shared/constants.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const pulse = (t, a, b, c) => t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));
const neutral = () => ({ bob: 0, lean: 0, roll: 0, twist: 0, thrust: 0, headPitch: 0, headYaw: 0, headRoll: 0 });

// One free arm, one persistent lock. A second pummel is an undercut, not a
// mirrored repetition that would momentarily release the entire opponent.
export function grappleBeat(player) {
  const t = Number.isFinite(player.grabStrikeTime) ? player.grabStrikeTime : -1;
  const second = player.grabStrikes === 2;
  const impact = V5_RULES.grabStrikeImpact, end = V5_RULES.grabStrikeDuration;
  return {
    second,
    load: t < 0 ? 0 : pulse(t, 0, impact * .49, impact),
    drive: t < 0 ? 0 : t <= impact ? smooth((t - impact * .47) / (impact * .53)) : 1 - smooth((t - impact - .035) / (end - impact - .035)),
    // A caught machine anticipates the throw, but never anticipates damage.
    recoil: t < impact ? 0 : pulse(t, impact, impact + .032, end),
    brace: Number.isFinite(player.grabThrowTime) ? smooth(player.grabThrowTime / V5_RULES.grabThrowWindup) : 0,
  };
}

export function choreographGrapple(player, elapsed, duration, legs, model, facing) {
  const pose = neutral(), beat = grappleBeat(player);
  const holdTime = Math.max(0, Number(player.grabHoldTime) || 0);
  const holding = Boolean(player.grabTarget) && !Number.isFinite(player.grabReleaseTime);
  const released = Number.isFinite(player.grabReleaseTime);
  const releaseAge = released ? Math.max(0, elapsed - player.grabReleaseTime) : 0;
  const nearSide = facing === 1 ? 'FL' : 'FR';
  const swingSign = nearSide === 'FL' ? -1 : 1;
  const back = player.throwStyle === 'back';
  const catchBlend = smooth(holdTime / .065);
  const coil = pulse(elapsed, 0, .12, V3_RULES.grabStartup);
  const reach = smooth((elapsed - .055) / .205) * (1 - smooth((elapsed - .36) / .38));
  const toss = released ? pulse(releaseAge, 0, back ? .105 : .065, V3_RULES.grabRecovery) : 0;
  const recover = smooth(releaseAge / V3_RULES.grabRecovery);

  pose.bob = holding ? -.11 - beat.brace * .075 : -coil * .08 - reach * .05;
  pose.lean = holding ? .10 - beat.brace * .17 + beat.drive * .055 : reach * .11;
  pose.thrust = holding ? .075 - beat.brace * .08 + beat.drive * .035 : reach * .09;
  pose.twist = swingSign * (beat.drive * (beat.second ? .16 : .09) - beat.load * .11);
  pose.headPitch = holding ? -.055 + beat.load * .035 - beat.drive * .065 : coil * .08;
  pose.headYaw = -swingSign * beat.drive * .06;
  if (released) {
    pose.bob = mix(-.185, 0, recover);
    pose.lean = mix(-.07, 0, recover) + toss * (back ? -.17 : .13);
    pose.thrust = mix(-.005, 0, recover) + toss * (back ? -.03 : .14);
    pose.twist = swingSign * toss * (back ? -.15 : .07);
    pose.headPitch = -toss * .10;
  }

  for (const leg of legs) {
    if (!leg.front) {
      const planted = holding ? 1 : released ? 1 - recover : reach;
      leg.desired.x *= 1 + planted * .10;
      leg.desired.z -= planted * .075;
      continue;
    }
    leg.desired.set(mix(leg.home.x, leg.sign * .73, reach), leg.home.y + reach * .70 + coil * .12, leg.home.z + reach * .70 - coil * .11);
    if (holding) {
      // These points are on the original lower housing, below the shoulders.
      // The victim's folded arms remain above and outside these two lanes.
      const partnerX = Number.isFinite(player.grabPartnerX) ? player.grabPartnerX : model.parent.parent.position.x + facing * 2.1;
      const partnerY = Number(player.grabPartnerY) || 0;
      const lateral = mix(.58, .38, catchBlend);
      leg.world.set(partnerX - facing * (.30 + beat.brace * .02), partnerY + .62 - beat.brace * .075, -facing * leg.sign * lateral);
      if (leg.side === nearSide) {
        // Straight piston: visibly retract then hit the forward shell.
        // Undercut: coil lower/outward, then strike upward into the same belt.
        leg.world.x -= facing * (beat.load * (beat.second ? .43 : .48) + beat.drive * .22);
        leg.world.y += beat.load * (beat.second ? -.17 : .16) + beat.drive * (beat.second ? .16 : .015);
        leg.world.z += beat.load * (beat.second ? .22 : .10) - beat.drive * .16;
      }
      model.worldToLocal(leg.world);
      leg.desired.lerp(leg.world, smooth(holdTime / .045));
    } else if (released) {
      const entry = leg.grappleEntry;
      leg.desired.copy(entry || leg.home).lerp(leg.home, recover);
      // Opening happens before the reset. The hands never chase the released
      // root through the victim's flight or swing through each other.
      leg.desired.x += leg.sign * toss * .24;
      leg.desired.y += toss * (back ? .82 : .43);
      leg.desired.z += toss * (back ? -.64 : .25);
    }
  }
  return pose;
}

export function choreographGrabbed(player, elapsed, legs, facing) {
  const pose = neutral(), beat = grappleBeat(player);
  const hold = smooth(Math.max(0, Number(player.grabHoldTime) || elapsed) / .075);
  const side = facing === -1 ? 1 : -1;
  pose.bob = -.065 * hold - .075 * beat.brace;
  pose.lean = -.10 * hold - beat.recoil * (beat.second ? .13 : .08);
  pose.thrust = -.025 * beat.recoil;
  pose.roll = side * beat.recoil * (beat.second ? .055 : .11);
  pose.headPitch = .12 * hold + beat.recoil * (beat.second ? -.13 : .16) - beat.brace * .08;
  pose.headYaw = -side * beat.recoil * .13;
  pose.headRoll = side * beat.recoil * .055;
  for (const leg of legs) {
    if (leg.front) {
      leg.desired.x = mix(leg.home.x, leg.sign * .97, hold);
      leg.desired.y += hold * 1.02 + beat.recoil * .07;
      leg.desired.z = mix(leg.home.z, .28, hold);
    } else {
      leg.desired.x *= 1 + .07 * hold;
      leg.desired.z -= .025 * hold;
    }
  }
  return pose;
}

export function choreographGrabBreak(elapsed, duration, legs) {
  const pose = neutral();
  const release = smooth(elapsed / duration), open = pulse(elapsed, 0, .07, duration);
  pose.bob = -.04 * open;
  pose.lean = -.10 * open;
  pose.thrust = -.065 * open;
  pose.headPitch = .07 * open;
  for (const leg of legs) if (leg.front) {
    leg.desired.copy(leg.grappleEntry || leg.home).lerp(leg.home, release);
    leg.desired.x += leg.sign * .19 * open;
    leg.desired.y += .09 * open;
    leg.desired.z -= .09 * open;
  }
  return pose;
}
