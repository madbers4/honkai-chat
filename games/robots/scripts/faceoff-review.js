import * as THREE from 'three';
import { createEmissionGlow } from '../src/emission-glow.js';
import { loadRobotAssets, createRobot } from '../src/robot.js';
import { createIndustrialEnvironment } from '../src/environment.js';
import { createDeckSurface } from '../src/deck-surface.js';
import { loadPosterAtlas } from '../src/posters.js';
import { CombatRoom } from '../server/combat.js';
import { buildFaceoff, activeFaceoffBeat } from '../shared/faceoff-script.js';
import { createFaceoffUI } from '../src/faceoff-ui.js';
import { createStoryVoice } from '../src/story-voice.js';

const $ = id => document.getElementById(id), renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.34;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#18222b'); scene.fog = new THREE.FogExp2('#18222b', .015);
scene.add(new THREE.HemisphereLight('#d7efff', '#76736a', 2.7));
for (const [color, intensity, pos] of [['#fff0d9',3.4,[-3,7,5]], ['#8ddbff',1.35,[5,3,5]], ['#7bcbeb',2.5,[3,4,-4]]]) {
  const light = new THREE.DirectionalLight(color, intensity); light.position.set(...pos);
  if (intensity === 3.4) { light.castShadow=true; light.shadow.camera.left=-9;light.shadow.camera.right=9;light.shadow.camera.top=5;light.shadow.camera.bottom=-5;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0004;light.shadow.normalBias=.035; } scene.add(light);
}
const texture = await new THREE.TextureLoader().loadAsync('/assets/belobog-arena.png'); texture.colorSpace = THREE.SRGBColorSpace;
const environment = createIndustrialEnvironment(scene, texture, createDeckSurface(), await loadPosterAtlas()); await loadRobotAssets();
const glow = createEmissionGlow(renderer), camera = new THREE.PerspectiveCamera(36, 1, .1, 70);
const room = new CombatRoom({ id: 'STORY' }); room.addPlayer('Медный Сом'); room.addPlayer('Барон Коротыш');
const players = room.snapshot().players.map((p,i) => ({ ...p, x: i ? 1.55 : -1.55, facing: i ? -1 : 1 }));
const beats = buildFaceoff(players, 'actual-recording-review'), ui = createFaceoffUI($('stage'));
const robots = [createRobot(), createRobot({skin:'cyan'})]; robots.forEach(r => scene.add(r.group));
let elapsed = 0, playing = false, sequence = 1, last = performance.now(), status = {}, decodes = 0, starts = 0, stops = 0, audioState = 'not unlocked';
const voice = createStoryVoice({ onStatus: value => status = value, makeContext: () => {
  const ctx = new AudioContext(), decode = ctx.decodeAudioData.bind(ctx), source = ctx.createBufferSource.bind(ctx);
  ctx.decodeAudioData = async bytes => { const buffer = await decode(bytes); decodes++; return buffer; };
  ctx.createBufferSource = () => { const node = source(), start = node.start.bind(node), stop = node.stop.bind(node); node.start = (...args) => { starts++; start(...args); }; node.stop = (...args) => { stops++; stop(...args); }; return node; };
  ctx.addEventListener('statechange', () => audioState = ctx.state); return ctx;
} });
await voice.preload(beats);
$('unlock').onclick = async () => { await voice.unlock(); await voice.preload(beats); $('unlock').textContent = voice.getCapabilities().unlocked ? 'Звук включён' : 'Включить звук'; };
$('tts').onchange = () => voice.setTtsEnabled($('tts').checked); $('mute').onchange = () => voice.setMuted($('mute').checked);
$('toggle').onclick = () => $('tools').hidden = !$('tools').hidden;
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Пауза' : 'Воспроизвести'; };
function seek(t) { playing = false; elapsed = t; sequence++; voice.cancel(); $('play').textContent = 'Воспроизвести'; }
$('seek').oninput = () => seek(Number($('seek').value)); $('shot').onchange = () => seek(Number($('shot').value)); $('reset').onclick = () => seek(0);
$('quality').onchange = () => { const q = $('quality').value; glow.setQuality(q); glow.setReducedMotion(q==='reduced'); renderer.shadowMap.enabled=q!=='low'; resize(); };
function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio, $('quality').value==='low'?1:1.5));renderer.setSize(innerWidth, innerHeight, false); camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();glow.resize(innerWidth,innerHeight,renderer.getPixelRatio()); }
addEventListener('resize',resize); resize();
function render(now) {
  requestAnimationFrame(render); const dt=Math.min(.05,(now-last)/1000);last=now;
  if(playing) { elapsed=Math.min(24,elapsed+dt); if(elapsed>=24)playing=false; }
  const beat=activeFaceoffBeat(beats,elapsed), reducedMotion=$('quality').value==='reduced';
  players.forEach((p,i) => { const speaks=beat?.speaker===p.id || beat?.pose==='recoil'; const state={...p,action:'faceoff',variant:speaks?beat.pose:'stance',actionTime:elapsed-(beat?.at||0),actionDuration:beat?.duration||2.3,visualQuality:$('quality').value,visualReducedMotion:reducedMotion}; robots[i].group.position.set(p.x,0,0);robots[i].update(state,dt,elapsed); });
  voice.update({sequenceId:sequence,elapsed,paused:!playing,beats,enabled:true});
  ui.update({active:true,sequenceId:sequence,elapsed,paused:!playing,players,beats,voiceStatus:status,reducedMotion});
  // The review uses the authored rig; the production arena owns its camera.
  const mobile=innerHeight<500;camera.position.set(0,mobile?3.05:3.6,mobile?10.3:10.6);camera.lookAt(0,mobile?1.3:1.45,0);glow.render(scene,camera);
  $('seek').value=elapsed;const voices=globalThis.speechSynthesis?.getVoices()||[];
  $('stats').textContent=`${elapsed.toFixed(2)} с · ${beat?.pose||'конец'}\nAudio ${audioState} · decoded ${decodes}\nStarts ${starts} · stops ${stops}\nRU local ${voices.filter(v=>/^ru/i.test(v.lang)&&v.localService).length} / remote ${voices.filter(v=>/^ru/i.test(v.lang)&&!v.localService).length}\n${status.message||''}`;
}
requestAnimationFrame(render);
addEventListener('pagehide',()=>{voice.dispose();ui.dispose();robots.forEach(r=>r.dispose());glow.dispose();environment.dispose();texture.dispose();renderer.dispose();},{once:true});
