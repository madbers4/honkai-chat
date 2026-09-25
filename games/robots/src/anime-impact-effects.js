import * as THREE from 'three';

export const ANIME_IMPACT_LIMITS = Object.freeze({ contacts: 8, low: 4, reduced: 2, lifetime: .30 });
const CONTACTS = new Set(['hit', 'grabStrike', 'block', 'parry']);
const LIVE_PHASES = new Set(['fight', 'roundOver', 'finishing', 'matchOver']);
const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);
const clamp = THREE.MathUtils.clamp;
const INK = new THREE.Color('#191728'), PAPER = new THREE.Color('#fff5d9');
const AMBER = new THREE.Color('#ffb238'), CYAN = new THREE.Color('#7de2ef');

/** Small, authored vector silhouettes, not bloom sprites. All four contact
 * families share one instanced draw; inactive families collapse in the shader.
 * Layer order is ink -> colored cutout -> paper, with no per-contact objects. */
function makeGeometry() {
  const positions = [], families = [], paints = [], motions = [], details = [];
  const geometry = new THREE.InstancedBufferGeometry();
  function polygon(points, family, paint, motion = [0, 0], detail = 0, scale = 1, offset = [0, 0]) {
    const shape = points.map(([x, y]) => new THREE.Vector2(x * scale + offset[0], y * scale + offset[1]));
    const triangles = THREE.ShapeUtils.triangulateShape(shape, []);
    for (const triangle of triangles) for (const index of triangle) {
      positions.push(shape[index].x, shape[index].y, 0);
      families.push(family); paints.push(paint); motions.push(...motion); details.push(detail);
    }
  }
  function cutout(points, family, paint = 1, motion = [0, 0], detail = 0) {
    // Local centroid scaling keeps the ink equally close to long thin slashes.
    const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
    const outline = points.map(([x, y]) => {
      const dx = x - center[0], dy = y - center[1], length = Math.hypot(dx, dy) || 1;
      return [x + dx / length * .032, y + dy / length * .032];
    });
    polygon(outline, family, 0, motion, detail);
    polygon(points, family, paint, motion, detail);
  }
  function streak(family, x, y, dx, dy, length, width, paint = 1) {
    const norm = Math.hypot(dx, dy), ux = dx / norm, uy = dy / norm;
    cutout([[x - uy * width, y + ux * width], [x + ux * length, y + uy * length],
      [x + uy * width, y - ux * width]], family, paint, [ux * .25, uy * .25], 1);
  }
  // 0: a deliberately uneven, directional eight-point impact star.
  const star = [[-.88,.04],[-.24,.13],[-.43,.68],[-.06,.28],[.08,.92],[.20,.27],
    [.71,.65],[.35,.14],[1.02,.11],[.38,-.10],[.60,-.56],[.12,-.25],[-.08,-.82],[-.20,-.23],[-.65,-.46],[-.31,-.10]];
  polygon(star, 0, 0, [0,0], 0, 1.08, [-.014,-.012]);
  polygon(star, 0, 1);
  polygon([[-.52,.02],[-.08,.10],[.02,.48],[.13,.10],[.58,.08],[.15,-.04],[.04,-.43],[-.07,-.07]], 0, 2);
  for (const [x,y,dx,dy,length,width] of [[-.53,.35,-1,.4,.95,.021],[.62,.37,1,.45,.70,.022],
    [-.40,-.44,-1,-.5,.80,.018],[.62,-.37,1,-.3,.66,.016],[-.04,.83,-.12,1,.36,.012]]) {
    streak(0,x,y,dx,dy,length,width);
  }
  // 1: the guard catches the blow; no damage star or white center.
  cutout([[.10,.66],[-.30,.27],[-.44,0],[-.30,-.27],[.10,-.66],[-.04,-.23],[-.17,0],[-.04,.23]], 1);
  cutout([[.28,.49],[.07,.18],[.015,0],[.07,-.18],[.28,-.49],[.19,0]], 1, 2);
  streak(1,-.54,.22,-1,.5,.65,.025); streak(1,-.62,-.12,-1,-.25,.57,.019);
  // 2: a clean crossed deflection, stronger than an ordinary block.
  cutout([[-.83,-.69],[-.08,.05],[.57,.91],[.13,.05],[.93,-.63],[.04,-.12],[-.52,-.92]], 2);
  polygon([[-.60,-.52],[-.035,.08],[.37,.63],[.07,.045],[.67,-.44],[.02,-.04],[-.35,-.64]], 2, 2);
  streak(2,-.24,.50,-.7,1,.45,.013,2); streak(2,.52,-.10,1,-.5,.50,.016);
  // 3: a broken guard opens outward in two jagged plates, not a hit marker.
  cutout([[.11,.73],[-.28,.38],[-.40,.12],[-.14,.20],[-.19,.35],[.25,.58]], 3, 1, [0,.21]);
  cutout([[-.40,-.12],[-.28,-.38],[.11,-.73],[.25,-.58],[-.19,-.35],[-.14,-.20]], 3, 1, [0,-.21]);
  cutout([[-.32,.075],[-.08,.15],[.11,.04],[-.02,-.025],[.29,-.19],[.055,-.10],[-.13,-.15]], 3, 2);
  streak(3,-.57,.25,-1,.6,.70,.027); streak(3,-.57,-.25,-1,-.6,.70,.027);
  geometry.name = 'anime-contact-cutouts';
  for (const [name, values, size] of [['position',positions,3], ['aFamily',families,1],
    ['aPaint',paints,1], ['aMotion',motions,2], ['aDetail',details,1]]) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  return geometry;
}

