import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {SKILLS} from '../src/game/skills.js';
import {capturePartyEffects,PartyVisualPlayer} from '../src/party/visual-effects.js';
import {capturePartyVisual,validPartyVisual,queuePartyVisual,partyVisualMessage,PARTY_VISUAL_LIMIT,PARTY_VISUAL_BUDGET} from '../src/party/visual-protocol.js';

const pos=()=>new THREE.Vector3(3,0,-4);
const circle=(at=10)=>capturePartyVisual('castCircle',[pos(),0x80e0ff,{radius:7,life:3.2}],at)!;

test('actual blizzard start captures its ground cue once and leaves the host renderer intact',()=>{
  let hostDraws=0;const events:any[]=[];
  const original={castCircle(p:any,color:number,options:any){hostDraws++;return this.groundTex(p,'circle_gold',color,options);},groundTex(..._args:any[]){return 'drawn';}};
  const fx=capturePartyEffects(original,(e:any)=>events.push(e),()=>10);
  const p={pos:pos()};
  SKILLS.blizzard.start({fx} as any,p as any,{data:{}} as any);
  expect(hostDraws).toBe(1);expect(events).toHaveLength(1);
  expect(events[0]).toEqual(circle());
  p.pos.set(99,99,99);expect(events[0].pos).toEqual({x:3,y:0,z:-4});
  expect(fx.castCircle(pos(),0x80e0ff,{radius:7,life:3.2})).toBe('drawn');
});

test('visual validator rejects executable payloads, unknown textures, oversize and non-finite values',()=>{
  const good:any=circle();expect(validPartyVisual(JSON.parse(JSON.stringify(good)))).toBe(true);
  for(const bad of [null,[],{}, {...good,kind:'add'},{...good,kind:'constructor'},{...good,damage:9000},
    {...good,color:0x1000000},{...good,at:-1},{...good,pos:{...good.pos,x:Infinity}},
    {...good,options:{...good.options,life:9}},{...good,options:{...good.options,life:NaN}},
    {...good,options:{...good.options,radius:2000}},{...good,options:{...good.options,callback:'alert(1)'}},
    {...good,options:{...good.options,demon:1}}]) expect(validPartyVisual(bad)).toBe(false);
  const ground:any=capturePartyVisual('groundTex',[pos(),'circle_gold',0xffffff,{life:7}],10);
  expect(validPartyVisual(ground)).toBe(true);expect(validPartyVisual({...ground,texture:'https://evil.example/img'})).toBe(false);
  expect(capturePartyVisual('damage',[pos(),9000],10)).toBeNull();
});

test('burst pressure cannot grow the packet or crowd out sustained ground cues',()=>{
  const queue:any[]=[];const burst=capturePartyVisual('iceBurst',[pos(),{size:4,life:.45}],10)!;
  for(let i=0;i<1000;i++)queuePartyVisual(queue,burst);
  queuePartyVisual(queue,circle());expect(queue).toHaveLength(PARTY_VISUAL_LIMIT);
  expect(queue.some(v=>v.kind==='castCircle')).toBe(true);
});

test('replay preserves position, shape, color and remaining lifetime',()=>{
  const calls:any[]=[];
  const fx={castCircle:(...args:any[])=>calls.push(args)};
  const player=new PartyVisualPlayer(fx);
  expect(player.play([circle()],10.2)).toBe(1);
  expect(calls[0][0].toArray()).toEqual([3,0,-4]);expect(calls[0][1]).toBe(0x80e0ff);
  expect(calls[0][2].radius).toBe(7);expect(calls[0][2].life).toBeCloseTo(3);
  expect(player.play([circle()],14)).toBe(0);expect(player.play([circle()],NaN)).toBe(0);
});

test('render budget reserves ground cues, expires after lifetime and clears between runs',()=>{
  let draws=0;const player=new PartyVisualPlayer({iceBurst(){draws++;},castCircle(){draws++;}});
  const burst=capturePartyVisual('iceBurst',[pos(),{life:8}],10)!;
  for(let i=0;i<100;i++)player.play(Array(24).fill(burst),10);
  expect(draws).toBe(PARTY_VISUAL_BUDGET-12);
  player.play(Array(24).fill(circle()),10);expect(draws).toBe(PARTY_VISUAL_BUDGET);
  for(let i=0;i<82;i++)player.update(.1);
  expect(player.active).toHaveLength(0);expect(player.play([circle()],10)).toBe(1);
  player.clear();expect(player.active).toHaveLength(0);
});

test('reduced motion retains stationary ground markers and suppresses bolts and bursts',()=>{
  const calls:any[]=[];const player=new PartyVisualPlayer({groundTex:(...args:any[])=>calls.push(args),iceBurst(){throw Error('motion');}});
  const burst=capturePartyVisual('iceBurst',[pos(),{}],10)!;
  expect(player.play([circle(),burst],10,true)).toBe(1);
  expect(calls[0][3]).toMatchObject({r0:7,r1:7,spin:0});
});

test('legacy snapshots keep all combat fields and stripping visuals never mutates the shared packet',()=>{
  const message={type:'snapshot',seq:5,snapshot:{tick:5,players:[{hp:100}],visuals:[circle()]}};
  const old=partyVisualMessage(message,false);
  expect(old.snapshot).toEqual({tick:5,players:[{hp:100}]});
  expect(message.snapshot.visuals).toHaveLength(1);expect(partyVisualMessage(message,true)).toBe(message);
});
