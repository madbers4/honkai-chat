// Camera-only presentation. Never changes simulation time, player roots or input.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const radians = Math.PI / 180;
const REST = { x: 0, y: 3.8, z: 10.7, tx: 0, ty: 1.5, tz: -.2 };
export const CAMERA_LIMITS = Object.freeze({ x: .14, y: .10, z: .28, slots: 6, age: .72, maxDistance: 34 });

/** Screen projection used by the safety frame and regression tests. */
export function projectCameraPoint(point, frame, aspect, fov = 36) {
  const fx = frame.tx - frame.x, fy = frame.ty - frame.y, fz = frame.tz - frame.z;
  const length = Math.hypot(fx, fy, fz), nx = fx / length, ny = fy / length, nz = fz / length;
  const rightLength = Math.hypot(nz, nx), rx = -nz / rightLength, rz = nx / rightLength;
  const ux = -ny * rz, uy = nx * rz - nz * rx, uz = ny * rx;
  const x = point.x - frame.x, y = point.y - frame.y, z = (point.z ?? 0) - frame.z;
  const depth = x * nx + y * ny + z * nz, tangent = Math.tan(fov * radians / 2);
  return { x: (x * rx + z * rz) / (depth * tangent * aspect), y: (x * ux + y * uy + z * uz) / (depth * tangent) };
}

function pointsFor(players, anticipation = true) {
  const points = [];
  for (const p of players) {
    // Broad chassis/feet envelope, including the incoming side of a throw.
    const x = p.x ?? 0, y = Math.max(0, p.y ?? 0);
    const leadX = anticipation ? clamp((p.vx ?? 0) * .12, -.7, .7) : 0;
    const top = y + 2.75 + (anticipation ? Math.max(0, p.vy ?? 0) * .12 : 0);
    for (const px of [x - 1.45 + Math.min(0, leadX), x + 1.45 + Math.max(0, leadX)]) {
      for (const py of [Math.max(-.06, y - .08), top]) {
        for (const z of [-.85, .85]) points.push({ x: px, y: py, z });
      }
    }
  }
  return points;
}

function safeFrame(frame, players, aspect, fov, anticipation = true) {
  const points = pointsFor(players, anticipation);
  let out = { ...frame };
  // The ordinary 16:9 / phone frame leaves space for the top HUD and thumbs.
  // Expand only; an impulse or late snapshot must never spend that margin.
  for (let attempt = 0; attempt < 5; attempt++) {
    let ratio = 1;
    for (const p of points) {
      const q = projectCameraPoint(p, out, aspect, fov);
      ratio = Math.max(ratio, Math.abs(q.x) / .89, q.y / .77, -q.y / .79);
    }
    if (ratio <= 1.00001) break;
    out.z = Math.min(CAMERA_LIMITS.maxDistance, out.z * Math.min(1.7, ratio * 1.001));
  }
  return out;
}

function desiredFrame(players, { aspect, fov, inLobby, intro = 0, charge = 0, finish = 0, reduced = false }) {
  if (inLobby) return { x: .55, y: 3.5, z: Math.max(11.9, 12.2 / (2 * Math.tan(fov * radians / 2) * aspect)), tx: .4675, ty: 1.42, tz: -.2 };
  const min = Math.min(...players.map(p => p.x ?? 0)), max = Math.max(...players.map(p => p.x ?? 0));
  const mid = clamp((min + max) / 2, -3.9, 3.9);
  const airborne = Math.max(0, ...players.map(p => (p.y ?? 0) + Math.max(0, p.vy ?? 0) * .12));
  const ty = 1.5 + Math.min(1.4, airborne * .33);
  const spread = Math.max(8.8, max - min + 3.8);
  const z = Math.max(10.7, spread / (2 * Math.tan(fov * radians / 2) * aspect));
  const room = Math.max(0, z - 10.25);
  const push = reduced ? 0 : Math.min(room, .22 * charge + .38 * finish) * (1 - clamp(airborne / 2, 0, 1));
  return safeFrame({ x: mid, y: ty + 2.3, z: z + (reduced ? 0 : intro * .75) - push, tx: mid, ty, tz: -.2 }, players, aspect, fov);
}

