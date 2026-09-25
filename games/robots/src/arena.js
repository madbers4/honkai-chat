import { assetUrl } from './app-paths.js';
import * as THREE from 'three';
import { createIndustrialEnvironment } from './environment.js';
import { createDeckSurface } from './deck-surface.js';
import { loadPosterAtlas } from './posters.js';
import { createRobot, loadRobotAssets } from './robot.js';
import { createCombatEffects } from './effects.js';
import { pairedRoot } from './paired-root.js';
import { createSlamRootFollower } from './slam-choreography.js';
import { createCameraChoreography } from './camera-choreography.js';
import { computeFaceoffCamera, blendFaceoffCamera } from './faceoff-camera.js';
import { createEmissionGlow } from './emission-glow.js';
import { arenaRootPosition } from './arena-root.js';
import { GRAPHICS_PRESETS, graphicsPreset, graphicsPixelRatio, readGraphicsPreference, observeGraphicsPreference } from './graphics-quality.js';
import { ArenaLoadError, loadArenaAssets } from './asset-loading.js';


const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const AMBER = '#ffb765';
const CYAN = '#66dfff';

function seededRandom(seed = 42) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTexture(width, height, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  return texture;
}

function makeContactTexture() {
  return canvasTexture(256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(0,3,7,.74)');
    gradient.addColorStop(0.28, 'rgba(0,3,7,.58)');
    gradient.addColorStop(0.6, 'rgba(0,3,7,.28)');
    gradient.addColorStop(1, 'rgba(0,3,7,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256);
  });
}

function makeSoftTexture() {
  return canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,.9)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,.4)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,.09)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  });
}

function buildEnvironment(scene, wallpaper, posterTexture) {
  return createIndustrialEnvironment(scene, wallpaper, createDeckSurface(), posterTexture);
}

function makeAtmosphere(scene, texture) {
  const random = seededRandom(528);
  const count = 140;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = random() * 24 - 12;
    positions[i * 3 + 1] = random() * 9;
    positions[i * 3 + 2] = random() * 7 - 3;
    speeds[i] = 0.08 + random() * 0.15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'ambient-dust';
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: '#c9e4ed', size: 0.032, transparent: true, opacity: 0.42, depthWrite: false, sizeAttenuation: true });
  const dust = new THREE.Points(geometry, material);
  scene.add(dust);
  const steam = [];
  for (let i = 0; i < 12; i++) {
    const material = new THREE.SpriteMaterial({ map: texture, color: i < 6 ? '#a9c2d1' : '#bbdadf', transparent: true, opacity: 0.04, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    scene.add(sprite);
    steam.push({ sprite, phase: random(), side: i < 6 ? -1 : 1, offset: random() * 0.5 - 0.25 });
  }
  const lightHalos = [];
  for (const side of [-1, 1]) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: side < 0 ? AMBER : CYAN, transparent: true,
      opacity: 0.27, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    halo.position.set(side * 5.8, 4.72, -2.5); halo.scale.set(2.2, 1.4, 1);
    scene.add(halo); lightHalos.push(halo);
  }
  return {
    update(dt, time, low, reduced, hasEmissionGlow = false) {
      // These small sprites are the direct-render fallback; HDR glow owns the
      // visible lamp aperture on supported high quality devices.
      lightHalos.forEach(halo => { halo.visible = !hasEmissionGlow; });
      dust.visible = !low;
      if (!low && !reduced) {
        for (let i = 0; i < count; i++) {
          positions[i * 3] += Math.sin(time * 0.24 + i * 3) * dt * 0.025;
          positions[i * 3 + 1] -= speeds[i] * dt;
          if (positions[i * 3 + 1] < 0) positions[i * 3 + 1] = 8;
        }
        geometry.attributes.position.needsUpdate = true;
      }
      steam.forEach((p, index) => {
        p.sprite.visible = !low || index % 2 === 0;
        const phase = (time * (reduced ? 0.025 : 0.09) + p.phase) % 1;
        p.sprite.position.set(p.side * 5.5 + Math.sin(time * 0.6 + index) * 0.17 + p.offset, phase * 2.35, -1.2);
        const scale = 0.75 + phase * 1.65;
        p.sprite.scale.set(scale, scale * 1.2, 1);
        p.sprite.material.opacity = Math.sin(phase * Math.PI) * 0.073;
      });
    },
    dispose() {
      scene.remove(dust); geometry.dispose(); material.dispose();
      [...steam.map(s => s.sprite), ...lightHalos].forEach(s => { scene.remove(s); s.material.dispose(); });
    },
  };
}

