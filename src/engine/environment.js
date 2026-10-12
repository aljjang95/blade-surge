import { BackSide, BoxGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, Scene, SphereGeometry } from 'three';

/**
 * 캐릭터용 반사 환경 — 회색 스튜디오 대신 동화풍 하늘을 쓴다.
 * 위는 맑은 하늘색, 지평선은 따뜻한 크림, 아래는 분홍빛 땅. 오른쪽 위의 따뜻한 키 패널과 왼쪽 뒤의 시원한 림 패널이
 * 금속·광택 재질에 부드러운 하이라이트와 가장자리 빛을 남긴다. PMREM 으로 한 번만 구워서 비용은 없다.
 */
export function createStorybookEnvironment() {
  const scene = new Scene();
  const sky = new SphereGeometry(50, 32, 16), count = sky.getAttribute('position').count, colors = [];
  const top = new Color(0.52, 0.72, 1.0), horizon = new Color(1.0, 0.94, 0.82), ground = new Color(0.6, 0.46, 0.46), c = new Color();
  for (let i = 0; i < count; i++) {
    const y = sky.getAttribute('position').getY(i) / 50;
    if (y >= 0) c.copy(horizon).lerp(top, Math.pow(y, 0.7)); else c.copy(horizon).lerp(ground, Math.min(1, -y * 1.6));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute('color', new Float32BufferAttribute(colors, 3));
  scene.add(new Mesh(sky, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const panel = (color, intensity, size, x, y, z) => {
    const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    mesh.position.set(x, y, z); mesh.lookAt(0, 0, 0); scene.add(mesh);
  };
  panel(0xffe2b0, 6, [14, 14, 0.5], 18, 26, 16);     // 따뜻한 키
  panel(0x9cc8ff, 4.5, [18, 8, 0.5], -22, 12, -24);  // 시원한 림
  panel(0xffc6e0, 1.6, [24, 6, 0.5], 0, 4, 28);      // 정면 아래 분홍 바운스
  return scene;
}

/** Rebind both live instances and spawn templates before disposing a GPU-only environment. */
export function rebindEnvironment(root, previous, next) {
  root?.traverse(object => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      if (previous && material.envMap === previous) material.envMap = next;
      material.needsUpdate = true;
    }
  });
}
