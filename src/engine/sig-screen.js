import * as THREE from 'three';

/**
 * 화면 가로 진행 표식(서명 공용 원시, 2026-10-30). 정면(뒤에서 앞을 보는) 카메라에서는 영웅 앞으로 뻗는 선·표식이 원근으로
 * 영웅 위 좁은 세로 띠에 몰려 '얼마나 나아갔나'가 읽히지 않는다(궁수 질풍·연속 관통). 그래서 진행 경로 위 n 곳에 화면 가로축
 * (카메라 오른쪽을 바닥에 눕힌 축)으로 그어지는 빗장을 화살이 그 지점을 지나는 순간 차례로 켠다. 빗장 폭은 경로가 화면 안쪽을 향할수록
 * (몰림이 심할수록) 넓히고, 먼 곳일수록 조금 더 넓혀 원근 축소를 상쇄한다. 경로가 화면 가로로 누운 경우엔 짧게 줄어 경로와 겹친다.
 * 인스턴스 층의 beam 만 쓰고(드로우콜 0 추가) 할당·Math.random 이 없다. 카메라가 없으면(테스트) 경로에 수직인 축을 쓴다.
 */
const _r = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Vector3();

/** 카메라 시선을 바닥에 눕힌 단위 벡터(out). 카메라가 없거나 수직으로 내려다보면 null. */
export function cameraGroundForward(camera, out) {
  const e = camera?.matrixWorld?.elements;
  if (!e) return null;
  out.set(-e[8], 0, -e[10]);
  const l = out.length();
  return l > 1e-4 ? out.multiplyScalar(1 / l) : null;
}

/**
 * @param {any} impact 인스턴스 임팩트 층 @param {any} camera @param {THREE.Vector3} from 경로 시작(바닥) @param {THREE.Vector3} f 진행 방향(수평 단위)
 * @param {number} d0 첫 빗장 거리(m) @param {number} d1 마지막 빗장 거리(m)
 * @param {{ n?: number, speed?: number, half?: number, width?: number, life?: number, delay?: number, colors?: number[], y?: number }} [o]
 * @returns {number} 쓴 칸 수
 */
export function screenSweep(impact, camera, from, f, d0, d1, { n = 4, speed = 28, half = 1.6, width = .18, life = .42, delay = 0, colors = [0xffffff], y = .1 } = {}) {
  if (typeof impact?.beam !== 'function' || n < 1) return 0;
  const cf = cameraGroundForward(camera, _c);
  // 화면 오른쪽(바닥): 카메라 시선 × 위. 카메라가 없으면 진행 방향에 수직.
  if (cf) _r.set(-cf.z, 0, cf.x); else _r.set(-f.z, 0, f.x);
  const into = cf ? Math.abs(f.x * cf.x + f.z * cf.z) : 1; // 1 = 화면 안쪽으로 곧장(가장 심한 몰림)
  let used = 0;
  for (let k = 0; k < n; k++) {
    const d = n === 1 ? d1 : d0 + (d1 - d0) * k / (n - 1);
    const w = half * (.35 + .65 * into) * (1 + .12 * k), s = k % 2 ? -1 : 1; // 번갈아 좌→우·우→좌로 쓸어 지그재그 진행
    _p.copy(from).addScaledVector(f, d); _p.y = y;
    _p.addScaledVector(_r, -s * w); _m.copy(_r).multiplyScalar(s);
    if (impact.beam(_p, _m, w * 2, colors[k % colors.length], { speed: w * 2 / .08, tail: w * 1.2, width, fade: life, delay: delay + d / speed })) used++;
  }
  return used;
}
