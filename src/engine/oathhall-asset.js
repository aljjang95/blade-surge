import { MeshBasicMaterial, FrontSide } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const ASSET='/models/oathhall-v1/oathhall-v1.glb';
let template=null, pending=null;
/** Optional visual enhancement. A bounded failure never prevents playing. */
export function preloadOathHall(fetcher=globalThis.fetch) {
 if(pending)return pending;
 pending=(async()=>{
  try {
   const response=await fetcher(ASSET,{signal:AbortSignal.timeout(4500)});
   if(!response.ok)throw Error('hall asset unavailable');
   const bytes=await response.arrayBuffer();if(bytes.byteLength>4000000)throw Error('hall exceeds budget');
   const gltf=await new GLTFLoader().parseAsync(bytes,'');
   template=gltf.scene;return true;
  }catch{return false;}
 })();return pending;
}
/** Cached source is never rendered. Each lobby owns its cloned geometry/materials. */
export function cloneOathHall(source=template) {
 if(!source)return null;
 const root=source.clone(true),geometries=new Map(),materials=new Map();
 root.name='TLL_OathHall_BlenderV1';root.userData.visualVersion='oathhall-v1';
 root.traverse(o=>{if(!o.isMesh)return;
  if(!geometries.has(o.geometry))geometries.set(o.geometry,o.geometry.clone());o.geometry=geometries.get(o.geometry);
  const clone=m=>{
   if(!materials.has(m)){
    // Distant silhouettes are authored colour planes, not dynamic-light surfaces.
    const next=/^08 /.test(m.name)?new MeshBasicMaterial({color:m.color,side:m.side,fog:true}):m.clone();
    next.name=m.name;
    // Closed stonework needs no back faces. Cloth/heraldry/foliage stay two-sided.
    if(/^(01|02|05|06) /.test(m.name))next.side=FrontSide;
    materials.set(m,next);
   }return materials.get(m);
  };
  o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
  const first=Array.isArray(o.material)?o.material[0]:o.material;
  o.castShadow=!/^(07|08) /.test(first.name);o.receiveShadow=!first.isMeshBasicMaterial;
 });
 let disposed=false;root.userData.dispose=()=>{if(disposed)return;disposed=true;for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();root.removeFromParent();};
 return root;
}
