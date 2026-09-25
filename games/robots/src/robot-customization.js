import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BODY_COLORS, CORE_COLORS, normalizeCustomization } from '../shared/robot-customization.js';

// Recolour only chromatic blue enamel in the original atlas. Neutral scratches,
// bare metal, normals and packed roughness/metalness remain authored surfaces.
const tintShader = /* glsl */`
#ifdef USE_MAP
  vec3 enamelSource = sampledDiffuseColor.rgb;
  float enamelBlue = enamelSource.b - max(enamelSource.r, enamelSource.g * .82);
  float enamelMask = smoothstep(.025, .115, enamelBlue)
    * (1.0 - smoothstep(.48, .90, metalnessFactor)) * robotPaintEnabled;
  float enamelDetail = clamp(dot(enamelSource, vec3(.2126,.7152,.0722)) / .235, .13, 2.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, robotPaint * enamelDetail, enamelMask);
#endif
`;

function installPaint(material, uniforms) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  const sourceClone = material.clone;
  material.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.robotPaint = uniforms.paint;
    shader.uniforms.robotPaintEnabled = uniforms.enabled;
    shader.fragmentShader = 'uniform vec3 robotPaint;\nuniform float robotPaintEnabled;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + tintShader);
  };
  const key = previousKey();
  material.customProgramCacheKey = () => key + '|original-enamel-v1';
  // Wreck pieces clone the real armour. THREE.Material.clone drops compile hooks;
  // keep the same per-robot paint uniforms on those pieces, not on other robots.
  material.clone = function() {
    const copy = sourceClone.call(this);
    installPaint(copy, uniforms);
    return copy;
  };
  material.needsUpdate = true;
}

function perforationTexture() {
  const n = 128, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const row = Math.floor(y / 16), dx = ((x + (row % 2) * 8) % 16) - 8, dy = (y % 16) - 8;
    const open = dx * dx + dy * dy < 13 && y > 17 && y < 115;
    const i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = open ? 0 : 255; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, n, n); texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 1); texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  return texture;
}

function curlGeometry(sign) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, .035, .025), new THREE.Vector3(sign * .12, .02, .05),
    new THREE.Vector3(sign * .28, -.02, .03), new THREE.Vector3(sign * .40, .06, .015),
    new THREE.Vector3(sign * .41, .15, .015), new THREE.Vector3(sign * .35, .16, .01),
  ]);
  const geometry = new THREE.TubeGeometry(curve, 36, .07, 10, false);
  const position = geometry.attributes.position;
  for (let i = 0; i <= 36; i++) {
    const center = curve.getPointAt(i / 36), taper = Math.pow(1 - i / 36, .60) * .94 + .045;
    for (let j = 0; j <= 10; j++) {
      const index = i * 11 + j, p = new THREE.Vector3().fromBufferAttribute(position, index).sub(center).multiplyScalar(taper).add(center);
      position.setXYZ(index, p.x, p.y, p.z);
    }
  }
  geometry.computeVertexNormals(); return geometry;
}

