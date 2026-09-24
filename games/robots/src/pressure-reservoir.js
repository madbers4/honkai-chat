import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const CENTRES = [-7.55, 7.55];

/** One small, locally drawn instrument atlas; the rings and needles remain real geometry. */
function makeInstrumentAtlas() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  for (let instrument = 0; instrument < 2; instrument++) {
    ctx.save(); ctx.translate(instrument * 256 + 128, 128);
    const paper = ctx.createRadialGradient(-30, -35, 8, 0, 0, 128);
    paper.addColorStop(0, '#d9d3b7'); paper.addColorStop(.72, '#bebba4'); paper.addColorStop(1, '#797c72');
    ctx.fillStyle = paper; ctx.fillRect(-128, -128, 256, 256);
    // A worn enamel dial, without an opaque rectangular label on the vessel.
    ctx.lineWidth = 8; ctx.strokeStyle = '#873e31';
    ctx.beginPath(); ctx.arc(0, 0, 96, .08, .69); ctx.stroke();
    ctx.strokeStyle = '#343b38'; ctx.fillStyle = '#343b38';
    for (let tick = 0; tick <= 40; tick++) {
      const angle = Math.PI * .78 + tick / 40 * Math.PI * 1.44;
      const major = tick % 5 === 0, radius = major ? 78 : 85;
      ctx.lineWidth = major ? 3 : 1.4; ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.lineTo(Math.cos(angle) * 94, Math.sin(angle) * 94); ctx.stroke();
      if (major) {
        ctx.font = '600 18px Georgia,serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(instrument ? tick * 3 : tick / 5), Math.cos(angle) * 62, Math.sin(angle) * 62);
      }
    }
    ctx.font = 'bold 12px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillText(instrument ? '°C' : 'МПа', 0, 37);
    ctx.font = '8px monospace'; ctx.fillText(instrument ? 'ТК–12' : 'РМ–08', 0, 53);
    // Hairline crazing is confined to the rim, and stays below the marks' contrast.
    ctx.strokeStyle = '#74796c65'; ctx.lineWidth = .8;
    for (let i = 0; i < 8; i++) {
      const a = i * 1.72, x = Math.cos(a) * 117, y = Math.sin(a) * 117;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x * .86 + 2, y * .90); ctx.lineTo(x * .82, y * .86 + 2); ctx.stroke();
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; texture.name = 'reservoir-two-enamel-instruments'; return texture;
}

