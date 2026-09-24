import { buildFaceoff, FACE_OFF_DURATION } from '../shared/faceoff-script.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const radians = Math.PI / 180;
const components = ['x', 'y', 'z', 'tx', 'ty', 'tz'];
const ease = value => { const t = clamp(value, 0, 1); return t * t * t * (10 + t * (-15 + 6 * t)); };

// NDC, not CSS pixels: the same composition leaves the upper quarter for names
// and the lower fifth for subtitles on both phones and the booth display.
export const FACEOFF_SAFE_FRAME = Object.freeze({ left: -.90, right: .90, bottom: -.60, top: .50 });

function actorsFor(players) {
  const source = Array.isArray(players) && players.length ? players.slice(0, 2) : [{ x: -3.6 }, { x: 3.6 }];
  return source.map((player, index) => ({
    id: player?.id ?? `p${index + 1}`,
    x: finite(player?.x, index ? 3.6 : -3.6), y: Math.max(0, finite(player?.y, 0)),
    z: finite(player?.z, 0), customization: player?.customization,
  }));
}

/** Conservative articulated silhouette, split by height instead of a huge box.
 * The actual idle GLB reaches x±1.64/z±1.82 and y2.40; the tallest top hat is
 * y2.90. Gesture margins cover the raised pointing claw and sprung turret.
 * A hat never requires pretending that the outstretched toes are 3.2m high.
 */
export function faceoffFramingPoints(players) {
  const points = [];
  for (const player of actorsFor(players)) {
    const top = player.customization?.accessory === 'topHat' ? 3.20
      : ['crown', 'colander', 'propeller'].includes(player.customization?.accessory) ? 3.07 : 2.80;
    const boxes = [
      { halfX: 1.90, low: -.035, high: 1.32, halfZ: 2.02 },
      { halfX: 2.12, low: .75, high: 1.85, halfZ: 1.50 },
      { halfX: .98, low: .8, high: 2.03, halfZ: 1.00 },
      { halfX: .81, low: 1.55, high: top, halfZ: .83 },
    ];
    for (const box of boxes) for (const x of [-box.halfX, box.halfX])
      for (const y of [box.low, box.high]) for (const z of [-box.halfZ, box.halfZ])
        points.push({ x: player.x + x, y: player.y + y, z: player.z + z });
  }
  return points;
}

// A positive-kernel response to the entire script, evaluated analytically.
// Even if a line is shortened below the settling time, the next speaker cannot
// cause a jump or overshoot. Narrator beats gently return attention to centre.
function attentionFor(beats, actors, elapsed) {
  const middle = actors.reduce((sum, player) => sum + player.x, 0) / actors.length;
  const valid = (Array.isArray(beats) ? beats : []).filter(beat =>
    Number.isFinite(beat?.at) && Number.isFinite(beat?.duration) && beat.duration > 0)
    .slice(0, 64).sort((a, b) => a.at - b.at);
  const boundaries = [...new Set(valid.flatMap(beat => [beat.at, beat.at + beat.duration]))].sort((a, b) => a - b);
  let prior = 0, attention = 0;
  for (const at of boundaries) {
    if (at > elapsed) break;
    const beat = valid.findLast(value => value.at <= at && value.at + value.duration > at);
    const speaker = actors.find(player => player.id === beat?.speaker);
    const strength = beat?.pose === 'resolve' ? .72 : 1;
    const side = speaker ? Math.sign(speaker.x - middle) * strength : 0;
    attention += (side - prior) * ease((elapsed - at) / 1.35);
    prior = side;
  }
  return clamp(attention, -1, 1);
}

// Smooth maximum stays *outside* every constraint. Unlike iterative clipping,
// changing the limiting toe/hat cannot produce a distance step in the dolly.
function smoothMaximum(values, softness) {
  const largest = Math.max(...values);
  return largest + softness * Math.log(values.reduce((sum, value) => sum + Math.exp((value - largest) / softness), 0));
}

