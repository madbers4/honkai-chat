import {
  ACTIONS, ARENA_EDGE, ATTACKS, COMBAT_WINDOWS, COUNTDOWN_SECONDS, GRAVITY, INPUT_TIMEOUT_SECONDS, MAX_HP,
  JUMP_SPEED, PLAYER_RADIUS, ROUND_BREAK_SECONDS, ROUND_SECONDS, ULTIMATE_PULSES, V3_RULES, V5_ATTACKS, V5_RULES, FINISH_RULES, WINS_TO_MATCH, VARIANT_ATTACKS, WALK_SPEED,
  canAttemptAirDash, canAttemptBurst, canAttemptFeint, clamp, HEAVY_RULES, AIR_MOVE_SPEED,
} from '../shared/constants.js';
import { cleanCharacter } from '../shared/fighter-profile.js';
import { normalizeCustomization } from '../shared/robot-customization.js';
import { isGroundHeavy, offenseLocked, isDefensiveAction, grantHeavyAdvantage, applySlamBounce } from '../shared/heavy-advantage.js';
import { healthFraction } from '../shared/health.js';
import { continuation, acceptsContinuation, ultimateArmored } from '../shared/attack-commitment.js';
import { resolveTraversalContact } from './traversal.js';

const LOCKED_ACTIONS = new Set(['light', 'heavy', 'special', 'ultimate', 'dash', 'hit', 'ko', 'victory', 'recover', 'finisher', 'defeated', 'destroyed']);
const neutralInput = () => ({ move: 0, block: false, crouch: false });
const roundNumber = value => Math.round(value * 1000) / 1000;
const GRAB_ATTACK = Object.freeze({
  duration: V3_RULES.grabDuration, startup: V3_RULES.grabStartup, active: V3_RULES.grabActive,
  range: V3_RULES.grabRange, damage: V3_RULES.grabDamage, guardDamage: 0, knockback: 6.5, stun: V3_RULES.throwStun,
});

function makePlayer(id, name, bot = false, character = '', customization) {
  return {
    id, name, character: cleanCharacter(character), bot, connected: true, ready: bot,
    customization: normalizeCustomization(customization),
    x: id === 'p1' ? -2.7 : 2.7, y: 0, vx: 0, vy: 0, facing: id === 'p1' ? 1 : -1,
    hp: MAX_HP, maxHp: MAX_HP, energy: 40, guard: 100, wins: 0, action: 'idle', actionTime: 0,
    actionDuration: 0, variant: '', combo: 0, cooldowns: { dash: 0, special: 0, ultimate: 0, burst: 0 },
    counterWindow: 0, launchWindow: 0, parryWindow: 0, parryCooldown: 0,
    defenseOnly: 0, groundHeavy: false, heavyHopStarted: false, slamBounceUsed: false,
    traversalJump: false, traversalSide: 0, traversalLandingSide: 0,
    dashFollowWindow: 0, jumpCancelWindow: 0, airLaunchUsed: false, airHits: 0,
    skin: id === 'p1' ? 'amber' : 'cyan', input: neutralInput(), inputAge: 0,
    lastSeq: -1, queued: null, followup: null, comboExpiry: 0, chain: 0, chainExpiry: 0,
    hitTargets: new Set(), ultimatePulses: new Set(), projectileLaunched: false, dashDirection: 1, rematch: false,
    slamLanded: false, slamPending: false, landedTime: null, brainTimer: 0.4, brainSerial: 0, botBlockTimer: 0, botCrouchTimer: 0, botRetreatTimer: 0,
    grabTarget: null, grabbedBy: null, grabTechWindow: 0, grabHoldTime: 0, grabCatchTime: null, grabReleaseTime: null,
    grabImmunity: 0, burstInvulnerable: 0, attackConnected: false, punishConsumed: false, botTechAt: null,
    cancelWindow: 0, comboRoute: '', routeStage: 0, airActions: 0, airDashUsed: false, pursuitWindow: 0, landingRecovery: 0,
    grabStrikes: 0, grabStrikeTime: null, grabStrikeDuration: V5_RULES.grabStrikeDuration, grabStrikeHit: false,
    grabThrowTime: null, grabThrowRequested: false, throwStyle: 'forward', grabThrowDirection: 1, throwDrive: 0, throwFlight: false, throwFlightTime: 0, destructionTime: null,
  };
}

/** Pure fixed-step authoritative simulation; socket/session ownership lives in index.js. */
export class CombatRoom {
  constructor({ id = 'TEST00', mode = 'pvp', random = Math.random } = {}) {
    this.id = id;
    this.mode = mode === 'training' ? 'training' : 'pvp';
    this.random = random;
    this.players = [];
    this.phase = 'waiting';
    this.pausedFrom = null;
    this.resumePhase = null;
    this.time = ROUND_SECONDS;
    this.round = 1;
    this.countdown = 0;
    this.roundBreak = 0;
    this.winner = null;
    this.roundWinner = null;
    this.finish = null;
    this.finishMotion = null;
    this.lastHit = null;
    this.events = [];
    this.projectiles = [];
    this.elapsed = 0;
    this.combatTime = 0;
    this.nextEventId = 1;
    this.nextProjectileId = 1;
  }

  addPlayer(name = 'Первопроходец', { bot = false, character = '', customization } = {}) {
    if (this.players.length >= 2) return null;
    const player = makePlayer(`p${this.players.length + 1}`, name, bot, character, customization);
    this.players.push(player);
    return player;
  }

  player(id) { return this.players.find(player => player.id === id); }
  opponent(player) { return this.players.find(other => other.id !== player.id); }

  event(type, player, extra = {}) {
    this.events.push({ id: this.nextEventId++, type, x: player?.x ?? 0, y: (player?.y ?? 0) + 1.15,
      player: player?.id, at: this.elapsed, ...extra });
  }

  setConnected(id, connected) {
    const player = this.player(id);
    if (!player) return;
    player.connected = connected;
    player.input = neutralInput();
    player.queued = null;
    player.followup = null;
    player.lastSeq = -1;
    if (!connected && ['countdown', 'fight', 'roundOver', 'finishing'].includes(this.phase)) {
      this.pausedFrom = this.phase;
      this.phase = 'paused';
      for (const fighter of this.players) { fighter.input = neutralInput(); fighter.queued = null; fighter.followup = null; fighter.parryWindow = 0; }
    } else if (connected && this.phase === 'paused' && this.players.length === 2 && this.players.every(p => p.connected)) {
      if (this.pausedFrom === 'fight') {
        this.resumePhase = 'fight';
        this.countdown = COUNTDOWN_SECONDS;
        this.phase = 'countdown';
      } else this.phase = this.pausedFrom ?? 'waiting';
      this.pausedFrom = null;
    } else if (connected && this.phase === 'waiting' && this.players.length === 2 && this.players.every(p => p.connected && p.ready)) {
      this.startRound();
    }
  }

  ready(id) {
    const player = this.player(id);
    if (!player || this.phase !== 'waiting') return false;
    player.ready = true;
    if (this.players.length === 2 && this.players.every(p => p.ready && p.connected)) this.startRound();
    return true;
  }

  requestRematch(id) {
    if (this.phase !== 'matchOver') return false;
    const player = this.player(id);
    if (!player) return false;
    player.rematch = true;
    if (this.players.every(p => p.connected && (p.bot || p.rematch))) {
      this.round = 1;
      this.winner = null;
      this.players.forEach(p => { p.wins = 0; p.rematch = false; });
      this.startRound();
    }
    return true;
  }

  startRound() {
    this.time = ROUND_SECONDS;
    this.countdown = COUNTDOWN_SECONDS;
    this.phase = 'countdown';
    this.roundWinner = null;
    this.resumePhase = null;
    this.projectiles = [];
    this.finish = null;
    this.finishMotion = null;
    this.lastHit = null;
    for (const player of this.players) {
      const fresh = makePlayer(player.id, player.name, player.bot, player.character, player.customization);
      // Sequence numbers remain monotonic through round and match transitions.
      Object.assign(player, fresh, {
        wins: player.wins, connected: player.connected, ready: true, lastSeq: player.lastSeq,
      });
      this.setAction(player, 'recover', this.round === 1 ? V5_RULES.initialRecoverDuration : V5_RULES.recoverDuration);
    }
    this.event('round', null, { round: this.round });
  }

