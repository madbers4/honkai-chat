import * as THREE from 'three';

// One authored patch covers the six real 2.3 m panels across the ring. It contains
// no printed seams: the gaps, fasteners and bevels belong to environment geometry.
export const DECK_SURFACE = Object.freeze({
  width: 13.8, depth: 6.9, panelWidth: 2.3, panelDepth: 1.06,
  firstCenterX: -5.76, rowCenters: Object.freeze([-1.59, -.53, .53, 1.59]),
  maxWidth: 1024, minWidth: 512,
});

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const fract = n => n - Math.floor(n);
const noise = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);

function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function makeWear() {
  const panels = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 6; column++) {
    const rng = random(809 + row * 671 + column * 1013);
    const strokes = [], patches = [];
    // Contact paths follow the duel, with interruptions between passes. The back
    // service row is quieter; neither painted racing stripes nor global dirt.
    for (let i = 0, count = row === 0 ? 3 : 11; i < count; i++) {
      const x = -.86 + rng() * 1.6, z = -.30 + rng() * .60;
      const length = .09 + rng() * .78;
      strokes.push({ x, z, length, angle: (rng() - .5) * .16, radius: .005 + rng() ** 2 * .036, strength: .16 + rng() * .48 });
    }
    if (row === 1 || row === 2) for (let i = 0, count = rng() > .5 ? 2 : 1; i < count; i++) {
      patches.push({ x: -.62 + rng() * 1.1, z: -.22 + rng() * .44, length: .20 + rng() * .43,
        width: .04 + rng() * .10, angle: (rng() - .5) * .20, strength: .15 + rng() * .24 });
    }
    // Oxide starts near selected plate edges. Broad, broken patches echo the
    // supplied Fight Club reference; they do not become a repeating rust grid.
    const rust = rng() < (row === 0 || row === 3 ? .85 : .38) ? {
      x: (rng() > .5 ? 1 : -1) * (.45 + rng() * .30), z: (rng() > .5 ? 1 : -1) * (.24 + rng() * .16),
      length: .32 + rng() * .38, depth: .18 + rng() * .19, strength: .70 + rng() * .24,
    } : null;
    panels.push({ tint: (rng() - .5) * 5, roughness: (rng() - .5) * .034, strokes, patches, rust, oil: Math.floor(rng() * 5), chip: rng() > .5 });
  }
  return panels;
}

