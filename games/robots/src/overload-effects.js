import * as THREE from 'three';
import { ATTACKS, ULTIMATE_PULSES } from '../shared/constants.js';

const amber = new THREE.Color('#ffc166'), cyan = new THREE.Color('#6feaff');
const clamp = THREE.MathUtils.clamp;
const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const beamShader = `uniform vec3 tint;uniform float age,power,reduced;varying vec2 vUv;
  void main(){float x=vUv.x,y=vUv.y-.5;float clock=age*(1.0-reduced);
    float body=exp(-y*y*540.0),white=exp(-y*y*4300.0);
    float ripple=sin(x*61.0-clock*40.0)*sin(x*23.0+clock*17.0);
    float a=exp(-pow((y-sin(x*22.0-clock*17.0)*.085-ripple*.018)/.008,2.0));
    float b=exp(-pow((y+sin(x*34.0+clock*11.0)*.14-ripple*.025)/.006,2.0));
    float braid=(a+b)*smoothstep(.0,.07,x)*(1.0-smoothstep(.88,1.0,x));
    float ends=smoothstep(0.0,.014,x)*(1.0-smoothstep(.94,1.0,x));
    float fade=pow(max(0.0,1.0-age),1.3);float line=body*.46+white+braid*.68;
    gl_FragColor=vec4(tint*(body*1.65+braid*2.0)+vec3(3.8,3.55,2.8)*white,line*ends*fade*power);}`;
const laneShader = `uniform vec3 tint;uniform float age,power;varying vec2 vUv;
  void main(){float edge=exp(-pow((abs(vUv.y-.5)-.47)/.015,2.0));
    float ends=exp(-pow((vUv.x-.987)/.012,2.0));float dash=step(.40,fract(vUv.x*24.0));
    float chevron=exp(-pow((fract(vUv.x*6.0)-abs(vUv.y-.5)*.55-.32)/.055,2.0));
    gl_FragColor=vec4(tint*1.15,(edge*dash*.62+ends*.6+chevron*.15+.025)*power);}`;

/** Fixed 2 charging rigs, 6 transient pulses, 2 contact cages, 2 lights.
 * Nothing allocates during emit/update, including extreme event bursts. */
