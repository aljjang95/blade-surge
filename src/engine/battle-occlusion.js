import { Plane, Vector3 } from 'three';

/** A shared cutaway for opaque dungeon architecture. Keep the floor-level boundary
 * readable while removing upper walls on the camera side of the actual hero.
 * Materials remain owned by Arena; this helper owns only two reusable planes. */
export class BattleOcclusion {
  constructor() {
    this.target = new Vector3();
    this.planes = [new Plane(), new Plane(new Vector3(0, -1, 0), .35)];
    this.reset();
  }
  bind(material) {
    material.clippingPlanes = this.planes;
    // Three discards only points in the negative half-space of BOTH planes.
    material.clipIntersection = true;
  }
  setTarget(position) {
    this.hasTarget = !!position && Number.isFinite(position.x) && Number.isFinite(position.z);
    if (this.hasTarget) this.target.set(position.x, 0, position.z);
  }
  reset() {
    this.hasTarget = false;
    this.disable();
  }
  disable() {
    this.planes[0].setComponents(0, 1, 0, 1e9);
  }
  update(cameraPosition, active = true) {
    if (!active || !this.hasTarget) { this.disable(); return; }
    const dx = cameraPosition.x - this.target.x, dz = cameraPosition.z - this.target.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 1e-5) { this.disable(); return; }
    const x = dx / length, z = dz / length;
    // Include the hero's body radius even when camera following lags behind a dash.
    this.planes[0].setComponents(-x, 0, -z, x * this.target.x + z * this.target.z - .8);
  }
}
