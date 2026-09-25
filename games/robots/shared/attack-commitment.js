import { V5_ATTACKS, ULTIMATE_ARMOR } from './constants.js';

const routes = Object.freeze({ jab: 1, cross: 2, dashStrike: 1, airJab: 1, airCross: 2, heavyDrive: 1, heavyHook: 2 });
export function continuation(player = {}) {
  const stage = routes[player.variant];
  if (!stage || !['light', 'heavy'].includes(player.action)) return null;
  const attack = V5_ATTACKS[player.variant] || { startup: .13, active: .13, duration: .48 };
  const heavy = player.variant.startsWith('heavy');
  return { stage, heavy, open: attack.startup + attack.active + (heavy ? .12 : .035), close: attack.duration + .12 };
}
export function acceptsContinuation(player, action, crouch = false) {
  const route = continuation(player);
  return Boolean(route && !(action === 'heavy' && crouch) && (route.heavy ? action === 'heavy' : ['light', 'heavy'].includes(action)));
}
export function ultimateArmored(player, kind, variant, metadata = {}) {
  return Boolean(player?.hp > 0 && player.action === 'ultimate' && player.actionTime <= ULTIMATE_ARMOR.until
    && !metadata.throw && kind !== 'ultimate' && !ULTIMATE_ARMOR.breakers.includes(variant));
}
