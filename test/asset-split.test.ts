import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { classify, compileSplit, globToRegExp, loadSplit, scanOutput, stripRemote, summarize, verifyChannelBuild, writeAssetManifests } from '../tools/optimize/asset-split.mjs';
import { bgmUrl, musicForScene, townMusic } from '../src/data/music.js';
import { ENCOUNTER_ART } from '../src/data/encounter-art.js';
import { STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import manifest from '../asset-library/manifest.json';
import { NATIVE_ORIGINS } from '../worker/native-cors';

// core/remote 분할표(tools/optimize/asset-split.json)의 계약: 모든 산출물 파일이 분류되고, 첫 지역·부팅에 필요한 파일은 반드시 core 이며,
// 낡은 remote 규칙이 남지 않고, 빠진 core 나 APK 에 남은 remote 가 있으면 검사가 실패한다.
const root = new URL('../', import.meta.url).pathname;
const split = await loadSplit();

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
// 산출물에 실리는 public 파일(빌드가 복사하는 것). 최적화가 지우는 제외 목록은 따로 뺀다.
const excludes = JSON.parse(readFileSync(join(root, 'tools/optimize/dist-excludes.json'), 'utf8')) as { entries: { path: string }[] };
const excluded = (rel: string) => excludes.entries.some(entry => rel === entry.path || rel.startsWith(entry.path + '/'));
const publicFiles = walk(join(root, 'public')).map(file => relative(join(root, 'public'), file)).filter(rel => !excluded(rel));

test('glob: * 는 폴더를 넘지 않고 ** 는 넘으며 {a,b} 를 지원한다', () => {
  expect(globToRegExp('img/*.webp').test('img/a.webp')).toBe(true);
  expect(globToRegExp('img/*.webp').test('img/x/a.webp')).toBe(false);
  expect(globToRegExp('img/**').test('img/x/y/a.webp')).toBe(true);
  expect(globToRegExp('img/{a,b}.webp').test('img/b.webp')).toBe(true);
  expect(globToRegExp('img/{a,b}.webp').test('img/c.webp')).toBe(false);
  expect(globToRegExp('img/{boss_*,chronicle_*}.webp').test('img/boss_x.webp')).toBe(true);
  expect(globToRegExp('img/{boss_*,chronicle_*}.webp').test('img/mob_x.webp')).toBe(false);
  expect(globToRegExp('assets/hero_*_t2-*.glb').test('assets/hero_knight_t2-DXA55axF.glb')).toBe(true);
  expect(globToRegExp('bgm/regions/forge.*').test('bgm/regions/forge.ogg')).toBe(true);
});

test('public 의 모든 산출물 파일이 core 또는 remote 로 분류된다', () => {
  const unclassified = publicFiles.filter(rel => !classify(rel, split));
  expect(unclassified).toEqual([]);
});

test('모든 규칙은 이유가 있고, remote 규칙은 묶음 이름이 있다', () => {
  for (const rule of split.rules) {
    expect(rule.reason.length, rule.glob).toBeGreaterThanOrEqual(2);
    if (rule.class === 'remote') expect(rule.group, rule.glob).toMatch(/^[a-z0-9-]+$/);
  }
});

// 번들이 만드는 해시 이름(assets/<이름>-<해시>.glb)은 public 에 없으니 asset-library 목록으로 분류를 확인한다.
const hashed = (id: string) => `assets/${id}-Ab12Cd34.glb`;
test('번들 해시 이름 GLB: 1단계 영웅·몬스터는 core, 2·3단계 몸체와 아바타는 remote', () => {
  for (const asset of manifest.assets as { id: string; role?: string; armorTier?: number; avatar?: boolean }[]) {
    const verdict = classify(hashed(asset.id), split)!;
    const expected = asset.avatar ? 'remote' : asset.role === 'hero' && (asset.armorTier || 1) >= 2 ? 'remote' : 'core';
    expect(verdict.class, asset.id).toBe(expected);
  }
});

test('낡은 remote 규칙이 없다: 모든 remote 규칙이 public 파일 또는 번들 해시 GLB 와 맞는다', () => {
  const names = [...publicFiles, ...(manifest.assets as { id: string }[]).map(asset => hashed(asset.id))];
  // 웹 호스트에만 있는 Opus(.ogg) 지역곡도 public 에 있다.
  for (const rule of split.rules.filter((rule: any) => rule.class === 'remote')) {
    expect(names.some(name => rule.re.test(name)), `${rule.glob} 와 맞는 파일이 없습니다`).toBe(true);
  }
});

test('첫 지역·부팅에 필요한 파일은 core 다(곡, 조우 일러스트, 키아트, 글꼴, 1단계 영웅, 마을 곡)', () => {
  const tracks = new Set<string>(['bgm_gacha', 'regions/lobby']);
  for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(1, st);
    tracks.add(musicForScene({ stage })); tracks.add(musicForScene({ stage, boss: true }));
  }
  tracks.add(townMusic(1));
  for (const channel of ['googleplay', 'onestore', 'web']) for (const track of tracks) {
    expect(classify(bgmUrl(track, channel).slice(1), split)?.class, `${channel}:${track}`).toBe('core');
  }
  for (const id of ['garden_captain', 'garden_warden', 'garden_midboss', 'garden_finalboss']) expect(classify((ENCOUNTER_ART as Record<string, string>)[id].slice(1), split)?.class, id).toBe('core');
  for (const file of ['img/ui-crafted/keyart/dungeon-garden-keyart.webp', 'img/expansion/glass_garden.webp', 'img/expansion/guild_map.webp', 'img/expansion/thumb/glass_garden.webp',
    'fonts/blade-sans-kr-400.woff2', 'index.html', 'models/heroes-next/ranger-library-t1-v4.glb', 'models/heroes-next/rogue-library-t1-v2.glb', 'models/sanctuary-v2/sanctuary-v2.glb',
    'models/citadel-hub-v1/x.glb', 'sfx/mirelo-v1/x.mp3', 'textures/star-archive/rosette.webp']) expect(classify(file, split)?.class, file).toBe('core');
});

