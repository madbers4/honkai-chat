import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createElectricalFaults, stepElectricalFragment } from '../src/electrical-faults.js';

const player = () => ({ id:'p1', damageAnchors:{
  core:new THREE.Vector3(2,1.1,.4), head:new THREE.Vector3(2.2,1.9,.5),
  left:new THREE.Vector3(1.6,.9,.8), right:new THREE.Vector3(2.6,.9,-.5),
} });

test('electrical filament joins two real moving hull contacts, never a floating endpoint', () => {
  const scene = new THREE.Scene(), faults = createElectricalFaults(scene), p = player();
  assert.equal(faults.emit(p,'left'),true); faults.update(.03,[p]);
  const vertices = scene.getObjectByName('damage-electrical').geometry.attributes.position;
  assert.ok(new THREE.Vector3().fromBufferAttribute(vertices,0).distanceTo(p.damageAnchors.left)<1e-6);
  assert.ok(new THREE.Vector3().fromBufferAttribute(vertices,47).distanceTo(p.damageAnchors.core)<1e-6);
  for (const contact of Object.values(p.damageAnchors)) contact.add(new THREE.Vector3(3,1,-.3));
  faults.update(.01,[p]);
  assert.ok(new THREE.Vector3().fromBufferAttribute(vertices,0).distanceTo(p.damageAnchors.left)<1e-6);
  assert.ok(new THREE.Vector3().fromBufferAttribute(vertices,47).distanceTo(p.damageAnchors.core)<1e-6);
  delete p.damageAnchors.core; faults.update(.01,[p]);
  assert.equal(faults.getStats().electricalActive,0,'missing return contact extinguishes the circuit');
  faults.dispose();
});

test('a contact cannot arc to a missing, coincident, nonfinite or distant surface', () => {
  const scene = new THREE.Scene(), faults = createElectricalFaults(scene);
  for (const p of [{id:'p1'}, {id:'p1',damageAnchors:{core:new THREE.Vector3(0,0,0)}},
    {id:'p1',damageAnchors:{core:new THREE.Vector3(0,0,0),head:new THREE.Vector3(4,4,4)}},
    {id:'p1',damageAnchors:{core:new THREE.Vector3(0,0,0),head:new THREE.Vector3(0,0,0)}},
    {id:'p1',damageAnchors:{core:new THREE.Vector3(NaN,0,0),head:new THREE.Vector3(0,1,0)}}]) {
    assert.equal(faults.emit(p,'core'),false);
  }
  faults.update(NaN,[]); assert.equal(faults.getStats().electricalActive,0); faults.dispose();
});

test('electrical pools remain fixed, quality retains filament shape and reduced motion suppresses flashes', () => {
  const scene = new THREE.Scene(), faults = createElectricalFaults(scene), p = player();
  const resources = scene.children.map(o=>[o.geometry,o.material]);
  for (let i=0;i<2000;i++) { faults.emit(p,i%2?'core':'left'); faults.update(.001,[p]); }
  assert.equal(scene.children.length,2); assert.equal(faults.getStats().electricalActive,8);
  faults.setQuality('low');
  for (let i=0;i<30;i++) faults.emit(p,'core');
  faults.update(.01,[p]); assert.equal(faults.getStats().electricalActive,4);
  const mesh = scene.getObjectByName('damage-electrical');
  assert.ok(mesh.geometry.attributes.aAlpha.array.some(a=>a>0),'low retains the complete conducting filament');
  faults.setReducedMotion(true); assert.equal(faults.emit(p,'core'),false); faults.update(0,[p]);
  assert.equal(faults.getStats().electricalActive,0);
  assert.ok(scene.getObjectByName('electrical-contact-glow').geometry.attributes.aInfo.array.every(v=>v===0));
  faults.setReducedMotion(false); faults.emit(p,'core'); faults.update(5,[p]);
  assert.equal(faults.getStats().electricalActive,0,'one delayed update expires the entire pulse');
  let disposed=0; for (const pair of resources) for (const item of pair) item.addEventListener('dispose',()=>disposed++);
  faults.dispose(); assert.equal(scene.children.length,0); assert.equal(disposed,4);
});

test('filament re-strike shape depends on age, not the number of rendered frames', () => {
  const runs = [30,60,120].map(hz=>{
    const scene=new THREE.Scene(),faults=createElectricalFaults(scene),p=player();faults.emit(p,'left');
    for(let i=0;i<hz/10;i++)faults.update(1/hz,[p]);
    const geometry=scene.getObjectByName('damage-electrical').geometry;
    const result=[...geometry.attributes.position.array,...geometry.attributes.aAlpha.array];faults.dispose();return result;
  });
  for(const run of runs.slice(1))for(let i=0;i<run.length;i++)assert.ok(Math.abs(run[i]-runs[0][i])<1e-6);
});

test('molten fragments follow the same ballistic path and short floor ricochet at 30/60/120 Hz', () => {
  const run = (hz,seconds,y,vy) => {
    const p={x:0,y,z:.2,vx:2,vy,vz:.6,gravity:10,bounces:0,life:1,size:.15};
    for(let i=0;i<Math.round(seconds*hz);i++){p.life-=1/hz;stepElectricalFragment(p,1/hz);}
    return p;
  };
  for(const [seconds,y,vy] of [[.3,2,1.4],[.2,.4,-1]]){
    const baseline=run(30,seconds,y,vy);
    for(const hz of [60,120]){
      const sample=run(hz,seconds,y,vy);
      for(const key of ['x','y','z','vx','vy','vz','life','size'])assert.ok(Math.abs(sample[key]-baseline[key])<1e-8,`${hz} Hz ${key}`);
      assert.equal(sample.bounces,baseline.bounces);
    }
  }
});
