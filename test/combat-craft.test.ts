import { expect, test } from 'bun:test';
import { MELEE_ATTACK_SLOTS, canCommitMelee, packSeparation, packSteer } from '../src/game/combat-craft.js';

const mob=(x:number,z:number,extra:any={})=>({alive:true,spawning:false,state:'chase',isBoss:false,isElite:false,radius:.7,def:{ranged:false},pos:{x,z},packSide:1,...extra});

test('pack separation produces bounded opposing motion instead of exact overlap',()=>{
  const a=mob(0,0),b=mob(.35,0); const list=[a,b];
  const sa=packSeparation(a,list),sb=packSeparation(b,list);
  expect(sa.count).toBe(1);expect(sb.count).toBe(1);expect(sa.x).toBeLessThan(0);expect(sb.x).toBeGreaterThan(0);
  expect(sa.overlap).toBeGreaterThan(0);expect(Math.abs(sa.x)).toBeLessThan(10);
});

test('완전히 겹친 적은 생성 순번으로 반대 방향을 택하고 명단 재정렬에도 함께 미끄러지지 않는다', () => {
  for (const ids of [[1, 2], [27, 35], [35, 27]]) {
    const a = mob(0, 0, { packId: ids[0] }), b = mob(0, 0, { packId: ids[1] });
    const sa = packSeparation(a, [a, b]), sb = packSeparation(b, [a, b]);
    expect(Math.hypot(sa.x, sa.z)).toBeGreaterThan(0);
    expect(sa.x + sb.x).toBeCloseTo(0, 12);
    expect(sa.z + sb.z).toBeCloseTo(0, 12);
    expect(packSeparation(a, [b, a])).toEqual(sa);
    expect(packSeparation(b, [b, a])).toEqual(sb);
  }
  // 생성자를 쓰지 않는 기존 검사 표본에도 쌍의 반대 방향을 보장한다.
  const a = mob(0, 0), b = mob(0, 0);
  const sa = packSeparation(a, [a, b]), sb = packSeparation(b, [a, b]);
  expect(sa.x + sb.x).toBeCloseTo(0, 12);
  expect(sa.z + sb.z).toBeCloseTo(0, 12);
});

test('3~24체 동일 좌표의 분리는 새 난수 없이 유한하며 30·60·120Hz에서 밀집을 해소한다', () => {
  function run(count: number, fps: number) {
    const list = Array.from({ length: count }, (_, index) => mob(0, 0, { packId: index + 1 }));
    for (let frame = 0; frame < fps; frame++) {
      const velocities = list.map(enemy => packSeparation(enemy, list));
      for (let i = 0; i < list.length; i++) {
        expect(velocities[i].count).toBeLessThanOrEqual(8);
        list[i].pos.x += velocities[i].x / fps;
        list[i].pos.z += velocities[i].z / fps;
      }
    }
    return list.map(enemy => enemy.pos);
  }
  const random = Math.random;
  Math.random = () => { throw new Error('군중 분리가 전투 난수를 소비함'); };
  try {
    for (const count of [3, 8, 24]) for (const fps of [30, 60, 120]) {
      const points = run(count, fps);
      expect(run(count, fps)).toEqual(points);
      for (let i = 0; i < points.length; i++) {
        expect(Number.isFinite(points[i].x) && Number.isFinite(points[i].z)).toBe(true);
        for (let j = i + 1; j < points.length; j++) {
          expect(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z)).toBeGreaterThan(.6);
        }
      }
    }
  } finally { Math.random = random; }
});

test('only three ordinary nearby melee attacks commit at once while bosses and ranged keep authority',()=>{
  const p={pos:{x:0,z:0}},self=mob(2,0); const active=Array.from({length:MELEE_ATTACK_SLOTS},(_,i)=>mob(2+i*.2,.5,{state:'attack'}));
  expect(canCommitMelee(self,[self,...active],p)).toBe(false);
  expect(canCommitMelee({...self,isBoss:true},active,p)).toBe(true);
  expect(canCommitMelee({...self,def:{ranged:true}},active,p)).toBe(true);
  active.forEach((e:any)=>e.pos.x=20);expect(canCommitMelee(self,[self,...active],p)).toBe(true);
});

test('waiting melee orbits and retreats instead of stacking on the player',()=>{
  const p={pos:{x:0,z:0}},e=mob(1,0,{packSide:1});
  const s=packSteer(e,p,{x:0,z:0},false);expect(s.x).toBeGreaterThan(0);expect(Math.abs(s.z)).toBeGreaterThan(.5);
  const allowed=packSteer(e,p,{x:.2,z:.1},true);expect(allowed).toEqual({x:.2,z:.1});
});
