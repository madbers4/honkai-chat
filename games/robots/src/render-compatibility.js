import * as THREE from 'three';
import { ArenaLoadError } from './asset-loading.js';

export function graphicsFailure(code, message, cause) {
  const error = new ArenaLoadError('graphics', message, cause); error.code = code; return error;
}

export async function prepareWithGraphicsFallback(warm, { canRetry, onRetry }) {
  try { return await warm(); }
  catch (error) {
    if (error.kind !== 'graphics' || error.code === 'GL_CONTEXT' || !canRetry()) throw error;
    onRetry(error);
    return warm(); // Exactly one retry; rejection is returned to preparation UI.
  }
}

/** Retry only an actual context creation failure. This is not a phone/UA tier. */
export function createReliableRenderer(create = options => new THREE.WebGLRenderer(options)) {
  try { return create({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (firstError) {
    try { return create({ antialias: false, alpha: false, powerPreference: 'default' }); }
    catch (cause) { throw graphicsFailure('GL_INIT', 'WebGL2 context creation failed with both configurations', { firstError, cause }); }
  }
}

const floatSupport = new WeakMap();
/** PMREM and glow both require a *renderable* RGBA16F attachment, not just
 * half-float sampling. Some mobile drivers expose an extension but reject the
 * actual framebuffer. Probe once per context; retain no GPU allocation. */
export function supportsFloatTargets(renderer, refresh = false) {
  if (!refresh && floatSupport.has(renderer)) return floatSupport.get(renderer);
  const declared = renderer.extensions.has('EXT_color_buffer_float')
    || renderer.extensions.has('EXT_color_buffer_half_float');
  let supported = declared;
  const gl = renderer.getContext?.();
  if (declared && gl?.checkFramebufferStatus) {
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace?.(), level = renderer.getActiveMipmapLevel?.();
    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    try {
      renderer.setRenderTarget(target);
      supported = !gl.isContextLost() && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    } catch { supported = false; }
    finally { renderer.setRenderTarget(previous, face, level); target.dispose(); }
  }
  floatSupport.set(renderer, supported);
  return supported;
}

export function checkRenderTarget(renderer) {
  const gl = renderer.getContext?.();
  if (gl?.checkFramebufferStatus && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw graphicsFailure('GL_TARGET', 'Драйвер не смог создать буфер изображения (GL_TARGET).');
  }
}

/** Three's default shader failure only logs to the console, and compile/isReady
 * can still look successful. Surface that failure at the actual draw boundary. */
export function guardShaderErrors(renderer) {
  const previous = renderer.debug.onShaderError;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const details = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)]
      .filter(Boolean).join('\n').slice(0, 2000);
    throw graphicsFailure('GL_SHADER', 'Графический драйвер не смог собрать изображение (GL_SHADER).', new Error(details || 'no driver diagnostic'));
  };
  return () => { renderer.debug.onShaderError = previous; };
}

/** Keep the authored meshes and surface textures. Only the unsupported HDR
 * reflection is removed; Three otherwise creates a HalfFloat PMREM target even
 * when the separate glow pipeline has correctly disabled itself. */
export function omitUnsupportedReflections(root, supported) {
  if (supported) return;
  root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material?.isMeshStandardMaterial || !material.envMap) continue;
      material.envMap = null; material.needsUpdate = true;
    }
  });
}

export function changedDrawingSize(previous, next) {
  return ['width', 'height', 'pixelRatio'].some(key => Math.abs(previous[key] - next[key]) > .001);
}
