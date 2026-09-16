/** Apply only to instance-owned cloned materials; geometry, albedo and maps remain intact. */
export function finishOathKnightMaterial(material) {
 if(!material?.userData?.tllAuthored)return material;
 if(material.name==='TLL_forged-metal'){
  material.metalness=.42;material.roughness=.48;material.envMapIntensity=.65;
  if(material.bumpMap)material.bumpScale=.008;
 }else if(material.name==='TLL_woven-cloth'){
  material.metalness=0;material.roughness=.94;material.envMapIntensity=.25;
  if(material.bumpMap)material.bumpScale=.01;
 }else if(material.name==='TLL_skin'){
  material.metalness=0;material.roughness=.9;material.envMapIntensity=.35;
 }else return material;
 material.userData.oathFinish='v1';return material;
}