  input(id, input) {
    const player = this.player(id);
    if (!player || !player.connected || !Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq <= player.lastSeq) return false;
    if (!Number.isFinite(input.move) || typeof input.block !== 'boolean' || typeof input.crouch !== 'boolean') return false;
    if (input.action !== undefined && input.action !== null && !ACTIONS.includes(input.action)) return false;
    player.lastSeq = input.seq;
    player.inputAge = 0;
    if (this.phase === 'finishing') {
      if (this.finish?.stage === 'offer' && id === this.finish.winner && ['heavy', 'ultimate'].includes(input.action)) this.startFinisher('coreRip');
      return true;
    }
    if (this.phase !== 'fight') {
      player.input = neutralInput();
      return true;
    }
    this.applyControls(player, input);
    if (player.grabbedBy) {
      // Tech is an edge-triggered action received after the catch, never an old buffered light.
      if (input.action === 'light' && player.grabTechWindow > 0) this.breakGrab(player);
      return true;
    }
    if (player.grabTarget) {
      this.grabInput(player, input.action, input.move);
      return true;
    }
    if (input.action && offenseLocked(player) && !isDefensiveAction(input.action)) player.queued = player.followup = null;
    else if (input.action) {
      const queued = { action: input.action, crouch: input.crouch, expires: this.combatTime + COMBAT_WINDOWS.inputBuffer };
      // Two physical taps can arrive before one simulation tick. Preserve the
      // starter plus ONE next intent; repeated taps cannot build a macro queue.
      if (!LOCKED_ACTIONS.has(player.action) && ['light', 'heavy'].includes(player.queued?.action)
        && ['light', 'heavy'].includes(input.action)
        && !(input.action === 'heavy' && input.crouch) && !(player.queued.action === 'heavy' && player.queued.crouch)) player.followup = queued;
      else { player.followup = null; player.queued = queued; this.extendContinuationBuffer(player); }
    }
    return true;
  }

  applyControls(player, input) {
    const risingBlock = input.block && !player.input.block;
    if (risingBlock && !offenseLocked(player) && player.parryCooldown <= 0 && player.y < 0.1 && player.guard > 0 && !LOCKED_ACTIONS.has(player.action)) {
      player.parryWindow = COMBAT_WINDOWS.parry;
      player.parryCooldown = COMBAT_WINDOWS.parryCooldown;
    }
    if (!input.block) player.parryWindow = 0;
    player.input = { move: clamp(input.move, -1, 1), block: input.block, crouch: input.crouch };
  }

  setAction(player, action, duration = 0, variant = '') {
    if (player.grabTarget || player.grabbedBy) this.abortGrab(player);
    if (player.action === 'hit' && action !== 'hit') player.grabImmunity = Math.max(player.grabImmunity, V3_RULES.postHitGrabImmunity);
    player.action = action;
    player.variant = variant;
    if (!['light', 'heavy'].includes(action)) player.followup = null;
    player.groundHeavy = action === 'heavy' && isGroundHeavy(variant);
    player.heavyHopStarted = false;
    if (['ko', 'recover', 'defeated', 'destroyed'].includes(action)) player.defenseOnly = 0;
    player.actionTime = 0;
    player.actionDuration = duration;
    player.hitTargets.clear();
    player.ultimatePulses.clear();
    player.projectileLaunched = false;
    player.slamLanded = false;
    player.slamPending = false;
    player.landedTime = null;
    player.grabCatchTime = null;
    player.grabReleaseTime = null;
    player.grabHoldTime = 0;
    player.grabStrikes = 0;
    player.grabStrikeTime = null;
    player.grabThrowTime = null;
    player.attackConnected = false;
    player.punishConsumed = false;
    if (LOCKED_ACTIONS.has(action)) player.parryWindow = 0;
    if (['hit', 'ko', 'recover', 'defeated', 'destroyed'].includes(action)) {
      player.cancelWindow = player.launchWindow = player.pursuitWindow = 0;
      player.routeStage = 0;
      player.comboRoute = '';
    }
  }

  extendContinuationBuffer(player) {
    if (!player.queued || !acceptsContinuation(player, player.queued.action, player.queued.crouch)) return;
    const route = continuation(player);
    player.queued.expires = Math.max(player.queued.expires, this.combatTime + Math.max(0, route.open - player.actionTime) + .08);
  }

  beginAction(player, action, crouch = player.input.crouch) {
    if (player.grabTarget || player.grabbedBy) return false;
    const defenseOnly = offenseLocked(player);
    if (action === 'dash' && canAttemptBurst(player)) return this.beginBurst(player);
    if (defenseOnly && (!isDefensiveAction(action) || player.action === 'hit')) return false;
    if (action === 'dash' && canAttemptFeint(player)) return this.beginFeint(player);
    if (player.landingRecovery > 0) return false;
    if (action === 'dash' && canAttemptAirDash(player)) {
      if (player.cooldowns.dash > 0) return false;
      player.airDashUsed = true;
      player.cooldowns.dash = ATTACKS.dash.cooldown;
      player.dashDirection = defenseOnly ? -player.facing : Math.abs(player.input.move) > 0.2 ? Math.sign(player.input.move) : player.facing;
      player.dashFollowWindow = 0;
      this.setAction(player, 'dash', V5_RULES.airDashDuration, 'airDash');
      this.event('dash', player, { variant: 'airDash', duration: V5_RULES.airDashDuration, facing: player.facing });
      return true;
    }
    if (LOCKED_ACTIONS.has(player.action)) {
      const previousAttack = this.attackProperties(player);
      const naturalLink = player.cancelWindow > 0 && player.actionTime >= (continuation(player)?.open ?? Infinity);
      const confirmed = player.cancelWindow > 0 && player.actionTime >= (previousAttack?.startup ?? 1) + V5_RULES.cancelAfterContact;
      const lightChain = player.action === 'light' && action === 'light' && confirmed && ['jab', 'cross', 'airJab', 'airCross', 'dashStrike'].includes(player.variant);
      const heavyChain = player.action === 'heavy' && action === 'heavy' && !crouch && (player.y <= 0.08 || player.groundHeavy)
        && player.cancelWindow > 0 && ['heavyDrive', 'heavyHook'].includes(player.variant)
        && (naturalLink || player.cancelWindow <= HEAVY_RULES.cancelWindow - HEAVY_RULES.cancelAfterContact);
      const dashStrike = player.action === 'dash' && !player.variant && action === 'light' && player.actionTime >= COMBAT_WINDOWS.dashCancel;
      const confirmedLauncher = player.action === 'light' && action === 'heavy' && !crouch && confirmed && ['jab', 'cross', 'dashStrike', 'airJab', 'airCross'].includes(player.variant);
      const launcherJump = player.variant === 'launcher' && action === 'jump' && player.jumpCancelWindow > 0 && player.actionTime >= COMBAT_WINDOWS.launcherJumpCancel;
      if (!lightChain && !heavyChain && !dashStrike && !confirmedLauncher && !launcherJump) return false;
    }
    const opponent = this.opponent(player);
    player.facing = opponent.x >= player.x ? 1 : -1;
    if (action === 'jump') {
      if (player.y > 0.01) return false;
      const pursuit = player.jumpCancelWindow > 0;
      player.traversalJump = !pursuit;
      player.traversalSide = Math.sign(player.x - opponent.x) || -player.facing;
      player.traversalLandingSide = 0;
      player.vy = pursuit ? V5_RULES.pursuitJumpSpeed : JUMP_SPEED;
      player.pursuitWindow = pursuit ? V5_RULES.pursuitDuration : 0;
      if (player.bot && pursuit) player.brainTimer = 0.10;
      player.airActions = 0;
      player.airDashUsed = false;
      player.cancelWindow = player.launchWindow = 0;
      player.routeStage = 0;
      player.jumpCancelWindow = 0;
      this.setAction(player, 'jump', JUMP_SPEED * 2 / GRAVITY);
      return true;
    }
    if (action === 'dash') {
      if (player.cooldowns.dash > 0 || player.y > 0.05) return false;
      player.dashDirection = defenseOnly ? -player.facing : Math.abs(player.input.move) > 0.2 ? Math.sign(player.input.move) : player.facing;
      player.cooldowns.dash = ATTACKS.dash.cooldown;
      player.dashFollowWindow = ATTACKS.dash.duration + COMBAT_WINDOWS.dashFollow;
      this.setAction(player, 'dash', ATTACKS.dash.duration);
      this.event('dash', player);
      return true;
    }
    let variant = '';
    const airborne = player.y > 0.08 && !player.groundHeavy;
    const heavyRoute = player.comboRoute.startsWith('heavy');
    const heavyStage = player.cancelWindow > 0 && heavyRoute ? player.routeStage : 0;
    const stage = player.cancelWindow > 0 && !heavyRoute ? player.routeStage : 0;
    if (action === 'light') {
      if (airborne) {
        if (player.airActions >= V5_RULES.airLightLimit) return false;
        variant = stage === 1 ? 'airCross' : stage === 2 ? 'airFinish' : 'airJab';
      } else variant = player.dashFollowWindow > 0 ? 'dashStrike' : stage === 1 ? 'cross' : stage === 2 ? 'rake' : 'jab';
    }
    if (action === 'heavy') variant = airborne ? 'slam' : crouch ? 'grab' : stage === 2 ? 'crusher' : stage === 1 ? 'launcher' : heavyStage === 2 ? 'heavyPress' : heavyStage === 1 ? 'heavyHook' : 'heavyDrive';
    if (action === 'special') variant = crouch ? 'shockwave' : 'bolt';
    if (action === 'ultimate') variant = 'overload';
    const attack = variant === 'grab' ? GRAB_ATTACK : V5_ATTACKS[variant] ?? VARIANT_ATTACKS[variant] ?? ATTACKS[action];
    if (!attack || player.y > 0.1 && ['special', 'ultimate'].includes(action)) return false;
    if (attack.energy && (player.energy < attack.energy || player.cooldowns[action] > 0)) return false;
    if (attack.energy) {
      player.energy -= attack.energy;
      player.cooldowns[action] = attack.cooldown;
    }
    if (action === 'light' && airborne) player.airActions++;
    player.chain = variant === 'cross' ? 2 : variant === 'rake' || variant === 'crusher' ? 3 : variant === 'launcher' ? 2 : action === 'light' ? airborne ? player.airActions : 1 : 0;
    if (variant.startsWith('heavy')) player.chain = variant === 'heavyPress' ? 3 : variant === 'heavyHook' ? 2 : 1;
    const routes = { jab: 'jab', cross: 'jab-cross', rake: 'jab-cross-rake', launcher: 'jab-launcher', crusher: 'jab-cross-crusher', airJab: 'airJab', airCross: 'airJab-airCross', airFinish: 'airJab-airCross-airFinish', dashStrike: 'dashStrike' };
    player.comboRoute = routes[variant] ?? '';
    if (variant.startsWith('heavy')) player.comboRoute = variant === 'heavyPress' ? 'heavyDrive-heavyHook-heavyPress' : variant === 'heavyHook' ? 'heavyDrive-heavyHook' : 'heavyDrive';
    player.cancelWindow = player.launchWindow = 0;
    player.routeStage = 0;
    player.dashFollowWindow = 0;
    if (variant === 'launcher') player.launchWindow = 0;
    this.setAction(player, action, attack.duration, variant);
    this.event(action === 'special' || action === 'ultimate' ? action : 'attack', player, {
      action, variant, chain: player.chain, startup: attack.startup, active: attack.active, range: attack.range, duration: player.actionDuration, facing: player.facing,
      ...(action === 'special' || action === 'ultimate' ? { y: player.y + (attack.height ?? 1.35) } : {}),
    });
    return true;
  }

