import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { ARENA_EDGE } from '../shared/constants.js';
import { arenaRootPosition } from '../src/arena-root.js';
import { createCameraChoreography, projectCameraPoint } from '../src/camera-choreography.js';
import { createIndustrialEnvironment } from '../src/environment.js';
import { createDeckSurface } from '../src/deck-surface.js';
import { buildTraversalCase } from '../scripts/traversal-review.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { Object.assign(this, properties); } };
const { createRobot, loadRobotAssets } = await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);

function eachSolidVertex(robot, callback) {
  const point = new THREE.Vector3();
  robot.group.updateMatrixWorld(true);
  robot.group.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    let accessory = false;
    for (let p = mesh; p; p = p.parent) if (p.name.startsWith('RobotAccessory_')) accessory = true;
    if (!mesh.isSkinnedMesh && !accessory) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      callback(point);
    }
  });
}

test('renderer uses authoritative edge roots, including frozen poses and prediction into a wall', () => {
  for (const type of ['far', 'edge', 'bolt']) for (const facing of [-1,1]) {
    for (const state of buildTraversalCase(type, facing).snapshots) for (const player of state.players) {
      assert.deepEqual(arenaRootPosition(player), { x: player.x, y: player.y }, 'a frozen/seek position must not compress the arena');
      const predicted = arenaRootPosition(player, .05);
      assert.ok(Math.abs(predicted.x) <= ARENA_EDGE && predicted.y >= 0);
    }
  }
  assert.deepEqual(arenaRootPosition({ x: ARENA_EDGE, vx: 6.2, y: 0, vy: -2 }, .05), { x: ARENA_EDGE, y: 0 });
});

test('actual animated GLB, toes and high trophies fit throughout traversal at every target viewport and render rate', t => {
  let projections = 0, inspectedVertices = 0, peakX = 0, peakY = 0;
  for (const type of ['cross', 'far', 'edge', 'drop']) for (const facing of [-1, 1]) {
    const data = buildTraversalCase(type, facing);
    const robots = [createRobot(), createRobot({ skin: 'cyan' })];
    // Enclose EVERY actual deformed vertex in narrow y/z cells. Projecting all
    // eight corners is conservative: the whole convex cell remains inside
    // the camera frustum. This is much faster than repeating hundreds of
    // millions of near-identical skin vertices for all render-rate variants.
    const poses = data.snapshots.map((state, index) => {
      const vertices = [], cells = new Map(), shapes = [];
      for (const [i, player] of state.players.entries()) {
        const root = arenaRootPosition(player);
        robots[i].group.position.set(root.x, root.y, 0);
        robots[i].update(player, 1 / 60, index / 60);
        const shape = new THREE.Box3();
        if (index % 6 === 0 || [46,47,48,49,50,86,87].includes(index)) eachSolidVertex(robots[i], p => {
          inspectedVertices++; shape.expandByPoint(p);
          assert.ok(p.y >= -.005, `${type}/${index}: geometry below floor ${p.y}`);
          const key=`${i}:${Math.floor(p.y/.3)}:${Math.floor(p.z/.35)}`;
          if (!cells.has(key)) cells.set(key,new THREE.Box3());
          cells.get(key).expandByPoint(p);
        });
        shapes.push(shape);
      }
      if(type==='cross' && index===47) assert.ok(shapes[0].min.y>shapes[1].max.y+.3,'the real airborne toes clear the real crowned opponent');
      for(const box of cells.values()) for(const x of [box.min.x,box.max.x]) for(const y of [box.min.y,box.max.y]) for(const z of [box.min.z,box.max.z]) vertices.push({x,y,z});
      return vertices;
    });
    for (const aspect of [844 / 390, 16 / 9, 4 / 3]) for (const hz of [30, 60, 120]) for (const reduced of [false, true]) {
      const camera = createCameraChoreography();
      for (let frame = 0; frame < data.snapshots.length * hz / 60; frame++) {
        const i = Math.min(data.snapshots.length - 1, Math.floor(frame * 60 / hz));
        const state = data.snapshots[i], shot = camera.update(1 / hz, state.players, { aspect, reduced });
        for (const p of poses[i]) {
          const q = projectCameraPoint(p, shot, aspect); projections++;
          peakX = Math.max(peakX, Math.abs(q.x)); peakY = Math.max(peakY, Math.abs(q.y));
          assert.ok(Math.abs(q.x) <= .90, `${type}/${facing}/${i}/${hz}Hz: clipped side ${q.x}`);
          assert.ok(q.y >= -.80 && q.y <= .78, `${type}/${facing}/${i}/${hz}Hz: clipped foot/hat ${q.y}`);
        }
      }
    }
    robots.forEach(robot => robot.dispose());
  }
  t.diagnostic(`${inspectedVertices.toLocaleString()} real surface vertices enclosed; ${projections.toLocaleString()} conservative cell-corner projections; maximal |x| ${peakX.toFixed(3)}, |y| ${peakY.toFixed(3)}`);
});

