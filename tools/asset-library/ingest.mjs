import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { LOGICAL_CLIPS, validateManifest } from './manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
const blender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const args = process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out[value.slice(2)] = all[index + 1]?.startsWith('--') ? true : all[index + 1];
  return out;
}, {});

const required = (key) => { if (!args[key]) throw new Error(`missing --${key}`); return args[key]; };
const assetId = required('id');
// manifest 와 같은 규칙으로 ID 를 먼저 검사해 출력 경로 이탈(../ 등)을 막는다.
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(assetId)) throw new Error(`invalid --id: ${assetId}`);
const input = resolve(args.input || `${root}/asset-library/raw/${assetId}/${assetId}.glb`);
const outputDir = resolve(args.output || `${root}/asset-library/normalized`);
const output = resolve(outputDir, `${assetId}.glb`);
const staged = resolve(outputDir, `${assetId}.staged.glb`);
const manifestPath = resolve(args.manifest || `${root}/asset-library/manifest.json`);
const heightM = Number(args.height || 1.6);
const kind = args.kind || 'character';
const role = args.role || undefined;
const heroId = args.heroId || undefined;
if (role === 'hero' && (!heroId || !/^[a-z][a-z0-9_-]{0,63}$/.test(heroId))) throw new Error('hero assets require --heroId');
if (role && role !== 'hero') throw new Error(`invalid --role: ${role}`);
// 영웅 갑옷 단계(1|2|3). 메시만 있는 2·3단계는 --map '{}' 로 넣으면 1단계 클립을 런타임에서 공유한다.
const armorTier = args.armorTier === undefined ? undefined : Number(args.armorTier);
if (armorTier !== undefined && (role !== 'hero' || ![1, 2, 3].includes(armorTier))) throw new Error('--armorTier requires --role hero and 1|2|3');
const body = args.body || (kind === 'prop' ? 'none' : 'biped');
const boss = args.boss === true || args.boss === 'true';
const triangleLimit = kind === 'prop' ? 4000 : boss ? 20000 : 12000;
const map = args.map || (kind === 'prop' ? '{}' : JSON.stringify(role === 'hero'
  ? { idle: 'idle', run: 'run', hit: 'hit', death: 'death' }
  : { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', attackHeavy: 'attackHeavy', hit: 'hit', death: 'death' }));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// 갑옷 단계 메시를 1단계 정규화 골격에 다시 묶은 파일은 재정규화하면 골격 배율·원점이 1단계와 어긋나므로 그대로 들인다.
const prenormalized = args.prenormalized === true || args.prenormalized === 'true';
if (prenormalized && !(role === 'hero' && armorTier > 1)) throw new Error('--prenormalized is only for hero armor tiers 2|3');
// Blender 임시 파일(WebP 변환 등)은 프로젝트 안 work/tmp/blender 에서만 만든다.
const blenderTemp = resolve(root, 'work/tmp/blender');
const run = (command, commandArgs) => new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { stdio: 'inherit', env: { ...process.env, TEMP: blenderTemp, TMP: blenderTemp } });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${basename(command)} exited with ${code}`)));
});
const countTriangles = (json) => (json.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives || []).reduce((meshSum, primitive) => {
  const accessor = json.accessors?.[primitive.indices];
  return meshSum + (accessor?.count || 0) / 3;
}, 0), 0);

await mkdir(outputDir, { recursive: true });
await mkdir(blenderTemp, { recursive: true });
const rawBytes = await readFile(input);
// 임시 파일에 정규화하고, 검증과 manifest 갱신이 모두 끝난 뒤에만 기존 결과를 교체한다.
await rm(staged, { force: true });
try {
  if (prenormalized) await writeFile(staged, rawBytes);
  else await run(blender, ['--background', '--python-exit-code', '1', '--python', resolve(root, 'tools/asset-library/blender_normalize.py'), '--', '--source', input, '--output', staged,
    '--height', String(heightM), '--kind', kind, '--map', map, ...(boss ? ['--boss'] : []), ...(args.yaw ? ['--yaw', String(args.yaw)] : [])]);
  const bytes = await readFile(staged);
  const gltfJson = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  const triangles = Math.floor(countTriangles(gltfJson));
  if (triangles > triangleLimit) throw new Error(`triangle budget exceeded: ${triangles} > ${triangleLimit}`);
  const animations = new Set((gltfJson.animations || []).map((animation) => animation.name));
  const clips = kind === 'prop' ? [] : Object.keys(JSON.parse(map));
  for (const clip of clips) if (!animations.has(clip)) throw new Error(`missing required clip: ${clip}`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.assets = manifest.assets.filter((asset) => asset.id !== assetId);
  manifest.assets.push({
    id: assetId, kind, body, replaces: args.replaces || null, file: `/models/library/${assetId}.glb`, heightM, triangles,
    bytes: bytes.length, sha256: sha256(bytes),
    clips: Object.fromEntries(clips.map((key) => [key, key])),
    provenance: { tool: 'Blender 5.2', account: 'owner subscription', taskId: args.taskId || '', prompt: args.prompt || '', createdAt: new Date().toISOString(), rawSha256: sha256(rawBytes) },
    license: 'owner-generated (Tripo subscription)', shared: args.shared !== 'false', ...(role ? { role, heroId } : {}), ...(armorTier ? { armorTier } : {}), ...(boss ? { boss: true } : {}),
  });
  validateManifest(manifest);
  await rename(staged, output);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ id: assetId, output, triangles, bytes: (await stat(output)).size, sha256: sha256(bytes) }));
} finally {
  await rm(staged, { force: true });
}