  attackProperties(player) {
    if (player.variant === 'grab') return GRAB_ATTACK;
    if (V5_ATTACKS[player.variant]) return V5_ATTACKS[player.variant];
    if (VARIANT_ATTACKS[player.variant]) return VARIANT_ATTACKS[player.variant];
    let base = ATTACKS[player.action];
    if (player.action === 'light' && player.y > 0.1) base = { ...base, range: base.range + 0.22 };
    if (player.action !== 'light' || player.chain < 2) return base;
    return { ...base, damage: player.chain === 3 ? 12 : 8, range: base.range + 0.1,
      knockback: player.chain === 3 ? 3.5 : 1.2, stun: player.chain === 3 ? 0.33 : 0.22 };
  }

  isInvulnerable(player) {
    return player.burstInvulnerable > 0 || player.action === 'dash' && !player.variant && player.actionTime < 0.22;
  }

  beginBurst(player) {
    if (player.energy < V3_RULES.burstEnergy || player.cooldowns.burst > 0) return false;
    const opponent = this.opponent(player);
    player.energy -= V3_RULES.burstEnergy;
    player.cooldowns.burst = V3_RULES.burstCooldown;
    player.burstInvulnerable = V3_RULES.burstImmunity;
    this.setAction(player, 'special', V3_RULES.burstDuration, 'burst');
    player.vx *= 0.25;
    player.launchWindow = 0;
    player.jumpCancelWindow = 0;
    player.dashFollowWindow = 0;
    player.combo = 0;
    player.comboExpiry = 0;
    player.chain = 0;
    opponent.combo = 0;
    opponent.comboExpiry = 0;
    opponent.chain = 0;
    const centerY = player.y + 1.1;
    this.projectiles = this.projectiles.filter(projectile => projectile.owner === player.id
      || Math.hypot(projectile.x - player.x, projectile.y - centerY) > V3_RULES.burstRadius);
    const nearby = Math.abs(opponent.x - player.x) < V3_RULES.burstRadius && Math.abs(opponent.y - player.y) < 2.4;
    if (nearby && opponent.hp > 0 && !this.isInvulnerable(opponent)) {
      const direction = Math.sign(opponent.x - player.x) || player.facing;
      this.setAction(opponent, 'hit', 0.28, 'burstRepelled');
      opponent.vx = direction * 7.4;
      opponent.queued = null;
      opponent.launchWindow = 0;
      opponent.jumpCancelWindow = 0;
      opponent.dashFollowWindow = 0;
    }
    this.event('burst', player, { target: opponent.id, y: centerY, radius: V3_RULES.burstRadius, duration: V3_RULES.burstDuration, facing: player.facing });
    return true;
  }

  beginFeint(player) {
    if (player.energy < V3_RULES.feintEnergy || player.cooldowns.dash > 0) return false;
    const opponent = this.opponent(player);
    player.facing = opponent.x >= player.x ? 1 : -1;
    player.dashDirection = -player.facing;
    player.energy -= V3_RULES.feintEnergy;
    player.cooldowns.dash = ATTACKS.dash.cooldown;
    player.dashFollowWindow = 0;
    player.launchWindow = 0;
    this.setAction(player, 'dash', V3_RULES.feintDuration, 'feint');
    this.event('feint', player, { facing: player.facing, duration: V3_RULES.feintDuration });
    return true;
  }

  tryGrab(attacker, target) {
    const distance = (target.x - attacker.x) * attacker.facing;
    if (attacker.grabTarget || target.grabbedBy || target.grabTarget || target.hp <= 0
      || target.y > 0.01 || target.vy > 0 || target.action === 'hit' || target.action === 'dash'
      || target.action === 'ko' || target.grabImmunity > 0 || this.isInvulnerable(target)
      || distance < 0 || distance >= V3_RULES.grabRange) return false;
    this.setAction(target, 'hit', V5_RULES.grabHold + V5_RULES.grabThrowWindup, 'grabbed');
    attacker.grabTarget = target.id;
    target.grabbedBy = attacker.id;
    attacker.grabCatchTime = attacker.actionTime;
    attacker.grabHoldTime = target.grabHoldTime = 0;
    target.grabTechWindow = V3_RULES.grabTech;
    attacker.actionDuration = attacker.actionTime + V5_RULES.grabHold + V5_RULES.grabThrowWindup + V3_RULES.grabRecovery;
    attacker.attackConnected = true;
    attacker.vx = target.vx = target.vy = 0;
    attacker.queued = target.queued = null;
    attacker.dashFollowWindow = target.dashFollowWindow = 0;
    target.launchWindow = target.jumpCancelWindow = 0;
    attacker.cancelWindow = target.cancelWindow = 0;
    attacker.grabStrikes = target.grabStrikes = 0;
    attacker.grabStrikeTime = target.grabStrikeTime = null;
    attacker.grabThrowTime = target.grabThrowTime = null;
    attacker.grabThrowRequested = false;
    attacker.throwStyle = target.throwStyle = 'forward';
    attacker.grabThrowDirection = target.grabThrowDirection = attacker.facing;
    // A bot sees the catch before deciding; only some reactions fit the human tech window.
    target.botTechAt = target.bot && this.random() < 0.38 ? 0.13 + this.random() * 0.09 : null;
    this.event('grab', attacker, { target: target.id, x: target.x, y: target.y + 1.1, facing: attacker.facing,
      duration: V5_RULES.grabHold, techWindow: V3_RULES.grabTech });
    return true;
  }

  detachGrab(attacker, target) {
    for (const player of [attacker, target]) {
      if (!player) continue;
      player.grabTarget = null;
      player.grabbedBy = null;
      player.grabTechWindow = 0;
      player.botTechAt = null;
      player.grabStrikeTime = null;
      player.grabThrowTime = null;
      player.queued = null;
    }
  }

