import { healthPercent } from '../shared/health.js';

export class GameAudio {
  constructor() { this.muted = localStorage.getItem('belobog-muted') === 'true'; this.voices = new Set(); }
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx(); this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.28;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -13; limiter.knee.value = 18; limiter.ratio.value = 5;
      limiter.attack.value = .006; limiter.release.value = .18;
      this.master.connect(limiter); limiter.connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    this.ctx.resume().catch(() => {});
  }
  toggle() {
    this.muted = !this.muted; localStorage.setItem('belobog-muted', this.muted);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.28, this.ctx.currentTime, .03);
    return this.muted;
  }
  track(source, ...nodes) {
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); for (const node of nodes) node.disconnect(); };
  }
  stop() {
    for (const source of this.voices) { try { source.stop(); } catch {} }
    this.voices.clear();
  }
  tone(frequency, duration, type = 'sine', gain = .4, endFrequency = frequency, delay = 0) {
    if (!this.ctx || this.muted || this.voices.size >= 64) return;
    const t = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), env = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + .005); env.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(env); env.connect(this.master); this.track(osc, env); osc.start(t); osc.stop(t + duration + .01);
  }
  burst(duration, frequency = 1400, gain = .5, endFrequency = frequency, delay = 0, kind = 'bandpass') {
    if (!this.ctx || this.muted || this.voices.size >= 64) return;
    const t = this.ctx.currentTime + delay, source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), env = this.ctx.createGain();
    source.buffer = this.noise; source.loop = duration > .9; filter.type = kind;
    filter.frequency.setValueAtTime(frequency, t); filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), t + duration); filter.Q.value = .7;
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(.001, t + duration);
    source.connect(filter); filter.connect(env); env.connect(this.master); this.track(source, filter, env); source.start(t); source.stop(t + duration);
  }
  metal(base, weight = 1, length = .24) {
    [1, 1.47, 2.81].forEach((ratio, index) => this.tone(base * ratio, length / (1 + index * .4), 'sine', weight * [.21, .12, .065][index], base * ratio * .73, index * .008));
  }
  play(type, event = {}) {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (type === 'ui') this.tone(640, .055, 'sine', .13, 920);
    if (type === 'countdown') this.tone(480, .13, 'triangle', .4);
    if (type === 'fight') { this.tone(150, .6, 'sawtooth', .3, 42); this.burst(.25, 1600, .7); }
    if (type === 'denied') this.tone(155, .1, 'triangle', .12, 100);
    if (type === 'attack') {
      const force = ['launcher', 'slam', 'crusher', 'rake', 'airFinish', 'heavyDrive', 'heavyHook', 'heavyPress'].includes(event.variant);
      const cross = ['cross', 'airCross'].includes(event.variant);
      this.burst(force ? .20 : cross ? .13 : .085, force ? 800 : cross ? 1700 : 2700, force ? .34 : .18, force ? 200 : 550);
      this.tone(force ? 160 : cross ? 240 : 320, force ? .18 : .10, 'triangle', .07, 90);
      if (event.variant === 'dashStrike') this.tone(240, .18, 'sawtooth', .14, 65);
    }
    if (type === 'hit') {
      const heavyPitch = { heavyDrive: 195, heavyHook: 235, heavyPress: 145 }[event.variant];
      const heavy = event.damage >= 14 || Boolean(heavyPitch);
      this.burst(heavy ? .2 : .13, heavy ? 950 : 1600, .8);
      this.tone(heavy ? 105 : 150, heavy ? .25 : .16, 'triangle', .8, 32);
      this.tone(2300 + (event.combo || 0) * 120, .06, 'sine', .15, 800);
      this.metal(heavyPitch ?? (heavy ? 185 : event.variant === 'cross' ? 290 : 390), heavy ? 1.4 : .8, heavy ? .35 : .19);
      if (event.counter) this.tone(1200, .25, 'triangle', .3, 250);
      const remainingHealth = healthPercent({ hp: event.targetHp, maxHp: event.targetMaxHp });
      if (remainingHealth > 0 && remainingHealth <= 60) {
        const critical = remainingHealth <= 25;
        this.burst(critical ? .12 : .065, 4600, critical ? .22 : .11);
        this.tone(critical ? 1150 : 1650, .09, 'square', .045, 190, .08);
      }
    }
    if (type === 'block') { this.metal(630, 1.1, .3); this.burst(.1, 4200, .4, 950); }
    if (type === 'dash') this.burst(event.variant === 'airDash' ? .27 : .2, event.variant === 'airDash' ? 2600 : 650, .38, 250);
    if (type === 'feint') { this.burst(.12, 1800, .2); this.tone(390, .17, 'triangle', .2, 100); }
    if (type === 'grab') { this.burst(.09, 2400, .55); this.tone(240, .18, 'square', .13, 115); }
    if (type === 'grabStrike') { this.metal(event.chain > 1 ? 145 : 200, 1.8, .35); this.tone(92, .23, 'triangle', .75, 28); this.burst(.16, 1300, .55, 280); }
    if (type === 'grabBreak') { this.burst(.14, 3600, .6); this.tone(700, .26, 'triangle', .36, 1450); }
    if (type === 'throw') { this.tone(170, .36, 'triangle', .55, 35); this.burst(.24, 1600, .5, 380); this.metal(240, .8, .2); }
    if (type === 'burst') { this.tone(110, .38, 'sawtooth', .25, 700); this.tone(1800, .45, 'sine', .16, 80); this.burst(.38, 3200, .75); }
    if (type === 'parry') { this.tone(1750, .25, 'sine', .4, 2600); this.tone(2625, .38, 'sine', .24, 3500, .015); this.burst(.055, 5500, .6); }
    if (type === 'launch') { this.tone(140, .3, 'sawtooth', .18, 800); this.burst(.16, 650, .45); }
    if (type === 'slam') { this.tone(110, .5, 'triangle', .9, 24); this.burst(.35, 320, .75); }
    if (type === 'special') {
      if (event.variant === 'shockwave') { this.tone(70, .4, 'sawtooth', .3, 36); this.burst(.35, 550, .6); }
      else { this.tone(750, .35, 'sawtooth', .2, 80); this.burst(.18, 2400, .6); }
    }
    if (type === 'ultimate') { this.tone(50, .7, 'sawtooth', .3, 620); this.tone(75, .68, 'triangle', .25, 940); }
    if (type === 'ultimatePulse') {
      const final = event.pulse === 2;
      this.tone(final ? 160 : 210, final ? .65 : .3, 'sawtooth', .3, 28);
      this.tone(final ? 90 : 120, final ? .7 : .32, 'triangle', .7, 24);
      this.burst(final ? .6 : .22, final ? 400 : 1400, .8);
    }
    if (type === 'ko') { this.tone(170, .9, 'sawtooth', .13, 25); this.metal(120, 1.1, .55); this.burst(.45, 1800, .22, 90); this.tone(600, .25, 'square', .035, 80, .22); }
    if (type === 'recover') { this.tone(55, .65, 'triangle', .13, 260); this.tone(440, .09, 'sine', .075, 660, .6); this.tone(660, .12, 'sine', .065, 880, .75); this.burst(.35, 280, .10, 900); }
    if (type === 'finisherStart') { this.tone(58, 1.1, 'sawtooth', .13, 180); this.burst(.7, 400, .18, 1500); this.metal(340, .7, .6); }
    if (type === 'finisherImpact') { this.metal(110, 2, .6); this.burst(.65, 2500, .65, 160); this.tone(75, .5, 'triangle', .7, 27); }
    if (type === 'destruction') {
      this.tone(90, 1.15, 'triangle', 1.0, 22);
      this.burst(1.25, 5500, .95, 160, 0, 'lowpass');
      this.burst(.23, 3400, .6, 600);
      [0, .11, .24, .37].forEach((delay, index) => this.tone(870 + index * 433, .26, 'sine', .09 / (1 + index * .2), 200 + index * 90, delay));
    }
    if (type === 'win') [261.63,329.63,392,523.25].forEach((f,i) => this.tone(f, .8, 'triangle', .25, f, i * .13));
  }
}
