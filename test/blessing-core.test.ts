import {expect,test} from 'bun:test';
import {BOONS} from '../src/data/masterworks.js';
import {BLESSING_EFFECTIVE,BLESSING_GEM_PRICES,BLESSING_DAILY_GEM_CAP,BLESSING_PITY,BLESSING_GEM_NOTE} from '../src/data/blessing.js';
import {normalizeBlessing,dayKey,rollCost,roll,pick,consumeOnRunStart,resetRunRerolls,addCharms,drawCandidates,oddsTable,gemRollsLeft,pityLeft} from '../src/game/blessing-core.js';
import {periodAt} from '../src/game/journey-core.js';

// 2026-09-06T20:00Z = 2026-09-07(월) 05:00 KST
const RESET=Date.parse('2026-09-06T20:00:00.000Z'),DAY=86400000;

test('10만 회 분포(천장 끔): 등급 70/25/5 ±1%p, 각인 12종 균등, 후보 중복 없음',()=>{
  const grades=[0,0,0,0],kinds:Record<string,number>={};
  let s=normalizeBlessing(null),slots=0;
  for(let i=0;i<100000;i++){
    // 매 굴림 하루씩 넘겨 무료 굴림만 쓴다(상한·비용과 무관하게 분포만 본다).
    const r:any=roll(s,RESET+i*DAY,'dist',{pity:false});
    expect(r.ok).toBe(true);
    expect(new Set(r.candidates.map((c:any)=>c.id)).size).toBe(3);
    for(const c of r.candidates){grades[c.grade]++;kinds[c.id]=(kinds[c.id]||0)+1;slots++;}
    expect(r.state.pity).toBe(0);
    s=r.state;
  }
  expect(Math.abs(grades[1]/slots-.70)).toBeLessThan(.01);
  expect(Math.abs(grades[2]/slots-.25)).toBeLessThan(.01);
  expect(Math.abs(grades[3]/slots-.05)).toBeLessThan(.01);
  expect(Object.keys(kinds).length).toBe(BOONS.length);
  for(const n of Object.values(kinds)) expect(Math.abs(n/slots-1/12)).toBeLessThan(.005);
});

test('천장 포함 실효 확률 모의가 공개 상수와 ±0.3%p 안에서 일치',()=>{
  let s=normalizeBlessing(null),slots=0,iii=0,rollsWithIII=0;const N=400000;
  for(let i=0;i<N;i++){
    const r:any=roll(s,RESET+i*DAY,'effective');
    const n=r.candidates.filter((c:any)=>c.grade===3).length;
    iii+=n;slots+=3;if(n)rollsWithIII++;s=r.state;
  }
  const candidateRate=iii/slots,perRoll=rollsWithIII/N;
  // 모의 결과는 보고용으로 남긴다.
  console.log(`[전운 모의 ${N}회] III 후보 비율 ${(candidateRate*100).toFixed(3)}% · 굴림당 III≥1 ${(perRoll*100).toFixed(3)}%`);
  expect(Math.abs(candidateRate-BLESSING_EFFECTIVE.iiiCandidateRate)).toBeLessThan(.003);
  expect(Math.abs(perRoll-BLESSING_EFFECTIVE.atLeastOneIIIPerRoll)).toBeLessThan(.003);
});

test('천장: III 없이 10번 → 11번째 굴림에 III 포함, III이 나오면 pity 0',()=>{
  let s=normalizeBlessing({pity:BLESSING_PITY});
  expect(pityLeft(s)).toBe(1);
  for(let seed=0;seed<500;seed++){
    const r:any=roll(s,RESET,`pity:${seed}`);
    expect(r.guaranteed).toBe(true);
    expect(r.candidates.filter((c:any)=>c.grade===3).length).toBeGreaterThanOrEqual(1);
    expect(r.state.pity).toBe(0);
  }
  // 실제 순서: III이 안 나온 굴림을 10번 센 뒤 11번째에 보장.
  s=normalizeBlessing(null);let streak=0,checked=0;
  for(let i=0;i<20000;i++){
    const r:any=roll(s,RESET+i*DAY,'streak');
    const has=r.candidates.some((c:any)=>c.grade===3);
    if(streak===BLESSING_PITY){expect(r.guaranteed).toBe(true);expect(has).toBe(true);checked++;}
    else expect(r.guaranteed).toBe(false);
    streak=has?0:streak+1;expect(r.state.pity).toBe(streak);s=r.state;
  }
  expect(checked).toBeGreaterThan(100);
});

