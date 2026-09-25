import * as THREE from 'three';

/** Three r180's compileAsync polls forever and cannot be cancelled. Compile
 * once, retain this attempt's programs, then own the bounded readiness polling
 * so context loss/disposal cannot leave callbacks reading a disposed renderer. */
export function compileArenaPrograms(renderer, scene, camera, {signal, timeoutMs = 15000} = {}) {
  return new Promise((resolve,reject) => {
    let settled = false, poll, deadline;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(poll); clearTimeout(deadline);
      signal?.removeEventListener('abort',abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error('Подготовка графики отменена. Повтори попытку.'));
    if (signal?.aborted || renderer.getContext?.().isContextLost()) { abort(); return; }
    signal?.addEventListener('abort',abort,{once:true});
    deadline = setTimeout(() => finish(new Error('Подготовка графики затянулась. Повтори попытку.')),timeoutMs);
    try {
      const materials = renderer.compile(scene,camera);
      const programs = new Set([...materials].map(material => renderer.properties.get(material).currentProgram));
      const check = () => {
        if (settled) return;
        try {
          if (renderer.getContext?.().isContextLost()) { abort(); return; }
          for (const program of programs) {
            if (!program) throw new Error('Программа графики недоступна. Повтори попытку.');
            if (program.isReady()) programs.delete(program);
          }
          if (!programs.size) finish(); else poll = setTimeout(check,10);
        } catch (error) { finish(error); }
      };
      check();
    } catch (error) { finish(error); }
  });
}

/** Compile dormant effect/fragment materials and upload their textures before
 * accepting Ready. The throwaway framebuffer never reaches the player's screen.
 * Caller pauses the arena RAF while this transaction owns renderer state. */
export async function warmArenaGraphics({renderer, scene, camera, glow, onProgress = () => {}, signal, timeoutMs, excludedRoots = []}) {
  const visibility = new Map(), textures = new Set();
  const excluded = new Set(excludedRoots);
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace?.(), previousLevel = renderer.getActiveMipmapLevel?.();
  const target = new THREE.WebGLRenderTarget(64, 64);
  let restored = false;
  const assertActive = () => {
    if (signal?.aborted || renderer.getContext?.().isContextLost()) throw new Error('Подготовка графики отменена. Повтори попытку.');
  };
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [object,[visible,culled]] of visibility) { object.visible=visible; object.frustumCulled=culled; }
    // Abort cleanup is synchronous: arena.dispose() may release the renderer
    // immediately after aborting. A late promise must not touch it again.
    if (!renderer.getContext?.().isContextLost()) renderer.setRenderTarget(previousTarget,previousFace,previousLevel);
    target.dispose();
  };
  signal?.addEventListener('abort',restore,{once:true});
  try {
    assertActive();
    scene.traverse(object => {
      if (!object.material) return;
      // Lobby robots retain their own lights. Revealing them would compile a
      // four-robot light layout that the actual two-player fight never uses.
      for (let ancestor=object;ancestor;ancestor=ancestor.parent) if (excluded.has(ancestor)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      }
      // A hidden parent would still exclude dormant mines/overload/fragments
      // from the draw. Reveal each ancestor too, preserving its original state.
      // Light objects retain their own visibility and the fixed shader layout.
      for (let ancestor=object;ancestor;ancestor=ancestor.parent) {
        if (!visibility.has(ancestor)) visibility.set(ancestor,[ancestor.visible,ancestor.frustumCulled]);
        ancestor.visible=true; ancestor.frustumCulled=false;
      }
    });
    onProgress({kind:'graphics',loaded:0,total:3});
    for (const texture of textures) renderer.initTexture(texture);
    onProgress({kind:'graphics',loaded:1,total:3});
    await compileArenaPrograms(renderer,scene,camera,{signal,timeoutMs});
    assertActive();
    renderer.setRenderTarget(target);
    glow.render(scene, camera);
    onProgress({kind:'graphics',loaded:2,total:3});
    // Glow material proxies and shadow variants exist after the first draw.
    await compileArenaPrograms(renderer,scene,camera,{signal,timeoutMs});
    assertActive();
    onProgress({kind:'graphics',loaded:3,total:3});
    return {textures:textures.size,programs:renderer.info.programs.length};
  } finally {
    signal?.removeEventListener('abort',restore); restore();
  }
}

/** After reconnect/visibility gaps, consume old event IDs without replaying
 * their explosions, hit freezes or camera kicks. Snapshots still restore poses. */
export function shouldPresentCombatEvent({historical, hidden, phase} = {}) {
  return !historical && !hidden && ['fight','roundOver','finishing','matchOver'].includes(phase);
}
