// Real game-loader WebGL inspection. Isolated local server, no production state.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const names=process.argv.slice(2);
if(!names.length)throw Error('Supply model names');
const out=path.join(root,'work/encounter-models/preview');await mkdir(out,{recursive:true});
async function inspect(THREE,RoomEnvironment,GLTFExporter,loadModel,spawnCharacter,disposeCharacter,preloadSurfaceTextures,RIGS,rigOf,names){
  await preloadSurfaceTextures();
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(1536,1024);renderer.setScissorTest(true);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  const gpu=gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);
  const result={gpu,software:/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu),models:[]};
  const scene=new THREE.Scene();scene.background=new THREE.Color('#15232d');
  const studio=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.04,.1,100);studio.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe2eeff,0x3c3340,2.1));
  const key=new THREE.DirectionalLight(0xffddb3,3);key.position.set(-3,5,5);scene.add(key);
  const rim=new THREE.DirectionalLight(0x82b4ff,2);rim.position.set(3,2,-4);scene.add(rim);
  const camera=new THREE.PerspectiveCamera(34,1,.01,100);
  const clay=new THREE.MeshStandardMaterial({color:0xbcb5a5,roughness:.9});
  for(const name of names){
    const gltf=await loadModel(name),c=spawnCharacter(gltf),rig=RIGS[rigOf(name)];
    scene.add(c.root);c.root.updateMatrixWorld(true);
    c.root.traverse(o=>{if(o.isMesh&&o.material.userData.tllAuthored){o.material.envMap=environment.texture;o.material.envMapIntensity=.7;}});
    const bones=[],parts=[];
    c.root.traverse(o=>{
      if(o.isBone)bones.push({name:o.name,matrix:o.matrixWorld.toArray(),position:o.getWorldPosition(new THREE.Vector3()).toArray()});
      if(o.isMesh){const box=new THREE.Box3().setFromObject(o);parts.push({name:o.name,min:box.min.toArray(),max:box.max.toArray(),vertices:o.geometry.attributes.position.count,authored:!!o.material.userData.tllAuthored});}
    });
    const viewNames=['front','three-quarter','profile','clay','run','attack'];
    const model={name,bones,parts,clips:Object.keys(c.clips),samples:0,maxSpan:0,views:viewNames};
    // Every original clip, five actual deformed poses. Do not infer validity from names.
    for(const clip of Object.values(c.clips))for(const f of [0,.25,.5,.75,.95]){
      c.mixer.stopAllAction();c.mixer.clipAction(clip).reset().play();c.mixer.update(clip.duration*f);c.root.updateMatrixWorld(true);
      const box=new THREE.Box3();
      c.root.traverse(o=>{if(!o.isSkinnedMesh)return;const n=o.geometry.attributes.position.count;
        for(let i=0;i<n;i+=Math.max(1,Math.floor(n/160))){const p=o.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(o.matrixWorld);if(!p.toArray().every(Number.isFinite))throw Error('Non-finite pose '+name);box.expandByPoint(p);}});
      model.maxSpan=Math.max(model.maxSpan,box.getSize(new THREE.Vector3()).length());model.samples++;
      if(model.maxSpan>18)throw Error('Exploded pose '+name);
    }
    c.mixer.stopAllAction();c.mixer.clipAction(c.clips[rig.idle]).reset().play();c.mixer.update(.15);c.root.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(c.root),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    model.idleBounds={min:box.min.toArray(),max:box.max.toArray()};
    const distance=rigOf(name)==='kaykit'?5.8:rigOf(name)==='flying'?10:8;
    for(let i=0;i<6;i++){
      c.mixer.stopAllAction();const clip=c.clips[i===4?rig.run:i===5?rig.attack:rig.idle];
      c.mixer.clipAction(clip).reset().play();c.mixer.update(clip.duration*(i>3?.4:.15));
      // Assets face +Z in their original rest pose; actor steering is a separate game contract.
      c.root.rotation.y=i===1?-.65:i===2?-Math.PI/2:0;
      const height=rigOf(name)==='kaykit'?1.25:1.5;
      camera.position.set(0,height+.2,distance);camera.lookAt(0,height,0);
      scene.overrideMaterial=i===3?clay:null;
      renderer.setViewport((i%3)*512,i<3?512:0,512,512);renderer.setScissor((i%3)*512,i<3?512:0,512,512);renderer.render(scene,camera);
    }
    scene.overrideMaterial=null;
    model.png=renderer.domElement.toDataURL('image/png');
    c.mixer.stopAllAction();c.mixer.clipAction(c.clips[rig.idle]).reset().play();c.mixer.update(.15);c.root.rotation.y=0;
    const faceY=rigOf(name)==='kaykit'?1.72:rigOf(name)==='flying'?2.53:2.20;
    camera.position.set(0,faceY,rigOf(name)==='kaykit'?1.75:2.7);camera.lookAt(0,faceY,0);
    renderer.setSize(512,512);renderer.setViewport(0,0,512,512);renderer.setScissor(0,0,512,512);renderer.render(scene,camera);
    model.facePng=renderer.domElement.toDataURL('image/png');renderer.setSize(1536,1024);
    if(gltf.scene.userData.encounterIdentity){
      c.mixer.stopAllAction();c.root.rotation.y=0;c.root.updateMatrixWorld(true);
      const buffer=await new GLTFExporter().parseAsync(c.root,{binary:true,animations:gltf.animations});
      const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));model.glb=btoa(text);
    }
    result.models.push(model);disposeCharacter(c.root,c.mixer);
  }
  environment.dispose();clay.dispose();renderer.dispose();return result;
}
let server,browser;
try{
  await writeFile(path.join(out,'harness.js'),`import * as THREE from 'three';\nimport {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';\nimport {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';\nimport {loadModel,spawnCharacter,disposeCharacter} from '/src/engine/assets.js';\nimport {preloadSurfaceTextures} from '/src/engine/surface-textures.js';\nimport {RIGS,rigOf} from '/src/data/rigs.js';\n(${inspect.toString()})(THREE,RoomEnvironment,GLTFExporter,loadModel,spawnCharacter,disposeCharacter,preloadSurfaceTextures,RIGS,rigOf,${JSON.stringify(names)}).then(r=>window.result=r).catch(e=>window.failure=String(e.stack||e));`);
  await writeFile(path.join(out,'index.html'),'<style>body{margin:0}canvas{display:block}</style><script type="module" src="./harness.js"></script>');
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1536,height:1024}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/work/encounter-models/preview/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.result||window.failure,null,{timeout:240000});
  const failure=await page.evaluate(()=>window.failure);if(failure)throw Error(failure);
  const result=await page.evaluate(()=>window.result);result.errors=errors;
  for(const model of result.models){
    await writeFile(path.join(out,model.name+'.png'),Buffer.from(model.png.split(',')[1],'base64'));delete model.png;
    await writeFile(path.join(out,model.name+'-face.png'),Buffer.from(model.facePng.split(',')[1],'base64'));delete model.facePng;
    if(model.glb){await writeFile(path.join(out,model.name+'-assembled.glb'),Buffer.from(model.glb,'base64'));delete model.glb;}
  }
  await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));
  await writeFile(path.join(out,`report-${names.length}models.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify({gpu:result.gpu,models:result.models.map(m=>({name:m.name,samples:m.samples,maxSpan:m.maxSpan,parts:m.parts.length})),errors}));
  if(errors.length)process.exitCode=1;
}finally{await browser?.close();await server?.close();}
