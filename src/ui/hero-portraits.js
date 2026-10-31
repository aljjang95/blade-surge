import * as THREE from 'three';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';
import { heroBodyAppearance } from '../data/hero-library.js';
import { libraryAssets, libraryAssetForAvatar, pickHeroLibraryAsset, resolveAssetSource } from '../engine/library-assets.js';
import { spawnCharacter, disposeCharacter, preloadHeroBody } from '../engine/assets.js';
import { applyLook } from '../game/look.js';

const services = new WeakMap(), modelIds = new WeakMap();
let nextModelId = 0;
export const HERO_PORTRAIT_CACHE_LIMIT = 24;

/** Only appearance inputs belong in this key; browsing never writes economy state. */
export function heroPortraitSnapshot(app, id) {
  const def = HEROES[id], model = def && app.models?.[def.model];
  if (!def) return null;
  const source = app.eco?.heroEquipInsts?.(id) || {};
  const equipment = Object.fromEntries(['weapon', 'armor', 'ring', 'boots'].map(slot => {
    const inst = source[slot];
    return [slot, inst ? { ...inst } : null];
  }));
  const avatarId = (app.eco?.displayAvatar || app.eco?.equippedAvatar)?.call(app.eco, id) || def.bodyAvatar || null;
  const look = heroBodyAppearance(equipment, ITEM_BY_ID), tier = look.tier;
  const body = libraryAssetForAvatar(avatarId) || pickHeroLibraryAsset(libraryAssets().filter(asset =>
    asset.role === 'hero' && !asset.avatar && asset.heroId === id), look);
  if (model && !modelIds.has(model)) modelIds.set(model, ++nextModelId);
  const appearance = Object.entries(equipment).map(([slot, inst]) =>
    [slot, inst?.id || null, inst?.enh || 0, inst?.appearanceTier || null]);
  const key = JSON.stringify([id, model ? modelIds.get(model) : null,
    body?.id || null, body ? resolveAssetSource(body) : null, body?.sha256 || null, avatarId, appearance]);
  return { id, def, model, equipment, avatarId, tier, look, body, key };
}

function deadline(promise, ms = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('portrait body timeout')), ms);
  })]).finally(() => clearTimeout(timer));
}

/** A posed, visible upper-body frame. No source geometry, rig or camera in the game is changed. */
export function portraitFrame(root) {
  const box = new THREE.Box3(), point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    // The body determines face readability; a tall staff must not shrink the face.
    if (!mesh.isSkinnedMesh || !mesh.userData.libraryBody) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); box.expandByPoint(point);
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-.5, 0, -.3), new THREE.Vector3(.5, 2, .3));
  const height = Math.max(.1, box.max.y - box.min.y), center = box.getCenter(new THREE.Vector3());
  const target = new THREE.Vector3(center.x, box.max.y - height * .29, center.z);
  const span = Math.max(height * .68, (box.max.x - box.min.x) * 1.04);
  return { target, distance: span / (2 * Math.tan(THREE.MathUtils.degToRad(30 / 2))) + (box.max.z - box.min.z) / 2 };
}

/** One renderer for a short queue, released as soon as the queue is idle.
 * Source textures/geometries belong to the existing model cache; disposeCharacter releases only the clone.
 * Snapshots are small data URLs: no object URLs, ImageBitmaps or live canvases are retained by the cache.
 */
export function createHeroPortraitRenderer({ preload = preloadHeroBody, spawn = spawnCharacter, look = applyLook, dispose = disposeCharacter,
  createRenderer = options => new THREE.WebGLRenderer(options) } = {}) {
  let renderer = null;
  return {
    async capture(snapshot, alive) {
      if (!snapshot.model || !snapshot.body) return null;
      const loaded = await deadline(preload(snapshot.id, snapshot.look, snapshot.avatarId));
      if (!loaded || !alive()) return null;
      const instance = spawn(snapshot.model);
      try {
        look(instance.root, snapshot.def, snapshot.equipment, { avatarId: snapshot.avatarId });
        const body = instance.root.userData.libraryBodyAssetId;
        // Never certify a cached base body as the requested armor/avatar.
        if (body !== snapshot.body.id || !alive()) return null;
        if (instance.clips.Idle) instance.mixer.clipAction(instance.clips.Idle).play();
        instance.mixer.update(.25);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#dce3d8');
        scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x514b40, 2));
        const key = new THREE.DirectionalLight(0xffedcf, 2.6); key.position.set(-2, 4, 5); scene.add(key);
        const rim = new THREE.DirectionalLight(0xc0dfed, 1.7); rim.position.set(3, 2, -3); scene.add(rim);
        instance.root.rotation.y = .12; scene.add(instance.root);
        const frame = portraitFrame(instance.root);
        const camera = new THREE.PerspectiveCamera(30, 1, .01, 100);
        camera.position.copy(frame.target).add(new THREE.Vector3(0, .015, frame.distance));
        camera.lookAt(frame.target); camera.updateMatrixWorld();
        if (!renderer) {
          renderer = createRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
          renderer.setSize(256, 256); renderer.setPixelRatio(1);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
        }
        renderer.render(scene, camera);
        if (!alive() || renderer.getContext?.()?.isContextLost?.()) return null;
        return { url: renderer.domElement.toDataURL('image/webp', .88), body };
      } finally { dispose(instance.root, instance.mixer); }
    },
    release() {
      if (!renderer) return;
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.width = renderer.domElement.height = 1;
      renderer = null;
    },
  };
}

