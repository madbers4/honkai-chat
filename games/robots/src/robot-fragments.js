import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

// Every triangle is the supplied rigid-weighted robot, split only along its
// real bone/material boundaries. No replacement boxes or random prop meshes.
export function createRobotFragments(parent, model) {
  const group = new THREE.Group();
  group.name = 'OriginalAutomaton_Wreck'; group.visible = false; parent.add(group);
  const pieces = [];
  const materials = new Map();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const inverseParent = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  const turn = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const center = new THREE.Vector3(), radial = new THREE.Vector3();
  const partBounds = new THREE.Box3(), shadowScale = new THREE.Vector3();
  const shadowRotation = new THREE.Quaternion();
  let contactShadows;
  let built = false;
  let active = false;
  let elapsed = 0;
  let disposed = false;
  const random = (seed) => {
    let x = Math.imul(seed + 71, 1597334677); x ^= x >>> 13; x = Math.imul(x, 3812015801);
    return (x >>> 0) / 4294967296;
  };

  function build() {
    if (built) return;
    built = true;
    model.traverse(source => {
      if (!source.isSkinnedMesh) return;
      const original = source.geometry;
      const clusters = new Map();
      const index = original.index;
      const count = index ? index.count : original.attributes.position.count;
      for (let offset = 0; offset < count; offset += 3) {
        const vertices = [0, 1, 2].map(k => index ? index.getX(offset + k) : offset + k);
        const joint = original.attributes.skinIndex.getX(vertices[0]);
        if (!vertices.every(i => original.attributes.skinIndex.getX(i) === joint && original.attributes.skinWeight.getX(i) === 1)) throw new Error('Original mechanical triangle must remain rigid.');
        if (!clusters.has(joint)) clusters.set(joint, { position: [], normal: [], uv: [] });
        const data = clusters.get(joint);
        matrix.multiplyMatrices(source.skeleton.boneInverses[joint], source.bindMatrix);
        normalMatrix.getNormalMatrix(matrix);
        for (const i of vertices) {
          point.fromBufferAttribute(original.attributes.position, i).applyMatrix4(matrix);
          data.position.push(point.x, point.y, point.z);
          normal.fromBufferAttribute(original.attributes.normal, i).applyMatrix3(normalMatrix).normalize();
          data.normal.push(normal.x, normal.y, normal.z);
          data.uv.push(original.attributes.uv.getX(i), original.attributes.uv.getY(i));
        }
      }
      if (!materials.has(source.material)) {
        const material = source.material.clone(); material.emissive?.set(0); material.emissiveIntensity = 0;
        material.roughness = Math.min(1, material.roughness + .10); materials.set(source.material, material);
      }
      for (const [joint, data] of clusters) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        const unique = new Map();
        for (let i = 0; i < data.position.length; i += 3) {
          const p = new THREE.Vector3(...data.position.slice(i, i + 3));
          unique.set(p.toArray().map(x => x.toFixed(6)).join(','), p);
        }
        const hull = new ConvexHull().setFromPoints([...unique.values()]);
        const hullPoints = new Set();
        for (const face of hull.faces) {
          let edge = face.edge;
          do { hullPoints.add(edge.head().point); edge = edge.next; } while (edge !== face.edge);
        }
        const bone = source.skeleton.bones[joint];
        const mesh = new THREE.Mesh(geometry, materials.get(source.material));
        mesh.name = `OriginalFragment_${bone.name}_${source.material.name}`;
        mesh.userData.originalRobotFragment = true;
        mesh.userData.sourceBone = bone.name;
        mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
        geometry.computeBoundingBox();
        pieces.push({ mesh, bone, source, hull: [...hullPoints], center: geometry.boundingBox.getCenter(new THREE.Vector3()), start: new THREE.Vector3(), startQ: new THREE.Quaternion(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), initialV: new THREE.Vector3(), initialSpin: new THREE.Vector3(), asleep: false });
      }
    });
    // One pooled ground pass keeps the heavy wreck visually attached to the
    // floor without asking every small fragment to cast a dynamic shadow map.
    const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    shadowGeometry.setAttribute('contactOpacity', new THREE.InstancedBufferAttribute(new Float32Array(pieces.length), 1));
    const shadowMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `attribute float contactOpacity; varying vec2 vUv; varying float vOpacity;
        void main(){vUv=uv;vOpacity=contactOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv; varying float vOpacity;
        void main(){float r=length((vUv-.5)*2.0);float a=exp(-r*r*5.0)*(1.0-smoothstep(.7,1.0,r));gl_FragColor=vec4(.015,.018,.02,a*vOpacity);}` });
    contactShadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, pieces.length);
    contactShadows.name = 'wreck-contact-shadows'; contactShadows.frustumCulled = false;
    contactShadows.renderOrder = -1; group.add(contactShadows);
  }

  function resetSimulation() {
    elapsed = 0;
    for (const piece of pieces) {
      piece.mesh.position.copy(piece.start); piece.mesh.quaternion.copy(piece.startQ);
      piece.velocity.copy(piece.initialV); piece.spin.copy(piece.initialSpin); piece.asleep = false;
    }
    group.updateMatrixWorld(true);
  }

  function start(type = 'overload') {
    build(); parent.updateMatrixWorld(true);
    inverseParent.copy(parent.matrixWorld).invert();
    pieces.forEach((piece, i) => {
      matrix.multiplyMatrices(inverseParent, piece.bone.matrixWorld);
      if (piece.source.userData.fractureOffset) matrix.multiply(new THREE.Matrix4().makeTranslation(...piece.source.userData.fractureOffset.toArray()));
      matrix.decompose(piece.start, piece.startQ, piece.mesh.scale);
      piece.startQ.normalize();
      const heavy = ['chassis', 'turret'].includes(piece.bone.name);
      // Pressure follows the actual part's location around the reactor. The
      // heavy housings drop; lightweight limb plates peel away around them.
      center.copy(piece.center).multiply(piece.mesh.scale).applyQuaternion(piece.startQ).add(piece.start);
      radial.set(center.x, 0, center.z);
      if (radial.lengthSq() < .01) radial.set(Math.cos(i * 2.39996), 0, Math.sin(i * 2.39996));
      radial.normalize();
      const force = type === 'brutality' ? .70 : type === 'coreRip' ? .88 : 1;
      const speed = (heavy ? .75 : 2.2) + random(i * 9 + 2) * (heavy ? .50 : 1.2);
      piece.initialV.copy(radial).multiplyScalar(speed * force);
      piece.initialV.y = ((heavy ? 1.35 : 2.1) + random(i * 9 + 3) * (heavy ? .50 : 1.2)) * force;
      piece.initialSpin.set(radial.z * .8 + (random(i * 9 + 4) - .5) * .6,
        (random(i * 9 + 5) - .5) * .6, -radial.x * .8 + (random(i * 9 + 6) - .5) * .6)
        .multiplyScalar(heavy ? 3.2 : 4.5);
    });
    active = true; group.visible = true; model.visible = false; resetSimulation();
  }

  function step(dt) {
    for (const piece of pieces) {
      if (piece.asleep) continue;
      piece.velocity.y -= 12.5 * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      const angularSpeed = piece.spin.length();
      if (angularSpeed > .0001) piece.mesh.quaternion.premultiply(turn.setFromAxisAngle(axis.copy(piece.spin).normalize(), angularSpeed * dt));
      piece.mesh.updateMatrixWorld(true);
      let bottom = Infinity;
      for (const vertex of piece.hull) bottom = Math.min(bottom, point.copy(vertex).applyMatrix4(piece.mesh.matrixWorld).y);
      if (bottom < .001) {
        // The group is a translated gameplay root: exact original surface
        // contact is corrected after rotation, including an airborne breakup.
        piece.mesh.position.y += .001 - bottom;
        const impact = -piece.velocity.y;
        const heavy = ['chassis', 'turret'].includes(piece.bone.name);
        piece.velocity.y = impact > .65 && elapsed < 1.8 ? impact * (heavy ? .07 : .16) : 0;
        piece.velocity.x *= heavy ? .36 : .56; piece.velocity.z *= heavy ? .36 : .56; piece.spin.multiplyScalar(heavy ? .30 : .46);
        if (elapsed > 2 || piece.velocity.length() < .12 && piece.spin.length() < .1) {
          piece.velocity.set(0, 0, 0); piece.spin.set(0, 0, 0); piece.asleep = true;
        }
        piece.mesh.updateMatrixWorld(true);
      }
    }
  }

  function update(time) {
    if (!active || disposed) return;
    const target = THREE.MathUtils.clamp(Number(time) || 0, 0, 8);
    if (target < elapsed - .0001) resetSimulation();
    while (elapsed + 1 / 120 <= target + 1e-7) { step(1 / 120); elapsed += 1 / 120; }
    group.updateMatrixWorld(true);
    inverseParent.copy(group.matrixWorld).invert();
    pieces.forEach((piece, index) => {
      partBounds.makeEmpty();
      for (const vertex of piece.hull) partBounds.expandByPoint(point.copy(vertex).applyMatrix4(piece.mesh.matrixWorld));
      partBounds.getCenter(center); center.y = .004; center.applyMatrix4(inverseParent);
      partBounds.getSize(shadowScale);
      shadowScale.set(Math.max(.15, shadowScale.x + .18), 1, Math.max(.15, shadowScale.z + .18));
      matrix.compose(center, shadowRotation, shadowScale); contactShadows.setMatrixAt(index, matrix);
      contactShadows.geometry.attributes.contactOpacity.setX(index, .58 * Math.exp(-Math.max(0, partBounds.min.y) * 3.2));
    });
    contactShadows.instanceMatrix.needsUpdate = true;
    contactShadows.geometry.attributes.contactOpacity.needsUpdate = true;
  }
  function getBounds(out = bounds) {
    out.makeEmpty();
    for (const piece of pieces) for (const vertex of piece.hull) out.expandByPoint(point.copy(vertex).applyMatrix4(piece.mesh.matrixWorld));
    return out;
  }
  function transformBonePoint(bone, local, out) {
    const piece = pieces.find(piece => piece.bone === bone);
    return piece ? out.copy(local).applyMatrix4(piece.mesh.matrixWorld) : out;
  }
  function reset() { active = false; group.visible = false; model.visible = true; }
  function dispose() {
    if (disposed) return; disposed = true;
    pieces.forEach(piece => piece.mesh.geometry.dispose()); materials.forEach(material => material.dispose()); group.removeFromParent();
    contactShadows?.geometry.dispose(); contactShadows?.material.dispose(); contactShadows?.dispose();
  }
  return { group, prepare: build, start, update, reset, dispose, getBounds, transformBonePoint, get active() { return active; }, get pieces() { return pieces; } };
}
