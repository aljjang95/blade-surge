// Verify the exact published artifact bytes through approved release-status traffic.
import fs from 'node:fs';
import crypto from 'node:crypto';
const sha=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(sha||'')) throw Error('Expected full release commit SHA');
const art=JSON.parse(fs.readFileSync('docs/media/encounter-art.json','utf8'));
const music=JSON.parse(fs.readFileSync('docs/media/region-audio.json','utf8'));
const assets=[...art.assets.map(a=>({path:a.path.slice(6),sha256:a.sha256,bytes:a.bytes})),...music.tracks.map(t=>({path:t.output.replaceAll('\\','/').slice(6),sha256:t.encoded.sha256,bytes:Number(t.encoded.format.size)}))];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const report={started:new Date().toISOString(),sha,hosts:[],status:'running'};
fs.mkdirSync('_autopipe/evidence',{recursive:true});
const save=()=>fs.writeFileSync('_autopipe/evidence/region-media-live.json',JSON.stringify(report,null,2));
try{
 for(const origin of ['https://blade.tllhouse.com','https://blade-surge.affinity-agent-studio.workers.dev']){
  const host={origin,assets:[]};report.hosts.push(host);
  const versionResponse=await fetch(`${origin}/version.json?verify=${Date.now()}`,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!versionResponse.ok) throw Error(`${origin} version HTTP ${versionResponse.status}`);
  host.version=await versionResponse.json();
  if(host.version.sha!==sha||host.version.dirty!==false) throw Error('Live version differs from clean release');
  const html=await(await fetch(origin,{cache:'no-store',signal:AbortSignal.timeout(15000)})).text();
  host.entry=html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  if(!host.entry?.startsWith('/assets/')) throw Error('No actual module entry');
  const entry=Buffer.from(await(await fetch(origin+host.entry)).arrayBuffer());
  if(hash(entry)!==hash(fs.readFileSync(`dist${host.entry}`))) throw Error('Live entry differs from built release');
  host.entrySha256=hash(entry);
  for(let i=0;i<assets.length;i+=4){
   const batch=await Promise.all(assets.slice(i,i+4).map(async asset=>{
    const response=await fetch(origin+asset.path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!response.ok) throw Error(`${origin}${asset.path} HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer()),actual=hash(bytes);
    if(actual!==asset.sha256||bytes.length!==asset.bytes) throw Error(`Published file differs: ${asset.path}`);
    return {path:asset.path,bytes:bytes.length,sha256:actual,contentType:response.headers.get('content-type'),status:'pass'};
   }));
   host.assets.push(...batch);save();
  }
  host.status='pass';console.log(`${origin}: clean ${sha.slice(0,8)}, entry matched, ${host.assets.length} media hashes matched`);
 }
 report.status='pass';
}catch(error){report.status='fail';report.error=String(error);process.exitCode=1;console.error(error);}
finally{report.finished=new Date().toISOString();save();}
