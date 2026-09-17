import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {ComboLink} from '../src/game/combo-link.js';
function fixture(){
 const player:any={alive:true,knightLifeEpoch:0,pos:new THREE.Vector3()},enemy={pos:new THREE.Vector3(1,0,1)};
 const link=new ComboLink();link.arm({token:{owner:player,epoch:0},source:player,player,enemy,now:1});
 return {link,player,enemy,context:{cast:true,sk:{}}};
}
test('준비 UI와 실제 연계 발동은 동일한 12유닛 경계를 사용한다',()=>{
 const {link,player,enemy,context}=fixture();player.pos.copy(enemy.pos).x+=12.001;
 expect(link.snapshot(2,player).ready).toBe(false);expect(link.snapshot(2,player).remaining).toBe(0);
 expect(link.consume({player,context,now:2})).toBeNull();expect(link.activations).toBe(0);expect(link.cooldownUntil).toBe(0);
 player.pos.copy(enemy.pos).x+=12;expect(link.snapshot(2.5,player).ready).toBe(true);
 expect(link.consume({player,context,now:2.5})).not.toBeNull();expect(link.activations).toBe(1);
});
test('거리 밖 왕복은 기회 만료를 연장하지 않으며 만료 후 복귀는 준비되지 않는다',()=>{
 const {link,player,enemy}=fixture();player.pos.set(100,0,100);expect(link.snapshot(2,player).ready).toBe(false);
 player.pos.copy(enemy.pos);expect(link.snapshot(3.9,player).remaining).toBeCloseTo(.1);expect(link.snapshot(4,player).ready).toBe(false);
});
test('유효한 플레이어 위치가 없으면 준비 문구와 기예 발동을 모두 거부한다',()=>{
 for(const pos of [null,new THREE.Vector3(NaN,0,0),new THREE.Vector3(Infinity,0,0)]){
  const {link,player,context}=fixture();player.pos=pos;expect(link.snapshot(2,player).ready).toBe(false);expect(link.consume({player,context,now:2})).toBeNull();
 }
});
