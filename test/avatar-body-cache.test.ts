import { afterAll, beforeAll, expect, test } from 'bun:test';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, preloadHeroBody, preloadAvatarBody, spawnCharacter, applyLibraryHeroBody, disposeCharacter,
  releaseAvatarBody, avatarBodyReady, heroBodyUserCount } from '../src/engine/assets.js';
import { applyLook } from '../src/game/look.js';
import { HEROES } from '../src/data/heroes.js';
import manifest from '../asset-library/manifest.json';

let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const asset = (id: string) => manifest.assets.find((entry: any) => entry.id === id)!;
const FOX = 'avatar_ranger_fox';

test('받아 둔 아바타 몸은 같은 프레임에 교체되고 믹서 시간이 이어지며, 입은 동안은 해제되지 않는다', async () => {
  const base = await loadHeroModel('ranger', 1);
  expect(await preloadAvatarBody(FOX)).toBe(true); expect(avatarBodyReady(FOX)).toBe(true);
  const instance = spawnCharacter(base);
  const idle = instance.mixer.clipAction(instance.clips.Idle); idle.play(); instance.mixer.update(.37);
  const t = idle.time;
  try {
    // 영웅 화면의 입기와 같은 경로(applyLook 재적용) — 동기 교체.
    applyLook(instance.root, HEROES.ranger, {}, { avatarId: FOX });
    expect(instance.root.userData.libraryBodyAssetId).toBe(FOX);
    expect(idle.time).toBe(t); expect(idle.isRunning()).toBe(true);
    expect(heroBodyUserCount(FOX)).toBe(1);
    expect(releaseAvatarBody(FOX)).toBe(false);
    // 벗기: 1단계 몸으로 돌아가면 사용 수가 0이 되고 해제할 수 있다.
    applyLook(instance.root, HEROES.ranger, {}, { avatarId: null });
    expect(instance.root.userData.libraryBodyAssetId).toBe('hero_ranger_t1');
    expect(heroBodyUserCount(FOX)).toBe(0);
    expect(releaseAvatarBody(FOX)).toBe(true); expect(avatarBodyReady(FOX)).toBe(false);
    // 해제 뒤 다시 받으면 다시 동기 교체된다.
    expect(await preloadAvatarBody(FOX)).toBe(true);
    expect(applyLibraryHeroBody(instance.root, asset(FOX))).toBe(true);
    expect(heroBodyUserCount(FOX)).toBe(1);
  } finally { disposeCharacter(instance.root, instance.mixer); }
  expect(heroBodyUserCount(FOX)).toBe(0);
});

test('전투 입장 경로(preloadHeroBody → 새 인스턴스 applyLook)는 영웅 화면과 같은 아바타 몸을 첫 프레임에 입는다', async () => {
  const base = await loadHeroModel('ranger', 1);
  await preloadHeroBody('ranger', 1, FOX);
  const player = spawnCharacter(base);
  try {
    let swapped = false; player.root.userData.onLibraryBodySwap = () => { swapped = true; };
    applyLook(player.root, HEROES.ranger, {}, { avatarId: FOX });
    expect(player.root.userData.libraryBodyAssetId).toBe(FOX);
    expect(player.root.userData.libraryTargetId).toBe(FOX);
    expect(swapped).toBe(true);   // 같은 호출 안의 동기 교체 알림(비동기 대기 없음)
  } finally { disposeCharacter(player.root, player.mixer); }
});
