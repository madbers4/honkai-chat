import * as THREE from 'three';
import { ATTACKS, VARIANT_ATTACKS, clamp } from '../shared/constants.js';

const TAU = Math.PI * 2;
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const pulse = (t, a, b, c) => t < b ? smooth((t - a) / (b - a)) : 1 - smooth((t - b) / (c - b));
export const ABILITY_LIMITS = Object.freeze({ mines: 4, emitters: 2, contacts: 4, lights: 2 });

const vertex = `varying vec2 vUv;void main(){vUv=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const shared = `uniform vec3 tint;uniform float age,energy,detail,calm;varying vec2 vUv;
 float line(float v,float width){return exp(-pow(v/width,2.0));}
 float lightning(float a,float r,float t){return sin(a*11.0+r*19.0-t*3.0)*.012+sin(a*27.0-r*41.0+t*5.0)*.006;}`;

/** All ability visuals have fixed slots. State drives charge and mine phases,
 * so reconnects can show a current field without replaying its initial flash. */
export function createAbilityEffects(scene, { colorFor, spark = () => {} }) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const shellGeometry = new THREE.SphereGeometry(1, 40, 12, 0, TAU, 0, Math.PI / 2);
  const materials = [], groups = [], seen = new Set();
  const lightPosition = new THREE.Vector3();
  let low = false, reduced = false, disposed = false, clock = 0, token, round, contactCursor = 0, burstCount = 0;
  function material(fragment, customVertex = vertex) {
    const m = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color() }, age: { value: 0 },
      energy: { value: 0 }, detail: { value: 1 }, calm: { value: 0 } },
      vertexShader: customVertex, fragmentShader: fragment, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending });
    m.userData.glowSource = 'radiance'; materials.push(m); return m;
  }
  const groundFragment = `${shared}
    void main(){float r=length(vUv),a=atan(vUv.y,vUv.x);float t=max(0.0,age-.12);
      float travel=clamp(t/.16,0.0,1.0);float front=.10+travel*.85;
      float jag=lightning(a,r,calm>.5?0.0:t)*detail;
      float fade=1.0-smoothstep(.20,.58,t);
      float shock=line(r-front+jag,.010+travel*.007)*step(.12,age)*fade;
      float echo=line(r-front*.73-jag*.6,.008)*step(.16,age)*fade*.35;
      float ticks=pow(max(0.0,cos(a*12.0)),34.0)*line(r-.24,.055);
      float armed=(line(r-.21,.009)+line(r-.14,.004)*.55+ticks*.45)*(1.0-smoothstep(.12,.25,age));
      float spoke=pow(max(0.0,cos(a*9.0+r*6.0+sin(r*33.0)*.28)),55.0);
      float current=spoke*smoothstep(.09,.22,r)*(1.0-smoothstep(front-.10,front,r))*fade*step(.12,age)*detail*.25;
      float hot=shock+armed*.55;
      vec3 c=tint*(shock*2.0+echo*.9+armed*1.2+current)+vec3(.86,1.0,1.0)*hot*.9;
      float alpha=clamp(shock+echo+armed*.8+current,0.0,1.0)*energy;
      if(alpha<.002)discard;gl_FragColor=vec4(c,alpha);}`;
  const shellFragment = `${shared}
    void main(){float t=max(0.0,age-.12),v=vUv.y*.5+.5;
      float arc=line(v-.32-sin(vUv.x*42.0+t*8.0)*.019,.008);
      float second=line(v-.63-sin(vUv.x*29.0-t*7.0)*.035,.010)*.45*detail;
      float ribs=pow(max(0.0,cos(vUv.x*75.4+sin(v*25.0)*.22)),90.0)*.42*detail;
      float fade=(1.0-smoothstep(.10,.43,t))*smoothstep(0.0,.035,t);
      float edge=smoothstep(.05,.18,v)*(1.0-smoothstep(.78,.97,v));
      float alpha=(arc+second+ribs)*fade*edge*energy;
      if(alpha<.002)discard;gl_FragColor=vec4(tint*2.1+vec3(.7,.9,1.0)*arc,alpha);}`;
  const chargeFragment = `${shared}
    void main(){float r=length(vUv),a=atan(vUv.y,vUv.x);float winding=calm>.5?0.0:age*4.0;
      float coil=line(r-.48-lightning(a,r,winding),.012);
      float breaks=.3+.7*pow(max(0.0,cos(a*3.0-winding)),3.0);
      float inner=line(r-.28,.007)*(.3+.7*pow(max(0.0,cos(a*5.0+winding)),4.0));
      float ray=pow(max(0.0,cos(a*7.0+sin(r*34.0+age*6.0)*.25)),90.0)*smoothstep(.12,.35,r)*(1.0-smoothstep(.5,.82,r));
      float core=exp(-r*r*150.0),soft=exp(-r*r*25.0)*.12;
      float alpha=(coil*breaks+inner*.75+core+soft+ray*detail*.48)*energy;
      if(alpha<.002)discard;gl_FragColor=vec4(tint*(1.3+ray)+vec3(.85,1.0,1.0)*(core*1.8+coil*.6),alpha);}`;
  const contactFragment = `${shared}
    void main(){float r=length(vUv),a=atan(vUv.y,vUv.x),p=clamp(age/.38,0.0,1.0);
      float ridge=.20+sqrt(p)*.64;float jag=lightning(a,r,calm>.5?0.0:age*2.0)*3.0;
      float ring=line(r-ridge+jag,.012)*(1.0-p);
      float forks=pow(max(0.0,cos(a*7.0+sin(r*30.0)*.20)),65.0)*smoothstep(.15,.28,r)*(1.0-smoothstep(.74,.94,r))*(1.0-p)*detail;
      float core=exp(-r*r*90.0)*pow(1.0-p,4.0);
      float alpha=(ring*.6+forks*.7+core)*energy;
      if(alpha<.002)discard;gl_FragColor=vec4(tint*1.6+vec3(.85,1.0,1.0)*core*2.0,alpha);}`;

  const mines = Array.from({ length: ABILITY_LIMITS.mines }, () => {
    const group = new THREE.Group(); group.name = 'emp-mine-field'; group.visible = false;
    const floor = new THREE.Mesh(geometry, material(groundFragment)); floor.rotation.x = -Math.PI / 2; floor.position.y = .038;
    const shell = new THREE.Mesh(shellGeometry, material(shellFragment)); shell.position.y = .055;
    group.add(floor, shell); scene.add(group); groups.push(group);
    return { id: null, group, floor, shell, snapshot: null, observed: 0, age: 0, fired: true, used: false };
  });
  const emitters = Array.from({ length: ABILITY_LIMITS.emitters }, () => {
    const mesh = new THREE.Mesh(geometry, material(chargeFragment)); mesh.name = 'special-coil-emitter'; mesh.visible = false;
    scene.add(mesh); groups.push(mesh); return { mesh, id: null, actionTime: 0 };
  });
  const contacts = Array.from({ length: ABILITY_LIMITS.contacts }, () => {
    const mesh = new THREE.Mesh(geometry, material(contactFragment)); mesh.name = 'special-ion-contact'; mesh.visible = false;
    scene.add(mesh); groups.push(mesh); return { mesh, life: 0, age: 0 };
  });
  const lights = Array.from({ length: ABILITY_LIMITS.lights }, () => {
    // A fixed light count avoids compiling a new shader for the first 1/2/3
    // simultaneous ability lights. Idle lamps have zero radiance, not invisibility.
    const light = new THREE.PointLight(0xffffff, 0, 4, 2); light.name = 'ability-local-light';
    scene.add(light); return light;
  });
  function paint(mesh, tint, age, energy) {
    mesh.material.uniforms.tint.value.copy(tint);
    mesh.material.uniforms.age.value = age;
    mesh.material.uniforms.energy.value = energy * (reduced ? .52 : 1);
  }
  function lightAt(index, position, tint, power) {
    const light = lights[index]; if (!light || low) return;
    if (power > light.intensity) { light.position.copy(position); light.color.copy(tint); light.intensity = power * (reduced ? .35 : 1); }
  }
  function radialSparks(x, y, tint, count, facing = 0) {
    const total = reduced ? Math.ceil(count * .25) : low ? Math.ceil(count * .5) : count;
    for (let i = 0; i < total; i++) {
      const angle = i / total * TAU + .13 * Math.sin(i * 9.1), speed = 2.3 + (i % 5) * .65;
      spark(x, y, .12, Math.cos(angle) * speed + facing * 1.4, .7 + (i % 4) * .6,
        Math.sin(angle) * speed * .65, tint, .22 + (i % 4) * .04, .055 + (i % 3) * .014, 12);
    }
    burstCount++;
  }
  function clear() {
    for (const slot of mines) { slot.id = null; slot.group.visible = false; slot.snapshot = null; slot.fired = true; }
    for (const emitter of emitters) { emitter.id = null; emitter.mesh.visible = false; }
    for (const contact of contacts) { contact.life = 0; contact.mesh.visible = false; }
    for (const light of lights) { light.intensity = 0; light.visible = !low; }
    seen.clear(); clock = 0; token = undefined; round = undefined;
  }
  function sync(state) {
    const key = state ? `${state.code ?? state.id ?? ''}:${state.round ?? 0}` : null;
    if (key !== round || token !== state?.visualSeekToken) clear();
    round = key; token = state?.visualSeekToken;
  }
  function emit(event, state) {
    if (disposed) return undefined;
    sync(state);
    const special = event.variant === 'bolt' || event.variant === 'shockwave';
    if (!special) return undefined;
    if (event.type === 'special') return 0; // charge comes from the current pose, never a delayed queue
    if (!['hit', 'block', 'parry'].includes(event.type)) return undefined;
    const target = state?.players?.find(p => p.id === (event.type === 'parry' ? event.player : event.target));
    if (event.presentationHistorical || state?.phase === 'paused' || !target || (target.actionTime ?? 0) > .18) return undefined;
    if (event.id != null && seen.has(event.id)) return undefined;
    if (event.id != null) { seen.add(event.id); if (seen.size > 128) seen.delete(seen.values().next().value); }
    const slot = contacts[contactCursor++ % contacts.length], tint = colorFor(event.player, state);
    slot.life = .38; slot.age = 0; slot.mesh.visible = true;
    slot.mesh.position.set(event.x ?? target.x, event.y ?? (target.y ?? 0) + 1.15, .58);
    slot.mesh.scale.setScalar(event.variant === 'shockwave' ? .98 : .78);
    paint(slot.mesh, tint, 0, event.type === 'hit' ? 1 : .6);
    return undefined; // mechanical contact still owns the debris and contact response
  }
  function update(dt, state) {
    if (disposed) return;
    sync(state);
    const paused = state?.phase === 'paused';
    const step = paused ? 0 : clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    clock += step;
    for (const light of lights) { light.visible = !low; light.intensity = 0; }
    for (const slot of mines) {
      slot.used = false;
      if (!(state?.projectiles ?? []).some(p => p.id === slot.id && p.variant === 'shockwave')) {
        slot.id = null; slot.group.visible = false; slot.snapshot = null;
      }
    }
    let lightIndex = 0;
    for (const projectile of state?.projectiles ?? []) {
      if (projectile.variant !== 'shockwave' || !Number.isFinite(projectile.x + (projectile.age ?? 0))) continue;
      let slot = mines.find(s => s.id === projectile.id);
      if (!slot) slot = mines.find(s => s.id === null);
      if (!slot || slot.used) continue;
      const fresh = slot.id === null;
      slot.id = projectile.id; slot.used = true;
      if (fresh || !paused) {
        if (slot.snapshot !== projectile) { slot.snapshot = projectile; slot.observed = clock; }
        const age = (projectile.age ?? 0) + Math.min(.045, clock - slot.observed);
        if (fresh) slot.fired = paused || age >= VARIANT_ATTACKS.shockwave.detonationDelay;
        slot.age = age; slot.group.position.set(projectile.x, 0, 0);
      }
      slot.group.visible = true;
      const age = slot.age, properties = VARIANT_ATTACKS.shockwave, tint = colorFor(projectile.owner, state);
      const radius = projectile.radius ?? properties.radius;
      slot.floor.scale.setScalar(radius / .95);
      const expansion = clamp((age - properties.detonationDelay) / properties.expansionTime, 0, 1);
      slot.shell.visible = !low && age >= properties.detonationDelay;
      slot.shell.scale.set(radius * expansion, .18 + .85 * Math.sin(expansion * Math.PI / 2), radius * expansion);
      paint(slot.floor, tint, age, 1); paint(slot.shell, tint, age, .7);
      if (!paused && !slot.fired && age >= properties.detonationDelay) {
        radialSparks(projectile.x, .10, tint, 28); slot.fired = true;
      }
      const intensity = age < properties.detonationDelay ? 1.8 : 20 * (1 - smooth((age - properties.detonationDelay) / .32));
      lightAt(lightIndex++ % lights.length, lightPosition.copy(slot.group.position).setY(.46), tint, intensity);
    }
    for (const slot of mines) if (!slot.used) { slot.group.visible = false; slot.id = null; slot.snapshot = null; }
    for (let i = 0; i < emitters.length; i++) {
      const slot = emitters[i], player = state?.players?.[i];
      const active = player?.action === 'special' && ['bolt', 'shockwave'].includes(player.variant);
      slot.mesh.visible = active;
      if (!active) { slot.id = null; continue; }
      const wave = player.variant === 'shockwave';
      const attack = wave ? VARIANT_ATTACKS.shockwave : ATTACKS.special;
      const t = Math.max(0, player.actionTime ?? 0);
      const charge = smooth(t / (attack.startup - .05)) * (1 - smooth((t - attack.startup) / .13));
      const release = pulse(t, attack.startup, attack.startup + .025, attack.startup + .17);
      const energy = charge * .75 + release * 1.4;
      const muzzle = player.combatAnchors?.muzzle;
      slot.mesh.position.set(wave ? player.x + (player.facing ?? 1) * .65 : muzzle?.x ?? player.x + (player.facing ?? 1) * .8,
        wave ? .065 : muzzle?.y ?? (player.y ?? 0) + 1.35, wave ? 0 : (muzzle?.z ?? .35) + .02);
      slot.mesh.rotation.x = wave ? -Math.PI / 2 : 0;
      slot.mesh.scale.setScalar(wave ? .85 : .60 + charge * .12 + release * .18);
      const tint = colorFor(player.id, state); paint(slot.mesh, tint, t, energy);
      if (!paused && slot.id === player.id && slot.actionTime < attack.startup && t >= attack.startup && !wave) radialSparks(slot.mesh.position.x, slot.mesh.position.y, tint, 14, player.facing ?? 1);
      slot.id = player.id; slot.actionTime = t;
      lightAt(i, slot.mesh.position, tint, energy * (wave ? 4 : 8));
    }
    for (const slot of contacts) {
      slot.life = Math.max(0, slot.life - step); slot.age += step;
      slot.mesh.visible = slot.life > 0;
      if (!slot.mesh.visible) continue;
      slot.mesh.material.uniforms.age.value = slot.age;
      lightAt(0, slot.mesh.position, slot.mesh.material.uniforms.tint.value, 10 * (slot.life / .38) ** 2);
    }
  }
  return {
    emit, update, clear,
    setQuality(value) { low = value === 'low'; for (const light of lights) light.visible = !low; for (const m of materials) m.uniforms.detail.value = low ? 0 : 1; },
    setReducedMotion(value) { reduced = !!value; for (const m of materials) m.uniforms.calm.value = reduced ? 1 : 0; },
    getStats() { return { mines: mines.filter(s => s.group.visible).length, emitters: emitters.filter(s => s.mesh.visible).length,
      contacts: contacts.filter(s => s.mesh.visible).length, lights: lights.filter(l => l.visible && l.intensity > .02).length, bursts: burstCount }; },
    dispose() { if (disposed) return; disposed = true; clear(); groups.forEach(g => scene.remove(g)); lights.forEach(l => { scene.remove(l); l.dispose(); }); materials.forEach(m => m.dispose()); geometry.dispose(); shellGeometry.dispose(); },
  };
}