test('2~6지역의 곡·조우 일러스트·키아트는 지역 묶음 region-N 의 remote 다', () => {
  const regions: Record<string, number> = { forge: 2, frost: 3, tide: 4, crown: 5, homecoming: 6 };
  for (const [theme, n] of Object.entries(regions)) {
    expect(classify(`bgm/regions/${theme}.ogg`, split), theme).toMatchObject({ class: 'remote', group: `region-${n}` });
    expect(classify(`img/encounters/${theme}_captain.webp`, split), theme).toMatchObject({ class: 'remote', group: `region-${n}` });
    expect(classify(`img/ui-crafted/keyart/dungeon-${theme}-keyart.webp`, split), theme).toMatchObject({ class: 'remote', group: `region-${n}` });
  }
  // 로비 던전 카드가 부팅 직후 그리는 원정 보스 일러스트는 core, 던전 안 몬스터 일러스트만 remote.
  expect(classify('img/encounters/boss_obsidian_hydra.webp', split)?.class).toBe('core');
  expect(classify('img/encounters/chronicle_glass_hour_sovereign.webp', split)?.class).toBe('core');
  expect(classify('img/encounters/mob_cinderling.webp', split)).toMatchObject({ class: 'remote', group: 'expeditions' });
  // 새 BGM 은 규칙에 적지 않아도 기본이 remote 다.
  expect(classify('bgm/regions/new-town-song.ogg', split)).toMatchObject({ class: 'remote', group: 'bgm-extra' });
  expect(classify('video/expansion/glass-garden-intro.mp4', split)).toMatchObject({ class: 'remote', group: 'cinematic' });
});

