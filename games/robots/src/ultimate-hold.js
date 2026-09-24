import { ATTACKS, ULTIMATE_HOLD_SECONDS } from '../shared/constants.js';
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

/** Edge-triggered hold: a cancelled press cannot resume itself after a hit,
 * reconnect or round change. Each physical pointer/key press fires at most once. */
export function createUltimateHold({ availability, commit, progress = () => {}, now = () => performance.now(), duration = ULTIMATE_HOLD_SECONDS * 1000 }) {
  let owner = null, started = 0, key = null, fired = false;
  function cancel() { owner = null; fired = false; key = null; progress({ active: false, amount: 0 }); }
  function begin(source) {
    if (owner !== null) return false;
    const state = availability();
    if (state.immediate) { commit(); return true; }
    if (!state.ready) return false;
    owner = source; started = now(); key = state.key; fired = false;
    progress({ active: true, amount: 0 }); return true;
  }
  function update() {
    if (owner === null || fired) return;
    const state = availability();
    if (!state.ready || state.key !== key) { cancel(); return; }
    const amount = Math.min(1, Math.max(0, (now() - started) / duration));
    progress({ active: true, amount });
    if (amount >= 1) { fired = true; progress({ active: false, amount: 1, committed: true }); commit(); }
  }
  return { begin, update, cancel, release(source) { if (owner === source) cancel(); }, active: () => owner !== null && !fired };
}
