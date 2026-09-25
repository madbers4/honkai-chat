import { assetUrl } from './app-paths.js';
import * as THREE from 'three';

// The original atlas already distinguishes blue enamel, bare alloy and worn
// edges. glTF packs perceptual roughness in G and metalness in B; factors below
// multiply those authored values, they do not replace a missing material map.
const SURFACE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'];
const SURFACE_ASSETS = [assetUrl('/assets/robot-surfaces/base-color-2048.webp'), assetUrl('/assets/robot-surfaces/metallic-roughness-1024.webp')];

// Entry can use the complete GLB after 1.5s. HD images still get one bounded
// opportunity to upgrade live robots; neither fallback nor failure starts retries.
export function createRobotSurfaceAssetCache(loadTexture, timeoutMs = 1500, deadlineMs = 15000) {
  let pending, cancelPending, loaded = null, disposed = false, terminal = false;
  const listeners = new Set();
  function load() {
    if (disposed) return Promise.resolve(null);
    if (loaded) return Promise.resolve(loaded);
    if (pending) return pending;
    pending = new Promise(resolve => {
      let bootResolved = false, received = 0;
      const textures = [], controller = new AbortController();
      const resolveBoot = value => {
        if (bootResolved) return;
        bootResolved = true; clearTimeout(bootTimer); resolve(value);
      };
      const finish = value => {
        if (terminal) return;
        terminal = true; clearTimeout(bootTimer); clearTimeout(deadlineTimer);
        loaded = value; resolveBoot(value);
        if (!value) {
          controller.abort();
          for (const texture of new Set(textures)) texture?.dispose();
        }
        textures.length = 0;
        if (value) for (const listener of [...listeners]) {
          if (disposed) break;
          if (listeners.delete(listener)) listener(value);
        }
        listeners.clear(); cancelPending = undefined;
      };
      const bootTimer = setTimeout(() => resolveBoot(null), Math.max(0, timeoutMs));
      const deadlineTimer = setTimeout(() => finish(null), Math.max(timeoutMs, deadlineMs));
      cancelPending = () => finish(null);
      SURFACE_ASSETS.forEach((url, index) => Promise.resolve().then(() => {
        if (terminal || disposed) return null;
        return loadTexture(url, { signal: controller.signal });
      }).then(texture => {
        if (!texture) { finish(null); return; }
        if (terminal || disposed) { texture.dispose(); return; }
        textures[index] = texture;
        if (++received === 2) {
          const [map, packed] = textures;
          map.colorSpace = THREE.SRGBColorSpace;
          packed.colorSpace = THREE.NoColorSpace;
          for (const image of textures) {
            image.flipY = false; image.wrapS = image.wrapT = THREE.RepeatWrapping;
            image.minFilter = THREE.LinearMipmapLinearFilter; image.magFilter = THREE.LinearFilter;
            image.generateMipmaps = true; image.needsUpdate = true;
          }
          map.name = 'Automaton_BaseColor_2048'; packed.name = 'Automaton_MetallicRoughness_1024';
          finish({ map, roughnessMap: packed, metalnessMap: packed });
        }
      }, () => finish(null)));
    });
    return pending;
  }
  function subscribe(listener) {
    if (disposed) return () => {};
    if (loaded) { listener(loaded); return () => {}; }
    if (terminal) return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; listeners.clear(); cancelPending?.();
    if (loaded) { loaded.map.dispose(); loaded.roughnessMap.dispose(); loaded = null; }
  }
  return { load, subscribe, dispose, get textures() { return loaded; } };
}

