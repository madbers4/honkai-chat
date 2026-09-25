import { healthPercent } from './health.js';
import { rebootSignals } from './shutdown-motion.js';
import { ATTACKS } from './constants.js';
import { faceoffPowerEnvelope } from './faceoff-script.js';

/**
 * Both original head lenses belong to HP. Ability status modulates the reactor.
 * HP fraction: green >60%, amber >25%, red >0, offline at 0 or KO.
 * Priority: offline > burst > parry > grabbed > hit > ultimate > special >
 * grab > block > attack > energy-ready > standby. Reactor tint retains team ID.
 * Critical fault dips use slow, smooth, deterministic waves, never random strobe.
 * Reduced motion removes wall-clock variation. KO dimming follows actionTime
 * over 1.6 seconds, so pauses and replay frames cannot advance it accidentally.
 * Emissive values stay modest: health <=.80, status <=1.24, reactor <=1.30.
 */

const COLORS = Object.freeze({
  healthy: 0x35d96d, damaged: 0xffab24, critical: 0xef4247, offline: 0x552a2d,
  amber: 0xffb33f, cyan: 0x47dce9,
  guard: 0x79dfef, burst: 0x96f0fa, strike: 0xffdfaa, charge: 0xb187f2,
  grapple: 0xff8566, stagger: 0xe74a50,
});
const bound = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const smooth = value => { const t = bound(value, 0, 1); return t * t * (3 - 2 * t); };

function phaseFor(player, skin) {
  const identity = typeof player.id === 'string' ? player.id : skin;
  let hash = 17;
  for (let i = 0; i < identity.length; i++) hash = (hash * 31 + identity.charCodeAt(i)) >>> 0;
  return hash % 997 / 997 * Math.PI * 2;
}

function faultDip(time, phase) {
  const wave = 0.58 * Math.sin(time * 0.91 + phase)
    + 0.28 * Math.sin(time * 0.47 + phase * 0.53)
    + 0.14 * Math.sin(time * 1.41 + phase + 1);
  return smooth(((wave + 1) * 0.5 - 0.63) / 0.27);
}

function selectStatus(player, offline, energy) {
  const action = player.action ?? 'idle';
  const variant = player.variant ?? '';
  if (offline) return 'offline';
  if (variant === 'burst' || finite(player.burstInvulnerable, 0) > 0) return 'burst';
  if (variant === 'parry') return 'parry';
  if (variant === 'grabbed' || player.grabbedBy) return 'grabbed';
  if (action === 'hit') return 'hit';
  if (action === 'ultimate') return 'ultimate';
  if (action === 'special') return 'special';
  if (variant === 'grab' || player.grabTarget) return 'grab';
  if (action === 'block') return 'block';
  if (['light', 'heavy', 'dash'].includes(action)) return 'attack';
  if (action === 'faceoff') return 'faceoff';
  if (energy >= ATTACKS.ultimate.energy && finite(player.cooldowns?.ultimate, 0) <= 0) return 'energy-ready';
  return 'standby';
}

