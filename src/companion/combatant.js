import * as THREE from 'three';
import { Actor } from '../game/actor.js';
import { audio } from '../engine/audio.js';

const _follow = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * 네브의 전투 몸체. 렌더 규칙을 다시 만들지 않고 기존 Battle 권위가 가진
 * 이동·충돌·피해·FX API만 소비한다.
 */
export class CompanionCombatant extends Actor {
  constructor(game, gltf, onSignal) {
    super(game, gltf, { scale: 0.82, tint: '#69c8d8', rig: 'kaykit' });
    this.onSignal = onSignal;
    this.tactic = 'gather';
    this.attackCd = 0.8;
    this.healCd = 2.5;
    this.castT = 0;
    this.disposed = false;
    this.radius = 0.46;
    this.model.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      node.castShadow = false;
      node.receiveShadow = true;
      if (this.model.userData.authoredContract) return;
      node.material.roughness = 0.72;
      node.material.metalness = 0.08;
      node.material.emissive?.set(0x062d35);
      node.material.emissiveIntensity = 0.45;
    });
    this.play(this.A('idleCombat'), { fade: 0 });
  }

  setTactic(tactic) {
    this.tactic = tactic;
  }

  nearestTarget(maxDist = 10) {
    let target = null;
    let priorityTarget = null;
    let best = maxDist;
    let priorityBest = maxDist;
    for (const enemy of this.game.enemies) {
      if (!enemy.alive || enemy.spawning) continue;
      const distance = this.distTo(enemy);
      if (this.tactic === 'break' && (enemy.isBoss || enemy.isElite) && distance < priorityBest) {
        priorityBest = distance;
        priorityTarget = enemy;
      }
      if (distance < best) {
        best = distance;
        target = enemy;
      }
    }
    return priorityTarget || target;
  }

  update(dt) {
    if (this.disposed) return;
    super.update(dt);
    const player = this.game.player;
    if (!player || !player.alive || !this.game.active) {
      this.vel.set(0, 0, 0);
      return;
    }

    this.attackCd -= dt;
    this.healCd -= dt;
    this.castT -= dt;

    const forwardX = Math.sin(player.yaw);
    const forwardZ = Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const side = this.tactic === 'guard' ? 0.7 : 1.2;
    const back = this.tactic === 'break' ? 1.1 : 1.8;
    _follow.set(
      player.pos.x - forwardX * back + rightX * side,
      0,
      player.pos.z - forwardZ * back + rightZ * side,
    );

    const playerDistance = this.distTo(player);
    if (playerDistance > 12) {
      this.game.fx.castCircle(this.pos, 0x63d9e6, { radius: 1.3, life: 0.35 });
      this.pos.copy(_follow);
      this.kb.set(0, 0, 0);
      this.game.fx.castCircle(this.pos, 0x63d9e6, { radius: 1.3, life: 0.35 });
    }

    if (this.tactic === 'guard' && player.hp / player.maxHp < 0.56 && this.healCd <= 0) {
      this.castGuard(player);
      return;
    }

    const target = this.nearestTarget(this.tactic === 'break' ? 14 : 10);
    if (target && this.attackCd <= 0 && this.distTo(target) < 9) {
      this.castAt(target);
      return;
    }

    const dx = _follow.x - this.pos.x;
    const dz = _follow.z - this.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.5 && this.castT <= 0) {
      const speed = Math.min(7.2, 3.4 + distance * 1.1);
      this.vel.set(dx / distance * speed, 0, dz / distance * speed);
      this.faceDir(dx, dz);
      if (this.actionName !== this.A('run')) this.play(this.A('run'), { fade: 0.16, restart: false });
    } else {
      this.vel.set(0, 0, 0);
      if (this.castT <= 0 && this.actionName !== this.A('idleCombat')) this.play(this.A('idleCombat'), { fade: 0.18, restart: false });
      if (target) this.face(target.pos.x, target.pos.z);
    }
  }

  castGuard(player) {
    this.healCd = 12;
    this.attackCd = 2;
    this.castT = 0.75;
    this.vel.set(0, 0, 0);
    this.face(player.pos.x, player.pos.z);
    this.playTimed(this.A('raise'), 0.72, { fade: 0.08 });
    const heal = Math.max(1, Math.floor(player.maxHp * 0.09));
    this.game.after(0.32, () => {
      if (this.disposed || !this.game.active || !player.alive) return;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      player.invuln = Math.max(player.invuln, 0.45);
      this.game.fx.holyBurst(player.pos, { size: 4.2, life: 0.5, color: 0x63d9e6 });
      this.game.fx.damage(player.pos.clone().setY(1.2), heal, { kind: 'heal', text: `+${heal}` });
      audio.magic({ vol: 0.24, base: 392, notes: [0, 7, 12], step: 0.06 });
      this.onSignal?.('guard-heal');
    });
  }

  castAt(target) {
    const player = this.game.player;
    const isBreak = this.tactic === 'break';
    const isGather = this.tactic === 'gather';
    this.attackCd = isBreak ? 3.4 : isGather ? 4.2 : 2.5;
    this.castT = 0.65;
    this.vel.set(0, 0, 0);
    this.face(target.pos.x, target.pos.z);
    this.playTimed(this.A('cast'), 0.62, { fade: 0.08 });
    const origin = this.pos.clone().setY(1.25);
    const destination = target.pos.clone().setY(1.05 * target.def.scale);
    this.game.fx.boltTex(origin, destination, isBreak ? 0xffb857 : 0x63d9e6, { life: 0.28 });

    this.game.after(0.24, () => {
      if (this.disposed || !this.game.active || !target.alive) return;
      if (isGather) {
        this.game.vacuum(target.pos, 5.8, 9);
        this.game.fx.groundTex(target.pos.clone().setY(0), 'singularity', 0x63d9e6, { r0: 0.8, r1: 5.8, life: 0.5, spin: 0.35, y: 0.08 });
        this.onSignal?.('gather-cast');
      } else if (isBreak) {
        this.game.fx.shockTex(target.pos, 0xffb857, { r1: 3.4, life: 0.32 });
        this.onSignal?.('break-cast');
      }
      _dir.copy(destination).sub(origin).setY(0).normalize();
      this.game.damageEnemy(target, player.atk * (isBreak ? 0.72 : 0.42), {
        kind: 'magic',
        kb: isBreak ? 5 : 2,
        stun: isBreak ? 0.8 : 0.15,
        quietStop: true,
        noProc: true,
        source: this,
        dirx: _dir.x,
        dirz: _dir.z,
      });
      audio.magic({ vol: 0.18, base: isBreak ? 220 : 520, notes: [0, 5, 12], step: 0.04 });
    });
  }

  dispose() {
    this.disposed = true;
    super.dispose();
  }
}