// TextureLoader's ordinary HTML-image request has no abort method. Keep its
// loadAsync contract, but detach and cancel our two optional images at deadline.
class CancellableSurfaceLoader extends THREE.TextureLoader {
  constructor(signal) { super(); this.signal = signal; }
  load(url, onLoad, _onProgress, onError) {
    const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
    const texture = new THREE.Texture(), signal = this.signal;
    let finished = false;
    const cleanup = () => {
      image.onload = image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const fail = error => {
      if (finished) return;
      finished = true; cleanup(); image.removeAttribute('src'); texture.dispose(); onError?.(error);
    };
    const abort = () => fail(signal.reason ?? new Error('Surface image request cancelled.'));
    image.onload = () => {
      if (finished) return;
      finished = true; cleanup(); texture.image = image; texture.needsUpdate = true; onLoad?.(texture);
    };
    image.onerror = () => fail(new Error('Optional robot surface image could not load.'));
    image.crossOrigin = this.crossOrigin;
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
    return texture;
  }
}
const assetCache = createRobotSurfaceAssetCache((url, { signal }) => new CancellableSurfaceLoader(signal).loadAsync(url));
export const loadRobotSurfaceAssets = (cache = assetCache) => cache.load();

let sharedReflection = null, reflectionUsers = 0;
function acquireReflection() {
  if (!sharedReflection) {
    // A small, smooth industrial-room reflection, not a new light source. The
    // arena has direct lights but no environment: fully metallic surfaces need
    // reflected surroundings or their broad front planes become black. Keep
    // this probe on armour only. Three caches its roughness-filtered PMREM.
    const width = 128, height = 64, data = new Uint16Array(width * height * 4);
    const key = new THREE.Vector3(-3, 7, 5).normalize();
    const rim = new THREE.Vector3(3, 4, -4).normalize();
    const front = new THREE.Vector3(0, .6, 1).normalize();
    const direction = new THREE.Vector3();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const latitude = (y + .5) / height * Math.PI;
      const longitude = ((x + .5) / width - .5) * Math.PI * 2;
      direction.set(Math.cos(longitude) * Math.sin(latitude), -Math.cos(latitude), Math.sin(longitude) * Math.sin(latitude));
      const ceiling = THREE.MathUtils.smoothstep(direction.y, -.35, .75);
      const warm = Math.pow(Math.max(0, direction.dot(key)), 8);
      const cold = Math.pow(Math.max(0, direction.dot(rim)), 12);
      const aperture = Math.pow(Math.max(0, direction.dot(front)), 16);
      const rgb = [
        .045 + ceiling * .17 + warm * 1.2 + cold * .42 + aperture * .48,
        .055 + ceiling * .18 + warm * 1.04 + cold * .7 + aperture * .51,
        .065 + ceiling * .19 + warm * .81 + cold * .92 + aperture * .52,
      ];
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = THREE.DataUtils.toHalfFloat(rgb[channel]);
      data[offset + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    sharedReflection = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    sharedReflection.name = 'Automaton_IndustrialReflection';
    sharedReflection.mapping = THREE.EquirectangularReflectionMapping;
    sharedReflection.colorSpace = THREE.LinearSRGBColorSpace;
    sharedReflection.minFilter = sharedReflection.magFilter = THREE.LinearFilter;
    sharedReflection.needsUpdate = true;
  }
  reflectionUsers++;
  return sharedReflection;
}

function releaseReflection() {
  if (--reflectionUsers === 0) { sharedReflection.dispose(); sharedReflection = null; }
}

export function createRobotMaterialResources(surfaceAssets, { cache = assetCache } = {}) {
  const progressive = surfaceAssets === undefined;
  surfaceAssets = progressive ? cache?.textures : surfaceAssets;
  const textures = new Map(), upgradeSlots = new Map();
  let reflection;
  let disposed = false;

  function privateTexture(source, slot) {
    if (!source) return null;
    if (!textures.has(source)) {
      const texture = source.clone();
      texture.name = `${source.name || 'Automaton'}_Surface`;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      textures.set(source, texture);
      if (slot !== 'normalMap') upgradeSlots.set(texture, slot);
    }
    return textures.get(source);
  }

  function upgrade(assets) {
    if (disposed) return;
    surfaceAssets = assets;
    for (const [texture, slot] of upgradeSlots) {
      const incoming = assets[slot];
      if (!incoming || texture.image === incoming.image) continue;
      // WebGL2 storage has fixed dimensions. Retire the old GPU allocation while
      // it still refers to the old Source; the same wrapper is then re-uploaded.
      // Fragment material clones keep seeing this wrapper without being tracked.
      texture.dispose();
      texture.source = new THREE.Source(incoming.image);
      for (const property of ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment', 'format', 'type']) texture[property] = incoming[property];
      texture.name = incoming.name + '_Surface'; texture.anisotropy = 4; texture.needsUpdate = true;
      textures.set(incoming, texture);
    }
  }
  const unsubscribe = progressive ? cache?.subscribe(upgrade) : null;

  function cloneArmor(source, skin = 'amber') {
    if (disposed) throw new Error('Robot material resources have been disposed.');
    const material = source.clone();
    for (const slot of SURFACE_MAPS) material[slot] = privateTexture(surfaceAssets?.[slot] || source[slot], slot);
    material.color.set(skin === 'cyan' ? 0xd3ecff : 0xffedcf);
    // The original B channel has 0 on paint and 1 on exposed metal. Multiplying
    // it by .74 turned every bare joint into a fictional half-metal surface.
    material.metalness = 1;
    // Preserve the authored satin finish instead of multiplying every roughness
    // value by .86, which disproportionately polished the darker enamel panels.
    material.roughness = 1;
    reflection ||= acquireReflection();
    material.envMap = reflection;
    material.envMapIntensity = .72;
    material.emissive = new THREE.Color(0);
    return material;
  }

  // Materials belong to the robot and are also cloned by its real fragments.
  // Keep their texture copies alive until all those materials are disposed.
  function disposeTextures() {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    for (const texture of new Set(textures.values())) texture.dispose();
    textures.clear(); upgradeSlots.clear();
    if (reflection) { releaseReflection(); reflection = null; }
  }

  return { cloneArmor, disposeTextures };
}
