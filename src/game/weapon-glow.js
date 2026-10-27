import * as THREE from 'three';

// 무기 강화 빛: 칼날 광륜(가산 스프라이트 1장)과 칼날 불씨(기존 fx.glow 파티클 풀).
// 광륜은 영웅당 드로우콜 1개, 불씨는 이미 있는 풀을 써서 드로우콜·재질을 늘리지 않는다. 예산은 docs/WEAPON_GLOW.md.

let haloTexture = null;
// DOM 없이도(테스트·워커) 만들 수 있게 캔버스 대신 데이터 텍스처로 둥근 감쇠를 굽는다.
function weaponHaloTexture() {
  if (haloTexture) return haloTexture;
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1;
    // 칼날 방향(세로)으로 긴 타원. 가운데가 밝고 가장자리는 0.
    const r = Math.sqrt(dx * dx * 2.6 + dy * dy), a = Math.max(0, 1 - r) ** 2;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  haloTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  haloTexture.magFilter = haloTexture.minFilter = THREE.LinearFilter;
  haloTexture.needsUpdate = true;
  return haloTexture;
}

const _box = new THREE.Box3(), _center = new THREE.Vector3(), _size = new THREE.Vector3(), _scale = new THREE.Vector3();

/** 보이는 오른손 무기를 고른다: 병기고 전용 무기 → 등급 무기 노드(보조손 제외) → 활. */
export function findWeaponAnchor(model, weaponNodes = []) {
  let armory = null;
  model.traverse((o) => { if (!armory && o.userData.armoryItem && o.name === 'Armory_weapon') armory = o; });
  if (armory) return armory;
  const visible = (o) => { for (let p = o; p && p !== model; p = p.parent) if (!p.visible) return false; return true; };
  for (const name of [...weaponNodes].sort((a, b) => /Offhand$/.test(a) - /Offhand$/.test(b))) {
    const node = model.getObjectByName(name);
    if (node && visible(node)) return node;
  }
  const bow = model.getObjectByName('Bow');
  return bow && visible(bow) ? bow : null;
}

/** 무기 광륜을 단계에 맞춰 붙이거나 뗀다. tier.halo 가 0 이면 떼기만 한다. */
export function syncWeaponHalo(model, tier, color, weaponNodes) {
  const anchor = tier?.halo > 0 ? findWeaponAnchor(model, weaponNodes) : null;
  let halo = model.userData.weaponHalo;
  // 경계 상자에 광륜 자신이 들어가지 않게 먼저 뗀다.
  halo?.removeFromParent();
  if (!anchor) { removeWeaponHalo(model); return null; }
  model.updateWorldMatrix(true, true);
  _box.setFromObject(anchor, true);
  if (_box.isEmpty()) { removeWeaponHalo(model); return null; }
  _box.getCenter(_center); _box.getSize(_size);
  anchor.getWorldScale(_scale);
  const unit = Math.max(1e-4, Math.abs(_scale.x));
  if (!halo) {
    halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: weaponHaloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.name = 'WeaponHalo'; halo.renderOrder = 5; halo.raycast = () => {};
    halo.onBeforeRender = () => {
      const s = halo.userData;
      // 맥동은 화면 연출만(게임 상태와 무관). 움직임 줄이기 설정이면 고정 밝기.
      const pulse = s.still ? 1 : .8 + .2 * Math.sin(performance.now() * .004 * s.rate);
      halo.material.opacity = s.opacity * pulse;
    };
    model.userData.weaponHalo = halo;
  }
  anchor.add(halo);
  halo.position.copy(anchor.worldToLocal(_center.clone()));
  const length = Math.max(_size.x, _size.y, _size.z) / unit;
  halo.scale.set(length * .55 * tier.haloScale, length * 1.1 * tier.haloScale, 1);
  halo.material.color.set(color);
  halo.userData.opacity = tier.halo; halo.userData.rate = tier.min >= 13 ? 1.6 : 1;
  halo.userData.still = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return halo;
}

export function removeWeaponHalo(model) {
  const halo = model.userData.weaponHalo;
  if (halo) { halo.removeFromParent(); halo.material.dispose(); delete model.userData.weaponHalo; }
}


const _at = new THREE.Vector3();
const _sparkColor = new THREE.Color();
/**
 * 칼날 불씨. state 는 호출자 소유 { t } 누적기. 광륜 위치(칼날 중심)에서 칼날 길이만큼 흩어 뿌린다.
 * 반환: 이번 프레임 뿌린 수.
 */
export function emitWeaponSparks(fx, model, look, dt, state) {
  const tier = look?.weapon?.glowTier, halo = model?.userData.weaponHalo;
  if (!fx?.glow || !tier?.spark || !halo?.parent) return 0;
  const rate = fx.lite ? tier.spark * .5 : tier.spark;
  state.t = (state.t || 0) + dt * rate;
  let n = 0;
  if (state.t < 1) return 0;
  halo.getWorldPosition(_at);
  const reach = halo.scale.y * Math.abs(halo.parent.getWorldScale(_scale).x) * .45;
  _sparkColor.set(look.weapon.color);
  while (state.t >= 1 && n < 4) {
    state.t -= 1; n++;
    const k = (Math.random() - .5) * 2;
    fx.glow.emit(_at.x + (Math.random() - .5) * .12, _at.y + k * reach, _at.z + (Math.random() - .5) * .12,
      (Math.random() - .5) * .4, .5 + Math.random() * .7, (Math.random() - .5) * .4,
      _sparkColor, .1 + Math.random() * .1 + (tier.min >= 13 ? .06 : 0), tier.sparkLife * (.7 + Math.random() * .6),
      { grav: -.6, drag: .96, shrink: .4 });
  }
  if (state.t > 1) state.t = 0;
  return n;
}
