import test from 'node:test';
import assert from 'node:assert/strict';
import { robotPresentation } from '../shared/robot-presentation.js';

test('cinematic power-up drives reactor light without repainting the HP lenses', () => {
  const base = { id: 'p1', hp: 42, energy: 0, action: 'faceoff', actionDuration: 3.5 };
  const idle = robotPresentation({ ...base, variant: 'stance' }, 5);
  const peak = robotPresentation({ ...base, variant: 'reactor', actionTime: 1.5 }, 5);
  assert.ok(peak.reactorIntensity > idle.reactorIntensity + .8);
  assert.ok(peak.reactorIntensity <= 1.3);
  assert.equal(peak.healthColor, idle.healthColor);
  assert.equal(peak.healthIntensity, idle.healthIntensity);
  assert.equal(peak.reactorColor, idle.reactorColor);
  for (const variant of ['reactor', 'actuators', 'armed']) {
    const state = { ...base, variant, actionTime: 1 };
    assert.equal(robotPresentation(state, 0).reactorIntensity, robotPresentation(state, 100).reactorIntensity);
    assert.equal(robotPresentation({ ...state, actionTime: 3.5 }, 5).reactorIntensity, idle.reactorIntensity);
  }
});

test('health thresholds are exact, absent HP is healthy, and KO is always offline', () => {
  const cases = [[100, 'healthy'], [61, 'healthy'], [60, 'damaged'], [26, 'damaged'], [25, 'critical'], [1, 'critical'], [0, 'offline'], [-20, 'offline']];
  for (const [hp, band] of cases) assert.equal(robotPresentation({ hp }).healthBand, band);
  for (const hp of [undefined, null, NaN, Infinity, '25']) assert.equal(robotPresentation({ hp }).healthBand, 'healthy');
  assert.equal(robotPresentation().damage, 0);
  assert.equal(robotPresentation({ hp: 40 }).damage, 0.6);
  assert.equal(robotPresentation({ action: 'ko' }).healthBand, 'offline');
  assert.equal(robotPresentation({ action: 'ko' }).damage, 1);
  assert.equal(robotPresentation({ hp: 200 }).damage, 0);
});

test('status priority keeps danger and defense above charge, attacks and full energy', () => {
  const base = { hp: 75, energy: 100, actionDuration: 1 };
  const cases = [
    [{ hp: 0, variant: 'burst', action: 'ultimate' }, 'offline'],
    [{ variant: 'burst', action: 'hit', grabbedBy: 'p2' }, 'burst'],
    [{ variant: 'parry', action: 'hit', grabbedBy: 'p2' }, 'parry'],
    [{ variant: 'grabbed', action: 'hit' }, 'grabbed'],
    [{ action: 'hit', variant: 'grab' }, 'hit'],
    [{ action: 'ultimate', variant: 'grab' }, 'ultimate'],
    [{ action: 'special', variant: 'grab' }, 'special'],
    [{ action: 'block', variant: 'grab' }, 'grab'],
    [{ action: 'block' }, 'block'],
    [{ action: 'heavy' }, 'attack'],
    [{ action: 'idle' }, 'energy-ready'],
    [{ action: 'idle', energy: 70 }, 'standby'],
    [{ action: 'idle', cooldowns: { ultimate: 1 } }, 'standby'],
  ];
  for (const [state, expected] of cases) assert.equal(robotPresentation({ ...base, ...state }).status, expected);
  for (const variant of ['launched', 'parried', 'guardBreak', 'thrown', 'grabBreak', 'burstRepelled']) {
    assert.equal(robotPresentation({ ...base, action: 'hit', variant }).status, 'hit', variant);
  }
});