function makeAccessory(id, envMap) {
  const group = new THREE.Group(); group.name = `RobotAccessory_${id}`;
  const geometries = [], materials = [], textures = [], buckets = new Map();
  const material = (color, metalness = .0, roughness = .55, extra = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, metalness, roughness, envMap, envMapIntensity: .8, ...extra });
    materials.push(value); return value;
  };
  const brass = material('#bc9352', .86, .31), dark = material('#242a31', .28, .53);
  const add = (geometry, mat, position = [0,0,0], rotation = [0,0,0], scale = [1,1,1]) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
    if (geometry.index) { const old = geometry; geometry = old.toNonIndexed(); old.dispose(); }
    if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geometry);
  };
  const ring = (radius, tube, mat, y = 0) => add(new THREE.TorusGeometry(radius, tube, 8, 48), mat, [0,y,0], [Math.PI / 2,0,0]);
  let rotor;
  if (id === 'crown') {
    const velvet = material('#601d34', 0, .93), jewel = material('#b7224d', .25, .19);
    add(new THREE.SphereGeometry(.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), velvet, [0,.015,0], [0,0,0], [1,.60,1]);
    add(new THREE.CylinderGeometry(.36,.33,.105,48,1,true),brass,[0,.07,0]); ring(.345,.022,brass,.02); ring(.363,.018,brass,.12);
    for(let i=0;i<7;i++) {
      const a=i*Math.PI*2/7, shape=new THREE.Shape();
      shape.moveTo(-.15,0);shape.lineTo(0,.24);shape.lineTo(.15,0);shape.closePath();
      add(new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelSize:.01,bevelThickness:.008,bevelSegments:2,steps:1}), brass,[Math.sin(a)*.345,.1,Math.cos(a)*.345],[0,a,0]);
      add(new THREE.SphereGeometry(.029,10,8),brass,[Math.sin(a)*.345,.35,Math.cos(a)*.345]);
      add(new THREE.OctahedronGeometry(.034),jewel,[Math.sin(a)*.37,.087,Math.cos(a)*.37],[0,a,0],[.8,1.05,.4]);
    }
  } else if (id === 'topHat') {
    const felt=material('#1e2938',0,.92),ribbon=material('#893543',.06,.58);
    add(new THREE.CylinderGeometry(.44,.44,.055,64),felt,[0,.025,0],[0,0,0],[1,1,.9]);
    add(new THREE.CylinderGeometry(.315,.285,.47,48),felt,[0,.28,0]);
    add(new THREE.CylinderGeometry(.29,.289,.105,48,1,true),ribbon,[0,.13,0]);
    ring(.311,.008,dark,.517); ring(.437,.01,brass,.045);
    add(new THREE.BoxGeometry(.085,.074,.025),brass,[0,.128,.295]);
    add(new THREE.BoxGeometry(.056,.043,.029),felt,[0,.128,.299]);
  } else if(id==='colander') {
    const texture=perforationTexture();textures.push(texture);
    const steel=material('#a8b4b6',.88,.34), perforated=material('#a8b4b6',.88,.34,{alphaMap:texture,alphaTest:.5,side:THREE.DoubleSide});
    add(new THREE.SphereGeometry(.41,64,28,0,Math.PI*2,0,Math.PI/2),perforated,[0,.01,0],[0,0,0],[1,.74,1]);
    ring(.411,.026,steel,.015);ring(.374,.015,dark,.007);
    for(const sign of[-1,1]) {
      add(new THREE.TorusGeometry(.105,.018,8,28),steel,[sign*.46,.055,0],[Math.PI/2,0,0],[1,1,.8]);
      add(new THREE.SphereGeometry(.028,10,8),brass,[sign*.397,.035,.07]);
    }
    add(new THREE.CylinderGeometry(.06,.055,.018,24),brass,[0,.324,0]);
  } else if(id==='propeller') {
    const red=material('#ca4c46',.32,.37),blue=material('#459eae',.32,.37);
    add(new THREE.CylinderGeometry(.12,.16,.08,32),brass,[0,.035,0]);
    add(new THREE.CylinderGeometry(.027,.036,.27,16),dark,[0,.19,0]);
    ring(.075,.013,brass,.30);
    rotor=new THREE.Group();rotor.name='AccessoryPropeller_Rotor';rotor.position.y=.34;group.add(rotor);
    const blade=new THREE.Shape();blade.moveTo(.015,-.035);blade.bezierCurveTo(.14,-.13,.41,-.10,.46,-.01);blade.bezierCurveTo(.47,.055,.26,.13,.08,.05);blade.closePath();
    for(let i=0;i<2;i++) {
      const geometry=new THREE.ExtrudeGeometry(blade,{depth:.018,bevelEnabled:true,bevelThickness:.006,bevelSize:.012,bevelSegments:2,steps:1,curveSegments:12});
      geometry.rotateX(-Math.PI/2);geometry.rotateY(i*Math.PI);geometries.push(geometry);
      const mesh=new THREE.Mesh(geometry,i?blue:red);mesh.rotation.z=i?-.10:.10;mesh.castShadow=true;rotor.add(mesh);
    }
    const hub=new THREE.SphereGeometry(.075,20,12);geometries.push(hub);const mesh=new THREE.Mesh(hub,brass);mesh.scale.set(1,.7,1);rotor.add(mesh);
  } else if(id==='mustache') {
    const hair=material('#25232b',.02,.80);
    add(curlGeometry(-1),hair);add(curlGeometry(1),hair);
    add(new THREE.BoxGeometry(.065,.065,.022),brass,[0,.055,-.015]);
    add(new THREE.CylinderGeometry(.012,.012,.03,12),brass,[0,.055,.012],[Math.PI/2,0,0]);
  } else if(id==='clubCap') {
    // Low cloth crown and a closed leather visor: nothing hangs over the
    // original signal lenses. Small brass fixtures catch the arena lighting.
    const cloth=material('#19232c',.02,.90),leather=material('#10191f',.12,.49);
    add(new THREE.CylinderGeometry(.405,.43,.175,40),cloth,[0,.145,-.035],[.025,0,0],[1.15,1,.92]);
    add(new THREE.CylinderGeometry(.43,.427,.075,40),leather,[0,.05,-.03],[0,0,0],[1.14,1,.92]);
    add(new THREE.TorusGeometry(.425,.010,6,40),brass,[0,.091,-.03],[Math.PI/2,0,0],[1.14,.92,1]);
    const visor=new THREE.Shape();
    visor.moveTo(-.34,.16);visor.quadraticCurveTo(-.53,.43,-.39,.57);
    visor.quadraticCurveTo(0,.74,.39,.57);visor.quadraticCurveTo(.53,.43,.34,.16);
    visor.quadraticCurveTo(0,.31,-.34,.16);visor.closePath();
    add(new THREE.ExtrudeGeometry(visor,{depth:.027,bevelEnabled:true,bevelSize:.012,bevelThickness:.006,bevelSegments:2,steps:1,curveSegments:14}),leather,[0,.051,0],[Math.PI/2,0,0]);
    // A real raised badge with an inset, rather than an emissive decal.
    add(new THREE.CylinderGeometry(.057,.057,.017,8),brass,[0,.161,.351],[Math.PI/2,0,Math.PI/8],[1,1,1.13]);
    add(new THREE.BoxGeometry(.026,.052,.012),leather,[0,.163,.365]);
    add(new THREE.BoxGeometry(.014,.024,.014),brass,[0,.171,.374]);
    for(const sign of[-1,1]) add(new THREE.SphereGeometry(.014,8,6),brass,[sign*.365,.070,.208]);
    // Four visibly interlinked, alternating oval links sit beside the visor.
    // All stay above the roof; they cannot drape onto the HP/status lenses.
    for(let i=0;i<4;i++) {
      const a=i/3;
      add(new THREE.TorusGeometry(.034,.010,6,18),brass,[.444,.111-.038*Math.sin(a*Math.PI),.12+a*.153],
        [0,i%2?Math.PI/2:0,.24],[.72,1.16,1]);
    }
  } else if(id==='heartBand') {
    const enamel=material('#6d8858',.17,.42),lining=material('#34382c',.03,.86);
    // The small circlet lies on the turret roof, leaving the entire signal
    // face unobstructed. Its back is finished too, including the clasp.
    add(new THREE.TorusGeometry(.405,.022,8,48),brass,[0,.034,0],[Math.PI/2,0,0],[1.08,.92,1]);
    add(new THREE.TorusGeometry(.398,.012,6,40),lining,[0,.012,0],[Math.PI/2,0,0],[1.08,.92,1]);
    add(new THREE.BoxGeometry(.095,.049,.034),brass,[0,.035,-.374]);
    add(new THREE.BoxGeometry(.053,.025,.039),lining,[0,.035,-.378]);
    const heart=new THREE.Shape();
    heart.moveTo(0,0);heart.bezierCurveTo(-.055,.048,-.115,.105,-.085,.152);
    heart.bezierCurveTo(-.062,.188,-.015,.185,0,.146);
    heart.bezierCurveTo(.015,.185,.062,.188,.085,.152);
    heart.bezierCurveTo(.115,.105,.055,.048,0,0);heart.closePath();
    const settings={depth:.019,bevelEnabled:true,bevelSize:.006,bevelThickness:.005,bevelSegments:2,steps:1,curveSegments:10};
    add(new THREE.ExtrudeGeometry(heart,settings),brass,[0,.025,.370]);
    add(new THREE.ExtrudeGeometry(heart,{...settings,depth:.006,bevelSize:.003,bevelThickness:.002}),enamel,[0,.046,.395],[0,0,0],[.64,.64,1]);
    for(const sign of[-1,1]) {
      add(new THREE.SphereGeometry(.028,10,8),brass,[sign*.192,.048,.329],[0,0,0],[1,.72,.56]);
      add(new THREE.OctahedronGeometry(.017),enamel,[sign*.194,.051,.344],[0,0,Math.PI/4],[1,.8,.45]);
    }
  }
  for(const [mat,parts]of buckets) {
    const merged=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());geometries.push(merged);
    const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  let disposed=false;
  return {group,rotor,dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());}};
}

