import { assetUrl } from './app-paths.js';
import * as THREE from 'three';

// The original atlas already distinguishes blue enamel, bare alloy and worn
// edges. glTF packs perceptual roughness in G and metalness in B; factors below
// multiply those authored values, they do not replace a missing material map.
const SURFACE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'];
const SURFACE_ASSETS = [assetUrl('/assets/robot-surfaces/base-color-2048.webp'), assetUrl('/assets/robot-surfaces/metallic-roughness-1024.webp')];

// The GLB is always a complete fallback. A slow/failed optional image must not
// hold entry to a match indefinitely, or leak after its timeout has elapsed.
export function createRobotSurfaceAssetCache(loadTexture, timeoutMs = 1500) {
  let pending, cancelPending, loaded = null, disposed = false;
  function load() {
    if (disposed) return Promise.resolve(null);
    if (pending) return pending;
    pending = new Promise(resolve => {
      let finished = false, received = 0;
      const textures = [];
      const finish = value => {
        if (finished) return;
        finished = true; clearTimeout(timer); loaded = value; resolve(value);
        if (!value) textures.forEach(texture => texture?.dispose());
        textures.length = 0;
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      cancelPending = () => finish(null);
      SURFACE_ASSETS.forEach((url, index) => Promise.resolve().then(() => loadTexture(url)).then(texture => {
        if (finished || disposed) { texture.dispose(); finish(null); return; }
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
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending?.();
    if (loaded) { loaded.map.dispose(); loaded.roughnessMap.dispose(); loaded = null; }
  }
  return { load, dispose, get textures() { return loaded; } };
}

const assetCache = createRobotSurfaceAssetCache(url => new THREE.TextureLoader().loadAsync(url));
export const loadRobotSurfaceAssets = () => assetCache.load();

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

export function createRobotMaterialResources(surfaceAssets = assetCache.textures) {
  const textures = new Map();
  let reflection;
  let disposed = false;

  function privateTexture(source) {
    if (!source) return null;
    if (!textures.has(source)) {
      const texture = source.clone();
      texture.name = `${source.name || 'Automaton'}_Surface`;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      textures.set(source, texture);
    }
    return textures.get(source);
  }

  function cloneArmor(source, skin = 'amber') {
    if (disposed) throw new Error('Robot material resources have been disposed.');
    const material = source.clone();
    for (const slot of SURFACE_MAPS) material[slot] = privateTexture(surfaceAssets?.[slot] || source[slot]);
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
    for (const texture of textures.values()) texture.dispose();
    textures.clear();
    if (reflection) { releaseReflection(); reflection = null; }
  }

  return { cloneArmor, disposeTextures };
}
