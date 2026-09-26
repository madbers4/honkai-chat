import test from 'node:test';
import assert from 'node:assert/strict';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { ACCESSORIES } from '../shared/robot-customization.js';
import { omitUnsupportedReflections } from '../src/render-compatibility.js';

// Exercise the real GLB and the update path shared by arena, warmup and workshop.
// Pixel decoding is irrelevant to the material/reflection ownership assertions.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { Object.assign(this, properties); this.type = type; } };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);

function materialsOf(group) {
  const materials = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  return [...materials];
}
const select = (robot, accessory) => robot.update({ action: 'idle', facing: 1, hp: 180, maxHp: 180,
  customization: { body: 'ruby', core: 'cyan', accessory } }, 1 / 60, 1);

for (const skin of ['amber', 'cyan']) test(`late ${skin} cosmetics cannot restore HDR after a render compatibility fallback`, t => {
  const robot = createRobot({ skin }); t.after(() => robot.dispose());
  // Populate hidden cached accessories before the renderer discovers a failure.
  select(robot, 'crown'); select(robot, 'topHat');
  const crown = robot.group.getObjectByName('RobotAccessory_crown');
  assert.ok(materialsOf(crown).some(material => material.envMap), 'fixture starts with real HDR accessories');
  const armor = materialsOf(robot.group).find(material => material.name === 'Automaton_Armor_PBR');
  const originalMaps = [armor.map, armor.normalMap, armor.roughnessMap, armor.metalnessMap];
  omitUnsupportedReflections(robot.group, false);
  for (const { id } of ACCESSORIES) {
    select(robot, id);
    assert.ok(materialsOf(robot.group).every(material => !material.envMap), `new/cached ${id} retains compatible materials`);
  }
  select(robot, 'crown');
  assert.equal(robot.group.getObjectByName('RobotAccessory_crown'), crown, 'cached geometry is reused safely');
  assert.deepEqual([armor.map, armor.normalMap, armor.roughnessMap, armor.metalnessMap], originalMaps);
  // Destroyed pieces are another late allocation, using the same updated armor.
  robot.update({ action: 'destroyed', hp: 0, destructionTime: .6, customization: { accessory: 'crown' } }, 1 / 60, 2);
  assert.ok(materialsOf(robot.group).every(material => !material.envMap), 'late fracture does not reintroduce PMREM');
});

test('a robot created after fallback and a healthy robot keep independent reflection policies', t => {
  const compatible = createRobot(), healthy = createRobot();
  t.after(() => { compatible.dispose(); healthy.dispose(); });
  const reflection = materialsOf(healthy.group).find(material => material.envMap).envMap;
  omitUnsupportedReflections(compatible.group, false);
  omitUnsupportedReflections(healthy.group, true);
  for (const { id } of ACCESSORIES.filter(item => item.id !== 'none')) {
    select(compatible, id); select(healthy, id);
    assert.ok(materialsOf(compatible.group).every(material => !material.envMap), `${id}: compatible arena/preview stays safe`);
    assert.ok(materialsOf(healthy.group.getObjectByName(`RobotAccessory_${id}`)).every(material => material.envMap === reflection),
      `${id}: supported arena/preview retains authored reflections`);
  }
});
