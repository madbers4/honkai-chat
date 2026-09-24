import { ATTACKS, VARIANT_ATTACKS, V5_ATTACKS, V3_RULES } from '../shared/constants.js';

const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const rotate = (p, yaw, root) => ({ x: root.x + p.x * Math.cos(yaw) + p.z * Math.sin(yaw), y: root.y + p.y, z: root.z + p.z * Math.cos(yaw) - p.x * Math.sin(yaw) });
const diagonal = side => side === 'FL' || side === 'RR';
export function turnStartup(player) {
  if (player.action === 'heavy' && player.variant === 'grab') return V3_RULES.grabStartup;
  return (V5_ATTACKS[player.variant] || VARIANT_ATTACKS[player.variant] || ATTACKS[player.action])?.startup || 0;
}

// A local presentation history, never a gameplay turn delay. Five diagonal
// transfers give a 128-degree camera-facing reversal two planted supports.
// World-space toes stay where they carried weight until their next transfer.
export function createMechanicalTurn() {
  let facing, yaw = 0, turn = null, urgent = null, lastTime, seekToken;
  const output = { yaw: 0, active: false, feet: null, bob: 0, roll: 0, headYaw: 0, headPitch: 0 };
  const idle = () => {
    output.yaw = yaw; output.active = false; output.feet = null;
    output.bob = output.roll = output.headYaw = output.headPitch = 0;
    return output;
  };
  return {
    update({ targetYaw, facing: nextFacing, allowed, airborne, time, dt, root, feet, homes, startup = 0, actionTime = 0, reset = false, token, reduced = false }) {
      const discontinuity = reset || lastTime != null && (time < lastTime - .001 || time - lastTime > .3) || token !== seekToken;
      const changed = facing != null && nextFacing !== facing;
      if (facing == null || discontinuity) { yaw = targetYaw; turn = urgent = null; }
      else if (!allowed) {
        // Spend the remaining real startup on an urgent turn. Its first frame
        // retains the observed yaw; the active frame must already aim correctly.
        // Existing paired aiming keeps its response without a locomotion turn.
        if (turn || changed) {
          const duration = Math.min(.18, startup - actionTime - .012);
          urgent = duration > 1 / 120 ? { from: yaw, delta: angle(targetYaw - yaw), start: time, duration } : null;
          if (!urgent) yaw = targetYaw;
          turn = null;
        }
        if (urgent) {
          const p = actionTime >= startup - .012 ? 1 : clamp((time - urgent.start) / urgent.duration);
          yaw = urgent.from + angle(targetYaw - urgent.from) * p;
          if (p >= 1) urgent = null;
        } else yaw += angle(targetYaw - yaw) * (1 - Math.exp(-22 * dt));
        facing = nextFacing; lastTime = time; seekToken = token;
        return idle();
      } else if (changed) {
        turn = { start: time, from: yaw, delta: angle(targetYaw - yaw), duration: airborne ? .34 : .72,
          feet: feet.map(p => ({ ...p })), stages: feet.map(() => -1), paths: feet.map(() => null), airborne,
          root: { x: root.x, z: root.z } };
      }
      facing = nextFacing; lastTime = time; seekToken = token;
      urgent = null;
      if (!turn) {
        yaw += angle(targetYaw - yaw) * (1 - Math.exp(-22 * dt));
        return idle();
      }
      // Collision separation can shift a network root much farther than a
      // walking step. Carry the contact patch with that forced displacement;
      // never stretch a planted leg across the old position after a correction.
      const rootDx = root.x - turn.root.x, rootDz = root.z - turn.root.z;
      if (Math.hypot(rootDx, rootDz) > Math.max(.12, dt * 5)) {
        for (let i = 0; i < turn.feet.length; i++) {
          turn.feet[i].x += rootDx; turn.feet[i].z += rootDz;
          const path = turn.paths[i];
          if (path) for (const point of [path.from, path.to]) if (point) { point.x += rootDx; point.z += rootDz; }
        }
      }
      turn.root.x = root.x; turn.root.z = root.z;
      const p = clamp((time - turn.start) / turn.duration);
      yaw = turn.from + turn.delta * smooth(p);
      const weight = Math.sin(Math.PI * p), sign = Math.sign(turn.delta);
      const result = { yaw, active: true, feet: null, bob: -.038 * weight,
        roll: (reduced ? .014 : .033) * sign * weight,
        headYaw: (reduced ? .09 : .19) * sign * Math.sin(Math.PI * Math.min(1, p * 1.4)), headPitch: .018 * weight };
      if (!turn.airborne && !airborne) {
        result.feet = turn.feet.map((planted, i) => {
          const a = diagonal(homes[i].side);
          // Small alternating advances avoid sweeping a leg across the body.
          // A/B/A/B/A finish the turn. Active pairs do
          // not overlap; the other diagonal bears the housing throughout.
          const stage = a ? p < .4 ? 0 : p < .8 ? 2 : 4 : p < .6 ? 1 : 3;
          const begin = stage / 5, end = (stage + 1) / 5;
          const targetFraction = [.28, .52, .76, 1, 1][stage];
          if (p < begin) return { ...planted };
          if (turn.stages[i] !== stage) {
            turn.stages[i] = stage;
            turn.paths[i] = { from: { ...planted }, to: null };
          }
          const path = turn.paths[i], t = clamp((p - begin) / (end - begin));
          if (t < 1 || !path.to) path.to = rotate(homes[i], turn.from + turn.delta * targetFraction, root);
          const k = smooth(t), lift = (reduced ? .105 : .16) * Math.sin(Math.PI * t);
          const target = { x: mix(path.from.x, path.to.x, k), y: mix(path.from.y, path.to.y, k) + lift, z: mix(path.from.z, path.to.z, k) };
          Object.assign(planted, target);
          return target;
        });
      }
      if (p >= 1) { turn = null; return { ...result, bob: 0, roll: 0, headYaw: 0, headPitch: 0 }; }
      return result;
    },
  };
}
