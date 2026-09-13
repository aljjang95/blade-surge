import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { classifyMediaCancellations } from '../tools/conquest-media-observer.mjs';

function fixture() {
  const failure:any={engine:'chromium',url:'https://local/old.mp3',at:1000,responseAt:1050,failedAt:2000,type:'media',status:206,error:'net::ERR_ABORTED',range:'bytes=0-',contentRange:'bytes 0-999/1000'};
  const base={id:1,src:failure.url,readyState:4,currentTime:.5,paused:false,connected:true,error:null,collected:false};
  const events:any[]=[{...base,kind:'source-created',at:990,currentTime:0,connected:false},
    {...base,kind:'playing',at:1100,currentTime:0},
    {...base,kind:'pause-return',at:1700,paused:true},
    {...base,kind:'source-disconnect',at:1701,paused:true,connected:false,argumentCount:0,connectionAmbiguous:false},
    {...base,id:2,src:'https://local/new.mp3',kind:'source-created',at:1500,currentTime:0,connected:false},
    {...base,id:2,src:'https://local/new.mp3',kind:'playing',at:1550,currentTime:0}];
  const media:any=[{engine:'chromium',snapshot:{at:2100,droppedEvents:0,events,tracks:[{...base,paused:true,connected:false},{...base,id:2,src:'https://local/new.mp3'}]}}];
  return {failure,media,events};
}
test('binds stopped instance and independently played replacement without mutating input',()=>{
  const {failure,media}=fixture(),before=JSON.stringify({failure,media});
  const result=classifyMediaCancellations([failure],media);
  expect(result.unresolved).toHaveLength(0);expect(result.classified).toHaveLength(1);
  expect(result.classified[0]).toMatchObject({matchedInstanceId:1,stoppedInstances:[{id:1,createdAt:990,disconnectedAt:1701}],replacement:{id:2,currentTime:.5}});
  expect(JSON.stringify({failure,media})).toBe(before);
});
const cases:Record<string,(f:ReturnType<typeof fixture>)=>void>={
  'HTTP404':f=>{f.failure.status=404;},
  'missing range evidence':f=>{delete f.failure.contentRange;},
  'mismatched range':f=>{f.failure.range='bytes=100-';},
  'multipart range':f=>{f.failure.range='bytes=0-10,20-30';},
  'other network error':f=>{f.failure.error='net::ERR_CONNECTION_RESET';},
  'not media':f=>{f.failure.type='fetch';},
  'response after failure':f=>{f.failure.responseAt=2001;},
  'response before request':f=>{f.failure.responseAt=999;},
  'start does not match instance':f=>{f.failure.at=1300;f.failure.responseAt=1350;},
  'unplayed':f=>{f.events.splice(1,1);},
  'insufficient playback':f=>{f.events[3].currentTime=.01;},
  'missing disconnect':f=>{f.events.splice(3,1);},
  'disconnect after abort':f=>{f.events[3].at=2001;},
  'not paused':f=>{f.events[3].paused=false;},
  'still connected':f=>{f.events[3].connected=true;},
  'reconnected current instance':f=>{f.events.push({...f.events[1],kind:'source-connect',at:1900});},
  'another sameURL active instance':f=>{f.events.push({...f.events[0],id:3,at:1800});},
  'ambiguous initial instances':f=>{f.events.push({...f.events[0],id:3,at:1010});},
  'partial disconnect':f=>{f.events[3].argumentCount=1;f.events[3].connectionAmbiguous=true;},
  'dropped history':f=>{f.media[0].snapshot.droppedEvents=1;},
  'media error':f=>{f.events.push({...f.events[1],kind:'error',error:3,at:1800});},
  'no replacement progress':f=>{f.media[0].snapshot.tracks[1].currentTime=0;},
  'replacement stopped':f=>{f.media[0].snapshot.tracks[1].paused=true;},
  'wrong context':f=>{f.media[0].engine='firefox';},
  'snapshot predates failure':f=>{f.media[0].snapshot.at=1900;},
};
for(const [name,change] of Object.entries(cases))test(`unresolved: ${name}`,()=>{
  const f=fixture();change(f);const result=classifyMediaCancellations([f.failure],f.media);
  expect(result.classified).toHaveLength(0);expect(result.unresolved).toHaveLength(1);
});
test('copied failures and overlapping sameURL range requests remain ambiguous',()=>{
  for(const range of ['bytes=0-','bytes=100-']){
    const f=fixture(),result=classifyMediaCancellations([f.failure,{...f.failure,range}],f.media);
    expect(result.classified).toHaveLength(0);expect(result.unresolved).toHaveLength(2);
  }
});
test('missing observation is unresolved',()=>{expect(classifyMediaCancellations([fixture().failure],[]).unresolved).toHaveLength(1);});
const diagnosticPath=new URL('../work/conquest-qa-media-observed/report.json',import.meta.url);
test.skipIf(!existsSync(diagnosticPath))('preserved exploratory diagnostics correlate two cancellations; not release evidence',()=>{
  const report=JSON.parse(readFileSync(diagnosticPath,'utf8'));
  const result=classifyMediaCancellations(report.requestFailures,report.media);
  expect(result.classified).toHaveLength(2);expect(result.unresolved).toHaveLength(0);
  expect(result.classified.map(r=>r.stoppedInstances.map(s=>s.id))).toEqual([[8],[3,6,9]]);
});
