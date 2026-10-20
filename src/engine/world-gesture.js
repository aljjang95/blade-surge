/** 화면 빈 곳 터치가 회전으로 인정되기 전 허용하는 흔들림(px). 탭과 드래그를 구분한다. */
export const WORLD_TOUCH_SLOP = 8;

/**
 * 빈 world 터치 최대 두 개를 대기 → 회전 → 핀치 → 남은 손가락 회전으로 추적한다.
 * 조이스틱·버튼처럼 다른 소유자의 터치는 호출자가 걸러서 넘기지 않는다.
 * move 결과는 dx/dy/ratio 필드에 담아 이벤트마다 객체를 만들지 않는다.
 */
export class WorldTouchGesture {
  constructor(slop = WORLD_TOUCH_SLOP) {
    this.slop = slop;
    /** @type {'idle' | 'pending' | 'rotate' | 'pinch'} */
    this.mode = 'idle';
    /** @type {null | {id: number, x: number, y: number, anchorX: number, anchorY: number, surface: any}} */
    this.first = null;
    /** @type {null | {id: number, x: number, y: number, anchorX: number, anchorY: number, surface: any}} */
    this.second = null;
    this.dx = 0; this.dy = 0; this.ratio = 1; this.distance = 1;
  }
  get size() { return (this.first ? 1 : 0) + (this.second ? 1 : 0); }
  get(id) { return this.first?.id === id ? this.first : this.second?.id === id ? this.second : null; }
  has(id) { return !!this.get(id); }
  /** @returns {'' | 'pending' | 'pinch'} 새 손가락의 역할. 빈 문자열이면 받지 않았다. */
  down(id, x, y, surface) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || this.has(id) || this.second) return '';
    const pointer = { id, x, y, anchorX: x, anchorY: y, surface };
    if (!this.first) { this.first = pointer; this.mode = 'pending'; this.dx = this.dy = 0; return 'pending'; }
    this.second = pointer; this.mode = 'pinch'; this.ratio = 1;
    this.distance = Math.max(1, Math.hypot(this.first.x - x, this.first.y - y));
    return 'pinch';
  }
  /** @returns {'' | 'pending' | 'rotate-start' | 'rotate' | 'pinch'} */
  move(id, x, y) {
    const pointer = this.get(id);
    if (!pointer || !Number.isFinite(x) || !Number.isFinite(y)) return '';
    pointer.x = x; pointer.y = y;
    if (this.mode === 'pinch') {
      if (!this.first || !this.second) return '';
      this.ratio = Math.max(1, Math.hypot(this.first.x - this.second.x, this.first.y - this.second.y)) / this.distance;
      return 'pinch';
    }
    let started = false;
    if (this.mode === 'pending') {
      const ox = x - pointer.anchorX, oy = y - pointer.anchorY, d = Math.hypot(ox, oy);
      if (d < this.slop) return 'pending';
      // 문턱만큼 기준점을 옮겨 회전이 시작되는 순간 시점이 튀지 않게 한다.
      pointer.anchorX += ox / d * this.slop; pointer.anchorY += oy / d * this.slop;
      this.mode = 'rotate'; started = true;
    }
    this.dx = x - pointer.anchorX; this.dy = y - pointer.anchorY;
    return started ? 'rotate-start' : 'rotate';
  }
  /**
   * 손가락 하나가 정상적으로 떨어졌다.
   * @returns {'' | 'end' | 'resume'} resume이면 남은 손가락이 현재 위치를 기준으로 바로 회전한다.
   */
  up(id) {
    const pointer = this.get(id);
    if (!pointer) return '';
    if (this.first && this.second) {
      const remaining = pointer === this.first ? this.second : this.first;
      this.first = remaining; this.second = null;
      remaining.anchorX = remaining.x; remaining.anchorY = remaining.y;
      this.mode = 'rotate'; this.dx = this.dy = 0; this.ratio = 1;
      return 'resume';
    }
    this.clear();
    return 'end';
  }
  clear() { this.first = this.second = null; this.mode = 'idle'; this.dx = this.dy = 0; this.ratio = 1; }
}
