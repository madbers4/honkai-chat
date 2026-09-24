import { assetUrl } from './app-paths.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { POSTER_ATLAS, POSTER_CATALOG } from './poster-catalog.js';

// Deliberate notice clusters around the existing mural. Rotation is pasted-paper skew, not a gallery grid.
export const POSTER_PLACEMENTS = [
  { id: 'newspaper', x: -5.72, y: 4.08, height: .86, angle: -.06, layer: 0 },
  { id: 'provided-wanted-redhair', x: -5.65, y: 3.30, height: 1.62, angle: .032, layer: 1 },
  { id: 'provided-wanted-grayhair', x: -4.52, y: 2.88, height: 1.44, angle: -.045, layer: 2 },
  { id: 'wanted-danheng-pela', x: -6.62, y: 2.02, height: 1.08, angle: -.028, layer: 2 },
  { id: 'workshop-notice', x: 5.38, y: 4.08, height: .68, angle: .035, layer: 0 },
  { id: 'wanted-sampo-gepard', x: 4.48, y: 3.18, height: 1.62, angle: -.035, layer: 1 },
  { id: 'wanted-march-gepard', x: 5.64, y: 2.80, height: 1.38, angle: .045, layer: 2 },
  { id: 'wanted-trailblazer-gepard', x: 6.72, y: 3.48, height: 1.20, angle: -.018, layer: 1 },
  { id: 'mining-helmet', x: -8.73, y: 2.13, height: 1.28, angle: -.018, layer: 1 },
  { id: 'geomarrow', x: -8.78, y: 3.60, height: 1.18, angle: .042, layer: 1 },
  { id: 'medical', x: -3.96, y: 1.39, height: .83, angle: .012, layer: 1 },
  { id: 'coffee', x: 3.91, y: 1.38, height: .88, angle: .055, layer: 1 },
  { id: 'sewing-machine', x: 7.66, y: 4.11, height: .98, angle: -.035, layer: 1 },
  { id: 'workshop-glass', x: 8.79, y: 2.92, height: .98, angle: .015, layer: 1 },
  { id: 'warning', x: 8.66, y: 1.46, height: .80, angle: -.04, layer: 1 },
  { id: 'boxer', x: -9.78, y: 2.83, height: 1.25, angle: -.014, layer: 1 },
];

export async function loadPosterAtlas(loader = new THREE.TextureLoader()) {
  try {
    const texture = await loader.loadAsync(assetUrl(POSTER_ATLAS.url));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  } catch { return null; } // Optional set dressing must never block a playable arena.
}

function paperGeometry(placement, index) {
  const item = POSTER_CATALOG[placement.id];
  if (!item) throw new Error(`Unknown poster: ${placement.id}`);
  const width = placement.height * item.aspect, height = placement.height;
  const geometry = new THREE.PlaneGeometry(width, height, 8, 12);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  const [ax, ay, aw, ah] = item.rect, [tw, th] = POSTER_ATLAS.size;
  const angle = placement.angle || 0, c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), u = uv.getX(i), v = uv.getY(i);
    // Mostly adhered sheet: a little lower-corner lift and a shallow pasted crease.
    const corner = Math.pow(Math.max(0, Math.abs(u - .5) * 2 - .58) / .42, 2) * Math.pow(1 - v, 5);
    const curl = corner * (.018 + index % 3 * .004);
    const crease = Math.sin(u * Math.PI * 3 + index) * .0018 * Math.sin(v * Math.PI);
    position.setXYZ(i, placement.x + x * c - y * s, placement.y + x * s + y * c, -3.275 + (placement.layer || 0) * .007 + curl + crease);
    uv.setXY(i, (ax + u * aw) / tw, 1 - (ay + (1 - v) * ah) / th);
  }
  geometry.computeVertexNormals();
  geometry.userData.poster = placement.id;
  return geometry;
}

/** Static merged paper faces, thin reverse skins and alpha-matched contact shadows: three draws. */
export function createPaperPosters(texture, placements = POSTER_PLACEMENTS) {
  const group = new THREE.Group(); group.name = 'Belobog — pasted notices and wanted portraits';
  const resources = new Set(); let disposed = false;
  const keep = resource => { resources.add(resource); return resource; };
  if (!texture) return { group, dispose() {} };
  keep(texture);
  const parts = placements.map(paperGeometry);
  const faceGeometry = keep(mergeGeometries(parts));
  parts.forEach(part => part.dispose());
  faceGeometry.name = 'merged-adhered-paper';
  // The wall already contains baked illumination; paper still receives the live
  // arena lights. Lower its reflectance so that this second lighting pass does
  // not turn the original artwork into bright, detached stickers.
  const frontMaterial = keep(new THREE.MeshStandardMaterial({ map: texture, color: '#70695f', roughness: 1, metalness: 0, alphaTest: .32, side: THREE.DoubleSide }));
  const faces = new THREE.Mesh(faceGeometry, frontMaterial);
  faces.name = 'original-poster-prints'; faces.receiveShadow = true; faces.castShadow = false;
  group.add(faces);

  // A thin second skin follows exactly the same torn alpha as the print, so no rectangular card
  // fills the source's missing corners. The camera can see the paper thickness at curled edges.
  const reverseGeometry = keep(faceGeometry.clone()); reverseGeometry.translate(0, 0, -.003);
  const reverseMaterial = keep(new THREE.MeshStandardMaterial({ map: texture, color: '#50493e', roughness: 1, metalness: 0, alphaTest: .32, side: THREE.DoubleSide }));
  const reverse = new THREE.Mesh(reverseGeometry, reverseMaterial); reverse.name = 'thin-paper-edge-skins'; group.add(reverse);

  const shadowParts = placements.map((placement, index) => {
    const part = paperGeometry({ ...placement, x: placement.x + .012, y: placement.y - .017 }, index);
    const position = part.attributes.position;
    for (let i = 0; i < position.count; i++) position.setZ(i, -3.293 + (placement.layer || 0) * .0007);
    return part;
  });
  const shadowGeometry = keep(mergeGeometries(shadowParts)); shadowParts.forEach(part => part.dispose());
  const shadowMaterial = keep(new THREE.MeshBasicMaterial({ map: texture, color: '#000000', transparent: true, opacity: .24, alphaTest: .08, depthWrite: false, toneMapped: false }));
  const shadows = new THREE.Mesh(shadowGeometry, shadowMaterial); shadows.name = 'paper-contact-shadows'; shadows.renderOrder = -1; group.add(shadows);
  group.userData.posterCount = placements.length;
  return { group, dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const resource of resources) resource.dispose(); } };
}
