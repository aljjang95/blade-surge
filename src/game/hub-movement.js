import * as THREE from 'three';
import { cameraRelativeMove } from '../engine/camera-control.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The plaza has its own navigation boundary; battle actors and resources stay untouched. */
export class HubMovement {
  /** @param {{bounds: {minX: number, maxX: number, minZ: number, maxZ: number}, spawn?: {x?: number, y?: number, z?: number}, hotspots?: ReadonlyArray<any>, blockers?: ReadonlyArray<any>, speed?: number, radius?: number}} options */
  constructor({ bounds, spawn = {}, hotspots = [], blockers = [], speed = 4.2, radius = .34 }) {
    this.bounds = bounds;
    this.spawn = { x: finite(spawn.x), y: finite(spawn.y), z: finite(spawn.z) };
    this.hotspots = hotspots; this.blockers = blockers;
    this.speed = speed; this.radius = radius;
    this.position = { ...this.spawn };
    this.showcase = null; this.animation = null; this.moving = false; this.nearest = null;
  }

  /** Hero selection keeps the owner's location; returning from battle can explicitly reset it. */
  attach(showcase) {
    this.showcase = showcase; this.animation = null; this.moving = false;
    this._syncPosition(); this._findNearest();
    return this;
  }

  detach() {
    this._setMoving(false);
    this.showcase = null; this.animation = null; this.nearest = null;
  }

  reset(spawn = this.spawn) {
    this.position.x = finite(spawn.x, this.spawn.x);
    this.position.y = finite(spawn.y, this.spawn.y);
    this.position.z = finite(spawn.z, this.spawn.z);
    this._bound(this.position); this._syncPosition(); this._setMoving(false); this._findNearest();
  }

  /** Screen up remains screen up even when the following camera changes its bearing. */
  update(dt, move = {}, cameraYaw = 0) {
    if (!this.showcase) { this.moving = false; this.nearest = null; return this; }
    let x = finite(move.x), y = finite(move.y);
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    const world = cameraRelativeMove(x, y, cameraYaw);
    // Pause/resume gaps cannot teleport through a pillar or across the plaza.
    const seconds = clamp(finite(dt), 0, .1), distance = this.speed * seconds;
    const dx = world.x * distance, dz = world.y * distance;
    const oldX = this.position.x, oldZ = this.position.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.radius * .5)));
    for (let i = 0; i < steps; i++) {
      // Axis separation permits a controlled slide along NPCs, stalls and gate pillars.
      const nextX = clamp(this.position.x + dx / steps, this.bounds.minX + this.radius, this.bounds.maxX - this.radius);
      if (this._walkable(nextX, this.position.z)) this.position.x = nextX;
      const nextZ = clamp(this.position.z + dz / steps, this.bounds.minZ + this.radius, this.bounds.maxZ - this.radius);
      if (this._walkable(this.position.x, nextZ)) this.position.z = nextZ;
    }
    const movedX = this.position.x - oldX, movedZ = this.position.z - oldZ;
    const moving = Math.hypot(movedX, movedZ) > .0001;
    if (moving) this.showcase.root.rotation.y = Math.atan2(world.x, world.y);
    this._setMoving(moving); this._syncPosition(); this._findNearest();
    return this;
  }

  _bound(position) {
    position.x = clamp(position.x, this.bounds.minX + this.radius, this.bounds.maxX - this.radius);
    position.z = clamp(position.z, this.bounds.minZ + this.radius, this.bounds.maxZ - this.radius);
  }

  _walkable(x, z) {
    for (const blocker of this.blockers) {
      if (blocker.type === 'rect') {
        if (x > blocker.minX - this.radius && x < blocker.maxX + this.radius &&
            z > blocker.minZ - this.radius && z < blocker.maxZ + this.radius) return false;
      } else if (Math.hypot(x - blocker.x, z - blocker.z) < blocker.radius + this.radius) return false;
    }
    return true;
  }

  _syncPosition() {
    const root = this.showcase?.root;
    if (root) root.position.set(this.position.x, this.position.y, this.position.z);
  }

  _findNearest() {
    this.nearest = null; let closest = Infinity;
    for (const hotspot of this.hotspots) {
      const distance = Math.hypot(this.position.x - hotspot.x, this.position.z - hotspot.z);
      if (distance <= hotspot.interactionRadius && distance < closest) { closest = distance; this.nearest = hotspot; }
    }
    return this.nearest;
  }

  _setMoving(moving) {
    if (moving === this.moving) return;
    this.moving = moving;
    const s = this.showcase;
    if (!s?.mixer || !s.clips) return;
    const clip = s.clips[moving ? 'Running_A' : 'Idle'] || s.clips.Idle;
    if (!clip) return;
    const previous = s.gesture || this.animation || (s.clips.Idle && s.mixer.clipAction(s.clips.Idle));
    const next = s.mixer.clipAction(clip);
    s.gesture = null; s.gestureT = 0; s.t = 0;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous && previous !== next) next.crossFadeFrom(previous, .16, false);
    this.animation = next;
  }
}
