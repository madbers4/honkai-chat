import { actionContext } from './action-context.js';
import { ATTACKS, COMBAT_WINDOWS, HEAVY_RULES, V5_ATTACKS, VARIANT_ATTACKS, V5_RULES } from '../shared/constants.js';
import { continuation } from '../shared/attack-commitment.js';

const freeActions = new Set(['idle', 'walk', 'crouch', 'block', 'jump']);
const cue = (key, target, text, priority, tone = 'attack') => ({ key, target, text, priority, tone });

export function overloadThreat(state, playerId) {
  if (state?.phase !== 'fight' || state.story?.paused) return null;
  const player = state.players?.find(p => p.id === playerId), enemy = state.players?.find(p => p.id !== playerId);
  if (!player || !enemy || player.hp <= 0 || player.connected === false || enemy.hp <= 0 || enemy.action !== 'ultimate') return null;
  const remaining = ATTACKS.ultimate.startup - enemy.actionTime;
  const distance = (player.x - enemy.x) * enemy.facing;
  if (!(remaining > 0) || distance < -.10 || distance > ATTACKS.ultimate.range + .35 || player.y - enemy.y > ATTACKS.ultimate.hitHeight) return null;
  return { remaining, jumpNow: remaining <= .60 && remaining >= .15 };
}

// A cue is a currently executable action, not a prediction or a tutorial recipe.
// No local timers: pause, seek, lost HP and expired windows clear it immediately.
// A stable key/target keeps the same DOM decoration across snapshot packets.
export function planActionCue(state, playerId, intent = {}) {
  const player = state?.players?.find(p => p.id === playerId);
  if (!player || !(player.hp > 0) || player.connected === false || state.story?.paused) return null;
  const moves = actionContext(player, intent, state);
  if (moves.finish.canTrigger) return cue('finish', 'heavy', 'ДОБЕЙ!', 100, 'finish');
  if (state.phase !== 'fight') return null;
  if (moves.tech) return cue('tech', 'light', 'ВЫРВИСЬ!', 95, 'escape');
  if (moves.burst && moves.dash.ready) return cue('burst', 'dash', 'СБРОСЬ · 50 ⚡', 90, 'escape');
  if (player.grabbedBy || ['ko', 'recover', 'defeated', 'destroyed', 'victory', 'finisher'].includes(player.action)) return null;
  if (moves.holding) {
    if (player.grabThrowTime != null) return null;
    if (moves.pummelReady) return cue('pummel', 'light', 'ДОЖМИ!', 80);
    if (moves.strikeCount >= V5_RULES.grabStrikeLimit || player.grabHoldTime > V5_RULES.grabHold - V5_RULES.grabStrikeDuration)
      return cue('throw', 'heavy', 'БРОСАЙ!', 80);
    return null;
  }
  const free = freeActions.has(player.action) && !(player.landingRecovery > 0);
  const threat = overloadThreat(state, playerId);
  if (threat?.jumpNow && free && player.y <= .01)
    return cue('overload-jump', 'jump', 'ПРЫГАЙ · ВВЕРХ!', 88, 'danger');
  if (moves.defenseOnly) {
    if (!free) return null; // During the actual microstun only the paid burst can execute.
    if (player.y <= .08 && player.guard > 0) return cue('defend', 'block', 'ДЕРЖИ БЛОК!', 85, 'escape');
    if (moves.dash.ready && moves.airDash) return cue('retreat-air', 'dash', 'ОТСКОЧИ!', 85, 'escape');
    return null;
  }
  if (player.landingRecovery > 0) return null;
  if (player.jumpCancelWindow > 0 && player.y <= .01
    && (free || player.variant === 'launcher' && player.actionTime >= COMBAT_WINDOWS.launcherJumpCancel))
    return cue('pursue', 'jump', 'ВВЕРХ · ДОГОНИ!', 75);
  const combo = moves.combo;
  if (combo.open && (!intent.crouch || !combo.heavy)) {
    const attack = V5_ATTACKS[player.variant] || VARIANT_ATTACKS[player.variant];
    const naturalLink = player.actionTime >= (continuation(player)?.open ?? Infinity);
    const ready = free || (player.cancelWindow > 0 && (combo.heavy
      ? player.action === 'heavy' && (naturalLink || player.cancelWindow <= HEAVY_RULES.cancelWindow - HEAVY_RULES.cancelAfterContact)
      : player.action === 'light' && attack && player.actionTime >= attack.startup + V5_RULES.cancelAfterContact));
    if (ready && (combo.heavy || !moves.airborne || player.airActions < V5_RULES.airLightLimit))
      return cue(combo.heavy ? 'heavy-chain' : 'light-chain', combo.heavy ? 'heavy' : 'light', 'ПРОДОЛЖАЙ!', 70);
  }
  if (moves.counter && free && (!moves.airborne || player.airActions < V5_RULES.airLightLimit)) return cue('counter', 'light', 'ОТВЕЧАЙ!', 65);
  if (moves.ram && player.actionTime >= COMBAT_WINDOWS.dashCancel) return cue('ram', 'light', 'ТАРАНЬ!', 60);
  if (moves.feint && moves.dash.ready) return cue('feint', 'dash', 'ОТМЕНИ · 12 ⚡', 40, 'escape');
  return null;
}
