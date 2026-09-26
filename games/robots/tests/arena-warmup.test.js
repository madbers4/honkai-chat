import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {warmArenaGraphics,compileArenaPrograms,shouldPresentCombatEvent} from '../src/arena-warmup.js';
import {createAbilityEffects} from '../src/ability-effects.js';

test('GPU preparation uploads hidden effect textures, compiles, renders offscreen and restores visibility',async()=>{
  const scene=new THREE.Scene(),texture=new THREE.Texture();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map:texture}));
  const dormantGroup=new THREE.Group();dormantGroup.visible=false;
  mesh.visible=false;dormantGroup.add(mesh);scene.add(dormantGroup);
  const saved={original:true};let target=saved,compiled=0,draws=0;
  const renderer={getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},initTexture:value=>assert.equal(value,texture),
    compile:()=>{compiled++;assert.equal(mesh.visible,true);return new Set([mesh.material]);},
    properties:{get:()=>({currentProgram:{isReady:()=>true}})},info:{programs:[1,2]}};
  const result=await warmArenaGraphics({renderer,scene,camera:{},glow:{render(){draws++;assert.notEqual(target,saved);assert.equal(dormantGroup.visible,true);}}});
  assert.deepEqual(result,{textures:1,programs:2});assert.equal(compiled,2);assert.equal(draws,1);
  assert.equal(target,saved);assert.equal(mesh.visible,false);assert.equal(mesh.frustumCulled,true);
  assert.equal(dormantGroup.visible,false);
  await assert.rejects(warmArenaGraphics({renderer:{...renderer,compile:()=>{throw Error('lost context');}},scene,camera:{},glow:{}}),/lost context/);
  assert.equal(mesh.visible,false);assert.equal(target,saved);
  mesh.geometry.dispose();mesh.material.dispose();texture.dispose();
});

test('unready GPU programs time out, restore the hidden scene and never draw after a late completion',async()=>{
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());
  mesh.visible=false;scene.add(mesh);
  let ready=false,draws=0,checks=0,target=null;
  const renderer={getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},initTexture(){},
    compile:()=>new Set([mesh.material]),properties:{get:()=>({currentProgram:{isReady(){checks++;return ready;}}})},info:{programs:[]}};
  await assert.rejects(warmArenaGraphics({renderer,scene,camera:{},glow:{render(){draws++;}},timeoutMs:5}),/затянулась/);
  assert.equal(mesh.visible,false);assert.equal(target,null);assert.equal(draws,0);
  const stopped=checks;ready=true;await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(checks,stopped,'owns and cancels the Three-style polling timer');assert.equal(draws,0);
  await warmArenaGraphics({renderer,scene,camera:{},glow:{render(){draws++;}}});assert.equal(draws,1,'explicit retry succeeds');
  mesh.geometry.dispose();mesh.material.dispose();
});

test('abort restores framebuffer synchronously before renderer disposal and no late callback touches it',async()=>{
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());
  mesh.visible=false;scene.add(mesh);
  const controller=new AbortController();let disposed=false,target=null,compiles=0;
  const renderer={getRenderTarget:()=>target,setRenderTarget:value=>{assert.equal(disposed,false);target=value;},initTexture(){},
    compile:()=>{compiles++;return new Set([mesh.material]);},properties:{get:()=>({currentProgram:{isReady:()=>compiles===1}})},info:{programs:[]}};
  const pending=warmArenaGraphics({renderer,scene,camera:{},glow:{render(){}},signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));assert.notEqual(target,null,'second compile owns offscreen target');
  controller.abort();assert.equal(target,null);assert.equal(mesh.visible,false);disposed=true;
  await assert.rejects(pending,/отменена/);
  mesh.geometry.dispose();mesh.material.dispose();
});

test('lost WebGL context refuses preparation without touching disposed program properties',async()=>{
  let compiled=false;
  await assert.rejects(compileArenaPrograms({getContext:()=>({isContextLost:()=>true}),compile(){compiled=true;}},{},{}),/отменена/);
  assert.equal(compiled,false);
});

test('revealing dormant effects never turns on excluded lobby robots or their extra lights',async()=>{
  const scene=new THREE.Scene(),lobby=new THREE.Group(),effect=new THREE.Group();
  const geometry=new THREE.PlaneGeometry(),material=new THREE.MeshBasicMaterial();
  lobby.add(new THREE.Mesh(geometry,material),new THREE.PointLight());lobby.visible=false;
  effect.add(new THREE.Mesh(geometry,material));effect.visible=false;scene.add(lobby,effect);
  const renderer={getRenderTarget:()=>null,setRenderTarget(){},initTexture(){},
    compile(){assert.equal(lobby.visible,false);return new Set([material]);},
    properties:{get:()=>({currentProgram:{isReady:()=>true}})},info:{programs:[]}};
  await warmArenaGraphics({renderer,scene,camera:{},excludedRoots:[lobby],glow:{render(){assert.equal(lobby.visible,false);assert.equal(effect.visible,true);}}});
  assert.equal(effect.visible,false);geometry.dispose();material.dispose();
});

test('reconnect and old snapshot baselines consume explosions without replaying them',()=>{
  assert.equal(shouldPresentCombatEvent({historical:true,phase:'finishing'}),false);
  assert.equal(shouldPresentCombatEvent({phase:'story'}),false);
  assert.equal(shouldPresentCombatEvent({hidden:true,phase:'fight'}),false);
  assert.equal(shouldPresentCombatEvent({phase:'finishing'}),true);
  assert.equal(shouldPresentCombatEvent({phase:'roundOver'}),true);
  assert.equal(shouldPresentCombatEvent({phase:'fight',renderUnavailable:true}),false);
  assert.equal(shouldPresentCombatEvent({phase:'finishing',renderUnavailable:true}),false,'lost-context explosions cannot accumulate for restoration');
});

test('ability lighting keeps one shader light layout between idle, activation and cleanup',()=>{
  const scene=new THREE.Scene(),effects=createAbilityEffects(scene,{spark(){}});
  try{
    const lights=scene.children.filter(node=>node.isPointLight);
    assert.ok(lights.length>0);const count=()=>lights.filter(light=>light.visible).length;
    const total=count();effects.update(.016,{round:1,players:[],projectiles:[]});assert.equal(count(),total);
    effects.clear();assert.equal(count(),total);assert.ok(lights.every(light=>light.intensity===0));
    effects.setQuality('low');assert.equal(count(),0);effects.setQuality('high');assert.equal(count(),total);
  }finally{effects.dispose();}
});