// ---- 임시 산출물 폴더로 검사 도구를 시험한다 ----
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'blade-split-'));
  const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };
  put('index.html', '<html>'); put('assets/index-1.js', 'js'); put('assets/hero_knight_t1-aa.glb', 't1'); put('assets/hero_knight_t2-bb.glb', 't2');
  put('bgm/regions/lobby.ogg', 'lobby'); put('bgm/regions/forge.ogg', 'forge'); put('img/encounters/forge_captain.webp', 'cap'); put('img/encounters/garden_captain.webp', 'gc');
  return { dir, put, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('scanOutput/writeAssetManifests: core·remote 를 가르고 내용 해시와 묶음 크기를 적는다', async () => {
  const f = fixture();
  try {
    const { manifest: m } = (await writeAssetManifests(f.dir, { split, channel: 'googleplay', full: true, log: () => {} })) as any;
    expect(Object.keys(m.remote).sort()).toEqual(['assets/hero_knight_t2-bb.glb', 'bgm/regions/forge.ogg', 'img/encounters/forge_captain.webp']);
    expect(m.remote['bgm/regions/forge.ogg']).toMatchObject({ g: 'region-2', b: 5 });
    expect(m.remote['bgm/regions/forge.ogg'].h).toMatch(/^[0-9a-f]{16}$/);
    expect(m.groups['region-2']).toEqual({ files: 2, bytes: 8 });
    expect(existsSync(join(f.dir, 'asset-manifest.full.json'))).toBe(true);
    const scan = await scanOutput(f.dir, split);
    expect(summarize(scan).core.files).toBe(5);
  } finally { f.done(); }
});

test('분류되지 않은 파일이 있으면 매니페스트 생성이 실패한다', async () => {
  const f = fixture();
  try {
    f.put('mystery/new.bin', 'x');
    const strict = compileSplit({ schema: 'blade-surge.asset-split.v1', host: 'https://x', rules: [{ class: 'core', glob: 'index.html', reason: 'r' }] });
    await expect(writeAssetManifests(f.dir, { split: strict, log: () => {} })).rejects.toThrow('분류되지 않은');
  } finally { f.done(); }
});

test('stripRemote + verifyChannelBuild: 정상이면 통과, core 가 빠지거나 remote 가 남으면 실패한다', async () => {
  const f = fixture();
  try {
    await writeAssetManifests(f.dir, { split, channel: 'googleplay', full: true, log: () => {} });
    const full = JSON.parse(readFileSync(join(f.dir, 'asset-manifest.full.json'), 'utf8'));
    // remote 가 남은 상태
    expect((await verifyChannelBuild(f.dir, full)).some(problem => problem.includes('remote 파일이 APK'))).toBe(true);
    const removed = await stripRemote(f.dir, full);
    expect(removed.length).toBe(3);
    expect(existsSync(join(f.dir, 'img/encounters/forge_captain.webp'))).toBe(false);
    expect(existsSync(join(f.dir, 'img/encounters/garden_captain.webp'))).toBe(true);
    expect(await verifyChannelBuild(f.dir, full)).toEqual([]);
    // core 파일이 빠짐
    rmSync(join(f.dir, 'bgm/regions/lobby.ogg'));
    expect(await verifyChannelBuild(f.dir, full)).toEqual(['core 파일 없음: bgm/regions/lobby.ogg']);
    // core 내용이 달라짐
    writeFileSync(join(f.dir, 'bgm/regions/lobby.ogg'), 'tampered');
    expect(await verifyChannelBuild(f.dir, full)).toEqual(['core 해시 불일치: bgm/regions/lobby.ogg']);
  } finally { f.done(); }
});

test('(빌드 산출물이 있을 때) 스토어 web 폴더는 매니페스트 검사를 통과하고 remote 가 하나도 없다', async () => {
  const dir = join(root, 'work/store-builds/googleplay');
  if (!existsSync(join(dir, 'asset-manifest.full.json')) || !existsSync(join(dir, 'web/asset-manifest.json'))) return;
  const full = JSON.parse(readFileSync(join(dir, 'asset-manifest.full.json'), 'utf8'));
  expect(await verifyChannelBuild(join(dir, 'web'), full)).toEqual([]);
  // 빌드가 끝난 폴더 크기는 core 합계와 같다(매니페스트·버전 파일 몇 KB 제외).
  const bytes = walk(join(dir, 'web')).reduce((sum, file) => sum + statSync(file).size, 0);
  expect(bytes - full.core.bytes).toBeLessThan(64 * 1024); // asset-manifest.json·version.json 만큼
});

// 정식 호스트가 remote 파일을 Capacitor 앱 출처(https://localhost)에 CORS 로 내주는지: public/_headers 가 remote 규칙이 닿는 모든 최상위 폴더에 허용 출처를 붙여야 한다.
// 정적 자산은 Worker 를 거치지 않고 Static Assets 가 직접 응답하므로(wrangler.jsonc run_worker_first 는 /api/* 뿐) CORS 는 _headers 로만 붙는다.
test('_headers: remote 가 있는 모든 폴더에 앱 출처 CORS 가 있고, 그 값은 worker/native-cors.ts 의 허용 출처다', () => {
  const rules: { prefix: string; headers: Record<string, string> }[] = [];
  let current: { prefix: string; headers: Record<string, string> } | null = null;
  for (const line of readFileSync(join(root, 'public/_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = { prefix: line.trim().replace(/\*$/, ''), headers: {} }; rules.push(current); }
    else { const [k, ...v] = line.trim().split(':'); current!.headers[k.trim().toLowerCase()] = v.join(':').trim(); }
  }
  const folders = new Set(split.rules.filter((rule: any) => rule.class === 'remote').map((rule: any) => '/' + rule.glob.split('/')[0] + '/'));
  expect([...folders].sort()).toEqual(['/assets/', '/bgm/', '/img/', '/models/', '/video/']);
  for (const folder of folders) {
    const rule = rules.find(entry => entry.prefix === folder);
    expect(rule, folder).toBeDefined();
    const allow = rule!.headers['access-control-allow-origin'];
    expect(NATIVE_ORIGINS, folder).toContain(allow);
    expect(allow).not.toBe('*');
    expect(rule!.headers['access-control-allow-credentials']).toBeUndefined();
  }
});
