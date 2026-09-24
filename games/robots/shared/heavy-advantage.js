import { HEAVY_RULES, V5_ATTACKS, VARIANT_ATTACKS } from './constants.js';

export const isGroundHeavy = variant => ['heavyDrive', 'heavyHook', 'heavyPress'].includes(variant);
export const offenseLocked = player => (player?.defenseOnly ?? 0) > 0;
export const isDefensiveAction = action => action === 'jump' || action === 'dash';

export function grantHeavyAdvantage(target, variant) {
  if (!['heavyDrive', 'heavyHook'].includes(variant)) return;
  target.defenseOnly = Math.max(target.defenseOnly || 0, V5_ATTACKS[variant].stun + HEAVY_RULES.defenseAfterStun);
  target.counterWindow = target.parryWindow = 0;
  target.queued = null;
}

/** One shallow ground bounce; an airborne victim never receives more lift. */
export function applySlamBounce(target, variant) {
  if (variant !== 'slam' || target.y > .08 || target.slamBounceUsed || target.airLaunchUsed) return false;
  target.slamBounceUsed = true;
  target.airLaunchUsed = true;
  target.airHits = 1;
  target.vy = VARIANT_ATTACKS.slam.bounceSpeed;
  target.y = Math.max(.001, target.y);
  return true;
}
