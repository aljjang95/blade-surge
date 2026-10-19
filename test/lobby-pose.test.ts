import { describe, expect, test } from 'bun:test';
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack } from 'three';
import { readFileSync } from 'node:fs';
import { createLobbyPose, lobbyPoseWeight, LOBBY_POSE_CORRECTIONS } from '../src/engine/lobby-pose.js';

function rig(hero = 'mage') {
  const root = new Group();
  for (const name of Object.keys(LOBBY_POSE_CORRECTIONS[hero as keyof typeof LOBBY_POSE_CORRECTIONS])) { const bone = new Bone(); bone.name = name; root.add(bone); }
  return root;
}

describe('로비 전용 자세 교정', () => {
  test('교정 데이터 없는 직업과 호환되지 않는 골격은 변경하지 않는다', () => {
    const root = rig(); const q = root.children[0].quaternion.clone();
    expect(createLobbyPose(root, 'unknown')).toBeNull();
    expect(createLobbyPose(new Group(), 'mage')).toBeNull();
    expect(root.children[0].quaternion.equals(q)).toBe(true);
  });
  test('모든 교정 직업은 생성 시 회전을 준비하고 프레임마다 같은 객체를 사용한다', () => {
    for (const hero of Object.keys(LOBBY_POSE_CORRECTIONS)) {
      const root = rig(hero), pose = createLobbyPose(root, hero)!;
      const bones = root.children as Bone[]; const refs = bones.map(b => b.quaternion);
      const corrections = new Map<Quaternion, Quaternion>();
      const multiply = Quaternion.prototype.multiply;
      Quaternion.prototype.multiply = function(q: Quaternion) {
        if (corrections.has(this)) expect(q).toBe(corrections.get(this)!); else corrections.set(this, q);
        return multiply.call(this, q);
      };
      try { for (let i = 0; i < 200; i++) { pose.restore(); pose.apply(); } }
      finally { Quaternion.prototype.multiply = multiply; }
      expect(corrections.size).toBe(bones.length);
      bones.forEach((b, i) => expect(b.quaternion).toBe(refs[i]));
      pose.dispose(); bones.forEach(b => expect(b.quaternion.equals(new Quaternion())).toBe(true));
    }
    const source = readFileSync(new URL('../src/engine/lobby-pose.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const hotPath = source.slice(source.indexOf('    restore()'), source.indexOf('    dispose()'));
    expect(hotPath).not.toMatch(/\bnew\b|\.clone\(|\.map\(|\.filter\(|\.slice\(/);
  });
  test('정지·반복 호출·애니메이션 트랙 누락에서도 누적되지 않고 dispose 뒤에는 무효다', () => {
    const root = rig(), pose = createLobbyPose(root, 'mage')!;
    pose.apply(); const expected = root.children.map(b => b.quaternion.clone());
    for (let i = 0; i < 100; i++) { pose.apply(); pose.restore(); pose.apply(); }
    root.children.forEach((b, i) => expect(b.quaternion.angleTo(expected[i])).toBeLessThan(1e-7));
    pose.dispose(); pose.dispose(); pose.apply();
    root.children.forEach(b => expect(b.quaternion.equals(new Quaternion())).toBe(true));
  });
  test('mixer 뒤 교정은 새 키프레임을 보존하고 별도 전투 인스턴스에는 영향을 주지 않는다', () => {
    const lobby = rig(), battle = rig(); const bone = lobby.children[0];
    const target = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as any, .3);
    const clip = new AnimationClip('Idle', 1, [new QuaternionKeyframeTrack(bone.name + '.quaternion', [0, 1], [0,0,0,1,...target.toArray()])]);
    const mixer = new AnimationMixer(lobby); mixer.clipAction(clip).play();
    const pose = createLobbyPose(lobby, 'mage')!;
    mixer.update(.2); const first = bone.quaternion.clone(); pose.apply(); pose.restore(); expect(bone.quaternion.equals(first)).toBe(true);
    mixer.update(.3); const next = bone.quaternion.clone(); expect(next.equals(first)).toBe(false);
    pose.apply(); pose.dispose(); expect(bone.quaternion.equals(next)).toBe(true);
    battle.children.forEach(b => expect(b.quaternion.equals(new Quaternion())).toBe(true));
    for (const file of ['player.js', 'actor.js']) expect(readFileSync(new URL('../src/game/' + file, import.meta.url), 'utf8')).not.toContain('lobby-pose');
  });
  test('직업 교체와 두 전투 입장 경로는 쇼케이스 교정을 먼저 해제한다', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(source.match(/this\.showcase\.pose\?\.dispose\(\); disposeCharacter/g)?.length).toBe(3);
    expect(source).toContain('s.pose?.restore();\n        if (!this.reducedMotion.matches || this.hubMovement.moving) s.mixer.update(realDt);');
    expect(source).toContain('s.pose?.apply(lobbyPoseWeight(s.idleAction));');
  });
  test('교정은 Idle 가중치만큼만 얹힌다: 걷기·감정 표현에서는 줄이거나 끈다', () => {
    const running = (w: number) => ({ isRunning: () => true, getEffectiveWeight: () => w });
    expect(lobbyPoseWeight(null)).toBe(1);
    expect(lobbyPoseWeight(running(1))).toBe(1);
    expect(lobbyPoseWeight(running(.4))).toBe(.4);
    expect(lobbyPoseWeight(running(-.2))).toBe(0);
    expect(lobbyPoseWeight(running(1.7))).toBe(1);
    expect(lobbyPoseWeight({ isRunning: () => false, getEffectiveWeight: () => 1 })).toBe(0);

    const root = rig('knight'), pose = createLobbyPose(root, 'knight')!;
    const bone = root.children[0] as Bone, base = bone.quaternion.clone();
    pose.apply(0); expect(bone.quaternion.equals(base)).toBe(true);
    pose.restore(); expect(bone.quaternion.equals(base)).toBe(true);
    pose.apply(1); const full = bone.quaternion.clone(); pose.restore();
    pose.apply(.5); const half = bone.quaternion.clone(); pose.restore();
    expect(full.equals(base)).toBe(false);
    // 반 가중치는 원본과 전체 교정의 중간 회전이다.
    expect(half.angleTo(base)).toBeCloseTo(full.angleTo(base) / 2, 5);
    expect(half.angleTo(full)).toBeCloseTo(full.angleTo(base) / 2, 5);
    pose.dispose(); expect(bone.quaternion.equals(base)).toBe(true);
  });
  test('부분 가중치 적용도 프레임마다 새 객체를 만들지 않는다', () => {
    const source = readFileSync(new URL('../src/engine/lobby-pose.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const apply = source.slice(source.indexOf('    apply(weight = 1)'), source.indexOf('    dispose()'));
    expect(apply).not.toMatch(/\bnew\b|\.clone\(|\.map\(|\.filter\(|\.slice\(/);
    expect(source.slice(source.indexOf('export function lobbyPoseWeight'), source.indexOf('export function createLobbyPose'))).not.toMatch(/\bnew\b|\.clone\(/);
  });
});