test('traffic-light hue and brightness remain independent of abilities, skins and energy', () => {
  for (const hp of [100, 60, 25]) {
    const baseline = robotPresentation({ hp, id: 'p1', skin: 'amber' }, 2);
    for (const state of [{ action: 'ultimate' }, { action: 'special', variant: 'burst' }, { action: 'heavy', variant: 'grab' }, { action: 'block', variant: 'parry' }]) {
      const signal = robotPresentation({ hp, id: 'p1', skin: 'cyan', energy: 100, ...state }, 2);
      assert.equal(signal.healthColor, baseline.healthColor);
      assert.equal(signal.healthIntensity, baseline.healthIntensity);
    }
  }
  const healthy = robotPresentation({ hp: 100 }).healthColor;
  const amber = robotPresentation({ hp: 50 }).healthColor;
  const red = robotPresentation({ hp: 10 }).healthColor;
  assert.ok((healthy >> 8 & 255) > (healthy >> 16 & 255));
  assert.ok((amber >> 16 & 255) > (amber >> 8 & 255));
  assert.ok((red >> 16 & 255) > (red >> 8 & 255) * 2);
});

test('reactor tint preserves team identity even during violet charge or defensive burst', () => {
  for (const skin of ['amber', 'cyan']) {
    const standby = robotPresentation({ skin });
    for (const action of [{ action: 'ultimate' }, { action: 'special', variant: 'burst' }, { action: 'ko' }]) {
      assert.equal(robotPresentation({ skin, ...action }).reactorColor, standby.reactorColor);
    }
    assert.ok(robotPresentation({ skin, action: 'special', variant: 'burst' }).reactorIntensity > standby.reactorIntensity);
  }
  assert.notEqual(robotPresentation({ skin: 'amber' }).reactorColor, robotPresentation({ skin: 'cyan' }).reactorColor);
});

test('critical fault dips are deterministic, slow, bounded and nonconstant without rapid flicker', () => {
  const player = { id: 'p1', hp: 12, skin: 'amber', action: 'idle' };
  const samples = Array.from({ length: 60 * 30 }, (_, frame) => robotPresentation(player, frame / 60).healthIntensity);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.07);
  for (let frame = 1; frame < samples.length; frame++) assert.ok(Math.abs(samples[frame] - samples[frame - 1]) < 0.012);
  assert.ok(Math.min(...samples) > 0.48);
  assert.deepEqual(robotPresentation(player, 13.7), robotPresentation(player, 13.7));
  assert.equal(robotPresentation({ ...player, hp: 60 }, 0).healthIntensity, robotPresentation({ ...player, hp: 60 }, 20).healthIntensity);
});

test('reduced motion removes all wall-clock variation while preserving health and useful statuses', () => {
  for (const state of [{ hp: 15 }, { hp: 40, action: 'hit' }, { hp: 80, energy: 100 }, { hp: 25, action: 'ultimate', actionTime: 0.5, actionDuration: 1.8 }]) {
    const start = robotPresentation(state, 0, { reducedMotion: true });
    for (const time of [0.1, 1.5, 7.8, 50, 320]) assert.deepEqual(robotPresentation(state, time, { reducedMotion: true }), start);
  }
});

test('offline dimming follows action time once, becomes quiet after 1.6 seconds and resets on a fresh healthy round', () => {
  const samples = [0, 0.4, 0.8, 1.2, 1.6, 5].map(actionTime => robotPresentation({ hp: 0, action: 'ko', actionTime }, 99));
  for (const key of ['healthIntensity', 'statusIntensity', 'reactorIntensity']) {
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i][key] <= samples[i - 1][key]);
    assert.ok(samples.at(-1)[key] < 0.03);
  }
  assert.deepEqual(samples[4], samples[5]);
  assert.deepEqual(robotPresentation({ action: 'ko', actionTime: 0.7 }, 0), robotPresentation({ action: 'ko', actionTime: 0.7 }, 100));
  const revived = robotPresentation({ hp: 100, action: 'idle', actionTime: 0 });
  assert.equal(revived.healthBand, 'healthy'); assert.equal(revived.status, 'standby');
  assert.ok(revived.healthIntensity > 0.7);
});

