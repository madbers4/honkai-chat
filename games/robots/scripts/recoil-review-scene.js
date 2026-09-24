import * as THREE from 'three';
import { loadRobotAssets, createRobot } from '/src/robot.js';
import { createIndustrialEnvironment } from '/src/environment.js';
import { createDeckSurface } from '/src/deck-surface.js';
import { loadPosterAtlas } from '/src/posters.js';
import { buildRecoilCase, RECOIL_CASES } from '/scripts/recoil-review.js';

// Frame stepping reconstructs every intervening robot.update, including its
// real body/turret dampers. Pausing never settles ten times at a fixed target.
// This isolated articulation view deliberately has no camera shake or hit FX.
const $ = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.34; renderer.shadowMap.enabled = true; $('stage').append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#18222b'); scene.fog = new THREE.FogExp2('#18222b', .015);
scene.add(new THREE.HemisphereLight('#d7efff', '#76736a', 2.7));
for (const [color, intensity, position] of [['#fff0d9', 3.4, [-3, 7, 5]], ['#8ddbff', 1.35, [5, 3, 5]], ['#7bcbeb', 2.5, [3, 4, -4]]]) {
  const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position);
  if (intensity === 3.4) {
    light.castShadow = true; Object.assign(light.shadow.camera, { left: -9, right: 9, top: 5, bottom: -5 });
    light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -.0004; light.shadow.normalBias = .035;
  }
  scene.add(light);
}
for (const [color, x] of [['#ffb765', -5.4], ['#66dfff', 5.4]]) {
  const light = new THREE.PointLight(color, 10, 12, 2); light.position.set(x, 3.1, -.7); scene.add(light);
}
const wallpaper = await new THREE.TextureLoader().loadAsync('/assets/belobog-arena.png'); wallpaper.colorSpace = THREE.SRGBColorSpace;
createIndustrialEnvironment(scene, wallpaper, createDeckSurface(), await loadPosterAtlas()); await loadRobotAssets();
const camera = new THREE.PerspectiveCamera(36, 1, .1, 70); camera.position.set(0, 3.8, 11.2); camera.lookAt(0, 1.5, -.2);
let data, selected = 'jab', at = 0, facing = 1, playing = false, last = performance.now(), accumulator = 0, contactIndex = 0, simulated = -1, robots = [];
function reset() {
  robots.forEach(robot => robot.dispose());
  robots = [createRobot(), createRobot({ skin: 'cyan' })]; robots.forEach(robot => scene.add(robot.group)); simulated = -1;
}
function simulate(frame) {
  if (frame < simulated) reset();
  while (simulated < frame) {
    simulated++;
    data.snapshots[simulated].players.forEach((player, index) => {
      robots[index].group.position.set(player.x, player.y, 0);
      robots[index].update({ ...player, visualReducedMotion: $('reduced').checked, visualQuality: $('low').checked ? 'low' : 'high' }, 1 / 60, simulated / 60);
    });
  }
}
for (const [key, title] of Object.entries(RECOIL_CASES)) {
  const button = document.createElement('button'); button.textContent = title; button.dataset.case = key; button.onclick = () => choose(key); $('cases').append(button);
}
function show(frame) {
  at = Math.max(0, Math.min(data.snapshots.length - 1, frame)); simulate(at);
  $('scrub').value = at; $('clock').textContent = `${at} · ${(at / 60).toFixed(2)}s`;
  const p = data.snapshots[at].players[1];
  $('readout').textContent = `${p.name}: ${p.action}/${p.variant || 'обычный'} · ${p.hp} HP\nAction: ${p.actionTime.toFixed(3)} / ${p.actionDuration.toFixed(3)}s\nПопадания: ${data.contacts.map(e => `${e.variant}@${e.frame}`).join(' · ')}\nИстория rig 60 Hz · без hitstop / FX / тряски`;
}
function pause() { playing = false; $('play').textContent = 'Продолжить'; }
function jump(offset) { pause(); show(data.contacts[contactIndex].frame + offset); }
function choose(key) {
  selected = key; data = buildRecoilCase(key, facing); reset(); contactIndex = key === 'cross' ? 1 : 0; accumulator = 0;
  $('scrub').max = data.snapshots.length - 1;
  document.querySelectorAll('[data-case]').forEach(button => button.classList.toggle('active', button.dataset.case === key)); jump(-1);
}
$('before').onclick = () => jump(-1); $('contact').onclick = () => jump(1); $('load').onclick = () => jump(7);
$('head').onclick = () => {
  const duration = data.snapshots[data.contacts[contactIndex].frame].players[1].actionDuration;
  jump(Math.round(duration * (duration < .35 ? .69 : .55) * 60));
};
$('settle').onclick = () => jump(Math.ceil(data.snapshots[data.contacts[contactIndex].frame].players[1].actionDuration * 60));
$('next').onclick = () => { contactIndex = (contactIndex + 1) % data.contacts.length; jump(1); };
$('facing').onclick = () => { facing *= -1; choose(selected); };
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Пауза' : 'Продолжить'; show(at); };
$('replay').onclick = () => { playing = true; $('play').textContent = 'Пауза'; accumulator = 0; reset(); show(0); };
$('scrub').oninput = () => { pause(); show(Number($('scrub').value)); };
$('reduced').onchange = $('low').onchange = () => { reset(); show(at); renderer.setPixelRatio($('low').checked ? 1 : Math.min(devicePixelRatio, 1.5)); };
choose('jab');
function loop(now) {
  const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
  if (playing) {
    accumulator += dt * Number($('speed').value);
    while (accumulator >= 1 / 60) { accumulator -= 1 / 60; if (at < data.snapshots.length - 1) show(at + 1); else { pause(); break; } }
  }
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