export function createOverloadEffects(scene) {
  let low = false, reduced = false, disposed = false, pulseCursor = 0, clock = 0, context = null;
  const seen = new Set(), resources = new Set(), stats = { pulses: 0, contacts: 0 };
  const ringGeometry = new THREE.RingGeometry(.94, 1, 64), planeGeometry = new THREE.PlaneGeometry(1, 1);
  ringGeometry.name = 'overload-conductor-ring'; planeGeometry.name = 'ultimate-beam';
  resources.add(ringGeometry); resources.add(planeGeometry);
  function material(shader, color = amber) {
    const mat = new THREE.ShaderMaterial({ uniforms: { tint: { value: color.clone() }, age: { value: 0 }, power: { value: 1 }, reduced: { value: 0 } },
      vertexShader, fragmentShader: shader, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    mat.userData.glowSource = 'radiance'; resources.add(mat); return mat;
  }
  function ringMaterial() {
    const mat = new THREE.MeshBasicMaterial({ color: amber.clone().multiplyScalar(2.1), transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    mat.userData.glowSource = 'radiance'; resources.add(mat); return mat;
  }
  function ring() { return new THREE.Mesh(ringGeometry, ringMaterial()); }
  function arcMesh() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 18 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage)); resources.add(geometry);
    const mat = new THREE.LineBasicMaterial({ color: amber.clone().multiplyScalar(2.4), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    mat.userData.glowSource = 'radiance'; resources.add(mat);
    const mesh = new THREE.LineSegments(geometry, mat); mesh.frustumCulled = false; return mesh;
  }
  const rigs = [0, 1].map(i => {
    const group = new THREE.Group(); group.name = `overload-capacitor-${i}`;
    const rings = [ring(), ring(), ring()]; rings.forEach(mesh => group.add(mesh));
    const arcs = arcMesh(); group.add(arcs); group.visible = false; scene.add(group);
    const lane = new THREE.Mesh(planeGeometry, material(laneShader)); lane.name = 'overload-danger-zone'; lane.rotation.x = -Math.PI / 2; lane.visible = false; scene.add(lane);
    const ground = ring(); ground.name = 'overload-charge-ring'; ground.rotation.x = -Math.PI / 2; ground.visible = false; scene.add(ground);
    const cage = arcMesh(); cage.name = 'overload-victim-current'; cage.visible = false; scene.add(cage);
    const light = new THREE.PointLight(amber, 0, 3.2, 2); light.name = `OverloadSpill_${i}`; scene.add(light);
    return { group, rings, arcs, lane, ground, cage, light, owner: null, life: 0, duration: .36, power: 0, contactTint: amber.clone() };
  });
  const pulses = Array.from({ length: 6 }, () => {
    const group = new THREE.Group(), beam = new THREE.Mesh(planeGeometry, material(beamShader)); group.add(beam);
    const rings = [ring(), ring(), ring()]; rings.forEach(mesh => group.add(mesh)); group.visible = false; scene.add(group);
    return { group, beam, rings, age: 1, duration: .25, life: 0, facing: 1, length: 1, final: false };
  });
  function tint(player) { return player?.skin === 'cyan' ? cyan : amber; }
  function rig(player) { const index = player?.id === 'p2' ? 1 : 0; const value = rigs[index]; value.owner = player?.id; return value; }
  function anchor(player, key) {
    const p = player?.combatAnchors?.[key];
    return p && Number.isFinite(p.x + p.y + p.z) ? p : { x: (player?.x || 0) + (key === 'muzzle' ? (player?.facing || 1) * .65 : 0), y: (player?.y || 0) + 1.25, z: .35 };
  }
  function clear() {
    for (const s of rigs) { s.group.visible = s.lane.visible = s.ground.visible = s.cage.visible = false; s.life = 0; s.light.intensity = 0; }
    for (const s of pulses) { s.group.visible = false; s.life = 0; }
    seen.clear(); pulseCursor = 0; clock = 0;
  }
  function useContext(state) {
    const key = `${state?.room ?? ''}:${state?.round ?? ''}`;
    if (context !== null && key !== context) clear();
    context = key;
  }
  function emit(event, state) {
    const handled = event.type === 'ultimate' || event.type === 'ultimatePulse' || ['hit', 'block'].includes(event.type) && event.variant === 'overload';
    if (!handled) return null;
    useContext(state);
    if (disposed || event.presentationHistorical || state?.phase === 'paused') return 0;
    const key = event.id == null ? null : `${event.id}:${event.type}`;
    if (key && seen.has(key)) return 0;
    if (key) { seen.add(key); if (seen.size > 256) seen.delete(seen.values().next().value); }
    const source = state?.players?.find(p => p.id === event.player), color = tint(source);
    if (event.type === 'ultimate') return 0;
    if (event.type === 'ultimatePulse') {
      const pulse = clamp(event.pulse || 0, 0, 2), age = source?.action === 'ultimate' ? (source.actionTime || 0) - ULTIMATE_PULSES[pulse].time : source?.actionTime || 0;
      if (age > .28 || !source) return 0;
      const s = pulses[pulseCursor++ % pulses.length], p = anchor(source, 'muzzle');
      s.final = pulse === 2; s.duration = s.final ? .43 : .23; s.life = s.duration;
      s.facing = event.facing === -1 ? -1 : 1; s.length = clamp((event.range || ATTACKS.ultimate.range) - Math.abs(p.x - source.x), 1, 6);
      s.group.name = `ultimate-pulse-${pulse}`; s.group.visible = true; s.group.position.set(p.x, p.y, p.z + .035);
      s.beam.position.x = s.facing * s.length / 2; s.beam.scale.set(s.length, s.final ? 1.65 : .62, 1);
      s.beam.material.uniforms.tint.value.copy(color); s.beam.material.uniforms.age.value = 0;
      s.beam.material.uniforms.power.value = reduced ? .5 : 1; s.beam.material.uniforms.reduced.value = reduced ? 1 : 0;
      for (const r of s.rings) r.material.color.copy(color).multiplyScalar(2.1);
      stats.pulses++; return s.final ? .18 : .075;
    }
    const target = state?.players?.find(p => p.id === event.target);
    if (target) {
      const s = rig(target); s.life = s.duration = event.type === 'block' ? .18 : .36; s.power = event.type === 'block' ? .4 : 1;
      s.contactTint.copy(color); stats.contacts++;
    }
    return event.type === 'block' ? .035 : .07;
  }
  function arcs(mesh, time, strength, victim = false) {
    const positions = mesh.geometry.attributes.position;
    let index = 0;
    const count = low || reduced ? 2 : 4;
    for (let lane = 0; lane < count; lane++) for (let j = 0; j < 18; j++) for (const step of [j, j + 1]) {
      const u = step / 18, a = lane * Math.PI / 2 + u * 4.8 + time * (reduced ? 0 : 1.2);
      const radius = victim ? .43 + Math.sin(u * Math.PI) * .36 : .22 + .58 * (1 - u);
      const kink = Math.sin(step * 8.37 + lane * 13.8 + Math.floor(time * (reduced ? 0 : 18)) * 2.1) * .055 * Math.sin(u * Math.PI);
      positions.setXYZ(index++, Math.cos(a) * radius + kink, victim ? -.63 + u * 1.38 : -.55 + u * .69, Math.sin(a) * radius + kink + .13);
    }
    mesh.geometry.setDrawRange(0, index); positions.needsUpdate = true;
    mesh.material.opacity = strength * (reduced ? .42 : .8);
  }
  function update(dt, time, state) {
    if (disposed) return;
    useContext(state);
    const paused = state?.phase === 'paused';
    const step = paused ? 0 : clamp(Number.isFinite(dt) ? dt : 0, 0, .05); clock += step;
    for (const s of rigs) { s.group.visible = s.lane.visible = s.ground.visible = false; s.light.intensity = 0; s.light.visible = !low; }
    for (const player of state?.players ?? []) {
      const s = rig(player), color = tint(player), p = anchor(player, 'core');
      const active = player.action === 'ultimate' && ['fight', 'paused'].includes(state?.phase);
      if (active) {
        const t = Math.max(0, player.actionTime || 0), load = clamp(t / ATTACKS.ultimate.startup, 0, 1), fade = 1 - clamp((t - 1.6) / .42, 0, 1);
        s.group.visible = fade > 0; s.group.position.copy(p);
        const coilRadius = .53 - .21 * load;
        s.rings.forEach((r, i) => {
          r.visible = !low || i === 0; r.position.set(0, .04 + i * .08, .08 + i * .07);
          r.rotation.set(.20 * (i - 1), (reduced ? 0 : Math.sin(t * 2 + i) * .22), i * 2.1 + (reduced ? 0 : t * (i % 2 ? -2 : 2)));
          r.scale.setScalar(coilRadius + i * .12); r.material.color.copy(color).multiplyScalar(1.6 + load);
          r.material.opacity = (.18 + load * .6) * fade * (reduced ? .6 : 1);
        });
        s.arcs.material.color.copy(color).multiplyScalar(2.2); arcs(s.arcs, t, (.22 + load * .75) * fade);
        s.lane.visible = t < 1.55; s.lane.position.set(player.x + (player.facing || 1) * ATTACKS.ultimate.range / 2, .052, 0);
        s.lane.scale.set(ATTACKS.ultimate.range * (player.facing || 1), 1.30, 1); s.lane.material.uniforms.tint.value.copy(color);
        s.lane.material.uniforms.power.value = .45 + load * .4;
        s.ground.visible = fade > 0; s.ground.position.set(player.x, .057, 0); s.ground.scale.setScalar(1.1 + load * .10);
        s.ground.material.color.copy(color).multiplyScalar(1.6); s.ground.material.opacity = (.2 + load * .35) * fade;
        s.light.position.copy(p); s.light.position.z += .15; s.light.color.copy(color); s.light.intensity = low ? 0 : (3 + load * 14) * fade * (reduced ? .5 : 1);
      }
      s.life = Math.max(0, s.life - step); s.cage.visible = s.life > 0;
      if (s.life > 0) {
        const fade = s.life / s.duration; s.cage.position.copy(p); s.cage.material.color.copy(s.contactTint).multiplyScalar(2.5);
        arcs(s.cage, clock, fade * s.power, true);
        s.light.position.copy(p); s.light.position.z += .25; s.light.color.copy(s.contactTint);
        s.light.intensity = low ? 0 : 22 * fade * fade * s.power * (reduced ? .3 : 1);
      }
    }
    for (const s of pulses) {
      s.life = Math.max(0, s.life - step); s.group.visible = s.life > 0;
      if (!s.group.visible) continue;
      const age = 1 - s.life / s.duration; s.beam.material.uniforms.age.value = age;
      s.rings.forEach((r, i) => {
        r.visible = !low && (i === 0 || !reduced); const progress = clamp(age * 1.6 - i * .19, 0, 1);
        r.position.set(s.facing * s.length * progress, 0, .025); r.rotation.y = .8 * s.facing;
        r.scale.setScalar((s.final ? .45 : .28) * (1 - age * .55) * (1 + i * .13));
        r.material.opacity = Math.sin(progress * Math.PI) * (1 - age) * (reduced ? .3 : .7);
      });
    }
  }
  return { emit, update, clear, setQuality(value) { low = value === 'low'; }, setReducedMotion(value) { reduced = Boolean(value); },
    getStats() { return { ...stats, activePulses: pulses.filter(s => s.life > 0).length, capacity: pulses.length, lights: rigs.length, resources: resources.size }; },
    dispose() { if (disposed) return; clear(); disposed = true; for (const s of rigs) { scene.remove(s.group, s.ground, s.lane, s.cage, s.light); s.light.dispose(); } for (const s of pulses) scene.remove(s.group); for (const value of resources) value.dispose(); resources.clear(); } };
}