  abortGrab(player, emit = true) {
    const attacker = player.grabTarget ? player : this.player(player.grabbedBy);
    const target = attacker && this.player(attacker.grabTarget);
    if (!attacker || !target) { this.detachGrab(player); return false; }
    this.detachGrab(attacker, target);
    for (const fighter of [attacker, target]) {
      fighter.grabImmunity = Math.max(fighter.grabImmunity, 0.4);
      this.setAction(fighter, 'hit', 0.20, 'grabBreak');
    }
    if (emit) this.event('grabBreak', target, { target: attacker.id, x: (attacker.x + target.x) / 2,
      y: target.y + 1.1, reason: 'interrupted', duration: 0.20 });
    return true;
  }

  breakGrab(target) {
    const attacker = this.player(target.grabbedBy);
    if (!attacker || attacker.grabTarget !== target.id || target.grabTechWindow <= 0) return false;
    this.detachGrab(attacker, target);
    const direction = Math.sign(target.x - attacker.x) || attacker.facing;
    for (const fighter of [attacker, target]) {
      this.setAction(fighter, 'hit', 0.25, 'grabBreak');
      fighter.grabImmunity = V3_RULES.grabImmunity;
      fighter.input = neutralInput();
    }
    attacker.vx = -direction * 2.8;
    target.vx = direction * 2.8;
    this.event('grabBreak', target, { target: attacker.id, x: (attacker.x + target.x) / 2,
      y: target.y + 1.1, reason: 'tech', duration: 0.25 });
    return true;
  }

  grabInput(attacker, action, move = 0) {
    const target = this.player(attacker.grabTarget);
    if (!target || attacker.grabThrowTime !== null) return false;
    if (action === 'heavy') {
      attacker.grabThrowRequested = true;
      attacker.throwStyle = target.throwStyle = move * attacker.facing < -0.2 ? 'back' : 'forward';
      attacker.grabThrowDirection = target.grabThrowDirection = attacker.facing * (attacker.throwStyle === 'back' ? -1 : 1);
      return true;
    }
    if (action !== 'light' || target.grabTechWindow > 0 || attacker.grabStrikeTime !== null
      || attacker.grabStrikes >= V5_RULES.grabStrikeLimit || attacker.grabHoldTime > V5_RULES.grabHold - V5_RULES.grabStrikeDuration) return false;
    attacker.grabStrikes++;
    target.grabStrikes = attacker.grabStrikes;
    attacker.grabStrikeTime = target.grabStrikeTime = 0;
    attacker.grabStrikeHit = false;
    return true;
  }

  updateGrabs(dt) {
    for (const attacker of this.players) {
      if (!attacker.grabTarget) continue;
      const target = this.player(attacker.grabTarget);
      if (!target || target.grabbedBy !== attacker.id || attacker.hp <= 0 || target.hp <= 0
        || attacker.action !== 'heavy' || attacker.variant !== 'grab' || target.variant !== 'grabbed') {
        this.abortGrab(attacker);
        continue;
      }
      attacker.grabHoldTime += dt;
      target.grabHoldTime = attacker.grabHoldTime;
      target.grabTechWindow = Math.max(0, V3_RULES.grabTech - target.grabHoldTime);
      if (target.botTechAt !== null && target.grabHoldTime >= target.botTechAt && target.grabTechWindow > 0) {
        this.breakGrab(target);
        continue;
      }
      if (attacker.bot && target.grabTechWindow <= 0 && attacker.grabStrikeTime === null && attacker.grabThrowTime === null) {
        if (attacker.grabStrikes < 2 && attacker.grabHoldTime < 0.92) this.grabInput(attacker, 'light');
        else this.grabInput(attacker, 'heavy', this.random() < 0.3 ? -attacker.facing : attacker.facing);
      }
      if (attacker.grabStrikeTime !== null) {
        attacker.grabStrikeTime += dt;
        target.grabStrikeTime = attacker.grabStrikeTime;
        if (!attacker.grabStrikeHit && attacker.grabStrikeTime + 1e-8 >= V5_RULES.grabStrikeImpact) {
          attacker.grabStrikeHit = true;
          target.hp = Math.max(0, target.hp - V5_RULES.grabStrikeDamage);
          attacker.energy = clamp(attacker.energy + 3, 0, 100);
          target.energy = clamp(target.energy + 3, 0, 100);
          this.event('grabStrike', attacker, { target: target.id, x: target.x, y: target.y + 1.1, damage: V5_RULES.grabStrikeDamage,
            chain: attacker.grabStrikes, facing: attacker.facing, variant: 'grab', duration: V5_RULES.grabStrikeDuration });
        }
        if (attacker.grabStrikeTime + 1e-8 >= V5_RULES.grabStrikeDuration) attacker.grabStrikeTime = target.grabStrikeTime = null;
      }
      if (attacker.grabHoldTime >= V5_RULES.grabHold) attacker.grabThrowRequested = true;
      if (attacker.grabThrowRequested && target.grabTechWindow <= 0 && attacker.grabStrikeTime === null) {
        attacker.grabThrowTime = attacker.grabThrowTime === null ? 0 : attacker.grabThrowTime + dt;
        target.grabThrowTime = attacker.grabThrowTime;
      }
      if (attacker.grabThrowTime === null || attacker.grabThrowTime + 1e-8 < V5_RULES.grabThrowWindup
        || attacker.grabHoldTime < V5_RULES.grabEarliestThrow || target.hp <= 0) continue;
      const throwStyle = attacker.throwStyle;
      const throwDirection = attacker.grabThrowDirection;
      const strikes = attacker.grabStrikes;
      this.detachGrab(attacker, target);
      attacker.grabReleaseTime = attacker.actionTime;
      attacker.actionDuration = attacker.actionTime + V3_RULES.grabRecovery;
      target.grabImmunity = V3_RULES.grabImmunity;
      this.damage(attacker, target, GRAB_ATTACK, 'heavy', attacker.x, { variant: 'grab', throw: true });
      target.throwStyle = throwStyle;
      target.grabThrowDirection = throwDirection;
      target.grabStrikes = strikes;
      target.vy = throwStyle === 'back' ? 12.0 : 3.4;
      target.vx = throwStyle === 'back' ? 0 : throwDirection * 6.5;
      target.throwDrive = throwStyle === 'back' ? 0.56 : 0;
      target.throwFlight = true;
      target.throwFlightTime = 0;
      this.event('throw', attacker, { target: target.id, x: target.x, y: target.y + 1.1,
        facing: attacker.facing, direction: throwDirection, throwStyle, damage: V3_RULES.grabDamage, duration: V3_RULES.throwStun });
    }
  }

  isWhiffRecovery(player) {
    if (player.action !== 'heavy' || !['', 'grab', 'launcher', 'crusher', 'heavyDrive', 'heavyHook', 'heavyPress'].includes(player.variant) || player.attackConnected || player.punishConsumed) return false;
    const attack = this.attackProperties(player);
    return player.actionTime > attack.startup + attack.active && player.actionTime < player.actionDuration;
  }