/** A contact is fixed at the struck surface, not dragged along with knockback.
 * Never infer a hit from an attack pose, projectile, held input or elapsed time. */
export function createAnimeImpactEffects(scene) {
  const geometry = makeGeometry(), count = ANIME_IMPACT_LIMITS.contacts;
  const centers = new Float32Array(count * 3), info = new Float32Array(count * 4);
  const tints = new Float32Array(count * 3), facing = new Float32Array(count);
  for (const [name, array, size] of [['aCenter',centers,3], ['aInfo',info,4], ['aTint',tints,3], ['aFacing',facing,1]]) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    name: 'anime-ink-paper', transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.NormalBlending, toneMapped: false,
    uniforms: { ink: { value: INK }, paper: { value: PAPER }, calm: { value: 0 }, detail: { value: 1 } },
    vertexShader: `attribute vec3 aCenter,aTint; attribute vec4 aInfo;
      attribute float aFamily,aPaint,aFacing,aDetail; attribute vec2 aMotion;
      uniform vec3 ink,paper; uniform float calm,detail;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        float age=aInfo.x, mask=1.0-step(.1,abs(aFamily-aInfo.w));
        float pop=mix(.82+min(age/.17,1.0)*.18,1.0,calm);
        float travel=smoothstep(.03,.82,age)*(1.0-calm);
        vec2 p=(position.xy+aMotion*travel)*aInfo.y*pop;
        p.x*=aFacing; float c=cos(aInfo.z),s=sin(aInfo.z);
        p=mat2(c,-s,s,c)*p;
        vec4 center=modelViewMatrix*vec4(aCenter,1.0);
        center.xy+=p*mask; gl_Position=projectionMatrix*center;
        vColor=aPaint<.5?ink:aPaint<1.5?aTint:paper;
        float fade=1.0-smoothstep(.12,1.0,age);
        float lines=mix(1.0,detail*(1.0-calm),aDetail);
        vAlpha=mask*fade*lines*mix(.96,.62,calm)*step(.001,aInfo.y);
      }`,
    fragmentShader: `varying vec3 vColor;varying float vAlpha;
      void main(){if(vAlpha<.002)discard;gl_FragColor=vec4(vColor,vAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'anime-authoritative-contacts'; mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.visible = false;
  scene.add(mesh);
  const slots = Array.from({ length: count }, () => ({ age: 1, duration: 0, size: 0 }));
  const stats = { emitted: 0, hits: 0, blocks: 0, parries: 0, grabs: 0, guardBreaks: 0, duplicates: 0, historical: 0, replaced: 0 };
  let low = false, reduced = false, disposed = false, context = null, seekToken, lastId = -1;
  const capacity = () => reduced ? ANIME_IMPACT_LIMITS.reduced : low ? ANIME_IMPACT_LIMITS.low : count;
  function retire() {
    for (const slot of slots) { slot.duration = 0; slot.size = 0; }
    info.fill(0); geometry.attributes.aInfo.needsUpdate = true;
    geometry.instanceCount = 0; mesh.visible = false;
  }
  function clear() {
    if (disposed) return;
    retire(); lastId = -1; context = null; seekToken = undefined;
    for (const key of Object.keys(stats)) stats[key] = 0;
  }
  function sync(state) {
    const key = `${state?.room ?? ''}:${state?.round ?? 0}`;
    if (context !== key || seekToken !== state?.visualSeekToken) {
      clear(); context = key; seekToken = state?.visualSeekToken;
    }
  }
  function upload() {
    let active = 0;
    for (let i = 0; i < count; i++) {
      const slot = slots[i], alive = i < capacity() && slot.duration > 0 && slot.age < slot.duration;
      info[i * 4] = alive ? slot.age / slot.duration : 1;
      info[i * 4 + 1] = alive ? slot.size : 0;
      if (alive) active = i + 1;
    }
    geometry.instanceCount = active; mesh.visible = active > 0;
    for (const name of ['aCenter', 'aInfo', 'aTint', 'aFacing']) geometry.attributes[name].needsUpdate = true;
  }
  function contactPoint(player, event) {
    const x = Number.isFinite(event.x) ? event.x : player.x;
    const y = Number.isFinite(event.y) ? event.y : (player.y ?? 0) + 1.1;
    let nearest = null, distance = Infinity;
    // Prefer visible armor near the authoritative x/y, never the opponent's
    // attack tip (which can already have retracted on a delayed snapshot).
    for (const point of Object.values(player.damageAnchors ?? {})) {
      if (!finitePoint(point)) continue;
      const d = (point.x - x) ** 2 + (point.y - y) ** 2 - Math.min(1, point.z) * .12;
      if (d < distance) { nearest = point; distance = d; }
    }
    if (!nearest && finitePoint(player.combatAnchors?.core)) nearest = player.combatAnchors.core;
    return nearest ? { x: nearest.x, y: nearest.y, z: nearest.z + .09 } : { x, y, z: .72 };
  }
  function emit(event, state) {
    if (disposed || !CONTACTS.has(event?.type)) return false;
    sync(state);
    // CombatRoom IDs are monotonically increasing within a room. A high-water
    // mark stays bounded even after a long match and remembers discarded history.
    if (!Number.isSafeInteger(event.id) || event.id < 0) return false;
    if (event.id <= lastId) { stats.duplicates++; return false; }
    lastId = event.id;
    const stale = Number.isFinite(event.at) && Number.isFinite(state?.elapsed) && state.elapsed - event.at > .30;
    if (event.presentationHistorical || stale || !LIVE_PHASES.has(state?.phase)) { stats.historical++; return false; }
    if (event.type === 'hit' && event.variant === 'grab') return false;
    if (['hit', 'grabStrike'].includes(event.type) && !(event.damage > 0)) return false;
    const source = state?.players?.find(player => player.id === event.player);
    const target = state?.players?.find(player => player.id === event.target);
    if (!source || !target) return false;
    const defending = event.type === 'block' || event.type === 'parry';
    const point = contactPoint(event.type === 'parry' ? source : target, event);
    if (!finitePoint(point)) return false;
    let index = slots.findIndex((slot, i) => i < capacity() && (slot.duration === 0 || slot.age >= slot.duration));
    if (index < 0) {
      index = 0;
      for (let i = 1; i < capacity(); i++) if (slots[i].age / slots[i].duration > slots[index].age / slots[index].duration) index = i;
      stats.replaced++;
    }
    const heavy = event.action === 'heavy' || event.damage >= 18 || event.counter || event.punish;
    const family = event.guardBreak ? 3 : event.type === 'parry' ? 2 : event.type === 'block' ? 1 : 0;
    const duration = reduced ? ANIME_IMPACT_LIMITS.lifetime : defending ? .22 : heavy ? .27 : .21;
    const size = family === 2 ? .69 : family === 3 ? .71 : family === 1 ? .57 : heavy ? .65 : event.type === 'grabStrike' ? .47 : .51;
    Object.assign(slots[index], { age: 0, duration, size: size * (reduced ? .85 : 1) });
    centers.set([point.x, point.y, point.z], index * 3);
    // Mirror the incoming strike. Parry's event.player is the defender.
    const direction = event.type === 'parry' ? -(source.facing || 1) : (event.facing ?? source.facing ?? 1);
    facing[index] = direction < 0 ? -1 : 1;
    info[index * 4 + 2] = family === 0 ? ((event.id % 3) - 1) * .11 * (direction < 0 ? -1 : 1) : 0;
    info[index * 4 + 3] = family;
    const tint = defending ? CYAN : source.skin === 'cyan' || (!source.skin && source.id === 'p2') ? CYAN : AMBER;
    tint.toArray(tints, index * 3);
    stats.emitted++;
    stats[event.type === 'grabStrike' ? 'grabs' : event.type === 'parry' ? 'parries' : event.type === 'block' ? 'blocks' : 'hits']++;
    if (event.guardBreak) stats.guardBreaks++;
    upload(); return true;
  }
  function update(dt, state) {
    if (disposed) return;
    sync(state);
    if (state?.phase === 'paused') return;
    if (!LIVE_PHASES.has(state?.phase)) { retire(); return; }
    const step = Number.isFinite(dt) ? clamp(dt, 0, .10) : 0;
    for (const slot of slots) slot.age += step;
    upload();
  }
  function trim() {
    for (let i = capacity(); i < count; i++) { slots[i].duration = 0; slots[i].size = 0; }
    upload();
  }
  return {
    emit, update, clear,
    setQuality(value) { if (disposed) return; low = value === 'low'; material.uniforms.detail.value = low ? .45 : 1; trim(); },
    setReducedMotion(value) { if (disposed) return; reduced = Boolean(value); material.uniforms.calm.value = reduced ? 1 : 0; trim(); },
    getStats() { return { ...stats, active: slots.filter((slot, i) => i < capacity() && slot.duration > 0 && slot.age < slot.duration).length,
      capacity: capacity(), drawCalls: mesh.visible ? 1 : 0, historySize: lastId < 0 ? 0 : 1, reduced, low }; },
    dispose() { if (disposed) return; clear(); disposed = true; scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
