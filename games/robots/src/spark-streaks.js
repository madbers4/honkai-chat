import * as THREE from 'three';

/** One instanced draw: tapered ballistic streak, white-hot nose and a cooling copper tail. */
export function createSparkStreaks(scene, { positions, tails, colors, sizes, alphas, electrical, heat, capacity }) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.name = 'combat-particles';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, array, size] of [['aHead', positions, 3], ['aTail', tails, 3], ['aColor', colors, 3], ['aSize', sizes, 1], ['aAlpha', alphas, 1]]) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.setAttribute('aElectrical', new THREE.InstancedBufferAttribute(electrical ?? new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heat ?? new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = capacity;
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 }, viewportHeight: { value: 390 } }, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute vec3 aHead; attribute vec3 aTail; attribute vec3 aColor;
      attribute float aSize; attribute float aAlpha; attribute float aElectrical; attribute float aHeat;
      uniform float viewportHeight;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vElectrical; varying float vHeat;
      void main(){
        vec4 head=modelViewMatrix*vec4(aHead,1.0), tail=modelViewMatrix*vec4(aTail,1.0);
        vec2 delta=head.xy-tail.xy; float distance=length(delta);
        vec2 tangent=distance>.0001?delta/distance:vec2(1.0,0.0);
        vec2 normal=vec2(-tangent.y,tangent.x);
        float along=position.x;float perPixel=2.0*max(.1,-head.z)/(projectionMatrix[1][1]*viewportHeight);
        float width=clamp(aSize*.12,.012,.046);
        if(aElectrical>.5)width=max(aSize*.10,perPixel*(aElectrical>1.5?2.25:.42));
        vec4 point=mix(tail,head,along);
        point.xy+=normal*position.y*width*(aElectrical>.5?(.72+.28*sin(along*3.141593)):(.16+.84*along));
        vUv=vec2(along,position.y);vColor=aColor;vAlpha=aAlpha;vElectrical=aElectrical;vHeat=aHeat;
        gl_Position=projectionMatrix*point;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vElectrical; varying float vHeat;
      void main(){
        if(vElectrical>.5){
          float crossSection=exp(-vUv.y*vUv.y*12.0)+exp(-vUv.y*vUv.y*3.0)*.14;
          float nose=1.0-smoothstep(.75,1.0,vUv.x);
          float lengthFade=smoothstep(0.0,.35,vUv.x)*(0.60+nose*.40);
          vec3 copper=vec3(.95,.13,.018),gold=vec3(1.0,.56,.15),white=vec3(.88,.96,1.0);
          vec3 color=mix(copper,gold,smoothstep(.03,.62,vHeat));
          color=mix(color,white,smoothstep(.68,.97,vHeat));
          gl_FragColor=vec4(color*1.65,crossSection*lengthFade*vAlpha);
          return;
        }
        float edge=1.0-smoothstep(.12,1.0,abs(vUv.y));
        float tail=pow(vUv.x,.48);float hot=pow(vUv.x,3.0)*exp(-vUv.y*vUv.y*15.0);
        vec3 cooled=mix(vec3(.62,.085,.014),vColor,smoothstep(.1,.75,vUv.x));
        vec3 color=cooled*1.35+vec3(1.0,.91,.65)*hot*1.55;
        gl_FragColor=vec4(color,edge*tail*vAlpha);
      }`,
  });
  material.userData.glowSource = 'radiance';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'mechanical-spark-streaks'; mesh.frustumCulled = false; mesh.renderOrder = 5;
  scene.add(mesh);
  return { geometry, material, mesh };
}
