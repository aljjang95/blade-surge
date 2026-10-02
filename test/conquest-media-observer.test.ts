import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { classifyMediaCancellations, installConquestMediaObserver } from '../tools/conquest-media-observer.mjs';

test('isolated observer preserves native call results, exceptions, arguments and synthetic event trust', () => {
  const result = runInNewContext(`
    let clock = 0;
    globalThis.performance = { timeOrigin: 100000, now: () => ++clock };
    const calls = [], playResult = Promise.resolve('native'), playError = new Error('native play');
    class Media {
      constructor() { this.src = 'https://local/old.mp3'; this.currentSrc = this.src;
        this.currentTime = 0; this.readyState = 0; this.paused = true; this.ended = false; this.error = null;
        this.listeners = new Map(); }
      addEventListener(kind, listener) { this.listeners.set(kind, listener); }
      play(...args) { calls.push({ name: 'play', receiver: this, args });
        if (args[0] === 'throw') throw playError; return playResult; }
      pause(...args) { calls.push({ name: 'pause', receiver: this, args }); return 17; }
    }
    class Node {
      connect(...args) { calls.push({ name: 'connect', receiver: this, args }); return this; }
      disconnect(...args) { calls.push({ name: 'disconnect', receiver: this, args }); return 23; }
    }
    const node = new Node(), createError = new Error('native source');
    class Context {
      createMediaElementSource(...args) { calls.push({ name: 'create', receiver: this, args });
        if (args[1] === 'throw') throw createError; return node; }
    }
    globalThis.HTMLMediaElement = Media; globalThis.AudioNode = Node; globalThis.AudioContext = Context;
    const install = (${installConquestMediaObserver.toString()}); install();
    const wrappedPlay = Media.prototype.play; install();
    const media = new Media(), context = new Context(), destination = {};
    const samePromise = media.play('original-argument') === playResult;
    const pauseValue = media.pause('pause-argument');
    const sameNode = context.createMediaElementSource(media) === node;
    const connectValue = node.connect(destination) === node;
    media.listeners.get('loadstart')({ isTrusted: false, timeStamp: 8.25 });
    const disconnectValue = node.disconnect();
    let preservedPlayError = false, preservedCreateError = false;
    try { media.play('throw'); } catch (error) { preservedPlayError = error === playError; }
    try { context.createMediaElementSource(media, 'throw'); } catch (error) { preservedCreateError = error === createError; }
    const snapshot = __conquestMedia.snapshot();
    ({ samePromise, pauseValue, sameNode, connectValue, disconnectValue, preservedPlayError, preservedCreateError,
      idempotent: wrappedPlay === Media.prototype.play,
      receiversAndArguments: calls[0].receiver === media && calls[0].args[0] === 'original-argument'
        && calls[1].receiver === media && calls[1].args[0] === 'pause-argument'
        && calls[2].receiver === context && calls[2].args[0] === media
        && calls[3].receiver === node && calls[3].args[0] === destination,
      snapshot })
  `);
  expect(result).toMatchObject({ samePromise: true, pauseValue: 17, sameNode: true, connectValue: true,
    disconnectValue: 23, preservedPlayError: true, preservedCreateError: true, idempotent: true, receiversAndArguments: true });
  expect(result.snapshot.events.filter((e: any) => e.kind === 'loadstart')).toEqual([
    expect.objectContaining({ kind: 'loadstart', isTrusted: false, nativeTimeStamp: 8.25,
      nativeTimeOrigin: 100000, nativeAt: 100008.25, src: 'https://local/old.mp3' }),
  ]);
  expect(result.snapshot.events.filter((e: any) => e.kind === 'play-return')).toHaveLength(1);
  expect(result.snapshot.events.filter((e: any) => e.kind === 'source-created')).toHaveLength(1);
  expect(result.snapshot.events.every((e: any) => e.at > 100000)).toBe(true);
  expect(result.snapshot.droppedEvents).toBe(0);
});

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


