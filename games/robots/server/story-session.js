import { faceoffActorPose, faceoffActorX, faceoffDuration } from '../shared/faceoff-script.js';
import { COUNTDOWN_SECONDS } from '../shared/constants.js';
import { buildRoundIntro as defaultRoundIntro, ROUND_INTRO_DURATION } from '../shared/round-intro.js';

// Presentation runs beside CombatRoom: it cannot award damage, change inputs or
// let an optional referee occupy a fighter slot. Existing protocol clients can
// still create a room without the presentation layer.
export class StorySession {
  constructor(game, { ruleCount = 5, faceoffDuration = 24, buildFaceoff = () => [], buildRoundIntro = defaultRoundIntro } = {}) {
    this.game = game;
    this.ruleCount = Math.max(1, ruleCount);
    this.faceoffDuration = faceoffDuration;
    this.buildFaceoff = buildFaceoff;
    this.buildRoundIntro = buildRoundIntro;
    this.stage = 'workshop';
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

  advance({ actor, sequenceId, ruleIndex }, refereeConnected = false) {
    if (sequenceId !== this.sequenceId || !this.connected()) return false;
    if (this.stage === 'rules') {
      if (ruleIndex !== this.ruleIndex) return false;
      if (actor === 'referee') { if (!refereeConnected) return false; }
      else {
        if (refereeConnected || !this.game.player(actor)?.connected) return false;
        this.ruleAcks.add(actor);
        if (!this.allMarked(this.ruleAcks)) return true;
      }
      this.ruleIndex++; this.elapsed = 0; this.ruleAcks.clear();
      if (this.ruleIndex >= this.ruleCount) { this.stage = 'faceoff'; this.elapsed = 0; }
      return true;
    }
    // The opening sequence persists across stages. A delayed rules packet must
    // not be reinterpreted as an explicit vote to skip the faceoff.
    if (this.stage === 'faceoff' && ruleIndex === this.ruleCount && this.elapsed >= 3 && actor !== 'referee' && this.game.player(actor)?.connected) {
      this.skipVotes.add(actor);
      if (this.allMarked(this.skipVotes)) this.startFight();
      return true;
    }
    return false;
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
    const event = this.game.events.findLast(e => e.type === 'round' && !e.fight);
    if (!event || event.id === this.lastRoundEventId) return;
    this.lastRoundEventId = event.id;
    if (this.game.round === 1 && this.lastRound) this.matchSerial++;
    this.lastRound = this.game.round;
    const intro = this.buildRoundIntro(this.game.players, this.game.id, this.game.round, this.matchSerial);
    this.roundIntro = { ...intro, sequenceId: `${this.game.id}:round:${event.id}`, matchSerial: this.matchSerial };
    this.game.countdown += intro.duration;
  }

  step(dt) {
    this.prepareWorkshop();
    this.prepareRound();
    if (!['rules', 'faceoff'].includes(this.stage) || !this.connected()) return;
    this.elapsed = Math.min(this.stage === 'faceoff' ? this.faceoffDuration : 3600, this.elapsed + Math.max(0, Math.min(.1, dt)));
    if (this.stage === 'faceoff' && this.elapsed + 1e-8 >= this.faceoffDuration) this.startFight();
  }

  snapshot(refereeConnected = false) {
    const inRoundIntro = this.stage === 'complete' && this.roundIntro
      && (this.game.phase === 'countdown' || this.game.phase === 'paused' && this.game.pausedFrom === 'countdown')
      && this.game.countdown > COUNTDOWN_SECONDS + 1e-8;
    const roundDuration = this.roundIntro?.duration ?? ROUND_INTRO_DURATION;
    const roundElapsed = inRoundIntro ? Math.max(0, roundDuration - (this.game.countdown - COUNTDOWN_SECONDS)) : roundDuration;
    return {
      sequenceId: this.sequenceId,
      stage: inRoundIntro ? 'roundIntro' : this.stage,
      elapsed: Math.round((inRoundIntro ? roundElapsed : this.elapsed) * 1000) / 1000,
      duration: inRoundIntro ? roundDuration : this.stage === 'faceoff' ? this.faceoffDuration : null,
      paused: Boolean((inRoundIntro || ['rules', 'faceoff'].includes(this.stage)) && !this.connected()),
      roundIntro: this.roundIntro ? { sequenceId: this.roundIntro.sequenceId, elapsed: Math.round(roundElapsed * 1000) / 1000, duration: roundDuration,
        exchangeId: this.roundIntro.exchangeId, round: this.roundIntro.round, matchSerial: this.roundIntro.matchSerial } : null,
      ruleIndex: this.ruleIndex, ruleCount: this.ruleCount,
      ruleAcks: [...this.ruleAcks], skipVotes: [...this.skipVotes],
      ready: Object.fromEntries(this.game.players.map(p => [p.id, p.bot || this.readyPlayers.has(p.id)])),
      refereeConnected,
    };
  }

  decorate(snapshot, refereeConnected = false) {
    const story = this.snapshot(refereeConnected);
    if (['rules', 'faceoff', 'roundIntro'].includes(story.stage)) {
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
    return { ...snapshot, story, referee: { connected: refereeConnected } };
  }
}
