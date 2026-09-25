import { ARENA_EDGE, GRAVITY, JUMP_CLEARANCE, PLAYER_RADIUS, clamp } from '../shared/constants.js';

/** Voluntary high jumps clear the real beetle, including its tallest trophy.
 * Launcher pursuit and throw physics keep their existing combat collision.
 * Descending into an occupied landing spot starts a bounded sideways slide
 * while still above the head; it cannot wait until touchdown and teleport 2m.
 */
export function resolveTraversalContact(one, two, dt) {
  const upper = one.y >= two.y ? one : two, lower = upper === one ? two : one;
  if (!upper.traversalJump || upper.action === 'hit' || upper.throwFlight || upper.y <= .02 || lower.y > .05) return false;
  const height = upper.y - lower.y, fullGap = PLAYER_RADIUS * 2;
  const descending = upper.vy < 0;
  let gap = fullGap, side = upper.traversalSide;
  if (descending) {
    const lead = .35;
    const landingHeight = height + upper.vy * lead - .5 * GRAVITY * lead * lead;
    const t = clamp((JUMP_CLEARANCE - landingHeight) / .75, 0, 1);
    gap *= t * t * (3 - 2 * t);
    if (gap <= .0001) return true;
    if (!upper.traversalLandingSide) {
      const projected = clamp(upper.x + upper.vx * lead, -ARENA_EDGE, ARENA_EDGE);
      side = Math.abs(projected - lower.x) > .04 ? Math.sign(projected - lower.x) : side;
      if (Math.abs(lower.x + side * fullGap) > ARENA_EDGE) side = -side;
    }
    side = upper.traversalLandingSide || side;
    // A held cross-up already lands outside the body. Do not add an artificial
    // lateral kick to that valid trajectory; reserve assistance for overlap.
    if (height >= JUMP_CLEARANCE && (upper.x + upper.vx * lead - lower.x) * side >= fullGap) return true;
    upper.traversalLandingSide = side;
  } else {
    if (height >= JUMP_CLEARANCE) return true;
  }
  if ((upper.x - lower.x) * side >= gap) return true;
  // Bound the entire tick, including inward travel and wall clamping. Undoing
  // vx*dt at a wall would subtract travel that never actually happened.
  // The stationary fighter is never shoved out of an occupied landing spot.
  const previous = Number.isFinite(upper.traversalPreviousX) ? upper.traversalPreviousX : upper.x;
  if (upper.vx * side < 0) upper.vx = 0;
  const desired = clamp(lower.x + side * gap, -ARENA_EDGE, ARENA_EDGE);
  upper.x = clamp(clamp(desired, previous - 8 * dt, previous + 8 * dt), -ARENA_EDGE, ARENA_EDGE);
  return true;
}
