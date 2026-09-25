import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyDeckUV, createDeckSurface, rasterizeDeckSurface, DECK_SURFACE, stoneCourses } from '../src/deck-surface.js';
import { createClubFloor, CLUB_FLOOR } from '../src/club-floor.js';

test('world UV scale remains identical from a chamfered flag to the furthest room corner', () => {
  const floor = createClubFloor({ deckSurface: { material: new THREE.MeshStandardMaterial() } });
  const geometry = floor.group.getObjectByName('continuous-club-stone-floor').geometry;
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  for(let i=0;i<position.count;i++) {
    assert.ok(Math.abs((uv.getX(i)-.5)*DECK_SURFACE.width-position.getX(i))<.00001);
    assert.ok(Math.abs((uv.getY(i)-.5)*DECK_SURFACE.depth-position.getZ(i))<.00001);
  }
  floor.group.getObjectByName('continuous-club-stone-floor').material.dispose(); floor.dispose();
});

test('stone courses close exactly at atlas boundaries without aligned vertical joint rows', () => {
  const courses=stoneCourses();
  assert.equal(courses.reduce((n,row)=>n+row.height,0),DECK_SURFACE.depth);
  assert.equal(new Set(courses.map(row=>row.offset)).size,courses.length);
  for(const row of courses) assert.ok(Math.abs(row.stones.reduce((n,stone)=>n+stone.width,0)-DECK_SURFACE.width)<.00001);
});

test('stone is matte and nonmetallic at both bounded texture budgets', () => {
  for(const [request,expected] of [[1,1024],[1024,1024],[2048,2048],[8192,2048]]) {
    const raster=rasterizeDeckSurface(request);
    assert.equal(raster.width,expected); assert.equal(raster.height,expected/2);
    assert.ok(raster.albedo.byteLength+raster.properties.byteLength<=16*1024*1024);
    let low=255,high=0,rough=255;
    for(let i=0;i<raster.properties.length;i+=4) {
      low=Math.min(low,raster.properties[i]);high=Math.max(high,raster.properties[i]);
      rough=Math.min(rough,raster.properties[i+1]);
      assert.equal(raster.properties[i+2],0,'rubbing a limestone flag never exposes metal');
      assert.equal(raster.properties[i+3],255);
    }
    assert.ok(high-low>90,'mortar and stone have distinct relief');
    assert.ok(rough>215,'no wet or metallic mirror floor');
  }
});

test('stone filtering retains detail and shared maps have exact ownership', () => {
  const deck=createDeckSurface({resolution:1024});
  assert.equal(deck.textures.length,2);
  assert.equal(deck.material.bumpMap,deck.material.roughnessMap);
  assert.ok(deck.material.bumpScale<=.02,'small mineral relief cannot lift authoritative feet');
  assert.equal(deck.material.metalness,0);
  assert.equal(deck.material.map.colorSpace,THREE.SRGBColorSpace);
  for(const map of deck.textures) {
    assert.deepEqual(map.repeat.toArray(),[1,1]);
    assert.equal(map.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(map.generateMipmaps,true);
    assert.ok(map.anisotropy>=4);
  }
  let disposed=0;
  for(const resource of [deck.material,...deck.textures])resource.addEventListener('dispose',()=>disposed++);
  deck.dispose();deck.dispose();assert.equal(disposed,3);
});

test('the complete room has flush stone flags and bounded merged geometry', () => {
  const surface={material:new THREE.MeshStandardMaterial()},floor=createClubFloor({deckSurface:surface});
  const stone=floor.group.getObjectByName('continuous-club-stone-floor'); stone.geometry.computeBoundingBox();
  const bounds=stone.geometry.boundingBox;
  assert.ok(bounds.min.x<=-43.9&&bounds.max.x>=43.9);
  assert.ok(bounds.min.z<-40.4&&bounds.max.z>43.4);
  assert.ok(Math.abs(bounds.max.y-CLUB_FLOOR.surfaceY)<.000001);
  assert.ok(bounds.min.y<-.06,'stone edges are real chamfers');
  let meshes=0,triangles=0;
  floor.group.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    for(const attribute of Object.values(o.geometry.attributes)) for(const value of attribute.array)assert.ok(Number.isFinite(value));
  }});
  assert.equal(meshes,5,'whole room, grates and grout remain five draws');
  assert.ok(triangles<100000,'distant floor coverage has a bounded static geometry budget');
  surface.material.dispose();floor.dispose();
});

test('recesses are actual sealed holes while every fighting foot is supported', () => {
  const surface={material:new THREE.MeshStandardMaterial()},floor=createClubFloor({deckSurface:surface});floor.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  for(let x=-12.6;x<=12.6;x+=.21) for(const z of [-1.8,0,1.8]) {
    ray.set(new THREE.Vector3(x,2,z),down);
    const hit=ray.intersectObject(floor.group,true)[0];
    assert.ok(hit&&hit.point.y>=-.073&&hit.point.y<=.008,`supported floor at ${x}, ${z}`);
  }
  for(const grate of CLUB_FLOOR.grates) {
    for(const ox of [-.21,.12,.33])for(const oz of [-.08,.07]){
      ray.set(new THREE.Vector3(grate.x+ox,2,grate.z+oz),down);
      const hits=ray.intersectObject(floor.group,true);
      assert.ok(hits.length>0,'the drain never exposes the void');
      assert.ok(!hits.some(h=>h.object.name==='club-floor-mortar'||h.object.name==='continuous-club-stone-floor'),'stone and grout do not cover the physical recess');
    }
  }
  surface.material.dispose();floor.dispose();
});

test('floor disposal is idempotent and leaves caller-owned stone material alive', () => {
  const material=new THREE.MeshStandardMaterial(),floor=createClubFloor({deckSurface:{material}}),resources=new Set();
  floor.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material&&o.material!==material)resources.add(o.material);});
  let disposed=0,external=0;for(const r of resources)r.addEventListener('dispose',()=>disposed++);
  material.addEventListener('dispose',()=>external++);
  floor.dispose();floor.dispose();assert.equal(disposed,resources.size);assert.equal(external,0);material.dispose();
});
