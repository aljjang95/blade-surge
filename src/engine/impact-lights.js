import { Color, PointLight } from 'three';

// 타격 빛은 원색 그대로가 아니라 따뜻한 크림색을 조금 섞어 동화풍의 부드러운 번쩍임으로 만든다.
const SOFT_WARM = new Color(1, 0.93, 0.8), SOFT_MIX = 0.18;

/** Keep the lighting shader layout stable while impact lights fade in and out. */
export class ImpactLights {
  constructor(scene, capacity = 4) {
    this.enabled = true;
    this.slots = Array.from({ length: capacity }, () => {
      const light = new PointLight(0xffffff, 0, 1, 2);
      scene.add(light);
      return { light, t: 0, life: 0, i0: 0 };
    });
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.clear();
    // A quality-setting change can change shaders; individual casts must not.
    for (const slot of this.slots) slot.light.visible = enabled;
  }
  emit(pos, color, intensity, distance, life) {
    if (!this.enabled || !(life > 0) || !(intensity > 0)) return;
    const slot = this.slots.reduce((best, current) => {
      const strength = (s) => s.life > s.t ? s.i0 * (1 - s.t / s.life) ** 2 : 0;
      return strength(current) < strength(best) ? current : best;
    });
    slot.t = 0; slot.life = life; slot.i0 = intensity;
    slot.light.position.copy(pos); slot.light.position.y += 1;
    slot.light.color.set(color).lerp(SOFT_WARM, SOFT_MIX); slot.light.distance = distance; slot.light.intensity = intensity;
  }
  update(dt) {
    for (const slot of this.slots) {
      slot.t += dt;
      slot.light.intensity = slot.life > slot.t ? slot.i0 * (1 - slot.t / slot.life) ** 2 : 0;
    }
  }
  clear() {
    for (const slot of this.slots) { slot.t = slot.life = slot.i0 = 0; slot.light.intensity = 0; }
  }
}
