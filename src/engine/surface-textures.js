import * as THREE from 'three';

// Shared immutable GUI-authored surface maps. Instances own materials, not maps.
/** @type {Record<string, THREE.Texture>} */
export const SURFACE_TEXTURES = {};
let pending;
export function preloadSurfaceTextures() {
  if (pending) return pending;
  const loader = new THREE.TextureLoader();
  pending = Promise.all(['sanctum-stone', 'hero-weave', 'forged-metal', 'oath-sanctum'].map(async name => {
    const texture = await loader.loadAsync(`/img/materials-crafted/${name}.webp`);
    texture.name = `GUI_${name}`;
    texture.wrapS = texture.wrapT = name === 'oath-sanctum' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.colorSpace = ['sanctum-stone', 'oath-sanctum'].includes(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    SURFACE_TEXTURES[name] = texture;
  }));
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
