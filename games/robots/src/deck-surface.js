import * as THREE from 'three';

// One metre of stone stays one metre throughout the room. The atlas wraps across
// complete, staggered courses; it does not end at the combat lane or wall posts.
export const DECK_SURFACE = Object.freeze({
  width: 16, depth: 8, maxWidth: 2048, minWidth: 1024,
});
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const wrap = (v, n) => ((v % n) + n) % n;
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function hash(x, y) {
  let v = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
}
// Periodic mineral clouds, not independent pixel noise. Weathering survives the
// phone mip chain while the fine aggregate disappears cleanly at a distance.
function cloud(u, v, cellsX, cellsZ) {
  const x = u * cellsX, z = v * cellsZ, ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(0, 1, x - ix), fz = smooth(0, 1, z - iz);
  return mix(mix(hash(wrap(ix, cellsX), wrap(iz, cellsZ)), hash(wrap(ix + 1, cellsX), wrap(iz, cellsZ)), fx),
    mix(hash(wrap(ix, cellsX), wrap(iz + 1, cellsZ)), hash(wrap(ix + 1, cellsX), wrap(iz + 1, cellsZ)), fx), fz);
}

export function stoneCourses() {
  const heights = [.92, 1.27, 1.08, .94, 1.33, 1.15, 1.31];
  let z = 0;
  return heights.map((height, row) => {
    const rng = random(373 + row * 1031), count = [9, 8, 10, 7, 9, 8, 10][row];
    const widths = Array.from({ length: count }, () => 1.2 + rng() * 1.2);
    const scale = 16 / widths.reduce((a, b) => a + b, 0);
    let x = 0;
    const stones = widths.map((raw, column) => {
      const width = raw * scale, tint = (rng() - .5) * 21;
      const stone = { x, width, tint, warm: (rng() - .5) * 8, seed: rng() * 19,
        crack: rng() < .38 ? { x: width * (.24 + rng() * .52), end: height * (.28 + rng() * .46), lean: (rng() - .5) * .5, fromTop: rng() < .5 } : null,
        scuff: rng() < .54 ? { x: width * (.2 + rng() * .6), z: height * (.25 + rng() * .5), w: .25 + rng() * .44, d: .04 + rng() * .07 } : null,
      };
      x += width;
      return stone;
    });
    const course = { z, height, offset: (row * .873) % 16, stones };
    z += height; return course;
  });
}

/** Authored stone bond, chipped mortar and accumulated wear; deterministic in Node and WebGL. */
export function rasterizeDeckSurface(requestedWidth = DECK_SURFACE.maxWidth) {
  const width = requestedWidth <= DECK_SURFACE.minWidth ? DECK_SURFACE.minWidth : DECK_SURFACE.maxWidth;
  const height = width / 2, albedo = new Uint8Array(width * height * 4), properties = new Uint8Array(albedo.length);
  const courses = stoneCourses();
  for (let j = 0; j < height; j++) {
    const z = (j + .5) / height * 8, v = z / 8;
    const course = courses.find(row => z < row.z + row.height) ?? courses.at(-1), pz = z - course.z;
    for (let i = 0; i < width; i++) {
      const x = (i + .5) / width * 16, u = x / 16;
      const cx = wrap(x - course.offset, 16);
      const stone = course.stones.find(s => cx < s.x + s.width) ?? course.stones.at(-1), px = cx - stone.x;
      const n = cloud(u, v, 32, 16), grain = cloud(u, v, 128, 64), fine = hash(i, j) - .5;
      const broad = cloud(u, v, 8, 4), flecks = cloud(u, v, 256, 128);
      // The quarried edges have shallow chips and a rubbed bevel. Joint width is
      // 14–30 mm, varied at a decimetre scale rather than a perfect black grid.
      const edge = Math.min(px, stone.width - px, pz, course.height - pz);
      const chip = Math.max(0, .53 - n) * .072 + Math.max(0, .46 - grain) * .040;
      const mortar = 1 - smooth(.008 + chip, .019 + chip, edge);
      const bevel = (1 - smooth(.022 + chip, .073 + chip, edge)) * (1 - mortar);
      const dust = (1 - smooth(.03, .20, edge)) * (1 - mortar);
      let fissure = 0, scuff = 0;
      if (stone.crack) {
        const c = stone.crack, dz = c.fromTop ? course.height - pz : pz;
        const kink = Math.sin(dz * 18 + stone.seed) * .008 + Math.sin(dz * 39) * .003;
        const distance = Math.abs(px - c.x - dz * c.lean - kink);
        fissure = (1 - smooth(.004, .016, distance)) * (1 - smooth(c.end * .7, c.end, dz));
      }
      if (stone.scuff) {
        const s = stone.scuff;
        scuff = (1 - smooth(.3, 1, Math.hypot((px - s.x) / s.w, (pz - s.z) / s.d))) * (.28 + grain * .30);
      }
      const soot = smooth(.54, .79, broad * .50 + n * .34 + grain * .16);
      const mineral = (n - .5) * 10 + (grain - .5) * 7 + (flecks - .5) * 2.5 + fine * .8;
      const tone = stone.tint * .72 + mineral - soot * 19 + bevel * 4 - dust * 3 + scuff * 11;
      const base = [56 + tone + stone.warm, 44 + tone + stone.warm * .28, 34 + tone - stone.warm * .45];
      const mortarTone = 23 + broad * 5 + grain * 4;
      const offset = (j * width + i) * 4;
      for (let channel = 0; channel < 3; channel++) albedo[offset + channel] = Math.round(mix(mix(base[channel], [41, 36, 30][channel], fissure * .87), mortarTone * [1.04, 1, .92][channel], mortar));
      albedo[offset + 3] = 255;
      // R is millimetre relief; G roughness; B metalness, always zero for stone.
      properties[offset] = Math.round(clamp(178 + (n - .5) * 18 + (flecks - .5) * 5 - mortar * 144 - bevel * 28 - fissure * 35, 0, 255));
      properties[offset + 1] = Math.round(clamp(.93 - scuff * .08 + dust * .025 + (grain - .5) * .04) * 255);
      properties[offset + 2] = 0; properties[offset + 3] = 255;
    }
  }
  return { width, height, albedo, properties };
}

/** Apply after world transforms; supports arbitrarily large contiguous room meshes. */
export function applyDeckUV(geometry) {
  const position = geometry.getAttribute('position'), uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / DECK_SURFACE.width + .5;
    uv[i * 2 + 1] = position.getZ(i) / DECK_SURFACE.depth + .5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geometry;
}

export function createDeckSurface({ resolution = DECK_SURFACE.maxWidth } = {}) {
  const raster = rasterizeDeckSurface(resolution);
  function texture(data, name, colorSpace) {
    const result = new THREE.DataTexture(data, raster.width, raster.height, THREE.RGBAFormat);
    Object.assign(result, { name, colorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, anisotropy: 8, needsUpdate: true });
    return result;
  }
  const color = texture(raster.albedo, 'club-quarried-stone-and-mortar', THREE.SRGBColorSpace);
  const surface = texture(raster.properties, 'club-stone-relief-and-roughness', THREE.NoColorSpace);
  const material = new THREE.MeshStandardMaterial({ name: 'Fight Club — worn limestone flags', map: color,
    bumpMap: surface, bumpScale: .018, vertexColors: true, roughnessMap: surface, roughness: 1, metalnessMap: surface, metalness: 0 });
  let disposed = false;
  return { material, textures: [color, surface], dispose() {
    if (disposed) return; disposed = true;
    material.dispose(); color.dispose(); surface.dispose();
  } };
}
