// Isolated real WebGL shader/render check. No build, deploy or physical-device claim.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'work/fx-runtime-qa');await mkdir(out,{recursive:true});
const report={started:new Date().toISOString(),status:'running',scope:'Isolated local Chromium WebGL, real asset/FX.prepare/render; synthetic 40-pillar scene, not production gameplay or physical Android performance.',consoleErrors:[],pageErrors:[],checks:[]};
for(const name of ['src/engine/fx.js','public/img/vfx/fire_pillar.webp']) report[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const assert=(v,m)=>{if(!v)throw Error(m);};
let server,browser;
async function setup(THREE,FX,VFX_TEX){
  const checks=[],assert=(v,message)=>{checks.push({name:message,pass:!!v});if(!v)throw Error(message);};
  const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true});
  renderer.setSize(1200,800);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  let contextLosses=0;canvas.addEventListener('webglcontextlost',()=>contextLosses++);
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  const gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL||gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL||gl.RENDERER),version:gl.getParameter(gl.VERSION)};
  gpu.software=/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu.renderer);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x080b16);scene.fog=new THREE.FogExp2(0x080b16,.008);
  const camera=new THREE.PerspectiveCamera(45,1.5,.1,200);camera.position.set(22,32,52);camera.lookAt(0,3,0);
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(10,20,10);scene.add(light);
  const fx=new FX(scene,camera),texture=await new THREE.TextureLoader().loadAsync('/img/vfx/fire_pillar.webp');
  texture.colorSpace=THREE.SRGBColorSpace;VFX_TEX.fire_pillar=texture;
  let textureDisposed=0;texture.addEventListener('dispose',()=>textureDisposed++);
  const textureState={offset:texture.offset.toArray(),wrapT:texture.wrapT,version:texture.version};
  const target=new THREE.WebGLRenderTarget(1200,800,{type:THREE.UnsignedByteType});
  const displayScene=new THREE.Scene(),displayCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const display=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:target.texture,toneMapped:false}));displayScene.add(display);
  const pixels=new Uint8Array(1200*800*4);
  function render(){renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1200,800,pixels);renderer.setRenderTarget(null);renderer.render(displayScene,displayCamera);gl.finish();return new Uint8Array(pixels);}
  const warmStart=performance.now();await fx.prepare(renderer,{},target);const compileMs=performance.now()-warmStart;
  assert(!gl.isContextLost(),'context available after actual compileAsync');
  const baseline=render(),programsAfterWarm=renderer.info.programs.length;
  const groups=[],mats=[],disposals=[];let planeDisposals=0;fx.plane1.addEventListener('dispose',()=>planeDisposals++);
  for(let i=0;i<40;i++){
    const group=fx.firePillar(new THREE.Vector3((i%8-3.5)*5,0,(Math.floor(i/8)-2)*6),{height:5+(i%3),width:2.4,life:1+(i%4)*.4,color:i%2?0xff8844:0xffd080});
    groups.push(group);mats.push(group.children[0].material);disposals[i]=0;mats[i].addEventListener('dispose',()=>disposals[i]++);
    // Stagger authored effect ages without changing the asset or shader parameters.
    fx.items[i].t=(i%4)*.08;
  }
  fx.update(.18);
  assert(fx.items.length===40&&groups.every(g=>g.children.length===2),'40 simultaneous pillars retain 80 crossed planes');
  assert(mats.every(m=>m.uniforms.map.value===texture),'all pillars sample the original texture');
  assert(new Set(mats.map(m=>m.uniforms.uOffset.value)).size===4,'four independent age/UV offsets coexist');
  const frameA=render();
  let lit=0;for(let i=0;i<frameA.length;i+=4)if(Math.abs(frameA[i]-baseline[i])+Math.abs(frameA[i+1]-baseline[i+1])+Math.abs(frameA[i+2]-baseline[i+2])>20)lit++;
  assert(lit>3000,'rendered pillars produce visible pixels against baseline');
  const programsAfterDraw=renderer.info.programs.length;assert(programsAfterDraw===programsAfterWarm,'first pillar draw reuses warmed shader programs');
  const initial={count:fx.items.length,planes:80,litPixels:lit,offsets:[...new Set(mats.map(m=>m.uniforms.uOffset.value))],programsAfterWarm,programsAfterDraw};
  function animate(){
    fx.update(.22);const next=render();let changed=0;for(let i=0;i<next.length;i+=4)if(Math.abs(next[i]-frameA[i])+Math.abs(next[i+1]-frameA[i+1])+Math.abs(next[i+2]-frameA[i+2])>15)changed++;
    assert(changed>1000,'later rendered frame changes with independent scrolling');return {changedPixels:changed};
  }
  function comparison(){
    const oldPosition=camera.position.clone(),oldRotation=camera.quaternion.clone();
    for(const item of fx.items)item.obj.visible=false;
    camera.position.set(0,7,22);camera.lookAt(0,4,0);
    const legacyTexture=texture.clone();legacyTexture.wrapT=THREE.RepeatWrapping;legacyTexture.offset.y=-.64;legacyTexture.needsUpdate=true;
    const legacy=new THREE.MeshBasicMaterial({map:legacyTexture,color:0xffb060,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
    const first=fx._fireMaterial(texture,0xffb060);first.fragmentShader='uniform float uOffset;\n'+THREE.ShaderLib.basic.fragmentShader.replace('#include <map_fragment>',THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )','texture2D( map, vec2( vMapUv.x, fract( vMapUv.y + uOffset ) ) )'));first.uniforms.uOffset.value=-.64;
    const fixed=fx._fireMaterial(texture,0xffb060);fixed.uniforms.uOffset.value=-.64;
    const comparisonGroup=new THREE.Group(),materials=[legacy,first,fixed];
    materials.forEach((m,i)=>{const group=new THREE.Group();group.position.x=(i-1)*6;for(let j=0;j<2;j++){const mesh=new THREE.Mesh(fx.plane1,m);mesh.scale.set(3.5,8,1);mesh.position.y=4;mesh.rotation.y=j*Math.PI/2;group.add(mesh);}comparisonGroup.add(group);});scene.add(comparisonGroup);
    const labels=document.createElement('div');labels.id='comparison-labels';labels.style='position:absolute;top:24px;left:0;width:100%;display:flex;justify-content:space-around;color:#fff;font:20px sans-serif';
    labels.innerHTML='<span>Legacy texture repeat</span><span>Initial uniform wrap</span><span>Anchored flow (fixed)</span>';document.body.append(labels);
    render();
    window.endComparison=()=>{labels.remove();scene.remove(comparisonGroup);materials.forEach(m=>m.dispose());legacyTexture.dispose();camera.position.copy(oldPosition);camera.quaternion.copy(oldRotation);for(const item of fx.items)item.obj.visible=true;};
    return {timeSeconds:.4,offset:-.64,method:'Same original texture, tint, 2 planes and dimensions; legacy repeat / initial fract wrap / fixed anchored traveling UV distortion. Texture clone exists only to reproduce the legacy QA reference.'};
  }
  function finish(){
    fx.update(3);assert(fx.items.length===0&&disposals.every(n=>n===1),'all mixed lifetimes expire and dispose exactly once');
    render();
    const timings=[];for(let i=0;i<40;i++)fx.firePillar(new THREE.Vector3((i%8-3.5)*5,0,(Math.floor(i/8)-2)*6),{life:100});fx.update(.2);
    for(let i=0;i<12;i++){const t=performance.now();fx.update(1/60);render();timings.push(performance.now()-t);}
    fx.clearAll();fx.clearAll();assert(fx.items.length===0&&planeDisposals===0,'clear removes active effects but preserves shared plane');
    assert(textureDisposed===0&&texture.wrapT===textureState.wrapT&&texture.version===textureState.version&&JSON.stringify(texture.offset.toArray())===JSON.stringify(textureState.offset),'shared texture survives draws and clear unchanged');
    fx.firePillar(new THREE.Vector3(),{life:100});fx.dispose();fx.dispose();
    assert(planeDisposals===1&&textureDisposed===0,'idempotent teardown disposes plane but preserves source texture');
    render();assert(!gl.isContextLost()&&contextLosses===0&&gl.getError()===gl.NO_ERROR,'no WebGL error or unexpected context loss');
    const memory={...renderer.info.memory};texture.dispose();target.dispose();display.geometry.dispose();display.material.dispose();renderer.dispose();
    return {checks,contextLosses,memory,frameSyncReadbackMs:{min:Math.min(...timings),max:Math.max(...timings),mean:timings.reduce((a,b)=>a+b,0)/timings.length,samples:timings.length,limitation:'Includes synchronous readPixels, gl.finish, and display pass; not game FPS or mobile performance.'}};
  }
  return {gpu,compileMs,initial,checks,animate,comparison,finish};
}
try{
  await writeFile(path.join(out,'harness.js'),`import * as THREE from 'three';\nimport {FX} from '/src/engine/fx.js';\nimport {VFX_TEX} from '/src/engine/assets.js';\nwindow.qaReady=(${setup.toString()})(THREE,FX,VFX_TEX).then(v=>window.fxQa=v).catch(e=>{window.qaError=String(e.stack||e);throw e;});`);
  await writeFile(path.join(out,'index.html'),'<!doctype html><style>html,body{margin:0;background:#080b16}canvas{display:block}</style><div id="dmg-layer"></div><canvas></canvas><script type="module" src="./harness.js"></script>');
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await server.listen();
  const address=server.httpServer.address();report.url=`http://127.0.0.1:${address.port}/work/fx-runtime-qa/index.html`;
  browser=await chromium.launch();report.browser=browser.version();
  const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('pageerror',e=>report.pageErrors.push(String(e)));
  await page.goto(report.url,{waitUntil:'load',timeout:90000});
  await page.waitForFunction(()=>window.fxQa||window.qaError,null,{timeout:90000});
  const failure=await page.evaluate(()=>window.qaError);assert(!failure,failure);
  Object.assign(report,await page.evaluate(()=>({gpu:window.fxQa.gpu,compileMs:window.fxQa.compileMs,initial:window.fxQa.initial})));
  await page.screenshot({path:path.join(out,'40-pillars-a.png')});
  report.motion=await page.evaluate(()=>window.fxQa.animate());await page.screenshot({path:path.join(out,'40-pillars-b.png')});
  report.comparison=await page.evaluate(()=>window.fxQa.comparison());await page.screenshot({path:path.join(out,'legacy-wrap-fixed-comparison.png')});await page.evaluate(()=>window.endComparison());
  Object.assign(report,await page.evaluate(()=>window.fxQa.finish()));await page.screenshot({path:path.join(out,'after-teardown.png')});
  assert(!report.consoleErrors.length&&!report.pageErrors.length,'Browser reported shader/runtime errors');report.status='pass';
}catch(e){report.status='fail';report.error=String(e.stack||e);process.exitCode=1;}
finally{report.finished=new Date().toISOString();await save();await browser?.close();await server?.close();}
console.log(JSON.stringify(report,null,2));
