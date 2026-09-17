/** Soft contact after actor motion. No damage, new stagger, or player displacement.
 * Frozen attack origins (including boss/role telegraphs) must never be moved. */
const valid = a => a?.alive && !a.spawning && a.pos && Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z) && Number.isFinite(a.radius) && a.radius > 0;
const movable = a => !a.isBoss && !(a.telegraph > 0) && !a.mobRole?.plan && ['chase','hurt','dodge'].includes(a.state);
const radius = a => Math.min(2.5, a.radius);
function shift(actor, x, z, world) {
  if (!x && !z) return;
  const ox = actor.pos.x, oz = actor.pos.z;
  const p = world?.resolve ? world.resolve(ox, oz, ox+x, oz+z, actor.radius*.8) : [ox+x,oz+z];
  if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {actor.pos.x=p[0];actor.pos.z=p[1];}
}
export function resolveCrowdContacts(enemies, player, world, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const pack = enemies.filter(valid), gain = 1-Math.exp(-18*Math.min(dt,1/30));
  const cap = 4*Math.min(dt,1/30); let contacts=0;
  // The live roster is already capped; axis broad-phase avoids distant pair work.
  for(let i=0;i<pack.length;i++) {
    const a=pack[i];
    for(let j=i+1;j<pack.length;j++) {
      const b=pack[j], ma=movable(a), mb=movable(b); if(!ma&&!mb)continue;
      let dx=b.pos.x-a.pos.x,dz=b.pos.z-a.pos.z;
      const min=(radius(a)+radius(b))*.92;
      if(Math.abs(dx)>=min||Math.abs(dz)>=min)continue;
      const d=Math.hypot(dx,dz);if(d>=min)continue;
      if(d<.0001){const angle=(i*17+j*31)*2.399963;dx=Math.cos(angle);dz=Math.sin(angle);}else{dx/=d;dz/=d;}
      const push=Math.min(cap,(min-d)*gain)/(Number(ma)+Number(mb));
      if(ma)shift(a,-dx*push,-dz*push,world);if(mb)shift(b,dx*push,dz*push,world);contacts++;
    }
    if(valid(player)&&movable(a)) {
      let dx=a.pos.x-player.pos.x,dz=a.pos.z-player.pos.z,d=Math.hypot(dx,dz);
      const min=(radius(a)+radius(player))*.9;
      if(d<min){if(d<.0001){dx=Math.cos(i*2.399963);dz=Math.sin(i*2.399963);}else{dx/=d;dz/=d;}
        shift(a,dx*Math.min(cap,(min-d)*gain),dz*Math.min(cap,(min-d)*gain),world);contacts++;}
    }
  }
  return contacts;
}
