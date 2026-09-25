export const SIMULATION_HZ = 60;
export const SNAPSHOT_HZ = 30;
export const MAX_HP = 180;
export const ROUND_SECONDS = 75;
export const WINS_TO_MATCH = 5;
export const COUNTDOWN_SECONDS = 3;
export const ROUND_BREAK_SECONDS = 3.4;
export const ARENA_EDGE = 10.8;
export const PLAYER_RADIUS = 1;
export const WALK_SPEED = 3.1;
export const AIR_MOVE_SPEED = 6.2;
export const JUMP_CLEARANCE = 3.1;
export const GRAVITY = 23;
export const JUMP_SPEED = 14.5;
export const INPUT_TIMEOUT_SECONDS = 0.45;
export const COMBAT_WINDOWS = Object.freeze({
  inputBuffer: 0.30, parry: 0.14, parryCooldown: 0.70, counter: 1.20, counterDamage: 6,
  launcher: 1.0, dashCancel: 0.07, dashFollow: 0.16, launcherJumpCancel: 0.29,
});
export const ACTIONS = Object.freeze(['jump', 'light', 'heavy', 'dash', 'special', 'ultimate']);
export const ATTACKS = Object.freeze({
  light: { duration: 0.34, startup: 0.105, active: 0.11, range: 2.35, damage: 7, guardDamage: 12, knockback: 0.9, stun: 0.22 },
  heavy: { duration: 0.81, startup: 0.36, active: 0.17, range: 2.85, damage: 17, guardDamage: 39, knockback: 4.6, stun: 0.43 },
  special: { duration: 0.78, startup: 0.30, active: 0.06, energy: 25, cooldown: 2.6, damage: 28, guardDamage: 28, knockback: 2.8, stun: 0.38, speed: 11.5, height: 1.35, life: 1.5 },
  ultimate: { duration: 2.28, startup: 0.95, active: 0.60, range: 5.2, energy: 80, cooldown: 8, damage: 220, guardDamage: 86, knockback: 5.4, stun: 0.60 },
  dash: { duration: 0.31, cooldown: 1.1, speed: 8.8 },
});

export const VARIANT_ATTACKS = Object.freeze({
  dashStrike: { duration: 0.48, startup: 0.13, active: 0.13, range: 2.95, damage: 11, guardDamage: 18, knockback: 2.5, stun: 0.28 },
  launcher: { duration: 0.78, startup: 0.23, active: 0.15, range: 2.75, damage: 13, guardDamage: 30, knockback: 0.75, stun: 0.52, launchSpeed: 9.3 },
  slam: { duration: 0.85, startup: 0.10, active: 0, range: 3.15, damage: 28, guardDamage: 48, knockback: 3.4, stun: 0.28, recovery: 0.46, diveSpeed: 9.5, bounceSpeed: 3.0 },
  shockwave: { ...ATTACKS.special, duration: 1.05, startup: 0.42, energy: 35, cooldown: 4, damage: 42, guardDamage: 39, knockback: 2.0, stun: 0.55, launchSpeed: 5.8, speed: 0, height: 0.06, life: 0.72, detonationDelay: 0.12, expansionTime: 0.16, radius: 3.65, hitHeight: 0.55 },
});

export const ULTIMATE_PULSES = Object.freeze([
  { time: 0.95, damage: 45, guardDamage: 20, knockback: 0, stun: 0.36 },
  { time: 1.23, damage: 55, guardDamage: 24, knockback: 0, stun: 0.42 },
  { time: 1.55, damage: 120, guardDamage: 42, knockback: 5.4, stun: 0.60 },
]);
// Compatibility for external copy consumers; the control is now an immediate tap.
export const ULTIMATE_HOLD_SECONDS = 0;
export const ULTIMATE_ARMOR = Object.freeze({ until: 1.55, breakers: Object.freeze(['grab', 'launcher', 'shockwave', 'slam']) });

export const V3_RULES = Object.freeze({
  grabStartup: 0.26, grabActive: 0.10, grabDuration: 0.95, grabRange: 2.5,
  grabTech: 0.24, grabHold: 0.30, grabRecovery: 0.30, grabDamage: 15, grabImmunity: 0.80,
  postHitGrabImmunity: 0.22, throwStun: 0.48,
  burstEnergy: 50, burstCooldown: 12, burstDuration: 0.50, burstImmunity: 0.22, burstRadius: 3.4,
  feintEnergy: 12, feintStart: 0.06, feintEnd: 0.28, feintDuration: 0.30, feintSpeed: 4.8,
  punishDamage: 3,
});

// State-only predicates are shared by the authoritative engine and contextual touch labels.
// Resource checks remain separate so an unavailable action can explain its actual cost.
export function canAttemptBurst(player) {
  return Boolean(player && player.hp > 0 && player.action === 'hit' && ['', 'launched', 'thrown', 'electrified', 'empLift', 'overloadHit', 'heavyStagger', 'slamBounce'].includes(player.variant ?? '') && !player.grabbedBy);
}

