import * as THREE from 'three';

const CAPACITY = 8, SEGMENTS = 8, VERTICES = CAPACITY * SEGMENTS * 6;
const finite = p => p && Number.isFinite(p.x + p.y + p.z);
const anchor = (player, key) => finite(player?.damageAnchors?.[key]) ? player.damageAnchors[key] : null;
const hash = n => { const x = Math.sin(n * 127.13 + 73.17) * 43758.5453; return x - Math.floor(x); };

/** Analytic flight and floor collision, so a 30 Hz display has the same path as 120 Hz. */
export function stepElectricalFragment(p, dt) {
  const floor = .025, g = p.gravity, startY = p.y;
  const endY = startY + p.vy * dt - .5 * g * dt * dt;
  if (endY >= floor) {
    p.x += p.vx * dt; p.y = endY; p.z += p.vz * dt; p.vy -= g * dt; return;
  }
  const hitTime = Math.max(0, Math.min(dt, (p.vy + Math.sqrt(Math.max(0, p.vy * p.vy + 2 * g * (startY - floor)))) / g));
  p.x += p.vx * hitTime; p.z += p.vz * hitTime; p.y = floor;
  if (p.bounces++) { p.life = 0; return; }
  p.vy = -(p.vy - g * hitTime) * .18; p.vx *= .5; p.vz *= .5; p.size *= .7;
  const remaining = dt - hitTime;
  p.life = Math.min(p.life, .08 - remaining);
  p.x += p.vx * remaining; p.z += p.vz * remaining;
  p.y = Math.max(floor, floor + p.vy * remaining - .5 * g * remaining * remaining); p.vy -= g * remaining;
}

/** Two fixed draws: a thin conducting filament and a localized contact glow.
 * Arc endpoints remain attached to actual exterior rig contacts throughout the pulse.
 */
