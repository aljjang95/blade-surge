import * as THREE from 'three';
import { PARTY_VISUALS, PARTY_VISUAL_LIMIT, PARTY_VISUAL_BUDGET, capturePartyVisual, validPartyVisual } from './visual-protocol.js';

/** Only outer calls are captured: castCircle's internal groundTex is not sent twice. */
export function capturePartyEffects(fx, record, clock) {
  const methods = new Map();
  return new Proxy(fx, {get(target,key) {
    const value = Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    if (!methods.has(key)) methods.set(key,(...args)=>{
      const visual = capturePartyVisual(key,args,clock());
      const result = Reflect.apply(value,target,args);
      if (visual) record(visual);
      return result;
    });
    return methods.get(key);
  }});
}

/** Reuse the game's renderer, with a separate bounded budget and no simulation calls. */
export class PartyVisualPlayer {
  constructor(fx) { this.fx=fx; this.clock=0; this.active=[]; }
  update(dt) {
    this.clock += Math.max(0,Math.min(.1,dt));
    this.active = this.active.filter(v=>v.until>this.clock);
  }
  play(visuals, elapsed, reducedMotion=false) {
    if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
    let used=this.active.reduce((sum,v)=>sum+v.weight,0), count=0;
    for (const v of (Array.isArray(visuals)?visuals:[]).slice(0,PARTY_VISUAL_LIMIT)) {
      if (!validPartyVisual(v)) continue;
      const life = v.options.life - Math.max(0,elapsed-v.at);
      if (life <= 0) continue;
      // Reduced motion keeps location cues, without bolts, bursts or moving slashes.
      if (reducedMotion && !['castCircle','groundTex'].includes(v.kind)) continue;
      const weight = PARTY_VISUALS[v.kind].weight;
      const limit=['castCircle','groundTex'].includes(v.kind)?PARTY_VISUAL_BUDGET:PARTY_VISUAL_BUDGET-12;
      if (used+weight>limit) continue;
      const pos=new THREE.Vector3(v.pos.x,v.pos.y,v.pos.z), options={...v.options,life};
      if (reducedMotion) {
        const radius = options.radius ?? options.r1;
        this.fx.groundTex(pos,v.texture || (options.demon?'circle_demon':'circle_gold'),v.color,
          {r0:radius,r1:radius,life,spin:0,y:.07,fadeIn:.15,hold:life});
      } else {
        const layout=PARTY_VISUALS[v.kind].layout;
        if (layout==='target') this.fx[v.kind](pos,new THREE.Vector3(v.target.x,v.target.y,v.target.z),v.color,options);
        else if (layout==='texture') this.fx[v.kind](pos,v.texture,v.color,options);
        else if (layout==='color') this.fx[v.kind](pos,v.color,options);
        else this.fx[v.kind](pos,{...options,color:v.color});
      }
      this.active.push({until:this.clock+life,weight});used+=weight;count++;
    }
    return count;
  }
  clear() { this.active.length=0; }
}
