import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createClubBoundaries } from '../src/club-boundaries.js';
import { ARENA_EDGE } from '../shared/constants.js';

test('both closures continue as solid fence rails into the foreground outside the combat lane', () => {
  const set = createClubBoundaries();
  try {
    for (const side of ['left', 'right']) {
      const item = set.group.userData.props.find(prop => prop.name === `${side}-foreground-fence`);
      assert.ok(item.min[2] < 2.8 && item.max[2] > 40, 'no exposed end at the old gate/cage edge or wide fight framing');
      assert.ok(side === 'left' ? item.max[0] < -ARENA_EDGE - 1.82 : item.min[0] > ARENA_EDGE + 1.82);
      const x = side === 'left' ? item.max[0] - .20 : item.min[0] + .20;
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 2.40, 12), new THREE.Vector3(Math.sign(x), 0, 0));
      assert.ok(ray.intersectObjects(set.group.children, false).length, 'continuous physical waist rail at the extended fence');
    }
  } finally { set.dispose(); }
});

test('closed end props touch the floor, clear the complete fighter silhouette and span the lane', () => {
  const set=createClubBoundaries();
  try {
    for(const name of ['left-locked-mesh-gate','right-stacked-closed-crates']) {
      const item=set.group.userData.props.find(prop=>prop.name===name);
      assert.ok(item);
      assert.ok(item.min[1] < 0 && item.min[1] > -.05, 'foot sockets and crates sit on the finished stone floor');
      assert.ok(item.max[1] > 4.8, 'framing gives the side closure a substantial silhouette');
      assert.ok(item.min[2] < -3.1 && item.max[2] > 2.3, 'barrier returns from the back wall across the fighting depth');
      assert.ok(name.startsWith('left') ? item.max[0] < -ARENA_EDGE-1.82 : item.min[0] > ARENA_EDGE+1.82, 'nothing clips the authoritative toes at the end stop');
    }
  } finally {set.dispose();}
});

test('storage crates have six physical boarded sides, including the underside and rear', () => {
  const set=createClubBoundaries();set.group.updateMatrixWorld(true);
  try {
    const meshes=set.group.children.filter(x=>x.isMesh);
    // Centre of the unobstructed front lower crate. Rays originate inside the
    // crate and look out with BackSide materials, exercising all six closures.
    const center=new THREE.Vector3(ARENA_EDGE+2.02+1.08,.62,1.95);
    for(const mesh of meshes)mesh.material.side=THREE.BackSide;
    const caster=new THREE.Raycaster();
    for(const direction of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      caster.set(center,new THREE.Vector3(...direction));
      const hit=caster.intersectObjects(meshes,false)[0];
      assert.ok(hit && hit.distance < 1.2, `closed crate face along ${direction}`);
    }
  } finally {set.dispose();}
});

test('finished side geometry has a bounded draw budget, real lights and idempotent cleanup', () => {
  const set=createClubBoundaries();
  const meshes=set.group.children.filter(x=>x.isMesh), lights=set.group.children.filter(x=>x.isLight);
  assert.equal(meshes.length,6);
  assert.equal(lights.length,2);
  for(const light of lights)assert.ok(light.isPointLight && light.intensity>0 && !light.castShadow);
  const resources=new Set();let triangles=0,disposed=0;
  for(const mesh of meshes) {
    resources.add(mesh.geometry);resources.add(mesh.material);
    const positions=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal;
    triangles+=positions.count/3;
    for(let i=0;i<positions.array.length;i++)assert.ok(Number.isFinite(positions.array[i]) && Number.isFinite(normals.array[i]));
    assert.ok(mesh.material.isMeshStandardMaterial && !mesh.material.transparent, 'solid faces respond to actual room and robot lights');
  }
  assert.ok(triangles<80000);
  for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
  const scene=new THREE.Scene();scene.add(set.group);
  set.dispose();set.dispose();
  assert.equal(scene.children.length,0);assert.equal(disposed,resources.size);
});
