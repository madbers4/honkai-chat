import { faceoffActorPose, faceoffActorX, faceoffDuration } from '../shared/faceoff-script.js';
import { COUNTDOWN_SECONDS } from '../shared/constants.js';
import { buildRoundIntro as defaultRoundIntro, ROUND_INTRO_DURATION } from '../shared/round-intro.js';
import { REFEREE_RECONNECT_GRACE, refereeRuleDuration } from '../shared/referee-round.js';

// Presentation runs beside CombatRoom: it cannot award damage, change inputs or
// let an optional referee occupy a fighter slot. Existing protocol clients can
// still create a room without the presentation layer.
export class StorySession {
  constructor(game, { ruleCount = 5, faceoffDuration = 24, buildFaceoff = () => [], buildRoundIntro = defaultRoundIntro, openingComplete = false } = {}) {
    this.game = game;
    this.ruleCount = Math.max(1, ruleCount);
    this.faceoffDuration = faceoffDuration;
    this.buildFaceoff = buildFaceoff;
    this.buildRoundIntro = buildRoundIntro;
    this.stage = openingComplete ? 'complete' : 'workshop';
    this.sequenceId = `${game.id}:opening:1`;
    this.elapsed = 0;
    this.ruleIndex = 0;
    this.readyPlayers = new Set();
    this.ruleAcks = new Set();
    this.skipVotes = new Set();
    this.beats = [];
    this.roundIntro = null;
    this.lastRoundEventId = 0;
    this.lastRound = 0;
    this.matchSerial = 0;
    this.refereeConnected = false;
    this.refereePrepared = false;
    this.refereeGate = null;
  }

  setRefereeConnected(connected, prepared = true) {
    connected = Boolean(connected);
    prepared = connected && Boolean(prepared);
    if (connected === this.refereeConnected && prepared === this.refereePrepared) return;
    const joining = connected && !this.refereeConnected;
    this.refereeConnected = connected;
    this.refereePrepared = prepared;
    if (joining && this.stage === 'rules') {
      this.elapsed = 0; this.ruleAcks.clear();
    }
    this.prepareRound();
    const gate = this.refereeGate;
    if (!gate) return;
    if (connected) {
      gate.disconnectedElapsed = 0;
      // A referee arriving during a new-round countdown gets the microphone.
      // Never pause an ongoing fight or its reconnect safety countdown.
      if (gate.status === 'automatic' && this.isRoundCountdown()) {
        gate.status = 'pending';
        if (this.game.countdown <= COUNTDOWN_SECONDS + 1e-8) this.activateReferee();
      }
    } else if (gate.status === 'pending') gate.status = 'automatic';
  }

  get refereePreparing() { return this.refereeConnected && !this.refereePrepared; }

  preparationPausesStory() {
    return this.refereePreparing && (['rules', 'faceoff'].includes(this.stage)
      || this.stage === 'complete' && this.isRoundCountdown());
  }

  isRoundCountdown() {
    return this.game.resumePhase !== 'fight' && (this.game.phase === 'countdown'
      || this.game.phase === 'paused' && this.game.pausedFrom === 'countdown');
  }

  activateReferee() {
    if (this.refereeGate?.status !== 'pending' || !this.isRoundCountdown()) return;
    this.refereeGate.status = 'waiting';
    this.refereeGate.elapsed = 0;
    this.game.countdown = COUNTDOWN_SECONDS;
  }

  startRefereeRound(sequenceId) {
    if (!this.refereeConnected || !this.refereePrepared || !this.connected() || !this.isRoundCountdown()
      || this.refereeGate?.status !== 'waiting' || sequenceId !== this.refereeGate.sequenceId) return false;
    this.releaseReferee();
    return true;
  }

  releaseReferee() {
    this.refereeGate.status = 'released';
    this.game.countdown = COUNTDOWN_SECONDS;
  }

  // Called immediately before the fixed combat tick. Consume only the tail of
  // the voiced exchange, so countdown numerals never flash before the gate.
  holdCombat(dt) {
    if (this.refereePreparing && this.isRoundCountdown()) return true;
    if (this.refereeGate?.status === 'pending' && this.game.phase === 'countdown'
      && this.game.countdown - dt <= COUNTDOWN_SECONDS + 1e-8) {
      const remainder = Math.max(0, this.game.countdown - COUNTDOWN_SECONDS);
      if (remainder > 1e-8) this.game.step(Math.min(remainder, dt, .1));
      this.activateReferee();
    }
    return this.refereeGate?.status === 'waiting' && this.isRoundCountdown();
  }

