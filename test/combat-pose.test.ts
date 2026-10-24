import { describe, expect, test } from 'bun:test';
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack } from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HEROES } from '../src/data/heroes.js';
import timing from './fixtures/combat-pose-timing.json';
import { createCombatPose, combatPoseWeight, COMBAT_POSE_CORRECTIONS } from '../src/engine/combat-pose.js';

function fixture() {
  const root = new Group(), bone = new Bone(); bone.name = 'mixamorigRightArm'; root.add(bone);
  const clip = new AnimationClip('attack', 1, [new QuaternionKeyframeTrack(bone.name + '.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
  const mixer = new AnimationMixer(root), clips = { attack: clip, AttackAlias: clip };
  const config = { attack: { aliases: ['attack', 'AttackAlias'], bones: { mixamorigRightArm: [0, 0, 40] }, curve: [[0, 0], [.25, 1], [.75, 1], [1, 0]] } };
  const pose = createCombatPose(root, 'fixture', mixer, clips, config)!;
  return { root, bone, clip, mixer, pose, action: mixer.clipAction(clip).play(), config };
}

describe('전투·마을 가산 자세 층', () => {
  test('곡선의 끝점·중간점과 반복 경계가 연속이고 미분이 0이다', () => {
    const curve = [[0, 0], [.25, 1], [.75, 1], [1, 0]];
    expect(combatPoseWeight(curve, -.1)).toBe(0);
    expect(combatPoseWeight(curve, 2)).toBe(0);
    expect(combatPoseWeight(curve, .125)).toBeCloseTo(.5, 8);
    for (const t of [0, .25, .75, 1]) {
      expect(Math.abs(combatPoseWeight(curve, t + 1e-6) - combatPoseWeight(curve, t - 1e-6))).toBeLessThan(1e-8);
    }
  });
  test('실효 액션 가중치를 곱하고 같은 클립의 별칭은 한 번만 적용한다', () => {
    const { bone, pose, action, mixer } = fixture();
    action.time = .5; action.setEffectiveWeight(.5); mixer.update(0);
    for (let i = 0; i < 5; i++) { pose.restore(); pose.apply(); }
    expect(bone.quaternion.angleTo(new Quaternion()) * 180 / Math.PI).toBeCloseTo(20, 5);
    pose.restore(); action.setEffectiveWeight(0); mixer.update(0); pose.apply(); pose.restore(); pose.apply();
    expect(bone.quaternion.equals(new Quaternion())).toBe(true);
    pose.dispose();
  });
  test('교차 페이드·시각 점프에서도 보정의 프레임 차이는 15도 이하다', () => {
    const { bone, pose, mixer, action } = fixture(), previous = new Quaternion();
    for (let i = 0; i < 180; i++) {
      pose.restore(); action.time = i % 13 < 6 ? .5 : .99;
      action.setEffectiveWeight(i % 23 / 22); mixer.update(0); pose.apply(1 / 60);
      expect(previous.angleTo(bone.quaternion) * 180 / Math.PI).toBeLessThanOrEqual(15);
      previous.copy(bone.quaternion);
    }
    pose.dispose();
  });
  test('반복 apply·트랙 누락·정지 액션·dispose는 누적하거나 뼈를 남기지 않는다', () => {
    const { bone, pose, mixer, action } = fixture(); action.time = .5; mixer.update(0);
    for (let i = 0; i < 5; i++) { pose.restore(); pose.apply(); }
    const full = bone.quaternion.clone();
    pose.apply(); expect(bone.quaternion.angleTo(full)).toBeLessThan(1e-7);
    action.paused = true;
    for (let i = 0; i < 200; i++) { pose.restore(); pose.apply(); }
    expect(bone.quaternion.angleTo(full)).toBeLessThan(1e-7);
    pose.dispose(); pose.dispose(); pose.apply();
    expect(bone.quaternion.equals(new Quaternion())).toBe(true);
  });
  test('모르는 직업·클립·호환되지 않는 골격에는 보정을 만들지 않는다', () => {
    const { root, mixer, clip, config, pose } = fixture(); pose.dispose();
    expect(createCombatPose(root, 'unknown', mixer, { attack: clip })).toBeNull();
    expect(createCombatPose(root, 'fixture', mixer, {}, config)).toBeNull();
    expect(createCombatPose(new Group(), 'fixture', mixer, { attack: clip }, config)).toBeNull();
  });
  test('프레임 루프는 생성 시 준비한 회전 객체만 재사용한다', () => {
    const { bone, pose, action, mixer } = fixture(); const quaternion = bone.quaternion;
    const args = new Set<Quaternion>(), original = Quaternion.prototype.multiply;
    Quaternion.prototype.multiply = function(q: Quaternion) { if (this === quaternion) args.add(q); return original.call(this, q); };
    try { for (let i = 0; i < 200; i++) { pose.restore(); action.time = (i % 60) / 60; mixer.update(0); pose.apply(); } }
    finally { Quaternion.prototype.multiply = original; pose.dispose(); }
    expect(args.size).toBe(1); expect(bone.quaternion).toBe(quaternion);
    const source = readFileSync(new URL('../src/engine/combat-pose.js', import.meta.url), 'utf8');
    const hot = source.slice(source.indexOf('    restore()'), source.indexOf('    dispose()'));
    expect(hot).not.toMatch(/\bnew\b|\.clone\(|\.map\(|\.filter\(|\.slice\(|\.clipAction\(|\.setTime\(/);
  });
  test('클립 길이·트랙·액션 시각·속도·가중치·히트 프레임을 변경하지 않는다', () => {
    const { pose, action, clip, mixer } = fixture();
    const times = Array.from(clip.tracks[0].times), values = Array.from(clip.tracks[0].values);
    const hitAt = .4, duration = clip.duration, hitTime = duration * hitAt;
    action.timeScale = 1.7; action.setEffectiveWeight(.8);
    for (let i = 0; i < 60; i++) {
      pose.restore(); mixer.update(1 / 60); const time = action.time, mixerTime = mixer.time;
      pose.apply(); expect(action.time).toBe(time); expect(mixer.time).toBe(mixerTime);
      expect(action.timeScale).toBe(1.7); expect(action.getEffectiveWeight()).toBe(.8);
    }
    expect(clip.duration).toBe(duration); expect(clip.duration * hitAt).toBe(hitTime);
    expect(Array.from(clip.tracks[0].times)).toEqual(times); expect(Array.from(clip.tracks[0].values)).toEqual(values);
    pose.dispose();
  });
  test('확대 저작 4개는 60도, 두 회전 클립의 오른손목만 120도를 허용한다', () => {
    for (const [hero, configs] of Object.entries(COMBAT_POSE_CORRECTIONS) as any[]) for (const [name, config] of Object.entries(configs) as any[]) {
      const expanded = (hero === 'knight' && ['slash_h', 'spin'].includes(name)) || (hero === 'barbarian' && name === 'spin') || (hero === 'ranger' && name === 'RangerBowUpper');
      const wrist = ['knight', 'barbarian'].includes(hero) && name === 'spin';
      expect(config.maxDegrees || 40).toBe(expanded ? 60 : 40);
      expect(config.boneMaxDegrees || {}).toEqual(wrist ? { mixamorigRightHand: 120 } : {});
      expect(config.aliases).not.toContain('Idle');
      for (const key of (config.keys || [{ bones: config.bones }])) for (const [bone, xyz] of Object.entries(key.bones) as [string, number[]][]) {
        const [x, y, z] = xyz.map(n => n * Math.PI / 180);
        const w = Math.cos(x / 2) * Math.cos(y / 2) * Math.cos(z / 2) - Math.sin(x / 2) * Math.sin(y / 2) * Math.sin(z / 2);
        expect(2 * Math.acos(Math.min(1, Math.abs(w))) * 180 / Math.PI).toBeLessThanOrEqual((config.boneMaxDegrees?.[bone] || config.maxDegrees || 40) + .01);
      }
    }
  });
  test('실제 전투 정의의 길이·히트 시각·피해·범위와 보호 파일을 기준 HEAD에 고정한다', () => {
    // 기준 HEAD 에 있던 다섯 영웅의 정의는 그대로여야 한다(이후 추가된 소환 전용 영웅은 비교 대상이 아니다).
    expect(Object.fromEntries(Object.entries(HEROES).filter(([id]) => id in timing.gameplay).map(([id, hero]) => [id, { combo: hero.combo, skills: hero.skills }]))).toEqual(timing.gameplay);
    for (const [file, hash] of Object.entries(timing.pinned)) {
      expect(createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex')).toBe(hash);
    }
  });
  test('실제 다섯 직업의 원본 클립 길이·트랙과 실효 재생 시각을 보존한다', async () => {
    const { installRangerRuntimeLoader } = await import('../tools/art/ranger-runtime-loader.mjs');
    const { loadHeroModel, spawnCharacter, disposeCharacter } = await import('../src/engine/assets.js');
    const restore = installRangerRuntimeLoader();
    const signature = (clips: any) => createHash('sha256').update(JSON.stringify(Object.values(clips).map((c: any) => ({
      duration: c.duration, name: c.name, tracks: c.tracks.map((t: any) => [t.name, Array.from(t.times), Array.from(t.values)])
    })))).digest('hex');
    try {
      for (const hero of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
        const gltf = await loadHeroModel(hero, 1), inst = spawnCharacter(gltf), before = signature(inst.clips);
        const pose = createCombatPose(inst.root, hero, inst.mixer, inst.clips);
        for (const clip of new Set(Object.values(inst.clips)) as Set<AnimationClip>) {
          inst.mixer.stopAllAction(); const action = inst.mixer.clipAction(clip).reset().play();
          for (let i = 0; i < 3; i++) {
            pose?.restore(); inst.mixer.update(.016); const t = action.time, mixerTime = inst.mixer.time;
            pose?.apply(); expect(action.time).toBe(t); expect(inst.mixer.time).toBe(mixerTime);
          }
        }
        expect(signature(inst.clips)).toBe(before); pose?.dispose(); disposeCharacter(inst.root, inst.mixer);
      }
    } finally { restore(); }
  });
  test('판정용 뼈 읽기: suspend는 보정 전 자세를, resume은 보정 후 자세를 정확히 되돌리고 반복해도 누적되지 않는다', () => {
    const { bone, pose, action, mixer } = fixture(); action.time = .5; mixer.update(0);
    pose.apply(); pose.apply(); const base = new Quaternion();
    for (let i = 0; i < 5; i++) { pose.restore(); pose.apply(); }
    const corrected = bone.quaternion.clone(); expect(corrected.angleTo(base)).toBeGreaterThan(.1);
    for (let i = 0; i < 50; i++) {
      pose.suspend(); expect(bone.quaternion.angleTo(base)).toBeLessThan(1e-9);
      pose.apply(); expect(bone.quaternion.angleTo(base)).toBeLessThan(1e-9);
      pose.resume(); expect(bone.quaternion.angleTo(corrected)).toBeLessThan(1e-9);
    }
    pose.suspend(); pose.restore(); pose.resume(); expect(bone.quaternion.angleTo(base)).toBeLessThan(1e-9);
    pose.dispose();
  });
  test('활 화살 발사 위치(arrowOrigin)는 보정을 벗긴 자세에서 읽는다', () => {
    const player = readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const body = player.slice(player.indexOf('  arrowOrigin('), player.indexOf('  doComboHit('));
    expect(body.indexOf('this.heroPose?.suspend()')).toBeGreaterThan(-1);
    expect(body.indexOf('this.heroPose?.suspend()')).toBeLessThan(body.indexOf('getWorldPosition'));
    expect(body.indexOf('getWorldPosition')).toBeLessThan(body.indexOf('this.heroPose?.resume()'));
  });
  test('외형 단계 변경으로 clips의 클립 객체가 오버레이로 교체돼도 같은 별칭의 보정이 이어진다', () => {
    const { root, bone, clip, mixer, config } = fixture();
    const clips: Record<string, AnimationClip> = { attack: clip };
    const pose = createCombatPose(root, 'fixture', mixer, clips, config)!;
    const overlay = new AnimationClip('attack', clip.duration, clip.tracks);
    clips.attack = overlay; clips.AttackAlias = overlay;
    mixer.stopAllAction(); const action = mixer.clipAction(overlay).play(); action.time = .5; mixer.update(0);
    for (let i = 0; i < 5; i++) { pose.restore(); pose.apply(); }
    expect(bone.quaternion.angleTo(new Quaternion()) * 180 / Math.PI).toBeCloseTo(40, 4);
    pose.dispose();
  });
  test('게임 루프 연결: 전투는 mixer 앞 restore·뒤 apply, 마을은 Idle 교정 뒤에 얹고 세 해제 경로에서 정리한다', () => {
    const actor = readFileSync(new URL('../src/game/actor.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(actor).toContain('this.heroPose?.restore();\n    this.mixer.update(dt);\n    this.updateCombatPose(dt);\n    this.heroPose?.apply(dt);');
    expect(actor).toContain('this.heroPose?.dispose(); this.mixer.stopAllAction();');
    expect(readFileSync(new URL('../src/game/player.js', import.meta.url), 'utf8')).toContain('createCombatPose(this.model, kitOf(def), this.mixer, this.clips)');
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(main.match(/this\.showcase\.combatPose\?\.dispose\(\); this\.showcase\.pose\?\.dispose\(\); disposeCharacter/g)?.length).toBe(3);
    expect(main).toContain('s.combatPose?.restore();\n        s.pose?.restore();');
    expect(main.indexOf('s.pose?.apply(lobbyPoseWeight(s.idleAction));')).toBeLessThan(main.indexOf('s.combatPose?.apply(realDt);'));
  });
  test('반복 저작 회전은 시작과 끝 보정이 같아 주기 경계에 별도 점프를 만들지 않는다', () => {
    const keys = COMBAT_POSE_CORRECTIONS.barbarian.spin.keys;
    expect(keys.at(-1)!.bones).toEqual(keys[0].bones);
  });

});