test('보장 III의 각인 종류는 균등',()=>{
  const n:Record<string,number>={};const N=60000;
  for(let i=0;i<N;i++){
    const c=drawCandidates(`g:${i}`,{guaranteeIII:true});
    const forced=c.filter(x=>x.grade===3);expect(forced.length).toBeGreaterThanOrEqual(1);
    for(const x of forced) n[x.id]=(n[x.id]||0)+1;
  }
  const total=Object.values(n).reduce((a,b)=>a+b,0);
  for(const b of BOONS as any[]) expect(Math.abs(n[b.id]/total-1/12)).toBeLessThan(.006);
});

test('비용 순서: 무료 → 부적 → 보석 30/60/90, 보석 차감은 호출자 몫',()=>{
  let s:any=normalizeBlessing({charms:2});
  const kinds:string[]=[],gems:number[]=[];
  for(let i=0;i<7;i++){const r:any=roll(s,RESET+1000,'cost');kinds.push(r.paid.kind);gems.push(r.paid.gems);s=r.state;}
  expect(kinds).toEqual(['free','charm','charm','gem','gem','gem','gem']);
  expect(gems).toEqual([0,0,0,30,60,90,90]);
  expect(BLESSING_GEM_PRICES).toEqual([30,60,90]);
  expect(s.charms).toBe(0);
  // 출격 시작 뒤에는 가격 단계가 처음으로 돌아간다.
  s=consumeOnRunStart(s).state;expect(rollCost(s,RESET+1000)).toEqual({kind:'gem',gems:30,allowed:true});
  s=(roll(s,RESET+1000,'cost') as any).state;expect(rollCost(s,RESET+1000).gems).toBe(60);
  expect(resetRunRerolls(s).runGemRolls).toBe(0);
  // 입력 상태는 바뀌지 않는다.
  const before=normalizeBlessing({charms:1});const snap=JSON.stringify(before);roll(before,RESET,'x');pick(before,0);consumeOnRunStart(before);
  expect(JSON.stringify(before)).toBe(snap);
});

test('일일 보석 굴림 상한 30, 다음 날 05:00에 다시 열림',()=>{
  let s:any=normalizeBlessing({freeDay:dayKey(RESET)});
  for(let i=0;i<BLESSING_DAILY_GEM_CAP;i++){const r:any=roll(s,RESET+i,'cap');expect(r.ok).toBe(true);expect(r.paid.kind).toBe('gem');s=r.state;}
  expect(gemRollsLeft(s,RESET)).toBe(0);
  expect(rollCost(s,RESET)).toEqual({kind:'gem',gems:90,allowed:false,reason:'daily-cap'});
  expect(roll(s,RESET,'cap')).toEqual({ok:false,error:'daily-cap'});
  // 부적이 있으면 상한과 무관하게 부적 굴림은 된다.
  expect(roll(addCharms(s,1).state,RESET,'cap').ok).toBe(true);
  // 다음 날: 무료 먼저, 그다음 보석 상한 리셋.
  expect(rollCost(s,RESET+DAY).kind).toBe('free');
  expect(gemRollsLeft(s,RESET+DAY)).toBe(BLESSING_DAILY_GEM_CAP);
});

test('05:00 KST 경계: 04:59:59는 전날, 05:00은 새날(무료 1회 다시)',()=>{
  expect(dayKey(RESET)).toBe(dayKey(RESET-1)+1);
  expect(dayKey(RESET+DAY-1)).toBe(dayKey(RESET));
  expect(dayKey(RESET)).toBe(periodAt(RESET).day);
  const s=(roll(normalizeBlessing(null),RESET-1,'edge') as any).state;
  expect(rollCost(s,RESET-1).kind).toBe('gem');
  expect(rollCost(s,RESET).kind).toBe('free');
});

