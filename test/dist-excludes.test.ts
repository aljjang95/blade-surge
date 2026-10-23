import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_TRACKS, bgmUrl, musicForScene } from '../src/data/music.js';
import { CHAPTERS, stageDef } from '../src/data/stages.js';
import { classify, loadSplit } from '../tools/optimize/asset-split.mjs';

// tools/optimize/dist-excludes.json 은 빌드 산출물에서만 뺄 미사용 자산 목록이다. 누군가 나중에 이 자산을 코드에서 참조하면 이 테스트가 실패한다.
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'tools/optimize/dist-excludes.json'), 'utf8')) as { schema: string; entries: { path: string; reason: string }[]; channelExcludes: Record<string, { glob?: string; path?: string; reason: string }[]> };

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const sources = [...walk(join(root, 'src')), join(root, 'index.html'), join(root, 'public/sw.js'), join(root, 'public/manifest.webmanifest'),
  ...readdirSync(join(root, 'public')).filter(name => name.endsWith('.html')).map(name => join(root, 'public', name))];
const texts = new Map(sources.map(file => [file.slice(root.length), readFileSync(file, 'utf8')]));

// 이름이 나오더라도 로드가 아닌 곳: 개정 기록 JSON(테스트만 읽음, 경로 필드는 어디서도 fetch 되지 않음)과 로비 홀의 표시용 이름 문자열.
const RECORD_ONLY: Record<string, string[]> = {
  'models/heroes-next/ranger-library-t1-v1.glb': ['src/data/ranger-library-revision-v1.json'],
  'models/heroes-next/ranger-library-t1-v2.glb': ['src/data/ranger-library-revision-v2.json'],
  'models/heroes-next/ranger-library-t1-v3.glb': ['src/data/ranger-library-revision-v3.json'],
  // v4 는 v6(와 철회된 v5)의 클립 원본 기록(clipSource)과 그 클립에 묶인 2·3단계·여우 저작 동작의 base 기록에만 나온다(hero-body-motion.js 는 v4 기록을 import 해 base 경로·SHA 를 비교만 하고 GLB 를 fetch 하지 않음).
  'models/heroes-next/ranger-library-t1-v4.glb': ['src/data/ranger-library-revision-v4.json', 'src/data/ranger-library-revision-v5.json', 'src/data/ranger-library-revision-v6.json',
    'src/data/higher-body-motion-v1.json', 'src/data/fox-body-motion-v1.json', 'src/data/ranger-t1-body-motion-v1.json', 'src/data/ranger-t1-body-motion-v2.json',
    // 3단계 v2 몸은 v4 골격에 재결합한 몸이라 개정 기록(authoring.base)과 띠 곡선 기록(base)에 v4 가 나온다.
    'src/data/ranger-t3-body-revision-v2.json', 'src/data/ranger-t3-body-motion-v2.json'],
  // 철회된 v5 는 자기 기록·1단계 곡선 v1 기록과 v6 의 철회 기록에만 나온다.
  'models/heroes-next/ranger-library-t1-v5.glb': ['src/data/ranger-library-revision-v5.json', 'src/data/ranger-library-revision-v6.json', 'src/data/ranger-t1-body-motion-v1.json'],
  // 3단계 궁수 v1 몸은 v2 가 대신한다. 이력 기록 두 개와 v2 개정 기록(재질 마감 비교 사유)에만 나온다.
  'models/heroes-next/ranger-t3-body-fit-v1.glb': ['src/data/higher-body-revisions-v1.json', 'src/data/higher-body-motion-v1.json', 'src/data/ranger-t3-body-revision-v2.json'],
  'models/heroes-next/rogue-library-t1-axis-v1.glb': ['src/data/rogue-library-revision-v1.json', 'src/data/rogue-library-revision-v2.json'],
  'models/oathhall-v2': ['src/engine/oathhall-asset.js'],
};

test('제외 목록은 올바른 스키마이고 원본 파일은 public 에 그대로 남아 있다', () => {
  expect(manifest.schema).toBe('blade-surge.dist-excludes.v1');
  expect(manifest.entries.length).toBeGreaterThan(0);
  expect(new Set(manifest.entries.map(entry => entry.path)).size).toBe(manifest.entries.length);
  for (const entry of manifest.entries) {
    expect(entry.reason.length, entry.path).toBeGreaterThan(5);
    expect(entry.path.startsWith('/') || entry.path.includes('..'), entry.path).toBe(false);
    expect(existsSync(join(root, 'public', entry.path)), `public/${entry.path}`).toBe(true);
  }
});

