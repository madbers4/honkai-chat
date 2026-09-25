import * as THREE from 'three';
import { loadRobotAssets, createRobot } from './robot.js';
import { createEmissionGlow } from './emission-glow.js';
import { GRAPHICS_PRESETS, graphicsPreset, graphicsPixelRatio, readGraphicsPreference, observeGraphicsPreference } from './graphics-quality.js';

export function frameCustomizationPreview(camera,width,height) {
  const aspect=Math.max(1,width)/Math.max(1,height);
  // The front toes project much closer than the head. Reserve real perspective
  // depth plus room for the controls and tallest trophy, including full turns.
  camera.aspect=aspect;const distance=Math.max(8.2,7.0/aspect);
  camera.position.set(0,3.65,distance);camera.lookAt(0,1.15,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}

// The workshop uses the arena's real rig/materials. It owns its WebGL resources
// and renders only while visible, so opening two menus cannot leak animation loops.
export function createCustomizationPreview(host, { value, reducedMotion, quality = readGraphicsPreference() }) {
  let graphicsMode=graphicsPreset(quality); quality=GRAPHICS_PRESETS[graphicsMode].effects;
  let disposed=false,robot,renderer,glow,keyLight,frame=0,last=0,elapsed=0,visible=true,intersecting=true,enabled=true,interactive=true,yaw=-.74,drag;
  const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced=()=>typeof reducedMotion==='boolean'?reducedMotion:Boolean(media?.matches);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#19272d');
  const camera=new THREE.PerspectiveCamera(35,1,.05,40);
  const stage=new THREE.Group();scene.add(stage);
  const resources=[];
  const status=document.createElement('span');status.className='customization-preview-status';status.setAttribute('role','status');status.textContent='Механик готовит машину…';host.append(status);
  const error=()=>{status.hidden=false;status.textContent='Модель не загрузилась. Внешность всё равно можно выбрать.';};
  const resize=()=>{
    if(!renderer||disposed)return;
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    const ratio=graphicsPixelRatio({width,height,dpr:globalThis.devicePixelRatio,preset:graphicsMode,maxTextureSize:renderer.capabilities.maxTextureSize});
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);glow.resize(width,height,ratio);
    frameCustomizationPreview(camera,width,height);
  };
  const render=now=>{
    frame=0;if(disposed||!visible||!robot)return;
    const dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;elapsed+=dt;
    robot.group.rotation.y=yaw;
    robot.update({action:'idle',actionTime:elapsed,facing:1,x:0,y:0,hp:180,maxHp:180,energy:100,guard:100,
      customization:value(),visualReducedMotion:reduced(),visualQuality:quality},dt,elapsed);
    glow.setReducedMotion(reduced());glow.render(scene,camera);
    frame=requestAnimationFrame(render);
  };
  const wake=()=>{if(!disposed&&visible&&robot&&!frame){last=0;frame=requestAnimationFrame(render);}};
  const observer=new ResizeObserver(resize);observer.observe(host);
  const stopWatchingGraphics=observeGraphicsPreference(mode=>{
    graphicsMode=graphicsPreset(mode);quality=GRAPHICS_PRESETS[graphicsMode].effects;
    if(renderer){renderer.shadowMap.enabled=quality!=='low';renderer.shadowMap.needsUpdate=true;}
    if(keyLight)keyLight.castShadow=quality!=='low';
    glow?.setQuality(quality);resize();
  });
  const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    intersecting=Boolean(entries[0]?.isIntersecting);visibility();
  }):null;intersection?.observe(host);
  const visibility=()=>{visible=enabled&&intersecting&&!document.hidden&&host.isConnected;if(!visible){cancelAnimationFrame(frame);frame=0;}else wake();};
  document.addEventListener('visibilitychange',visibility);
  function pointerDown(event){if(!interactive||event.button!==0)return;drag={x:event.clientX,yaw};host.setPointerCapture?.(event.pointerId);}
  function pointerMove(event){if(!drag)return;yaw=drag.yaw+(event.clientX-drag.x)*.012;}
  function pointerUp(){drag=null;}
  host.addEventListener('pointerdown',pointerDown);host.addEventListener('pointermove',pointerMove);host.addEventListener('pointerup',pointerUp);host.addEventListener('pointercancel',pointerUp);
  loadRobotAssets().then(()=>{
    if(disposed)return;
    try {
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
      renderer.shadowMap.enabled=quality!=='low';renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Трёхмерная модель вашего робота');renderer.domElement.className='customization-preview-canvas';host.prepend(renderer.domElement);
      glow=createEmissionGlow(renderer);glow.setQuality(quality);
      scene.add(new THREE.HemisphereLight('#def6ff','#756650',2.2));
      const key=keyLight=new THREE.DirectionalLight('#ffe3b9',3.3);key.position.set(-3,6,5);key.castShadow=quality!=='low';key.shadow.mapSize.set(1024,1024);
      Object.assign(key.shadow.camera,{left:-3,right:3,top:4,bottom:-3,near:.5,far:18});key.shadow.bias=-.001;key.shadow.normalBias=.025;scene.add(key);
      const rim=new THREE.DirectionalLight('#83cde3',2.6);rim.position.set(3,4,-3);scene.add(rim);
      const fill=new THREE.DirectionalLight('#d4e9ff',1.0);fill.position.set(4,2,4);scene.add(fill);
      resources.push(key,rim,fill);
      const geo=new THREE.CylinderGeometry(2.10,2.14,.14,80),mat=new THREE.MeshStandardMaterial({color:'#46514f',roughness:.7,metalness:.34});
      const plinth=new THREE.Mesh(geo,mat);plinth.position.y=-.075;plinth.receiveShadow=true;stage.add(plinth);resources.push(geo,mat);
      const ringGeo=new THREE.TorusGeometry(2.10,.017,6,100),ringMat=new THREE.MeshStandardMaterial({color:'#c7a266',roughness:.44,metalness:.7});
      const ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=Math.PI/2;ring.position.y=-.012;stage.add(ring);resources.push(ringGeo,ringMat);
      const floorGeo=new THREE.PlaneGeometry(200,200),floorMat=new THREE.MeshStandardMaterial({color:'#253438',roughness:.9});
      const floor=new THREE.Mesh(floorGeo,floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.15;floor.receiveShadow=true;stage.add(floor);resources.push(floorGeo,floorMat);
      robot=createRobot();scene.add(robot.group);status.hidden=true;resize();wake();
    }catch(cause){console.warn('Robot workshop preview unavailable.',cause);error();}
  }).catch(error);
  return {
    rotate(direction){if(interactive)yaw+=direction*.35;},
    setEnabled(value){interactive=Boolean(value);if(!interactive)drag=null;},
    setVisible(value){enabled=Boolean(value);visibility();},
    dispose(){
      if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();stopWatchingGraphics();intersection?.disconnect();document.removeEventListener('visibilitychange',visibility);
      host.removeEventListener('pointerdown',pointerDown);host.removeEventListener('pointermove',pointerMove);host.removeEventListener('pointerup',pointerUp);host.removeEventListener('pointercancel',pointerUp);
      robot?.dispose();glow?.dispose();resources.forEach(item=>item.dispose());renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();status.remove();
    },
  };
}
