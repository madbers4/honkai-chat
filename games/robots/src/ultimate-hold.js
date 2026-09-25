import { ATTACKS } from '../shared/constants.js';
import { finishContext } from './action-context.js';

export function ultimateAvailability(state, playerId) {
  const player = state?.players?.find(p => p.id === playerId);
  const immediate = finishContext(state, playerId).canTrigger;
  const ready = Boolean(player && player.hp > 0 && state?.phase === 'fight'
    && player.energy >= ATTACKS.ultimate.energy && !(player.cooldowns?.ultimate > 0)
    && player.y <= .08 && !player.grabTarget && !player.grabbedBy && !(player.defenseOnly > 0)
    && ['idle', 'walk', 'crouch', 'block'].includes(player.action));
  return { ready, immediate, key: `${state?.room ?? ''}:${state?.round ?? ''}:${state?.phase ?? ''}:${playerId}` };
}

/** A physical press commits immediately, once. Invalid presses are consumed too:
 * gaining energy or leaving stun while a key is held must never auto-fire. */
export function createUltimatePress({ availability, commit, progress = () => {} }) {
  let owner = null;
  function cancel() { owner = null; progress({ active: false, amount: 0 }); }
  function begin(source) {
    if (owner !== null) return false;
    owner = source;
    const state = availability();
    if (!state.ready && !state.immediate) return false;
    progress({ active: false, amount: 1, committed: true });
    commit(); return true;
  }
  return { begin, update() {}, cancel, release(source) { if (owner === source) cancel(); }, active: () => false };
}

// Public compatibility for integrations that still import the previous name.
export const createUltimateHold = createUltimatePress;
