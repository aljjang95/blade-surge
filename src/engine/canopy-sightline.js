import { Plane } from 'three';
import { BattleOcclusion } from './battle-occlusion.js';

/** 광장의 두 수관만 영웅과 카메라 사이에서 좁게 잘라 줄기·주변 숲을 보존한다. */
export class CanopySightline extends BattleOcclusion {
  constructor() {
    super();
    this.planes[1].constant = 2.15;
    this.planes.push(new Plane(), new Plane());
  }
  update(cameraPosition, active = true) {
    super.update(cameraPosition, active);
    if (!active || !this.hasTarget) return;
    const x = this.planes[0].normal.z, z = -this.planes[0].normal.x;
    const center = x * this.target.x + z * this.target.z;
    this.planes[2].setComponents(x, 0, z, -center - 1.1);
    this.planes[3].setComponents(-x, 0, -z, center - 1.1);
  }
}
