// Convert verified independent GUI originals; never crops a contact sheet.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ENCOUNTER_ART } from '../src/data/encounter-art.js';
const root='work/media-20260913';
const plan=JSON.parse(fs.readFileSync(`${root}/gui-image-plan.json`,'utf8'));
if(plan.status!=='verified'||plan.jobsSaved!==30) throw Error('All three GUI batches must be verified first');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync('public/img/encounters',{recursive:true});
const assets=[],sets=[];
for(const set of plan.sets){
  const manifest=JSON.parse(fs.readFileSync(`${root}/${set.manifest}`,'utf8'));
  if(manifest.status!=='verified'||manifest.independentSingleAssets!==10||manifest.contactSheets!==0) throw Error('Independent originals required');
  sets.push({id:set.id,chatUrl:manifest.chatUrl,route:manifest.route,downloadRoute:manifest.downloadRoute,modelDisplayed:manifest.modelDisplayed,modelDisplayedAfterGeneration:manifest.modelDisplayedAfterGeneration,modelIdentity:manifest.modelIdentity,accountPlanDisplayed:manifest.accountPlanDisplayed,batchRequestCount:manifest.batchRequestCount,repairBatchRequestCount:manifest.repairBatchRequestCount,uiRenderedImageElements:manifest.uiRenderedImageElements,uniqueContentAssets:manifest.uniqueContentAssets,originalPixelSize:'1254x1254'});
  for(const [index,source] of manifest.assets.entries()){
    if(hash(fs.readFileSync(source.path))!==source.sha256||!ENCOUNTER_ART[source.id]) throw Error(`Unverified original ${source.id}`);
    const path=`public${ENCOUNTER_ART[source.id]}`;
    execFileSync('ffmpeg',['-v','error','-y','-i',source.path,'-vf','scale=768:768:flags=lanczos','-c:v','libwebp','-quality','90','-compression_level','6','-frames:v','1',path],{windowsHide:true});
    const bytes=fs.readFileSync(path);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',path],{encoding:'utf8'})).streams[0];
    if(probe.width!==768||probe.height!==768) throw Error(`Wrong output size ${source.id}`);
    assets.push({id:source.id,set:set.id,shot:index+1,path,pixelSize:'768x768',bytes:bytes.length,sha256:hash(bytes),original:{path:source.path,pixelSize:source.pixelSize,bytes:source.bytes,sha256:source.sha256},processing:'Whole independent original resized with Lanczos and WebP quality 90; no crop, reconstruction or collage split.'});
  }
}
if(assets.length!==30||new Set(assets.map(a=>a.sha256)).size!==30||new Set(assets.map(a=>a.original.sha256)).size!==30) throw Error('Duplicate or missing art');
fs.mkdirSync('docs/media',{recursive:true});
fs.writeFileSync('docs/media/encounter-art.json',JSON.stringify({createdAt:new Date().toISOString(),status:'verified',scope:'2D UI portraits only. Animated 3D actor diversity remains a separate deliverable.',sets,assets},null,2)+'\n');
console.log(JSON.stringify({originals:30,uniqueOriginals:30,outputs:30,bytes:assets.reduce((n,a)=>n+a.bytes,0)}));