async function loadWallpaper(url) {
  const loader = new THREE.TextureLoader();
  const result = await loader.loadAsync(assetUrl(url));
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

/** Owns its RAF. update() accepts authoritative snapshots; local smooth motion remains at display rate. */
export async function createArena(container, { onLoadProgress, allowEffectReview = false } = {}) {
  let loadProgress = 0;
  const reportProgress = value => { loadProgress = Math.max(loadProgress, value); onLoadProgress?.(loadProgress); };
  reportProgress(0.05);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (cause) { throw new ArenaLoadError('graphics', 'WebGL renderer could not start', cause); }
  const startupCleanup = [() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }];
  try {
  renderer.setClearColor('#141a20');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.34;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'arena-canvas';
  renderer.domElement.setAttribute('aria-label', 'Арена бойцовского клуба Белобога');
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#252320', 0.015);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 70);
  camera.position.set(0, 4.2, 13.2);
  camera.lookAt(0, 1.45, 0);

  // Quiet neutral/warm room light preserves stone and aged timber. Coloured
  // pools now come from the actual club lamps and robot cores, not a cyan wash.
  const hemisphere = new THREE.HemisphereLight('#e1ded0', '#66554b', 2.1);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#fff0d9', 3.4);
  key.position.set(-6, 14, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -17; key.shadow.camera.right = 17;
  key.shadow.camera.top = 12; key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 42;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.035;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c2cfce', .85);
  fill.position.set(5, 3, 5); scene.add(fill);
  const rim = new THREE.DirectionalLight('#8fb5c5', 1.7);
  rim.position.set(3, 4, -4); scene.add(rim);
  const warmPool = new THREE.PointLight(AMBER, 10, 12, 2);
  warmPool.position.set(-5.8, 4.78, -2.39); scene.add(warmPool);
  const coldPool = new THREE.PointLight(CYAN, 9, 12, 2);
  coldPool.position.set(5.8, 4.78, -2.39); scene.add(coldPool);
  const impactLight = new THREE.PointLight('#ffe8bd', 0, 6, 2);
  impactLight.position.set(0, 1.2, 1.4); scene.add(impactLight);

  const { wallpaper, posterTexture } = await loadArenaAssets({
    wallpaper: () => loadWallpaper('/assets/belobog-arena.png'),
    fallbackWallpaper: () => loadWallpaper('/assets/belobog-original.png'),
    posters: loadPosterAtlas,
    robot: () => loadRobotAssets().then(() => { reportProgress(0.78); }),
  });
  let posterOwnedByEnvironment = false;
  startupCleanup.push(() => wallpaper.dispose(), () => { if (!posterOwnedByEnvironment) posterTexture?.dispose(); });
  const environment = buildEnvironment(scene, wallpaper, posterTexture);
  posterOwnedByEnvironment = true;
  startupCleanup.push(() => environment.dispose());
  const emissionGlow = createEmissionGlow(renderer);
  startupCleanup.push(() => emissionGlow.dispose());
  const softTexture = makeSoftTexture();
  startupCleanup.push(() => softTexture.dispose());
  const contactTexture = makeContactTexture();
  startupCleanup.push(() => contactTexture.dispose());
  const atmosphere = makeAtmosphere(scene, softTexture);
  startupCleanup.push(() => atmosphere.dispose());
  const effects = createCombatEffects(scene);
  startupCleanup.push(() => effects.dispose());
  const robots = new Map();
  const seenEvents = new Set();
  const eventQueue = [];
  let snapshot = null;
  let snapshotReceived = performance.now();
  let localId = null;
  let graphicsMode = readGraphicsPreference();
  let quality = GRAPHICS_PRESETS[graphicsMode].effects;
  let reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  effects.setReducedMotion(reducedMotion);
  emissionGlow.setReducedMotion(reducedMotion);
  let width = 1, height = 1, pixelRatio = 1;
  let hitstop = 0;
  let disposed = false;
  let renderingSuspended = false;
  let frame = 0;
  let previousTime = performance.now();
  let sceneTime = 0;
  let motionTime = 0;
  let presentationGeneration = 0;
  let effectReviewKey = null;
  let roundStart = -10;
  let introRound = null;
  let impactIntensity = 0;
  const cameraChoreography = createCameraChoreography();
  let cameraSeek = false;
  let lastFaceoffFrame = null;
  const shadowGeometry = new THREE.PlaneGeometry(1, 1);
  startupCleanup.push(() => shadowGeometry.dispose());
  const markerGeometry = new THREE.RingGeometry(0.57, 0.6, 40);
  startupCleanup.push(() => markerGeometry.dispose());

  function robotFor(player) {
    let robot = robots.get(player.id);
    if (robot && robot.skin !== player.skin) {
      scene.remove(robot.model.group); robot.model.dispose();
      scene.remove(robot.shadow, robot.marker); robot.shadow.material.dispose(); robot.marker.material.dispose();
      robots.delete(player.id); robot = null;
    }
    if (robot) return robot;
    const model = createRobot({ skin: player.skin ?? (player.id === 'p2' ? 'cyan' : 'amber') });
    model.group.position.set(player.x ?? 0, player.y ?? 0, 0);
    model.group.traverse(mesh => {
      if (mesh.isMesh) {
        mesh.castShadow = true; mesh.receiveShadow = false;
        if (!mesh.geometry.name) mesh.geometry.name = `robot-${mesh.name || mesh.type}`;
      }
    });
    scene.add(model.group);
    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
      map: contactTexture, transparent: true, depthWrite: false, opacity: 0.78,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(player.x ?? 0, -0.017, 0);
    shadow.scale.set(3.1, 1.8, 1);
    scene.add(shadow);
    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
      color: player.skin === 'cyan' ? CYAN : AMBER,
      transparent: true, opacity: 0.23, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = -0.015;
    marker.scale.set(1.35, 0.75, 1); scene.add(marker);
    robot = { model, shadow, marker, x: player.x ?? 0, y: player.y ?? 0, skin: player.skin, action: 'idle' };
    robots.set(player.id, robot);
    return robot;
  }

  const lobby = [
    { id: 'lobby1', skin: 'amber', x: 2.5, y: 0, facing: 1, action: 'idle', energy: 0, hp: 100 },
    { id: 'lobby2', skin: 'cyan', x: 5.5, y: 0, facing: -1, action: 'idle', energy: 0, hp: 100 },
  ];

  function resize() {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    pixelRatio = graphicsPixelRatio({ width, height, dpr: window.devicePixelRatio, preset: graphicsMode, maxTextureSize: renderer.capabilities.maxTextureSize });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    emissionGlow.resize(width, height, pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  startupCleanup.push(() => resizeObserver.disconnect());
  resizeObserver.observe(container);
  function applyQuality(value) {
    graphicsMode = graphicsPreset(value);
    quality = GRAPHICS_PRESETS[graphicsMode].effects;
    effectReviewKey = null;
    effects.setQuality(quality); emissionGlow.setQuality(quality);
    renderer.shadowMap.enabled = key.castShadow = quality !== 'low';
    renderer.shadowMap.needsUpdate = true;
    resize();
  }
  applyQuality(graphicsMode);
  const stopWatchingGraphics = observeGraphicsPreference(applyQuality);
  startupCleanup.push(stopWatchingGraphics);

  function onVisibilityChange() {
    // Returning to a tab must not replay damage accumulated while it was hidden.
    if (document.hidden) { eventQueue.length = 0; effects.clear(); cameraChoreography.clearFeedback(); }
    previousTime = performance.now();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  startupCleanup.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));

  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    // RAF's presentation timestamp may precede performance.now() used during setup.
    const dt = clamp((now - previousTime) / 1000, 0, 0.055);
    previousTime = now;
    if (document.hidden || renderingSuspended || width < 2 || height < 2) return;
    sceneTime += dt;
    hitstop = Math.max(0, hitstop - dt);
    const paused = snapshot?.phase === 'paused' || snapshot?.story?.paused;
    const animationDt = paused ? 0 : hitstop > 0 && !reducedMotion ? dt * 0.05 : dt;
    motionTime += animationDt;
    const players = snapshot?.players?.length ? snapshot.players : lobby;
    const inLobby = !snapshot;
    const activeIds = new Set(players.map(p => p.id));
    for (const [id, robot] of robots) {
      robot.model.group.visible = robot.shadow.visible = robot.marker.visible = activeIds.has(id);
    }
    const renderPlayers = [];
    const sinceSnapshot = clamp((now - snapshotReceived) / 1000, 0, 0.16);
    for (const player of players) {
      const visual = robotFor(player);
      const extrapolate = snapshot?.phase === 'fight' ? Math.min(sinceSnapshot, 0.05) : 0;
      const { x: targetX, y: targetY } = arenaRootPosition(player, extrapolate);
      const poseKey = [player.x, player.y, player.facing, player.action, player.variant, player.actionTime,
        player.hp, player.guard, player.energy, player.grabTarget, player.grabbedBy,
        player.grabHoldTime, player.grabReleaseTime].join(':');
      const seek = paused && (visual.generation !== presentationGeneration
        || visual.seekToken !== snapshot?.visualSeekToken
        || visual.wasPaused && visual.pauseKey !== poseKey);
      const snap = Math.abs(visual.x - targetX) > 3 || visual.action === 'ko' && player.action === 'idle';
      const amount = paused ? seek ? 1 : 0 : snap ? 1 : 1 - Math.exp(-animationDt * 23);
      visual.x = lerp(visual.x, targetX, amount);
      // A committed dive follows real velocity before impact, then the server's
      // floor contact. Do not let hitstop suspend its root above the dust ring.
      visual.slamRootFollower ??= createSlamRootFollower();
      if (seek) visual.slamRootFollower.reset();
      const followedY = lerp(visual.y, targetY, amount);
      const slamY = paused ? null : visual.slamRootFollower.update(player, extrapolate, followedY);
      visual.y = slamY ?? followedY;
      visual.model.group.position.set(visual.x, visual.y, inLobby && player.id === 'lobby2' ? -0.35 : 0);
      const rendered = { ...(paused && !seek && visual.lastRendered ? visual.lastRendered : player), x: visual.x, y: visual.y,
        actionTime: paused && !seek ? visual.animationActionTime ?? player.actionTime ?? 0
          : (player.actionTime ?? 0) + (inLobby ? motionTime : ['story', 'fight', 'finishing', 'roundOver', 'matchOver'].includes(snapshot?.phase) || player.action === 'recover' ? sinceSnapshot : 0),
        visualReducedMotion: reducedMotion, visualPaused: paused, visualSeekToken: snapshot?.visualSeekToken };
      if ((!paused || seek) && Number.isFinite(player.destructionTime)) rendered.destructionTime = player.destructionTime + (paused ? 0 : sinceSnapshot);
      rendered.visualQuality = quality;
      const partnerId = player.grabTarget || player.grabbedBy || (['finisher', 'defeated'].includes(player.action)
        ? players.find(other => other.id !== player.id)?.id : null);
      if (partnerId) {
        const partner = robots.get(partnerId);
        const partnerState = players.find(other => other.id === partnerId);
        if (partner || partnerState) {
          const contactRoot = pairedRoot(partner, partnerState, seek);
          rendered.grabPartnerX = contactRoot.x;
          rendered.grabPartnerY = contactRoot.y;
        }
      }
      if (!paused && hitstop > 0 && !reducedMotion && visual.action === player.action
        && visual.variant === player.variant && visual.animationActionTime != null
        && (player.actionTime ?? 0) >= visual.animationActionTime - 0.1) {
        rendered.actionTime = visual.animationActionTime + animationDt;
      }
      visual.animationActionTime = rendered.actionTime;
      visual.model.update(rendered, animationDt, motionTime);
      rendered.damageAnchors = visual.model.getDamageAnchors?.();
      rendered.combatAnchors = visual.model.getCombatAnchors?.();
      visual.lastRendered = rendered;
      visual.wasPaused = paused; visual.pauseKey = poseKey;
      visual.seekToken = snapshot?.visualSeekToken; visual.generation = presentationGeneration;
      visual.action = player.action;
      visual.variant = player.variant;
      const contact = visual.model.getContactShadow?.();
      const contactHeight = Number.isFinite(contact?.height) ? Math.max(0, contact.height) : visual.y;
      const shadowScale = 1 + contactHeight * 0.14;
      visual.shadow.position.x = visual.x + (contact?.x ?? 0);
      visual.shadow.position.z = visual.model.group.position.z + (contact?.z ?? 0);
      // Match the actual folded/airborne mesh footprint supplied by the robot controller.
      const shadowWidth = contact?.width ? Math.max(1.0, contact.width * 1.08) : 3.1;
      const shadowDepth = contact?.depth ? Math.max(0.8, contact.depth * 1.03) : 1.8;
      visual.shadow.scale.set(shadowWidth * shadowScale, shadowDepth * shadowScale, 1);
      visual.shadow.material.opacity = 0.78 / (1 + contactHeight * 0.7);
      visual.marker.position.x = visual.x;
      visual.marker.material.opacity = ['ko', 'defeated', 'destroyed'].includes(player.action) || player.hp <= 0
        ? 0 : inLobby ? 0.12 : player.id === localId ? 0.45 : 0.22;
      renderPlayers.push(rendered);
    }

    const renderState = { ...snapshot, players: renderPlayers };
    for (const { event, cameraHistorical } of eventQueue.splice(0)) {
      const strength = effects.emit({ ...event, presentationHistorical: cameraHistorical }, renderState);
      cameraChoreography.contact(event, players, { historical: cameraHistorical || paused, reduced: reducedMotion, strength });
      if (event.type === 'burst') {
        // Defensive vent: release the camera and hitstop instead of imitating an offensive blast.
        hitstop = 0;
        impactIntensity = Math.max(impactIntensity * 0.3, 5);
        impactLight.position.set(event.x ?? 0, event.y ?? 1.1, 1.2);
        impactLight.color.set('#bbf5ef');
      }
      const pairedHit = event.type === 'hit' && event.variant === 'grab';
      const interruptedGrip = event.type === 'grabBreak' && event.reason === 'interrupted';
      if (!pairedHit && !interruptedGrip && ['hit', 'ko', 'parry', 'launch', 'slam', 'ultimatePulse', 'grab', 'grabStrike', 'throw', 'grabBreak', 'finisherImpact', 'destruction'].includes(event.type)) {
        const finish = event.type === 'ultimatePulse' && event.pulse === 2;
        const stop = event.type === 'destruction' ? .095 : event.type === 'finisherImpact' ? .07 : event.type === 'ko' ? 0.065 : finish ? 0.085 : event.type === 'parry' ? 0.05
          : event.type === 'grab' ? 0.018 : event.type === 'grabBreak' ? 0.022 : event.type === 'throw' ? 0.055
          : event.type === 'slam' ? 0.065 : event.counter ? 0.065 : event.punish ? 0.06 : event.damage >= 14 ? 0.05 : 0.025;
        hitstop = Math.max(hitstop, stop);
        const intensity = event.type === 'destruction' ? 36 : event.type === 'finisherImpact' ? 18 : finish ? 22 : event.type === 'ko' ? 8 : event.type === 'grab' ? 4
          : event.type === 'grabBreak' ? 6 : event.type === 'parry' ? 9 : 13;
        impactIntensity = Math.max(impactIntensity, intensity);
        impactLight.position.set(event.x ?? 0, (event.y ?? 1.1) + 0.25, 1.3);
        const source = snapshot?.players?.find(player => player.id === event.player);
        impactLight.color.set(event.type === 'destruction' || event.type === 'finisherImpact' ? '#ffcf87' : event.type === 'parry' || event.type === 'grabBreak' ? '#ddffff'
          : event.punish || event.type === 'grab' ? '#ff946e' : source?.skin === 'cyan' ? CYAN : AMBER);
      }
    }
    // Explicit local laboratory option: reconstruct the real bounded effect
    // pool once at a seeked contact age, then hold it. Ordinary game updates
    // never enter this path or replay historical events.
    const effectReview = allowEffectReview && paused ? snapshot?.visualEffectFrame : null;
    if (effectReview && effectReviewKey !== snapshot.visualSeekToken) {
      effectReviewKey = snapshot.visualSeekToken;
      effects.clear();
      const contactState = effectReview.state;
      effects.emit(effectReview.event, contactState);
      const age = clamp(Number(effectReview.age) || 0, 0, 1);
      for (let elapsed = 0; elapsed < age; elapsed += 1 / 120) effects.update(Math.min(1 / 120, age - elapsed), sceneTime, contactState, pixelRatio);
    } else if (!effectReview) effectReviewKey = null;
    effects.update(effectReview ? 0 : dt, sceneTime, renderState, pixelRatio);
    atmosphere.update(dt, sceneTime, quality === 'low', reducedMotion, emissionGlow.getStats().enabled);
    impactIntensity *= Math.exp(-dt * 17);
    impactLight.intensity = reducedMotion ? impactIntensity * 0.25 : impactIntensity;

    const intro = reducedMotion || inLobby ? 0 : Math.max(0, 1 - (sceneTime - roundStart) / 2.1);
    const overloading = renderPlayers.find(player => player.action === 'ultimate');
    const chargeTime = overloading?.actionTime ?? 0;
    const chargeFrame = reducedMotion || !overloading ? 0 : Math.sin(clamp(chargeTime / 1.8, 0, 1) * Math.PI);
    const finishElapsed = snapshot?.finish?.elapsed ?? 0;
    const finishingFrame = reducedMotion || snapshot?.finish?.stage !== 'execute' ? 0
      : Math.sin(clamp(finishElapsed / 2.35, 0, 1) * Math.PI) * .62;
    let cameraFrame = cameraChoreography.update(dt, renderPlayers, {
      aspect: camera.aspect, fov: camera.fov, inLobby, paused, seek: cameraSeek,
      reduced: reducedMotion, intro, charge: chargeFrame, finish: finishingFrame,
    });
    if (snapshot?.story?.stage === 'faceoff') {
      cameraFrame = computeFaceoffCamera({ story: snapshot.story, players: renderPlayers, aspect: camera.aspect, fov: camera.fov, reduced: reducedMotion });
      lastFaceoffFrame = cameraFrame;
    } else if (lastFaceoffFrame) {
      const progress = snapshot?.story?.stage === 'roundIntro' ? snapshot.story.elapsed / 3
        : snapshot?.phase === 'countdown' ? 1 - snapshot.countdown / 3 : 1;
      cameraFrame = blendFaceoffCamera(lastFaceoffFrame, cameraFrame, progress);
      if (progress >= 1) lastFaceoffFrame = null;
    }
    cameraSeek = false;
    camera.position.set(cameraFrame.x, cameraFrame.y, cameraFrame.z);
    camera.lookAt(cameraFrame.tx, cameraFrame.ty, cameraFrame.tz);
    emissionGlow.render(scene, camera);

  }
  frame = requestAnimationFrame(animate);
  startupCleanup.push(() => cancelAnimationFrame(frame));
  reportProgress(1);

  startupCleanup.length = 0;
  return {
    update(state, playerId) {
      if (disposed) return;
      const reset = !state || (snapshot?.room && state.room !== snapshot.room);
      if (reset) renderingSuspended = false;
      const cameraHistorical = reset || !snapshot || snapshot.phase === 'paused' || performance.now() - snapshotReceived > 350;
      if (reset) { seenEvents.clear(); eventQueue.length = 0; effects.clear(); effectReviewKey = null; hitstop = 0; cameraChoreography.reset(); lastFaceoffFrame = null; presentationGeneration++; }
      else if (snapshot?.round !== state?.round) { eventQueue.length = 0; effects.clear(); cameraChoreography.clearFeedback(); }
      cameraSeek = state?.phase === 'paused' && (state.visualSeekToken !== snapshot?.visualSeekToken || reset);
      snapshot = state;
      snapshotReceived = performance.now();
      localId = playerId;
      if (state && (state.phase === 'countdown' || state.phase === 'fight') && introRound !== `${state.room}:${state.round}`) {
        introRound = `${state.room}:${state.round}`;
        roundStart = sceneTime;
      }
      for (const event of state?.events ?? []) {
        if (event.id == null || seenEvents.has(event.id)) continue;
        seenEvents.add(event.id);
        if (!document.hidden && state.phase !== 'paused' && state.phase !== 'countdown' && state.phase !== 'waiting') eventQueue.push({ event, cameraHistorical });
      }
      if (seenEvents.size > 512) {
        const keep = [...seenEvents].slice(-256); seenEvents.clear(); keep.forEach(id => seenEvents.add(id));
      }
    },
    resize,
    setSuspended(value) { renderingSuspended = Boolean(value); },
    setQuality: applyQuality,
    setReducedMotion(value) { reducedMotion = Boolean(value); effects.setReducedMotion(reducedMotion); emissionGlow.setReducedMotion(reducedMotion); effectReviewKey = null; },
    getGlowStats() { return emissionGlow.getStats(); },
    setGlowEnabled(value) { if (allowEffectReview) emissionGlow.setEnabled(value); },
    getDamageStats() { return effects.getDamageStats(); },
    getEffectsStats() { return effects.getEffectsStats(); },
    getCameraStats() { return cameraChoreography.stats(); },
    // Explicit laboratory A/B: production callers cannot enable the old sine kick.
    setCameraReviewBaseline(value) { if (allowEffectReview) cameraChoreography.setBaseline(value); },
    getGrappleStats() {
      return [...robots.entries()].filter(([, visual]) => visual.lastRendered?.grabTarget).map(([id, visual]) => ({
        id, rootX: visual.x, partnerX: visual.lastRendered.grabPartnerX,
        facing: visual.lastRendered.facing, yaw: visual.model.group.children[0].rotation.y,
        leftClaw: visual.model.getCombatAnchors().leftClaw.toArray(),
        rightClaw: visual.model.getCombatAnchors().rightClaw.toArray(),
      }));
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); stopWatchingGraphics();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      for (const robot of robots.values()) {
        scene.remove(robot.model.group, robot.shadow, robot.marker);
        robot.model.dispose(); robot.shadow.material.dispose(); robot.marker.material.dispose();
      }
      robots.clear(); effects.dispose(); atmosphere.dispose(); environment.dispose();
      shadowGeometry.dispose(); markerGeometry.dispose(); softTexture.dispose(); contactTexture.dispose(); wallpaper.dispose();
      emissionGlow.dispose(); key.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
  } catch (error) {
    for (const cleanup of startupCleanup.reverse()) { try { cleanup(); } catch { /* Finish releasing the rest of this failed attempt. */ } }
    throw error;
  }
}