  damage(attacker, target, attack, kind = attacker.action, impactX = attacker.x, metadata = {}) {
    if (target.hp <= 0 || this.isInvulnerable(target)) return false;
    const variant = metadata.variant ?? attacker.variant;
    const fromFront = (impactX - target.x) * target.facing > -0.15;
    const canBlock = target.input.block && target.guard > 0 && target.y < 0.1 && !LOCKED_ACTIONS.has(target.action) && fromFront;
    const direction = target.x >= attacker.x ? 1 : -1;
    if (canBlock) {
      if (target.parryWindow > 0 && !offenseLocked(target) && kind !== 'ultimate') {
        target.parryWindow = 0;
        target.counterWindow = COMBAT_WINDOWS.counter;
        target.energy = clamp(target.energy + 14, 0, 100);
        if (!metadata.projectile) {
          this.setAction(attacker, 'hit', 0.42, 'parried');
          attacker.queued = null;
          attacker.vx = -direction * 1.5;
          attacker.dashFollowWindow = 0;
          attacker.launchWindow = 0;
        }
        this.setAction(target, 'block', 0.22, 'parry');
        this.event('parry', target, { x: target.x, y: target.y + 1.15, target: attacker.id, variant, action: kind, projectile: Boolean(metadata.projectile) });
        return true;
      }
      const broken = target.guard <= attack.guardDamage;
      target.guard = Math.max(0, target.guard - attack.guardDamage);
      const chip = kind === 'light' ? 0 : Math.ceil(attack.damage * 0.12);
      target.hp = Math.max(broken ? 0 : 1, target.hp - (broken ? Math.ceil(attack.damage * 0.65) : chip));
      target.vx = direction * attack.knockback * 0.4;
      target.energy = clamp(target.energy + 4, 0, 100);
      attacker.energy = clamp(attacker.energy + 3, 0, 100);
      if (broken) this.setAction(target, 'hit', COMBAT_WINDOWS.guardBreakStun);
      else this.setAction(target, 'block', 0.16);
      this.event('block', attacker, { x: target.x, y: target.y + 1.1, target: target.id, damage: broken ? Math.ceil(attack.damage * 0.65) : chip, guardBreak: broken, action: kind, variant });
      return true;
    }
    const airborneBefore = target.y > 0.2;
    const counter = kind !== 'ultimate' && !metadata.throw && attacker.counterWindow > 0;
    const punish = !metadata.projectile && !metadata.throw && ['light', 'heavy'].includes(kind) && this.isWhiffRecovery(target);
    // A confirmed reactor discharge is its own sequence, not a scaled juggle.
    const damageScale = kind !== 'ultimate' && airborneBefore ? Math.max(0.45, 1 - target.airHits * 0.18) : 1;
    const dealt = Math.max(1, Math.round((attack.damage + (counter ? COMBAT_WINDOWS.counterDamage : 0) + (punish ? V3_RULES.punishDamage : 0)) * damageScale));
    // A recent defensive tap belongs to the player even if another strike
    // connects before recovery. Keep its original short expiry; never extend
    // it through a combo or carry an offensive macro out of hitstun.
    const bufferedDefense = isDefensiveAction(target.queued?.action) && target.queued.expires >= this.combatTime ? target.queued : null;
    if (counter) attacker.counterWindow = 0;
    if (punish) target.punishConsumed = true;
    target.hp = Math.max(0, target.hp - dealt);
    const armored = ultimateArmored(target, kind, variant, metadata);
    if (!armored) target.vx = direction * attack.knockback;
    if (!armored) grantHeavyAdvantage(target, variant);
    const slamBounce = !armored && applySlamBounce(target, variant);
    const empLaunch = variant === 'shockwave' && target.y < VARIANT_ATTACKS.shockwave.hitHeight && !target.airLaunchUsed;
    const launch = (variant === 'launcher' || empLaunch) && !target.airLaunchUsed;
    if (launch) {
      target.vy = empLaunch ? VARIANT_ATTACKS.shockwave.launchSpeed : V5_ATTACKS.launcher.launchSpeed;
      target.y = Math.max(0.03, target.y);
      target.airLaunchUsed = true;
      target.airHits = 1;
      if (!empLaunch) attacker.jumpCancelWindow = 0.60;
    } else if (airborneBefore) target.airHits++;
    if (!armored && variant === 'airFinish') target.vy = Math.min(target.vy, -V5_ATTACKS.airFinish.downwardSpeed);
    // Follow-up hits never add vertical velocity: gravity bounds every air combo.
    target.energy = clamp(target.energy + 6, 0, 100);
    attacker.energy = clamp(attacker.energy + (kind === 'ultimate' ? 0 : 9), 0, 100);
    attacker.combo = attacker.comboExpiry > this.combatTime ? attacker.combo + 1 : 1;
    attacker.comboExpiry = this.combatTime + 1.25;
    if (['jab', 'dashStrike', 'cross', 'airJab', 'airCross'].includes(variant)) {
      attacker.routeStage = ['cross', 'airCross'].includes(variant) ? 2 : 1;
      attacker.cancelWindow = variant.startsWith('air') ? V5_RULES.airCancel : variant === 'cross' ? V5_RULES.crossCancel : V5_RULES.jabCancel;
      attacker.launchWindow = variant.startsWith('air') ? 0 : attacker.cancelWindow;
      // A practiced bot follows its own confirmed contact after a visible reaction beat.
      if (attacker.bot) attacker.brainTimer = Math.min(attacker.brainTimer, 0.12);
    }
    if (['heavyDrive', 'heavyHook'].includes(variant) && (attacker.y <= 0.08 || attacker.groundHeavy)) {
      attacker.routeStage = variant === 'heavyHook' ? 2 : 1;
      attacker.cancelWindow = HEAVY_RULES.cancelWindow;
      attacker.launchWindow = 0;
      if (attacker.bot) attacker.brainTimer = Math.min(attacker.brainTimer, 0.14);
    }
    target.combo = 0;
    if (!armored) {
      target.chain = 0;
      target.launchWindow = 0;
      target.jumpCancelWindow = 0;
      target.dashFollowWindow = 0;
      target.queued = bufferedDefense;
    }
    const stun = kind === 'ultimate' ? attack.stun : airborneBefore && target.airHits > V5_RULES.airHitLimit ? 0.05 : airborneBefore && !launch ? Math.min(attack.stun, 0.24) : attack.stun;
    if (!armored) this.setAction(target, 'hit', stun, kind === 'ultimate' ? 'overloadHit' : metadata.throw ? 'thrown' : empLaunch ? 'empLift' : variant === 'bolt' ? 'electrified' : launch ? 'launched' : slamBounce ? 'slamBounce' : isGroundHeavy(variant) ? 'heavyStagger' : '');
    this.event('hit', attacker, { x: target.x, y: target.y + 1.15, target: target.id, damage: dealt, combo: attacker.combo, action: kind, variant, counter, punish, armored, airborne: airborneBefore || launch });
    if (launch) this.event('launch', attacker, { x: target.x, y: target.y + 1.15, target: target.id, variant, velocity: target.vy });
    this.lastHit = { player: attacker.id, target: target.id, variant, combo: attacker.combo, at: this.combatTime };
    return true;
  }

  updateBot(player, dt) {
    const enemy = this.opponent(player);
    if (!enemy) return;
    player.inputAge = 0;
    if (player.grabTarget || player.grabbedBy) { this.applyControls(player, neutralInput()); return; }
    player.brainTimer -= dt;
    player.botBlockTimer = Math.max(0, player.botBlockTimer - dt);
    player.botCrouchTimer = Math.max(0, player.botCrouchTimer - dt);
    player.botRetreatTimer = Math.max(0, player.botRetreatTimer - dt);
    const distance = Math.abs(enemy.x - player.x);
    const direction = Math.sign(enemy.x - player.x);
    // Bounded reaction delay and deliberate openings keep training useful on touch screens.
    if (player.brainTimer <= 0) {
      player.brainTimer = 0.20 + this.random() * 0.28;
      player.brainSerial++;
      const enemyAttacking = ['light', 'heavy', 'special', 'ultimate'].includes(enemy.action);
      if (enemyAttacking && enemy.action !== 'ultimate' && distance < 3.1 && this.random() < 0.46) player.botBlockTimer = 0.23 + this.random() * 0.3;
      let action = null;
      const incoming = this.projectiles.find(p => p.owner !== player.id && Math.abs(p.x - player.x) < 3);
      if (canAttemptBurst(player) && player.energy >= V3_RULES.burstEnergy && player.cooldowns.burst <= 0
        && (healthFraction(player) < .65 || enemy.combo >= 2) && this.random() < 0.48) action = 'dash';
      else if (canAttemptFeint(player) && player.energy >= V3_RULES.feintEnergy && player.cooldowns.dash <= 0
        && enemy.input.block && this.random() < 0.28) action = 'dash';
      else if (this.isWhiffRecovery(enemy) && distance < 2.4) action = 'light';
      else if (enemy.input.block && enemy.y === 0 && player.y === 0 && distance < 2.45 && this.random() < 0.44) {
        action = 'heavy';
        player.botCrouchTimer = 0.35;
      } else if (enemy.action === 'ultimate' && enemy.actionTime > 0.22 && distance < 5.4 && this.random() < 0.62) {
        player.botRetreatTimer = 0.75;
        player.botBlockTimer = 0;
        if (player.cooldowns.dash <= 0) action = 'dash';
      } else if (incoming && this.random() < 0.62) action = 'jump';
      else if (player.jumpCancelWindow > 0 && this.random() < 0.78) action = 'jump';
      else if (player.y > 0.42 && player.cancelWindow > 0 && distance < 3.2) action = player.airActions < 3 ? 'light' : 'heavy';
      else if (canAttemptAirDash(player) && distance > 2.5 && player.cooldowns.dash <= 0 && this.random() < 0.55) action = 'dash';
      else if (player.y > 0.42 && distance < 3.2) action = enemy.y > 0.25 && player.airActions < 3 ? 'light' : this.random() < 0.3 ? 'heavy' : 'light';
      else if (player.dashFollowWindow > 0 && distance < 3.2) action = 'light';
      else if (player.counterWindow > 0 && distance < 2.55) action = 'light';
      else if (player.cancelWindow > 0 && player.y < 0.1 && distance < 2.9) action = player.comboRoute.startsWith('heavy') || this.random() < (player.routeStage === 2 ? 0.45 : 0.32) ? 'heavy' : 'light';
      else if (player.energy >= ATTACKS.ultimate.energy && player.cooldowns.ultimate <= 0 && distance < 4.5) action = 'ultimate';
      else if (distance > 3.2 && player.energy >= ATTACKS.special.energy && player.cooldowns.special <= 0 && this.random() < 0.52) {
        action = 'special';
        const mine = VARIANT_ATTACKS.shockwave;
        const mineDistance = Math.abs(enemy.x - (player.x + direction * .65));
        const placeMine = player.brainSerial % 2 === 0 && player.energy >= mine.energy && mineDistance <= mine.radius + .25;
        // A previous grab/crouch timer must not turn an affordable ranged bolt
        // into an unaffordable or out-of-range mine.
        player.botCrouchTimer = placeMine ? .6 : 0;
      } else if (distance < 2.8 && player.y === 0 && this.random() < 0.13) action = 'jump';
      else if (distance < 2.45 && this.random() < 0.65) action = this.random() < 0.3 ? 'heavy' : 'light';
      else if (distance > 3.7 && player.cooldowns.dash <= 0 && this.random() < 0.32) action = 'dash';
      if (action) player.queued = { action, crouch: player.botCrouchTimer > 0, expires: this.combatTime + COMBAT_WINDOWS.inputBuffer };
    }
    this.applyControls(player, { move: player.botRetreatTimer ? -direction : player.botBlockTimer ? 0 : distance > 2.13 ? direction * 0.8 : distance < 1.95 ? -direction * 0.55 : 0,
      block: player.botBlockTimer > 0, crouch: player.botCrouchTimer > 0 });
  }