function nativeInitiationFixture() {
  const f = fixture(); f.failure.documentId = 1; f.media[0].documentId = 1;
  f.events[0].at = 400; // Actual source creation predates resource initiation.
  f.events.push({ ...f.events[0], kind: 'loadstart', at: 1000, isTrusted: true,
    nativeTimeStamp: 1000, nativeTimeOrigin: 0, nativeAt: 1000 });
  return f;
}
test('delayed creation requires single trusted native initiation in the same observed document without rewriting clocks', () => {
  const f = nativeInitiationFixture(), before = JSON.stringify(f);
  const result = classifyMediaCancellations([f.failure], f.media);
  expect(result.unresolved).toHaveLength(0); expect(result.classified).toHaveLength(1);
  expect(result.classified[0]).toMatchObject({ matchedInstanceId: 1,
    requestStartEvidence: { anchorKind: 'trusted-native-loadstart', createdAt: 400, nativeLoadstartAt: 1000, startDeltaMs: 0, isTrusted: true },
    stoppedInstances: [{ id: 1, createdAt: 400, disconnectedAt: 1701 }] });
  expect(JSON.stringify(f)).toBe(before);
});
for (const [name, change] of Object.entries(cases)) test(`native initiation still rejects existing negative: ${name}`, () => {
  const f = nativeInitiationFixture(); change(f);
  const result = classifyMediaCancellations([f.failure], f.media);
  expect(result.classified).toHaveLength(0); expect(result.unresolved).toHaveLength(1);
});
const nativeNegative: Record<string, (f: ReturnType<typeof nativeInitiationFixture>) => void> = {
  'loadstart absent': f => { f.events.pop(); },
  'synthetic initiation': f => { f.events.at(-1).isTrusted = false; },
  'unknown trust': f => { delete f.events.at(-1).isTrusted; },
  'NaN native time': f => { f.events.at(-1).at = NaN; },
  'wrong native id': f => { f.events.at(-1).id = 9; },
  'wrong native URL': f => { f.events.at(-1).src = 'https://local/other.mp3'; },
  'wrong document': f => { f.media[0].documentId = 2; },
  'unbound document': f => { delete f.failure.documentId; },
  'native before creation': f => { f.events.at(-1).at = 399; },
  'native after abort': f => { f.events.at(-1).at = 2001; },
  'native after playing': f => { f.events.at(-1).at = 1101; },
  'native outside unchanged250ms': f => { Object.assign(f.events.at(-1), { at: 749.999, nativeAt: 749.999, nativeTimeStamp: 749.999 }); },
  'late delivery cannot rescue old native initiation': f => { Object.assign(f.events.at(-1), { nativeAt: 400, nativeTimeStamp: 400 }); },
  'missing native timestamp': f => { delete f.events.at(-1).nativeTimeStamp; },
  'NaN native timestamp': f => { f.events.at(-1).nativeTimeStamp = NaN; },
  'negative native timestamp': f => { f.events.at(-1).nativeTimeStamp = -1; },
  'missing native origin': f => { delete f.events.at(-1).nativeTimeOrigin; },
  'missing native absolute time': f => { delete f.events.at(-1).nativeAt; },
  'inconsistent native clock': f => { f.events.at(-1).nativeTimeStamp = 999; },
  'native event predates source creation': f => { Object.assign(f.events.at(-1), { nativeAt: 399, nativeTimeStamp: 399 }); },
  'native event later than delivery': f => { Object.assign(f.events.at(-1), { nativeAt: 1001, nativeTimeStamp: 1001 }); },
  'repeated initiation': f => { f.events.push({ ...f.events.at(-1) }); },
  'same URL different track initiation': f => { f.events.push({ ...f.events.at(-1), id: 3 }); },
  'multiple source identities': f => { f.events.push({ ...f.events[0], id: 3, at: 500 }); },
  'duplicate source id': f => { f.events.push({ ...f.events[0], at: 500 }); },
  'ambiguous old matching cannot be rescued': f => { f.events.push({ ...f.events[0], id: 3, at: 990 }, { ...f.events[0], id: 4, at: 1010 }); },
};
for (const [name, change] of Object.entries(nativeNegative)) test(`native initiation unresolved: ${name}`, () => {
  const f = nativeInitiationFixture(); change(f);
  const result = classifyMediaCancellations([f.failure], f.media);
  expect(result.classified).toHaveLength(0); expect(result.unresolved).toHaveLength(1);
});
test('native initiation retains exact250ms boundary and rejects overlapping failed requests', () => {
  for (const at of [750, 1250]) {
    const f = nativeInitiationFixture(); Object.assign(f.events.at(-1), { at, nativeAt: at, nativeTimeStamp: at }); f.events[1].at = 1300;
    expect(classifyMediaCancellations([f.failure], f.media).unresolved).toHaveLength(0);
  }
  const f = nativeInitiationFixture(); Object.assign(f.events.at(-1), { at: 1250.001, nativeAt: 1250.001, nativeTimeStamp: 1250.001 }); f.events[1].at = 1300;
  expect(classifyMediaCancellations([f.failure], f.media).unresolved).toHaveLength(1);
  expect(classifyMediaCancellations([f.failure, { ...f.failure }], f.media).unresolved).toHaveLength(2);
});
const replayFailure = new URL('../work/aaa-20261003/replay-ui-clean-a215117/report.json', import.meta.url);
test.skipIf(!existsSync(replayFailure))('preserved replay failure without native initiation stays unresolved', () => {
  const r = JSON.parse(readFileSync(replayFailure, 'utf8'));
  const doc2Failures = r.requestFailures.filter((f: any) => f.documentId === 2);
  const doc2Media = r.media.filter((m: any) => m.documentId === 2);
  expect(classifyMediaCancellations(doc2Failures, doc2Media).unresolved).toHaveLength(1);
  expect(r.status).toBe('fail');
});
