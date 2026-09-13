import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Actor } from '../src/game/actor.js';
import { PartySession } from '../src/party/session.js';

// Original 26 Quaternius + 4 KayKit renders establish the authored +Z front.
// Check the production local and replicated transforms against the actual aim.
for(const rig of ['kaykit','big','blob','flying'])test(`${rig}: local and party faces agree with attack direction`,()=>{
  const actor=new Actor({scene:new THREE.Scene()},{scene:new THREE.Group(),animations:[]},{rig});
  for(const [x,z] of [[0,5],[5,0],[-4,-3],[2,-6]]){
    const target=new THREE.Vector3(x,0,z).normalize();actor.face(x,z);actor.update(0);
    expect(new THREE.Vector3(0,0,1).applyQuaternion(actor.root.quaternion).dot(target)).toBeGreaterThan(.99999);
    PartySession.prototype.applyPose.call({},actor,{x:0,z:0,yaw:Math.atan2(x,z),hp:100,maxHp:100,state:'idle'},.016);
    expect(new THREE.Vector3(0,0,1).applyQuaternion(actor.root.quaternion).dot(target)).toBeGreaterThan(.99999);
    expect(actor.forward().dot(target)).toBeGreaterThan(.99999);
  }
  actor.dispose();
});
