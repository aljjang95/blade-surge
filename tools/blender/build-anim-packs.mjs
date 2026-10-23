// 애니메이션 팩 일괄 생성(h4-anim). Blender 헤드리스를 자산마다 한 번씩 순서대로 돌려
// public/models/anim-packs/<자산>.glb 와 등록부 src/data/anim-packs-v1.json 을 만든다.
// 사용: BLENDER_BIN=/opt/blender-5.2.2-linux-x64/blender node tools/blender/build-anim-packs.mjs [--strips <dir>] [--only a,b]
// 원본 GLB 는 읽기만 한다. 같은 원본·스크립트·Blender 버전이면 같은 바이트가 나온다(test/anim-packs.test.ts 가 해시를 대조).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback = null) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

const rogue = json('src/data/rogue-library-revision-v2.json'), ranger = json('src/data/ranger-library-revision-v6.json');
// 게임이 실제로 읽는 1단계 몸체에서 클립을 뽑는다(도적·궁수는 교정본). 2·3단계·아바타는 1단계 클립을 공유한다.
const SOURCES = {
  hero_knight_t1: 'asset-library/normalized/hero_knight_t1.glb',
  hero_barbarian_t1: 'asset-library/normalized/hero_barbarian_t1.glb',
  hero_mage_t1: 'asset-library/normalized/hero_mage_t1.glb',
  hero_rogue_t1: 'public' + rogue.output.path,
  hero_ranger_t1: 'public' + ranger.output.path,
};
for (const id of ['slime', 'ember_drake', 'void_wisp', 'fire_phoenix', 'star_owl', 'bone_knight', 'skeleton_mage', 'goblin_brute', 'frost_yeti',
  'demon_lord', 'goblin_raider', 'shadow_soldier', 'goblin_chief', 'mushroom_shaman', 'treant', 'frost_golem']) SOURCES[id] = `asset-library/normalized/${id}.glb`;

const blender = process.env.BLENDER_BIN || 'blender';
const version = execFileSync(blender, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const strips = arg('strips');
const registryPath = resolve(ROOT, 'src/data/anim-packs-v1.json');
const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null;
const scripts = ['tools/blender/anim_lib.py', 'tools/blender/author_anim_packs.py'];
const packs = [];
const work = join(tmpdir(), 'blade-anim-packs'); mkdirSync(work, { recursive: true });
mkdirSync(resolve(ROOT, 'public/models/anim-packs'), { recursive: true });

for (const [asset, source] of Object.entries(SOURCES)) {
  if (only && !only.has(asset)) { const kept = previous?.packs.find(p => p.asset === asset); if (kept) packs.push(kept); continue; }
  const out = `public/models/anim-packs/${asset}.glb`, report = join(work, asset + '.json');
  if (existsSync(report)) rmSync(report);
  const args = ['-b', '--factory-startup', '-noaudio', '--python', resolve(ROOT, 'tools/blender/author_anim_packs.py'), '--',
    '--asset', asset, '--source', resolve(ROOT, source), '--out', resolve(ROOT, out), '--report', report];
  if (strips) args.push('--strips', strips);
  const started = Date.now();
  execFileSync(blender, args, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 1800000 });
  const r = JSON.parse(readFileSync(report, 'utf8'));
  packs.push({ asset, path: '/' + out.replace(/^public\//, ''), sha256: sha(resolve(ROOT, out)), bytes: readFileSync(resolve(ROOT, out)).length,
    source: { path: source, sha256: sha(resolve(ROOT, source)) }, humanoid: r.humanoid, hipsBone: r.hipsBone, clips: r.clips });
  console.log(`[anim-pack] ${asset} ${Object.keys(r.clips).length} clips ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const registry = {
  schema: 'blade-surge.anim-packs.v1', id: 'h4-anim-v1', blender: version,
  scripts: Object.fromEntries(scripts.map(path => [path, sha(resolve(ROOT, path))])),
  rule: '원본 GLB(메시·스킨·재질·텍스처)는 그대로 두고 새 클립만 뼈대와 함께 팩으로 낸다. 런타임은 원본을 읽은 뒤 팩 클립을 덧붙인다.',
  packs: packs.sort((a, b) => Object.keys(SOURCES).indexOf(a.asset) - Object.keys(SOURCES).indexOf(b.asset)),
};
writeFileSync(registryPath, JSON.stringify(registry, null, 1) + '\n');
console.log('[anim-pack] registry', registryPath, packs.length);