function framedShot({ target, yaw, pitch, distance }, players, aspect, fov) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const back = { x: sy * cp, y: sp, z: cy * cp };
  const right = { x: cy, y: 0, z: -sy };
  const up = { x: -sy * sp, y: cp, z: -cy * sp };
  const tangent = Math.tan(fov * radians / 2);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const needed = [distance];
  for (const point of faceoffFramingPoints(players)) {
    const relative = { x: point.x - target.x, y: point.y - target.y, z: point.z - target.z };
    const depthOffset = dot(relative, back), vertical = dot(relative, up);
    needed.push(depthOffset + Math.abs(dot(relative, right)) / (FACEOFF_SAFE_FRAME.right * tangent * aspect));
    needed.push(depthOffset + Math.abs(vertical) / ((vertical >= 0 ? FACEOFF_SAFE_FRAME.top : -FACEOFF_SAFE_FRAME.bottom) * tangent));
  }
  const safeDistance = smoothMaximum(needed, .035);
  return {
    x: target.x + back.x * safeDistance, y: target.y + back.y * safeDistance, z: target.z + back.z * safeDistance,
    tx: target.x, ty: target.y, tz: target.z,
  };
}

/** Pure authoritative-time camera: pause is an unchanged elapsed, and seek or
 * reconnect needs no previous frame. Never pass wall time/performance.now().
 * `beats` may be supplied from the public script payload; otherwise current
 * shared dialogue timings are used, so edits to the first eleven seconds do
 * not require recutting the camera. `paused` intentionally starts no new clock.
 */
export function computeFaceoffCamera({ story = {}, players = [], beats, aspect = 16 / 9, fov = 36, reduced = false } = {}) {
  const actors = actorsFor(players);
  const mid = actors.reduce((sum, player) => sum + player.x, 0) / actors.length;
  const middleY = Math.max(...actors.map(player => player.y));
  const middleZ = actors.reduce((sum, player) => sum + player.z, 0) / actors.length;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const field = Number.isFinite(fov) && fov > 0 && fov < 179 ? fov : 36;
  const elapsed = clamp(finite(story?.elapsed, 0), 0, FACE_OFF_DURATION);

  if (reduced) {
    // A fixed establishing two-shot accommodates the *entire* approach. Moving
    // actors don't gradually zoom a supposedly reduced-motion camera.
    const halfSpread = Math.max(3.6, ...actors.map(player => Math.abs(player.x - mid)));
    const held = actors.map((player, index) => ({ ...player, x: mid + (index ? 1 : -1) * halfSpread }));
    return framedShot({ target: { x: mid, y: 1.45 + middleY, z: middleZ - .1 },
      yaw: 0, pitch: 8.0 * radians, distance: 14.8 }, held, ratio, field);
  }

  const script = beats ?? story?.beats ?? buildFaceoff(actors, story?.sequenceId);
  const attention = attentionFor(script, actors, elapsed);
  const arrival = ease(elapsed / 5.3);
  const confrontation = ease((elapsed - 5.3) / 5.4);
  const correction = ease((elapsed - 11.3) / 1.7);
  const resolve = ease((elapsed - 13) / 3.2);
  const release = ease((elapsed - (FACE_OFF_DURATION - 2.8)) / 2.8);

  // Three motivated moves: a descending entrance dolly; an eye-level lateral
  // track following the voices; a small shared reveal and final crane release.
  // There is no idle sine, contact shake or hard cut hidden in these poses.
  const rail = mix(-4.2, .8, arrival) + attention * mix(4.8, 3.7, resolve);
  const pitch = (mix(7.6, 5.3, arrival) + .45 * correction + 3.0 * release) * radians;
  const distance = mix(14.4, 12.05, arrival) - .38 * confrontation + .32 * correction + .78 * release;
  const target = { x: mid + attention * .30 * (1 - release), y: 1.43 + middleY, z: middleZ - .12 };
  return framedShot({ target, yaw: rail * (1 - release) * radians, pitch, distance }, actors, ratio, field);
}

/** Freeze `from` when leaving faceoff (including an early mutual skip), then
 * blend towards the live combat frame over the three-second countdown.
 * Exact endpoints and zero endpoint acceleration avoid a jump at either seam.
 */
export function blendFaceoffCamera(from, combat, progress) {
  const weight = ease(finite(progress, 0));
  return Object.fromEntries(components.map(key => [key, weight === 0 ? from[key] : weight === 1 ? combat[key] : mix(from[key], combat[key], weight)]));
}