test('camera tracks close fighting at either end and only opens up for actual separation', () => {
  for (const aspect of [844 / 390, 16 / 9, 4 / 3]) {
    const near = buildTraversalCase('close').snapshots[0].players;
    const far = buildTraversalCase('far').snapshots[0].players;
    const closeShot = createCameraChoreography().update(0, near, { aspect });
    const farShot = createCameraChoreography().update(0, far, { aspect });
    assert.ok(farShot.z > closeShot.z * 1.5);
    assert.ok(closeShot.z < 13, `close combat shrank to ${closeShot.z} m`);
    for (const facing of [-1,1]) {
      const shifted = near.map(p => ({ ...p, x: p.x + facing * (ARENA_EDGE - 1.05) }));
      const edgeShot = createCameraChoreography().update(0, shifted, { aspect });
      assert.ok(Math.abs(edgeShot.tx - facing * (ARENA_EDGE - 1.05)) < 1e-9);
      assert.ok(Math.abs(edgeShot.z - closeShot.z) < 1e-9, 'edge fights have the same scale as centre fights');
    }
  }
});

test('expanded floor and real backing wall cover the complete frustum; mural keeps its scale and closed storage bays respect the playable lane', () => {
  const scene = new THREE.Scene(), wallpaper = new THREE.Texture({ width: 3072, height: 1024 });
  const set = createIndustrialEnvironment(scene, wallpaper, createDeckSurface({ resolution: 512 }));
  set.group.updateMatrixWorld(true);
  const floor = set.group.getObjectByName('continuous-club-stone-floor');
  floor.geometry.computeBoundingBox();
  const floorBounds = floor.geometry.boundingBox;
  assert.ok(floorBounds.max.x > ARENA_EDGE + 1.82 && floorBounds.min.x < -ARENA_EDGE - 1.82, 'stone flooring continues beneath the complete playable lane');
  const mural = set.group.getObjectByName('original-belobog-wall');
  assert.equal(mural.geometry.parameters.width, 24); assert.equal(mural.position.x, 0); assert.equal(mural.material.map, wallpaper);
  const black = set.group.getObjectByName('industrial-black').geometry.attributes.position, backing = new THREE.Box3();
  for (let i = 0; i < black.count; i++) if (Math.abs(black.getZ(i) + 3.58) < .001) backing.expandByPoint(new THREE.Vector3().fromBufferAttribute(black,i));
  assert.ok(backing.max.x >= 32 && backing.min.x <= -32, 'coverage is measured from the actual backing mesh');
  assert.equal(set.group.getObjectByName('pressure-receiver-enamel'), undefined, 'abandoned boiler assemblies are removed');
  assert.ok(set.group.getObjectByName('fight-club-closed-storage-bays'), 'both ends terminate in physical barriers');
  const point = new THREE.Vector3(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const perspective = new THREE.PerspectiveCamera(36, 1, .1, 70);
  for (const type of ['far','edge','cross']) for (const facing of [-1,1]) for (const aspect of [844 / 390, 16 / 9, 4 / 3]) {
    const camera = createCameraChoreography();
    const data = buildTraversalCase(type,facing);
    for (const [i,state] of data.snapshots.entries()) {
      const shot = camera.update(1 / 60, state.players, { aspect });
      if (i % 6) continue;
      perspective.aspect=aspect; perspective.updateProjectionMatrix(); perspective.position.set(shot.x,shot.y,shot.z);
      perspective.lookAt(shot.tx,shot.ty,shot.tz); perspective.updateMatrixWorld(); origin.copy(perspective.position);
      for (const x of [-1, -.5, 0, .5, 1]) for (const y of [-1, -.5, 0, .5, 1]) {
        direction.copy(point.set(x,y,.5).unproject(perspective)).sub(origin).normalize();
        const floorT=(floorBounds.min.y-origin.y)/direction.y, wallT=(backing.max.z-origin.z)/direction.z;
        const within = (distance,bounds,axes) => distance>0 && distance<70 && axes.every(axis=>{
          const value=origin[axis]+direction[axis]*distance;return value>=bounds.min[axis]-.01 && value<=bounds.max[axis]+.01;
        });
        assert.ok(within(floorT,floorBounds,['x','z']) || within(wallT,backing,['x','y']), `${type}/${facing}/${aspect}/${i}: empty set at screen ${x},${y}`);
      }
    }
  }
  set.dispose(); wallpaper.dispose();
});
