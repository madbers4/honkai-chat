import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { supportsFloatTargets, checkRenderTarget } from './render-compatibility.js';

/** The bloom buffer only contains declared emitters; bright paper, paint and
 * specular highlights never enter it. Depth-writing black proxies retain the
 * real scene's occlusion, including articulated/skinned/instanced geometry.
 * The normal scene keeps its existing per-material tone mapping. The extra
 * buffer is linear HDR, blurred before a bounded optical glare display pass.
 */
export function glowSize(width, height, dpr = 1) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const scale = Math.min(.5 * Math.max(1, Math.min(1.5, dpr || 1)), 960 / Math.max(w, h));
  return { width: Math.max(1, Math.ceil(w * scale)), height: Math.max(1, Math.ceil(h * scale)) };
}

export function createEmissionGlow(renderer, { onFailure = console.warn } = {}) {
  let supported = supportsFloatTargets(renderer);
  let quality = 'high', reduced = false, enabled = true, disposed = false, lost = false;
  let failed = !supported, resources = null, targetsValidated = false, width = 1, height = 1, dpr = 1;
  const originals = [], proxies = new Map();
  const black = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
  const background = new THREE.Color(0);
  const quad = new FullScreenQuad();
  const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const blur = new THREE.ShaderMaterial({
    uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
    vertexShader, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `uniform sampler2D source;uniform vec2 step;varying vec2 vUv;
      void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
        c+=(texture2D(source,vUv+step*1.384615).rgb+texture2D(source,vUv-step*1.384615).rgb)*.316216;
        c+=(texture2D(source,vUv+step*3.230769).rgb+texture2D(source,vUv-step*3.230769).rgb)*.070270;
        gl_FragColor=vec4(c,1.0);}`,
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: { source: { value: null }, strength: { value: .22 }, exposure: { value: 1 } },
    vertexShader, depthTest: false, depthWrite: false, transparent: true,
    // Screen compositing is bounded (never a white additive plateau), as a
    // camera's small optical veil. The underlying scene has already received
    // its own tone mapping + sRGB transform; do not transform it a second time.
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor,
    toneMapped: false,
    fragmentShader: `uniform sampler2D source;uniform float strength,exposure;varying vec2 vUv;
      vec3 linearToDisplay(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
      void main(){vec3 radiance=max(vec3(0.0),texture2D(source,vUv).rgb)*exposure;
        // Luminance-preserving compression retains green/amber/red signal hue.
        float peak=max(radiance.r,max(radiance.g,radiance.b));
        vec3 glare=radiance/(1.0+peak)*strength;
        gl_FragColor=vec4(linearToDisplay(glare),1.0);}`,
  });

  function releaseTargets() {
    if (!resources) return;
    for (const target of Object.values(resources)) target.dispose();
    resources = null;
    targetsValidated = false;
  }
  function allocate() {
    if (failed || disposed || lost || quality === 'low' || !enabled) return;
    if (!resources) {
    const size = glowSize(width, height, dpr);
    const target = depthBuffer => new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    resources = { emission: target(true), horizontal: target(false), vertical: target(false) };
    for (const [name, value] of Object.entries(resources)) value.texture.name = `emission-glow-${name}`;
    }
    if (!targetsValidated) {
      const previous = renderer.getRenderTarget();
      try { for (const target of Object.values(resources)) { renderer.setRenderTarget(target); checkRenderTarget(renderer); } }
      finally { renderer.setRenderTarget(previous); }
      targetsValidated = true;
    }
  }
  function proxyFor(material) {
    if (material.userData.glowSource !== 'emissive') return material;
    let entry = proxies.get(material);
    if (!entry) {
      const proxy = new THREE.MeshBasicMaterial({ side: material.side,
        transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite,
        map: material.emissiveMap, toneMapped: false });
      const release = () => { proxy.dispose(); material.removeEventListener('dispose', release); proxies.delete(material); };
      entry = { proxy, release }; proxies.set(material, entry); material.addEventListener('dispose', release);
    }
    entry.proxy.color.copy(material.emissive).multiplyScalar(material.emissiveIntensity * 2.3);
    entry.proxy.opacity = material.opacity;
    return entry.proxy;
  }
  function prepare(scene) {
    scene.traverseVisible(object => {
      if (!object.material || (!object.isMesh && !object.isSprite && !object.isPoints && !object.isLine)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const emitting = materials.some(material => material.userData?.glowSource);
      originals.push({ object, material: object.material, visible: object.visible });
      if (!emitting && materials.every(material => material.transparent || material.depthWrite === false)) {
        object.visible = false; return;
      }
      const replacement = materials.map(material => material.userData?.glowSource ? proxyFor(material) : black);
      object.material = Array.isArray(object.material) ? replacement : replacement[0];
    });
  }
  function restore() {
    for (const entry of originals) { entry.object.material = entry.material; entry.object.visible = entry.visible; }
    originals.length = 0;
  }
  function drawPass(material, target) { quad.material = material; renderer.setRenderTarget(target); quad.render(renderer); }
  function onLost() { lost = true; releaseTargets(); }
  function onRestored() { lost = false; supported = supportsFloatTargets(renderer, true); failed = !supported; }
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);

  return {
    render(scene, camera) {
      if (disposed || lost) return;
      renderer.render(scene, camera);
      if (!enabled || failed || quality === 'low') return;
      const saved = { target: renderer.getRenderTarget(), background: scene.background, fog: scene.fog,
        autoClear: renderer.autoClear, shadow: renderer.shadowMap.autoUpdate };
      try {
        allocate(); if (!resources) return;
        prepare(scene); scene.background = background; scene.fog = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(resources.emission); renderer.autoClear = true;
        renderer.render(scene, camera);
        restore(); scene.background = saved.background; scene.fog = saved.fog;
        const w = resources.emission.width, h = resources.emission.height;
        blur.uniforms.source.value = resources.emission.texture;
        blur.uniforms.step.value.set(1.8 / w, 0); drawPass(blur, resources.horizontal);
        blur.uniforms.source.value = resources.horizontal.texture;
        blur.uniforms.step.value.set(0, 1.8 / h); drawPass(blur, resources.vertical);
        composite.uniforms.source.value = resources.vertical.texture;
        composite.uniforms.strength.value = reduced ? .045 : .17;
        composite.uniforms.exposure.value = renderer.toneMappingExposure;
        renderer.autoClear = false; drawPass(composite, saved.target);
      } catch (error) {
        failed = true; releaseTargets();
        onFailure('Local emission glow disabled; direct rendering remains available.', error);
      } finally {
        restore(); scene.background = saved.background; scene.fog = saved.fog;
        renderer.autoClear = saved.autoClear; renderer.shadowMap.autoUpdate = saved.shadow;
        renderer.setRenderTarget(saved.target);
      }
    },
    resize(w, h, ratio = 1) {
      width = w; height = h; dpr = ratio;
      targetsValidated = false;
      if (resources) { const size = glowSize(width, height, dpr); for (const target of Object.values(resources)) target.setSize(size.width, size.height); }
    },
    setQuality(value) { quality = value === 'low' ? 'low' : 'high'; if (quality === 'low') releaseTargets(); },
    setReducedMotion(value) { reduced = Boolean(value); },
    setEnabled(value) { enabled = Boolean(value); if (!enabled) releaseTargets(); },
    getStats() { return { enabled: enabled && !disposed && !failed && !lost && quality !== 'low', quality, reduced,
      targets: resources ? 3 : 0, ...glowSize(width, height, dpr), sourceMaterials: proxies.size, failed }; },
    dispose() {
      if (disposed) return; disposed = true; restore(); releaseTargets();
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      for (const entry of [...proxies.values()]) entry.release();
      black.dispose(); blur.dispose(); composite.dispose(); quad.dispose();
    },
  };
}