export function robotPresentation(player = {}, time = 0, { reducedMotion = false } = {}) {
  if (!player || typeof player !== 'object') player = {};
  const hp = healthPercent(player);
  const energy = bound(finite(player.energy, 0), 0, 100);
  const actionTime = Math.max(0, finite(player.actionTime, 0));
  const duration = Math.max(0.01, finite(player.actionDuration, 0.8));
  const progress = bound(actionTime / duration, 0, 1);
  const skin = player.skin === 'cyan' ? 'cyan' : 'amber';
  const teamColor = COLORS[skin];
  const destroyed = player.action === 'destroyed';
  const recovering = player.action === 'recover';
  const offline = hp <= 0 || ['ko', 'defeated', 'destroyed'].includes(player.action);
  const healthBand = offline ? 'offline' : hp > 60 ? 'healthy' : hp > 25 ? 'damaged' : 'critical';
  const damage = offline ? 1 : 1 - hp / 100;
  const status = selectStatus(player, offline, energy);
  // Bounding astronomical input prevents overflow; ordinary game clocks never wrap.
  const clock = finite(time, 0) % 65536;
  const phase = phaseFor(player, skin);
  const fault = reducedMotion ? 0 : faultDip(clock, phase);
  const breathe = reducedMotion ? 0 : Math.sin(clock * 1.15 + phase) * 0.035;

  if (offline) {
    const remaining = 1 - smooth(actionTime / 1.6);
    return {
      healthBand, damage, status, healthColor: COLORS.offline, healthIntensity: destroyed ? 0 : 0.025 + 0.24 * remaining,
      statusColor: COLORS.offline, statusIntensity: destroyed ? 0 : 0.018 + 0.18 * remaining,
      reactorColor: teamColor, reactorIntensity: destroyed ? 0 : 0.02 + 0.20 * remaining,
      abilityColor: COLORS.offline, power: destroyed ? 0 : remaining * .3, destroyed, recovering: false,
    };
  }

  if (recovering) {
    const boot = rebootSignals(progress, { reducedMotion });
    const readyIntensity = (0.62 + hp / 100 * 0.18) * boot.ready;
    const intensity = Math.max(boot.intensity, readyIntensity);
    const color = boot.ready > 0 ? COLORS[healthBand] : boot.color;
    return {
      healthBand, damage, status: 'recover', healthColor: color, healthIntensity: intensity,
      statusColor: color, statusIntensity: intensity * .90,
      reactorColor: teamColor, reactorIntensity: (0.24 + energy / 100 * 0.34) * boot.power,
      abilityColor: teamColor, power: boot.power, destroyed: false, recovering: true,
    };
  }

  // Abilities never recolor or brighten the health channel.
  const boot = 1;
  const healthIntensity = (0.62 + hp / 100 * 0.18) * (healthBand === 'critical' ? 1 - fault * 0.22 : 1) * boot;
  let statusColor = teamColor;
  let statusIntensity = 0.52 + energy / 100 * 0.14;
  let reactorIntensity = (0.24 + energy / 100 * 0.34) * (1 - damage * 0.12);

  if (status === 'burst') {
    statusColor = COLORS.burst;
    statusIntensity = 1.20 - smooth(actionTime / 0.5) * 0.30;
    reactorIntensity = 1.30 - smooth(actionTime / 0.5) * 0.57;
  } else if (status === 'parry') {
    statusColor = COLORS.guard; statusIntensity = 1.15; reactorIntensity = 0.85;
  } else if (status === 'grabbed' || status === 'grab') {
    statusColor = COLORS.grapple; statusIntensity = status === 'grabbed' ? 0.76 : 0.91;
    reactorIntensity = Math.max(reactorIntensity, 0.52);
  } else if (status === 'hit') {
    statusColor = COLORS.stagger;
    statusIntensity = (0.60 + (1 - progress) * 0.13) * (1 - fault * 0.15);
  } else if (status === 'ultimate' || status === 'special') {
    const charge = Math.sin(Math.PI * bound(progress / 0.75, 0, 1));
    statusColor = COLORS.charge;
    statusIntensity = 0.95 + charge * (status === 'ultimate' ? 0.29 : 0.15);
    reactorIntensity = 0.76 + charge * (status === 'ultimate' ? 0.48 : 0.26);
  } else if (status === 'block') {
    statusColor = COLORS.guard; statusIntensity = 0.79;
  } else if (status === 'attack') {
    statusColor = COLORS.strike; statusIntensity = 0.88 + (1 - progress) * 0.22;
  } else if (status === 'energy-ready') {
    statusColor = COLORS.charge; statusIntensity = 0.96 + breathe;
    reactorIntensity = 0.80 + breathe;
  } else if (status === 'faceoff') {
    const power = faceoffPowerEnvelope(player.variant, actionTime, duration, { reducedMotion });
    // The existing physical reactor lamp and emissive material share this
    // envelope; the original health lenses retain their HP colour throughout.
    reactorIntensity = Math.min(1.30, reactorIntensity + power.core * .92 + power.drives * .18);
  }

  return {
    healthBand, damage, status: recovering ? 'recover' : status, healthColor: COLORS[healthBand], healthIntensity,
    // Compatibility names still describe the original lower material slot.
    // Its hue is now always HP; the status hue is available as abilityColor.
    statusColor: COLORS[healthBand], statusIntensity: healthIntensity * (reducedMotion ? .90 : .90 + .035 * Math.sin(clock * 1.8 + phase)),
    reactorColor: teamColor, reactorIntensity: reactorIntensity * (recovering ? .10 + .90 * boot : 1),
    abilityColor: statusColor, power: boot, destroyed, recovering,
  };
}
