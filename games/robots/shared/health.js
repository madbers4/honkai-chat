/** Older review fixtures omit maxHp and keep their original 100-point scale. */
export function healthFraction(player = {}) {
  const maximum = Number.isFinite(player.maxHp) && player.maxHp > 0 ? player.maxHp : 100;
  const hp = Number.isFinite(player.hp) ? player.hp : maximum;
  return Math.max(0, Math.min(1, hp / maximum));
}
export const healthPercent = player => healthFraction(player) * 100;