  connected() { return this.game.players.length === 2 && this.game.players.every(p => p.connected); }
  humans() { return this.game.players.filter(p => !p.bot); }
  allMarked(set) { return this.connected() && this.humans().every(p => set.has(p.id)); }
  canEdit(id) { return this.stage === 'workshop' && !this.readyPlayers.has(id) && Boolean(this.game.player(id)); }

  ready(id, value = true) {
    if (this.stage !== 'workshop' || !this.game.player(id)?.connected) return false;
    if (value) this.readyPlayers.add(id); else this.readyPlayers.delete(id);
    // CombatRoom readiness must stay false: its reconnect path can start a round.
    // Workshop readiness belongs only to this presentation until startFight().
    this.prepareWorkshop();
    return true;
  }

  prepareWorkshop() {
    // A player may finish their passport while the already-ready peer is
    // disconnected. Their return satisfies readiness without another click.
    if (this.stage === 'workshop' && this.allMarked(this.readyPlayers)) {
      this.stage = 'rules'; this.elapsed = 0; this.ruleIndex = 0; this.ruleAcks.clear();
      this.beats = this.buildFaceoff(this.game.players, this.game.id);
      this.faceoffDuration = faceoffDuration(this.beats) || this.faceoffDuration;
    }
  }

  advance({ actor, sequenceId, ruleIndex }, refereeConnected = this.refereeConnected) {
    if (sequenceId !== this.sequenceId || !this.connected()) return false;
    if (this.stage === 'rules') {
      if (ruleIndex !== this.ruleIndex) return false;
      if (actor === 'referee' || refereeConnected || !this.game.player(actor)?.connected) return false;
      this.ruleAcks.add(actor);
      if (!this.allMarked(this.ruleAcks)) return true;
      this.nextRule();
      return true;
    }
    // The opening sequence persists across stages. A delayed rules packet must
    // not be reinterpreted as an explicit vote to skip the faceoff.
    if (this.stage === 'faceoff' && ruleIndex === this.ruleCount && this.elapsed + 1e-8 >= 3 && actor !== 'referee' && this.game.player(actor)?.connected) {
      this.skipVotes.add(actor);
      if (this.allMarked(this.skipVotes)) this.startFight();
      return true;
    }
    return false;
  }

  nextRule() {
    this.ruleIndex++; this.elapsed = 0; this.ruleAcks.clear();
    if (this.ruleIndex >= this.ruleCount) this.stage = 'faceoff';
  }

  startFight() {
    if (this.stage !== 'faceoff' || !this.connected()) return;
    this.stage = 'complete'; this.elapsed = this.faceoffDuration;
    // Exactly one transition: no fighter becomes ready on the combat engine
    // before the shared introduction has actually finished.
    this.game.startRound();
    this.prepareRound();
  }

  prepareRound() {
    if (this.stage !== 'complete' || this.game.phase !== 'countdown' || this.game.resumePhase === 'fight') return;
    const event = this.game.events.findLast(e => e.type === 'round' && !e.fight)
      ?? (!this.roundIntro ? { id: `joined:${this.game.nextEventId}` } : null);
    if (!event || event.id === this.lastRoundEventId) return;
    this.lastRoundEventId = event.id;
    if (this.game.round === 1 && this.lastRound) this.matchSerial++;
    this.lastRound = this.game.round;
    const intro = this.buildRoundIntro(this.game.players, this.game.id, this.game.round, this.matchSerial);
    this.roundIntro = { ...intro, sequenceId: `${this.game.id}:round:${event.id}`, matchSerial: this.matchSerial };
    this.game.countdown = COUNTDOWN_SECONDS + intro.duration;
    this.refereeGate = { sequenceId: `${this.game.id}:referee:${event.id}`, round: this.game.round,
      matchSerial: this.matchSerial, status: this.refereeConnected ? 'pending' : 'automatic', elapsed: 0, disconnectedElapsed: 0 };
  }

  step(dt) {
    this.prepareWorkshop();
    this.prepareRound();
    const delta = Math.max(0, Math.min(.1, Number(dt) || 0));
    if (this.refereeGate?.status === 'waiting') {
      if (this.connected() && !this.refereePreparing) this.refereeGate.elapsed += delta;
      if (!this.refereeConnected) {
        this.refereeGate.disconnectedElapsed += delta;
        if (this.refereeGate.disconnectedElapsed + 1e-8 >= REFEREE_RECONNECT_GRACE) this.releaseReferee();
      }
    }
    if (!['rules', 'faceoff'].includes(this.stage) || !this.connected()) return;
    if (this.preparationPausesStory()) return;
    this.elapsed = Math.min(this.stage === 'faceoff' ? this.faceoffDuration : 3600, this.elapsed + delta);
    if (this.stage === 'rules' && this.refereeConnected && this.elapsed + 1e-8 >= refereeRuleDuration(this.ruleIndex, this.game.players)) this.nextRule();
    if (this.stage === 'faceoff' && this.elapsed + 1e-8 >= this.faceoffDuration) this.startFight();
  }

