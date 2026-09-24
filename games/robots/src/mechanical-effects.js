import * as THREE from 'three';
import { V5_ATTACKS } from '../shared/constants.js';
import { createReactorRupture } from './reactor-rupture.js';

const HOT = new THREE.Color('#ffe3ad'), ICE = new THREE.Color('#a5efff');
const AMBER = new THREE.Color('#ffb551'), CYAN = new THREE.Color('#60dbe5');
const finite = p => p && Number.isFinite(p.x + p.y + p.z);
const random = (a, b) => a + Math.random() * (b - a);
const timings = { jab: [.11, .10], cross: [.16, .12], rake: [.24, .12], launcher: [.24, .14],
  crusher: [.34, .14], airJab: [.09, .10], airCross: [.12, .10], airFinish: [.17, .12], dashStrike: [.13, .12],
  ...Object.fromEntries(['heavyDrive', 'heavyHook', 'heavyPress'].map(key => [key, [V5_ATTACKS[key].startup, V5_ATTACKS[key].active]])) };
const handled = new Set(['attack', 'hit', 'block', 'parry', 'launch', 'slam', 'land', 'dash', 'special',
  'grab', 'grabStrike', 'throw', 'grabBreak', 'burst', 'feint', 'ko', 'recover', 'finisherStart', 'finisherImpact', 'destruction']);