function weatheredPaint() {
  const material = new THREE.MeshStandardMaterial({ color: '#4c5a53', roughness: .73, metalness: .52 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vReservoirPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvReservoirPosition = position;');
    shader.fragmentShader = `varying vec3 vReservoirPosition;
      float receiverHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float receiverNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(receiverHash(i),receiverHash(i+vec2(1,0)),f.x),mix(receiverHash(i+vec2(0,1)),receiverHash(i+vec2(1,1)),f.x),f.y);
      }\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 rp = vReservoirPosition; rp.x -= sign(rp.x) * 7.55; rp.z += 2.39;
      float angle = atan(rp.x,rp.z);
      float fine = receiverNoise(vec2(angle*105.0,rp.y*130.0));
      float mottling = receiverNoise(vec2(angle*6.2,rp.y*5.8));
      float seam = max(exp(-abs(rp.y-0.61)*75.0),exp(-abs(rp.y-1.93)*75.0));
      float run = smoothstep(0.70,0.87,receiverNoise(vec2(angle*15.0,rp.y*0.18)));
      float runoff = run * (1.0-smoothstep(1.05,1.95,rp.y)) * smoothstep(0.45,0.85,rp.y);
      diffuseColor.rgb *= 0.84 + mottling*0.19 + fine*0.055;
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.125,0.103,0.071),seam*0.38+runoff*0.21);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (fine-.5)*.12 + runoff*.1, .55, .95);');
  };
  material.customProgramCacheKey = () => 'pressure-reservoir-aged-enamel-v1';
  return material;
}

/**
 * Two pressure receivers, in the original side-prop footprint. All instances are baked
 * together by finish: seven draws for the pair, no per-bolt objects or extra lights.
 * The existing overhead pipe and lower copper outlet remain owned by environment.js.
 */
export function createPressureReservoirs() {
  const group = new THREE.Group(); group.name = 'Belobog — riveted pressure receivers';
  const resources = new Set(), batches = new Map(); let disposed = false;
  const keep = value => { resources.add(value); return value; };
  const materials = {
    enamel: weatheredPaint(),
    iron: new THREE.MeshStandardMaterial({ color: '#26302e', roughness: .7, metalness: .65 }),
    steel: new THREE.MeshStandardMaterial({ color: '#777e75', roughness: .45, metalness: .82 }),
    brass: new THREE.MeshStandardMaterial({ color: '#766044', roughness: .57, metalness: .72 }),
    dial: new THREE.MeshStandardMaterial({ map: keep(makeInstrumentAtlas()), roughness: .62, metalness: .05 }),
    needle: new THREE.MeshStandardMaterial({ color: '#742f22', roughness: .48, metalness: .46 }),
    glass: new THREE.MeshStandardMaterial({ color: '#486050', roughness: .17, metalness: .37 }),
  };
  Object.entries(materials).forEach(([name, material]) => { material.name = `receiver-${name}`; keep(material); });
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  function add(geometry, finish, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz)); geometry.applyMatrix4(matrix.compose(position.set(x, y, z), quaternion, unit));
    if (!batches.has(finish)) batches.set(finish, []); batches.get(finish).push(geometry);
  }
  const box = (w, h, d, finish, x, y, z, rz = 0) => add(new THREE.BoxGeometry(w, h, d), finish, x, y, z, 0, 0, rz);
  const cylinder = (r, h, finish, x, y, z, axis = 'y', segments = 20) => add(new THREE.CylinderGeometry(r, r, h, segments), finish, x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
  const ring = (r, tube, finish, x, y, z, axis = 'z', arc = TAU) => add(new THREE.TorusGeometry(r, tube, 5, 36, arc), finish, x, y, z, axis === 'y' ? Math.PI / 2 : 0, 0);
  function rod(a, b, radius, finish, segments = 8) {
    const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b), direction = q.clone().sub(p);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments);
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    geometry.applyMatrix4(matrix.compose(p.add(q).multiplyScalar(.5), quaternion, unit));
    if (!batches.has(finish)) batches.set(finish, []); batches.get(finish).push(geometry);
  }
  function face(radius, x, y, z, instrument) {
    const geometry = new THREE.CircleGeometry(radius, 40), uv = geometry.attributes.uv;
    // Half-atlas insets avoid the adjacent instrument bleeding into mipmaps.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (instrument + .018 + uv.getX(i) * .964) / 2, .018 + uv.getY(i) * .964);
    add(geometry, 'dial', x, y, z);
  }
  function gauge(x, y, z, radius, instrument, angle) {
    cylinder(radius * .85, .11, 'iron', x, y, z - .07, 'z', 32);
    cylinder(radius * .91, .018, 'brass', x, y, z - .012, 'z', 32);
    face(radius * .84, x, y, z + .002, instrument);
    ring(radius * .90, radius * .10, 'steel', x, y, z);
    ring(radius * .78, radius * .019, 'iron', x, y, z + .014);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, px = x + Math.cos(a) * radius * .91, py = y + Math.sin(a) * radius * .91;
      cylinder(radius * .037, .012, 'iron', px, py, z + .026, 'z', 6);
    }
    // A tapered pointer, not a large red rod over a blank white circle.
    const c = Math.cos(angle), s = Math.sin(angle), reach = radius * .65, width = radius * .037;
    const shape = new THREE.Shape(); shape.moveTo(-s * width - c * radius * .14, c * width - s * radius * .14);
    shape.lineTo(c * reach, s * reach); shape.lineTo(s * width - c * radius * .14, -c * width - s * radius * .14); shape.closePath();
    add(new THREE.ShapeGeometry(shape), 'needle', x, y, z + .021);
    cylinder(radius * .088, .018, 'iron', x, y, z + .020, 'z', 12);
    cylinder(radius * .04, .022, 'brass', x, y, z + .022, 'z', 10);
  }
  for (let index = 0; index < CENTRES.length; index++) {
    const sx = CENTRES[index], side = Math.sign(sx), z = -2.39;
    // Skid, anchored channel feet and braced saddle — there is a visible gap below the vessel.
    for (const dx of [-.54, .54]) {
      box(.18, .09, 1.12, 'iron', sx + dx, .055, z);
      box(.23, .035, 1.18, 'steel', sx + dx, .013, z);
      for (const dz of [-.46, .46]) { cylinder(.042, .031, 'brass', sx + dx, .121, z + dz, 'y', 6); cylinder(.064, .012, 'iron', sx + dx, .106, z + dz); }
    }
    for (const dy of [.15, .235]) box(1.28, .075, .74, 'iron', sx, dy, z);
    for (const dx of [-.30, .30]) for (const dz of [-.26, .26]) {
      box(.105, .26, .105, 'iron', sx + dx, .345, z + dz);
      rod([sx + dx, .22, z + dz], [sx + dx * 1.22, .52, z + dz], .034, 'steel');
    }
    const profile = [[0, .29], [.16, .30], [.29, .35], [.40, .43], [.461, .53], [.475, .61], [.475, 1.93], [.464, 2.02], [.406, 2.13], [.297, 2.22], [.16, 2.29], [.12, 2.30]].map(p => new THREE.Vector2(...p));
    add(new THREE.LatheGeometry(profile, 48), 'enamel', sx, 0, z);
    for (const y of [.61, 1.93]) {
      ring(.476, .012, 'iron', sx, y, z, 'y'); ring(.481, .006, 'steel', sx, y + .003, z, 'y');
    }
    // One longitudinal welded seam, kept to the outside shoulder instead of drawing a grid.
    rod([sx + side * .366, .66, z - .303], [sx + side * .366, 1.88, z - .303], .007, 'steel', 5);
    // Welded lifting lugs and a service neck, connected to the existing overhead inlet.
    for (const dx of [-.28, .28]) {
      const lug = new THREE.Shape(); lug.absarc(0, 0, .082, 0, TAU, false);
      const hole = new THREE.Path(); hole.absarc(0, .01, .036, 0, TAU, true); lug.holes.push(hole);
      add(new THREE.ExtrudeGeometry(lug, { depth: .034, bevelEnabled: false, curveSegments: 8 }), 'steel', sx + dx, 2.18, z - .017);
      box(.14, .05, .07, 'iron', sx + dx, 2.13, z);
    }
    cylinder(.121, .18, 'iron', sx, 2.37, z);
    cylinder(.209, .06, 'steel', sx, 2.433, z);
    cylinder(.188, .014, 'iron', sx, 2.47, z);
    for (let bolt = 0; bolt < 8; bolt++) {
      const a = TAU * bolt / 8;
      cylinder(.023, .084, 'brass', sx + Math.cos(a) * .17, 2.445, z + Math.sin(a) * .17, 'y', 6);
    }
    // A recessed lower inspection cover has its own pressure seal and six bolts.
    cylinder(.205, .055, 'iron', sx, .87, z + .47, 'z', 32);
    cylinder(.176, .059, 'enamel', sx, .87, z + .481, 'z', 32);
    ring(.182, .012, 'steel', sx, .87, z + .511);
    for (let bolt = 0; bolt < 6; bolt++) {
      const a = TAU * bolt / 6;
      cylinder(.019, .026, 'brass', sx + Math.cos(a) * .153, .87 + Math.sin(a) * .153, z + .522, 'z', 6);
    }
    // Copper impulse lines terminate at the gauge sockets and share a cast mounting bridge.
    box(.50, .067, .065, 'iron', sx - side * .025, 1.455, z + .489);
    rod([sx - side * .22, 1.47, z + .41], [sx - side * .22, 1.47, z + .57], .033, 'brass');
    rod([sx - side * .22, 1.47, z + .57], [sx - side * .22, 1.535, z + .57], .033, 'brass');
    cylinder(.052, .08, 'brass', sx - side * .16, 1.545, z + .54, 'y', 6);
    gauge(sx - side * .16, 1.75, z + .575, .202, 0, index ? .90 : 1.23);
    cylinder(.031, .11, 'brass', sx + side * .19, 1.245, z + .505, 'y', 6);
    gauge(sx + side * .20, 1.418, z + .534, .133, 1, index ? 2.07 : 1.77);
    // Guarded level tube: inset dark well, glass, liquid column and top/bottom unions.
    const lx = sx + side * .34, lz = z + .357;
    box(.105, .66, .055, 'iron', lx, 1.24, lz);
    cylinder(.027, .53, 'glass', lx, 1.25, lz + .036, 'y', 12);
    rod([lx - .046, .95, lz + .045], [lx - .046, 1.55, lz + .045], .009, 'steel', 6);
    rod([lx + .046, .95, lz + .045], [lx + .046, 1.55, lz + .045], .009, 'steel', 6);
    cylinder(.019, index ? .32 : .38, 'brass', lx, index ? 1.13 : 1.16, lz + .054, 'y', 10);
    for (const y of [.948, 1.55]) { cylinder(.054, .055, 'brass', lx, y, lz + .018, 'y', 6); rod([lx, y, lz], [lx, y, z + .31], .03, 'iron'); }
    for (let tick = 0; tick < 5; tick++) box(.026, .009, .009, 'steel', lx + side * .055, 1.02 + tick * .10, lz + .031);
    // The low outlet lands on the existing copper route, preserving its authored position.
    cylinder(.103, .078, 'iron', sx - side * .448, .88, z + .04, 'x');
    cylinder(.078, .097, 'brass', sx - side * .472, .88, z + .04, 'x', 6);
    // Small welded asset-number tabs remain dimensional, deliberately unlettered at game scale.
    box(.21, .077, .016, 'brass', sx, 1.16, z + .477);
    for (const dx of [-.079, .079]) cylinder(.009, .020, 'iron', sx + dx, 1.16, z + .484, 'z', 6);
  }
  let triangles = 0;
  for (const [finish, parts] of batches) {
    const compatible = parts.map(part => part.index ? part.toNonIndexed() : part);
    const geometry = keep(mergeGeometries(compatible));
    compatible.forEach((part, i) => { if (part !== parts[i]) part.dispose(); }); parts.forEach(part => part.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); triangles += geometry.attributes.position.count / 3;
    const mesh = new THREE.Mesh(geometry, materials[finish]); mesh.name = `pressure-receiver-${finish}`;
    mesh.castShadow = !['dial', 'needle', 'glass'].includes(finish); mesh.receiveShadow = true; group.add(mesh);
  }
  group.userData = { receiverCount: 2, drawCalls: group.children.length, triangles, atlasSize: [512, 256], footprint: 'original side assemblies' };
  return { group, dispose() { if (disposed) return; disposed = true; group.removeFromParent(); resources.forEach(resource => resource.dispose()); } };
}
