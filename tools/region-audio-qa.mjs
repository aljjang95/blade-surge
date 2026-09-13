// Actual local media playback through production AudioSys; no audible-review claim.
import {chromium,firefox,webkit} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/region-audio-qa');
await mkdir(out,{recursive:true});
const cues=['lobby','garden','forge','frost','tide','crown','homecoming','arena','boss'];
const report={started:new Date().toISOString(),status:'running',scope:'Real local files through production AudioSys, media currentTime and Web Audio analyser. No synthetic audio, no human listening or physical-device certification.',assets:[],engines:[]};
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
for(const cue of cues){const bytes=await readFile(path.join(root,`public/bgm/regions/${cue}.mp3`));report.assets.push({cue,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
function harness(AudioSys,musicForScene,MUSIC_MIX){
 const sound=new AudioSys(),mediaErrors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let analyser,data;
 const peak=()=>{analyser.getFloatTimeDomainData(data);let max=0;for(const x of data)max=Math.max(max,Math.abs(x));return max;};
 document.querySelector('button').onclick=async()=>{
  try{const loading=sound.init();sound.resume();await loading;
   if(!sound.ctx)throw Error('AudioContext unavailable');
   analyser=sound.ctx.createAnalyser();analyser.fftSize=2048;data=new Float32Array(analyser.fftSize);
   const sink=sound.ctx.createGain();sink.gain.value=0;sound.musicDuckGain.connect(analyser);analyser.connect(sink);sink.connect(sound.ctx.destination);
   window.audioQaReady=true;document.querySelector('#status').textContent='AudioContext: '+sound.ctx.state;
  }catch(e){window.audioQaError=String(e)+'\n'+(e.stack||'');}
 };
 function play(name){sound.playMusic(name,MUSIC_MIX);const el=sound.music?.el;if(el)el.addEventListener('error',()=>mediaErrors.push({name,code:el.error?.code,message:el.error?.message}));}
 async function measure(name,reuse=false){
  if(!reuse)play(name);const el=sound.music?.el;if(!el)throw Error('Missing media element: '+name);
  // Exclude the previous cue's fading tail from this file's analyser evidence.
  await wait(MUSIC_MIX.fade*1000+150);
  const start=el.currentTime,started=performance.now();let maxPeak=0;
  while(performance.now()-started<10000){await wait(100);maxPeak=Math.max(maxPeak,peak());if(el.error)throw Error(`${name}: media error ${el.error.code} ${el.error.message}`);if(el.currentTime-start>.5&&maxPeak>1e-5)break;}
  return {name,url:el.currentSrc||el.src,startTime:start,endTime:el.currentTime,advancedSeconds:el.currentTime-start,maxPeak,duration:el.duration,paused:el.paused,readyState:el.readyState,contextState:sound.ctx.state,mediaError:el.error?{code:el.error.code,message:el.error.message}:null};
 }
 async function transitions(){
  const sceneCases=[{input:{scene:'lobby'},expected:'regions/lobby'},{input:{stage:{ch:6,chapter:{theme:'garden'}}},expected:'regions/homecoming'},{input:{stage:{chapter:{theme:'forge'}},boss:true},expected:'regions/boss'},{input:{stage:{expedition:{kind:'arena'}},boss:true},expected:'regions/arena'}];
  const routes=sceneCases.map(c=>({...c,actual:musicForScene(c.input)}));
  const trackCounts=[];for(const c of routes){play(c.actual);trackCounts.push(sound._musicTracks.size);}
  await wait(1000);const afterFade=sound._musicTracks.size;
  const prior=[...sound._musicTracks];sound.setMusicOn(false);await wait(150);
  const muted={tracks:sound._musicTracks.size,gain:sound.musicGain.gain.value,allPaused:prior.every(t=>t.el.paused),peak:peak()};
  sound.playMusic(musicForScene({stage:{chapter:{theme:'forge'}},boss:true}),MUSIC_MIX);
  sound.playMusic(musicForScene({stage:{expedition:{kind:'arena'}},boss:true}),MUSIC_MIX);
  sound.setMusicOn(true);const resumed=await measure('regions/arena',true);
  sound.setMusicOn(false);await wait(150);const stopped={tracks:sound._musicTracks.size,peak:peak()};
  return {routes,trackCounts,afterFade,muted,resumed,stopped,mediaErrors};
 }
 window.audioQa={measure,transitions,close:async()=>{sound.setMusicOn(false);await sound.ctx?.close();}};
}
let server;
try{
 await writeFile(path.join(out,'harness.js'),`import {AudioSys} from '/src/engine/audio.js';\nimport {musicForScene,MUSIC_MIX} from '/src/data/music.js';\n(${harness.toString()})(AudioSys,musicForScene,MUSIC_MIX);`);
 await writeFile(path.join(out,'index.html'),'<!doctype html><style>body{background:#111827;color:white;font:20px sans-serif;padding:32px}button{font:inherit;padding:20px}</style><h1>Region audio runtime QA</h1><button>Start AudioContext</button><p id="status">Waiting for user gesture</p><script type="module" src="./harness.js"></script>');
 server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 report.url=`http://127.0.0.1:${server.httpServer.address().port}/work/region-audio-qa/index.html`;
 for(const [name,launcher] of Object.entries({chromium,firefox,webkit})){
  const result={name,status:'running',files:[],consoleErrors:[],pageErrors:[]};report.engines.push(result);await save();let browser;
  try{
   browser=await launcher.launch();result.version=browser.version();const page=await browser.newPage();
   page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});page.on('pageerror',e=>result.pageErrors.push(String(e)));
   await page.goto(report.url,{waitUntil:'load',timeout:60000});
   result.capabilities=await page.evaluate(()=>({audioContext:typeof window.AudioContext,webkitAudioContext:typeof window.webkitAudioContext,mp3:document.createElement('audio').canPlayType('audio/mpeg'),userAgent:navigator.userAgent}));
   await page.locator('button').click();
   await page.waitForFunction(()=>window.audioQaReady||window.audioQaError,null,{timeout:30000});
   const startError=await page.evaluate(()=>window.audioQaError);if(startError)throw Error(startError);
   for(const cue of cues){const file=await page.evaluate(name=>window.audioQa.measure(name),`regions/${cue}`);result.files.push(file);await save();if(file.advancedSeconds<=.5||file.maxPeak<=1e-5||file.mediaError||file.contextState!=='running')throw Error('Playback measurement failed: '+JSON.stringify(file));}
   result.transitions=await page.evaluate(()=>window.audioQa.transitions());const t=result.transitions;
   // AudioParam.value can remain stale once Chromium disconnects all sources;
   // zero live tracks, paused elements and zero measured bus signal prove mute.
   if(t.routes.some(r=>r.actual!==r.expected)||Math.max(...t.trackCounts)>2||t.afterFade!==1||t.muted.tracks!==0||!t.muted.allPaused||t.muted.peak>1e-6||t.resumed.name!=='regions/arena'||!t.resumed.url.endsWith('/regions/arena.mp3')||t.resumed.advancedSeconds<=.5||t.resumed.maxPeak<=1e-5||t.stopped.tracks!==0||t.stopped.peak>1e-6||t.mediaErrors.length)throw Error('Transition contract failed: '+JSON.stringify(t));
   await page.screenshot({path:path.join(out,`${name}-context.png`)});await page.evaluate(()=>window.audioQa.close());
   if(result.consoleErrors.length||result.pageErrors.length)throw Error('Browser runtime errors');result.status='pass';
  }catch(e){result.status=result.capabilities?.audioContext==='undefined'&&result.capabilities?.webkitAudioContext==='undefined'?'unsupported':'fail';result.error=String(e.stack||e);}
  finally{await browser?.close();await save();console.log(`${name}: ${result.status}, measured ${result.files.length}/9 files`);}
 }
 report.status=report.engines.every(e=>e.status==='pass')?'pass':'fail';if(report.status!=='pass')process.exitCode=1;
}catch(e){report.status='fail';report.error=String(e.stack||e);process.exitCode=1;}
finally{report.finished=new Date().toISOString();await server?.close();await save();}
console.log(JSON.stringify({status:report.status,engines:report.engines.map(e=>({name:e.name,status:e.status,error:e.error})),report:path.join(out,'report.json')},null,2));
