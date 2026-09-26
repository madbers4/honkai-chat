import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARENA_EDGE } from '../shared/constants.js';

// A chassis may stand at ±ARENA_EDGE; its toes extend another 1.82 m.
// Keep the complete, solid set outside that envelope, including bolt heads.
export const CLUB_BOUNDARIES = Object.freeze({ innerX: ARENA_EDGE + 2.02, backZ: -3.19, frontZ: 40.4 });

/** Closed workshop storage bays, built as solid carpentry and ironwork. */
export function createClubBoundaries() {
  const group = new THREE.Group(); group.name = 'fight-club-closed-storage-bays';
  const resources = new Set(), batches = new Map(), props = [];
  const keep = value => { resources.add(value); return value; };
  const materials = {
    timber: new THREE.MeshStandardMaterial({ color: '#39291e', roughness: .94, metalness: 0, vertexColors: true }),
    wood: new THREE.MeshStandardMaterial({ color: '#63412c', roughness: .91, metalness: 0, vertexColors: true }),
    iron: new THREE.MeshStandardMaterial({ color: '#3c3730', roughness: .83, metalness: .46, vertexColors: true }),
    edge: new THREE.MeshStandardMaterial({ color: '#776852', roughness: .68, metalness: .55, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: '#251f1a', roughness: 1, vertexColors: true }),
    amber: new THREE.MeshStandardMaterial({ color: '#fff0c2', emissive: '#ffbb64', emissiveIntensity: 2.5, roughness: .43, vertexColors: true }),
  };
  materials.amber.userData.glowSource = 'emissive';
  for (const [key, material] of Object.entries(materials)) {
    keep(material);
    if (!['timber', 'wood'].includes(key)) continue;
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 vClubWoodUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvClubWoodUv = uv;');
      shader.fragmentShader = `varying vec2 vClubWoodUv;
        float clubWoodHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float clubWoodNoise(vec2 p) {
          vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(clubWoodHash(i),clubWoodHash(i+vec2(1,0)),f.x),mix(clubWoodHash(i+vec2(0,1)),clubWoodHash(i+vec2(1,1)),f.x),f.y);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 grain = vClubWoodUv * vec2(92.0, 2.5);
        grain.x += clubWoodNoise(vClubWoodUv * vec2(5.0, 2.0)) * 3.0;
        float fibers = clubWoodNoise(grain), knots = clubWoodNoise(vClubWoodUv * 9.0);
        vec2 knotUv=(vClubWoodUv-vec2(.34,.63))*vec2(8.0,29.0);
        float knotLength=length(knotUv);
        float knot = smoothstep(.12,.46,knotLength);
        float rings = .88+.12*sin(knotLength*8.0+fibers*2.0);
        float pores = smoothstep(.22,.42,clubWoodNoise(grain*vec2(2.0,1.8)));
        float ends = smoothstep(0.0, .075, vClubWoodUv.y) * smoothstep(0.0,.075,1.0-vClubWoodUv.y);
        diffuseColor.rgb *= (.71 + .20*fibers + .12*knots) * (.79 + .21*ends) * (.56+.44*knot) * mix(rings,1.0,smoothstep(0.0,2.2,knotLength)) * (.88+.12*pores);
      `);
    };
    material.customProgramCacheKey = () => 'club-solid-carpentry-v1';
  }
  let serial = 0, scope = null;
  const transform = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  function add(geometry, material, x, y, z, rx=0, ry=0, rz=0) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    geometry.applyMatrix4(transform.compose(new THREE.Vector3(x,y,z), quaternion, new THREE.Vector3(1,1,1)));
    const tint = new THREE.Color().setScalar(.86 + ((serial++ * 17) % 29) / 116);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i=0; i<geometry.attributes.position.count; i++) tint.toArray(colors,i*3);
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geometry.computeBoundingBox(); scope?.bounds.union(geometry.boundingBox);
    if (!batches.has(material)) batches.set(material,[]);
    batches.get(material).push(geometry);
  }
  function box(w,h,d,material,x,y,z,rx=0,ry=0,rz=0) {
    const geometry=scope?.name==='upper-wall-timber-structure' || scope?.name.endsWith('-foreground-fence')
      ? new THREE.BoxGeometry(w,h,d)
      : new RoundedBoxGeometry(w,h,d,1,Math.min(.018,w*.13,h*.13,d*.13));
    add(geometry,material,x,y,z,rx,ry,rz);
  }
  function rod(a,b,radius,material,segments=8) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b), direction=end.clone().sub(start);
    const geometry=new THREE.CylinderGeometry(radius,radius,direction.length(),segments);
    quaternion.setFromUnitVectors(yAxis,direction.normalize());
    geometry.applyQuaternion(quaternion);
    const center=start.add(end).multiplyScalar(.5);
    add(geometry,material,center.x,center.y,center.z);
  }
  function bolt(x,y,z,axis='z') {
    add(new THREE.CylinderGeometry(.031,.031,.026,6), 'edge',x,y,z,axis==='z'?Math.PI/2:0,0,axis==='x'?Math.PI/2:0);
  }
  function beam(a,b,width,depth,material='timber') {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),direction=end.clone().sub(start);
    const geometry=new RoundedBoxGeometry(width,direction.length(),depth,1,.009);
    quaternion.setFromUnitVectors(yAxis,direction.normalize());geometry.applyQuaternion(quaternion);
    const center=start.add(end).multiplyScalar(.5);add(geometry,material,center.x,center.y,center.z);
  }
  function meshPanel(x,zMin,zMax,yMin,yMax) {
    for(const sign of [-1,1]) for(let intercept=yMin-(zMax-zMin);intercept<=yMax+(zMax-zMin);intercept+=.43) {
      const samples=[];
      for(const z of [zMin,zMax]) {const y=intercept+sign*(z-zMin);if(y>=yMin&&y<=yMax)samples.push([x+sign*.012,y,z]);}
      for(const y of [yMin,yMax]) {const z=zMin+(y-intercept)/sign;if(z>=zMin&&z<=zMax)samples.push([x+sign*.012,y,z]);}
      if(samples.length>=2&&Math.hypot(...samples[0].map((v,i)=>v-samples[1][i]))>.05) rod(samples[0],samples[1],.016,'iron',6);
    }
  }
  function prop(name, make) {
    scope={name,bounds:new THREE.Box3()};make();props.push(scope);scope=null;
  }

  const inner=CLUB_BOUNDARIES.innerX;
  // Each wooden post sits in a socket, with feet, through-bolts and a capped end.
  function post(x,z,height=5.3) {
    box(.32,height,.34,'timber',x,height/2-.006,z);
    box(.47,.12,.49,'iron',x,.048,z);
    box(.38,.48,.40,'iron',x,.25,z);
    box(.42,.085,.44,'edge',x,.505,z);
    box(.38,.095,.40,'iron',x,height-.02,z);
    for (const side of [-1,1]) for (const y of [.22,.39,height-.21]) {
      bolt(x+side*.205,y,z,'x');bolt(x,y,z+side*.21);
    }
  }

  // Airborne framing sees above the source image. Continue the room with a
  // sparse load-bearing frame, seated on its lintel, rather than a blank patch.
  prop('upper-wall-timber-structure',()=>{
    for(const y of [7.76,12.58,17.40,21.85]) {
      box(64,.28,.31,'timber',0,y,-3.25);
      box(64,.055,.34,'wood',0,y-.15,-3.235);
    }
    for(const x of [-28,-19.65,-12.15,-4.05,4.05,12.15,19.65,28]) {
      box(.25,14.17,.26,'timber',x,14.925,-3.20);
      for(const y of [7.91,12.56,17.38,21.78]) {
        box(.33,.42,.33,'iron',x,y,-3.16);
        bolt(x,y-.12,-2.975);bolt(x,y+.12,-2.975);
      }
      for(const y of [11.92,16.74]) for(const direction of [-1,1])
        beam([x+direction*.12,y,-3.14],[x+direction*1.0,y+.52,-3.14],.13,.17);
    }
  });

  // Continue the source wall with recessed wooden storage bays. The source
  // image and posters stay uncovered; deep uprights conceal the wall's joins.
  for (const side of [-1,1]) prop(`${side<0?'left':'right'}-wall-bay`,()=>{
    const x=side*15.85;
    box(7.32,2.24,.21,'dark',x,1.10,-3.30);
    for(let i=0;i<25;i++) box(.275,2.17,.075,'timber',side*(12.30+i*.287),1.09,-3.145);
    for(const y of [.13,1.83,2.21]) box(7.5,.11,.16,'wood',x,y,-3.08);
    for(const px of [12.18,15.93,19.55]) {
      // The mural joint is behind the combat lane, well outside its depth.
      post(side*px,-3.16,7.65);
      box(.56,.19,.58,'iron',side*px,2.33,-3.14);
    }
    box(7.8,.30,.29,'timber',x,7.51,-3.14);
    box(7.8,.25,.24,'timber',x,4.88,-3.14);
    // Short knee braces carry the lintels rather than floating diagonals.
    for(const px of [12.40,15.68,16.18,19.30]) {
      const dir=px===12.40||px===16.18?1:-1;
      beam([side*px,4.66,-3.01],[side*(px+dir*.59),4.08,-3.01],.145,.16);
    }
  });

  prop('left-locked-mesh-gate',()=>{
    const x=-inner-.27, front=2.29, back=-3.12, height=4.88;
    post(x,front,height+.33);post(x,back,height+.33);
    box(.34,.26,front-back+.39,'timber',x,height+.16,(front+back)/2);
    // Actual solid, two-sided frame in YZ; no alpha plane that disappears when viewed from behind.
    const middle=(front+back)/2, width=front-back-.49, bottom=.13, top=4.81;
    for(const y of [bottom,top,2.42]) box(.105,.10,width,'iron',x,y,middle);
    for(const z of [back+.24,front-.24,middle]) box(.105,top-bottom,.10,'iron',x,(top+bottom)/2,z);
    for(const y of [.19,.95,1.72,2.49,3.26,4.03,4.72]) {
      box(.15,.16,.24,'iron',x,y,back+.28);bolt(x+.09,y,back+.28,'x');
    }
    // Clipped diagonal wires terminate on the frame; opposite directions interlace.
    const zMin=back+.28,zMax=front-.28,yMin=bottom+.04,yMax=top-.04;
    meshPanel(x,zMin,zMax,yMin,yMax);
    // Metal kick plates close the base. Hinge sleeves and the visible bar make it a shut gate.
    box(.085,.42,width-.14,'iron',x,.40,middle);
    box(.16,.095,1.04,'edge',x+.08,2.29,middle);
    box(.13,.24,.17,'iron',x+.16,2.18,middle-.18);
    add(new THREE.TorusGeometry(.075,.016,6,16,Math.PI), 'edge',x+.23,2.29,middle-.18,0,Math.PI/2,0);
    // A diagonal timber buttress returns into the bay behind the limit.
    beam([x-.92,.13,front-.13],[x-.03,2.46,front-.13],.18,.17);
    box(1.3,.12,.46,'iron',x-.49,.049,front-.13);
  });

  function crate(cx,base,cz,w,h,d) {
    // Six fully boarded faces over a dark inset, not an open shell with a missing back.
    box(w-.09,h-.09,d-.09,'dark',cx,base+h/2,cz);
    const step=.245,nx=Math.ceil(w/step),nz=Math.ceil(d/step),px=w/nx,pz=d/nz;
    for(const face of [-1,1]) {
      for(let i=0;i<nx;i++) box(px-.012,h-.06,.067,'wood',cx-w/2+px*(i+.5),base+h/2,cz+face*(d/2-.017));
      for(let i=0;i<nz;i++) box(.067,h-.06,pz-.012,'wood',cx+face*(w/2-.017),base+h/2,cz-d/2+pz*(i+.5));
      for(let i=0;i<nx;i++) box(px-.012,.067,d-.02,'wood',cx-w/2+px*(i+.5),base+(face<0?.016:h-.016),cz);
      // Battens, scarfed diagonal brace and nails on both outer faces.
      for(const y of [base+.115,base+h-.115]) {
        box(w+.018,.16,.08,'timber',cx,y,cz+face*(d/2+.035));
        box(.08,.16,d+.018,'timber',cx+face*(w/2+.035),y,cz);
        for(const dx of [-w/2+.095,w/2-.095]) bolt(cx+dx,y,cz+face*(d/2+.084));
        for(const dz of [-d/2+.095,d/2-.095]) bolt(cx+face*(w/2+.084),y,cz+dz,'x');
      }
      const diagonal=Math.hypot(w-.22,h-.36),angle=-Math.atan2(w-.22,h-.36);
      box(.145,diagonal,.072,'timber',cx,base+h/2,cz+face*(d/2+.076),0,0,angle);
      for(const z of [cz-d*.32,cz+d*.32]) box(w+.014,.065,.13,'timber',cx,base+h+.03,z);
    }
    // Corner iron straps wrap onto the side and bottom, with fasteners in both faces.
    for(const dx of [-1,1])for(const dz of [-1,1]) {
      box(.11,h*.30,.065,'iron',cx+dx*(w/2-.038),base+h*.16,cz+dz*(d/2+.042));
      box(.065,h*.30,.11,'iron',cx+dx*(w/2+.042),base+h*.16,cz+dz*(d/2-.038));
    }
  }
  prop('right-stacked-closed-crates',()=>{
    const x=inner+1.08;
    // Broad bottom row bears the smaller upper boxes; every upper footprint is supported.
    for(const z of [-1.85,.25,1.95]) {
      const depth=z===1.95?1.24:1.94;
      crate(x,-.006,z,1.94,1.35,depth);
    }
    crate(x+.015,1.41,-1.80,1.72,1.16,1.62);
    crate(x+.10,1.41,.28,1.63,1.44,1.54);
    crate(x+.07,2.91,.28,1.29,.85,1.28);
    // No lone crates stranded in the world: a braced store enclosure backs the stack.
    const outside=inner+2.57;
    post(outside,-2.91,5.22);post(outside,2.69,5.22);
    box(.30,.24,5.98,'timber',outside,5.13,-.11);
    for(let i=0;i<20;i++) box(.09,2.42,.268,'timber',outside,1.22,-2.87+i*.285);
    for(const y of [.12,2.39,4.93]) box(.16,.12,5.76,'wood',outside-.055,y,-.11);
    // The stack is inside a locked cage: the high jump never exposes an open
    // route over three low boxes at the authoritative right-hand stop.
    meshPanel(outside-.08,-2.72,2.49,2.45,4.88);
    for(const z of [-2.72,-.11,2.49]) box(.10,2.5,.085,'iron',outside-.08,3.66,z);
    beam([outside-.07,.17,-2.75],[outside-.07,2.29,2.46],.13,.13);
  });

  // Continue both closures towards and past the widest combat camera. Sparse
  // solid bars preserve the fighters' silhouette; capped posts and bolted rails
  // have real backs rather than a cut-off, one-sided fence texture.
  for (const side of [-1, 1]) prop(`${side < 0 ? 'left' : 'right'}-foreground-fence`, () => {
    const x = side < 0 ? -inner - .27 : inner + 2.57;
    const start = side < 0 ? 2.29 : 2.69, end = CLUB_BOUNDARIES.frontZ;
    const count = 8, span = (end - start) / count, top = 4.9;
    for (let i = 0; i <= count; i++) {
      const z = start + span * i;
      // First upright is already part of the original gate/cage.
      if (i) {
        box(.22, top, .24, 'iron', x, top / 2, z);
        box(.42, .10, .45, 'edge', x, .05, z);
        box(.28, .10, .30, 'edge', x, top + .015, z);
        for (const y of [.24, 2.36, 4.66]) bolt(x - side * .126, y, z, 'x');
      }
      if (i === count) continue;
      const center = z + span / 2;
      for (const y of [.18, 2.40, 4.77]) box(.105, .115, span + .06, 'iron', x, y, center);
      for (let bar = 1; bar <= 7; bar++) {
        const barZ = z + span * bar / 8;
        box(.052, 4.58, .052, 'iron', x, 2.49, barZ);
      }
      box(.09, .31, span - .22, 'dark', x, .36, center);
    }
  });

  for(const side of [-1,1]) prop(`${side<0?'left':'right'}-boundary-lantern`,()=>{
    const x=side*(inner+.30),z=-2.75,y=3.56;
    box(.17,.59,.11,'iron',x,y+.21,-3.11);
    rod([x,y+.43,-3.1],[x,y+.43,z],.042,'iron');
    add(new THREE.CylinderGeometry(.18,.21,.51,8),'amber',x,y,z);
    for(const dy of [-.29,.29]) add(new THREE.CylinderGeometry(.25,.25,.085,10),'iron',x,y+dy,z);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;rod([x+Math.cos(a)*.205,y-.25,z+Math.sin(a)*.205],[x+Math.cos(a)*.205,y+.25,z+Math.sin(a)*.205],.014,'iron',6);}
    const light=new THREE.PointLight('#ffc881',5,5.4,2);
    light.name=`${side<0?'left':'right'}-storage-lantern-light`;light.position.set(x,y,z+.18);group.add(light);
  });

  for(const [finish,geometries] of batches) {
    const compatible=geometries.map(item=>item.index?item.toNonIndexed():item);
    const geometry=keep(mergeGeometries(compatible));
    compatible.forEach((item,index)=>{if(item!==geometries[index])item.dispose();});geometries.forEach(item=>item.dispose());
    geometry.computeBoundingBox();
    const mesh=new THREE.Mesh(geometry,materials[finish]);mesh.name=`club-boundaries-${finish}`;
    mesh.castShadow=finish!=='amber';mesh.receiveShadow=finish!=='amber';group.add(mesh);
  }
  group.userData.props=props.map(({name,bounds})=>({name,min:bounds.min.toArray(),max:bounds.max.toArray()}));
  let disposed=false;
  return {group,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const resource of resources)resource.dispose();}};
}