// Retained only for the opt-in review A/B; ordinary play never selects this.
function legacyFrame(players, { aspect, fov, inLobby, intro = 0, charge = 0, finish = 0, reduced = false }, pulseKick, escapeEase) {
  const min = Math.min(...players.map(p => p.x ?? 0)), max = Math.max(...players.map(p => p.x ?? 0));
  const mid = inLobby ? .55 : clamp((min + max) / 2, -1.5, 1.5);
  const spread = inLobby ? 12.2 : Math.max(8.8, max - min + 4.2);
  const airborne = inLobby ? 0 : Math.max(0, ...players.map(p => (p.y ?? 0) + Math.max(0, p.vy ?? 0) * .14));
  const air = clamp((airborne - .4) / 1.4, 0, 1), widthDistance = spread / (2 * Math.tan(fov * radians / 2) * aspect);
  const distance = Math.max(inLobby ? 11.9 : 10.7 + Math.max(0, airborne - .4) * 1.5, widthDistance);
  const room = Math.max(0, 10.7 - widthDistance);
  return { x: mid, y: inLobby ? 3.5 : 3.8 + air * .4 - charge * .08,
    z: clamp(distance, 10.6, 27) + intro * .9 - Math.min(.38, room) * charge * (1 - air) - Math.min(finish, room)
      + (reduced ? 0 : pulseKick + escapeEase * .35), tx: mid * .85, ty: inLobby ? 1.42 : 1.5 + air * .2, tz: -.2, air };
}

// Each beat is a different force, not a random shake. A hook lifts, a press
// compresses and a back throw opens the frame along the release direction.
export function cameraContactProfile(event, players = []) {
  const source = players.find(p => p.id === event.player);
  const target = players.find(p => p.id === event.target);
  const direction = Math.sign(event.direction ?? event.facing ?? (source && target ? target.x - source.x : source?.facing ?? 1)) || 1;
  const lateral = value => value * direction;
  let vector;
  if (event.type === 'hit') {
    if (['grab', 'slam', 'overload'].includes(event.variant)) return null; // paired authoritative beat below
    if (event.variant === 'heavyDrive') vector = [lateral(.083), -.012, .065];
    else if (event.variant === 'heavyHook') vector = [lateral(.045), .066, .035];
    else if (event.variant === 'heavyPress' || event.variant === 'crusher') vector = [lateral(.035), -.085, .16];
    else vector = [lateral(event.damage >= 12 ? .06 : .039), event.airborne ? .024 : -.012, .025];
  } else if (event.type === 'block') vector = [lateral(.020), -.008, .012];
  else if (event.type === 'parry') vector = [lateral(-.032), .023, .025];
  else if (event.type === 'grab') vector = [lateral(.017), -.009, 0];
  else if (event.type === 'grabStrike') vector = [lateral(.040), event.chain === 2 ? .026 : -.008, .018];
  else if (event.type === 'throw') vector = [lateral(.058), event.throwStyle === 'back' ? .066 : -.026, .13];
  else if (event.type === 'slam') vector = [0, -.088, .15];
  else if (event.type === 'ultimatePulse') vector = [lateral(.025), -.025, event.pulse === 2 ? .17 : .065];
  else if (event.type === 'finisherImpact') vector = [lateral(.046), .032, .095];
  else if (event.type === 'destruction') vector = [lateral(.050), -.065, .25];
  else if (event.type === 'grabBreak' && event.reason !== 'interrupted') vector = [lateral(-.018), 0, .04];
  else return null;
  const scale = event.counter || event.punish || event.guardBreak ? 1.15 : 1;
  return { x: vector[0] * scale, y: vector[1] * scale, z: vector[2] * scale };
}

// Exact critically damped step for a constant target. Stable at 30/60/120 Hz.
function spring(position, velocity, target, dt, omega) {
  const delta = position - target, term = velocity + omega * delta, decay = Math.exp(-omega * dt);
  return [target + (delta + term * dt) * decay, (velocity - omega * term * dt) * decay];
}