export function canAttemptFeint(player) {
  return Boolean(player && player.hp > 0 && player.action === 'heavy' && ['', 'heavyDrive'].includes(player.variant ?? '') && player.y < 0.08
    && player.actionTime >= V3_RULES.feintStart && player.actionTime <= V3_RULES.feintEnd);
}

// V5 integration API: timings are authoritative seconds from action start.
export const V5_ATTACKS = Object.freeze({
  heavyDrive: { duration: 0.88, startup: 0.44, active: 0.10, range: 2.85, damage: 24, guardDamage: 42, knockback: 0.80, stun: 0.18, stepSpeed: 1.8, stepStart: 0.235, stepEnd: 0.49, hopStart: 0.235, hopSpeed: 2.6, heightReach: .72 },
  heavyHook: { duration: 0.86, startup: 0.34, active: 0.10, range: 2.95, damage: 28, guardDamage: 48, knockback: 1.00, stun: 0.20, stepSpeed: 1.7, stepStart: 0.17, stepEnd: 0.39, hopStart: 0.17, hopSpeed: 2.1, heightReach: .72 },
  heavyPress: { duration: 1.16, startup: 0.40, active: 0.12, range: 3.05, damage: 36, guardDamage: 62, knockback: 5.8, stun: 0.20, stepSpeed: 1.6, stepStart: 0.19, stepEnd: 0.44, hopStart: 0.19, hopSpeed: 2.5, heightReach: .82 },
  jab: { duration: 0.38, startup: 0.11, active: 0.10, range: 2.35, damage: 6, guardDamage: 10, knockback: 0.55, stun: 0.26, stepSpeed: 1.1, stepStart: 0.03, stepEnd: 0.16 },
  cross: { duration: 0.49, startup: 0.16, active: 0.12, range: 2.60, damage: 8, guardDamage: 15, knockback: 0.70, stun: 0.30, stepSpeed: 2.0, stepStart: 0.03, stepEnd: 0.20 },
  rake: { duration: 0.68, startup: 0.24, active: 0.12, range: 2.95, damage: 12, guardDamage: 22, knockback: 4.8, stun: 0.43, stepSpeed: 2.1, stepStart: 0.07, stepEnd: 0.28 },
  launcher: { duration: 0.86, startup: 0.24, active: 0.14, range: 2.75, damage: 11, guardDamage: 30, knockback: 0.25, stun: 0.60, launchSpeed: 9.4, stepSpeed: 1.6, stepStart: 0.06, stepEnd: 0.23 },
  crusher: { duration: 1.02, startup: 0.34, active: 0.14, range: 2.95, damage: 19, guardDamage: 48, knockback: 6.2, stun: 0.58, stepSpeed: 1.3, stepStart: 0.10, stepEnd: 0.36 },
  airJab: { duration: 0.30, startup: 0.09, active: 0.10, range: 2.60, damage: 5, guardDamage: 8, knockback: 0.25, stun: 0.18 },
  airCross: { duration: 0.36, startup: 0.12, active: 0.10, range: 2.80, damage: 6, guardDamage: 10, knockback: 0.35, stun: 0.20 },
  airFinish: { duration: 0.48, startup: 0.17, active: 0.12, range: 3.00, damage: 9, guardDamage: 18, knockback: 2.2, stun: 0.28, downwardSpeed: 5.5 },
});
// A confirmed heavy yields a short stun followed by a defend-only advantage:
// the victim can block, jump or retreat, but cannot interrupt the next strike.
export const HEAVY_RULES = Object.freeze({ cancelAfterContact: 0.12, cancelWindow: 0.25, defenseAfterStun: 0.44 });
export const V5_RULES = Object.freeze({
  jabCancel: 0.40, crossCancel: 0.44, airCancel: 0.30, cancelAfterContact: 0.045,
  airLightLimit: 3, airHitLimit: 4, airDashDuration: 0.18, airDashSpeed: 7.2, landingRecovery: 0.16,
  pursuitJumpSpeed: 9.0, pursuitSpeed: 2.6, pursuitDuration: 0.24,
  grabHold: 1.25, grabStrikeDuration: 0.30, grabStrikeImpact: 0.12, grabStrikeDamage: 4, grabStrikeLimit: 2,
  grabThrowWindup: 0.20, grabEarliestThrow: 0.30,
  recoverDuration: 1.60, initialRecoverDuration: 0.75,
});
export const FINISH_RULES = Object.freeze({ offerDuration: 3.0, duration: 3.70, impactTime: 1.25, destructionTime: 2.15, stagingTime: 0.45, distance: 2.10, botTriggerTime: 0.85 });

export function canAttemptAirDash(player) {
  if (!player || player.hp <= 0 || player.y <= 0.08 || player.airDashUsed || (player.landingRecovery ?? 0) > 0) return false;
  if (['jump', 'idle', 'walk'].includes(player.action)) return true;
  const attack = V5_ATTACKS[player.variant];
  return player.action === 'light' && ['airJab', 'airCross'].includes(player.variant) && player.cancelWindow > 0
    && player.actionTime >= attack.startup + V5_RULES.cancelAfterContact;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
