import { expect, test } from 'bun:test';
import { audio } from '../src/engine/audio.js';
import { Vector3 } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';
const runtime = await loadCombatFlowRuntime();

test('마무리 준비 중 회피·피격 취소는 예약된 몰이를 종료하며 일시정지 중에는 이동하지 않는다', () => {
  for(const cancel of ['dodge','hurt']) {
    const f=createCombatFlowFixture(runtime),p:any=f.player;
    const target:any=spawnCombatFlowEnemy(f,p.pos.x,p.pos.z+4,{stun:10});
    p.startCombo(p.def.combo.length-1);
    const before=target.pos.clone(),time=target.gatherT;
    f.game.paused=true;stepCombatFlow(f,1/60);
    expect(target.pos.toArray()).toEqual(before.toArray());expect(target.gatherT).toBe(time);
    f.game.paused=false;
    if(cancel==='dodge')p.dodge(new Vector3(1,0,0));else p.hurt(20,{kb:6});
    stepCombatFlow(f,1/60);
    expect(target.gatherT).toBe(0);expect(target.gatherWindupOwner).toBeNull();
    expect(target.pos.toArray()).toEqual(before.toArray());
  }
});

test('전사 준비 몰이는 실제 마무리 명중 안으로 이동하고 예고 원점·넉백을 보존한다', () => {
  for (const hero of ['knight','barbarian']) for (const fps of [30,60,120]) for (const yaw of [0,Math.PI/2,Math.PI]) {
    const f = createCombatFlowFixture(runtime,hero), p:any = f.player;
    p.yaw = yaw;
    const c = p.def.combo.at(-1), initial = c.range + 1.2, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const target:any = spawnCombatFlowEnemy(f,p.pos.x+fx*initial,p.pos.z+fz*initial,{hp:100000,maxHp:100000,stun:10});
    const locked:any = spawnCombatFlowEnemy(f,p.pos.x+fx*(initial-.3),p.pos.z+fz*(initial-.3),{isBoss:true,state:'attack',telegraph:10});
    const back:any = spawnCombatFlowEnemy(f,p.pos.x-fx*initial,p.pos.z-fz*initial,{stun:10});
    p.startCombo(p.def.combo.length-1);
    expect(target.gatherT).toBeGreaterThan(0); expect(locked.gatherT).toBe(0);
    if (hero === 'knight') expect(back.gatherT).toBe(0);
    for(let i=0;i<fps*2&&!p.hitDone;i++)stepCombatFlow(f,1/fps);
    expect(p.hitDone).toBe(true); expect(target.hp).toBeLessThan(100000);
    expect(f.game.world.walkable(target.pos.x,target.pos.z)).toBe(true);
    expect(Math.hypot(target.kb.x,target.kb.z)).toBeGreaterThan(0);
    const h = f.events.hits.filter((hit:any)=>hit.enemy===target);
    expect(h).toHaveLength(1);
    expect(Math.hypot(h[0].x-p.pos.x,h[0].z-p.pos.z)).toBeLessThan(initial);
  }
});

test('헛친 평타는 진동이 없고 같은 프레임의 군중 명중은 강한 전사 진동을 한 번 요청한다', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis,'navigator'), calls:any[] = [], before = {haptics:audio.haptics,_vibeAt:audio._vibeAt};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{vibrate:(pattern:any)=>{calls.push(pattern);return true;}}});
  try {
    audio.haptics=true; audio._vibeAt=-Infinity;
    const miss=createCombatFlowFixture(runtime), p:any=miss.player;
    p.startCombo(0); for(let i=0;i<80;i++)stepCombatFlow(miss,1/120);
    expect(calls).toEqual([]);
    const hit=createCombatFlowFixture(runtime), warrior:any=hit.player;
    for(const dx of [-.4,0,.4])spawnCombatFlowEnemy(hit,warrior.pos.x+dx,warrior.pos.z+1.6,{stun:10});
    warrior.startCombo(warrior.def.combo.length-1);
    expect(calls).toEqual([]);
    for(let i=0;i<120&&!warrior.hitDone;i++)stepCombatFlow(hit,1/120);
    expect(hit.events.hits).toHaveLength(3); expect(calls).toEqual([[22,12,42]]);
  } finally {
    Object.assign(audio,before);
    if(old)Object.defineProperty(globalThis,'navigator',old);else Reflect.deleteProperty(globalThis,'navigator');
  }
});