export function createCameraChoreography() {
  let base = { ...REST }, velocity = Object.fromEntries(Object.keys(REST).map(key => [key, 0]));
  let initialized = false, impulses = [], seen = new Set(), output = { ...base }, baselineShake = 0, baselineTime = 0;
  let baseline = false, pulseKick = 0, escapeEase = 0;
  function reset() { initialized = false; impulses = []; seen.clear(); baselineShake = baselineTime = pulseKick = escapeEase = 0; velocity = Object.fromEntries(Object.keys(REST).map(key => [key, 0])); }
  return {
    reset,
    setBaseline(value) { baseline = Boolean(value); reset(); },
    clearFeedback() { impulses = []; baselineShake = pulseKick = escapeEase = 0; },
    // Caller marks historical packets rather than allowing an arrival to masquerade as a fresh contact.
    contact(event, players, { historical = false, reduced = false, strength = 0 } = {}) {
      if (event.id != null) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        if (seen.size > 512) seen = new Set([...seen].slice(-256));
      }
      if (historical || reduced) return;
      if (event.type === 'burst') { impulses = []; baselineShake *= .25; escapeEase = 1; return; }
      baselineShake = Math.max(baselineShake, strength);
      if (event.type === 'ultimatePulse') pulseKick = event.pulse === 2 ? .4 : .12;
      if (event.type === 'destruction') pulseKick = .8;
      const profile = cameraContactProfile(event, players);
      if (!profile) return;
      if (impulses.length === CAMERA_LIMITS.slots) impulses.shift();
      impulses.push({ ...profile, age: 0 });
    },
    update(dt, players, options = {}) {
      const { paused = false, seek = false, reduced = false, aspect = 16 / 9, fov = 36, inLobby = false } = options;
      if (paused && initialized && !seek) return { ...output };
      dt = clamp(dt, 0, .1);
      if (reduced) impulses = [];
      const frameOptions = { ...options, aspect: Math.max(.4, aspect), fov, inLobby };
      pulseKick *= Math.exp(-dt * 10); escapeEase *= Math.exp(-dt * 3.8);
      const target = baseline ? legacyFrame(players, frameOptions, pulseKick, escapeEase) : desiredFrame(players, frameOptions);
      const air = target.air; delete target.air;
      if (!initialized || seek) { base = { ...target }; velocity = Object.fromEntries(Object.keys(REST).map(key => [key, 0])); initialized = true; }
      else for (const key of Object.keys(base)) {
        if (baseline) { base[key] = mix(base[key], target[key], 1 - Math.exp(-dt * (air > 0 && target.z > base.z ? 5.2 : 2.8))); continue; }
        const expanding = key === 'z' && target.z > base.z;
        [base[key], velocity[key]] = spring(base[key], velocity[key], target[key], dt, expanding ? 14 : reduced ? 5.5 : 9.5);
      }
      const kick = { x: 0, y: 0, z: 0 };
      if (!paused && !reduced) {
        for (const impulse of impulses) {
          impulse.age += dt;
          // Peak near 75 ms, one tiny return lobe, gone before the next idle beat.
          const pulse = Math.exp(-impulse.age * 13) * Math.sin(impulse.age * 20) * 2.3;
          for (const key of Object.keys(kick)) kick[key] += impulse[key] * pulse;
        }
        impulses = impulses.filter(impulse => impulse.age < CAMERA_LIMITS.age);
      }
      for (const key of Object.keys(kick)) kick[key] = clamp(kick[key], -CAMERA_LIMITS[key], CAMERA_LIMITS[key]);
      output = { ...base, x: base.x + kick.x, y: base.y + kick.y, z: base.z + kick.z,
        tx: base.tx + kick.x * .85, ty: base.ty + kick.y * .85 };
      if (baseline && !reduced && !paused) {
        baselineTime += dt; baselineShake *= Math.exp(-dt * 12);
        output = { ...base, x: base.x + Math.sin(baselineTime * 132) * baselineShake,
          y: base.y + Math.cos(baselineTime * 107) * baselineShake * .65 };
      }
      if (!inLobby && !baseline) output = safeFrame(output, players, Math.max(.4, aspect), fov, false);
      return { ...output };
    },
    stats() { return { activeImpulses: impulses.length, frame: { ...output }, baseline }; },
  };
}
