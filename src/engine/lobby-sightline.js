import { Raycaster, Vector3 } from 'three';
/** Change only camera height when a requested lobby orbit hides the actual hero.
 * Solved once per changed view, never by fading the hero or cloning its body. */
export class LobbySightline {
 constructor(){this.ray=new Raycaster();this.target=new Vector3();this.dir=new Vector3();this.key='';this.lift=0;this.clear=true;}
 solve(position,anchor,meshes=[],now=Infinity){
  const key=[position.x,position.y,position.z,anchor.x,anchor.z,meshes[0]?.uuid].join(':');
  if(this.key===key)return this.lift;
  // Detailed hall raycasts run at most 8Hz during a continuous touch orbit.
  // Leave the key dirty so the final settled view is solved on a later frame.
  if(Number.isFinite(now)&&meshes[0]===this.mesh&&now-(this.lastSolve??-Infinity)<125)return this.lift;
  this.lastSolve=now;this.mesh=meshes[0];
  this.key=key;this.lift=0;this.clear=true;if(!meshes.length)return 0;
  for(const o of meshes)o.updateWorldMatrix(true,false);
  const candidate=position.clone();
  const blocked=()=>[.85,1.5,2.05].some(height=>{
   this.target.set(anchor.x,anchor.y+height,anchor.z);this.dir.copy(this.target).sub(candidate);
   this.ray.near=.08;this.ray.far=this.dir.length()-.2;this.ray.set(candidate,this.dir.normalize());
   return this.ray.intersectObjects(meshes,false).length>0;
  });
  for(let step=0;step<=8;step++){
   this.lift=step*.4;candidate.y=position.y+this.lift;
   if(!blocked()){this.clear=true;return this.lift;}
  }
  this.clear=false;return this.lift;
 }
}