/** Deterministic raster generation also runs without DOM in the material tests. */
export function rasterizeDeckSurface(requestedWidth = DECK_SURFACE.maxWidth) {
  // Exactly two POT budgets; switching gameplay quality never redraws canvases.
  const width = requestedWidth <= DECK_SURFACE.minWidth ? DECK_SURFACE.minWidth : DECK_SURFACE.maxWidth;
  const height = width / 2;
  const albedo = new Uint8Array(width * height * 4);
  const properties = new Uint8Array(width * height * 4);
  const panels = makeWear();
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = ((i + .5) / width - .5) * DECK_SURFACE.width;
    const z = ((j + .5) / height - .5) * DECK_SURFACE.depth;
    const column = Math.floor((x + 6.91) / DECK_SURFACE.panelWidth);
    const row = Math.floor((z + 2.12) / DECK_SURFACE.panelDepth);
    const onDeck = column >= 0 && column < 6 && row >= 0 && row < 4;
    let wear = 0, oil = 0, rust = 0, tint = 0, roughVariation = 0;
    // Low amplitude, submillimetre mill finish. The mip chain removes fine grain
    // in the phone view rather than leaving the former bright pixel confetti.
    const grain = (noise(i, j) - .5) * 1.35;
    const broad = Math.sin(x * 1.8 + Math.sin(z * 2.3)) * 1.1;
    if (onDeck) {
      const panel = panels[row * 6 + column];
      const px = x - (DECK_SURFACE.firstCenterX + column * DECK_SURFACE.panelWidth);
      const pz = z - DECK_SURFACE.rowCenters[row];
      tint = panel.tint;
      roughVariation = panel.roughness + Math.sin(x * 2.2 + z * 3.1) * .012;
      const edgeDistance = Math.min(1.1375 - Math.abs(px), .5175 - Math.abs(pz));
      if (panel.rust && edgeDistance >= 0) {
        const mark = panel.rust;
        const distance = Math.hypot((px - mark.x) / mark.length, (pz - mark.z) / mark.depth);
        const brokenEdge = Math.sin(px * 19 + pz * 11) * .09 + Math.sin(px * 38 - pz * 17) * .07 + Math.sin(px * 9 + pz * 25) * .10;
        rust = (1 - smooth(.44, .98, distance + brokenEdge)) * mark.strength;
        rust *= .76 + .24 * smooth(-.4, .6, Math.sin(px * 29 + pz * 7) * Math.cos(pz * 23));
      }
      // Worn paint sits on the actual 23 mm bevel; it never draws a second grid.
      const edgeWear = (1 - smooth(.005, .033, edgeDistance)) * .42;
      wear = edgeDistance >= 0 ? edgeWear * (.58 + .42 * noise(Math.floor(x * 38), Math.floor(z * 38))) : 0;
      for (const mark of panel.patches) {
        const ox = px - mark.x, oz = pz - mark.z - ox * mark.angle;
        const distance = Math.hypot(ox / mark.length, oz / mark.width);
        const patch = (1 - smooth(.22, 1, distance)) * mark.strength;
        wear = Math.max(wear, patch * (.86 + .14 * Math.sin(oz * 95 + ox * 11)));
      }
      for (const mark of panel.strokes) {
        const t = clamp((px - mark.x) / mark.length);
        const closestX = mark.x + t * mark.length;
        const closestZ = mark.z + (t - .5) * mark.angle;
        const distance = Math.hypot(px - closestX, pz - closestZ);
        const scratch = 1 - smooth(mark.radius * .25, mark.radius, distance);
        wear = Math.max(wear, scratch * mark.strength * Math.sin(.12 + t * Math.PI * .90));
      }
      if (panel.oil < 4) {
        const bx = panel.oil % 2 ? .98 : -.98, bz = panel.oil < 2 ? -.37 : .37;
        const radial = Math.hypot((px - bx) * .88, (pz - bz) * 1.22);
        // A restrained, dry halo around a selected real fastener, not a puddle.
        oil = (1 - smooth(.032, .105, radial)) * .26;
      }
      if (panel.chip) {
        const chip = 1 - smooth(.012, .025, Math.hypot((px + .54) * .4, pz - .503));
        wear = Math.max(wear, chip * .72);
      }
    }
    const base = [34 + tint + broad + grain, 36 + tint + broad + grain, 37 + tint + broad + grain];
    const steel = [94, 100, 98], oxide = [67 + broad * 2, 40 + broad, 25 + broad];
    const index = (j * width + i) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const rubbed = mix(base[channel], steel[channel], wear * .66);
      albedo[index + channel] = Math.round(mix(rubbed, oxide[channel], rust) * (1 - oil));
    }
    albedo[index + 3] = 255;
    // R = microheight, G = roughness, B = metalness. Shared by all three slots.
    properties[index] = Math.round(128 + grain * 7 - wear * 9 + rust * 8);
    properties[index + 1] = Math.round(mix(mix(.79 + roughVariation, .52, wear), .96, rust) * 255);
    properties[index + 2] = Math.round(mix(mix(.13, .78, wear), .03, rust) * 255);
    properties[index + 3] = 255;
  }
  return { width, height, albedo, properties };
}

/** Apply after world transforms, before merging. A metre remains a metre on every panel. */
export function applyDeckUV(geometry) {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / DECK_SURFACE.width + .5;
    uv[i * 2 + 1] = position.getZ(i) / DECK_SURFACE.depth + .5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function createDeckSurface({ resolution = DECK_SURFACE.maxWidth } = {}) {
  const raster = rasterizeDeckSurface(resolution);
  function texture(data, name, colorSpace) {
    const result = new THREE.DataTexture(data, raster.width, raster.height, THREE.RGBAFormat);
    result.name = name;
    result.colorSpace = colorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 4;
    result.needsUpdate = true;
    return result;
  }
  const color = texture(raster.albedo, 'deck-paint-and-worn-steel', THREE.SRGBColorSpace);
  const surface = texture(raster.properties, 'deck-height-roughness-metalness', THREE.NoColorSpace);
  const material = new THREE.MeshStandardMaterial({
    name: 'service-deck — painted steel with contact wear',
    map: color, bumpMap: surface, bumpScale: .002,
    roughnessMap: surface, roughness: 1, metalnessMap: surface, metalness: 1,
  });
  let disposed = false;
  return { material, textures: [color, surface], dispose() {
    if (disposed) return;
    disposed = true;
    material.dispose(); color.dispose(); surface.dispose();
  } };
}