export class HeroPortraits {
  constructor(app, { renderer = createHeroPortraitRenderer(), limit = HERO_PORTRAIT_CACHE_LIMIT } = {}) {
    this.app = app; this.renderer = renderer; this.limit = Math.max(1, limit);
    this.cache = new Map(); this.pending = new Map(); this.queue = [];
    this.bindings = new WeakMap(); this.running = false; this.disposed = false;
  }
  cached(snapshot) {
    if (this.disposed || !snapshot?.model || !snapshot.body) return null;
    const hit = this.cache.get(snapshot.key);
    if (!hit) return null;
    this.cache.delete(snapshot.key);
    if (hit.body !== snapshot.body.id || typeof hit.url !== 'string' || !hit.url.startsWith('data:image/')) return null;
    this.cache.set(snapshot.key, hit);
    return hit;
  }
  request(snapshot) {
    if (this.disposed || !snapshot?.model || !snapshot.body) return Promise.resolve(null);
    const hit = this.cached(snapshot);
    if (hit) return Promise.resolve(hit);
    if (this.pending.has(snapshot.key)) return this.pending.get(snapshot.key).promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = { snapshot, promise, resolve };
    this.pending.set(snapshot.key, job); this.queue.push(job);
    // Rapid changes cannot accumulate an unbounded backlog.
    if (this.queue.length > this.limit) {
      const old = this.queue.shift(); this.pending.delete(old.snapshot.key); old.resolve(null);
    }
    if (!this.running) void this.drain();
    return promise;
  }
  async drain() {
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift();
        let result = null;
        try {
          result = await this.renderer.capture(job.snapshot, () => !this.disposed);
          if (result?.body !== job.snapshot.body.id || !result?.url?.startsWith('data:image/') || this.disposed) result = null;
          if (result) {
            this.cache.set(job.snapshot.key, result);
            while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value);
          }
        } catch { result = null; }
        this.pending.delete(job.snapshot.key); job.resolve(result);
        // Yield between images, never render from the game's frame loop.
        if (this.queue.length) await new Promise(done => setTimeout(done, 0));
      }
    } finally { this.renderer.release(); this.running = false; }
  }
  bind(img, id, { fallbackUrl = HEROES[id]?.portrait } = {}) {
    if (!img) return () => {};
    const previous = this.bindings.get(img);
    if (!HEROES[id]) {
      previous?.cancel();
      if (fallbackUrl) img.src = fallbackUrl;
      img.dataset.portraitState = 'fallback';
      delete img.dataset.heroPortrait; delete img.dataset.appearanceKey; delete img.dataset.portraitBody;
      return () => {};
    }
    const snapshot = heroPortraitSnapshot(this.app, id);
    if (previous?.key === snapshot.key && previous.fallbackUrl === fallbackUrl) return previous.cancel;
    previous?.cancel();
    const record = { key: snapshot.key, fallbackUrl, active: true, cancel: null };
    const current = () => record.active && !this.disposed && img.isConnected &&
      this.bindings.get(img) === record && heroPortraitSnapshot(this.app, id)?.key === snapshot.key;
    const fallback = () => {
      img.dataset.portraitState = 'fallback'; delete img.dataset.portraitBody;
      img.src = fallbackUrl;
    };
    const failed = () => { if (current() && img.dataset.portraitState === 'ready') fallback(); };
    record.cancel = () => {
      record.active = false; img.removeEventListener?.('error', failed);
      if (this.bindings.get(img) === record) this.bindings.delete(img);
    };
    this.bindings.set(img, record); img.addEventListener?.('error', failed);
    img.dataset.heroPortrait = id; img.dataset.appearanceKey = snapshot.key;
    const ready = result => {
      if (!current()) return;
      img.dataset.portraitBody = result.body; img.dataset.portraitState = 'ready'; img.src = result.url;
    };
    // A warm cache must not start a static request that a microtask immediately aborts.
    const hit = this.cached(snapshot);
    if (hit) { ready(hit); return record.cancel; }
    img.dataset.portraitState = snapshot.model && snapshot.body ? 'pending' : 'fallback';
    delete img.dataset.portraitBody; img.src = fallbackUrl;
    void this.request(snapshot).then(result => {
      if (!current()) return;
      if (!result) { fallback(); return; }
      ready(result);
    });
    return record.cancel;
  }
  dispose() {
    this.disposed = true; this.cache.clear();
    for (const job of this.pending.values()) job.resolve(null);
    this.pending.clear(); this.queue.length = 0; this.renderer.release();
  }
}

export function heroPortraitsFor(app) {
  let service = services.get(app);
  if (!service || service.disposed) {
    service = new HeroPortraits(app); services.set(app, service);
    globalThis.addEventListener?.('pagehide', () => service.dispose(), { once: true });
  }
  return service;
}
export function bindHeroPortrait(img, app, id, options) { return heroPortraitsFor(app).bind(img, id, options); }