test('제외한 자산은 코드·HTML·서비스 워커에서 참조되지 않는다(허용한 기록·표시용 이름 제외)', () => {
  for (const entry of manifest.entries) {
    const needles = [`/${entry.path}`, basename(entry.path)];
    const hits = [...texts].filter(([, text]) => needles.some(needle => text.includes(needle))).map(([file]) => file).sort();
    expect(hits, entry.path).toEqual([...(RECORD_ONLY[entry.path] || [])].sort());
  }
});

test('개정 기록 JSON 은 src 코드에서 import 되지 않거나(v1~v3, axis) 경로 필드를 읽지 않는다', () => {
  const code = [...texts].filter(([file]) => /\.(js|ts|tsx)$/.test(file));
  for (const record of ['ranger-library-revision-v1', 'ranger-library-revision-v2', 'ranger-library-revision-v3', 'rogue-library-revision-v1']) {
    expect(code.filter(([, text]) => text.includes(record)).map(([file]) => file), record).toEqual([]);
  }
  // rogue v2 기록의 packedPath(axis-v1 GLB)는 어떤 코드도 읽지 않는다.
  expect(code.filter(([, text]) => text.includes('packedPath')).map(([file]) => file)).toEqual([]);
});

// 채널별 BGM: 각 채널 산출물에는 그 채널의 bgmUrl 이 가리키는 파일만 남아야 한다(없는 파일 요청도, 쓰이지 않는 사본도 없다).
const bgmDir = join(root, 'public/bgm');
const allBgm = walk(bgmDir).map(file => file.slice(join(root, 'public').length + 1));
// MUSIC_TRACKS 는 musicForScene 이 돌려줄 수 있는 모든 곡이다(중간 보스곡 expansion/flow-combat 포함). 손으로 쓴 목록만 보면 새 곡을 빼먹는다.
const musicNames = [...new Set(['bgm_gacha', 'regions/lobby', 'regions/arena', 'regions/boss', ...CHAPTERS.map(chapter => musicForScene({ stage: stageDef(chapter.id, 1) })), ...MUSIC_TRACKS])];
const excludedBy = (channel: string) => {
  const globs = manifest.channelExcludes[channel] || [];
  return (file: string) => manifest.entries.some(entry => entry.path === file) || globs.some((entry: { glob?: string; path?: string }) => {
    if (entry.path) return entry.path === file;
    const [dir, ext] = entry.glob!.split('/*'); return file.startsWith(dir + '/') && file.endsWith(ext) && !file.slice(dir.length + 1).includes('/');
  });
};
const split = await loadSplit();
test.each(['web', 'apps-in-toss', 'googleplay', 'onestore'])('%s 채널 산출물의 BGM 은 bgmUrl 이 가리키는 파일과 정확히 같다', (channel) => {
  const used = new Set(musicNames.map(name => bgmUrl(name, channel).slice(1)));
  // 정식 웹 호스트는 Android 스트리밍 채널이 받아 가는 remote 곡의 Opus(.ogg)도 내보낸다(APK 에 싣는 core 곡의 .ogg 는 웹에 필요 없다).
  if (channel === 'web') for (const name of musicNames) { const ogg = bgmUrl(name, 'googleplay').slice(1); if (ogg.endsWith('.ogg') && classify(ogg, split)?.class === 'remote') used.add(ogg); }
  const shipped = allBgm.filter(file => !excludedBy(channel)(file));
  expect(shipped.sort()).toEqual([...used].sort());
  for (const file of used) expect(existsSync(join(root, 'public', file)), file).toBe(true);
});

test('Opus 는 Android 스토어 채널의 지역곡에만 쓰이고 가챠곡은 모든 채널에서 mp3 다', () => {
  expect(bgmUrl('regions/forge', 'googleplay')).toBe('/bgm/regions/forge.ogg');
  expect(bgmUrl('regions/forge', 'onestore')).toBe('/bgm/regions/forge.ogg');
  expect(bgmUrl('regions/forge', 'web')).toBe('/bgm/regions/forge.mp3');
  expect(bgmUrl('regions/forge', 'apps-in-toss')).toBe('/bgm/regions/forge.mp3');
  for (const channel of ['web', 'apps-in-toss', 'googleplay', 'onestore']) expect(bgmUrl('bgm_gacha', channel)).toBe('/bgm/bgm_gacha.mp3');
});
