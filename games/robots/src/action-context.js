import { ATTACKS, VARIANT_ATTACKS, V3_RULES, V5_RULES, COMBAT_WINDOWS, canAttemptAirDash, canAttemptBurst, canAttemptFeint } from '../shared/constants.js';
import { continuation } from '../shared/attack-commitment.js';

// One description drives the button, its resource feedback and the help prompt.
// Legality and final choice remain authoritative on the server.
export function actionContext(player = {}, intent = {}, state = null) {
  const airborne = (player.y || 0) > .08 && !player.groundHeavy;
  const defenseOnly = (player.defenseOnly || 0) > 0;
  const finish = finishContext(state, player.id);
  const tech = player.variant === 'grabbed' && player.grabTechWindow > 0;
  const holding = Boolean(player.grabTarget);
  const strikeCount = Math.max(0, player.grabStrikes || 0);
  const burst = canAttemptBurst(player);
  const feint = canAttemptFeint(player);
  const grab = !!intent.crouch && !airborne && !holding;
  const combo = comboCue(player);
  const crusher = !airborne && !grab && combo.stage === 2 && !combo.heavy;
  const launcher = !airborne && !grab && !crusher && (player.launchWindow > 0 || combo.stage === 1 && !combo.heavy);
  const ram = player.action === 'dash' && !player.variant;
  const counter = player.counterWindow > 0;
  const wave = !!intent.crouch && !airborne;
  const airDash = airborne && !burst && !feint;
  const dash = {
    label: burst ? 'СБРОС' : defenseOnly ? 'ОТСКОК' : feint ? 'ОТМЕНА' : airDash ? 'В ВОЗДУХЕ' : 'РЫВОК',
    kind: burst ? 'burst' : feint ? 'feint' : airDash ? 'airDash' : 'dash',
    cost: burst ? V3_RULES.burstEnergy : feint ? V3_RULES.feintEnergy : 0,
    cooldown: Math.max(0, player.cooldowns?.[burst ? 'burst' : 'dash'] || 0),
  };
  dash.ready = (player.energy || 0) >= dash.cost && dash.cooldown <= 0 && (!airDash || canAttemptAirDash(player));
  return {
    airborne, tech, holding, strikeCount, pummelReady: holding && strikeCount < V5_RULES.grabStrikeLimit && player.grabHoldTime >= V3_RULES.grabTech && player.grabHoldTime <= V5_RULES.grabHold - V5_RULES.grabStrikeDuration && player.grabStrikeTime == null && player.grabThrowTime == null,
    defenseOnly, burst, feint, grab, launcher, crusher, ram, counter, wave, dash, airDash, combo, finish,
    light: tech ? 'ВЫРВАТЬСЯ' : holding ? 'ДОЖИМ' : ram ? 'ТАРАН' : counter ? 'КОНТРУДАР' : combo.nextLight || 'УДАР',
    heavy: finish.canTrigger ? 'ДОБИТЬ' : holding ? (intent.move * player.facing < -.2 ? 'НАЗАД' : 'БРОСОК') : airborne ? 'ПИКЕ' : grab ? 'ЗАХВАТ' : combo.nextHeavy || (crusher ? 'ДРОБИТЕЛЬ' : launcher ? 'ПОДБРОС' : 'ТЯЖЁЛЫЙ'),
    special: wave ? 'ВОЛНА' : 'ИМПУЛЬС',
  };
}

export function actionResource(action, player = {}, intent = {}, state = null) {
  if (finishContext(state, player.id).canTrigger && ['heavy', 'ultimate'].includes(action)) return { cost: 0, cooldown: 0 };
  if (action === 'dash') {
    const dash = actionContext(player, intent).dash;
    // A failed paid burst can still be a valid ordinary dash queued for the
    // end of a short hit reaction. Do not swallow that packet on the client.
    if (dash.kind === 'burst' && !dash.ready && player.actionDuration - player.actionTime <= COMBAT_WINDOWS.inputBuffer)
      return { cost: 0, cooldown: Math.max(0, player.cooldowns?.dash || 0) };
    return dash;
  }
  const attack = action === 'special' && intent.crouch && !(player.y > .08) ? VARIANT_ATTACKS.shockwave : ATTACKS[action];
  return { cost: attack?.energy || 0, cooldown: Math.max(0, player.cooldowns?.[action] || 0) };
}

export function finishContext(state, playerId) {
  const finish = state?.finish;
  const active = state?.phase === 'finishing' && Boolean(finish);
  const mine = active && finish.winner === playerId;
  return { active, mine, executing: active && finish.stage === 'execute',
    canTrigger: Boolean(active && mine && finish.stage === 'offer' && finish.canTrigger),
    remaining: active ? Math.max(0, finish.time || 0) : 0,
    type: finish?.type || '' };
}

export function comboCue(player = {}) {
  const open = Boolean((player.cancelWindow > 0 || continuation(player)) && player.hp > 0
    && !['hit', 'ko', 'recover'].includes(player.action) && !player.grabbedBy && !player.grabTarget && !(player.defenseOnly > 0));
  const variant = player.variant || ({ jab: 'jab', 'jab-cross': 'cross', airJab: 'airJab', 'airJab-airCross': 'airCross', heavyDrive: 'heavyDrive', 'heavyDrive-heavyHook': 'heavyHook' })[player.comboRoute] || '';
  const airborne = (player.y || 0) > .08 && !player.groundHeavy;
  if (!open) return { open: false, text: '', nextLight: '', stage: 0 };
  if (!airborne && ['heavyDrive', 'heavyHook'].includes(variant)) return { open, heavy: true, stage: variant === 'heavyHook' ? 2 : 1, nextLight: '',
    nextHeavy: variant === 'heavyHook' ? 'ПРЕСС' : 'КРЮК',
    text: variant === 'heavyHook' ? 'ТЯЖЁЛЫЙ — ПРЕСС · ФИНАЛ СЕРИИ' : 'ТЯЖЁЛЫЙ — КРЮК · ПРОДОЛЖАЙ СЕРИЮ' };
  if (airborne) return { open, stage: variant === 'airCross' ? 2 : 1,
    nextLight: variant === 'airCross' ? 'СБИТЬ' : 'ПРОДОЛЖИТЬ',
    text: variant === 'airCross' ? 'УДАР — СБИТЬ ВНИЗ · ТЯЖЁЛЫЙ — ПИКЕ' : 'УДАР — ВОЗДУШНАЯ СЕРИЯ · РЫВОК — ДОГНАТЬ' };
  if (variant === 'cross') return { open, stage: 2, nextLight: 'РАССЕЧЬ', text: 'УДАР — РАССЕЧЕНИЕ · ТЯЖЁЛЫЙ — ДРОБИТЕЛЬ' };
  if (['jab', 'dashStrike'].includes(variant)) return { open, stage: 1, nextLight: 'КРОСС', text: 'УДАР — КРОСС · ТЯЖЁЛЫЙ — ПОДБРОС' };
  return { open: false, text: '', nextLight: '', stage: 0 };
}
