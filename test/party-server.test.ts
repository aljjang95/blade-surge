import { describe, expect, test } from 'bun:test';
import { PartyState } from '../worker/party-state';
import { handlePartyRequest, PartyRoom } from '../worker/party';
import { PARTY_LIMITS, sanitizePartyName, validPartySnapshot } from '../src/party/protocol.js';

const now = 100000;
function lobby() {
  let serial = 0;
  const room = new PartyState('A'.repeat(20), 'host-secret', now + PARTY_LIMITS.ttlMs, () => `member-${++serial}`);
  const host = room.join('대표<script>', 'knight', 'host-secret', now).id;
  const guest = room.join('동료', 'ranger', null, now).id;
  return { room, host, guest };
}
const send = (room: PartyState, id: string, data: unknown, time = now) => room.receive(id, JSON.stringify(data), time);
function running() {
  const x = lobby();
  send(x.room, x.host, { type: 'stage', stageIdx: 2 });
  for (const id of [x.host, x.guest]) send(x.room, id, { type: 'ready', ready: true });
  send(x.room, x.host, { type: 'start', stageIdx: 2, seed: 35 });
  return x;
}
function snapshot(room: PartyState, tick = 1) {
  return { tick, elapsed: tick / 10, players: [...room.members.values()].map(p => ({ id: p.id,
    heroId: p.heroId, x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, state: 'idle', anim: 'Idle', ult: 0, cds: [0,0,0,0] })),
    enemies: [], rooms: [{ id: 0, discovered: true, cleared: false, activated: true }], roomsCleared: 0,
    bossDefeated: false, portal: null, events: [] };
}
describe('party state membership and lifecycle', () => {
  test('server-issued id and host ticket; fake ticket cannot become host', () => {
    const {room, host} = lobby();
    expect(host).toBe('member-1');
    expect(() => room.join('fake', 'mage', 'forged', now)).toThrow('ticket');
    expect(() => room.join('clone', 'mage', 'host-secret', now)).toThrow('host-connected');
    expect(room.hostId).toBe(host);
    expect(sanitizePartyName('\u202E<script>대표님🐉')).toBe('script대표님');
  });
  test('four members maximum and hero allowlist', () => {
    const {room} = lobby();
    expect(() => room.join('bad', 'admin', null, now)).toThrow('hero');
    room.join('3', 'mage', null, now); room.join('4', 'rogue', null, now);
    expect(() => room.join('5', 'barbarian', null, now)).toThrow('full');
  });
  test('solo and unready parties cannot start', () => {
    const {room,host,guest} = lobby();
    expect(() => send(room, guest, {type:'start',stageIdx:1,seed:1})).toThrow('host-only');
    expect(() => send(room, host, {type:'start',stageIdx:1,seed:1})).toThrow('not-ready');
    room.disconnect(guest); send(room,host,{type:'ready',ready:true});
    expect(() => send(room,host,{type:'start',stageIdx:1,seed:1})).toThrow('not-ready');
  });
  test('start is immutable and rejects mid-run arrivals', () => {
    const {room,host} = running();
    expect(room.status).toBe('running'); expect(room.run?.seed).toBe(35);
    expect(() => send(room,host,{type:'start',stageIdx:3,seed:99})).toThrow('state');
    expect(() => room.join('late','mage',null,now)).toThrow('already-started');
    expect(room.run?.seed).toBe(35);
  });
  test('start accepts only the sixty one-based stage ids', () => {
    const {room,host,guest}=lobby();
    send(room,host,{type:'stage',stageIdx:60});
    for (const id of [host,guest]) send(room,id,{type:'ready',ready:true});
    for (const stageIdx of [0,61]) expect(() => send(room,host,{type:'start',stageIdx,seed:1})).toThrow('start-schema');
    expect(room.status).toBe('lobby');
    send(room,host,{type:'start',stageIdx:60,seed:1}); expect(room.run?.stageIdx).toBe(60);
  });
  test('host selection broadcasts the stage and resets readiness', () => {
    const {room,host,guest}=lobby();
    expect(room.view().stageIdx).toBe(1);
    for (const id of [host,guest]) send(room,id,{type:'ready',ready:true});
    const effect=send(room,host,{type:'stage',stageIdx:60})[0];
    expect(effect.to).toBeUndefined();
    expect(effect.message).toMatchObject({type:'party',party:{stageIdx:60,status:'lobby'}});
    expect([...room.members.values()].every(p=>!p.ready)).toBe(true);
    expect(() => send(room,host,{type:'start',stageIdx:60,seed:1})).toThrow('not-ready');
    for (const id of [host,guest]) send(room,id,{type:'ready',ready:true});
    expect(() => send(room,host,{type:'start',stageIdx:1,seed:1})).toThrow('stage-mismatch');
    send(room,host,{type:'start',stageIdx:60,seed:1}); expect(room.run?.stageIdx).toBe(60);
  });
  test('guest, invalid stage and mid-run stage changes cannot alter the selection', () => {
    const {room,host,guest}=lobby();
    expect(() => send(room,guest,{type:'stage',stageIdx:60})).toThrow('host-only');
    for(const stageIdx of [0,61,1.5,'2',null]) expect(() => send(room,host,{type:'stage',stageIdx})).toThrow('stage-schema');
    expect(room.view().stageIdx).toBe(1);
    const run=running();
    expect(() => send(run.room,run.host,{type:'stage',stageIdx:60})).toThrow('state');
    expect(run.room.view().stageIdx).toBe(2);
  });
  test('guest cannot send world or result authority', () => {
    const {room,guest} = running();
    expect(() => send(room,guest,{type:'snapshot',seq:1,snapshot:snapshot(room)})).toThrow('host-only');
    expect(() => send(room,guest,{type:'finish',runId:room.run?.runId,win:true,stats:{elapsed:1,kills:1,roomsCleared:1}})).toThrow('host-only');
    expect(room.status).toBe('running');
  });
  test('running host and guest disconnect abort with no finish', () => {
    for (const role of ['host','guest'] as const) {
      const ctx=running(); const effects=ctx.room.disconnect(ctx[role]);
      expect(ctx.room.status).toBe('closed');
      expect(effects[0].message).toMatchObject({type:'abort',reason:role==='host'?'host-left':'member-left'});
      expect(effects.some(e=>e.message.type==='finish')).toBe(false);
    }
  });
  test('lobby guest departure keeps lobby; host departure closes it', () => {
    const {room,host,guest}=lobby(); room.disconnect(guest); expect(room.status).toBe('lobby');
    room.disconnect(host); expect(room.status).toBe('closed');
  });
  test('expiration prevents joining and messages', () => {
    const {room,host}=lobby();
    expect(() => send(room,host,{type:'ready',ready:true},room.expiresAt)).toThrow('expired');
    expect(room.status).toBe('closed');
    expect(() => room.join('late','mage',null,room.expiresAt)).toThrow('expired');
  });
  test('finish matches server run id and broadcasts once after a snapshot', () => {
    const {room,host}=running(); const m={type:'finish',runId:room.run?.runId,win:true,stats:{elapsed:10,kills:5,roomsCleared:1}};
    expect(() => send(room,host,m)).toThrow('no-snapshot');
    send(room,host,{type:'snapshot',seq:1,snapshot:snapshot(room)});
    expect(() => send(room,host,{...m,runId:'forged'})).toThrow('finish-schema');
    expect(send(room,host,m)[0].message).toMatchObject({type:'finish',win:true});
    expect(room.status).toBe('finished');
    expect(() => send(room,host,m)).toThrow('closed');
  });
});
describe('bounded relay protocol', () => {
  test('guest inputs relay only to host with server-owned player id', () => {
    const {room,host,guest}=running();
    const effect=send(room,guest,{type:'input',playerId:host,seq:1,x:1,y:0,attack:true,actions:['skill0']})[0];
    expect(effect.to).toBe(host); expect(effect.message.playerId).toBe(guest);
    expect(() => send(room,guest,{type:'input',seq:1,x:0,y:0,attack:false,actions:[]})).toThrow('sequence');
    expect(() => send(room,guest,{type:'input',seq:2,x:1e100,y:0,attack:false,actions:[]})).toThrow('input-schema');
  });
  test('numeric, count and membership bounds reject malformed snapshots', () => {
    const {room,host}=running(); const s=snapshot(room);
    s.players[0].x=Infinity; expect(validPartySnapshot(s)).toBe(false);
    s.players[0].x=0; s.players[0].hp=-1; expect(validPartySnapshot(s)).toBe(false);
    s.players[0].hp=100; s.players[0].heroId='admin'; expect(validPartySnapshot(s)).toBe(false);
    s.players[0].heroId='knight'; s.players[0].id='forged';
    expect(() => send(room,host,{type:'snapshot',seq:1,snapshot:s})).toThrow('snapshot-members');
    expect(validPartySnapshot({...snapshot(room),rooms:Array(65).fill(s.rooms[0])})).toBe(false);
  });
  test('optional paused state is boolean and relayed unchanged', () => {
    const {room,host}=running();
    const s={...snapshot(room),paused:true};
    expect(validPartySnapshot(s)).toBe(true);
    expect(validPartySnapshot({...s,paused:'true'})).toBe(false);
    expect((send(room,host,{type:'snapshot',seq:1,snapshot:s})[0].message.snapshot as any).paused).toBe(true);
  });
  test('bounded warning shapes relay and optional warnings preserve old snapshots', () => {
    const {room,host}=running();
    const base={id:'hazard:1',kind:'disk',x:0,z:0,radius:4,width:0,length:0,angle:0,safeRadius:0,remaining:1,duration:2,color:0xff3300};
    const warnings=['disk','ring','lane'].map((kind,i)=>({...base,kind,id:`hazard:${i}`}));
    expect(validPartySnapshot(snapshot(room))).toBe(true);
    expect(validPartySnapshot({...snapshot(room),warnings:[]})).toBe(true);
    const packet={...snapshot(room),warnings};
    expect((send(room,host,{type:'snapshot',seq:1,snapshot:packet})[0].message.snapshot as any).warnings).toEqual(warnings);
    const edge={...base,id:'x'.repeat(96),x:-2000,z:2000,radius:80,width:80,length:80,safeRadius:80,angle:-100,remaining:20,duration:.01,color:0xffffff};
    expect(validPartySnapshot({...snapshot(room),warnings:[edge]})).toBe(true);
  });
  test('warning count, malformed fields, duplicates and numeric bounds reject', () => {
    const {room}=running();
    const base={id:'hazard:1',kind:'disk',x:0,z:0,radius:4,width:0,length:0,angle:0,safeRadius:0,remaining:1,duration:2,color:0xff3300};
    const valid=(warnings:unknown)=>validPartySnapshot({...snapshot(room),warnings});
    expect(valid(Array.from({length:48},(_,i)=>({...base,id:`h${i}`})))).toBe(true);
    expect(valid(Array.from({length:49},(_,i)=>({...base,id:`h${i}`})))).toBe(false);
    expect(valid([base,{...base}])).toBe(false);
    for(const malformed of [null,{}, { ...base, extra:true }, {...base,id:'bad<script>'}, {...base,id:'x'.repeat(97)},
      {...base,kind:'sphere'}, {...base,radius:undefined}]) expect(valid([malformed])).toBe(false);
    for(const [key,values] of Object.entries({x:[-2001,2001,Infinity],z:[-2001,2001,NaN],radius:[-1,81],width:[-1,81],
      length:[-1,81],safeRadius:[-1,81],angle:[-101,101],remaining:[-1,21],duration:[0,21],color:[-1,0x1000000,1.5]})) {
      for(const value of values) expect(valid([{...base,[key]:value}])).toBe(false);
    }
    expect(valid('not-array')).toBe(false);
  });
  test('snapshot seq and simulation tick are monotonic', () => {
    const {room,host}=running();
    send(room,host,{type:'snapshot',seq:1,snapshot:snapshot(room)});
    expect(() => send(room,host,{type:'snapshot',seq:2,snapshot:snapshot(room)})).toThrow('sequence');
    expect(() => send(room,host,{type:'snapshot',seq:1,snapshot:snapshot(room,2)})).toThrow('sequence');
  });
  test('input and snapshot rates are capped independently', () => {
    const {room,host,guest}=running();
    for(let i=0;i<20;i++) send(room,guest,{type:'input',seq:i,x:0,y:0,attack:false,actions:[]});
    expect(() => send(room,guest,{type:'input',seq:21,x:0,y:0,attack:false,actions:[]})).toThrow('rate');
    for(let i=0;i<10;i++) send(room,host,{type:'snapshot',seq:i,snapshot:snapshot(room,i+1)});
    expect(() => send(room,host,{type:'snapshot',seq:11,snapshot:snapshot(room,12)})).toThrow('rate');
    expect(send(room,guest,{type:'input',seq:22,x:0,y:0,attack:false,actions:[]},now+1000)).toHaveLength(1);
  });
  test('byte and malformed JSON limits', () => {
    const {room,guest}=running();
    expect(() => room.receive(guest,'x'.repeat(PARTY_LIMITS.bytes+1),now)).toThrow('size');
    expect(() => room.receive(guest,'{',now)).toThrow('json');
  });
});
describe('Worker routing and Durable Object guard', () => {
  test('cross-origin cannot reach the binding', async () => {
    const env={APP_ORIGIN:'https://game.example',PARTIES:{idFromName(){throw Error('must not call');},get(){throw Error('must not call');}}};
    const result=await handlePartyRequest(new Request('https://game.example/api/party',{method:'POST',headers:{origin:'https://evil.example'}}),env);
    expect(result.status).toBe(403);
  });
  test('creation and join attempt limits persist in Durable Object storage', async () => {
    const values = new Map<string,unknown>();
    const storage:any={get:async(k:string)=>values.get(k),put:async(k:string,v:unknown)=>{values.set(k,v);},setAlarm:async()=>{},deleteAll:async()=>values.clear(),transaction:async(fn:any)=>fn(storage)};
    const obj=new PartyRoom({storage});
    for(let i=0;i<5;i++) expect((await obj.fetch(new Request('https://internal/gate?kind=create',{method:'POST'}))).status).toBe(200);
    expect((await obj.fetch(new Request('https://internal/gate?kind=create',{method:'POST'}))).status).toBe(429);
    const restored = new PartyRoom({storage});
    expect((await restored.fetch(new Request('https://internal/gate?kind=create',{method:'POST'}))).status).toBe(429);
    // A replacement instance cannot resume a simulated world from stale metadata.
    expect((await restored.fetch(new Request('https://internal/join',{headers:{Upgrade:'websocket'}}))).status).toBe(410);
  });
});
