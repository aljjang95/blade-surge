import * as THREE from 'three';

// Shared immutable GUI-authored surface maps. Instances own materials, not maps.
/** @type {Record<string, THREE.Texture>} */
export const SURFACE_TEXTURES = {};
let pending;
export function preloadSurfaceTextures() {
  if (pending) return pending;
  const loader = new THREE.TextureLoader();
  const crafted = ['sanctum-stone', 'hero-weave', 'forged-metal', 'oath-sanctum'].map(async name => {
    const texture = await loader.loadAsync(`/img/materials-crafted/${name}.webp`);
    texture.name = `GUI_${name}`;
    texture.wrapS = texture.wrapT = name === 'oath-sanctum' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.colorSpace = ['sanctum-stone', 'oath-sanctum'].includes(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    SURFACE_TEXTURES[name] = texture;
  });
  const dungeon = [
    ['dungeon-stone-diffuse', 'polyhaven-medieval-wall-02-diffuse-1k.jpg', THREE.SRGBColorSpace],
    ['dungeon-stone-normal', 'polyhaven-medieval-wall-02-normal-gl-1k.jpg', THREE.NoColorSpace],
    ['dungeon-stone-roughness', 'polyhaven-medieval-wall-02-rough-1k.jpg', THREE.NoColorSpace],
  ].map(async ([name, file, colorSpace]) => {
    const texture = await loader.loadAsync(`/img/materials-cc0/${file}`);
    texture.name = `CC0_${name}`; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.35, 1.35); texture.anisotropy = 4; texture.colorSpace = colorSpace;
    SURFACE_TEXTURES[name] = texture;
  });
  pending = Promise.all([...crafted, ...dungeon]);
  return pending;
}

// Stable bind-pose projection; never project from a moving, animated pose.
export function projectSurfaceUV(geometry, density = 2) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n?.getX(i) || 0), ny = Math.abs(n?.getY(i) || 0), nz = Math.abs(n?.getZ(i) || 0);
    uv[i * 2] = (nx > nz && nx > ny ? p.getZ(i) : p.getX(i)) * density;
    uv[i * 2 + 1] = (ny > nx && ny > nz ? p.getZ(i) : p.getY(i)) * density;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function surfaceRole(name = '') {
  if (/skin|porcelain|hair|gemstone/i.test(name)) return 'skin';
  return /metal|steel|gold|brass|enamel|forged/i.test(name) ? 'metal' : 'cloth';
}

export function applySurfaceDetail(material, role = 'cloth') {
  const key = role === 'stone' ? 'sanctum-stone' : role === 'metal' ? 'forged-metal' : 'hero-weave';
  const texture = SURFACE_TEXTURES[key];
  if (!texture || role === 'skin') return material;
  // Linear neutral albedo retains the authored hue and restores surface detail
  // under the bright lobby key light. Skin and face materials are excluded.
  material.map = texture;
  if (role === 'metal') material.roughnessMap = texture;
  material.bumpMap = texture;
  material.bumpScale = role === 'stone' ? .045 : role === 'metal' ? .018 : .028;
  material.userData.surfaceTexture = key;
  material.needsUpdate = true;
  return material;
}


export function applyDungeonStoneDetail(material) {
  const diffuse = SURFACE_TEXTURES['dungeon-stone-diffuse'];
  const normal = SURFACE_TEXTURES['dungeon-stone-normal'];
  const roughness = SURFACE_TEXTURES['dungeon-stone-roughness'];
  if (!diffuse || !normal || !roughness) return applySurfaceDetail(material, 'stone');
  material.map = diffuse; material.normalMap = normal; material.roughnessMap = roughness;
  material.normalScale?.set(.45, .45); material.roughness = .88; material.metalness = .02;
  material.userData.surfaceTexture = 'polyhaven-medieval-wall-02';
  material.needsUpdate = true;
  return material;
}