test('malformed and extreme numeric inputs always return finite, serializable bounded signals', () => {
  const inputs = [null, undefined, {}, { hp: NaN, energy: Infinity, actionTime: -Infinity },
    { hp: 1, energy: -100, actionTime: 1e308, actionDuration: 1e-308, skin: 'other' },
    { hp: 100, energy: 1e308, action: 'ultimate', actionDuration: 0 }];
  for (const input of inputs) {
    for (const time of [NaN, Infinity, -Infinity, 1e308, -1e308]) {
      const signal = robotPresentation(input, time);
      assert.ok(signal.damage >= 0 && signal.damage <= 1);
      for (const key of ['healthIntensity', 'statusIntensity', 'reactorIntensity']) assert.ok(Number.isFinite(signal[key]) && signal[key] >= 0 && signal[key] <= 1.3, key);
      for (const key of ['healthColor', 'statusColor', 'reactorColor']) assert.ok(Number.isInteger(signal[key]) && signal[key] >= 0 && signal[key] <= 0xffffff);
      assert.deepEqual(JSON.parse(JSON.stringify(signal)), signal);
    }
  }
});

test('presentation is immutable and independent between robot clones and previous calls', () => {
  const player = Object.freeze({ hp: 20, energy: 100, skin: 'cyan', cooldowns: Object.freeze({ ultimate: 0 }) });
  const initial = robotPresentation(player, 4);
  const changed = robotPresentation(player, 4); changed.healthColor = 0; changed.damage = 0;
  robotPresentation({ hp: 0, skin: 'amber', action: 'ko', actionTime: 9 });
  assert.deepEqual(robotPresentation(player, 4), initial);
  assert.equal(player.hp, 20);
});

test('both head lenses agree through abilities, diagnostic reboot and destruction', () => {
  for (const hp of [100, 55, 18]) for (const action of ['idle', 'heavy', 'ultimate', 'special', 'recover']) {
    const p = robotPresentation({ hp, action, actionTime: .8, variant: 'burst' }, 3);
    assert.equal(p.statusColor, p.healthColor);
    assert.ok(p.statusIntensity <= .94 * p.healthIntensity);
  }
  const wreck = robotPresentation({ action: 'destroyed', actionTime: 0 });
  assert.equal(wreck.power, 0);
  assert.equal(wreck.healthIntensity + wreck.statusIntensity + wreck.reactorIntensity, 0);
});

test('reboot performs three separated red/amber/green checks before showing actual HP', () => {
  for (const duration of [.75, 1.6]) for (const reducedMotion of [false, true]) {
    const sample = progress => robotPresentation({ action: 'recover', hp: 100, actionTime: progress * duration, actionDuration: duration }, 999, { reducedMotion });
    assert.equal(sample(0).healthIntensity, 0);
    for (const [time, color] of [[.125, 0xef4247], [.345, 0xffab24], [.57, 0x35d96d]]) {
      const signal = sample(time);
      assert.equal(signal.healthColor, color);
      assert.equal(signal.statusColor, color);
      assert.ok(signal.healthIntensity >= .3 && signal.healthIntensity <= .65);
    }
    for (const time of [.25, .47]) assert.equal(sample(time).healthIntensity, 0, 'self-test lamps extinguish between diagnostic colors');
    assert.ok(sample(1).healthIntensity > .75);
    for (const hp of [18, 55, 100]) {
      const finished = robotPresentation({ action: 'recover', hp, actionTime: duration, actionDuration: duration });
      const playing = robotPresentation({ hp, action: 'idle' });
      assert.equal(finished.healthColor, playing.healthColor, 'self-test must hand back to actual HP');
    }
    assert.deepEqual(sample(.345), robotPresentation({ action: 'recover', hp: 100, actionTime: .345 * duration, actionDuration: duration }, 0, { reducedMotion }), 'wall time cannot advance paused diagnostics');
  }
});
