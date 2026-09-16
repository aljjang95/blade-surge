import { MeshBasicMaterial, MeshLambertMaterial, FrontSide } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const ASSET='/models/sanctuary-v2/sanctuary-v2.glb';
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
 const v2=!!root.getObjectByName('TLL_SanctuaryV2_0');
 root.name=v2?'TLL_SanctuaryV2':'TLL_OathHall_BlenderV1';root.userData.visualVersion=v2?'sanctuary-v2':'oathhall-v1';
 root.traverse(o=>{if(!o.isMesh)return;
  if(!geometries.has(o.geometry))geometries.set(o.geometry,o.geometry.clone());o.geometry=geometries.get(o.geometry);
  const clone=m=>{
   if(!materials.has(m)){
    // Distant silhouettes are authored colour planes, not dynamic-light surfaces.
    const unlit=/^08 |Amber lamps|Glass and distant light/.test(m.name);
    const stone=/Night limestone|Ivory carved stone|Blue shadow stone/.test(m.name);
    const opts={color:m.color,side:m.side,vertexColors:m.vertexColors,fog:true};
    const next=unlit?new MeshBasicMaterial(opts):stone?new MeshLambertMaterial(opts):m.clone();
    next.name=m.name;
    // Closed stonework needs no back faces. Cloth/heraldry/foliage stay two-sided.
    if(/^(01|02|05|06) |Night limestone|Ivory carved stone|Blue shadow stone/.test(m.name))next.side=FrontSide;
    materials.set(m,next);
   }return materials.get(m);
  };
  o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
  const first=Array.isArray(o.material)?o.material[0]:o.material;
  o.castShadow=!/^(07|08) |Evergreen|Amber lamps|Glass and distant light/.test(first.name);o.receiveShadow=!first.isMeshBasicMaterial;
 });
 let disposed=false;root.userData.dispose=()=>{if(disposed)return;disposed=true;for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();root.removeFromParent();};
 return root;
}