  snapshot(refereeConnected = this.refereeConnected) {
    const inRefereeIntro = this.refereeGate?.status === 'waiting' && this.isRoundCountdown();
    const inRoundIntro = this.stage === 'complete' && this.roundIntro
      && (this.game.phase === 'countdown' || this.game.phase === 'paused' && this.game.pausedFrom === 'countdown')
      && this.game.countdown > COUNTDOWN_SECONDS + 1e-8;
    const roundDuration = this.roundIntro?.duration ?? ROUND_INTRO_DURATION;
    const roundElapsed = inRoundIntro ? Math.max(0, roundDuration - (this.game.countdown - COUNTDOWN_SECONDS)) : roundDuration;
    return {
      sequenceId: this.sequenceId,
      stage: inRefereeIntro ? 'refereeIntro' : inRoundIntro ? 'roundIntro' : this.stage,
      elapsed: Math.round((inRefereeIntro ? this.refereeGate.elapsed : inRoundIntro ? roundElapsed : this.elapsed) * 1000) / 1000,
      duration: inRoundIntro ? roundDuration : this.stage === 'faceoff' ? this.faceoffDuration
        : this.stage === 'rules' && refereeConnected ? refereeRuleDuration(this.ruleIndex, this.game.players) : null,
      paused: this.preparationPausesStory()
        || Boolean((inRefereeIntro || inRoundIntro || ['rules', 'faceoff'].includes(this.stage)) && !this.connected()),
      refereePreparing: this.refereePreparing,
      refereeIntro: inRefereeIntro ? { sequenceId: this.refereeGate.sequenceId, round: this.refereeGate.round,
        matchSerial: this.refereeGate.matchSerial, elapsed: Math.round(this.refereeGate.elapsed * 1000) / 1000,
        disconnectedRemaining: refereeConnected ? null : Math.max(0, Math.round((REFEREE_RECONNECT_GRACE - this.refereeGate.disconnectedElapsed) * 1000) / 1000) } : null,
      roundIntro: this.roundIntro ? { sequenceId: this.roundIntro.sequenceId, elapsed: Math.round(roundElapsed * 1000) / 1000, duration: roundDuration,
        exchangeId: this.roundIntro.exchangeId, round: this.roundIntro.round, matchSerial: this.roundIntro.matchSerial } : null,
      ruleIndex: this.ruleIndex, ruleCount: this.ruleCount,
      ruleAcks: [...this.ruleAcks], skipVotes: [...this.skipVotes],
      ready: Object.fromEntries(this.game.players.map(p => [p.id, p.bot || this.readyPlayers.has(p.id)])),
      refereeConnected,
    };
  }

  decorate(snapshot, refereeConnected = this.refereeConnected) {
    const story = this.snapshot(refereeConnected);
    if (['rules', 'faceoff', 'roundIntro', 'refereeIntro'].includes(story.stage)) {
      snapshot.phase = 'story';
      if (['faceoff', 'roundIntro'].includes(story.stage)) {
        const beats = story.stage === 'roundIntro' ? this.roundIntro.beats : this.beats;
        const beat = beats.findLast(b => b.at <= story.elapsed && b.at + b.duration > story.elapsed);

        for (let i = 0; i < snapshot.players.length; i++) {
          const player = snapshot.players[i], direction = i === 0 ? 1 : -1;
          // The mechanical reboot remains visible during the first exchange.
          if (story.stage === 'roundIntro' && player.action === 'recover') continue;
          if (story.stage === 'faceoff') player.x = faceoffActorX(i, story.elapsed);
          player.y = player.vx = player.vy = 0; player.facing = direction;
          player.action = 'faceoff'; player.variant = faceoffActorPose(beat, player.id);
          player.actionTime = Math.max(0, story.elapsed - (beat?.at || 0));
          player.actionDuration = beat?.duration || this.faceoffDuration;
        }
      }
    }
    return { ...snapshot, story, referee: { connected: refereeConnected, preparing: this.refereePreparing } };
  }
}