export function createElectricalFaults(scene) {
  let low = false, reduced = false, cursor = 0, serial = 0;
  const arcs = Array.from({ length: CAPACITY }, () => ({ life: 0 }));
  const positions = new Float32Array(VERTICES * 3), next = new Float32Array(VERTICES * 3);
  const side = new Float32Array(VERTICES), opacity = new Float32Array(VERTICES);
  const width = new Float32Array(VERTICES), along = new Float32Array(VERTICES);
  const geometry = new THREE.BufferGeometry(); geometry.name = 'damage-electrical-pool';
  for (const [name, array, itemSize] of [['position', positions, 3], ['aNext', next, 3], ['aSide', side, 1], ['aAlpha', opacity, 1], ['aWidth', width, 1], ['aAlong', along, 1]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage));
  }
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aNext;attribute float aSide,aAlpha,aWidth,aAlong;
      varying float vSide,vAlpha,vAlong;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.0),q=modelViewMatrix*vec4(aNext,1.0);
        vec2 d=q.xy-p.xy;vec2 n=vec2(-d.y,d.x)/max(length(d),.00001);
        p.xy+=n*aSide*aWidth;vSide=aSide;vAlpha=aAlpha;vAlong=aAlong;
        gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying float vSide,vAlpha,vAlong;
      void main(){float r=abs(vSide);float core=exp(-r*r*72.0),halo=exp(-r*r*5.0)*.30;
        float taper=.70+.30*sin(vAlong*3.141593);
        vec3 color=mix(vec3(.19,.49,1.0),vec3(.89,.99,1.0),core);
        gl_FragColor=vec4(color*1.8,(core+halo)*vAlpha*taper);}`,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'damage-electrical'; mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);

  const centers = new Float32Array(CAPACITY * 2 * 3), info = new Float32Array(CAPACITY * 2 * 2);
  const glowGeometry = new THREE.InstancedBufferGeometry(); glowGeometry.name = 'electrical-contact-glow-pool';
  glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  glowGeometry.setIndex([0,1,2,0,2,3]); glowGeometry.instanceCount = CAPACITY * 2;
  glowGeometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage));
  glowGeometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2).setUsage(THREE.DynamicDrawUsage));
  const glowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aCenter;attribute vec2 aInfo;varying vec2 vUv;varying float vAlpha;
      void main(){vec4 p=modelViewMatrix*vec4(aCenter,1.0);p.xy+=position.xy*aInfo.x;
        vUv=position.xy;vAlpha=aInfo.y;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 vUv;varying float vAlpha;
      void main(){float r=dot(vUv,vUv);float core=exp(-r*105.0),bloom=exp(-r*7.0);
        float glint=exp(-abs(vUv.y)*65.0-abs(vUv.x)*9.0)*.22;
        gl_FragColor=vec4(vec3(.23,.60,1.0)*bloom+vec3(.93,1.0,1.0)*(core+glint)*2.0,
          (core+bloom*.32+glint)*vAlpha*(1.0-smoothstep(.65,1.0,r)));}`,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial); glow.name = 'electrical-contact-glow'; glow.frustumCulled = false; glow.renderOrder = 6; scene.add(glow);
  material.userData.glowSource = glowMaterial.userData.glowSource = 'radiance';
  const nodes = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());

  function emit(player, key) {
    const from = anchor(player, key);
    if (reduced || !from) return false;
    // The nearest different hull contact is the return path. Never terminate in empty space.
    let target, distance = Infinity;
    for (const name of ['core', 'head', 'left', 'right']) {
      const to = name !== key && anchor(player, name);
      if (!to) continue;
      const d = (to.x-from.x)**2+(to.y-from.y)**2+(to.z-from.z)**2;
      if (d > .0025 && d < distance && d < 2.25) { distance = d; target = name; }
    }
    if (!target) return false;
    const seed = ++serial, duration = .13 + hash(seed) * .065;
    Object.assign(arcs[cursor], { owner: player.id, key, target, life: duration, duration, seed });
    cursor = (cursor + 1) % (low ? 4 : CAPACITY);
    return true;
  }
  function update(dt, players) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    opacity.fill(0); info.fill(0);
    for (let i = 0; i < CAPACITY; i++) {
      const arc = arcs[i]; arc.life = Math.max(0, arc.life - dt);
      if (!arc.life || reduced) continue;
      const player = players.find(p => p.id === arc.owner), from = anchor(player, arc.key), to = anchor(player, arc.target);
      if (!from || !to) { arc.life = 0; continue; }
      const age = arc.duration - arc.life, distance = Math.hypot(to.x-from.x, to.y-from.y, to.z-from.z);
      if (distance < .05 || distance > 1.5) { arc.life = 0; continue; }
      // Two irregular re-strikes, evaluated by age (not a random value every RAF).
      const strike = Math.floor(age * 24), reStrike = .60 + hash(arc.seed + strike * 19) * .40;
      const envelope = Math.pow(arc.life / arc.duration, .65) * reStrike;
      const bend = Math.min(.09, distance * .15);
      for (let j = 0; j <= SEGMENTS; j++) {
        const t = j / SEGMENTS, middle = j > 0 && j < SEGMENTS;
        nodes[j].copy(from).lerp(to, t);
        if (middle) {
          nodes[j].x += (hash(arc.seed * 31 + j * 7 + strike * 11) - .5) * bend;
          nodes[j].y += (hash(arc.seed * 13 + j * 17 + strike * 23) - .5) * bend;
          nodes[j].z += Math.sin(t * Math.PI) * .06;
        }
      }
      for (let segment = 0; segment < SEGMENTS; segment++) {
        const a = nodes[segment], b = nodes[segment+1];
        for (let corner = 0; corner < 6; corner++) {
          const atEnd = corner === 2 || corner === 4 || corner === 5;
          const p = atEnd ? b : a, q = atEnd ? a : b;
          const v = i * SEGMENTS * 6 + segment * 6 + corner;
          p.toArray(positions, v * 3); q.toArray(next, v * 3);
          side[v] = (corner === 0 || corner === 3 || corner === 5 ? -1 : 1) * (atEnd ? -1 : 1);
          opacity[v] = envelope; width[v] = .024; along[v] = (segment + Number(atEnd)) / SEGMENTS;
        }
      }
      for (let end = 0; end < 2; end++) {
        const slot = i * 2 + end, p = end ? to : from;
        centers[slot*3] = p.x; centers[slot*3+1] = p.y; centers[slot*3+2] = p.z + .012;
        info[slot*2] = end ? .115 : .25;
        info[slot*2+1] = envelope * (end ? .7 : 1.5);
      }
    }
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    glowGeometry.attributes.aCenter.needsUpdate = glowGeometry.attributes.aInfo.needsUpdate = true;
  }
  function clearOwner(owner) { for (const arc of arcs) if (owner == null || arc.owner === owner) arc.life = 0; }
  function clear() { clearOwner(null); opacity.fill(0); info.fill(0); cursor = 0; update(0, []); }
  return { emit, update, clearOwner, clear,
    setQuality(value) { low = value === 'low'; if (low) for (let i=4;i<CAPACITY;i++) arcs[i].life=0; cursor %= low ? 4 : CAPACITY; },
    setReducedMotion(value) { reduced = Boolean(value); if (reduced) clear(); },
    getStats() { return { electricalActive: arcs.filter(arc => arc.life > 0).length, arcCapacity: CAPACITY }; },
    dispose() { clear(); scene.remove(mesh, glow); geometry.dispose(); material.dispose(); glowGeometry.dispose(); glowMaterial.dispose(); },
  };
}
