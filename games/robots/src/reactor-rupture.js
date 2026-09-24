import * as THREE from 'three';

const HOT = new THREE.Color('#fff1c7');
const GOLD = new THREE.Color('#ffae43');
const COPPER = new THREE.Color('#db6025');
const clamp = THREE.MathUtils.clamp;
const finite = p => p && Number.isFinite(p.x + p.y + p.z);
const seeded = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Only authoritative finisher events own this effect. A destroyed snapshot
 * alone never lights a reactor. Two slots cover both fighters without growth. */
export function createReactorRupture(scene, { spark, plume, pressure }) {
  let low = false, reduced = false, disposed = false;
  const slots = Array.from({ length: 2 }, () => ({ owner: null, stage: '', age: 0,
    origin: new THREE.Vector3(), facing: 1, type: 'overload', beats: 0 }));
  const capacity = 16, centers = new Float32Array(capacity * 3), shapes = new Float32Array(capacity * 4),
    lives = new Float32Array(capacity * 2), colors = new Float32Array(capacity * 3);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.name = 'reactor-rupture-pool';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  geometry.setIndex([0,1,2,0,2,3]); geometry.instanceCount = capacity;
  for (const [name, data, size] of [['aCenter', centers, 3], ['aShape', shapes, 4], ['aLife', lives, 2], ['aColor', colors, 3]])
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aCenter;attribute vec4 aShape;attribute vec2 aLife;attribute vec3 aColor;
      varying vec2 vUv;varying vec2 vLife;varying vec3 vColor;varying float vKind;
      void main(){vUv=position.xy;vLife=aLife;vColor=aColor;vKind=aShape.w;
        float c=cos(aShape.z),s=sin(aShape.z);vec2 p=mat2(c,-s,s,c)*(position.xy*aShape.xy);
        vec4 center=modelViewMatrix*vec4(aCenter,1.0);center.xy+=p;gl_Position=projectionMatrix*center;}`,
    fragmentShader: `varying vec2 vUv;varying vec2 vLife;varying vec3 vColor;varying float vKind;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){float n=noise(vUv*5.0+vec2(vLife.x*13.0,-vLife.x*18.0));
        float radial=length(vUv);float edge=1.0-smoothstep(.25,.96,radial+(n-.5)*.25);
        float hot=pow(max(0.0,1.0-radial),3.0);
        float ribbon=(1.0-smoothstep(.10,.8,abs(vUv.y+(n-.5)*.35)))*(1.0-smoothstep(.2,.95,abs(vUv.x)));
        float alpha=mix(edge,ribbon,step(.5,vKind))*vLife.y;
        vec3 tint=mix(vColor,vec3(1.6,1.38,.92),hot*.68);
        gl_FragColor=vec4(tint,alpha);}` });
  material.userData.glowSource = 'radiance';
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'compact-reactor-release';
  mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh);
  const stats = { primes: 0, releases: 0, hotParticles: 0 };
  const work = new THREE.Vector3();

  function slotFor(owner) { return slots.find(s => s.owner === owner) ?? slots.find(s => !s.stage) ?? slots[0]; }
  function select(event, target, origin) {
    const s = slotFor(event.target ?? target?.id ?? 'reactor');
    s.owner = event.target ?? target?.id ?? 'reactor'; s.origin.copy(origin);
    s.facing = event.facing ?? -(target?.facing ?? -1); s.type = event.finisherType ?? event.variant ?? 'overload';
    s.age = 0; s.beats = 0; return s;
  }
  function prime(event, target, origin) {
    if (disposed || !finite(origin)) return;
    const s = select(event, target, origin); s.stage = 'prime';
    s.duration = clamp(event.duration ?? .9, .2, 1.1); stats.primes++;
  }
  function emitHot(s, count, force = 1, offset = 0) {
    const total = Math.ceil(count * (low ? .65 : 1) * (reduced ? .55 : 1));
    for (let i = 0; i < total; i++) {
      const seed = i + offset + (s.facing < 0 ? 131 : 0), a = seeded(seed + 1) * Math.PI * 2;
      // Unequal radial jets, biased by the physical finishing direction.
      const speed = (1.2 + seeded(seed + 2) * 3.9) * force;
      const down = s.type === 'brutality';
      spark(s.origin.x, s.origin.y, s.origin.z + .04,
        (Math.cos(a) * speed + s.facing * (s.type === 'coreRip' ? -.65 : .4)),
        (down ? -.35 : .7) + seeded(seed + 3) * (down ? 1.9 : 3.2) * force,
        Math.sin(a) * speed * .58 + .7,
        i < 5 ? HOT : i % 3 ? GOLD : COPPER, .42 + seeded(seed + 4) * .60,
        i < 5 ? .19 : .10 + seeded(seed + 5) * .05, 10.5);
    }
    stats.hotParticles += total;
  }
  function release(event, target, origin) {
    if (disposed || !finite(origin)) return;
    const s = select(event, target, origin); s.stage = 'release'; stats.releases++;
    emitHot(s, s.type === 'brutality' ? 38 : 52);
    // Small hot pockets peel away from the opening. They never form a screen-filling fireball.
    const count = low || reduced ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996 + .37;
      work.copy(s.origin).add(new THREE.Vector3(Math.cos(a) * .13, (i % 2) * .07, Math.sin(a) * .1));
      work.z += .20;
      plume(work, { size: .34 + seeded(i + 57) * .19, life: .46 + seeded(i + 7) * .34,
        vx: Math.cos(a) * .8 + s.facing * .15, vy: .38 + seeded(i + 11) * .48,
        vz: Math.sin(a) * .55, heat: i < 2 ? 1.55 : .52, color: '#77664f' });
    }
    const dustCount = low || reduced ? 4 : 7;
    for (let i = 0; i < dustCount; i++) {
      const a = i * 2.39996 + .2, speed = .8 + seeded(i + 28) * 1.05;
      work.set(s.origin.x + Math.cos(a) * .2, .07, s.origin.z + Math.sin(a) * .2);
      plume(work, { size: .25 + seeded(i + 9) * .12, life: .9 + seeded(i + 6) * .65,
        vx: Math.cos(a) * speed, vy: .10 + seeded(i + 12) * .10, vz: Math.sin(a) * speed * .72,
        color: '#84715a' });
    }
    pressure(s.origin.x, s.origin.z, s.type === 'brutality' ? 2.5 : 2.9, GOLD, reduced ? .17 : .33, .48);
  }
  function draw(index, origin, sx, sy, angle, kind, age, alpha, color) {
    origin.toArray(centers, index * 3);
    // The named anchor lies inside the original reactor mesh. This small
    // forward hemisphere is the vent volume, not a depth-test override.
    centers[index * 3 + 2] += .38;
    shapes.set([sx, sy, angle, kind], index * 4);
    lives.set([age, alpha], index * 2); color.toArray(colors, index * 3);
  }
  function update(dt, state) {
    if (disposed) return;
    dt = state?.phase === 'paused' ? 0 : clamp(Number(dt) || 0, 0, .05);
    shapes.fill(0); lives.fill(0);
    for (let j = 0; j < slots.length; j++) {
      const s = slots[j]; if (!s.stage) continue;
      s.age += dt;
      const index = j * 8;
      if (s.stage === 'prime') {
        const target = state?.players?.find(p => p.id === s.owner), origin = target?.combatAnchors?.core;
        if (finite(origin)) s.origin.copy(origin);
        // Missing the rupture packet cannot make the pre-release glow loop forever.
        if (s.age > s.duration + .12 || target && !['defeated', 'destroyed'].includes(target.action)) { s.stage = ''; continue; }
        const p = clamp(s.age / s.duration, 0, 1), tension = p * p;
        const intensity = (.14 + tension * .55) * (reduced ? .55 : 1);
        draw(index, s.origin, .09 + tension * .10, .12 + tension * .06, .2, 0, s.age, intensity, GOLD);
        draw(index + 1, s.origin, .22 + tension * .12, .024, -.3 * s.facing, 1, s.age, intensity * .75, HOT);
        const beats = [.20, .53, .77];
        while (s.beats < beats.length && s.age >= beats[s.beats]) { emitHot(s, 5, .25, 71 + s.beats * 9); s.beats++; }
      } else {
        const age = s.age;
        if (age > 1.6) { s.stage = ''; continue; }
        const housed = s.type !== 'coreRip';
        const flash = Math.max(0, 1 - age / (reduced ? .11 : .20));
        draw(index, s.origin, (housed ? .76 : .46) + age * 1.3,
          (housed ? .59 : .38) + age * .7, 0, 0, age, flash * (reduced ? .42 : 1.15), HOT);
        const jet = Math.max(0, 1 - age / .35);
        for (let i = 0; i < (low || reduced ? 2 : 4); i++) {
          const angle = [.23, 2.12, 3.71, 5.48][i] * s.facing;
          work.copy(s.origin); work.x += Math.cos(angle) * age * 1.45;
          work.y += Math.sin(angle) * age * .80; work.z += .04;
          draw(index + 1 + i, work, .32 + age * 1.65, .055 + age * .16, angle, 1, age, jet * (reduced ? .28 : .75), GOLD);
        }
        // A housed reactor vents through several nearby seams. These small
        // depth-tested pockets emerge around the shell instead of hiding
        // the entire blast behind its opaque centre or washing out the screen.
        if (housed) for (let i = 0; i < (low || reduced ? 2 : 3); i++) {
          const side = i === 0 ? -1 : 1;
          work.copy(s.origin);
          work.x += side * (.28 + age * (i === 2 ? .7 : 1.6));
          work.y += (i === 2 ? .35 : .07) + age * (i === 2 ? 1.5 : .4);
          work.z += .24;
          const heat = Math.max(0, 1 - age / .31);
          draw(index + 5 + i, work, .33 + age * .75, .28 + age * .65,
            i * .8, 0, age, heat * (reduced ? .22 : .72), i === 2 ? COPPER : GOLD);
        }
        if (!s.beats && age >= .16) { emitHot(s, 11, .42, 113); s.beats++; }
      }
    }
    for (const attribute of Object.values(geometry.attributes)) if (attribute.isInstancedBufferAttribute) attribute.needsUpdate = true;
  }
  function clear() { for (const s of slots) { s.stage = ''; s.owner = null; } shapes.fill(0); lives.fill(0); for (const key of Object.keys(stats)) stats[key] = 0; }
  return { prime, release, update, clear,
    setQuality(value) { low = value === 'low'; }, setReducedMotion(value) { reduced = Boolean(value); },
    getStats() { return { ...stats, active: slots.filter(s => s.stage).length, capacity: slots.length, sprites: capacity }; },
    dispose() { if (disposed) return; clear(); disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
