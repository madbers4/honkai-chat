import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDeckUV, stoneCourses } from './deck-surface.js';

export const CLUB_FLOOR = Object.freeze({
  width: 88, depth: 84, centerZ: 1.5, surfaceY: -.018,
  // Away from the z=0 fighting lane; actual holes, flush removable iron covers.
  grates: Object.freeze([
    Object.freeze({ x: -7.6, z: 3.3, width: 3.4, depth: 1.28, warm: false }),
    Object.freeze({ x: -.6, z: 3.3, width: 3.4, depth: 1.28, warm: true }),
    Object.freeze({ x: 7.6, z: 3.3, width: 3.4, depth: 1.28, warm: false }),
    Object.freeze({ x: 2.3, z: -2.53, width: 1.7, depth: .46, warm: false }),
  ]),
});

/** The floor is part of the room, never an elevated, cropped fighting platform. */
export function createClubFloor({ deckSurface }) {
  const group = new THREE.Group(); group.name = 'Fight Club — stone floor and inset service grates';
  const owned = new Set(), keep = resource => { owned.add(resource); return resource; };
  const bounds = { left: -CLUB_FLOOR.width / 2, right: CLUB_FLOOR.width / 2,
    back: CLUB_FLOOR.centerZ - CLUB_FLOOR.depth / 2, front: CLUB_FLOOR.centerZ + CLUB_FLOOR.depth / 2 };
  const holes = CLUB_FLOOR.grates.map(g => ({ ...g, left: g.x - g.width / 2, right: g.x + g.width / 2, back: g.z - g.depth / 2, front: g.z + g.depth / 2 }));
  // Real 24mm chamfered flags across the whole room. The same atlas coordinates
  // drive the geometry and material so there is no second, misaligned seam grid.
  const positions = [], colors = [];
  const courses = stoneCourses();
  function polygonClip(polygon, axis, edge, keepLess) {
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = keepLess ? a[axis] <= edge : a[axis] >= edge;
      const insideB = keepLess ? b[axis] <= edge : b[axis] >= edge;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return output;
  }
  function subtractHole(polygon, hole) {
    const parts = []; let remaining = polygon;
    for (const [axis, edge, less] of [[0, hole.left, true], [0, hole.right, false], [1, hole.back, true], [1, hole.front, false]]) {
      const piece = polygonClip(remaining, axis, edge, less);
      if (piece.length >= 3) parts.push(piece);
      remaining = polygonClip(remaining, axis, edge, !less);
      if (remaining.length < 3) break;
    }
    return parts;
  }
  function flag(polygon, shade) {
    const cx = polygon.reduce((v, p) => v + p[0], 0) / polygon.length;
    const cz = polygon.reduce((v, p) => v + p[1], 0) / polygon.length;
    const inset = polygon.map(p => {
      const dx = cx - p[0], dz = cz - p[1], length = Math.hypot(dx, dz);
      const k = Math.min(.024 / length, .15);
      return [p[0] + dx * k, p[1] + dz * k];
    });
    function triangle(a, ay, b, by, c, cy, multiplier = 1) {
      positions.push(a[0], ay, a[1], b[0], by, b[1], c[0], cy, c[1]);
      for (let i = 0; i < 3; i++) colors.push(shade * multiplier, shade * multiplier, shade * multiplier);
    }
    for (let i = 0; i < polygon.length; i++) {
      const n = (i + 1) % polygon.length;
      triangle([cx, cz], CLUB_FLOOR.surfaceY, inset[n], CLUB_FLOOR.surfaceY, inset[i], CLUB_FLOOR.surfaceY);
      triangle(inset[i], CLUB_FLOOR.surfaceY, inset[n], CLUB_FLOOR.surfaceY, polygon[n], -.065, .93);
      triangle(inset[i], CLUB_FLOOR.surfaceY, polygon[n], -.065, polygon[i], -.065, .93);
    }
  }
  for (let iz = -6; iz <= 6; iz++) for (const [row, course] of courses.entries()) {
    const back = iz * 8 - 4 + course.z, front = back + course.height;
    if (front < bounds.back || back > bounds.front) continue;
    for (let ix = -4; ix <= 4; ix++) for (const [column, stone] of course.stones.entries()) {
      const left = ix * 16 - 8 + course.offset + stone.x, right = left + stone.width;
      if (right < bounds.left || left > bounds.right) continue;
      const l = left + .011, r = right - .011, b = back + .011, f = front - .011;
      const seed = ((ix + 7) * 97 + (iz + 7) * 47 + row * 13 + column * 31);
      const c = Array.from({ length: 4 }, (_, n) => .025 + ((seed * (n + 3)) % 11) * .007);
      if (seed % 13 === 0) c[seed % 4] += .13; // a few old, broken flag corners
      let polygon = [[l + c[0], b], [r - c[1], b], [r, b + c[1]], [r, f - c[2]], [r - c[2], f], [l + c[3], f], [l, f - c[3]], [l, b + c[0]]];
      for (const [axis, edge, less] of [[0,bounds.left,false],[0,bounds.right,true],[1,bounds.back,false],[1,bounds.front,true]]) polygon = polygonClip(polygon,axis,edge,less);
      if (polygon.length < 3) continue;
      let pieces = [polygon];
      for (const hole of holes) if (right > hole.left && left < hole.right && front > hole.back && back < hole.front) pieces = pieces.flatMap(p => subtractHole(p,hole));
      const shade = .95 + (seed % 17) * .005;
      for (const piece of pieces) flag(piece, shade);
    }
  }
  const geometry = keep(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals(); applyDeckUV(geometry);
  geometry.name = 'continuous-club-stone-floor';
  const floor = new THREE.Mesh(geometry, deckSurface.material); floor.name = 'continuous-club-stone-floor';
  floor.receiveShadow = true; group.add(floor);

  // Grout seals every slab and grate perimeter. The drain interiors below will
  // cover their own openings; no lower camera can see an open, floating shell.
  const cutsX = [...new Set([bounds.left,bounds.right,...holes.flatMap(h => [h.left,h.right])])].sort((a,b)=>a-b);
  const cutsZ = [...new Set([bounds.back,bounds.front,...holes.flatMap(h => [h.back,h.front])])].sort((a,b)=>a-b), groutPieces=[];
  for(let x=1;x<cutsX.length;x++) for(let z=1;z<cutsZ.length;z++) {
    const cx=(cutsX[x]+cutsX[x-1])/2,cz=(cutsZ[z]+cutsZ[z-1])/2;
    if(holes.some(h=>cx>h.left&&cx<h.right&&cz>h.back&&cz<h.front)) continue;
    groutPieces.push(new THREE.PlaneGeometry(cutsX[x]-cutsX[x-1],cutsZ[z]-cutsZ[z-1]).rotateX(-Math.PI/2).translate(cx,-.072,cz));
  }
  const groutGeometry=keep(mergeGeometries(groutPieces)); groutPieces.forEach(p=>p.dispose());
  const groutMaterial = keep(new THREE.MeshStandardMaterial({name:'earth-dark compacted mortar',color:'#201b16',roughness:1,metalness:0}));
  const grout = new THREE.Mesh(groutGeometry,groutMaterial); grout.name = 'club-floor-mortar'; grout.receiveShadow = true; group.add(grout);

  const batches = new Map();
  const materials = {
    iron: keep(new THREE.MeshStandardMaterial({ name: 'scuffed oxidised grate iron', color: '#ffffff', vertexColors: true, roughness: .78, metalness: .48 })),
    cavity: keep(new THREE.MeshStandardMaterial({ name: 'sooty drain interior', color: '#211c18', roughness: 1, metalness: 0 })),
    heat: keep(new THREE.MeshStandardMaterial({ name: 'low furnace glow below the grate', color: '#462713', emissive: '#ff7828', emissiveIntensity: .64, roughness: 1, metalness: 0 })),
  };
  materials.heat.userData.glowSource = 'emissive';
  function add(geometry, finish, x, y, z, seed = 0) {
    geometry.translate(x, y, z);
    if (finish === 'iron') {
      const shade = new THREE.Color().setRGB(.040 + (seed % 7) * .002, .026 + (seed % 5) * .0015, .016 + (seed % 3) * .001);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        // Rubbed upper edges catch light; sides retain the dark forged finish.
        const top = geometry.attributes.normal.getY(i) > .5 ? 1.12 : .87;
        colors[i * 3] = shade.r * top; colors[i * 3 + 1] = shade.g * top; colors[i * 3 + 2] = shade.b * top;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  const box = (w, h, d, finish, x, y, z, seed = 0) => add(new THREE.BoxGeometry(w, h, d), finish, x, y, z, seed);
  for (const [index, grate] of holes.entries()) {
    const { x, z, width: w, depth: d } = grate;
    // Continuous masonry recess and a black depth plane seal the holes from all
    // camera angles; covers rest on a real 80mm angle-iron frame, not floating bars.
    box(w, .018, d, grate.warm ? 'heat' : 'cavity', x, -.235, z);
    for (const side of [-1, 1]) {
      box(w + .08, .24, .055, 'cavity', x, -.125, z + side * d / 2);
      box(.055, .24, d, 'cavity', x + side * w / 2, -.125, z);
      box(w + .10, .038, .08, 'iron', x, -.021, z + side * (d / 2 - .025), index + 2);
      box(.08, .038, d - .06, 'iron', x + side * (w / 2 - .025), -.021, z, index + 4);
    }
    const nx = Math.round((w - .15) / .105), nz = Math.max(2, Math.round((d - .15) / .12));
    for (let i = 0; i <= nx; i++) box(.027, .047, d - .13, 'iron', x - (w - .16) / 2 + i * (w - .16) / nx, -.034, z, i + index * 5);
    for (let j = 1; j < nz; j++) box(w - .13, .025, .022, 'iron', x, -.046, z - (d - .16) / 2 + j * (d - .16) / nz, j * 3 + index);
    // Modules have a centre bearing and restrained corner fasteners.
    box(.062, .052, d - .12, 'iron', x, -.029, z, index);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(.022, .022, .012, 6), 'iron', x + sx * (w / 2 - .075), -.005, z + sz * (d / 2 - .045), index + 6);
    // One inset lifting handle per half; its opening stays physically visible.
    for (const sx of [-1, 1]) {
      box(.22, .018, .021, 'iron', x + sx * w * .25, -.014, z, 6);
      for (const hx of [-.10, .10]) box(.024, .03, .035, 'iron', x + sx * w * .25 + hx, -.025, z, 4);
    }
  }
  for (const [finish, pieces] of batches) {
    const geometry = keep(mergeGeometries(pieces)); pieces.forEach(p => p.dispose());
    geometry.name = `club-floor-${finish}`;
    const mesh = new THREE.Mesh(geometry, materials[finish]); mesh.name = `club-floor-${finish}`;
    mesh.receiveShadow = finish !== 'heat'; mesh.castShadow = false; group.add(mesh);
  }
  // Warm light belongs to the furnace opening. This restrained pool has no
  // shadow map and no animated flicker; it never becomes a perimeter LED stripe.
  const warm = holes.find(g => g.warm);
  const light = new THREE.PointLight('#ff9b53', 2.4, 3.2, 2);
  light.name = 'grate residual warmth'; light.position.set(warm.x, .12, warm.z); group.add(light);
  let disposed = false;
  return { group, dispose() {
    if (disposed) return; disposed = true; group.removeFromParent();
    for (const resource of owned) resource.dispose();
  } };
}
