// Bounded state only; all time advances with the owning battle simulation.
export class ArmoryProcs {
  constructor(game) { this.g = game; this.clear(); }
  clear() {
    this.hitAt = -Infinity; this.anchorAt = -Infinity; this.lanceAt = -Infinity;
    this.mark = null; this.markHits = 0; this.markUntil = 0;
    this.light = 0; this.last = null; this.previous = null; this.relay = 0; this.guardUntil = 0;
    this.anchor = null; this.aegis = 0; this.aegisUntil = 0;
  }
  ready() { return this.g.active && !this.g.paused && this.g.player?.alive; }
  has(id) { return this.g.hasProc(`arm_${id}`); }
  onHit(e, opts = {}) {
    if (!this.ready() || opts.noProc || opts.quiet || (opts.source && opts.source !== this.g.player)) return;
    const now = this.g.elapsed, p = this.g.player;
    // One accepted hit per 150 ms, even with an area attack or many projectiles.
    if (now - this.hitAt < .15) return;
    this.hitAt = now;
    if (this.has('echo') && e.alive) {
      if (this.mark !== e || now > this.markUntil) this.markHits = 0;
      this.mark = e; this.markHits = Math.min(3, this.markHits + 1); this.markUntil = now + 4;
    }
    if (this.has('mercy')) this.light = Math.min(5, this.light + 1);
    if (this.has('relay')) {
      this.relay = this.last === e ? 1 : this.previous === e ? 2 : this.relay + 1;
      this.previous = this.last === e ? null : this.last; this.last = e;
      if (this.relay >= 3) { this.relay = 0; this.last = null; this.previous = null; p.addUlt(this.has('relay_master') ? 6 : 3); }
    }
    if (this.has('lance') && e.alive && now - this.lanceAt >= 3 && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) >= 4) {
      this.lanceAt = now; e.slow = Math.max(e.slow || 0, .65);
      e.slowT = Math.max(e.slowT || 0, e.isBoss ? .4 : this.has('lance_master') ? 1.4 : .8);
    }
  }
  onSkill(sk) {
    if (!this.ready() || sk.ult) return;
    const p = this.g.player;
    if (this.has('mercy') && this.light >= 5) {
      this.light = 0; p.hp = Math.min(p.maxHp, p.hp + Math.floor(p.maxHp * (this.has('mercy_master') ? .04 : .02)));
    }
    if (this.has('aegis')) this.guardUntil = this.g.elapsed + 3;
  }
  onDodge() {
    if (!this.ready()) return;
    const p = this.g.player, now = this.g.elapsed;
    if (this.has('anchor') && now - this.anchorAt >= 4) {
      this.anchorAt = now;
      this.anchor = { x: p.pos.x, z: p.pos.z, at: now + .6 };
      this.g.fx.groundTex(p.pos, 'circle_gold', 0x56c8bf, { r0: .3, r1: this.has('anchor_master') ? 4.5 : 3, life: .65, spin: 0 });
    }
    if (this.has('echo') && this.markHits >= 3 && now <= this.markUntil) {
      const target = this.mark; this.mark = null; this.markHits = 0;
      if (target?.alive && this.g.enemies.includes(target) && Math.hypot(target.pos.x-p.pos.x, target.pos.z-p.pos.z) <= 8) {
        this.g.damageEnemy(target, p.atk * (this.has('echo_master') ? 1 : .6), { source: p, kind: 'magic', noProc: true, quiet: true, quietStop: true });
      }
    }
    if (this.has('aegis') && this.guardUntil > now) {
      this.guardUntil = 0; this.aegis = this.has('aegis_master') ? .25 : .15; this.aegisUntil = now + 1;
    }
  }
  update() {
    if (!this.ready()) return;
    if (this.mark && (this.g.elapsed > this.markUntil || !this.mark.alive)) { this.mark = null; this.markHits = 0; }
    if (!this.anchor || this.g.elapsed < this.anchor.at) return;
    const at = this.anchor; this.anchor = null;
    if (!this.has('anchor')) return;
    const r = this.has('anchor_master') ? 4.5 : 3;
    let count = 0;
    for (const e of this.g.enemies) {
      if (!e.alive || e.spawning || e.isBoss || Math.hypot(e.pos.x-at.x, e.pos.z-at.z) > r) continue;
      e.pull(at.x, at.z, 12); if (++count >= 12) break;
    }
  }
  gauge() {
    if (this.has('echo')) return { n: this.markHits, max: 3, color: '#b3a0ef', label: '잔향' };
    if (this.has('mercy')) return { n: this.light, max: 5, color: '#f2c77f', label: '등불' };
    if (this.has('relay')) return { n: this.relay, max: 3, color: '#eb9b8f', label: '길쌈' };
    return null;
  }
}
