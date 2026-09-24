import { healthPercent } from '../shared/health.js';
import * as THREE from 'three';
import { robotPresentation } from '../shared/robot-presentation.js';
import { createSparkStreaks } from './spark-streaks.js';
import { createEnergyBolts } from './energy-bolts.js';
import { createAbilityEffects } from './ability-effects.js';
import { createMechanicalEffects } from './mechanical-effects.js';
import { SHUTDOWN_DISCHARGES } from '../shared/shutdown-motion.js';
import { createElectricalFaults, stepElectricalFragment } from './electrical-faults.js';
import { createContactLights } from './contact-light.js';
import { createOverloadEffects } from './overload-effects.js';

const AMBER = new THREE.Color('#ffbd5c');
const CYAN = new THREE.Color('#6bdfff');
const WHITE = new THREE.Color('#fff0cc');
const GRAB = new THREE.Color('#ff946e');
const DEFENSIVE = new THREE.Color('#bbf5ef');
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = THREE.MathUtils.lerp;

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.13, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.34, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Damage is separate from combat events: bounded pools, bone-space emitters, no simulated damage. */
function createDamageEffects(scene, { spark, clearSparks, countSparks }) {
  const smokeCapacity = 24;
  const electricalFaults = createElectricalFaults(scene);
  const contactLights = createContactLights(scene);
  const smoke = Array.from({ length: smokeCapacity }, () => ({ life: 0 }));
  const smokePosition = new Float32Array(smokeCapacity * 3);
  const smokeSize = new Float32Array(smokeCapacity);
  const smokeAlpha = new Float32Array(smokeCapacity);
  const smokeAngle = new Float32Array(smokeCapacity);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.name = 'damage-smoke-pool';
  for (const [name, array, itemSize] of [['position', smokePosition, 3], ['aSize', smokeSize, 1], ['aAlpha', smokeAlpha, 1], ['aAngle', smokeAngle, 1]]) {
    smokeGeometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage));
  }
  const smokeMaterial = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aAngle;
      uniform float pixelRatio; varying float vAlpha; varying float vAngle;
      void main(){ vAlpha=aAlpha; vAngle=aAngle; vec4 p=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=clamp(aSize*pixelRatio*560.0/max(0.1,-p.z),1.0,100.0); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `varying float vAlpha; varying float vAngle;
      void main(){ vec2 uv=gl_PointCoord*2.0-1.0; float c=cos(vAngle),s=sin(vAngle);
        uv=mat2(c,-s,s,c)*uv; float a=exp(-dot(uv*vec2(1.1,0.85),uv*vec2(1.1,0.85))*4.2);
        vec2 q=uv-vec2(0.19,-0.16); float b=exp(-dot(q,q)*7.0);
        float edge=1.0-smoothstep(0.55,1.0,length(uv));
        gl_FragColor=vec4(vec3(0.39,0.44,0.48),(a*0.65+b*0.35)*edge*vAlpha); }`,
  });
  const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
  smokePoints.name = 'damage-smoke'; smokePoints.frustumCulled = false;
  scene.add(smokePoints);

  const trackers = new Map(), pending = [], seenEvents = new Set();
  const stats = { thresholdVents: 0, koDischarges: 0, impactFaults: 0, ambientFaults: 0, smokeEmitted: 0, sparksEmitted: 0, arcsEmitted: 0, resets: 0 };
  const hot = new THREE.Color('#ffbd73');
  let smokeCursor = 0, context = null, low = false, reduced = false;

  function anchor(player, key) {
    const value = player?.damageAnchors?.[key];
    return value && Number.isFinite(value.x + value.y + value.z) ? value : null;
  }
  function anyAnchor(player, preferred = 'core') {
    if (anchor(player, preferred)) return preferred;
    return ['core', 'head', 'left', 'right'].find(key => anchor(player, key));
  }
  function visibleLeg(player) {
    const left = anchor(player, 'left'), right = anchor(player, 'right');
    // The arena camera is on +Z; select the actual near-side joint after facing/KO deformation.
    return left && (!right || left.z >= right.z) ? 'left' : right ? 'right' : 'core';
  }
  function clearOwner(owner) {
    for (const puff of smoke) if (owner == null || puff.owner === owner) puff.life = 0;
    electricalFaults.clearOwner(owner);
    contactLights.clearOwner(owner);
    clearSparks(owner);
  }
  function puff(player, key, strength = 1) {
    const point = anchor(player, key);
    if (!point) return;
    const item = smoke[smokeCursor];
    const life = rand(0.8, 1.3);
    Object.assign(item, { owner: player.id, key, x: point.x, y: point.y, z: point.z,
      vx: rand(-0.075, 0.075), vy: rand(0.2, 0.36), vz: rand(-0.04, 0.07),
      life, maxLife: life, age: 0, size: rand(0.26, 0.4) * strength,
      opacity: (reduced ? 0.12 : low ? 0.14 : 0.19) * strength, angle: rand(-3, 3) });
    smokeCursor = (smokeCursor + 1) % smokeCapacity; stats.smokeEmitted++;
  }
  function electrical(player, key) {
    if (electricalFaults.emit(player, key)) stats.arcsEmitted++;
  }
  function sparks(player, key, count, force = 1) {
    const point = anchor(player, key);
    if (!point) return;
    contactLights.emit(player, key, force);
    const total = Math.max(1, Math.round(count * (low ? 0.55 : 1) * (reduced ? 0.35 : 1)));
    const core = anchor(player, 'core');
    const outward = core && Math.abs(point.x-core.x) > .08 ? Math.sign(point.x-core.x) : player.facing || 1;
    // A loose, one-sided electrical spray; the smallest molten flecks cool fastest.
    const axis = rand(.38, 1.0), spread = rand(.36, .68);
    for (let i = 0; i < total; i++) {
      const angle = axis + rand(-spread, spread), fast = i % 4 === 0;
      const speed = rand(fast ? 4.2 : 1.2, fast ? 6.8 : 3.0) * force;
      spark(point, { x: Math.cos(angle) * speed * outward, y: Math.sin(angle) * speed, z: rand(fast ? 1.6 : .7, fast ? 2.5 : 1.5) * force },
        hot, rand(fast ? .38 : .18, fast ? .62 : .40), rand(fast ? .29 : .095, fast ? .38 : .19) * (reduced ? .75 : 1), 10, player.id);
    }
    stats.sparksEmitted += total;
  }
  function vent(player, severity = 1, final = false) {
    const key = anyAnchor(player, final ? 'core' : severity > 1 ? 'head' : visibleLeg(player));
    if (!key) return false;
    sparks(player, key, final ? 12 : severity > 1 ? 14 : 9, 0.8);
    electrical(player, key);
    puff(player, key, final ? 1.05 : 0.85);
    if (!low && !reduced) puff(player, anyAnchor(player, 'core'), 0.8);
    return true;
  }
  function beginOffline(record, player, allowed) {
    if (record.koDischarged) return;
    record.koAge = Math.max(0, Number(player.actionTime) || 0);
    record.koActive = allowed; record.koNextPuff = 0.24; record.koBeat = 0;
    if (allowed && (player.action === 'ko' || vent(player, 2, true))) {
      record.koDischarged = true; stats.koDischarges++;
    }
  }
  const contextFor = state => `${state?.room ?? 'lobby'}:${state?.round ?? 0}`;
  function queue(event, state) {
    if (event.type !== 'hit' && event.type !== 'ko') return;
    const eventContext = contextFor(state);
    const key = event.id == null ? null : `${eventContext}:${event.type}:${event.id}`;
    if (key && seenEvents.has(key)) return;
    if (key) { seenEvents.add(key); if (seenEvents.size > 256) seenEvents.delete(seenEvents.values().next().value); }
    if (pending.length < 32) pending.push({ event, context: eventContext });
  }

  function update(dt, time, state, pixelRatio) {
    const nextContext = contextFor(state);
    if (context !== nextContext) { clearOwner(null); trackers.clear(); context = nextContext; stats.resets++; }
    const players = state?.players ?? [];
    const byId = new Map(players.map(player => [player.id, player]));
    const live = state?.phase === 'fight';
    const settling = live || state?.phase === 'roundOver' || state?.phase === 'matchOver';
    const ranks = { healthy: 0, damaged: 1, critical: 2, offline: 3 };
    for (const player of players) {
      const band = robotPresentation(player, time, { reducedMotion: reduced }).healthBand;
      const hp = healthPercent(player);
      let record = trackers.get(player.id);
      if (!record) {
        record = { hp, band, faultTimer: rand(0.65, 1.4), smokeTimer: rand(0.8, 1.5), koAge: 5,
          koActive: false, koDischarged: false, koNextPuff: 0.24, koBeat: 0 };
        trackers.set(player.id, record);
      } else {
        const healed = hp > record.hp + 0.01 || record.band === 'offline' && band !== 'offline';
        if (healed) {
          clearOwner(player.id); record.faultTimer = rand(0.8, 1.4); record.smokeTimer = rand(0.9, 1.6);
          record.koActive = false; record.koDischarged = false; record.koAge = 5;
        }
        if (!healed && ranks[band] > ranks[record.band]) {
          if (band === 'offline') beginOffline(record, player, settling);
          else if (live && vent(player, band === 'critical' ? 2 : 1)) stats.thresholdVents++;
        }
        record.hp = hp; record.band = band;
      }
      if (band === 'offline') {
        if (player.action === 'ko') {
          // Follow the same action clock as servo shutdown. No catch-up
          // fountain after a pause, hidden tab, seek or delayed packet.
          const age = Math.max(0, Number(player.actionTime) || 0);
          if (record.koActive && settling) while (record.koBeat < SHUTDOWN_DISCHARGES.length && SHUTDOWN_DISCHARGES[record.koBeat].time <= age) {
            const beat = SHUTDOWN_DISCHARGES[record.koBeat++];
            if (age - beat.time > .12) continue;
            const key = anyAnchor(player, beat.key);
            sparks(player, key, beat.count, beat.force);
            electrical(player, key);
            if (beat.key === 'core' || beat.key === 'head') puff(player, key, beat.key === 'core' ? .90 : .58);
          }
          record.koAge = age;
          continue;
        }
        record.koAge += dt;
        if (record.koActive && settling && record.koAge < (low || reduced ? 0.45 : 0.95) && record.koAge >= record.koNextPuff) {
          puff(player, anyAnchor(player, 'core'), 0.7);
          record.koNextPuff = record.koAge + 0.36;
        }
        continue;
      }
      if (!live || band === 'healthy') continue;
      const critical = band === 'critical';
      record.faultTimer -= dt; record.smokeTimer -= dt;
      if (record.faultTimer <= 0) {
        const options = critical ? ['core', 'head', 'left', 'right'] : ['left', 'right', 'core'];
        const candidate = options[Math.floor(Math.random() * options.length)];
        const key = anyAnchor(player, candidate === 'left' || candidate === 'right' ? visibleLeg(player) : candidate);
        if (key) { sparks(player, key, critical ? 6 : 3, 0.65); electrical(player, key); stats.ambientFaults++; }
        record.faultTimer = (critical ? rand(0.9, 1.5) : rand(2.1, 3.6)) * (low ? 1.5 : 1) * (reduced ? 2.3 : 1);
      }
      if (record.smokeTimer <= 0) {
        const key = anyAnchor(player, critical ? 'head' : 'core');
        if (key) puff(player, key, critical ? 0.95 : 0.7);
        record.smokeTimer = (critical ? rand(1.1, 1.8) : rand(3.4, 4.8)) * (low ? 1.5 : 1) * (reduced ? 1.7 : 1);
      }
    }
    for (const [id] of trackers) if (!byId.has(id)) { clearOwner(id); trackers.delete(id); }
    for (const item of pending.splice(0)) {
      if (!settling || item.context !== context) continue;
      const { event } = item;
      const player = byId.get(event.target ?? event.player);
      const record = player && trackers.get(player.id);
      if (!record) continue;
      if (event.type === 'ko') {
        if (record.band === 'offline' && !record.koDischarged) beginOffline(record, player, true);
      } else {
        const keys = ['core', 'head', 'left', 'right'].filter(key => anchor(player, key));
        keys.sort((one, two) => {
          const a = anchor(player, one), b = anchor(player, two);
          return (a.x - (event.x ?? player.x ?? 0)) ** 2 + (a.y - (event.y ?? (player.y ?? 0) + 1.1)) ** 2
            - (b.x - (event.x ?? player.x ?? 0)) ** 2 - (b.y - (event.y ?? (player.y ?? 0) + 1.1)) ** 2;
        });
        if (keys.length) {
          sparks(player, keys[0], event.damage >= 14 ? 6 : 3, 1);
          if (record.band === 'critical') puff(player, keys[0], 0.65);
          stats.impactFaults++;
        }
      }
    }

    smokeMaterial.uniforms.pixelRatio.value = pixelRatio;
    for (let i = 0; i < smokeCapacity; i++) {
      const item = smoke[i];
      if (item.life <= 0) { smokeAlpha[i] = 0; continue; }
      item.life -= dt; item.age += dt;
      if (item.life <= 0) { smokeAlpha[i] = 0; continue; }
      const attached = item.age < 0.12 && anchor(byId.get(item.owner), item.key);
      if (attached) { item.x = attached.x; item.y = attached.y + item.age * item.vy; item.z = attached.z; }
      else { item.x += item.vx * dt; item.y += item.vy * dt; item.z += item.vz * dt; }
      smokePosition[i * 3] = item.x; smokePosition[i * 3 + 1] = item.y; smokePosition[i * 3 + 2] = item.z;
      const progress = 1 - item.life / item.maxLife;
      smokeSize[i] = item.size * (0.65 + progress * 1.5);
      smokeAlpha[i] = Math.sin(progress * Math.PI) * item.opacity;
      smokeAngle[i] = item.angle + (reduced ? 0 : item.age * 0.2);
    }
    for (const attribute of Object.values(smokeGeometry.attributes)) attribute.needsUpdate = true;
    electricalFaults.update(dt, players);
    contactLights.update(dt, players);
  }
  function clear() {
    clearOwner(null); smokeAlpha.fill(0); electricalFaults.clear(); trackers.clear(); pending.length = 0; seenEvents.clear(); context = null;
    for (const key of Object.keys(stats)) stats[key] = 0;
  }
  return {
    queue, update, clear,
    setQuality(value) { low = value === 'low'; electricalFaults.setQuality(value); contactLights.setQuality(value); },
    setReducedMotion(value) { reduced = value; electricalFaults.setReducedMotion(value); contactLights.setReducedMotion(value); },
    getStats() { return { ...stats, smokeActive: smoke.filter(item => item.life > 0).length,
      ...electricalFaults.getStats(),
      ...contactLights.getStats(),
      sparkActive: countSparks(), trackedPlayers: trackers.size, smokeCapacity, sparkCapacity: 80, totalSparkCapacity: 680 }; },
    dispose() { clear(); scene.remove(smokePoints); smokeGeometry.dispose(); smokeMaterial.dispose(); electricalFaults.dispose(); contactLights.dispose(); },
  };
}

