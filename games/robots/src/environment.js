import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createPaperPosters } from './posters.js';
import { createClubBoundaries } from './club-boundaries.js';
import { createClubFloor } from './club-floor.js';
import { ARENA_EDGE } from '../shared/constants.js';

export const ARENA_SET = Object.freeze({
  deckHalfWidth: Math.ceil((ARENA_EDGE + 2) / 2.3) * 2.3,
  floorWidth: 88, floorDepth: 84, wallHalfWidth: 32, wallHeight: 22,
});

/** Fight-club set: preserved source mural, real masonry, stone floor and closed storage bays. */
export function createIndustrialEnvironment(scene, wallpaper, deckSurface, posterTexture = null) {
  const group = new THREE.Group();
  group.name = 'Belobog — underground fight club';
  const owned = new Set();
  const keep = resource => { owned.add(resource); return resource; };
  const materials = {
    steel: new THREE.MeshStandardMaterial({ color: '#7e8b8e', roughness: .38, metalness: .78 }),
    iron: new THREE.MeshStandardMaterial({ color: '#26383e', roughness: .55, metalness: .64 }),
    black: new THREE.MeshStandardMaterial({ color: '#101d22', roughness: .76, metalness: .3 }),
    copper: new THREE.MeshStandardMaterial({ color: '#8b6245', roughness: .44, metalness: .7 }),
    brick: new THREE.MeshStandardMaterial({ color: '#3e3632', vertexColors: true, roughness: .98, metalness: 0 }),
    amber: new THREE.MeshStandardMaterial({ color: '#ffe4a2', emissive: '#ffb853', emissiveIntensity: 1.8, roughness: .3 }),
    cyan: new THREE.MeshStandardMaterial({ color: '#c1f3ef', emissive: '#56d9d7', emissiveIntensity: 1.8, roughness: .3 }),
  };
  materials.amber.userData.glowSource = materials.cyan.userData.glowSource = 'emissive';
  // The photograph already contains soot and subdued baked light. Continue that finish without
  // making the physically lit wings look like fresh, uniformly pink construction bricks.
  materials.brick.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vMasonryPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMasonryPosition = position;');
    shader.fragmentShader = `varying vec3 vMasonryPosition;
      float masonryHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float masonryNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(masonryHash(i), masonryHash(i + vec2(1, 0)), f.x),
          mix(masonryHash(i + vec2(0, 1)), masonryHash(i + vec2(1, 1)), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float soot = masonryNoise(vMasonryPosition.xy * vec2(2.8, 1.1));
      float chips = masonryNoise(vMasonryPosition.xy * 33.0);
      float runoff = masonryNoise(vMasonryPosition.xy * vec2(8.0, 0.32));
      diffuseColor.rgb *= (0.65 + 0.23 * soot + 0.12 * chips) * (0.78 + 0.22 * runoff);
    `);
  };
  materials.brick.customProgramCacheKey = () => 'belobog-weathered-masonry-v1';
  Object.values(materials).forEach(keep);
  const batches = new Map();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), pos = new THREE.Vector3();
  const unit = new THREE.Vector3(1, 1, 1), axisY = new THREE.Vector3(0, 1, 0);
  function add(geometry, finish, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    rotation.setFromEuler(new THREE.Euler(rx, ry, rz));
    geometry.applyMatrix4(matrix.compose(pos.set(x, y, z), rotation, unit));
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  const box = (w, h, d, finish, x, y, z, radius = .025, rz = 0) =>
    add(radius < .008 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), finish, x, y, z, 0, 0, rz);
  function cylinder(radius, length, finish, x, y, z, axis = 'y', radiusTop = radius, segments = 16) {
    add(new THREE.CylinderGeometry(radiusTop, radius, length, segments), finish, x, y, z,
      axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
  }
  function rod(from, to, radius, finish, segments = 10) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments);
    rotation.setFromUnitVectors(axisY, direction.normalize());
    geometry.applyMatrix4(matrix.compose(a.add(b).multiplyScalar(.5), rotation, unit));
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  const floor = createClubFloor({ deckSurface });
  group.add(floor.group);

  const ratio = wallpaper.image.width / wallpaper.image.height;
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(24, 24 / ratio)), keep(new THREE.MeshBasicMaterial({ map: wallpaper, color: '#a3a9aa', toneMapped: false })));
  wall.name = 'original-belobog-wall';
  wall.position.set(0, 12 / ratio - .16, -3.3); group.add(wall);
  // Camera-safe masonry wings sit behind the unscaled original mural. Real steel columns cover
  // the physical joins; an airborne zoom-out reveals architecture rather than a wallpaper edge.
  box(ARENA_SET.wallHalfWidth * 2, ARENA_SET.wallHeight, .16, 'black', 0, ARENA_SET.wallHeight / 2 - .2, -3.66, .001);
  for (let row = 0; row < Math.ceil((ARENA_SET.wallHeight - .2) / .36); row++) {
    const y = .20 + row * .36;
    for (let column = 0; column < 54; column++) {
      const x = -32 + column * 1.22 + (row % 2) * .61;
      // The central photograph already contains this masonry; avoid drawing covered brickwork.
      if (Math.abs(x) < 11.3 && y < 7.9) continue;
      const geometry = new THREE.BoxGeometry(1.18, .325, .12);
      const tint = new THREE.Color().setScalar(.75 + ((row * 17 + column * 13) % 19) / 65);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < geometry.attributes.position.count; i++) tint.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      add(geometry, 'brick', x, y, -3.52 - ((column * 3 + row) % 4) * .004);
    }
  }
  for (const side of [-1, 1]) {
    box(.26, 8.25, .24, 'iron', side * 12, 3.94, -3.29, .035);
    for (const y of [.45, 1.8, 3.2, 4.6, 6.0, 7.4]) {
      box(.34, .075, .30, 'steel', side * 12, y, -3.24, .012);
      cylinder(.032, .07, 'copper', side * 12, y, -3.055, 'z', .032, 6);
    }
    box(20, .63, .14, 'iron', side * 22, .22, -3.39, .025);
  }
  // A continuous lintel covers the photographed wall's upper termination.
  box(24.4, .26, .28, 'iron', 0, 7.83, -3.26, .025);
  box(24.5, .065, .32, 'steel', 0, 7.68, -3.245, .015);
  const boundaries = createClubBoundaries();
  group.add(boundaries.group);
  // Existing wall lamps retain their positions and authored colour temperatures.
  for (const side of [-1, 1]) {
    const tone = side < 0 ? 'amber' : 'cyan';
    // Cast lamp housing, inset diffuser and individual guard ribs.
    const lampX = side * 5.8;
    box(.91, .24, .42, 'iron', lampX, 4.82, -2.75, .065);
    box(.67, .1, .065, tone, lampX, 4.78, -2.52, .025);
    for (const dx of [-.35, -.18, 0, .18, .35]) rod([lampX + dx, 4.69, -2.46], [lampX + dx, 4.90, -2.46], .016, 'steel');
    for (const y of [4.69, 4.90]) rod([lampX - .38, y, -2.46], [lampX + .38, y, -2.46], .018, 'steel');
  }
  // Sagging supply cables span between physical anchor cleats.
  for (let j = 0; j < 3; j++) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-7.9, 4.85 + j * .08, -3.03), new THREE.Vector3(-3.6, 4.40 + j * .08, -3.06), new THREE.Vector3(1.4, 4.54 + j * .08, -3.07), new THREE.Vector3(7.9, 4.99 + j * .08, -3.02)]);
    add(new THREE.TubeGeometry(curve, 48, .018, 6, false), j === 2 ? 'copper' : 'black');
  }

  for (const [x,y] of [[-7.9,4.93],[7.9,5.07]]) {
    box(.12,.45,.12,'iron',x,y,-3.06,.015);
    for (const dy of [-.16,.16]) cylinder(.025,.10,'copper',x,y+dy,-2.97,'z',.025,6);
  }
  for (const [finish, geometries] of batches) {
    const compatible = geometries.map(item => item.index ? item.toNonIndexed() : item);
    const geometry = keep(mergeGeometries(compatible));
    compatible.forEach((item, index) => { if (item !== geometries[index]) item.dispose(); });
    geometries.forEach(item => item.dispose());
    geometry.name = `industrial-${finish}`;
    const mesh = new THREE.Mesh(geometry, materials[finish]);
    mesh.name = `industrial-${finish}`;
    mesh.receiveShadow = !['amber', 'cyan'].includes(finish);
    mesh.castShadow = !['amber', 'cyan', 'deck'].includes(finish);
    group.add(mesh);
  }
  const posters = createPaperPosters(posterTexture);
  if (posterTexture) group.add(posters.group);
  scene.add(group);
  return { group, dispose() { posters.dispose(); boundaries.dispose(); floor.dispose(); deckSurface.dispose(); scene.remove(group); for (const resource of owned) resource.dispose(); } };
}
