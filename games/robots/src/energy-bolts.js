import * as THREE from 'three';

export const BOLT_CAPACITY = 8;
const EMPTY = [];

/** A single fixed draw for every travelling bolt. No impact, emitter or combat ownership. */
export function createEnergyBolts(scene, colorFor) {
  const anchors = new Float32Array(BOLT_CAPACITY * 4);
  const colors = new Float32Array(BOLT_CAPACITY * 3);
  const phases = new Float32Array(BOLT_CAPACITY);
  const slots = Array.from({ length: BOLT_CAPACITY }, () => ({ id: null, snapshot: null, observedAt: 0, phase: 0, used: false }));
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.name = 'energy-bolt-pool';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1.45, -.25, 0, .36, -.25, 0, .36, .25, 0, -1.45, .25, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, array, size] of [['aAnchor', anchors, 4], ['aColor', colors, 3], ['aPhase', phases, 1]]) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { detail: { value: 1 }, calm: { value: 0 } }, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
    vertexShader: `attribute vec4 aAnchor; attribute vec3 aColor; attribute float aPhase;
      varying vec2 vLocal; varying vec3 vColor; varying float vPhase; varying float vVisible;
      void main(){vLocal=position.xy;vColor=aColor;vPhase=aPhase;vVisible=aAnchor.w;
        vec3 p=vec3(aAnchor.x+position.x*aAnchor.z,aAnchor.y+position.y,.35);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float detail;uniform float calm;
      varying vec2 vLocal;varying vec3 vColor;varying float vPhase;varying float vVisible;
      float streak(vec2 p,float x,float y,float width,float length){
        float along=(p.x-x)/length;
        return smoothstep(-1.0,-.6,along)*(1.0-smoothstep(-.12,0.0,along))*exp(-pow((p.y-y)/width,2.0));
      }
      void main(){
        if(vVisible<.5)discard;
        vec2 p=vLocal;float h=clamp((p.x+.42)/.77,0.0,1.0);
        float envelope=smoothstep(-.43,-.22,p.x)*(1.0-smoothstep(.12,.35,p.x));
        float width=.027+.083*pow(max(0.0,sin(h*3.141593)),1.4);
        float shell=exp(-pow(p.y/width,2.0)*1.25)*envelope;
        float core=exp(-pow(p.y/(width*.34+.006),2.0)*1.8)*envelope;
        float hot=1.0-smoothstep(.08,.24,abs(p.x-.02));
        float wake=envelope*exp(-pow(p.y/(width*1.72),2.0)*2.0)*.13;
        float drift=calm>.5?0.0:fract(vPhase*5.0)*.12;
        float tail=streak(p,-.28-drift,.023,.013,.69)*.69;
        if(detail>.5){
          tail+=streak(p,-.57-drift,-.079,.010,.51)*.48;
          tail+=streak(p,-.36-drift,.10,.009,.30)*.37;
        }
        tail*=calm>.5?.55:1.0;
        float alpha=clamp(shell*.86+core*.9+wake+tail,0.0,1.0);
        vec3 tint=mix(vColor,vec3(.98,1.0,1.0),clamp(core*(.85+.15*hot),0.0,1.0));
        gl_FragColor=vec4(tint,alpha);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.glowSource = 'radiance';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'energy-bolts'; mesh.frustumCulled = false; mesh.visible = false;
  scene.add(mesh);
  let clock = 0, token, disposed = false;

  function clear() {
    for (const slot of slots) { slot.id = null; slot.snapshot = null; slot.phase = 0; slot.used = false; }
    anchors.fill(0); phases.fill(0); geometry.instanceCount = 0; mesh.visible = false; clock = 0; token = undefined;
    geometry.attributes.aAnchor.needsUpdate = true;
  }

  function update(dt, state) {
    if (disposed) return;
    const seek = token !== state?.visualSeekToken;
    if (seek) clear();
    token = state?.visualSeekToken;
    const step = state?.phase === 'paused' || !Number.isFinite(dt) ? 0 : Math.max(0, Math.min(.05, dt));
    clock += step;
    const projectiles = state?.projectiles ?? EMPTY;
    for (const slot of slots) {
      slot.used = false;
      let present = false;
      for (const p of projectiles) if (p.id === slot.id && (p.variant ?? 'bolt') === 'bolt') { present = true; break; }
      if (!present) { slot.id = null; slot.snapshot = null; slot.phase = 0; }
    }
    let count = 0;
    for (const p of projectiles) {
      if ((p.variant ?? 'bolt') !== 'bolt' || !Number.isFinite(p.x) || !Number.isFinite(p.y ?? 1.35) || p.id == null) continue;
      let index = -1;
      for (let i = 0; i < BOLT_CAPACITY; i++) if (slots[i].id === p.id) { index = i; break; }
      if (index < 0) {
        for (let i = 0; i < BOLT_CAPACITY; i++) if (slots[i].id === null) { index = i; break; }
      }
      if (index < 0) continue;
      const slot = slots[index], fresh = slot.id === null;
      if (slot.used) continue;
      slot.used = true; slot.id = p.id;
      if (fresh || step > 0 || seek) {
        if (slot.snapshot !== p) { slot.snapshot = p; slot.observedAt = clock; }
        const direction = p.direction === -1 ? -1 : 1;
        const speed = Number.isFinite(p.speed) ? p.speed : 10.5;
        const offset = Math.min(.045, Math.max(0, clock - slot.observedAt));
        anchors[index * 4] = p.x + direction * speed * offset;
        anchors[index * 4 + 1] = p.y ?? 1.35;
        anchors[index * 4 + 2] = direction;
        anchors[index * 4 + 3] = 1;
        colorFor(p.owner, state).toArray(colors, index * 3);
        slot.phase += step; phases[index] = slot.phase;
      }
      count = Math.max(count, index + 1);
    }
    for (let i = 0; i < BOLT_CAPACITY; i++) if (!slots[i].used) {
      slots[i].id = null; slots[i].snapshot = null; slots[i].phase = 0; anchors[i * 4 + 3] = 0;
    }
    geometry.instanceCount = count; mesh.visible = count > 0;
    geometry.attributes.aAnchor.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aPhase.needsUpdate = true;
  }

  return {
    update, clear,
    setQuality(value) { material.uniforms.detail.value = value === 'low' ? 0 : 1; },
    setReducedMotion(value) { material.uniforms.calm.value = value ? 1 : 0; },
    dispose() { if (disposed) return; disposed = true; clear(); scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
