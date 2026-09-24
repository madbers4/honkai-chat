import { healthPercent } from '../shared/health.js';
import { assetUrl } from './app-paths.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { robotPresentation } from '../shared/robot-presentation.js';
import { choreographStrike, heavyStaggerChoreography } from './robot-choreography.js';
import { choreographGrapple, choreographGrabbed, choreographGrabBreak } from './grapple-choreography.js';
import { createRobotFragments } from './robot-fragments.js';
import { shutdownMotion, rebootMotion } from '../shared/shutdown-motion.js';
import { createRobotMaterialResources, loadRobotSurfaceAssets } from './robot-materials.js';
import { slamChoreography, slamBounceChoreography } from './slam-choreography.js';
import { recoilChoreography } from './recoil-choreography.js';
import { createMechanicalTurn, turnStartup } from './mechanical-turn.js';
import { specialChoreography, electricalReaction } from './special-choreography.js';
import { choreographOverload, choreographOverloadHit } from './overload-choreography.js';

// The user's Automaton Beetle, repaired and rigid-skinned in prepare-model.py.
// The four articulated leg chains use CCD toward planted feet / attack targets;
// the turret is independently sprung, so the robot never moves as a rigid prop.
let template;
let loading;
export async function loadRobotAssets() {
  if (template) return template;
  if (!loading) loading = Promise.all([
    new GLTFLoader().loadAsync(assetUrl('/assets/automaton.glb?v=signals-v4')),
    loadRobotSurfaceAssets(),
  ]).then(([gltf]) => { template = gltf.scene; return template; })
    .catch((error) => { loading = undefined; throw error; });
  return loading;
}

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const pulse = (t, a, b, c) => t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));
const TAU = Math.PI * 2;
const supportCache = new WeakMap();
const strikeEnvelope = (t, startup, duration, hold = .055) => t <= startup
  ? smooth((t - startup + .055) / .055)
  : 1 - smooth((t - startup - hold) / Math.max(.06, duration - startup - hold));

// Each original mechanical part is rigid weighted. Its convex hull therefore
// gives the exact support minimum under any joint rotation, with far fewer
// vertices than a full per-frame skin scan. No proxy boxes or guessed body lift.
function supportHulls(mesh) {
  if (supportCache.has(mesh.geometry)) return supportCache.get(mesh.geometry);
  const position = mesh.geometry.attributes.position;
  const indices = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  const clusters = new Map();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(weights.getX(i) - 1) > 1e-5) throw new Error('Automaton support requires its rigid mechanical skin.');
    const index = indices.getX(i);
    if (!clusters.has(index)) clusters.set(index, new Map());
    vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[index]);
    const key = `${Math.round(vertex.x * 1e6)},${Math.round(vertex.y * 1e6)},${Math.round(vertex.z * 1e6)}`;
    if (!clusters.get(index).has(key)) clusters.get(index).set(key, vertex.clone());
  }
  const hulls = [];
  for (const [index, vertices] of clusters) {
    const points = [...vertices.values()];
    const hull = points.length > 4 ? new ConvexHull().setFromPoints(points) : null;
    const surface = new Set();
    if (hull) for (const face of hull.faces) {
      let edge = face.edge;
      do { surface.add(edge.head().point); edge = edge.next; } while (edge !== face.edge);
    }
    hulls.push({ index, points: [...(surface.size ? surface : points)] });
  }
  supportCache.set(mesh.geometry, hulls);
  return hulls;
}

