import * as THREE from 'three';
import { createEmissionGlow } from '../src/emission-glow.js';
import { loadRobotAssets, createRobot } from '../src/robot.js';
import { createCombatEffects } from '../src/effects.js';
import { createIndustrialEnvironment } from '../src/environment.js';
import { createDeckSurface } from '../src/deck-surface.js';
import { loadPosterAtlas } from '../src/posters.js';
import { CombatRoom } from '../server/combat.js';
import { buildOverloadCase } from './overload-review-cases.js';

const $ = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.34;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#18222b'); scene.fog = new THREE.FogExp2('#18222b', .015);
scene.add(new THREE.HemisphereLight('#d7efff', '#76736a', 2.7));
for (const [color, intensity, pos] of [['#fff0d9',3.4,[-3,7,5]], ['#8ddbff',1.35,[5,3,5]], ['#7bcbeb',2.5,[3,4,-4]]]) {
  const light = new THREE.DirectionalLight(color, intensity); light.position.set(...pos);
  if (intensity === 3.4) { light.castShadow=true; light.shadow.camera.left=-9;light.shadow.camera.right=9;light.shadow.camera.top=5;light.shadow.camera.bottom=-5;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0004;light.shadow.normalBias=.035; } scene.add(light);
}
for (const [color,x,intensity] of [['#ffb765',-5.8,10],['#66dfff',5.8,9]]) {
  const light = new THREE.PointLight(color,intensity,12,2);light.position.set(x,4.78,-2.39);scene.add(light);
}
const wallpaper = await new THREE.TextureLoader().loadAsync('/assets/belobog-arena.png'); wallpaper.colorSpace=THREE.SRGBColorSpace;
const environment=createIndustrialEnvironment(scene,wallpaper,createDeckSurface(),await loadPosterAtlas()); await loadRobotAssets();
const glow = createEmissionGlow(renderer);
const camera = new THREE.PerspectiveCamera(36,1,.1,70);
let robots=[], effects, data, events, at=0, simulated=-1, facing=1, close=false, enabled=true, playing=false, seed=919, last=performance.now(), accumulator=0;
function seeded(fn) { const original=Math.random;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};try{return fn();}finally{Math.random=original;} }
function record(type) { return buildOverloadCase(type, facing); }
function reset() {
  robots.forEach(r=>r.dispose());robots=[createRobot(),createRobot({skin:'cyan'})];robots.forEach(r=>scene.add(r.group));effects?.dispose();seed=919;effects=seeded(()=>createCombatEffects(scene));
  effects.setQuality($('quality').value);effects.setReducedMotion($('quality').value==='reduced');glow.setQuality($('quality').value);glow.setReducedMotion($('quality').value==='reduced');simulated=-1;
  renderer.shadowMap.enabled=$('quality').value!=='low';
}
function simulate(frame) {
  if(frame<simulated)reset();
  while(simulated<frame){simulated++;const state=structuredClone(data.snapshots[simulated]);state.players.forEach((p,i)=>{
    robots[i].group.position.set(p.x,p.y,0);p.visualQuality=$('quality').value;p.visualReducedMotion=$('quality').value==='reduced';robots[i].update(p,1/60,simulated/60);p.damageAnchors=robots[i].getDamageAnchors();p.combatAnchors=robots[i].getCombatAnchors();
  });seeded(()=>{for(const event of events.get(simulated)||[])effects.emit(event,state);effects.update(1/60,simulated/60,state,renderer.getPixelRatio());});}
}
function seek(frame){playing=false;at=Math.max(0,Math.min(data.snapshots.length-1,frame));simulate(at);}
const beat=()=>data.events.find(e=>e.type==='ultimatePulse'&&e.pulse===0)?.frame??69;
function choose(){data=record($('case').value);events=new Map();for(const e of data.events){if(!events.has(e.frame))events.set(e.frame,[]);events.get(e.frame).push(e);}$('frame').max=data.snapshots.length-1;reset();seek(60);}
$('glow').onclick=()=>{enabled=!enabled;glow.setEnabled(enabled);$('glow').textContent=`Свечение: ${enabled?'вкл':'выкл'}`;$('glow').setAttribute('aria-pressed',enabled);};
$('case').onchange=choose;$('quality').onchange=()=>{reset();simulate(at);resize();};$('camera').onclick=()=>close=!close;$('facing').onclick=()=>{facing*=-1;choose();};
$('frame').oninput=()=>seek(Number($('frame').value));$('charge').onclick=()=>seek(58);$('contact').onclick=()=>seek(beat()+3);$('arc').onclick=()=>seek(beat()+37);$('late').onclick=()=>seek(beat()+85);$('play').onclick=()=>playing=!playing;
function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio,$('quality').value==='low'?1:1.5));renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();glow.resize(innerWidth,innerHeight,renderer.getPixelRatio());}
addEventListener('resize',resize);resize();choose();
function render(now){requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000);last=now;if(playing){accumulator+=dt;while(accumulator>=1/60){accumulator-=1/60;at++;if(at>=data.snapshots.length){at=0;reset();}simulate(at);}}
  const lamps=false;camera.position.set(close?(lamps?-5.8:.4):0,close?(lamps?4.1:2.9):3.8,close?6:10.7);camera.lookAt(close?(lamps?-5.8:.4):0,close?(lamps?4.7:1.2):1.5,lamps?-2.5:0);
  renderer.info.autoReset=false;renderer.info.reset();glow.render(scene,camera);$('frame').value=at;$('clock').textContent=`${(at/60).toFixed(3)} с`;
  const stats=glow.getStats(), fx=effects.getDamageStats();$('stats').textContent=`${data.snapshots[at].players.map(p=>p.name+' '+p.hp+' HP · '+p.action+'/'+p.variant).join(' | ')}\n` +`Linear HDR · ${stats.enabled?'ON':'OFF'} · ${stats.width}×${stats.height}\nИскры ${fx.sparkActive} · локальные источники ${fx.contactLightsActive}/2\n${stats.failed?'HDR fallback':'Исходное освещение одинаково в A/B'} · кадр ${at}\nDraws ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}`;
}
requestAnimationFrame(render);
addEventListener('pagehide',()=>{glow.dispose();effects.dispose();robots.forEach(r=>r.dispose());environment.dispose();wallpaper.dispose();renderer.dispose();},{once:true});
