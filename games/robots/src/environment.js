import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createPaperPosters } from './posters.js';
import { createPressureReservoirs } from './pressure-reservoir.js';
import { applyDeckUV } from './deck-surface.js';

/** Authored industrial set: merged by finish, real rounded plumbing and open deck grates. */
export function createIndustrialEnvironment(scene, wallpaper, deckSurface, posterTexture = null) {
  const group = new THREE.Group();
  group.name = 'Belobog — pressure plant and service deck';
  const owned = new Set();
  const keep = resource => { owned.add(resource); return resource; };
  const materials = {
    deck: deckSurface.material,
    panel: new THREE.MeshStandardMaterial({ color: '#46565c', roughness: .55, metalness: .55 }),
    steel: new THREE.MeshStandardMaterial({ color: '#7e8b8e', roughness: .38, metalness: .78 }),
    iron: new THREE.MeshStandardMaterial({ color: '#26383e', roughness: .55, metalness: .64 }),
    black: new THREE.MeshStandardMaterial({ color: '#101d22', roughness: .76, metalness: .3 }),
    copper: new THREE.MeshStandardMaterial({ color: '#8b6245', roughness: .44, metalness: .7 }),
    worn: new THREE.MeshStandardMaterial({ color: '#807849', roughness: .73, metalness: .3 }),
    red: new THREE.MeshStandardMaterial({ color: '#923d31', roughness: .47, metalness: .52 }),
    glass: new THREE.MeshStandardMaterial({ color: '#bbc8bc', roughness: .2, metalness: .22 }),
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
  Object.entries(materials).forEach(([name, material]) => { if (name !== 'deck') keep(material); });
  const batches = new Map();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), pos = new THREE.Vector3();
  const unit = new THREE.Vector3(1, 1, 1), axisY = new THREE.Vector3(0, 1, 0);
  function add(geometry, finish, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    rotation.setFromEuler(new THREE.Euler(rx, ry, rz));
    geometry.applyMatrix4(matrix.compose(pos.set(x, y, z), rotation, unit));
    if (finish === 'deck') applyDeckUV(geometry);
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  const box = (w, h, d, finish, x, y, z, radius = .025, rz = 0) =>
    add(radius < .008 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), finish, x, y, z, 0, 0, rz);
  function cylinder(radius, length, finish, x, y, z, axis = 'y', radiusTop = radius, segments = 16) {
    add(new THREE.CylinderGeometry(radiusTop, radius, length, segments), finish, x, y, z,
      axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
  }
  function torus(radius, tube, finish, x, y, z, axis = 'z', arc = Math.PI * 2) {
    add(new THREE.TorusGeometry(radius, tube, 7, 32, arc), finish, x, y, z,
      axis === 'y' ? Math.PI / 2 : 0, axis === 'x' ? Math.PI / 2 : 0);
  }
  function rod(from, to, radius, finish, segments = 10) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments);
    rotation.setFromUnitVectors(axisY, direction.normalize());
    geometry.applyMatrix4(matrix.compose(a.add(b).multiplyScalar(.5), rotation, unit));
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  function route(points, radius, finish, bend = .24) {
    const path = new THREE.CurvePath();
    let previous = new THREE.Vector3(...points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      const corner = new THREE.Vector3(...points[i]), next = new THREE.Vector3(...points[i + 1]);
      const before = previous.clone().sub(corner).normalize().multiplyScalar(bend).add(corner);
      const after = next.clone().sub(corner).normalize().multiplyScalar(bend).add(corner);
      path.add(new THREE.LineCurve3(previous, before));
      path.add(new THREE.QuadraticBezierCurve3(before, corner, after)); previous = after;
    }
    path.add(new THREE.LineCurve3(previous, new THREE.Vector3(...points.at(-1))));
    add(new THREE.TubeGeometry(path, Math.max(28, points.length * 14), radius, 12, false), finish);
  }
  function flange(x, y, z, radius, axis = 'y') {
    cylinder(radius, .085, 'steel', x, y, z, axis);
    cylinder(radius * .86, .12, 'iron', x, y, z, axis);
    for (let j = 0; j < 6; j++) {
      const a = j * Math.PI / 3, u = Math.cos(a) * radius * .77, v = Math.sin(a) * radius * .77;
      cylinder(.026, .16, 'copper', x + (axis === 'x' ? 0 : u), y + (axis === 'y' ? 0 : v), z + (axis === 'z' ? 0 : axis === 'y' ? v : u), axis, .026, 6);
    }
  }
  function valve(x, y, z, radius = .23) {
    cylinder(.085, .22, 'copper', x, y, z - .10, 'z');
    torus(radius, .035, 'red', x, y, z);
    cylinder(.07, .10, 'red', x, y, z, 'z', .07, 8);
    for (let j = 0; j < 3; j++) {
      const a = j * Math.PI * 2 / 3;
      rod([x, y, z], [x + Math.cos(a) * radius, y + Math.sin(a) * radius, z], .021, 'red');
    }
  }

  // Deck panels have thickness and bevel highlights. Their top lies just below authoritative feet.
  const floorGeometry = new THREE.PlaneGeometry(72, 42);
  floorGeometry.rotateX(-Math.PI / 2); floorGeometry.translate(0, -.12, 1.5);
  const floor = new THREE.Mesh(keep(applyDeckUV(floorGeometry)), materials.deck);
  floor.name = 'continuous-industrial-floor';
  floor.receiveShadow = true; group.add(floor);
  for (let x = -6.9; x < 6.8; x += 2.3) for (const z of [-1.59, -.53, .53, 1.59]) {
    box(2.275, .10, 1.035, 'deck', x + 1.14, -.057, z, .023);
    for (const dx of [-.98, .98]) for (const dz of [-.37, .37]) cylinder(.029, .018, 'steel', x + 1.14 + dx, -.003, z + dz, 'y', .029, 6);
  }
  for (const z of [-2.21, 2.21]) {
    box(15.1, .18, .15, 'steel', 0, -.045, z, .025);
    box(15.25, .17, .18, 'iron', 0, -.09, z + Math.sign(z) * .14, .022);
    for (let x = -6.8; x <= 6.8; x += .68) {
      box(.32, .007, .085, 'worn', x, .049, z, .001, 0);
      if (z > 0 && Math.round(x * 100) % 2 === 0) box(.23, .024, .04, x < 0 ? 'amber' : 'cyan', x, -.012, z + .088, .004);
    }
  }
  // Side drains have actual openings and shadows, not a printed grill texture.
  for (const x of [-5.55, 5.55]) {
    box(1.76, .07, .76, 'black', x, -.015, -1.3, .02);
    for (const z of [-1.66, -.94]) box(1.8, .055, .07, 'steel', x, .029, z, .01);
    for (const dx of [-.86, .86]) box(.07, .055, .71, 'steel', x + dx, .029, -1.3, .01);
    for (let j = 0; j < 18; j++) box(.027, .047, .64, 'steel', x - .78 + j * .092, .02, -1.3, .009);
  }

  const ratio = wallpaper.image.width / wallpaper.image.height;
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(24, 24 / ratio)), keep(new THREE.MeshBasicMaterial({ map: wallpaper, color: '#a3a9aa', toneMapped: false })));
  wall.name = 'original-belobog-wall';
  wall.position.set(0, 12 / ratio - .16, -3.3); group.add(wall);
  // Camera-safe masonry wings sit behind the unscaled original mural. Real steel columns cover
  // the physical joins; an airborne zoom-out reveals architecture rather than a wallpaper edge.
  box(64, 18, .16, 'black', 0, 8.8, -3.66, .001);
  for (let row = 0; row < 50; row++) {
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
  // Two different service assemblies frame the supplied wall without occupying the fighting lane.
  const receivers = createPressureReservoirs();
  group.add(receivers.group);
  for (const side of [-1, 1]) {
    const sx = side * 7.55, tone = side < 0 ? 'amber' : 'cyan';
    route([[sx, 2.50, -2.4], [sx, 2.81, -2.4], [side * 8.2, 2.81, -2.4], [side * 8.2, 4.97, -2.55], [side * 4.8, 4.97, -2.76]], .13, 'iron', .27);
    flange(side * 8.2, 3.62, -2.4, .22);
    for (const y of [3.1, 4.5]) {
      torus(.15, .024, 'steel', side * 8.2, y, -2.48, 'y');
      box(.44, .095, .1, 'iron', side * 8.2, y, -2.94, .02);
      rod([side * 8.2, y, -2.94], [side * 8.2, y, -2.49], .038, 'steel');
    }
    route([[sx - side * .48, .88, -2.35], [side * 6.63, .88, -2.35], [side * 6.63, .2, -2.35], [side * 5.5, .2, -2.35]], .064, 'copper', .15);
    valve(side * 6.63, .87, -2.07);
    for (let j = 0; j < 3; j++) {
      const x = sx + side * (.60 + j * .08);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 2.1, -2.65), new THREE.Vector3(x + side * .16, 1.2, -2.5), new THREE.Vector3(x + side * .09, .3, -2.8)]);
      add(new THREE.TubeGeometry(curve, 18, .018, 6, false), 'black');
    }
    // Cast lamp housing, inset diffuser and individual guard ribs.
    const lampX = side * 5.8;
    box(.91, .24, .42, 'iron', lampX, 4.82, -2.75, .065);
    box(.67, .1, .065, tone, lampX, 4.78, -2.52, .025);
    for (const dx of [-.35, -.18, 0, .18, .35]) rod([lampX + dx, 4.69, -2.46], [lampX + dx, 4.90, -2.46], .016, 'steel');
    for (const y of [4.69, 4.90]) rod([lampX - .38, y, -2.46], [lampX + .38, y, -2.46], .018, 'steel');
  }
  route([[-8.1, 4.15, -2.99], [-8.1, 5.42, -2.99], [8.1, 5.42, -2.99], [8.1, 4.15, -2.99]], .06, 'copper', .32);
  for (const x of [-6, -3, 0, 3, 6]) flange(x, 5.42, -2.99, .105, 'x');
  // Sagging supply cables span between physical anchor cleats.
  for (let j = 0; j < 3; j++) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-7.9, 4.85 + j * .08, -3.03), new THREE.Vector3(-3.6, 4.40 + j * .08, -3.06), new THREE.Vector3(1.4, 4.54 + j * .08, -3.07), new THREE.Vector3(7.9, 4.99 + j * .08, -3.02)]);
    add(new THREE.TubeGeometry(curve, 48, .018, 6, false), j === 2 ? 'copper' : 'black');
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
  return { group, dispose() { posters.dispose(); receivers.dispose(); deckSurface.dispose(); scene.remove(group); for (const resource of owned) resource.dispose(); } };
}
