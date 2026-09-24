import * as THREE from 'three';

/** Two shared short-lived lights, one discharge per hull (not per particle).
 * No shadow maps: small radius and front-surface offset limit light leakage. */
export function createContactLights(scene) {
  let low = false, reduced = false, disposed = false;
  const slots = Array.from({ length: 2 }, (_, i) => {
    const light = new THREE.PointLight('#a9dfff', 0, 2.1, 2);
    light.name = `FaultContactLight_${i}`; scene.add(light);
    return { light, age: 1, owner: null, key: null, force: 1 };
  });
  function extinguish(slot) { slot.age = 1; slot.owner = null; slot.light.intensity = 0; }
  function clearOwner(owner) { for (const slot of slots) if (owner == null || owner === slot.owner) extinguish(slot); }
  function visibility() { for (const slot of slots) slot.light.visible = !low && !reduced; }
  return {
    emit(player, key, force = 1) {
      const anchor = player?.damageAnchors?.[key];
      if (disposed || low || reduced || !anchor || !Number.isFinite(anchor.x + anchor.y + anchor.z)) return;
      const slot = slots.find(item => item.owner === player.id) || slots.find(item => item.owner == null) || slots.reduce((a, b) => a.age > b.age ? a : b);
      Object.assign(slot, { age: 0, owner: player.id, key, force: Math.min(1.5, Math.max(.2, force)) });
    },
    update(dt, players) {
      if (disposed) return;
      for (const slot of slots) {
        slot.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const anchor = players.find(player => player.id === slot.owner)?.damageAnchors?.[slot.key];
        if (!anchor || !Number.isFinite(anchor.x + anchor.y + anchor.z) || slot.age >= .15 || low || reduced) { extinguish(slot); continue; }
        slot.light.position.copy(anchor); slot.light.position.z += .10;
        const cooling = Math.max(0, 1 - slot.age / .15);
        slot.light.intensity = 9 * slot.force * cooling * cooling;
        slot.light.color.setRGB(.62 + .38 * (1 - cooling), .82 - .30 * (1 - cooling), 1 - .78 * (1 - cooling));
      }
    },
    clearOwner,
    setQuality(value) { low = value === 'low'; if (low) clearOwner(null); visibility(); },
    setReducedMotion(value) { reduced = Boolean(value); if (reduced) clearOwner(null); visibility(); },
    getStats() { return { contactLightCapacity: 2, contactLightsActive: slots.filter(slot => slot.light.intensity > 0).length }; },
    dispose() { if (disposed) return; disposed = true; for (const slot of slots) { slot.light.removeFromParent(); slot.light.dispose(); } },
  };
}