export function createRobotCustomization({ armorMaterials, turret, turretSurface, statusMount }) {
  const uniforms={ paint:{value:new THREE.Color()}, enabled:{value:0} };
  for(const material of armorMaterials)installPaint(material,uniforms);
  const bounds=new THREE.Box3().setFromPoints(turretSurface),center=bounds.getCenter(new THREE.Vector3());
  const accessories=new Map(), mount=new THREE.Group();mount.name='RobotCustomization_Mount';turret.add(mount);
  const envMap=armorMaterials.find(m=>m.envMap)?.envMap;
  let value=normalizeCustomization(),current=null,disposed=false,selectedCore=null;
  function set(input) {
    if(disposed)return value;
    const next=normalizeCustomization(input);
    if(next.core!==value.core)selectedCore=next.core==='original'?null:new THREE.Color(CORE_COLORS.find(x=>x.id===next.core).color).getHex();
    if(next.body!==value.body){uniforms.paint.value.set(BODY_COLORS.find(x=>x.id===next.body).color);uniforms.enabled.value=next.body==='original'?0:1;}
    if(next.accessory!==value.accessory){
      if(current)current.group.visible=false;
      current=null;
      if(next.accessory!=='none'){
        if(!accessories.has(next.accessory)){
          const created=makeAccessory(next.accessory,envMap);accessories.set(next.accessory,created);mount.add(created.group);
          // Mount at the actual lower lens face, not the visor's overhang: the
          // latter is 23cm further forward and would leave floating whiskers.
          if(next.accessory==='mustache')created.group.position.set(statusMount.x,statusMount.y-.25,statusMount.z-.005);
          else created.group.position.set(center.x,bounds.max.y-.022,center.z+.045);
        }
        current=accessories.get(next.accessory);current.group.visible=true;
      }
    }
    value=next;return {...value};
  }
  return {
    set,
    key(){return `${value.body}/${value.core}/${value.accessory}`;},
    coreColor(original){return selectedCore??original;},
    update(player,time){
      mount.visible=player.action!=='destroyed';
      if(current?.rotor)current.rotor.rotation.y=player.visualReducedMotion?Math.PI*.18:time*6;
    },
    dispose(){if(disposed)return;disposed=true;accessories.forEach(x=>x.dispose());accessories.clear();mount.removeFromParent();},
  };
}
