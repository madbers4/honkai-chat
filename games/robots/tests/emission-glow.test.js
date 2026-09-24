import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEmissionGlow, glowSize } from '../src/emission-glow.js';
import { createContactLights } from '../src/contact-light.js';

function rendererMock(supported = true) {
  const renderer = { extensions: { has: () => supported }, domElement: new THREE.EventDispatcher(),
    shadowMap: { autoUpdate: true }, autoClear: true, toneMappingExposure: 1.34, target: null, targets: new Set(), calls: [],
    getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; if(value)this.targets.add(value); },
    render(scene, camera) { this.calls.push({scene,camera,target:this.target}); this.observe?.(scene,camera); },
  };
  return renderer;
}
test('HDR glow resolution follows DPR with a 960 pixel long-edge cap; low and unsupported modes allocate nothing', () => {
  assert.deepEqual(glowSize(844,390,1.5), {width:633,height:293});
  assert.deepEqual(glowSize(3840,2160,2), {width:960,height:540});
  assert.deepEqual(glowSize(NaN,0,NaN), {width:1,height:1});
  for(const supported of [true,false]) {
    const renderer=rendererMock(supported), glow=createEmissionGlow(renderer);glow.setQuality('low');
    glow.render(new THREE.Scene(),new THREE.Camera());assert.equal(renderer.calls.length,1);assert.equal(renderer.targets.size,0);
    glow.setQuality('high');glow.render(new THREE.Scene(),new THREE.Camera());
    assert.equal(glow.getStats().targets,supported?3:0);glow.dispose();glow.dispose();
  }
});
test('selective HDR uses only declared emission, preserves depth blockers and restores every scene material', () => {
  const renderer=rendererMock(), scene=new THREE.Scene(), camera=new THREE.Camera();
  const paper=new THREE.MeshStandardMaterial({color:0xffffff}), signal=new THREE.MeshStandardMaterial({emissive:0x20d96f,emissiveIntensity:3});
  signal.userData.glowSource='emissive';
  const model=new THREE.Mesh(new THREE.BoxGeometry(),[paper,signal]);scene.add(model);
  const fog=scene.fog=new THREE.FogExp2(0xff0000), background=scene.background=new THREE.Color(0x123456);
  const smoke=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true}));scene.add(smoke);
  let inspected=false;
  renderer.observe=rendered=>{ if(rendered===scene&&renderer.target) {
    inspected=true;assert.equal(model.material[0].color.getHex(),0);assert.equal(model.material[0].depthWrite,true);
    assert.ok(model.material[1].color.g>1,'source retains HDR values, not clamped display white');
    assert.equal(model.material[1].isMeshBasicMaterial,true);assert.equal(smoke.visible,false);assert.equal(scene.fog,null);
  }};
  const glow=createEmissionGlow(renderer);glow.render(scene,camera);assert.equal(inspected,true);
  assert.deepEqual(model.material,[paper,signal]);assert.equal(smoke.visible,true);assert.equal(scene.fog,fog);assert.equal(scene.background,background);
  assert.equal(renderer.autoClear,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.target,null);
  assert.equal(renderer.calls.length,5,'normal scene + HDR source scene + two separable blur draws + composite');
  assert.equal(glow.getStats().sourceMaterials,1);signal.dispose();assert.equal(glow.getStats().sourceMaterials,0,'per-robot proxies release with their owner');glow.dispose();
});
test('targets are released on quality change, context loss and dispose; restoration permits a fresh render', () => {
  const renderer=rendererMock(), glow=createEmissionGlow(renderer), scene=new THREE.Scene(), camera=new THREE.Camera();
  let released=0;
  glow.resize(844,390,1.5);glow.render(scene,camera);
  const watch=()=>{for(const target of renderer.targets){if(target.userDataWatched)continue;target.userDataWatched=true;target.addEventListener('dispose',()=>released++);}};
  watch();glow.setQuality('low');assert.equal(released,3);assert.equal(glow.getStats().targets,0);
  glow.setQuality('high');glow.render(scene,camera);watch();
  renderer.domElement.dispatchEvent({type:'webglcontextlost'});assert.equal(released,6);assert.equal(glow.getStats().enabled,false);
  renderer.domElement.dispatchEvent({type:'webglcontextrestored'});glow.setReducedMotion(true);glow.render(scene,camera);watch();
  assert.equal(glow.getStats().reduced,true);assert.equal(glow.getStats().targets,3);glow.dispose();glow.dispose();assert.equal(released,9);
});
test('an interrupted emission render restores the live scene and falls back to the original renderer', () => {
  const renderer=rendererMock(), scene=new THREE.Scene(), material=new THREE.MeshStandardMaterial({color:0xffffff}), mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
  scene.add(mesh);let warnings=0;renderer.observe=s=>{if(s===scene&&renderer.target)throw Error('simulated framebuffer failure');};
  const glow=createEmissionGlow(renderer,{onFailure:()=>warnings++});glow.render(scene,new THREE.Camera());
  assert.equal(mesh.material,material);assert.equal(renderer.target,null);assert.equal(renderer.autoClear,true);assert.equal(renderer.shadowMap.autoUpdate,true);
  assert.equal(glow.getStats().failed,true);assert.equal(warnings,1);assert.equal(glow.getStats().targets,0);
  const count=renderer.calls.length;glow.render(scene,new THREE.Camera());assert.equal(renderer.calls.length,count+1);glow.dispose();
});

const player=(id='p1')=>({id,damageAnchors:{core:new THREE.Vector3(1,.8,.4),head:new THREE.Vector3(1,1.8,.2)}});
test('fault lighting uses at most two sources, follows the real contact, pauses and cools monotonically', () => {
  const scene=new THREE.Scene(), lights=createContactLights(scene), a=player(), b=player('p2');
  for(let i=0;i<100;i++)lights.emit(i%2?a:b,'core');assert.equal(scene.children.length,2);
  lights.update(.02,[a,b]);assert.equal(lights.getStats().contactLightsActive,2);
  const first=scene.children[0], intensity=first.intensity;lights.update(0,[a,b]);assert.equal(first.intensity,intensity);
  a.damageAnchors.core.x=4;b.damageAnchors.core.x=4;lights.update(.02,[a,b]);assert.equal(first.position.x,4);assert.ok(first.intensity<intensity);
  lights.update(.2,[a,b]);assert.equal(lights.getStats().contactLightsActive,0);lights.dispose();assert.equal(scene.children.length,0);
});
test('fault light owner reset, low/reduced settings and missing anchors extinguish without replay', () => {
  const scene=new THREE.Scene(),lights=createContactLights(scene),p=player();lights.emit(p,'core');lights.update(0,[p]);
  lights.clearOwner(p.id);lights.update(0,[p]);assert.equal(lights.getStats().contactLightsActive,0);
  for(const mode of ['quality','reduced']) {
    if(mode==='quality')lights.setQuality('low');else lights.setReducedMotion(true);
    lights.emit(p,'core');lights.update(0,[p]);assert.equal(lights.getStats().contactLightsActive,0);
    lights.setQuality('high');lights.setReducedMotion(false);lights.update(0,[p]);assert.equal(lights.getStats().contactLightsActive,0);
  }
  lights.emit(p,'core');lights.update(0,[]);assert.equal(lights.getStats().contactLightsActive,0);
  lights.emit({...p,damageAnchors:{core:new THREE.Vector3(NaN,0,0)}},'core');lights.update(0,[p]);assert.equal(lights.getStats().contactLightsActive,0);lights.dispose();lights.dispose();
});