export function createRobot({ skin = 'amber' } = {}) {
  if (!template) throw new Error('Call await loadRobotAssets() before createRobot().');
  const group = new THREE.Group();
  group.name = `Automaton_${skin}`;
  const turntable = new THREE.Group();
  group.add(turntable);
  const model = cloneSkeleton(template);
  turntable.add(model);
  const tint = new THREE.Color(skin === 'cyan' ? 0x52e8ff : 0xffb23f);
  const lensMaterials = [];
  const signalMaterials = { health: [], status: [], reactor: [] };
  const signalMeshes = {};
  const ownMaterials = [];
  const surfaceResources = createRobotMaterialResources();
  const materialCopies = new Map();
  const bones = {};
  const supports = [];
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) for (const hull of supportHulls(o)) supports.push({ bone: o.skeleton.bones[hull.index], points: hull.points });
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // Articulated strikes extend beyond the bind-pose box.
    const material = (m) => {
      if (materialCopies.has(m)) return materialCopies.get(m);
      const copy = m.name.includes('Lenses') ? m.clone() : surfaceResources.cloneArmor(m, skin);
      if (m.name.includes('Lenses')) {
        const channel = m.userData.signalChannel || m.name.split('_').at(-1).toLowerCase();
        if (!signalMaterials[channel]) throw new Error(`Unclassified original lens material: ${m.name}`);
        copy.userData.signalChannel = channel;
        copy.userData.glowSource = 'emissive';
        copy.color.copy(tint).multiplyScalar(.14);
        copy.emissive.copy(tint);
        copy.emissiveIntensity = .75;
        // Preserve readable saturated signal hues under the arena's filmic
        // exposure. Armour continues using the normal scene tone mapping.
        copy.toneMapped = false;
        lensMaterials.push(copy);
        signalMaterials[channel].push(copy);
      }
      ownMaterials.push(copy);
      materialCopies.set(m, copy);
      return copy;
    };
    o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
    if (o.material.userData?.signalChannel) signalMeshes[o.material.userData.signalChannel] = o;
  });
  const chassis = bones.chassis;
  const turret = bones.turret;
  const basePosition = chassis.position.clone();
  const rest = new Map(Object.values(bones).map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  group.updateMatrixWorld(true);
  // Faults emerge from real exterior vertices, not from bone pivots inside
  // armour. Use the same cached rigid hulls as contact, on the camera side.
  function surfaceSource(bone) {
    const points = supports.filter(hull => hull.bone === bone).flatMap(hull => hull.points);
    if (!points.length) throw new Error(`No source surface for ${bone.name}.`);
    return { bone, points, local: points[0].clone() };
  }
  const damageSources = {
    core: surfaceSource(chassis),
    head: surfaceSource(turret),
    left: surfaceSource(bones.leg_FL_knee),
    right: surfaceSource(bones.leg_FR_knee),
  };
  const damageAnchors = Object.fromEntries(Object.keys(damageSources).map(name => [name, new THREE.Vector3()]));
  function lensMount(channel, bone) {
    const mesh = signalMeshes[channel];
    mesh.geometry.computeBoundingBox();
    const point = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    point.z = mesh.geometry.boundingBox.max.z + .025;
    return bone.worldToLocal(mesh.localToWorld(point));
  }
  const muzzleLocal = lensMount('status', turret);
  const headLocal = lensMount('health', turret);
  const coreLocal = lensMount('reactor', chassis);
  const combatAnchors = Object.fromEntries(['leftClaw', 'rightClaw', 'leftClawBase', 'rightClawBase', 'muzzle', 'core', 'head'].map(name => [name, new THREE.Vector3()]));
  const headLamp = new THREE.SpotLight(0x35d96d, 8, 6.5, .63, .65, 1.3);
  headLamp.name = 'OriginalLens_Spill'; headLamp.castShadow = false;
  headLamp.position.copy(muzzleLocal);
  headLamp.target.position.copy(muzzleLocal).add(new THREE.Vector3(0, -1.2, 4));
  turret.add(headLamp, headLamp.target);
  const reactorLamp = new THREE.PointLight(tint, 3, 3.8, 1.4);
  reactorLamp.name = 'OriginalReactor_Spill'; reactorLamp.castShadow = false;
  reactorLamp.position.copy(coreLocal);
  chassis.add(reactorLamp);
  const coreSource = signalMeshes.reactor;
  const coreGeometry = coreSource.geometry.clone();
  const coreBoneIndex = coreSource.skeleton.bones.indexOf(chassis);
  coreGeometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(coreSource.skeleton.boneInverses[coreBoneIndex], coreSource.bindMatrix));
  const extractedCore = new THREE.Mesh(coreGeometry, coreSource.material);
  extractedCore.name = 'OriginalReactor_Extraction'; extractedCore.visible = false; extractedCore.castShadow = true;
  chassis.add(extractedCore);
  coreSource.userData.fractureOffset = extractedCore.position;
  const surfaceDirection = new THREE.Vector3(0, .20, 1).normalize();
  const surfacePoint = new THREE.Vector3();
  const legs = ['FL', 'FR', 'RL', 'RR'].map((side, i) => {
    const tip = bones[`leg_${side}_tip`];
    const home = model.worldToLocal(tip.getWorldPosition(new THREE.Vector3()));
    return {
      side, front: side[0] === 'F', sign: side[1] === 'L' ? -1 : 1,
      chain: ['foot', 'ankle', 'knee', 'hip'].map((n) => bones[`leg_${side}_${n}`]),
      tip, home, desired: home.clone(), target: home.clone(), world: home.clone(),
      phaseOffset: [0, 0.5, 0.5, 0][i], wasSwing: false, stanceZ: home.z,
      swingStart: home.z,
    };
  });

  // Faint energy auras sit on the original head, keeping player identity legible
  // even in a crowded close-range exchange. These are not replacement geometry.
  const glowMaterial = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glowGeometry = new THREE.SphereGeometry(0.17, 12, 8);
  const chargeGlow = new THREE.Mesh(glowGeometry, glowMaterial);
  chargeGlow.position.set(0, 0.30, 0.23);
  turret.add(chargeGlow);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ringGeometry = new THREE.TorusGeometry(0.34, 0.014, 6, 32);
  const chargeRing = new THREE.Mesh(ringGeometry, ringMaterial);
  chargeRing.position.set(0, 0.30, 0.28);
  turret.add(chargeRing);

  const rootTarget = new THREE.Vector3();
  const rootOffset = new THREE.Vector3();
  const headEuler = new THREE.Euler();
  const bodyEuler = new THREE.Euler();
  const headTarget = new THREE.Quaternion();
  const bodyTarget = new THREE.Quaternion();
  const bodyQ = new THREE.Quaternion();
  const headQ = new THREE.Quaternion();
  const pivot = new THREE.Vector3();
  const end = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toGoal = new THREE.Vector3();
  const parentQ = new THREE.Quaternion();
  const correction = new THREE.Quaternion();
  const identityQ = new THREE.Quaternion();
  const supportPoint = new THREE.Vector3();
  const supportBounds = new THREE.Box3();
  const shadowCenter = new THREE.Vector3();
  const contactShadow = { x: 0, z: 0, width: 3, depth: 3, height: 0 };
  const koEntry = new Map();
  const recoverEntry = new Map();
  const koBody = new THREE.Quaternion();
  const koHead = new THREE.Quaternion();
  const koOffset = new THREE.Vector3();
  const recoverBody = new THREE.Quaternion();
  const recoverHead = new THREE.Quaternion();
  const recoverOffset = new THREE.Vector3();
  const fragments = createRobotFragments(group, model);
  let gait = 0;
  let motion = 0;
  let facing = 1;
  let lastX;
  let lastAction = 'idle';
  let lastVariant = '';
  let previousElapsed = 0;
  let previousY = 0;
  let slamLandingTime = null;
  let thrownLandingTime = null;
  let localActionTime = 0;
  let hitFlare = 0;
  let lastHealth;
  let damageMotion = 0;
  let healthRecoil = 0;
  let pausedPoseKey = null;
  let disposed = false;
  let renderedFrames = 0;
  let wasHoldingGrip = false;
  const mechanicalTurn = createMechanicalTurn();
  const turnFeet = legs.map(() => new THREE.Vector3());
  const turnHomes = legs.map(leg => ({ ...leg.home, side: leg.side }));
  let lastTurnFacing;

  function solve(leg) {
    leg.world.copy(leg.target);
    model.localToWorld(leg.world);
    // The bind pose is the stable pole preference. Constrained angular movement
    // from it prevents flips while keeping every link rigid and every joint alive.
    for (let iteration = 0; iteration < 7; iteration++) {
      leg.tip.getWorldPosition(end);
      if (end.distanceToSquared(leg.world) < 0.000018) break;
      for (let index = 0; index < leg.chain.length; index++) {
        const bone = leg.chain[index];
        bone.getWorldPosition(pivot);
        leg.tip.getWorldPosition(end);
        bone.parent.getWorldQuaternion(parentQ).invert();
        toEnd.copy(end).sub(pivot).applyQuaternion(parentQ).normalize();
        toGoal.copy(leg.world).sub(pivot).applyQuaternion(parentQ).normalize();
        correction.setFromUnitVectors(toEnd, toGoal);
        const angle = identityQ.angleTo(correction);
        if (angle > 0.34) correction.slerp(identityQ, 1 - 0.34 / angle);
        bone.quaternion.premultiply(correction);
        const original = rest.get(bone).q;
        const limit = [1.4, 1.45, 1.1, 1.35][index];
        const deviation = original.angleTo(bone.quaternion);
        if (deviation > limit) bone.quaternion.slerp(original, 1 - limit / deviation);
        bone.updateMatrixWorld(true);
      }
    }
  }

  function updateGroundSupport() {
    group.updateWorldMatrix(true, false);
    // SkinnedMesh overrides updateMatrixWorld (not updateWorldMatrix) to keep
    // its attached bind inverse current after root/contact displacement.
    group.updateMatrixWorld(true);
    supportBounds.makeEmpty();
    for (const hull of supports) for (const point of hull.points) {
      supportPoint.copy(point).applyMatrix4(hull.bone.matrixWorld);
      supportBounds.expandByPoint(supportPoint);
    }
    // Solve contact after posing, so folding limbs and the housing are all
    // supported. The correction is continuous as the silhouette rolls over.
    const lift = Math.max(0, .0005 - supportBounds.min.y);
    if (lift > 0) {
      model.position.y += lift;
      supportBounds.min.y += lift;
      supportBounds.max.y += lift;
      model.updateMatrixWorld(true);
    }
    supportBounds.getCenter(shadowCenter);
    group.worldToLocal(shadowCenter);
    contactShadow.x = shadowCenter.x;
    contactShadow.z = shadowCenter.z;
    contactShadow.width = supportBounds.max.x - supportBounds.min.x;
    contactShadow.depth = supportBounds.max.z - supportBounds.min.z;
    contactShadow.height = Math.max(0, supportBounds.min.y);
  }

  function updateDamageAnchors() {
    for (const [name, source] of Object.entries(damageSources)) {
      const anchor = damageAnchors[name];
      anchor.copy(source.local).applyMatrix4(source.bone.matrixWorld);
      let nearestSurface = anchor.dot(surfaceDirection);
      for (const point of source.points) {
        surfacePoint.copy(point).applyMatrix4(source.bone.matrixWorld);
        const projection = surfacePoint.dot(surfaceDirection);
        // Tiny hysteresis avoids switching neighboring surface vertices
        // from subpixel servo movement while retaining exterior support.
        if (projection > nearestSurface + .007) {
          nearestSurface = projection;
          source.local.copy(point);
          anchor.copy(surfacePoint);
        }
      }
      anchor.addScaledVector(surfaceDirection, .025);
    }
    bones.leg_FL_tip.getWorldPosition(combatAnchors.leftClaw);
    bones.leg_FR_tip.getWorldPosition(combatAnchors.rightClaw);
    bones.leg_FL_foot.getWorldPosition(combatAnchors.leftClawBase);
    bones.leg_FR_foot.getWorldPosition(combatAnchors.rightClawBase);
    combatAnchors.muzzle.copy(muzzleLocal).applyMatrix4(turret.matrixWorld);
    combatAnchors.head.copy(headLocal).applyMatrix4(turret.matrixWorld);
    combatAnchors.core.copy(coreLocal).applyMatrix4(chassis.matrixWorld);
    if (extractedCore.visible) {
      combatAnchors.core.copy(coreLocal).add(extractedCore.position).applyMatrix4(chassis.matrixWorld);
      damageAnchors.core.copy(combatAnchors.core);
    }
  }

  // Entry targets are actual articulated toes, rather than stale walking
  // targets. This also catches a loss in the middle of a punch or grapple.
  for (const leg of legs) {
    leg.shutdownEntry = leg.home.clone();
    leg.rebootEntry = leg.home.clone();
  }

  function update(player = {}, dt = 1 / 60, time = 0) {
    if (disposed) return;
    const poseKey = [player.action, player.variant, player.actionTime, player.hp, player.guard, player.energy,
      player.facing, player.y, player.grabTarget, player.grabbedBy, player.grabHoldTime, player.grabReleaseTime,
      player.grabStrikeTime, player.grabThrowTime, player.destructionTime, player.visualReducedMotion, player.visualSeekToken].join('|');
    if (player.visualPaused && dt <= 0) {
      if (poseKey !== pausedPoseKey) {
        pausedPoseKey = poseKey;
        // A review seek requests a definite mechanical pose. Settle its
        // springs at that one authoritative time; do not advance the action.
        for (let i = 0; i < 10; i++) update(player, .05, time);
      } else {
        if (fragments.active) {
          fragments.update(player.destructionTime ?? player.actionTime ?? 0);
          for (const [name, source] of Object.entries(damageSources)) fragments.transformBonePoint(source.bone, source.local, damageAnchors[name]);
        } else {
          model.position.y = 0;
          updateGroundSupport();
          updateDamageAnchors();
        }
      }
      return;
    }
    pausedPoseKey = poseKey;
    dt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, 0.05);
    const action = player.action || 'idle';
    const variant = player.variant || '';
    const ordinaryHit = action === 'hit' && (!variant || ['slamBounce', 'heavyStagger'].includes(variant))
      && !(player.guard <= 0 && Math.abs((Number(player.actionDuration) || .32) - .95) < .025);
    const reducedMotion = Boolean(player.visualReducedMotion);
    const presentation = robotPresentation({ ...player, skin: player.skin || skin }, time, { reducedMotion });
    if (action === 'destroyed') {
      if (!fragments.active) {
        // Reconnect/seek may first observe the wreck. Replay the canonical
        // mechanical lead-in so it fractures from the same final pose.
        if (lastAction !== 'defeated') for (let i = 0; i <= 129; i++) update({ ...player, action: 'defeated', actionTime: i / 60, actionDuration: 3.7, visualPaused: false }, 1 / 60, i / 60);
        fragments.start(player.variant);
      }
      fragments.update(player.destructionTime ?? player.actionTime ?? 0);
      for (const [name, source] of Object.entries(damageSources)) fragments.transformBonePoint(source.bone, source.local, damageAnchors[name]);
      const box = fragments.getBounds();
      box.getCenter(shadowCenter); group.worldToLocal(shadowCenter);
      Object.assign(contactShadow, { x: shadowCenter.x, z: shadowCenter.z, width: box.max.x - box.min.x, depth: box.max.z - box.min.z, height: Math.max(0, box.min.y) });
      headLamp.intensity = reactorLamp.intensity = 0;
      lastAction = action; lastVariant = player.variant || '';
      previousElapsed = Number(player.actionTime) || 0;
      return;
    }
    if (fragments.active) fragments.reset();
    if (action === 'defeated') fragments.prepare(); // Prepare during offer/seize, never at the explosion beat.
    const hp = healthPercent(player);
    if (lastHealth !== undefined && hp < lastHealth) healthRecoil = Math.max(healthRecoil, Math.min(.65, (lastHealth - hp) / 32));
    if (lastHealth !== undefined && hp > lastHealth + 10) healthRecoil = 0;
    lastHealth = hp;
    damageMotion = THREE.MathUtils.damp(damageMotion, Math.max(0, (presentation.damage - .25) / .75), 5, dt);
    healthRecoil = Math.max(0, healthRecoil - dt * 3.6);
    const rewound = Number.isFinite(player.actionTime) && player.actionTime < previousElapsed - .04;
    const actionChanged = action !== lastAction || variant !== lastVariant || rewound;
    const releasingGrip = wasHoldingGrip && !player.grabTarget && Number.isFinite(player.grabReleaseTime);
    if (releasingGrip || actionChanged && action === 'hit' && ['grabBreak', 'thrown'].includes(variant)) {
      for (const leg of legs) {
        leg.grappleEntry ||= leg.home.clone();
        model.worldToLocal(leg.tip.getWorldPosition(leg.grappleEntry));
      }
    }
    wasHoldingGrip = Boolean(player.grabTarget);
    if (actionChanged) {
      if (action === 'ko' && !(lastAction === 'ko' && rewound)) {
        koBody.copy(bodyQ); koHead.copy(headQ); koOffset.copy(rootOffset);
        for (const leg of legs) {
          model.worldToLocal(leg.tip.getWorldPosition(leg.shutdownEntry));
          for (const bone of leg.chain) koEntry.set(bone, bone.quaternion.clone());
        }
      }
      if (action === 'recover' && !(lastAction === 'recover' && rewound)) {
        // A late connection has no previous pose. Reconstruct the same upright
        // parked robot, never the obsolete sideways corpse. The round winner
        // retains its actual victory pose instead of collapsing on reset.
        if ((player.actionDuration || 1.6) > 1 && (renderedFrames === 0 || lastAction === 'destroyed')) {
          const parked = shutdownMotion(2);
          rootOffset.set(0, parked.bob, 0);
          bodyQ.setFromEuler(new THREE.Euler(parked.lean, 0, 0));
          headQ.setFromEuler(new THREE.Euler(parked.headPitch, 0, 0));
          chassis.position.copy(basePosition).add(rootOffset); chassis.quaternion.copy(bodyQ); turret.quaternion.copy(headQ);
          model.position.y = 0; model.updateMatrixWorld(true);
          for (const leg of legs) {
            for (const bone of leg.chain) bone.quaternion.copy(rest.get(bone).q);
            leg.target.copy(leg.home); leg.target.x *= leg.front ? parked.frontSpread : parked.rearSpread;
            solve(leg);
          }
          updateGroundSupport();
        }
        recoverBody.copy(bodyQ); recoverHead.copy(headQ); recoverOffset.copy(rootOffset);
        for (const leg of legs) {
          model.worldToLocal(leg.tip.getWorldPosition(leg.rebootEntry));
          for (const bone of leg.chain) recoverEntry.set(bone, bone.quaternion.clone());
        }
      }
      slamLandingTime = null;
      thrownLandingTime = null;
      localActionTime = Number(player.actionTime) || 0;
      lastAction = action;
      lastVariant = variant;
      if (action === 'hit') hitFlare = variant === 'grabbed' ? .35 : variant === 'grabBreak' ? .55 : ordinaryHit ? .28 : 1;
      else if (variant === 'burst') hitFlare = .7;
      else if (variant === 'parry') hitFlare = .55;
    } else localActionTime += dt;
    const elapsed = Number.isFinite(player.actionTime) ? player.actionTime : localActionTime;
    const duration = Math.max(0.12, Number(player.actionDuration) || ({ light: .34, heavy: .81, dash: .3, special: .72, ultimate: 1.8, hit: .32, ko: 1.5 }[action] || 1));
    const p = clamp(elapsed / duration, 0, 1);
    const speed = Math.abs(player.vx || 0);
    const moving = action === 'walk' || speed > .16 && (['idle', 'jump'].includes(action) || action === 'dash' && variant === 'feint');
    motion = THREE.MathUtils.damp(motion, moving ? Math.min(1, speed / 1.8 || 1) : 0, 11, dt);
    facing = player.facing === -1 ? -1 : 1;
    // Paired grips turn directly toward the other chassis so the real claws
    // can meet it, instead of reaching across the camera-facing presentation.
    const grabReleased = Number.isFinite(player.grabReleaseTime);
    const grabAim = ['finisher', 'defeated'].includes(action) && variant !== 'offer' ? 1 : action === 'heavy' && variant === 'grab'
      ? player.grabTarget ? 1 : grabReleased ? 1 - smooth((elapsed - player.grabReleaseTime) / .30)
        : smooth((elapsed - .10) / .14) * (1 - smooth((elapsed - .40) / .55))
      : action === 'hit' && variant === 'grabbed' ? 1 : 0;
    const yaw = facing * (Math.PI / 2 - .45 * (1 - grabAim));
    if (facing !== lastTurnFacing) for (const [i, leg] of legs.entries()) leg.tip.getWorldPosition(turnFeet[i]);
    lastTurnFacing = facing;
    const turning = mechanicalTurn.update({ targetYaw: yaw, facing,
      allowed: ['idle', 'walk', 'jump'].includes(action), airborne: (player.y || 0) > .03,
      time, dt, root: group.position, feet: turnFeet, homes: turnHomes,
      startup: turnStartup(player), actionTime: elapsed,
      reset: renderedFrames === 0, token: player.visualSeekToken, reduced: reducedMotion });
    turntable.rotation.y = turning.yaw;
    const dx = lastX === undefined ? 0 : clamp(group.position.x - lastX, -.18, .18);
    lastX = group.position.x;
    const forwardDelta = dx * facing;
    const direction = Math.sign((player.vx || facing) * facing) || 1;
    gait += dt * (1.4 + speed * .95) * motion;
    const breathe = Math.sin(time * 2.7 + (skin === 'cyan' ? 2.4 : 0));
    let bob = .012 * breathe + Math.sin(gait * TAU * 2) * .019 * motion;
    let lean = direction * -.06 * motion;
    let roll = Math.sin(gait * TAU) * .035 * motion;
    let twist = 0;
    let thrust = 0;
    let headPitch = -lean * .65;
    let headYaw = Math.sin(time * 1.7) * .028;
    let headRoll = -roll * .75;
    let charge = 0;
    let reactorOpen = 0;
    let hit = 0;
    const shutdown = action === 'ko' ? shutdownMotion(elapsed, { reducedMotion }) : null;
    const reboot = action === 'recover' ? rebootMotion(p) : null;

    model.position.y = 0;

    for (const [bone, pose] of rest) { bone.quaternion.copy(pose.q); bone.position.copy(pose.p); }
    for (const leg of legs) {
      leg.desired.copy(leg.home);
      const phase = (gait + leg.phaseOffset) % 1;
      const swing = phase < .42;
      if (motion > .1 && moving) {
        if (swing) {
          if (!leg.wasSwing) leg.swingStart = leg.stanceZ;
          const amount = smooth(phase / .42);
          leg.desired.z = lerp(leg.swingStart, leg.home.z + .27 * direction, amount);
          const limp = leg.side === 'FL' ? 1 - damageMotion * .30 : 1;
          leg.desired.y += Math.sin(Math.PI * phase / .42) * .25 * motion * limp;
          leg.stanceZ = leg.desired.z;
        } else {
          leg.stanceZ = clamp(leg.stanceZ - forwardDelta, leg.home.z - .43, leg.home.z + .43);
          leg.desired.z = leg.stanceZ;
        }
        leg.desired.z = lerp(leg.home.z, leg.desired.z, motion);
      } else {
        leg.stanceZ = leg.home.z;
        leg.swingStart = leg.home.z - .22 * direction;
      }
      leg.wasSwing = swing;
    }

    // A damaged servo carries its load asymmetrically. Feet remain solver
    // targets; this changes the mechanism's acting, never the gameplay speed.
    if (['idle', 'walk', 'crouch'].includes(action)) {
      const faultPhase = (Math.max(0, time) + (skin === 'cyan' ? 1.7 : 0)) % 4.8;
      const fault = reducedMotion ? 0 : pulse(faultPhase, 3.75, 3.84, 4.10) * Math.sin(faultPhase * 51) * damageMotion;
      bob -= damageMotion * .033 + healthRecoil * .025;
      roll += damageMotion * .045 + fault * .015;
      lean += damageMotion * .028 - healthRecoil * .06;
      headRoll -= damageMotion * .028 + fault * .05;
      headYaw += damageMotion * Math.sin(time * 1.3) * .045 + fault * .065;
      headPitch += damageMotion * .055 + healthRecoil * .09;
      for (const leg of legs) if (leg.side === 'FR' || leg.side === 'RL') leg.desired.x *= 1 + damageMotion * .025;
    }

    if (action === 'crouch' || action === 'block') {
      bob -= action === 'block' ? .15 : .28;
      lean -= .06;
      headPitch += .11;
      const parrySnap = variant === 'parry' ? pulse(elapsed, 0, .035, .22) : 0;
      thrust -= parrySnap * .06;
      headPitch -= parrySnap * .12;
      for (const leg of legs) {
        leg.desired.x *= 1.08;
        if (leg.front && action === 'block') {
          leg.desired.x = leg.sign * .43;
          leg.desired.y = 1.1 + parrySnap * .16;
          leg.desired.z = 1.0 + parrySnap * .12;
        }
      }
    } else if ((action === 'light' && ['jab', 'cross', 'rake', 'airJab', 'airCross', 'airFinish'].includes(variant)) || action === 'heavy' && ['crusher', 'heavyDrive', 'heavyHook', 'heavyPress'].includes(variant)) {
      const acting = choreographStrike(variant, elapsed, duration, legs, { y: player.y || 0, vy: player.vy || 0 });
      bob += acting.bob; lean += acting.lean; roll += acting.roll; twist += acting.twist;
      thrust += acting.thrust; headPitch += acting.headPitch; headYaw += acting.headYaw;
    } else if (action === 'light') {
      const rushing = variant === 'dashStrike';
      const startup = rushing ? .13 : .105;
      const pull = pulse(elapsed, 0, startup * .5, startup);
      const strike = strikeEnvelope(elapsed, startup, duration, .045);
      const activeSide = (player.combo || 0) % 2 ? 'FL' : 'FR';
      bob -= rushing ? .13 * strike + .04 * pull : .045 * strike;
      thrust += strike * (rushing ? .26 : .16) - pull * .09;
      lean += strike * (rushing ? .27 : .14) - pull * .12;
      roll += (activeSide === 'FL' ? -1 : 1) * strike * .13;
      headYaw = (activeSide === 'FL' ? 1 : -1) * strike * .16;
      for (const leg of legs) {
        if (leg.side === activeSide) {
          leg.desired.x = lerp(leg.home.x, leg.sign * .24, strike);
          leg.desired.y += (rushing ? .9 : .78) * strike + .38 * pull;
          leg.desired.z += (rushing ? 1.10 : .85) * strike - .3 * pull;
        } else if (leg.front) leg.desired.z -= .1 * strike;
        else leg.desired.x *= 1 + strike * .06;
      }
    } else if (action === 'heavy') {
      if (variant === 'grab') {
        const acting = choreographGrapple(player, elapsed, duration, legs, model, facing);
        bob += acting.bob; lean += acting.lean; roll += acting.roll; twist += acting.twist;
        thrust += acting.thrust; headPitch += acting.headPitch; headYaw += acting.headYaw;
      } else if (variant === 'launcher') {
        const coil = pulse(elapsed, 0, .14, .25);
        const rise = strikeEnvelope(elapsed, .24, duration, .09);
        bob -= coil * .23;
        bob += rise * .07;
        lean += rise * .10 - coil * .14;
        thrust += rise * .18;
        headPitch -= rise * .18;
        for (const leg of legs) {
          if (leg.front) {
            leg.desired.x = lerp(leg.home.x, leg.sign * .42, Math.max(coil, rise));
            leg.desired.y = leg.home.y + 1.42 * rise + .08 * coil;
            leg.desired.z += rise * .42 + coil * .22;
          } else leg.desired.x *= 1.08;
        }
      } else if (variant === 'slam') {
        if (Number.isFinite(player.landedTime)) slamLandingTime = player.landedTime;
        else if (slamLandingTime === null && !actionChanged && previousY > .02 && (player.y || 0) <= .02) slamLandingTime = elapsed;
        const slam = slamChoreography({ elapsed, y: player.y, vy: player.vy, vx: player.vx,
          facing, landedTime: slamLandingTime, reducedMotion });
        bob += slam.bob;
        lean += slam.lean;
        headPitch += slam.headPitch;
        for (const leg of legs) {
          const support = leg.front ? slam.front : slam.rear;
          leg.desired.x = leg.home.x * support.xScale;
          leg.desired.y = leg.home.y + support.y;
          leg.desired.z = leg.home.z + support.z;
        }
      } else {
        const windup = pulse(elapsed, 0, .23, .365);
        const smash = strikeEnvelope(elapsed, .36, duration, .065);
        bob -= windup * .085 + smash * .17;
        thrust += smash * .24 - windup * .14;
        lean += smash * .21 - windup * .16;
        headPitch += smash * .09 - windup * .19;
        for (const leg of legs) if (leg.front) {
          leg.desired.y += windup * 1.26 + smash * .27;
          leg.desired.z += smash * .8 - windup * .13;
          leg.desired.x = lerp(leg.home.x, leg.sign * .49, Math.max(windup, smash));
        } else leg.desired.x *= 1 + .08 * windup;
      }
    } else if (action === 'dash') {
      const dash = Math.sin(p * Math.PI);
      if (variant === 'airDash') {
        lean += .32 * dash; headPitch -= .18 * dash; thrust += .09 * dash;
        roll += .09 * dash;
        for (const leg of legs) {
          leg.desired.x *= .65; leg.desired.y += leg.front ? .60 : .74;
          leg.desired.z *= .62; if (leg.front) leg.desired.z += .20 * dash;
        }
      } else if (variant === 'feint') {
        const retract = 1 - smooth(p / .8);
        const abort = 1 - smooth(elapsed / .095);
        bob -= .11 * dash;
        lean += .10 * abort - .17 * dash;
        thrust += .075 * abort - .07 * dash;
        twist += .10 * dash;
        headPitch += .11 * dash;
        headYaw -= Math.sin(p * Math.PI) * .07;
        for (const leg of legs) if (leg.front) {
          leg.desired.x = lerp(leg.home.x, leg.sign * .70, retract);
          leg.desired.z -= .32 * retract;
          leg.desired.y += .50 * retract;
        }
      } else {
        bob -= .2 * dash;
        lean += .21 * dash;
        headPitch -= .1 * dash;
        for (const leg of legs) {
          leg.desired.z -= .35 * dash;
          leg.desired.y += leg.front ? .12 * dash : .03;
        }
      }
    } else if (action === 'jump') {
      const lift = smooth(Math.min((player.y || 0) * 2 + .15, 1));
      lean = clamp(-(player.vy || 0) * .02, -.16, .14);
      for (const leg of legs) {
        leg.desired.x *= 1 - lift * .23;
        leg.desired.y += .36 * lift;
        leg.desired.z *= 1 - lift * .14;
      }
    } else if (action === 'land') {
      const compress = pulse(elapsed, 0, .045, duration);
      bob -= .22 * compress; lean += .08 * compress; headPitch -= .10 * compress;
      for (const leg of legs) { leg.desired.x *= 1 + .12 * compress; leg.desired.z *= 1 + .07 * compress; }
    } else if (action === 'special') {
      if (variant === 'burst') {
        const vent = 1 - smooth(elapsed / .24);
        const flare = pulse(elapsed, 0, .065, .43);
        const airborne = smooth(Math.max(0, (player.y || 0)) * 3);
        const recoil = pulse(elapsed, .08, .145, .45);
        charge = vent * 1.65;
        bob -= vent * lerp(.16, .045, airborne);
        lean += recoil * .055 - vent * .06;
        roll += reducedMotion ? 0 : Math.sin(elapsed * 32) * vent * .035;
        headPitch += recoil * .095 - vent * .17;
        headYaw += reducedMotion ? 0 : Math.sin(elapsed * 35) * vent * .08;
        for (const leg of legs) {
          leg.desired.x *= 1 + flare * .19;
          leg.desired.z *= 1 + flare * .11;
          leg.desired.y += airborne * (.18 + vent * .18) + (leg.front ? flare * .11 : 0);
        }
      } else {
        const acting = specialChoreography(variant, elapsed, { reducedMotion });
        charge = acting.charge; bob += acting.bob; thrust += acting.thrust;
        lean += acting.lean; twist += acting.twist;
        headPitch += acting.headPitch; headYaw += acting.headYaw;
        for (const leg of legs) {
          const support = leg.front ? acting.front : acting.rear;
          leg.desired.x *= support.xScale;
          leg.desired.z += support.z; leg.desired.y += support.lift;
        }
      }
    } else if (action === 'ultimate' || action === 'victory' && variant === 'overloadRecovery' && elapsed < duration) {
      const releasedAt = action === 'victory' ? 2.28 - duration : null;
      const acting = choreographOverload(releasedAt == null ? elapsed : elapsed + releasedAt, legs, reducedMotion, releasedAt);
      bob = acting.bob; lean += acting.lean; roll += acting.roll; twist += acting.twist;
      thrust += acting.thrust; headPitch = acting.headPitch; headYaw = acting.headYaw; headRoll = acting.headRoll;
      charge = acting.charge; reactorOpen = acting.open;
    } else if (action === 'hit') {
      if (variant === 'overloadHit') {
        const acting = choreographOverloadHit(elapsed, duration, legs, reducedMotion);
        bob = acting.bob; lean += acting.lean; roll += acting.roll; twist += acting.twist;
        thrust += acting.thrust; headPitch = acting.headPitch; headYaw = acting.headYaw; headRoll = acting.headRoll;
        charge = acting.charge;
      } else if (variant === 'heavyStagger') {
        const acting = heavyStaggerChoreography(elapsed, duration);
        bob += acting.bob; thrust += acting.thrust; lean += acting.lean; headPitch += acting.headPitch;
        for (const leg of legs) if (!leg.front) leg.desired.x *= acting.rearSpread;
      } else if (variant === 'slamBounce') {
        const acting = slamBounceChoreography({ elapsed, duration, y: player.y || 0, vy: player.vy || 0 });
        bob += acting.bob; lean += acting.lean; headPitch += acting.headPitch;
        for (const leg of legs) {
          const support = leg.front ? acting.front : acting.rear;
          leg.desired.x *= support.xScale; leg.desired.y += support.y; leg.desired.z += support.z;
        }
      } else if (variant === 'grabbed') {
        const acting = choreographGrabbed(player, elapsed, legs, facing);
        bob = acting.bob; lean += acting.lean; roll += acting.roll; twist += acting.twist;
        thrust += acting.thrust; headPitch = acting.headPitch; headYaw = acting.headYaw; headRoll = acting.headRoll;
      } else if (variant === 'thrown') {
        if (thrownLandingTime === null && !actionChanged && previousY > .02 && (player.y || 0) <= .02) thrownLandingTime = elapsed;
        const fling = 1 - smooth(elapsed / .22);
        const airborne = smooth(Math.max(0, player.y || 0) * 3);
        const tuck = smooth(elapsed / .065) * airborne;
        const land = thrownLandingTime === null ? 0 : pulse(elapsed - thrownLandingTime, 0, .04, .19);
        lean -= fling * .28;
        lean += land * .12;
        roll -= fling * (player.throwStyle === 'back' ? .49 : .22);
        bob -= land * .15;
        headPitch += fling * .24 - land * .09;
        headRoll += fling * .13;
        for (const leg of legs) {
          leg.desired.x *= 1 + .10 * fling - .24 * tuck;
          leg.desired.y += tuck * (leg.front ? .42 : .28);
          leg.desired.z *= 1 - .18 * tuck;
          if (leg.front && leg.grappleEntry) leg.desired.lerp(leg.grappleEntry, 1 - smooth(elapsed / .16));
        }
      } else if (variant === 'grabBreak') {
        const acting = choreographGrabBreak(elapsed, duration, legs);
        bob += acting.bob; lean += acting.lean; thrust += acting.thrust; headPitch += acting.headPitch;
      } else if (variant === 'burstRepelled') {
        const repel = 1 - smooth(elapsed / duration);
        const catchWeight = pulse(elapsed, .08, .16, duration);
        lean -= repel * .32;
        thrust -= repel * .16;
        bob -= catchWeight * .11;
        headPitch += repel * .23;
        headRoll -= repel * .10;
        for (const leg of legs) {
          leg.desired.x *= 1 + repel * (leg.front ? .17 : .10);
          if (leg.front) { leg.desired.y += repel * .50; leg.desired.z -= repel * .23; }
        }
      } else if (variant === 'guardBreak' || (player.guard <= 0 && Math.abs(duration - .95) < .025)) {
        const opening = pulse(elapsed, 0, .105, .52);
        const slump = smooth(elapsed / .22) * (1 - smooth((elapsed - .55) / .40));
        bob -= slump * .20;
        lean += slump * .15 - opening * .13;
        roll -= slump * .09;
        headPitch += slump * .18 + opening * .10;
        headRoll += slump * .13;
        for (const leg of legs) if (leg.front) {
          leg.desired.x *= 1 + opening * .21;
          leg.desired.y += opening * .91 + slump * .13;
          leg.desired.z -= opening * .19;
        }
      } else if (variant === 'empLift' || variant === 'electrified') {
        const acting = electricalReaction(variant, elapsed, duration, player.y || 0, reducedMotion);
        bob += acting.bob; lean += acting.lean; thrust += acting.thrust;
        headPitch += acting.headPitch; headYaw += acting.headYaw; roll += acting.roll;
        for (const leg of legs) { leg.desired.x *= acting.spread; leg.desired.y += acting.tuck; }
      } else if (variant === 'launched' || variant === 'parried') {
        hit = (1 - smooth(p)) * Math.sin(Math.min(p * 7, Math.PI));
        thrust -= hit * .17;
        lean -= hit * .19;
        roll += hit * .11;
        headPitch += hit * .25;
        headYaw += hit * .12;
        for (const leg of legs) if (leg.front) leg.desired.y += hit * .16;
        if (variant === 'launched' && (player.y || 0) > .03) {
          lean -= .2;
          headPitch += .15;
          for (const leg of legs) {
            leg.desired.x *= .84;
            leg.desired.y += .38;
            leg.desired.z *= .84;
          }
        } else if (variant === 'parried') {
          headYaw += Math.sin(elapsed * 24) * (1 - p) * .19;
          headPitch += (1 - p) * .2;
          for (const leg of legs) if (leg.front) {
            leg.desired.z -= (1 - p) * .22;
            leg.desired.y += (1 - p) * .26;
          }
        }
      } else {
        const acting = recoilChoreography({ elapsed, duration: Number(player.actionDuration) > 0 ? Number(player.actionDuration) : duration, y: player.y || 0, reducedMotion });
        bob += acting.bob; thrust += acting.thrust; lean += acting.lean; roll += acting.roll; twist += acting.twist;
        headPitch += acting.headPitch; headYaw += acting.headYaw; headRoll += acting.headRoll;
        for (const leg of legs) {
          const support = leg.front ? acting.front : acting.rear;
          leg.desired.x *= support.xScale;
          leg.desired.z += support.z;
          leg.desired.y += support.y;
        }
      }
    } else if (action === 'ko') {
      ({ bob, lean, roll, headPitch, headYaw, headRoll } = shutdown);
      for (const leg of legs) {
        leg.desired.x *= leg.front ? shutdown.frontSpread : shutdown.rearSpread;
        leg.desired.lerpVectors(leg.shutdownEntry, leg.desired, shutdown.feet);
      }
    } else if (action === 'recover') {
      bob = 0; lean = -.022 * reboot.servoCheck; roll = 0;
      headPitch = -.04 * reboot.servoCheck; headYaw = reducedMotion ? 0 : .09 * reboot.headCheck; headRoll = 0;
      for (const leg of legs) leg.desired.lerpVectors(leg.rebootEntry, leg.home, reboot.feet);
    } else if (action === 'finisher' || action === 'defeated') {
      const seize = smooth((elapsed - .25) / .40);
      const rupture = smooth((elapsed - .68) / .57);
      const strain = smooth((elapsed - 1.25) / .90);
      const impact = pulse(elapsed, 1.25, 1.30, 1.65);
      if (action === 'finisher') {
        bob -= seize * .12; lean += seize * .10 - rupture * .15;
        headPitch -= rupture * .11; thrust -= rupture * .09;
        for (const leg of legs) {
          if (!leg.front) { leg.desired.x *= 1 + seize * .14; continue; }
          if (variant === 'coreRip') {
            const partner = Number.isFinite(player.grabPartnerX) ? player.grabPartnerX : group.position.x + facing * 2.1;
            leg.world.set(partner - facing * (.32 + rupture * .40 + strain * .17), (player.grabPartnerY || 0) + .66 + rupture * .34 + strain * .20, -facing * leg.sign * (.37 - rupture * .13));
            model.worldToLocal(leg.world); leg.desired.lerp(leg.world, seize);
          } else if (variant === 'brutality') {
            const windup = pulse(elapsed, .15, .85, 1.25);
            leg.desired.set(leg.sign * .59, leg.home.y + windup * 1.7 + impact * .38, leg.home.z - windup * .20 + impact * .88);
            lean += impact * .10; bob -= impact * .06;
          } else {
            leg.desired.set(leg.sign * .57, .45 + seize * .42, 1.26 + seize * .10);
            charge = seize * (1 + strain); headPitch -= strain * .10;
          }
        }
      } else {
        const live = variant !== 'offer';
        bob -= live ? .08 * seize : .16;
        lean -= live ? .12 * rupture + .11 * impact : .08;
        roll += live ? .15 * strain : .10;
        headPitch += .13 * rupture + .18 * impact;
        headRoll -= .12 * strain;
        for (const leg of legs) {
          leg.desired.x *= 1 + .09 * seize + .10 * strain;
          if (leg.front) { leg.desired.y += .55 * seize + .24 * impact; leg.desired.z -= .15 * rupture; }
        }
        if (variant === 'brutality') { bob -= impact * .20; headPitch += impact * .20; }
      }
    } else if (action === 'victory') {
      const celebrate = .5 + .5 * Math.sin(elapsed * 7);
      bob += .055 * celebrate;
      headYaw = Math.sin(elapsed * 3.5) * .28;
      headRoll = Math.sin(elapsed * 7) * .12;
      for (const leg of legs) if (leg.front) {
        leg.desired.y = .85 + celebrate * .24;
        leg.desired.z = 1.14;
        leg.desired.x = leg.sign * .9;
      }
    }

    if (player.landingRecovery > 0 && variant !== 'slam' && (player.y || 0) <= .02 && !['ko', 'recover', 'defeated'].includes(action)) {
      const landing = pulse(.16 - player.landingRecovery, 0, .045, .16);
      bob -= .20 * landing; lean += .075 * landing; headPitch -= .08 * landing;
      for (const leg of legs) { leg.desired.x *= 1 + .10 * landing; leg.desired.z *= 1 + .06 * landing; }
    }
    if (action === 'idle' && (player.y || 0) > .03) {
      const tuck = smooth((player.y || 0) * 2);
      lean -= clamp(player.vy || 0, -8, 8) * .014;
      for (const leg of legs) { leg.desired.x *= 1 - .18 * tuck; leg.desired.y += .34 * tuck; leg.desired.z *= 1 - .12 * tuck; }
    }

    if (turning.active) {
      bob += turning.bob; roll += turning.roll; headYaw += turning.headYaw; headPitch += turning.headPitch;
      model.updateMatrixWorld(true);
      if (turning.feet) for (const [i, leg] of legs.entries()) {
        leg.desired.copy(turning.feet[i]); model.worldToLocal(leg.desired);
      }
    }

    rootTarget.set(0, bob, thrust);
    if (shutdown) rootOffset.copy(koOffset).lerp(rootTarget, shutdown.entry);
    else if (reboot) rootOffset.copy(recoverOffset).lerp(rootTarget, reboot.lift);
    else rootOffset.lerp(rootTarget, 1 - Math.exp(-24 * dt));
    chassis.position.copy(basePosition).add(rootOffset);
    bodyEuler.set(lean, twist, roll);
    bodyTarget.setFromEuler(bodyEuler);
    if (shutdown) bodyQ.copy(koBody).slerp(bodyTarget, shutdown.entry);
    else if (reboot) bodyQ.copy(recoverBody).slerp(bodyTarget, reboot.lift);
    else bodyQ.slerp(bodyTarget, 1 - Math.exp(-23 * dt));
    chassis.quaternion.copy(bodyQ);
    headEuler.set(headPitch, headYaw, headRoll);
    headTarget.setFromEuler(headEuler);
    if (shutdown) headQ.copy(koHead).slerp(headTarget, shutdown.entry);
    else if (reboot) headQ.copy(recoverHead).slerp(headTarget, reboot.head);
    else headQ.slerp(headTarget, 1 - Math.exp(-15 * dt));
    turret.quaternion.copy(headQ);
    model.updateMatrixWorld(true);
    for (const leg of legs) {
      if (shutdown || reboot || turning.feet) leg.target.copy(leg.desired);
      else leg.target.lerp(leg.desired, 1 - Math.exp(-(action === 'light' ? 70 : action === 'heavy' ? 45 : 25) * dt));
      solve(leg);
    }
    // Briefly retain the interrupted joint pose before the planted solver
    // takes over. Thereafter toes stay on the floor throughout the crouch.
    if (shutdown || reboot) {
      const entry = shutdown ? koEntry : recoverEntry;
      const blend = shutdown ? smooth(elapsed / .20) : smooth(p / .20);
      for (const leg of legs) for (const bone of leg.chain) {
        correction.copy(bone.quaternion);
        bone.quaternion.copy(entry.get(bone) || rest.get(bone).q).slerp(correction, blend);
      }
    }
    extractedCore.visible = reactorOpen > .001 || action === 'defeated' && variant === 'coreRip' && elapsed >= .68;
    coreSource.visible = !extractedCore.visible;
    const corePull = action === 'defeated' && extractedCore.visible ? smooth((elapsed - .68) / .57) : 0;
    const coreStrain = action === 'defeated' && extractedCore.visible ? smooth((elapsed - 1.25) / .90) : 0;
    extractedCore.position.set(0, corePull * .34 + coreStrain * .20, reactorOpen + corePull * .40 + coreStrain * .17);
    updateGroundSupport();
    updateDamageAnchors();
    // Keep the contact beat, but let authored enamel/metal remain visible.
    // Scaling the decay with the amplitude preserves the old brief lifetime.
    hitFlare = Math.max(0, hitFlare - dt * (ordinaryHit ? 1.96 : 7));
    for (const channel of ['health', 'status', 'reactor']) for (const material of signalMaterials[channel]) {
      material.emissive.setHex(presentation[`${channel}Color`]);
      material.color.copy(material.emissive).multiplyScalar(.14);
      material.emissiveIntensity = presentation[`${channel}Intensity`];
    }
    for (const material of ownMaterials) if (!lensMaterials.includes(material)) {
      material.emissive.setRGB(hitFlare * .32, hitFlare * .14, hitFlare * .06);
    }
    headLamp.color.setHex(presentation.healthColor);
    headLamp.intensity = presentation.destroyed ? 0 : presentation.healthIntensity * 11;
    reactorLamp.color.setHex(presentation.reactorColor);
    reactorLamp.intensity = presentation.destroyed ? 0 : presentation.reactorIntensity * 10;
    if (action === 'ultimate' || variant === 'overloadHit' || variant === 'overloadRecovery') {
      reactorLamp.intensity += charge * (reducedMotion ? 5 : 13);
      for (const material of signalMaterials.reactor) material.emissiveIntensity += charge * 1.1;
    }
    reactorLamp.position.copy(coreLocal).add(extractedCore.position);
    if (action === 'defeated' && variant !== 'offer') {
      const pressure = smooth((elapsed - .65) / 1.5);
      reactorLamp.intensity += pressure * 22;
      for (const material of signalMaterials.reactor) material.emissiveIntensity += pressure * 2.6;
    }
    reactorLamp.visible = player.visualQuality !== 'low';
    const bespokeSpecial = action === 'special' && variant !== 'burst';
    glowMaterial.opacity = bespokeSpecial ? 0 : clamp(charge * .3, 0, .65);
    const groundWave = action === 'special' && variant === 'shockwave';
    const reactorBurst = action === 'special' && variant === 'burst';
    glowMaterial.color.setHex(reactorBurst || groundWave ? presentation.reactorColor : presentation.abilityColor);
    ringMaterial.color.copy(glowMaterial.color);
    chargeGlow.position.set(0, reactorBurst ? -.50 : groundWave ? -.68 : .30, reactorBurst ? .07 : groundWave ? .56 : .23);
    chargeRing.position.set(0, reactorBurst ? -.50 : groundWave ? -.68 : .30, reactorBurst ? .07 : groundWave ? .61 : .28);
    chargeGlow.scale.setScalar(1 + charge * 1.2 + (reducedMotion ? 0 : Math.sin(time * 30) * charge * .08));
    ringMaterial.opacity = bespokeSpecial ? 0 : clamp(charge * .45, 0, .85);
    chargeRing.scale.setScalar(reactorBurst ? .85 + smooth(elapsed / .18) * 1.8 : .8 + charge * .6);
    chargeRing.rotation.x = reactorBurst ? -Math.PI / 2 : 0;
    chargeRing.rotation.z = reducedMotion ? 0 : time * 5;
    previousElapsed = elapsed;
    previousY = Number(player.y) || 0;
    renderedFrames++;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ownMaterials.forEach((m) => m.dispose());
    glowGeometry.dispose(); glowMaterial.dispose();
    ringGeometry.dispose(); ringMaterial.dispose();
    coreGeometry.dispose(); fragments.dispose();
    surfaceResources.disposeTextures();
    headLamp.dispose(); reactorLamp.dispose();
    model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    group.removeFromParent();
    // Geometry/textures belong to the cached template and are shared by clones.
  }
  update({ action: 'idle', facing: 1 }, 1, 0);
  renderedFrames = 0;
  return { group, update, dispose, getContactShadow: () => ({ ...contactShadow }), getDamageAnchors: () => damageAnchors, getCombatAnchors: () => combatAnchors };
}