  updatePlayer(player, dt) {
    player.inputAge += dt;
    if (player.inputAge > INPUT_TIMEOUT_SECONDS) player.input = neutralInput();
    if (player.bot) this.updateBot(player, dt);
    for (const key of ['counterWindow', 'launchWindow', 'parryWindow', 'parryCooldown', 'dashFollowWindow', 'jumpCancelWindow', 'grabImmunity', 'burstInvulnerable', 'cancelWindow', 'pursuitWindow', 'landingRecovery', 'throwDrive', 'defenseOnly']) player[key] = Math.max(0, player[key] - dt);
    for (const key of Object.keys(player.cooldowns)) player.cooldowns[key] = Math.max(0, player.cooldowns[key] - dt);
    player.energy = clamp(player.energy + 1.35 * dt, 0, 100);
    if (!player.input.block && player.action !== 'hit') player.guard = clamp(player.guard + 15 * dt, 0, 100);
    if (player.comboExpiry < this.combatTime) player.combo = 0;
    player.actionTime += dt;
    const route = continuation(player);
    if (route && player.cancelWindow <= 0 && player.actionTime + 1e-8 >= route.open && player.actionTime < route.close) {
      player.routeStage = route.stage;
      player.cancelWindow = route.close - player.actionTime;
      player.launchWindow = route.heavy || player.variant.startsWith('air') ? 0 : player.cancelWindow;
    }
    if (player.throwFlight) player.throwFlightTime += dt;
    if (player.grabTarget || player.grabbedBy) { player.vx = 0; player.vy = 0; player.queued = null; return; }
    if (LOCKED_ACTIONS.has(player.action) && player.actionTime >= player.actionDuration && !(player.variant === 'slam' && !player.slamLanded)) {
      if (player.cancelWindow <= 0 && ['light', 'heavy'].includes(player.action)) { player.cancelWindow = player.launchWindow = 0; player.routeStage = 0; player.chain = 0; player.comboRoute = ''; }
      this.setAction(player, 'idle');
    }
    if (player.variant === 'parry' && player.actionTime > player.actionDuration) player.variant = '';
    if (player.queued && player.queued.expires < this.combatTime) player.queued = null;
    if (player.queued && offenseLocked(player) && !isDefensiveAction(player.queued.action)) player.queued = null;
    if (player.queued && this.beginAction(player, player.queued.action, player.queued.crouch)) {
      player.queued = player.followup; player.followup = null; this.extendContinuationBuffer(player);
    }
    if (!LOCKED_ACTIONS.has(player.action)) {
      player.facing = this.opponent(player).x >= player.x ? 1 : -1;
      const next = player.y > 0.02 || player.vy > 0 ? 'jump' : player.input.block ? 'block' : player.input.crouch ? 'crouch' : Math.abs(player.input.move) > 0.05 ? 'walk' : 'idle';
      if (player.action !== next) this.setAction(player, next);
      const speed = player.input.block ? 0.26 : player.input.crouch ? 0.3 : 1;
      const travelSpeed = player.traversalJump && (player.y > .02 || player.vy > 0) ? AIR_MOVE_SPEED : WALK_SPEED;
      player.vx = player.pursuitWindow > 0 ? player.facing * V5_RULES.pursuitSpeed : player.input.move * travelSpeed * speed;
    } else if (player.action === 'dash' && player.variant === 'feint') {
      if (player.actionTime < 0.20) player.vx = player.dashDirection * V3_RULES.feintSpeed;
      else player.vx *= Math.exp(-14 * dt);
    } else if (player.action === 'dash') player.vx = player.dashDirection * (player.variant === 'airDash' ? V5_RULES.airDashSpeed : ATTACKS.dash.speed);
    else if (player.variant === 'dashStrike' && player.actionTime < 0.19) player.vx = player.facing * 5;
    else if (V5_ATTACKS[player.variant]?.stepSpeed && (player.y < 0.1 || player.groundHeavy) && player.actionTime >= V5_ATTACKS[player.variant].stepStart && player.actionTime < V5_ATTACKS[player.variant].stepEnd) player.vx = player.facing * V5_ATTACKS[player.variant].stepSpeed;
    else if (player.pursuitWindow > 0 && player.y > 0) player.vx = player.facing * V5_RULES.pursuitSpeed;
    else if (player.variant.startsWith('air')) player.vx *= Math.exp(-3 * dt);
    else if (player.variant === 'slam' && !player.slamLanded) player.vx *= Math.exp(-4 * dt);
    else if (player.action !== 'hit') player.vx *= Math.exp(-18 * dt);
    else if (player.throwDrive <= 0) player.vx *= Math.exp(-5 * dt);
    if (player.throwFlight && player.throwStyle === 'back' && player.throwDrive > 0 && player.action !== 'dash' && player.variant !== 'burst') {
      // Lift the actual 2.4m beetle above the holder before the horizontal toss begins.
      player.vx = player.throwFlightTime < 0.16 ? 0 : player.grabThrowDirection * 10.5;
    }
    player.traversalPreviousX = player.x;
    player.x = clamp(player.x + player.vx * dt, -ARENA_EDGE, ARENA_EDGE);
    const hop = player.groundHeavy && V5_ATTACKS[player.variant];
    if (hop && !player.heavyHopStarted && player.actionTime >= hop.hopStart && player.y <= .02) {
      player.heavyHopStarted = true;
      player.vy = hop.hopSpeed;
    }
    if (player.y > 0 || player.vy > 0) {
      const diving = player.variant === 'slam' && !player.slamLanded && player.actionTime >= VARIANT_ATTACKS.slam.startup;
      if (diving) player.vy = Math.min(player.vy, -VARIANT_ATTACKS.slam.diveSpeed);
      player.vy -= GRAVITY * dt * (diving ? 1.6 : 1);
      player.y += player.vy * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.traversalJump = false;
        player.traversalSide = player.traversalLandingSide = 0;
        player.airLaunchUsed = false;
        player.airHits = 0;
        player.airActions = 0;
        player.airDashUsed = false;
        const slamBounceLanding = player.slamBounceUsed;
        player.slamBounceUsed = false;
        player.throwFlight = false;
        player.pursuitWindow = 0;
        player.landingRecovery = player.groundHeavy || slamBounceLanding ? 0 : V5_RULES.landingRecovery;
        if (player.variant.startsWith('air')) { player.cancelWindow = 0; player.routeStage = 0; }
        if (player.variant === 'slam' && !player.slamLanded) {
          player.slamLanded = true;
          player.slamPending = true;
          player.landedTime = player.actionTime;
          player.actionDuration = player.actionTime + VARIANT_ATTACKS.slam.recovery;
        }
        this.event('land', player, { y: 0 });
      }
    }
  }

  updateAttack(player) {
    if (player.variant === 'burst' || player.grabTarget || player.grabbedBy) return;
    const attack = this.attackProperties(player);
    if (!attack || player.action === 'dash') return;
    const target = this.opponent(player);
    if (player.variant === 'grab') {
      if (player.actionTime >= attack.startup && player.actionTime <= attack.startup + attack.active) this.tryGrab(player, target);
      return;
    }
    if (player.variant === 'slam') {
      if (!player.slamPending) return;
      player.slamPending = false;
      this.event('slam', player, { y: 0.06, variant: 'slam', range: attack.range, facing: player.facing, duration: attack.recovery, landedTime: player.landedTime });
      if (Math.abs(target.x - player.x) < attack.range && target.y < 0.65) {
        if (this.damage(player, target, attack)) player.hitTargets.add(target.id);
      }
      return;
    }
    if (player.action === 'ultimate') {
      for (const [pulse, properties] of ULTIMATE_PULSES.entries()) {
        if (player.actionTime + 1e-8 < properties.time || player.ultimatePulses.has(pulse)) continue;
        player.ultimatePulses.add(pulse);
        this.event('ultimatePulse', player, { y: player.y + 1.35, pulse, facing: player.facing, range: attack.range, variant: 'overload', damage: properties.damage });
        const horizontal = (target.x - player.x) * player.facing;
        if (horizontal > -0.3 && horizontal < attack.range && Math.abs(target.y - player.y) < attack.hitHeight) {
          this.damage(player, target, { ...attack, ...properties }, 'ultimate', player.x, { variant: 'overload' });
        }
      }
      return;
    }
    if (player.action === 'special') {
      if (player.actionTime + 1e-8 >= attack.startup && !player.projectileLaunched) {
        this.projectiles.push({ id: this.nextProjectileId++, x: player.x + player.facing * 0.65, y: player.y + attack.height,
          owner: player.id, direction: player.facing, life: attack.life, age: 0, variant: player.variant, speed: attack.speed,
          ...(player.variant === 'shockwave' ? { radius: attack.radius, hitTargets: new Set() } : {}) });
        player.projectileLaunched = true;
      }
      return;
    }
    if (player.actionTime + 1e-8 < attack.startup || player.actionTime > attack.startup + attack.active) return;
    if (player.hitTargets.has(target.id)) return;
    const horizontal = (target.x - player.x) * player.facing;
    const heightReach = player.action === 'ultimate' ? 3.5 : player.variant.startsWith('air') ? 1.45 : player.action === 'light' ? 1.05 : 1.25;
    const inHeight = player.groundHeavy ? target.y < attack.heightReach : Math.abs(target.y - player.y) < heightReach;
    if (horizontal > -0.3 && horizontal < attack.range && inHeight) {
      if (this.damage(player, target, attack)) { player.hitTargets.add(target.id); player.attackConnected = true; }
    }
  }

  resolveBodies(dt = 1 / 60) {
    const [one, two] = this.players;
    const tossed = this.players.find(player => player.throwFlight && player.throwStyle === 'back' && player.y > 0.3);
    if (tossed) {
      // A back toss against a wall recoils the holder inward as the victim crosses overhead.
      // Resolve this continuously while airborne, not as a two-unit separation snap on landing.
      const holder = this.opponent(tossed);
      const direction = tossed.grabThrowDirection;
      if (Math.abs(tossed.x) > ARENA_EDGE - 0.2 && (tossed.x - holder.x) * direction > -0.1) {
        const desired = clamp(tossed.x - direction * PLAYER_RADIUS * 2, -ARENA_EDGE, ARENA_EDGE);
        holder.x += clamp(desired - holder.x, -6 * dt, 6 * dt);
      }
      return;
    }
    if (resolveTraversalContact(one, two, dt)) return;
    if (Math.abs(one.y - two.y) > 1.15) return;
    const delta = two.x - one.x;
    const overlap = PLAYER_RADIUS * 2 - Math.abs(delta);
    if (overlap > 0) {
      const sign = Math.sign(delta) || 1;
      one.x = clamp(one.x - sign * overlap / 2, -ARENA_EDGE, ARENA_EDGE);
      two.x = clamp(two.x + sign * overlap / 2, -ARENA_EDGE, ARENA_EDGE);
      // At a wall, transfer the remaining separation to the fighter with room to move.
      const remainder = PLAYER_RADIUS * 2 - Math.abs(two.x - one.x);
      if (remainder > 0.001) {
        if (Math.abs(one.x) >= ARENA_EDGE - 0.001) two.x = clamp(two.x + sign * remainder, -ARENA_EDGE, ARENA_EDGE);
        else one.x = clamp(one.x - sign * remainder, -ARENA_EDGE, ARENA_EDGE);
      }
    }
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      const oldX = projectile.x;
      projectile.x += projectile.direction * projectile.speed * dt;
      projectile.life -= dt;
      projectile.age = (projectile.age ?? 0) + dt;
      const attacker = this.player(projectile.owner);
      const target = this.opponent(attacker);
      if (projectile.variant === 'shockwave') {
        const wave = VARIANT_ATTACKS.shockwave;
        const elapsed = projectile.age - wave.detonationDelay;
        // A mine detonates once at its placement point. The short, low moving
        // front can be jumped, blocked or left behind; it never chases a target.
        if (elapsed >= 0 && elapsed - dt < wave.expansionTime && !projectile.hitTargets.has(target.id)) {
          const radius = wave.radius * Math.min(1, elapsed / wave.expansionTime);
          if (Math.abs(target.x - projectile.x) < radius + .25 && target.y < wave.hitHeight) {
            if (this.damage(attacker, target, wave, 'special', projectile.x, { projectile: true, variant: 'shockwave' })) projectile.hitTargets.add(target.id);
          }
        }
        continue;
      }
      const hitHeight = target.input.crouch && target.y === 0 && !LOCKED_ACTIONS.has(target.action) ? 0.91 : 2.05;
      const nearX = target.x >= Math.min(oldX, projectile.x) - 0.6 && target.x <= Math.max(oldX, projectile.x) + 0.6;
      const nearY = projectile.y >= target.y + 0.2 && projectile.y <= target.y + hitHeight;
      if (nearX && nearY) {
        if (this.damage(attacker, target, ATTACKS.special, 'special', oldX, { projectile: true, variant: projectile.variant })) projectile.life = 0;
      }
      if (Math.abs(projectile.x) > ARENA_EDGE + 1.5) projectile.life = 0;
    }
    this.projectiles = this.projectiles.filter(projectile => projectile.life > 0);
  }

  endRound() {
    for (const player of this.players) if (player.grabTarget) this.abortGrab(player, false);
    const [one, two] = this.players;
    const winner = one.hp === two.hp ? null : one.hp > two.hp ? one : two;
    this.roundWinner = winner?.id ?? null;
    if (winner) winner.wins++;
    this.projectiles = [];
    this.roundBreak = ROUND_BREAK_SECONDS;
    for (const player of this.players) {
      player.input = neutralInput();
      player.queued = null;
      player.counterWindow = 0;
      player.launchWindow = 0;
      player.parryWindow = 0;
      player.jumpCancelWindow = 0;
      player.dashFollowWindow = 0;
      player.burstInvulnerable = 0;
      player.vx = 0;
      player.vy = 0;
      const overloadRecovery = player === winner && player.action === 'ultimate' && this.lastHit?.variant === 'overload';
      const recoveryDuration = overloadRecovery ? Math.max(.05, ATTACKS.ultimate.duration - player.actionTime) : 99;
      this.setAction(player, player === winner ? 'victory' : winner ? 'ko' : 'idle', recoveryDuration, overloadRecovery ? 'overloadRecovery' : '');
      if (player !== winner && winner) this.event('ko', player, { target: player.id, winner: winner.id });
    }
    if (winner && winner.wins >= WINS_TO_MATCH) {
      this.winner = winner.id;
      this.phase = 'finishing';
      const target = this.opponent(winner);
      this.setAction(winner, 'victory', FINISH_RULES.offerDuration, 'finishOffer');
      this.setAction(target, 'defeated', FINISH_RULES.offerDuration, 'offer');
      this.finish = { stage: 'offer', type: 'coreRip', winner: winner.id, target: target.id, time: FINISH_RULES.offerDuration,
        duration: FINISH_RULES.offerDuration, elapsed: 0, canTrigger: true };
      const earned = this.lastHit && this.lastHit.player === winner.id && this.lastHit.target === target.id && target.hp <= 0
        && this.combatTime - this.lastHit.at < 0.1 && this.lastHit.combo >= 3 && ['rake', 'crusher', 'airFinish', 'slam', 'heavyPress'].includes(this.lastHit.variant);
      if (earned) this.startFinisher('brutality');
    } else this.phase = 'roundOver';
  }

  startFinisher(type = 'overload') {
    if (this.phase !== 'finishing' || this.finish?.stage !== 'offer') return false;
    const winner = this.player(this.finish.winner);
    const target = this.player(this.finish.target);
    const direction = Math.sign(target.x - winner.x) || winner.facing;
    const center = clamp((winner.x + target.x) / 2, -ARENA_EDGE + FINISH_RULES.distance / 2, ARENA_EDGE - FINISH_RULES.distance / 2);
    this.finish = { stage: 'execute', type, winner: winner.id, target: target.id, time: FINISH_RULES.duration,
      duration: FINISH_RULES.duration, elapsed: 0, canTrigger: false };
    this.finishMotion = { winnerStart: winner.x, targetStart: target.x,
      winnerEnd: center - direction * FINISH_RULES.distance / 2, targetEnd: center + direction * FINISH_RULES.distance / 2,
      impact: false, destroyed: false };
    winner.facing = direction; target.facing = -direction;
    for (const player of [winner, target]) { player.input = neutralInput(); player.queued = null; player.vx = 0; player.vy = Math.min(0, player.vy); }
    this.setAction(winner, 'finisher', FINISH_RULES.duration, type);
    this.setAction(target, 'defeated', FINISH_RULES.duration, type);
    this.event('finisherStart', winner, { target: target.id, finisherType: type, variant: type, facing: direction, duration: FINISH_RULES.duration,
      impactTime: FINISH_RULES.impactTime, destructionTime: FINISH_RULES.destructionTime, targetX: target.x, targetY: target.y });
    return true;
  }

  updateFinishing(dt) {
    const finish = this.finish;
    if (!finish) return;
    finish.elapsed += dt;
    finish.time = Math.max(0, finish.duration - finish.elapsed);
    const winner = this.player(finish.winner);
    const target = this.player(finish.target);
    if (finish.stage === 'offer') {
      this.updateEndPoses(dt);
      if (winner.bot && finish.elapsed >= FINISH_RULES.botTriggerTime) this.startFinisher('coreRip');
      else if (finish.time <= 1e-8) this.startFinisher('overload');
      return;
    }
    const motion = this.finishMotion;
    const progress = clamp(finish.elapsed / FINISH_RULES.stagingTime, 0, 1);
    const ease = progress * progress * (3 - 2 * progress);
    winner.x = motion.winnerStart + (motion.winnerEnd - motion.winnerStart) * ease;
    target.x = motion.targetStart + (motion.targetEnd - motion.targetStart) * ease;
    for (const player of [winner, target]) {
      if (player.y > 0) { player.vy -= GRAVITY * dt; player.y = Math.max(0, player.y + player.vy * dt); }
      if (player.y === 0) player.vy = 0;
      player.actionTime = motion.destroyed ? Math.max(0, finish.elapsed - FINISH_RULES.destructionTime) : finish.elapsed;
      if (player.action === 'destroyed') player.destructionTime = player.actionTime;
    }
    if (!motion.impact && finish.elapsed + 1e-8 >= FINISH_RULES.impactTime) {
      motion.impact = true;
      this.event('finisherImpact', winner, { target: target.id, x: target.x, y: target.y + 1.15, finisherType: finish.type, variant: finish.type,
        facing: winner.facing, duration: FINISH_RULES.destructionTime - FINISH_RULES.impactTime });
    }
    if (!motion.destroyed && finish.elapsed + 1e-8 >= FINISH_RULES.destructionTime) {
      motion.destroyed = true;
      target.hp = 0;
      this.setAction(target, 'destroyed', 99, finish.type);
      target.destructionTime = 0;
      this.setAction(winner, 'victory', 99, finish.type);
      this.event('destruction', winner, { target: target.id, x: target.x, y: target.y + 0.75, finisherType: finish.type, variant: finish.type, facing: winner.facing, duration: 1.55 });
    }
    if (finish.time <= 1e-8) { finish.time = 0; this.phase = 'matchOver'; }
  }

  updateEndPoses(dt) {
    for (const player of this.players) {
      player.actionTime += dt;
      if (player.action === 'destroyed') player.destructionTime = (player.destructionTime ?? 0) + dt;
      if (player.y > 0) {
        player.vy -= GRAVITY * dt;
        player.y = Math.max(0, player.y + player.vy * dt);
        if (player.y === 0) { player.vy = 0; this.event('land', player, { y: 0 }); }
      }
    }
  }

  step(dt = 1 / 60) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error('CombatRoom.step requires a fixed delta of 0–0.1 seconds.');
    this.elapsed += dt;
    this.events = this.events.filter(event => this.elapsed - event.at <= 1.2);
    if (this.phase === 'countdown') {
      if (this.resumePhase !== 'fight') {
        for (const player of this.players) {
          player.actionTime += dt;
          if (player.action === 'recover' && player.actionTime >= player.actionDuration) this.setAction(player, 'idle');
        }
      }
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 1e-8) {
        this.phase = 'fight';
        this.resumePhase = null;
        this.event('round', null, { round: this.round, fight: true });
      }
      return;
    }
    if (this.phase === 'roundOver') {
      this.updateEndPoses(dt);
      this.roundBreak -= dt;
      if (this.roundBreak <= 0) { this.round++; this.startRound(); }
      return;
    }
    if (this.phase === 'matchOver') { this.updateEndPoses(dt); return; }
    if (this.phase === 'finishing') { this.updateFinishing(dt); return; }
    if (this.phase !== 'fight' || this.players.length !== 2) return;
    this.combatTime += dt;
    this.time = Math.max(0, this.time - dt);
    if (this.time <= 0) { this.endRound(); return; }
    for (const player of this.players) this.updatePlayer(player, dt);
    this.updateGrabs(dt);
    this.resolveBodies(dt);
    // Alternating priority prevents an enduring player-one advantage on simultaneous attacks.
    const order = Math.floor(this.elapsed * 60) % 2 ? this.players : [...this.players].reverse();
    for (const player of order) this.updateAttack(player);
    this.updateProjectiles(dt);
    if (this.players.some(player => player.hp <= 0) || this.time <= 0) this.endRound();
  }

  snapshot() {
    return {
      room: this.id, mode: this.mode, phase: this.phase, pausedFrom: this.pausedFrom, time: roundNumber(this.time), elapsed: roundNumber(this.elapsed),
      round: this.round, countdown: roundNumber(this.countdown), roundWinner: this.roundWinner,
      finish: this.finish ? { ...this.finish, time: roundNumber(this.finish.time), elapsed: roundNumber(this.finish.elapsed), canTrigger: this.phase === 'finishing' && this.finish.stage === 'offer' } : null,
      players: this.players.map(player => ({
        id: player.id, name: player.name, character: player.character, connected: player.connected, ready: player.ready,
        customization: { ...player.customization },
        x: roundNumber(player.x), y: roundNumber(player.y), vx: roundNumber(player.vx), vy: roundNumber(player.vy), facing: player.facing,
        hp: roundNumber(player.hp), maxHp: player.maxHp, energy: roundNumber(player.energy), guard: roundNumber(player.guard), wins: player.wins,
        action: player.action, variant: player.variant, actionTime: roundNumber(player.actionTime), actionDuration: player.actionDuration,
        ultimateArmor: ultimateArmored(player, 'light', 'jab'),
        counterWindow: roundNumber(player.counterWindow), launchWindow: roundNumber(player.launchWindow), jumpCancelWindow: roundNumber(player.jumpCancelWindow), parryCooldown: roundNumber(player.parryCooldown),
        defenseOnly: roundNumber(player.defenseOnly), groundHeavy: player.groundHeavy, slamBounceUsed: player.slamBounceUsed,
        landedTime: player.landedTime,
        grabTarget: player.grabTarget, grabbedBy: player.grabbedBy, grabTechWindow: roundNumber(player.grabTechWindow),
        grabHoldTime: roundNumber(player.grabHoldTime), grabCatchTime: player.grabCatchTime, grabReleaseTime: player.grabReleaseTime,
        burstInvulnerable: roundNumber(player.burstInvulnerable),
        cancelWindow: roundNumber(player.cancelWindow), comboRoute: player.comboRoute, airActions: player.airActions, airDashUsed: player.airDashUsed,
        landingRecovery: roundNumber(player.landingRecovery), grabStrikes: player.grabStrikes, grabStrikeTime: player.grabStrikeTime,
        grabStrikeDuration: player.grabStrikeDuration, grabThrowTime: player.grabThrowTime,
        throwStyle: player.throwStyle, grabThrowDirection: player.grabThrowDirection, destructionTime: player.destructionTime,
        combo: player.combo, chain: player.chain, cooldowns: Object.fromEntries(Object.entries(player.cooldowns).map(([key, value]) => [key, roundNumber(value)])),
        skin: player.skin, rematch: player.rematch, bot: player.bot,
      })),
      projectiles: this.projectiles.map(({ id, x, y, owner, direction, variant, speed, age, radius }) => ({ id, x: roundNumber(x), y: roundNumber(y), owner, direction, variant, speed, age: roundNumber(age ?? 0), ...(radius ? { radius } : {}) })),
      events: this.events.map(({ at, ...event }) => event), winner: this.winner,
    };
  }
}
