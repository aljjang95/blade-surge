import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Original, runtime-authored citadel surroundings. Six static batches, no textures,
 * lights, particle emitters or combat navigation changes. */
export function buildLobbyWorld() {
 const root=new THREE.Group();root.name='TLL_CitadelWorld';
 const colours=[0x576e70,0x97a69b,0x36565c,0xa58756,0x4a6960];
 const mats=colours.map(color=>new THREE.MeshLambertMaterial({color,flatShading:true}));
 const bins=mats.map(()=>[]),tr=new THREE.Object3D();let parts=0;
 function add(g,m,x,y,z,rx=0,ry=0){tr.position.set(x,y,z);tr.rotation.set(rx,ry,0);tr.updateMatrix();g.applyMatrix4(tr.matrix);bins[m].push(g);parts++;}
 const box=(w,h,d,m,x,y,z,ry=0)=>add(new THREE.BoxGeometry(w,h,d),m,x,y,z,0,ry);
 const col=(r,h,m,x,y,z,n=10)=>add(new THREE.CylinderGeometry(r,r*1.12,h,n),m,x,y,z);
 const arch=(x,z,w,h,ry=0)=>{for(const sign of [-1,1]){const dx=sign*w*.5;box(.42,h,.55,1,x+dx*Math.cos(ry),h*.5-.2,z-dx*Math.sin(ry),ry);}add(new THREE.TorusGeometry(w*.5,.22,5,24,Math.PI),1,x,h-.2,z,0,ry);};
 // Clear, continuous apron around the original hero dais, then a bridge into the city.
 col(12,.38,0,0,-.68,0,64);col(11.7,.12,1,0,-.45,0,64);
 box(6,.4,25,0,0,-.72,21);box(5.7,.10,25,1,0,-.46,21);
 for(let z=10;z<=32;z+=2){box(5.5,.025,.055,3,0,-.4,z);for(const side of [-1,1]){col(.14,1.1,1,side*2.9,.08,z);box(.22,.18,2.1,3,side*2.9,.68,z+1);}}
 for(const z of [15,24,33]){arch(0,z,6.8,4.2);for(const side of [-1,1]){col(.7,6,0,side*4,2.4,z,8);col(.85,.22,1,side*4,5.5,z,8);add(new THREE.ConeGeometry(.95,1.7,8),2,side*4,6.4,z);}}
 // Repeated terraces recede in actual depth, including the formerly empty front hemisphere.
 for(let i=0;i<24;i++){
  const a=i*Math.PI/12,r=24+(i%3)*4,x=Math.sin(a)*r,z=Math.cos(a)*r;
  const h=3.5+(i*7%9)*.55,w=2.8+(i%3)*.4;
  box(w+1,1,w+1,0,x,-1.2,z,a);box(w,h,w, i%3===0?0:2,x,h*.5-.7,z,a);
  col(w*.55,.25,1,x,h-.6,z,8);add(new THREE.ConeGeometry(w*.7,2.5,8),2,x,h+.65,z);
  // Inlaid windows and balcony cornices read as architecture rather than a blank wall.
  for(let floor=1;floor<h-1;floor+=1.4)for(const sign of [-1,1]){box(.22,.65,.04,3,x+sign*.6*Math.cos(a)+Math.sin(a)*(w*.51),floor,z-sign*.6*Math.sin(a)+Math.cos(a)*(w*.51),a);}
  if(i%2===0){col(w*.9,5,2,x,-3.2,z,7);add(new THREE.ConeGeometry(w*.9,7,7),0,x,-8.8,z,Math.PI);}
 }
 for(const side of [-1,1]){box(13,.4,4,0,side*15,-.66,2);arch(side*15,2,4.2,4.4,Math.PI/2);for(let j=0;j<5;j++){col(.16,1,1,side*(10+j*2),0,4);box(2.2,.16,.25,3,side*(10+j*2),.6,4);}}
 for(let i=0;i<18;i++){const a=i*Math.PI/9,r=52,x=Math.sin(a)*r,z=Math.cos(a)*r;const h=9+(i*11%13);add(new THREE.ConeGeometry(8,h,5),2,x,h*.5-5,z);if(i%2===0)add(new THREE.IcosahedronGeometry(3,0),4,x,3,z);}
 for(let i=0;i<bins.length;i++){const geometry=mergeGeometries(bins[i]);bins[i].forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,mats[i]);mesh.name='Citadel_static_'+i;mesh.receiveShadow=false;mesh.castShadow=false;root.add(mesh);}
 const sky=new THREE.SphereGeometry(95,32,16),p=sky.attributes.position,c=[];
 const horizon=new THREE.Color(0x91afb2),zenith=new THREE.Color(0x284b6d),v=new THREE.Color();
 for(let i=0;i<p.count;i++){v.copy(horizon).lerp(zenith,Math.min(1,Math.max(0,p.getY(i)/65)));c.push(v.r,v.g,v.b);}
 sky.setAttribute('color',new THREE.Float32BufferAttribute(c,3));const sm=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,fog:false,depthWrite:false});
 const dome=new THREE.Mesh(sky,sm);dome.name='Citadel_sky';dome.renderOrder=-10;root.add(dome);
 root.userData={version:'citadel-world-v1',parts,batches:6,interactive:false};let disposed=false;
 root.userData.dispose=()=>{if(disposed)return;disposed=true;root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});root.removeFromParent();};
 return root;
}
