import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadModel, spawnCharacter, disposeCharacter } from '../src/engine/assets.js';
import { animPacks, animPackFor, mergeAnimPack, shippedSourceSha } from '../src/engine/library-assets.js';
import { HERO_PACK_ALIASES } from '../src/data/hero-library.js';
import { RIGS, libraryPackRig, libraryClipKey } from '../src/data/rigs.js';
import { Actor } from '../src/game/actor.js';
import { Player } from '../src/game/player.js';
import manifest from '../asset-library/manifest.json';

// h4-anim 애니메이션 팩: 원본 GLB 는 그대로, 새 클립만 뼈대 전용 팩으로 덧붙는다. 실제 loadHeroModel/loadModel 경로로 잰다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());

const ROOT = new URL('../', import.meta.url);
const file = (path: string) => readFileSync(new URL(path.replace(/^\//, ''), ROOT));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const glbJson = (bytes: Buffer) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const REG = animPacks() as any;
const asset = (id: string) => manifest.assets.find((a: any) => a.id === id)!;

test('등록부: 팩 파일 해시·크기, 생성 원본 해시, 저작 스크립트 해시가 저장소와 일치한다', () => {
  expect(REG.schema).toBe('blade-surge.anim-packs.v1');
  expect(REG.blender).toMatch(/^Blender 5\.2\.\d+ LTS$/);
  for (const [path, digest] of Object.entries(REG.scripts)) expect(sha(file(path)), path).toBe(digest as string);
  expect(REG.packs.length).toBe(21);
  for (const pack of REG.packs) {
    const bytes = file('public' + pack.path);
    expect(sha(bytes), pack.asset).toBe(pack.sha256);
    expect(bytes.length).toBe(pack.bytes);
    expect(sha(file(pack.source.path)), pack.asset).toBe(pack.source.sha256);
    // 게임이 실제로 읽는 원본(도적·궁수는 교정본)에서 만든 팩이어야 런타임이 붙인다.
    expect(shippedSourceSha(asset(pack.asset)), pack.asset).toBe(pack.source.sha256);
  }
});

test('팩 GLB 는 메시·스킨·재질·텍스처 없이 뼈대 노드와 등록된 클립만 담고, 모든 채널이 원본 노드 이름을 가리킨다', () => {
  for (const pack of REG.packs) {
    const doc = glbJson(file('public' + pack.path)), src = glbJson(file(pack.source.path));
    expect(doc.meshes ?? [], pack.asset).toEqual([]);
    expect(doc.skins ?? []).toEqual([]); expect(doc.materials ?? []).toEqual([]); expect(doc.images ?? []).toEqual([]);
    expect(doc.animations.map((a: any) => a.name).sort()).toEqual(Object.keys(pack.clips).sort());
    const names = new Set(src.nodes.map((n: any) => n.name));
    const srcAnimated = new Set(src.animations[0].channels.map((c: any) => src.nodes[c.target.node].name));
    for (const anim of doc.animations) {
      const targets = new Set(anim.channels.map((c: any) => doc.nodes[c.target.node].name));
      for (const name of targets) expect(names.has(name), `${pack.asset}/${anim.name}/${name}`).toBe(true);
      // 원본 클립이 움직이는 뼈를 빠짐없이 움직인다(빠진 뼈가 이전 동작에 굳지 않게).
      for (const name of srcAnimated) expect(targets.has(name), `${pack.asset}/${anim.name} missing ${name}`).toBe(true);
    }
    // 원본 클립 이름과 겹치지 않는다(원본은 그대로 남는다).
    const original = new Set(src.animations.map((a: any) => a.name));
    for (const name of Object.keys(pack.clips)) expect(original.has(name), `${pack.asset}/${name}`).toBe(false);
  }
});

test('등록부 측정값: 제자리·이음새 보정 클립은 이음새 1° 미만·골반 이동 5cm 미만이고 원본보다 줄었다', () => {
  for (const pack of REG.packs) for (const [name, m] of Object.entries(pack.clips) as [string, any][]) {
    if (m.kind !== 'inplace-seam') continue;
    expect(m.seamDeg, `${pack.asset}/${name}`).toBeLessThan(1);
    expect(m.rootDriftM, `${pack.asset}/${name}`).toBeLessThan(.05);
    expect(m.seamDeg).toBeLessThan(m.baseSeamDeg);
  }
  const knight = animPackFor('hero_knight_t1')!.clips as any;
  expect(knight.slash_d_ip.baseRootDriftM).toBeGreaterThan(1); expect(knight.stab_ip.baseRootDriftM).toBeGreaterThan(1);
  expect(knight.death_fwd.baseRootDriftM).toBeGreaterThan(.5); expect(knight.death_fwd.rootDriftM).toBeLessThan(.05);
  expect(animPackFor('hero_barbarian_t1')!.clips.spin_ip.baseRootDriftM).toBeGreaterThan(1.5);
});

test('mergeAnimPack: 등록된 새 이름만 덧붙이고 같은 이름 원본 클립은 덮지 않는다', () => {
  const gltf = { animations: [new THREE.AnimationClip('hit', 1, [])] } as any;
  const pack = { clips: { hit_heavy: {}, hit: {} } };
  const added = mergeAnimPack(gltf, pack, { animations: [new THREE.AnimationClip('hit', 2, []), new THREE.AnimationClip('hit_heavy', 1, []), new THREE.AnimationClip('stray', 1, [])] });
  expect(added).toEqual(['hit_heavy']);
  expect(gltf.animations.map((c: any) => c.name)).toEqual(['hit', 'hit_heavy']);
  expect(gltf.animations[0].duration).toBe(1);
});

const v = () => new THREE.Vector3();
function pose(inst: any, name: string, k: number) {
  inst.mixer.stopAllAction(); const clip = inst.clips[name]; const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = clip.duration * k; inst.mixer.update(0); inst.root.updateMatrixWorld(true);
}
function skinMinY(root: any) {
  let min = Infinity; const p = v(); root.updateMatrixWorld(true);
  root.traverse((o: any) => { if (!o.isSkinnedMesh) return; o.skeleton.update(); for (let i = 0; i < o.geometry.attributes.position.count; i += 3) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; } });
  return min;
}
const hipsXZ = (inst: any) => { const p = inst.root.getObjectByName('mixamorigHips').getWorldPosition(v()); return new THREE.Vector2(p.x, p.z); };
/** 휴지 자세 대비 최대 뼈 회전(도). T포즈(트랙이 안 묶임)면 0 근처다. */
function motionFromRest(inst: any, name: string) {
  inst.mixer.stopAllAction(); inst.mixer.update(0);
  const bones: any[] = []; inst.root.traverse((o: any) => { if (o.isBone) bones.push(o); });
  for (const b of bones) b.userData.rest = b.quaternion.clone();
  let max = 0;
  for (const k of [.25, .5, .75]) { pose(inst, name, k); for (const b of bones) max = Math.max(max, THREE.MathUtils.radToDeg(b.quaternion.angleTo(b.userData.rest))); }
  return max;
}

test('영웅: 팩 클립이 실제 별칭으로 이어져 강타/좌우 피격·두 사망·콤보가 서로 다른 클립이고, 모든 트랙이 뼈에 묶인다', async () => {
  for (const heroId of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
    const inst = spawnCharacter(await loadHeroModel(heroId, 1));
    try {
      for (const [alias, packName] of Object.entries(HERO_PACK_ALIASES[heroId as keyof typeof HERO_PACK_ALIASES])) {
        if (!inst.clips[alias]) continue;   // 이 영웅이 쓰지 않는 콤보 별칭
        expect(inst.clips[alias].name, `${heroId}/${alias}`).toBe(packName);
        for (const track of inst.clips[alias].tracks) {
          const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
          expect(inst.root.getObjectByName(node), `${heroId}/${packName}/${node}`).toBeTruthy();
        }
        expect(motionFromRest(inst, alias), `${heroId}/${alias} T-pose`).toBeGreaterThan(20);
      }
      expect(inst.clips.Hit_B).not.toBe(inst.clips.Hit_A);
      expect(new Set([inst.clips.Hit_A, inst.clips.Hit_B, inst.clips.Hit_L, inst.clips.Hit_R]).size).toBe(4);
      if (heroId !== 'ranger') expect(inst.clips.Death_B).not.toBe(inst.clips.Death_A);
      else expect(inst.clips.Death_B).toBe(inst.clips.death);   // 궁수 사망은 활 접지 계약(ranger-death-contact) 그대로
    } finally { disposeCharacter(inst.root, inst.mixer); }
  }
});

test('기사·전사: 제자리 콤보는 끝에 골반이 시작 자리로 돌아오고, 같은 클립이던 내려찍기·회전이 갈라진다', async () => {
  const knight = spawnCharacter(await loadHeroModel('knight', 1)), barb = spawnCharacter(await loadHeroModel('barbarian', 1));
  try {
    for (const [inst, name, source] of [[knight, '1H_Melee_Attack_Stab', 'stab'], [knight, '1H_Melee_Attack_Slice_Diagonal', 'slash_d'], [barb, '2H_Melee_Attack_Spinning', 'spin']] as const) {
      pose(inst, source, 0); const s0 = hipsXZ(inst); pose(inst, source, .999); const before = hipsXZ(inst).distanceTo(s0);
      pose(inst, name, 0); const a = hipsXZ(inst); pose(inst, name, .999); const after = hipsXZ(inst).distanceTo(a);
      expect(before, name).toBeGreaterThan(.4); expect(after, name).toBeLessThan(.03);
    }
    expect(knight.clips['2H_Melee_Attack_Chop']).not.toBe(knight.clips['1H_Melee_Attack_Chop']);
    expect(barb.clips['2H_Melee_Attack_Spin']).not.toBe(barb.clips['2H_Melee_Attack_Spinning']);
  } finally { for (const i of [knight, barb]) disposeCharacter(i.root, i.mixer); }
});

test('영웅 새 피격·사망 클립은 실제 스킨이 바닥을 3cm 넘게 뚫지 않는다', async () => {
  for (const heroId of ['knight', 'barbarian', 'mage', 'rogue']) {
    const inst = spawnCharacter(await loadHeroModel(heroId, 1));
    try {
      for (const alias of ['Hit_B', 'Hit_L', 'Hit_R', 'Death_B', ...(heroId === 'rogue' ? [] : ['Death_A'])]) {
        for (const k of [0, .2, .4, .6, .8, 1]) { pose(inst, alias, k); expect(skinMinY(inst.root), `${heroId}/${alias}@${k}`).toBeGreaterThan(-.03); }
      }
    } finally { disposeCharacter(inst.root, inst.mixer); }
  }
});

test('몬스터: 팩이 붙은 라이브러리 몬스터는 이음새 보정 클립·두 번째 사망·등장을 쓰고 타격 프레임 키는 원본 그대로다', async () => {
  const gltf = await loadModel('bone_knight');
  const e = new Actor({ scene: new THREE.Scene() }, gltf, { rig: 'library' });
  try {
    expect(e.clips.attack2Seam).toBeTruthy(); expect(e.clips.deathAlt).toBeTruthy(); expect(e.clips.spawn).toBeTruthy();
    expect(e.rig.attack2).toBe('attack2Seam');
    expect(e.rig.attack).toEqual(['attack', 'attack2Seam']);          // 후보 수 그대로 → 난수 소비 동일
    expect(e.rig.attackJump).toEqual(['attackJumpSeam', 'attackHeavy', 'attack']);
    expect(e.has('spawn')).toBe(true);
    expect(libraryClipKey(e.libraryAsset, 'attack2Seam')).toBe('attack2');
    expect(e.libraryAsset.impacts?.[libraryClipKey(e.libraryAsset, 'attack2Seam')!]).toBe(e.libraryAsset.impacts?.attack2);
    expect(motionFromRest({ root: e.model, mixer: e.mixer, clips: e.clips }, 'spawn')).toBeGreaterThan(20);
    e.die('deathAlt'); expect(e.actionName).toBe('deathAlt');
  } finally { e.dispose(); }
  expect(libraryPackRig(RIGS.library, { attack: {}, hit: {} })).toBe(RIGS.library);   // 팩 없으면 같은 객체
});

test('모든 몬스터 팩 자산이 실제 로드에서 deathAlt 를 얻고, 인간형 8종은 등장 클립을 얻는다', async () => {
  for (const pack of REG.packs.filter((p: any) => !p.asset.startsWith('hero_'))) {
    const gltf = await loadModel(pack.asset);
    const names = new Set(gltf.animations.map((c: any) => c.name));
    for (const name of Object.keys(pack.clips)) expect(names.has(name), `${pack.asset}/${name}`).toBe(true);
    expect(names.has('deathAlt')).toBe(true);
  }
  const humanoids = REG.packs.filter((p: any) => p.clips.spawn).map((p: any) => p.asset).sort();
  expect(humanoids).toEqual(['bone_knight', 'demon_lord', 'frost_yeti', 'goblin_brute', 'goblin_chief', 'goblin_raider', 'shadow_soldier', 'skeleton_mage']);
});

test('영웅 강타 피격 방향: 옆은 좌/우, 정면은 넉백, 등 뒤는 움츠림. 팩 클립이 없으면 예전 난수 규칙', () => {
  const clips = { Hit_A: 1, Hit_B: 2, Hit_L: 3, Hit_R: 4 };
  const pick = (yaw: number, dirx: number, dirz: number, c: any = clips, r = .9) => Player.prototype.heavyHurtClip.call({ yaw, clips: c }, dirx, dirz, r);
  // 정면(+Z)을 보는 영웅. 밀린 방향 dir 의 반대쪽에 공격자가 있다.
  expect(pick(0, 0, -1)).toBe('Hit_B');      // 공격자 정면
  expect(pick(0, 0, 1)).toBe('Hit_A');       // 공격자 등 뒤
  expect(pick(0, -1, 0)).toBe('Hit_L');      // 공격자 +X = 영웅의 왼쪽
  expect(pick(0, 1, 0)).toBe('Hit_R');
  expect(pick(Math.PI / 2, 0, 1)).toBe('Hit_L');   // +X 를 보면 왼쪽은 -Z
  expect(pick(0, -1, 0, { Hit_A: 1, Hit_B: 2 }, .2)).toBe('Hit_A');
  expect(pick(0, -1, 0, { Hit_A: 1, Hit_B: 2 }, .7)).toBe('Hit_B');
  expect(pick(0, -1, 0, { Hit_A: 1, Hit_B: 2, Hit_L: 1, Hit_R: 1 }, .7)).toBe('Hit_B');   // 좌우가 원본 hit 와 같으면 예전 규칙
});
