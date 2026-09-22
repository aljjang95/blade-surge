import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const checks=[];function check(name,passed,details={}){checks.push({name,passed,...details});if(!passed)throw new Error(name);}
const cli=path.join(root,'tools/studio/blender-pipeline.mjs');
const run=(args,env={})=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,...env}});
check('unknown_action_rejected',run(['publish']).status!==0);
check('outside_art_source_rejected',run(['export','package.json']).status!==0);
check('missing_source_rejected',run(['export','art/missing.blend']).status!==0);
check('missing_blender_fails_closed',run(['doctor'],{BLENDER_BIN:path.join(dir,'missing-blender.exe')}).status!==0);
const bad=path.join(root,'work/studio/invalid-request.json');fs.writeFileSync(bad,JSON.stringify({action:'doctor',shell:'not supported'}));
check('unexpected_request_field_rejected',run(['--request',bad]).status!==0);
const receipt=JSON.parse(fs.readFileSync(path.join(root,'work/studio/last-export.json'),'utf8'));
const load=async f=>{const b=fs.readFileSync(f);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
function points(gltf){const values=[];gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.getAttribute('position'),v=new THREE.Vector3();for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);values.push([v.x,v.y,v.z].map(x=>Math.round(x*100000)).join(','));}});return values.sort();}
const before=points(await load(path.join(root,'public/models/frost-armor-v1/knight-rime.glb')));
const after=points(await load(receipt.output));
check('export_vertex_count_preserved',before.length===after.length,{vertices:after.length});
check('bind_pose_geometry_preserved_1e5',JSON.stringify(before)===JSON.stringify(after));
check('blender_reimport_and_hash_passed',receipt.passed&&receipt.validation.reimport_verified&&receipt.validation.source_unchanged);
const result={passed:true,checks,scope:'CLI rejection paths and actual saved Blender-to-GLB round trip; not a game rendering or device test'};
fs.writeFileSync(path.join(root,'work/studio/adapter-tests.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
