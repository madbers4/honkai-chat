// Short, contact-only Foley: a broadband strike, the body of the chassis and
// inharmonic plate resonances. Generated once on audio unlock, never on a hit.
const SHAPES = Object.freeze({
  light: { seconds: .23, body: 178, plate: 367, weight: .64, ring: .08 },
  cross: { seconds: .28, body: 145, plate: 291, weight: .82, ring: .11 },
  drive: { seconds: .35, body: 111, plate: 219, weight: 1, ring: .14 },
  hook: { seconds: .31, body: 133, plate: 267, weight: .91, ring: .13 },
  crush: { seconds: .44, body: 89, plate: 183, weight: 1.12, ring: .18 },
  guard: { seconds: .30, body: 242, plate: 627, weight: .26, ring: .15 },
});
export const IMPACT_KINDS = Object.freeze(Object.keys(SHAPES));

export function impactCue(type, event = {}) {
  if (event.presentationHistorical) return null;
  if (type === 'block' || type === 'parry') return { kind: 'guard', gain: type === 'parry' ? .95 : .78 };
  if (type === 'grabStrike') return { kind: event.chain > 1 ? 'crush' : 'drive', gain: 1.28 };
  if (type !== 'hit') return null;
  // Energy beams already have their own electrical envelope.
  if (['bolt', 'shockwave', 'overload'].includes(event.variant)) return null;
  const kind = ({ cross: 'cross', airCross: 'cross', heavyDrive: 'drive', heavyHook: 'hook',
    heavyPress: 'crush', slam: 'crush', crusher: 'crush', airFinish: 'crush', launcher: 'drive',
    rake: 'hook', dashStrike: 'drive', grab: 'crush' })[event.variant]
    ?? (event.damage >= 14 ? 'drive' : 'light');
  return { kind, gain: event.counter ? 1.46 : 1.25 };
}

export function synthesizeImpact(kind, sampleRate = 32000) {
  const shape = SHAPES[kind];
  if (!shape || !Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('Invalid impact format');
  const samples = new Float32Array(Math.ceil(shape.seconds * sampleRate));
  let random = 731 + IMPACT_KINDS.indexOf(kind) * 971, low = 0, mid = 0, dc = 0, peak = 0;
  const tau = Math.PI * 2;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    const noise = (random >>> 0) / 2147483648 - 1;
    low += .10 * (noise - low); mid += .47 * (noise - mid);
    const attack = 1 - Math.exp(-t / .0007);
    const crack = (noise - mid) * Math.exp(-t / .009) * .62;
    const scrape = (mid - low) * Math.exp(-t / .037) * .65;
    const punch = Math.sin(tau * (shape.body * t + shape.body * .015 * (1 - Math.exp(-t / .015))))
      * Math.exp(-t / .044) * shape.weight;
    const plate = [1, 1.713, 2.831, 4.137].reduce((sum, ratio, index) => sum
      + Math.sin(tau * shape.plate * ratio * t + .11 * Math.sin(t * 81))
        * Math.exp(-t / (shape.ring / (1 + index * .42))) * [.17, .10, .065, .035][index], 0);
    // A tiny loose-fastener tail follows the impact; it is not a second hit.
    const rattle = (mid - low) * Math.exp(-t / .105) * Math.max(0, Math.sin(tau * 43 * t)) * .16;
    const mixed = Math.tanh((crack + scrape + punch + plate + rattle) * 1.4) * attack;
    dc += .002 * (mixed - dc);
    const tail = Math.min(1, (samples.length - 1 - i) / (sampleRate * .012));
    samples[i] = (mixed - dc) * Math.max(0, tail); peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= .86 / peak;
  return samples;
}

export function createImpactBank(context) {
  const bank = new Map();
  for (const kind of IMPACT_KINDS) {
    const samples = synthesizeImpact(kind);
    const buffer = context.createBuffer(1, samples.length, 32000);
    buffer.getChannelData(0).set(samples); bank.set(kind, buffer);
  }
  return bank;
}