test('보관 1개: 고르기·다시 고르기·재굴림 중 유지·소모 후 비움, preRunBoons 형식',()=>{
  let s:any=normalizeBlessing(null);
  expect(pick(s,0)).toEqual({ok:false,error:'no-offer'});
  const r:any=roll(s,RESET,'hold');s=r.state;
  expect(pick(s,3)).toEqual({ok:false,error:'index'});
  const p1:any=pick(s,0),p2:any=pick(p1.state,2);
  expect(p2.state.held).toEqual(r.candidates[2]);expect(p2.state.offer.picked).toBe(2);
  s=p2.state;
  // 다시 굴려도 보관은 새로 고를 때까지 유지.
  s=(roll(addCharms(s,1).state,RESET,'hold2') as any).state;
  expect(s.held).toEqual(r.candidates[2]);expect(s.offer.picked).toBe(-1);
  // 출격 시작 실패 → consume을 부르지 않으므로 저장 정규화 뒤에도 그대로.
  s=normalizeBlessing(JSON.parse(JSON.stringify(s)));expect(s.held).toEqual(r.candidates[2]);
  const c=consumeOnRunStart(s);
  expect(c.preRunBoons).toEqual(Array(r.candidates[2].grade).fill(r.candidates[2].id));
  expect(c.state.held).toBeNull();expect(c.state.offer).toBeNull();
  expect(consumeOnRunStart(c.state).preRunBoons).toEqual([]);
  // 등급 n = 같은 id n번.
  expect(consumeOnRunStart({held:{id:'ember_edge',grade:3}}).preRunBoons).toEqual(['ember_edge','ember_edge','ember_edge']);
});

test('결정성: 같은 상태·시드는 같은 결과, rollSeq가 다르면 같은 시드라도 다음 굴림이 바뀐다',()=>{
  const a:any=roll(normalizeBlessing(null),RESET,'same'),b:any=roll(normalizeBlessing(null),RESET,'same');
  expect(a.candidates).toEqual(b.candidates);
  expect(drawCandidates('fixed')).toEqual(drawCandidates('fixed'));
  const seen=new Set<string>();let s:any=normalizeBlessing(null);
  for(let i=0;i<20;i++){const r:any=roll(s,RESET+i*DAY,'same');seen.add(JSON.stringify(r.candidates));s=r.state;}
  expect(seen.size).toBeGreaterThan(15);
});

test('정규화: 잘못된 저장값은 버리고 범위 안으로',()=>{
  const s=normalizeBlessing({pity:99,charms:-3,gemRolls:500,freeDay:'x',held:{id:'nope',grade:2},
    offer:{candidates:[{id:'ember_edge',grade:1},{id:'ember_edge',grade:2},{id:'tide_guard',grade:1}]}});
  expect(s.pity).toBe(BLESSING_PITY);expect(s.charms).toBe(0);expect(s.gemRolls).toBe(BLESSING_DAILY_GEM_CAP);
  expect(s.freeDay).toBe(-1);expect(s.held).toBeNull();expect(s.offer).toBeNull();
  expect(normalizeBlessing({held:{id:'stone_root',grade:4}}).held).toBeNull();
  expect(addCharms({charms:998},5).added).toBe(1);
});

test('확률 공개 표: 데이터에서 생성, 각인별 5.83/2.08/0.42%, 기본 14.3%, 보석 구분 없음 문구',()=>{
  const t=oddsTable();
  expect(t.grades.map(g=>g.text)).toEqual(['70%','25%','5%']);
  expect(t.perBoon.length).toBe(12);
  for(const b of t.perBoon) expect(b.grades.map(g=>g.text)).toEqual(['5.83%','2.08%','0.42%']);
  expect(t.families.length).toBe(4);for(const f of t.families){expect(f.boonIds.length).toBe(3);expect(f.rate).toBeCloseTo(.25,10);}
  expect(t.baseAtLeastOneIII.text).toBe('14.3%');expect(t.baseAtLeastOneIII.rate).toBeCloseTo(1-.95**3,10);
  expect(t.effective.atLeastOneIIIPerRoll.text).toBe('17.5%');expect(t.effective.iiiCandidateRate.text).toBe('6.19%');
  expect(t.pity.threshold).toBe(10);expect(t.prices.gems).toEqual([30,60,90]);expect(t.prices.dailyGemCap).toBe(30);
  expect(t.notes).toContain(BLESSING_GEM_NOTE);
  const sum=t.perBoon.reduce((a,b)=>a+b.grades.reduce((x,g)=>x+g.rate,0),0);expect(sum).toBeCloseTo(1,10);
});