/** A fixed particle pool, shared geometry and bounded projectile count keep effects mobile friendly. */
export function createCombatEffects(scene) {
  const maxParticles = 680;
  const combatCapacity = 600;
  const positions = new Float32Array(maxParticles * 3);
  const tails = new Float32Array(maxParticles * 3);
  const colors = new Float32Array(maxParticles * 3);
  const sizes = new Float32Array(maxParticles);
  const alphas = new Float32Array(maxParticles);
  const electrical = new Float32Array(maxParticles), heat = new Float32Array(maxParticles);
  const particles = Array.from({ length: maxParticles }, () => ({ life: 0 }));
  let cursor = 0;
  let damageCursor = combatCapacity;
  let quality = 'high';
  let reducedMotion = false;
  let presentationTime = 0;
  let presentationSeekToken;
  const { geometry, material, mesh: points } = createSparkStreaks(scene, { positions, tails, colors, sizes, alphas, electrical, heat, capacity: maxParticles });

  const glow = glowTexture();
  const ringGeometry = new THREE.RingGeometry(0.87, 1, 56);
  const arcGeometry = new THREE.RingGeometry(0.91, 1, 32, 1, 0, Math.PI * 1.36);
  const sphereGeometry = new THREE.SphereGeometry(0.15, 12, 8);
  const waveGeometry = new THREE.RingGeometry(0.78, 1, 28, 1, 0, Math.PI);
  const clawGeometry = new THREE.RingGeometry(0.85, 1, 20, 1, -0.65, 1.3);
  ringGeometry.name = 'combat-ring'; arcGeometry.name = 'combat-arc';
  sphereGeometry.name = 'projectile-sphere';
  waveGeometry.name = 'ground-wave';
  clawGeometry.name = 'grapple-claw';

  const flashes = [];
  const overloadEffects = createOverloadEffects(scene);

  const projectileObjects = new Map();
  const energyBolts = createEnergyBolts(scene, colorFor);
  const abilityEffects = createAbilityEffects(scene, { colorFor, spark: particle });
  const charges = new Map();
  const holds = new Map();
  const debrisGeometry = new THREE.BoxGeometry(1, 1, 1);
  debrisGeometry.name = 'impact-debris';
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: '#a7a9a3', roughness: 0.78, metalness: 0.42 });
  const debrisMesh = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, 52);
  debrisMesh.count = 0;
  debrisMesh.frustumCulled = false;
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(debrisMesh);
  const debris = [];
  const debrisTransform = new THREE.Object3D();
  const damageEffects = createDamageEffects(scene, {
    spark(point, velocity, color, life, size, gravity, owner) {
      particle(point.x, point.y, point.z, velocity.x, velocity.y, velocity.z, color, life, size, gravity, owner);
    },
    clearSparks(owner) {
      for (let i = combatCapacity; i < maxParticles; i++) {
        if (owner == null || particles[i].damageOwner === owner) { particles[i].life = 0; alphas[i] = 0; }
      }
    },
    countSparks() {
      let count = 0;
      for (let i = combatCapacity; i < maxParticles; i++) if (particles[i].life > 0) count++;
      return count;
    },
  });
  const mechanical = createMechanicalEffects(scene, { spark: particle });

  function colorFor(id, state) {
    const player = state?.players?.find(p => p.id === id);
    return player?.skin === 'cyan' || (!player?.skin && id === 'p2') ? CYAN : AMBER;
  }

  function particle(x, y, z, vx, vy, vz, color, life = 0.35, size = 0.2, gravity = 6, damageOwner = null) {
    if (!Number.isFinite(x + y + z + vx + vy + vz + life + size + gravity)) return;
    const index = damageOwner == null ? cursor : damageCursor;
    const p = particles[index];
    Object.assign(p, { x, y, z, vx, vy, vz, life, maxLife: life, size, gravity, damageOwner, bounces: 0,
      exposure: damageOwner == null ? 0 : size >= .25 ? rand(.068, .10) : rand(.007, .023) });
    electrical[index] = damageOwner == null ? 0 : size >= .25 ? 2 : 1;
    heat[index] = 1;
    color.toArray(colors, index * 3);
    if (damageOwner == null) cursor = (cursor + 1) % combatCapacity;
    else damageCursor = combatCapacity + (damageCursor + 1 - combatCapacity) % (maxParticles - combatCapacity);
  }

  function burst(x, y, color, count, force = 1, z = 0.55) {
    const total = Math.round(count * (quality === 'low' ? 0.55 : 1));
    for (let i = 0; i < total; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1, 6) * force;
      particle(x, y, z, Math.cos(angle) * speed, Math.sin(angle) * speed + 0.6,
        rand(-2, 2) * force, i % 5 === 0 ? WHITE : color, rand(0.18, 0.62), rand(0.08, 0.2), 9);
    }
  }

  function chunks(x, color, count = 15, power = 1) {
    const limit = quality === 'low' ? Math.ceil(count * 0.5) : count;
    for (let i = 0; i < limit && debris.length < 52; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(0.6, 3.4) * power;
      debris.push({ x, y: 0.05, z: rand(-0.35, 0.35), vx: Math.cos(angle) * speed,
        vy: rand(1.8, 4.2) * power, vz: Math.sin(angle) * speed * 0.65,
        size: rand(0.055, 0.13), rotation: rand(0, 6), spin: rand(-8, 8),
        life: rand(0.45, 0.85), color });
    }
  }

  function flash(x, y, color, size = 2.2, duration = 0.18, z = 0.65) {
    if (flashes.length > 20) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color, transparent: true, opacity: 1, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    sprite.renderOrder = 4;
    scene.add(sprite);
    flashes.push({ sprite, life: duration, duration, size });
  }

  function emit(event, state) {
    damageEffects.queue(event, state);
    const abilityResult = abilityEffects.emit(event, state);
    if (abilityResult != null) return abilityResult;
    const overload = overloadEffects.emit(event, state);
    if (overload != null) return overload;
    const result = mechanical.emit(event, state);
    if (result != null) return result;
    return 0;
  }
  function makeProjectile(id, color, variant = 'bolt') {
    const wave = variant === 'shockwave';
    const group = new THREE.Group();
    group.name = wave ? 'ground-shockwave' : 'energy-bolt';
    const coreMaterial = new THREE.MeshBasicMaterial({ color: '#f1ffff', toneMapped: false });
    const core = new THREE.Mesh(sphereGeometry, coreMaterial);
    core.scale.set(wave ? 2 : 2.4, wave ? 0.35 : 0.75, wave ? 1.2 : 0.75);
    core.position.y = wave ? 0.09 : 0;
    group.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.9, toneMapped: false,
    }));
    halo.scale.set(wave ? 1.7 : 1.5, wave ? 0.68 : 1.1, 1);
    halo.position.y = wave ? 0.14 : 0;
    group.add(halo);
    const coil = new THREE.Mesh(wave ? waveGeometry : arcGeometry, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    if (wave) coil.scale.set(0.66, 0.6, 1);
    else { coil.scale.setScalar(0.3); coil.rotation.y = Math.PI / 2; }
    group.add(coil);
    if (wave) {
      const wake = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.65, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      wake.rotation.x = -Math.PI / 2;
      wake.scale.set(0.95, 0.55, 1);
      group.add(wake);
    }
    scene.add(group);
    const result = { group, core, halo, coil, color, variant, emitted: 0, observedAt: 0, snapshot: null };
    projectileObjects.set(id, result);
    return result;
  }

  function removeGroup(group) {
    scene.remove(group);
    group.traverse(child => { if (child.material) child.material.dispose(); });
  }

  function makeHold(id) {
    const group = new THREE.Group();
    group.name = 'paired-grab';
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.name = 'grab-contact-lines';
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      color: GRAB, transparent: true, opacity: 0.32, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    line.frustumCulled = false;
    group.add(line);
    const brackets = [];
    for (const rotation of [0, Math.PI]) {
      const mesh = new THREE.Mesh(clawGeometry, new THREE.MeshBasicMaterial({
        color: GRAB, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      mesh.rotation.z = rotation;
      group.add(mesh); brackets.push(mesh);
    }
    scene.add(group);
    const hold = { group, line, brackets };
    holds.set(id, hold);
    return hold;
  }

  function removeHold(hold) {
    removeGroup(hold.group);
    hold.line.geometry.dispose();
  }

  function update(dt, time, state, pixelRatio = 1) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    material.uniforms.pixelRatio.value = pixelRatio;
    material.uniforms.viewportHeight.value = Math.max(100, globalThis.innerHeight || 390);
    const age = Math.min(dt, 0.05);
    const live = state?.phase === 'fight';
    damageEffects.update(dt, time, state, pixelRatio);
    mechanical.update(dt, time, state);
    overloadEffects.update(dt, time, state);
    if (state?.phase !== 'paused' || state?.visualSeekToken !== presentationSeekToken) presentationTime = time;
    presentationSeekToken = state?.visualSeekToken;
    time = presentationTime;
    for (let i = 0; i < maxParticles; i++) {
      const p = particles[i];
      if (p.life <= 0) { alphas[i] = 0; continue; }
      p.life -= age;
      if (p.life <= 0) { alphas[i] = 0; continue; }
      if (p.damageOwner != null) {
        stepElectricalFragment(p, age);
        if (p.life <= 0) { alphas[i] = 0; continue; }
      } else {
        p.vy -= p.gravity * age;
        p.x += p.vx * age; p.y += p.vy * age; p.z += p.vz * age;
      }
      if (p.damageOwner == null && p.y < 0.025) {
        p.y = 0.025;
        p.vy *= -0.22; p.vx *= 0.75;
      }
      positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const trailTime = p.damageOwner == null ? Math.min(.065, .48 / Math.max(1, speed)) : Math.min(p.exposure, .55 / Math.max(1, speed));
      tails[i * 3] = p.x - p.vx * trailTime;
      tails[i * 3 + 1] = Math.max(.024, p.y - p.vy * trailTime);
      tails[i * 3 + 2] = p.z - p.vz * trailTime;
      const t = p.life / p.maxLife;
      alphas[i] = Math.min(1, t * (p.damageOwner == null ? 2.4 : 1.8));
      heat[i] = t;
      sizes[i] = p.size * (0.4 + 0.6 * t);
    }
    for (const key of ['aHead', 'aTail', 'aColor', 'aSize', 'aAlpha', 'aElectrical', 'aHeat']) geometry.attributes[key].needsUpdate = true;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= age;
      if (f.life <= 0) { scene.remove(f.sprite); f.sprite.material.dispose(); flashes.splice(i, 1); continue; }
      const t = f.life / f.duration;
      f.sprite.material.opacity = t * (reducedMotion ? 0.45 : 0.95);
      f.sprite.scale.setScalar(f.size * (0.75 + 0.25 * t));
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const chunk = debris[i];
      chunk.life -= dt;
      if (chunk.life <= 0) { debris.splice(i, 1); continue; }
      chunk.vy -= dt * 11;
      chunk.x += chunk.vx * dt; chunk.y += chunk.vy * dt; chunk.z += chunk.vz * dt;
      if (chunk.y < chunk.size * 0.5) {
        chunk.y = chunk.size * 0.5; chunk.vy *= -0.24; chunk.vx *= 0.72; chunk.vz *= 0.72;
      }
      chunk.rotation += dt * chunk.spin;
    }
    debrisMesh.count = debris.length;
    debris.forEach((chunk, index) => {
      debrisTransform.position.set(chunk.x, chunk.y, chunk.z);
      debrisTransform.rotation.set(chunk.rotation, chunk.rotation * 0.6, chunk.rotation * 0.8);
      const size = chunk.size * Math.min(1, chunk.life * 5);
      debrisTransform.scale.set(size * 1.5, size, size * 0.7);
      debrisTransform.updateMatrix();
      debrisMesh.setMatrixAt(index, debrisTransform.matrix);
      debrisMesh.setColorAt(index, chunk.color);
    });
    if (debris.length) {
      debrisMesh.instanceMatrix.needsUpdate = true;
      debrisMesh.instanceColor.needsUpdate = true;
    }

    energyBolts.update(dt, state);
    abilityEffects.update(dt, state);
    const activeProjectiles = new Set();
    for (const projectile of state?.projectiles ?? []) {
      if (['bolt', 'shockwave'].includes(projectile.variant ?? 'bolt')) continue;
      activeProjectiles.add(projectile.id);
      const color = colorFor(projectile.owner, state);
      const variant = projectile.variant ?? 'bolt';
      let visual = projectileObjects.get(projectile.id);
      if (visual && visual.variant !== variant) {
        removeGroup(visual.group); projectileObjects.delete(projectile.id); visual = null;
      }
      visual ??= makeProjectile(projectile.id, color, variant);
      if (visual.snapshot !== projectile) { visual.snapshot = projectile; visual.observedAt = time; }
      const wave = variant === 'shockwave';
      const x = projectile.x + (projectile.direction ?? 1) * (projectile.speed ?? (wave ? 7.4 : 10.5)) * Math.min(0.045, Math.max(0, time - visual.observedAt));
      const height = wave ? 0.06 : projectile.y ?? 1.35;
      visual.group.position.set(x, height, wave ? 0.05 : 0.35);
      visual.coil.rotation.z = wave ? -(projectile.direction ?? 1) * 0.16 : reducedMotion ? 0 : time * 15;
      visual.halo.material.rotation = wave || reducedMotion ? 0 : time * 2;
      visual.emitted += dt;
      if (live && visual.emitted >= 0.018) {
        visual.emitted = 0;
        for (let i = 0; i < (quality === 'low' ? 1 : 3); i++) {
          particle(x - (projectile.direction ?? 1) * 0.25,
            height + rand(wave ? 0.02 : -0.12, wave ? 0.3 : 0.12), 0.25 + rand(-0.2, 0.2),
            -(projectile.direction ?? 1) * rand(0.5, 2), wave ? rand(0.3, 1.4) : rand(-0.4, 0.4), 0,
            color, rand(0.15, 0.3), wave ? 0.13 : 0.18, wave ? 5 : 0);
        }
      }
    }
    for (const [id, visual] of projectileObjects) {
      if (!activeProjectiles.has(id)) { removeGroup(visual.group); projectileObjects.delete(id); }
    }

    const activeHolds = new Set();
    for (const attacker of state?.players ?? []) {
      if (!attacker.grabTarget) continue;
      const victim = state.players.find(player => player.id === attacker.grabTarget && player.grabbedBy === attacker.id);
      if (!victim) continue;
      activeHolds.add(attacker.id);
      const hold = holds.get(attacker.id) ?? makeHold(attacker.id);
      const facing = attacker.facing ?? 1;
      const position = hold.line.geometry.attributes.position;
      position.setXYZ(0, attacker.x + facing * 0.65, (attacker.y ?? 0) + 0.65, -0.35);
      position.setXYZ(1, victim.x - facing * 0.3, (victim.y ?? 0) + 0.62, -0.38);
      position.setXYZ(2, attacker.x + facing * 0.65, (attacker.y ?? 0) + 0.65, 0.35);
      position.setXYZ(3, victim.x - facing * 0.3, (victim.y ?? 0) + 0.62, 0.38);
      for (const [index, side] of [[0, 'left'], [2, 'right']]) {
        const tip = attacker.combatAnchors?.[`${side}Claw`], foot = attacker.combatAnchors?.[`${side}ClawBase`];
        if (tip && foot) {
          position.setXYZ(index, tip.x, tip.y, tip.z);
          position.setXYZ(index + 1, lerp(tip.x, foot.x, .3), lerp(tip.y, foot.y, .3), lerp(tip.z, foot.z, .3));
        }
      }
      position.needsUpdate = true;
      const techOpen = (victim.grabTechWindow ?? 0) > 0;
      hold.line.material.color.copy(techOpen ? WHITE : GRAB);
      const closing = THREE.MathUtils.clamp((victim.grabHoldTime ?? attacker.grabHoldTime ?? 0) / 0.3, 0, 1);
      for (const bracket of hold.brackets) {
        bracket.position.set(victim.x - facing * 0.1, (victim.y ?? 0) + 0.85, 0.8);
        bracket.scale.set(0.8 - closing * 0.12, 0.53, 1);
        bracket.material.color.copy(techOpen ? WHITE : GRAB);
        bracket.material.opacity = techOpen ? 0.26 : 0.08;
      }
    }
    for (const [id, hold] of holds) {
      if (!activeHolds.has(id)) { removeHold(hold); holds.delete(id); }
    }

    const charging = new Set();
    for (const player of state?.players ?? []) {
      if (live && player.variant === 'slam' && player.action === 'heavy' && player.y > 0.08 && (player.actionTime ?? 0) > 0.1) {
        const color = colorFor(player.id, state);
        for (let i = 0; i < (quality === 'low' ? 1 : 2); i++) particle(player.x + rand(-0.65, 0.65),
          player.y + rand(0.45, 1.3), 0.3, rand(-0.4, 0.4), rand(1.2, 2.5), 0, color, 0.22, 0.17, 0);
      }
      const counter = (player.counterWindow ?? 0) > 0 && !['ultimate', 'block', 'hit', 'ko'].includes(player.action)
        && !player.grabTarget && !player.grabbedBy && player.variant !== 'burst';
      const defensive = player.variant === 'burst' && (player.burstInvulnerable ?? 0) > 0;
      if (player.action !== 'block' && !counter && !defensive) continue;
      charging.add(player.id);
      const color = colorFor(player.id, state);
      let charge = charges.get(player.id);
      if (!charge) {
        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        });
        const mesh = new THREE.Mesh(arcGeometry, mat);
        scene.add(mesh);
        charge = { mesh, emit: 0 };
        charges.set(player.id, charge);
      }
      const ultimate = false; // Overload owns its staged capacitor and range telegraph.
      // Snapshots may telegraph a charge, but only authoritative ultimatePulse events fire beams.
      const ground = ultimate || counter;
      charge.mesh.name = defensive ? 'burst-immunity' : ultimate ? 'overload-charge-ring' : counter ? 'counter-window' : 'block-shield';
      charge.mesh.position.set(player.x + (ground || defensive ? 0 : (player.facing ?? 1) * 0.67), (ground ? 0 : player.y ?? 0) + (ground ? 0.04 : 1.08), ground ? 0 : 0.42);
      charge.mesh.rotation.set(ground ? -Math.PI / 2 : 0, 0, ground ? reducedMotion ? 0 : time * (counter ? -2 : 3) : defensive ? Math.PI / 4 : (player.facing > 0 ? -2.12 : 1.02));
      charge.mesh.scale.setScalar(ultimate ? 1.15 + (reducedMotion ? 0 : Math.sin(time * 14) * 0.08) : defensive ? 1.15 : counter ? 1.05 : 0.78);
      charge.mesh.material.color.copy(defensive ? DEFENSIVE : counter ? WHITE : color);
      charge.mesh.material.opacity = ultimate ? 0.6 : defensive ? 0.3 : counter ? 0.4 : 0.17 + Math.sin(time * 4) * 0.025;
      charge.emit += dt;
      if (live && ultimate && charge.emit > 0.025) {
        charge.emit = 0;
        const a = rand(0, Math.PI * 2);
        particle(player.x + Math.cos(a) * 0.8, 0.05, Math.sin(a) * 0.65,
          -Math.cos(a) * 0.3, rand(1.5, 3.5), -Math.sin(a) * 0.2, color, rand(0.5, 0.9), 0.14, -0.5);
      }
    }
    for (const [id, charge] of charges) {
      if (!charging.has(id)) { scene.remove(charge.mesh); charge.mesh.material.dispose(); charges.delete(id); }
    }
  }

  function clear() {
    damageEffects.clear();
    mechanical.clear();
    energyBolts.clear();
    abilityEffects.clear();
    overloadEffects.clear();
    for (const p of particles) p.life = 0;

    for (const f of flashes) { scene.remove(f.sprite); f.sprite.material.dispose(); }
    for (const p of projectileObjects.values()) removeGroup(p.group);
    for (const c of charges.values()) { scene.remove(c.mesh); c.mesh.material.dispose(); }
    for (const hold of holds.values()) removeHold(hold);
    flashes.length = 0;

    debris.length = 0; debrisMesh.count = 0;
    projectileObjects.clear(); charges.clear(); holds.clear();
  }

  return {
    emit, update, clear,
    getOverloadStats() { return overloadEffects.getStats(); },
    getDamageStats() { return damageEffects.getStats(); },
    getEffectsStats() { return { ...mechanical.getStats(), abilities: abilityEffects.getStats() }; },
    setQuality(value) { quality = value; overloadEffects.setQuality(value); energyBolts.setQuality(value); abilityEffects.setQuality(value); damageEffects.setQuality(value); mechanical.setQuality(value); },
    setReducedMotion(value) { reducedMotion = value; overloadEffects.setReducedMotion(value); energyBolts.setReducedMotion(value); abilityEffects.setReducedMotion(value); damageEffects.setReducedMotion(value); mechanical.setReducedMotion(value); },
    dispose() {
      clear(); overloadEffects.dispose(); damageEffects.dispose(); mechanical.dispose(); energyBolts.dispose(); abilityEffects.dispose(); scene.remove(points, debrisMesh); geometry.dispose(); material.dispose(); glow.dispose();
      ringGeometry.dispose(); arcGeometry.dispose(); sphereGeometry.dispose(); waveGeometry.dispose(); clawGeometry.dispose();
      debrisGeometry.dispose(); debrisMaterial.dispose(); debrisMesh.dispose();
    },
  };
}
