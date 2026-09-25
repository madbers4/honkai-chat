import { ARENA_EDGE, clamp } from '../shared/constants.js';

/** Presentation prediction uses the same arena as the authoritative roots.
 * A small late-packet extrapolation may approach a wall, never cross it.
 */
export function arenaRootPosition(player, extrapolate = 0) {
  return {
    x: clamp((player.x ?? 0) + (player.vx ?? 0) * extrapolate, -ARENA_EDGE, ARENA_EDGE),
    y: Math.max(0, (player.y ?? 0) + (player.vy ?? 0) * extrapolate),
  };
}