/** V5 mechanical contact grammar. No speculative damage or destruction timing. */
export function createMechanicalEffects(scene, { spark }) {
  let low = false, reduced = false, context = null;
  const seen = new Set(), attacks = new Map(), muzzleQueue = [];
  const stats = { contacts: 0, punishHits: 0, counterHits: 0, grabStrikes: 0, finisherImpacts: 0, destructions: 0, plumesEmitted: 0, trailSamples: 0 };
  const plumeCount = 48, trailCount = 8, sampleCount = 16;
  const plumes = Array.from({ length: plumeCount }, () => ({ life: 0 }));
  let plumeCursor = 0;
  const centers = new Float32Array(plumeCount * 3), plumeInfo = new Float32Array(plumeCount * 4);
  const plumeColors = new Float32Array(plumeCount * 3);
  const plumeGeometry = new THREE.InstancedBufferGeometry();
  plumeGeometry.name = 'turbulent-plume-pool';
  plumeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  plumeGeometry.setIndex([0,1,2, 0,2,3]); plumeGeometry.instanceCount = plumeCount;
  for (const [name, array, itemSize] of [['aCenter', centers, 3], ['aInfo', plumeInfo, 4], ['aTint', plumeColors, 3]]) plumeGeometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage));
  const plumeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec3 aCenter;attribute vec4 aInfo;attribute vec3 aTint;
      varying vec2 vUv;varying vec4 vInfo;varying vec3 vTint;
      void main(){vUv=position.xy;vInfo=aInfo;vTint=aTint;float s=sin(aInfo.w),c=cos(aInfo.w);
        vec2 uv=mat2(c,-s,s,c)*position.xy;vec4 center=modelViewMatrix*vec4(aCenter,1.0);
        center.xy+=uv*aInfo.x;gl_Position=projectionMatrix*center;}`,
    fragmentShader: `varying vec2 vUv;varying vec4 vInfo;varying vec3 vTint;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){return noise(p)*.57+noise(p*2.11)*.28+noise(p*4.17)*.15;}
      void main(){float age=vInfo.y;vec2 p=vUv*2.7+vec2(vInfo.w*3.0,-age*1.8);
        float n=fbm(p),swirl=fbm(p+vec2(n*1.4,age*.9));float radial=length(vUv);
        float silhouette=1.0-smoothstep(.48,1.05,radial+(swirl-.5)*.22);
        float density=clamp((n*.72+swirl*.35-.19)*1.9,0.0,1.0)*silhouette;
        float fade=smoothstep(0.0,.09,age)*(1.0-smoothstep(.45,1.0,age));
        float heat=vInfo.z*pow(1.0-age,2.5);float flame=pow(clamp(n*1.4,0.0,1.0),2.0)*heat;
        vec3 smoke=mix(vec3(.075,.09,.095),vTint,.28+n*.33);
        vec3 fire=mix(vec3(.92,.13,.008),vec3(1.5,1.08,.36),pow(flame,.65));
        gl_FragColor=vec4(mix(smoke,fire,clamp(flame*1.8,0.0,1.0)),density*fade*(.25+heat*.58));}`,
  });
  const plumeMesh = new THREE.Mesh(plumeGeometry, plumeMaterial);
  plumeMesh.name = 'rupture-and-contact-smoke'; plumeMesh.frustumCulled = false; plumeMesh.renderOrder = 3; scene.add(plumeMesh);

  const marks = Array.from({ length: 12 }, () => ({ life: 0 }));
  const markCenters = new Float32Array(36), markInfo = new Float32Array(48), markColor = new Float32Array(36);
  const markGeometry = new THREE.InstancedBufferGeometry(); markGeometry.name = 'contact-fracture-pool';
  markGeometry.setAttribute('position', plumeGeometry.attributes.position.clone()); markGeometry.setIndex([0,1,2,0,2,3]); markGeometry.instanceCount = 12;
  for (const [name, array, size] of [['aCenter', markCenters, 3], ['aInfo', markInfo, 4], ['aTint', markColor, 3]]) markGeometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  const markMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aCenter;attribute vec4 aInfo;attribute vec3 aTint;varying vec2 vUv;varying vec4 vInfo;varying vec3 vTint;
      void main(){vUv=position.xy;vInfo=aInfo;vTint=aTint;float s=sin(aInfo.z),c=cos(aInfo.z);vec2 uv=mat2(c,-s,s,c)*position.xy;
        vec4 point=modelViewMatrix*vec4(aCenter,1.0);point.xy+=uv*aInfo.x;gl_Position=projectionMatrix*point;}`,
    fragmentShader: `varying vec2 vUv;varying vec4 vInfo;varying vec3 vTint;
      float segment(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));}
      void main(){float d=1.0;vec2 p=vUv;
        if(vInfo.w<.5){d=min(segment(p,vec2(-.9,-.13),vec2(.9,.13)),segment(p,vec2(-.2,.8),vec2(.2,-.8)));}
        else{d=min(segment(p,vec2(-.8,-.55),vec2(-.17,-.11)),segment(p,vec2(-.17,-.11),vec2(.16,-.28)));
          d=min(d,segment(p,vec2(.16,-.28),vec2(.74,.6)));d=min(d,segment(p,vec2(-.17,-.11),vec2(-.31,.73)));
          d=min(d,segment(p,vec2(.12,-.24),vec2(.79,-.39)));}
        float line=exp(-d*d*1800.0)+exp(-d*d*230.0)*.15;float fade=pow(1.0-vInfo.y,1.7);
        gl_FragColor=vec4(vTint*1.2+vec3(.65,.7,.7)*exp(-d*d*4500.0),line*fade);}` });
  const markMesh = new THREE.Mesh(markGeometry, markMaterial); markMesh.name = 'parry-and-armor-fractures'; markMesh.frustumCulled = false; markMesh.renderOrder = 5; scene.add(markMesh);
  let markCursor = 0;

  // Real tip-to-foot trajectories create strips, never a pre-drawn rotating circle.
  const tracks = Array.from({ length: trailCount }, () => ({ key: null, count: 0, elapsed: -1,
    samples: Array.from({ length: sampleCount }, () => ({ tip: new THREE.Vector3(), base: new THREE.Vector3(), age: 1 })) }));
  const vertices = trailCount * (sampleCount - 1) * 6;
  const trailPositions = new Float32Array(vertices * 3), trailColors = new Float32Array(vertices * 3), trailAlpha = new Float32Array(vertices), trailUv = new Float32Array(vertices * 2);
  const trailGeometry = new THREE.BufferGeometry(); trailGeometry.name = 'articulated-claw-trajectories';
  trailGeometry.setDrawRange(0, 0);
  for (const [name, array, size] of [['position', trailPositions, 3], ['aColor', trailColors, 3], ['aAlpha', trailAlpha, 1], ['uv', trailUv, 2]]) trailGeometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  const trailMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aColor;attribute float aAlpha;varying vec3 vColor;varying float vAlpha;varying vec2 vUv;
      void main(){vColor=aColor;vAlpha=aAlpha;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vColor;varying float vAlpha;varying vec2 vUv;
      void main(){float edge=pow(1.0-vUv.y,3.0);float body=(1.0-vUv.y)*.19;
        gl_FragColor=vec4(vColor*.9+vec3(1.0,.91,.72)*edge*.65,(edge*.75+body)*vAlpha);}`,
  });
  const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
  trailMesh.name = 'claw-contact-trails'; trailMesh.frustumCulled = false; trailMesh.renderOrder = 4; scene.add(trailMesh);
  const waves = Array.from({ length: 4 }, () => {
    const material = new THREE.ShaderMaterial({ uniforms: { age: { value: 1 }, tint: { value: HOT.clone() }, strength: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float age;uniform vec3 tint;uniform float strength;varying vec2 vUv;
        void main(){float a=atan(vUv.y,vUv.x);float r=length(vUv);float front=.10+sqrt(age)*.84;
          float uneven=sin(a*13.0+age*8.0)*.008+sin(a*27.0)*.004;
          float line=exp(-pow((r-front+uneven)/(.016+age*.025),2.0));
          float wake=exp(-pow((r-front+.06)/.08,2.0))*.18;
          gl_FragColor=vec4(tint,(line+wake)*pow(1.0-age,1.5)*strength);}` });
    const geometry = new THREE.PlaneGeometry(2, 2); geometry.name = 'pressure-front';
    const mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2; mesh.visible = false; scene.add(mesh);
    return { mesh, life: 0, duration: .5 };
  });
  let waveCursor = 0;
  const rupture = createReactorRupture(scene, { spark, plume, pressure });
  const point = new THREE.Vector3(), direction = new THREE.Vector3(), base = new THREE.Vector3();
  function anchor(player, name, fallback) { const p = player?.combatAnchors?.[name]; return finite(p) ? p : fallback; }
  function team(player) { return player?.skin === 'cyan' ? CYAN : AMBER; }
  function surface(player, event) {
    let nearest, best = Infinity;
    for (const value of Object.values(player?.damageAnchors ?? {})) {
      if (!finite(value)) continue;
      const distance = (value.x - (event.x ?? player.x ?? 0)) ** 2 + (value.y - (event.y ?? (player.y ?? 0) + 1)) ** 2 - value.z * .20;
      if (distance < best) { nearest = value; best = distance; }
    }
    return nearest ?? anchor(player, 'core', point.set(event.x ?? player?.x ?? 0, event.y ?? (player?.y ?? 0) + 1.1, .45));
  }
  function eject(origin, color, count, facing = 1, force = 1, vertical = 0) {
    const total = Math.round(count * (low ? .62 : 1) * (reduced ? .58 : 1));
    for (let i = 0; i < total; i++) {
      const cone = random(-.95, .95), speed = random(2.8, 6.9) * force;
      const vx = Math.cos(cone) * speed * facing, vy = Math.sin(cone) * speed + 1.7 + vertical;
      spark(origin.x, origin.y, origin.z, vx, vy, random(.7, 2.7) * force,
        i % 5 === 0 ? color : HOT, random(.24, .60), random(.14, .24), 11);
    }
  }
  function plume(origin, { size = .3, life = .75, vx = 0, vy = .6, vz = .15, heat = 0, color = '#708180' } = {}) {
    const slot = plumes[plumeCursor]; plumeCursor = (plumeCursor + 1) % (low ? 24 : plumeCount);
    Object.assign(slot, { x: origin.x, y: origin.y, z: origin.z, vx, vy, vz, size, life, duration: life, heat, rotation: random(-3, 3) });
    slot.color ??= new THREE.Color(); slot.color.set(color); stats.plumesEmitted++;
  }
  function pressure(x, z, radius, color, strength = .35, duration = .5) {
    const wave = waves[waveCursor]; waveCursor = (waveCursor + 1) % waves.length;
    wave.life = wave.duration = duration; wave.mesh.position.set(x, .048, z); wave.mesh.scale.setScalar(radius);
    wave.mesh.material.uniforms.tint.value.copy(color); wave.mesh.material.uniforms.strength.value = strength * (reduced ? .55 : 1); wave.mesh.visible = true;
  }
  function fracture(origin, cracked, facing, color = ICE) {
    const index = markCursor; markCursor = (markCursor + 1) % marks.length;
    const item = marks[index]; item.life = item.duration = cracked ? .25 : .14;
    markCenters[index * 3] = origin.x; markCenters[index * 3 + 1] = origin.y; markCenters[index * 3 + 2] = origin.z + .035;
    markInfo[index * 4] = cracked ? .48 : .56; markInfo[index * 4 + 1] = 0; markInfo[index * 4 + 2] = facing * .4; markInfo[index * 4 + 3] = cracked ? 1 : 0;
    color.toArray(markColor, index * 3);
  }
  function dust(origin, force = 1, count = 5) {
    const total = low || reduced ? Math.ceil(count / 2) : count;
    for (let i = 0; i < total; i++) { const a = i / total * Math.PI * 2;
      plume(origin, { size: .36 * force, life: random(.7, 1.1), vx: Math.cos(a) * force * 1.6,
        vz: Math.sin(a) * force, vy: .25, color: '#998e75' }); }
  }
  function clear() {
    rupture.clear();
    for (const item of plumes) item.life = 0;
    for (const track of tracks) { track.key = null; track.count = 0; }
    for (const wave of waves) { wave.life = 0; wave.mesh.visible = false; }
    plumeInfo.fill(0); trailAlpha.fill(0); attacks.clear(); seen.clear(); muzzleQueue.length = 0;
    for (const item of marks) item.life = 0; markInfo.fill(0);
    for (const key of Object.keys(stats)) stats[key] = 0;
  }
  function sync(state) {
    const key = `${state?.room ?? ''}:${state?.round ?? 0}`;
    if (key !== context) { clear(); context = key; }
  }
  function emit(event, state) {
    if (!handled.has(event.type)) return null;
    sync(state);
    const key = event.id == null ? null : `${event.type}:${event.id}`;
    if (key && seen.has(key)) return 0;
    if (key) { seen.add(key); if (seen.size > 512) seen.delete(seen.values().next().value); }
    if (state?.phase === 'paused') return 0;
    const source = state?.players?.find(p => p.id === event.player), target = state?.players?.find(p => p.id === event.target);
    // A reconnect can include the server's recent event history; an existing wreck must stay quiet.
    if (event.type === 'destruction' && (target?.destructionTime ?? 0) > .22) return 0;
    if (event.type === 'finisherImpact' && (source?.actionTime ?? 0) > 1.52) return 0;
    if (event.type === 'grabStrike' && (target?.grabStrikeTime ?? 0) > .30) return 0;
    const facing = event.facing ?? source?.facing ?? 1, color = team(source);
    const contact = surface(event.type === 'parry' ? source : target ?? source, event);
    const x = event.x ?? source?.x ?? 0, y = event.y ?? (source?.y ?? 0) + 1.1;
    if (event.type === 'attack') {
      attacks.set(event.player, { variant: event.variant ?? '', action: event.action, startup: event.startup ?? .11, active: event.active ?? .12 });
      return 0;
    }
    if (event.type === 'hit' || event.type === 'grabStrike') {
      if (event.type === 'hit' && event.variant === 'grab') return 0;
      const heavy = event.damage >= 14 || event.type === 'grabStrike';
      eject(contact, event.counter ? ICE : event.punish ? HOT : color, heavy || event.counter ? 24 : 15, facing, heavy || event.punish ? 1.0 : .73, event.counter ? 1.4 : 0);
      plume(contact, { size: heavy ? .42 : .28, life: .6, vx: facing * .55, heat: .25, color: '#b3a791' });
      stats.contacts++;
      if (event.punish) stats.punishHits++;
      if (event.counter) stats.counterHits++;
      if (event.type === 'grabStrike') stats.grabStrikes++;
      return event.counter ? .125 : event.punish ? .105 : heavy ? .105 : .052;
    }
    if (event.type === 'block' || event.type === 'parry') {
      if (event.guardBreak || event.type === 'parry') fracture(contact, event.guardBreak, facing);
      eject(contact, event.type === 'parry' ? ICE : HOT, event.guardBreak ? 32 : 19, -facing, event.type === 'parry' ? 1.2 : .75, event.type === 'parry' ? 2.2 : 0);
      plume(contact, { size: event.guardBreak ? .48 : .2, life: .42, heat: event.guardBreak ? .35 : .05 });
      return event.guardBreak ? .11 : event.type === 'parry' ? .065 : .024;
    }
    if (event.type === 'special') {
      if (event.variant !== 'burst' && muzzleQueue.length < 8) muzzleQueue.push({ player: event.player, left: event.startup ?? .30, variant: event.variant });
      return 0;
    }
    if (event.type === 'launch') { eject(contact, color, 20, facing, .45, 4.3); return .075; }
    if (event.type === 'slam' || event.type === 'land') {
      const slam = event.type === 'slam'; point.set(x, .08, .12);
      // The simulation emits land and slam at the same contact. Give it one
      // visual impact, and do not replay a historical landing after reconnect.
      if (!slam && source?.variant === 'slam') return 0;
      if (slam && Number.isFinite(event.landedTime) && (source?.variant !== 'slam'
        || !Number.isFinite(source?.landedTime) || Math.abs(source.landedTime - event.landedTime) > .01
        || (source.actionTime ?? 0) - event.landedTime > .16)) return 0;
      if (slam) {
        const count = low || reduced ? 10 : 20;
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2 + random(-.12, .12), speed = random(2.8, 5.6);
          const dx = Math.cos(angle), dz = Math.sin(angle);
          spark(x + dx * .58, .045, dz * .48, dx * speed, random(.65, 1.8), dz * speed * .72,
            HOT, random(.18, .36), random(.075, .125), 14);
        }
        const puffs = low || reduced ? 4 : 8;
        for (let i = 0; i < puffs; i++) {
          const angle = i / puffs * Math.PI * 2, dx = Math.cos(angle), dz = Math.sin(angle);
          point.set(x + dx * .6, .095, dz * .5);
          plume(point, { size: .23, life: random(.45, .66), vx: dx * 2.4, vz: dz * 1.8, vy: .12, color: '#a7a997' });
        }
        pressure(x, 0, event.range ?? 3.2, HOT, .30, .40);
      } else { eject(point, color, 7, 1, .28); dust(point, .5, 3); }
      return slam ? .17 : .02;
    }
    if (event.type === 'dash' || event.type === 'feint') {
      const core = anchor(source, 'core', point.set(x, y, .2));
      eject(core, color, event.variant === 'airDash' ? 12 : 7, -facing, .6, -.4);
      if ((source?.y ?? 0) < .2) { point.set(x, .06, .1); dust(point, .5, 3); }
      attacks.delete(event.player); return 0;
    }
    if (event.type === 'grab') { eject(contact, HOT, 7, facing, .35); return .02; }
    if (event.type === 'throw') { eject(contact, color, 12, event.grabThrowDirection ?? facing, .72); return .075; }
    if (event.type === 'grabBreak') { if (event.reason !== 'interrupted') { eject(contact, ICE, 9, -1, .55); eject(contact, ICE, 9, 1, .55); } return .03; }
    if (event.type === 'burst') {
      attacks.delete(event.player);
      const originHeight = Number.isFinite(event.y) ? event.y - 1.1 : source?.y ?? 0;
      const fallback = point.set(x, y, .1);
      const core = Math.abs(originHeight - (source?.y ?? 0)) > .4 ? fallback : anchor(source, 'core', fallback);
      eject(core, ICE, 16, 1, 1.25); eject(core, ICE, 16, -1, 1.25);
      for (let i = 0; i < (low || reduced ? 3 : 5); i++) plume(core, { size: .27, life: .55, vx: (i - 2) * 1.4, vy: .4, color: '#b6e5e3' });
      if (originHeight < .18) pressure(source?.x ?? x, 0, event.radius ?? 3.4, ICE, .3, .42);
      return 0;
    }
    if (event.type === 'ko') { eject(contact, HOT, 17, facing, .48); plume(contact, { size: .5, life: 1.35, vy: .45 }); return .075; }
    if (event.type === 'recover') { const core = anchor(source, 'core', contact); plume(core, { size: .35, life: .65, vy: .4, color: '#a4cdce' }); return 0; }
    if (event.type === 'finisherStart') return 0;
    if (event.type === 'finisherImpact') {
      const core = anchor(target, 'core', contact);
      fracture(core, true, facing, HOT);
      eject(core, HOT, 12, -facing, .65, .4);
      rupture.prime(event, target, core);
      stats.finisherImpacts++; return .12;
    }
    if (event.type === 'destruction') {
      const core = anchor(target, 'core', contact);
      rupture.release(event, target, core);
      stats.destructions++; return reduced ? .025 : .19;
    }
    return 0;
  }
  function update(dt, time, state) {
    sync(state); dt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .05) : 0;
    rupture.update(dt, state);
    const live = state?.phase === 'fight';
    for (let i = muzzleQueue.length - 1; i >= 0; i--) {
      const shot = muzzleQueue[i];
      if (state?.phase === 'paused') continue;
      if (state?.phase && !live) { muzzleQueue.splice(i, 1); continue; }
      shot.left -= dt;
      if (shot.left > 0) continue;
      const player = state?.players?.find(p => p.id === shot.player);
      if (player?.action === 'special' && player.variant !== 'burst') {
        const muzzle = anchor(player, 'muzzle', point.set(player.x + player.facing * .7, (player.y ?? 0) + 1.35, .3));
        eject(muzzle, team(player), 18, player.facing ?? 1, .85);
        plume(muzzle, { size: .34, life: .24, vx: (player.facing ?? 1) * 2.1, vy: .1, heat: .9, color: '#bfe7e5' });
      }
      muzzleQueue.splice(i, 1);
    }
    for (let i = 0; i < plumeCount; i++) {
      const puff = plumes[i]; puff.life = Math.max(0, puff.life - dt);
      if (!puff.life) { plumeInfo[i * 4] = 0; plumeInfo[i * 4 + 1] = 1; continue; }
      const age = 1 - puff.life / puff.duration;
      puff.x += puff.vx * dt; puff.y += puff.vy * dt; puff.z += puff.vz * dt;
      puff.vx *= Math.exp(-dt * 1.4); puff.vz *= Math.exp(-dt * 1.4);
      centers[i * 3] = puff.x; centers[i * 3 + 1] = puff.y; centers[i * 3 + 2] = puff.z;
      plumeInfo[i * 4] = puff.size * (.42 + Math.sqrt(age) * 1.35); plumeInfo[i * 4 + 1] = age;
      plumeInfo[i * 4 + 2] = puff.heat; plumeInfo[i * 4 + 3] = puff.rotation;
      puff.color.toArray(plumeColors, i * 3);
    }
    for (const attribute of Object.values(plumeGeometry.attributes)) if (attribute.isInstancedBufferAttribute) attribute.needsUpdate = true;
    for (let i = 0; i < marks.length; i++) {
      const item = marks[i]; item.life = Math.max(0, item.life - dt);
      markInfo[i * 4 + 1] = item.life > 0 ? 1 - item.life / item.duration : 1;
      if (!item.life) markInfo[i * 4] = 0;
    }
    for (const attribute of Object.values(markGeometry.attributes)) if (attribute.isInstancedBufferAttribute) attribute.needsUpdate = true;
    for (const wave of waves) {
      wave.life = Math.max(0, wave.life - dt); wave.mesh.visible = wave.life > 0;
      wave.mesh.material.uniforms.age.value = 1 - wave.life / wave.duration;
    }
    for (const track of tracks) for (let i = 0; i < track.count; i++) track.samples[i].age += dt;
    for (const player of state?.players ?? []) {
      const attack = attacks.get(player.id), timing = timings[player.variant] ?? [player.action === 'heavy' ? .36 : .105, .12];
      const startup = attack && attack.variant === player.variant ? attack.startup : timing[0];
      const active = attack && attack.variant === player.variant ? attack.active : timing[1];
      const elapsed = player.actionTime ?? 0;
      const attacking = live && ['light', 'heavy'].includes(player.action) && !['grab', 'slam'].includes(player.variant)
        && elapsed >= startup - .045 && elapsed <= startup + active + .045;
      const both = ['rake', 'airFinish', 'crusher', 'heavyPress'].includes(player.variant)
        || player.action === 'heavy' && !['heavyDrive', 'heavyHook'].includes(player.variant);
      for (const side of ['left', 'right']) {
        const key = `${player.id}:${side}`;
        let track = tracks.find(item => item.key === key);
        const selected = both || (['cross', 'airCross', 'heavyDrive'].includes(player.variant) ? side === 'right' : side === 'left');
        const tip = player.combatAnchors?.[`${side}Claw`], root = player.combatAnchors?.[`${side}ClawBase`];
        if (!attacking || !selected || !finite(tip)) continue;
        if (!track) { track = tracks.find(item => item.key == null || item.samples[0].age > .3); if (!track) continue; track.key = key; track.count = 0; }
        if (elapsed < track.elapsed || track.variant !== player.variant) track.count = 0;
        track.elapsed = elapsed; track.variant = player.variant; track.color = team(player);
        if (track.count && track.samples[0].tip.distanceToSquared(tip) < .00009) continue;
        for (let i = Math.min(track.count, sampleCount - 1); i > 0; i--) {
          track.samples[i].tip.copy(track.samples[i - 1].tip); track.samples[i].base.copy(track.samples[i - 1].base); track.samples[i].age = track.samples[i - 1].age;
        }
        track.samples[0].tip.copy(tip);
        track.samples[0].base.copy(finite(root) ? base.copy(tip).lerp(root, .75) : base.copy(tip).add(direction.set(0, -.20, 0)));
        track.samples[0].age = 0; track.count = Math.min(sampleCount, track.count + 1); stats.trailSamples++;
      }
    }
    trailAlpha.fill(0);
    let out = 0;
    for (const track of tracks) {
      for (let i = 0; i < track.count - 1; i++) {
        const a = track.samples[i], b = track.samples[i + 1];
        if (a.age > .16 || b.age > .19) continue;
        for (let j = 0; j < 6; j++, out++) {
          const corner = j === 0 ? a.tip : j === 1 || j === 4 ? a.base : j === 5 ? b.base : b.tip;
          corner.toArray(trailPositions, out * 3); track.color.toArray(trailColors, out * 3);
          trailAlpha[out] = Math.max(0, 1 - (j < 2 ? a.age : b.age) / (reduced ? .095 : .18)) * (reduced ? .38 : .76);
          trailUv[out * 2] = j < 2 ? 0 : 1; trailUv[out * 2 + 1] = j === 1 || j === 4 || j === 5 ? 1 : 0;
        }
      }
    }
    trailGeometry.setDrawRange(0, out);
    for (const attribute of Object.values(trailGeometry.attributes)) attribute.needsUpdate = true;
  }
  return { emit, update, clear,
    setQuality(value) { low = value === 'low'; rupture.setQuality(value); }, setReducedMotion(value) { reduced = Boolean(value); rupture.setReducedMotion(value); },
    getStats() { return { ...stats, plumeActive: plumes.filter(p => p.life > 0).length, plumeCapacity: plumeCount, fractureActive: marks.filter(p => p.life > 0).length,
      trailVertices: trailGeometry.drawRange.count, trailCapacity: vertices, waveActive: waves.filter(w => w.life > 0).length, rupture: rupture.getStats() }; },
    dispose() { clear(); rupture.dispose(); scene.remove(plumeMesh, trailMesh, markMesh); plumeGeometry.dispose(); plumeMaterial.dispose(); trailGeometry.dispose(); trailMaterial.dispose(); markGeometry.dispose(); markMaterial.dispose();
      for (const wave of waves) { scene.remove(wave.mesh); wave.mesh.geometry.dispose(); wave.mesh.material.dispose(); } },
  };
}
