// 몬스터 빌드 결과(blender_build_monster.py / blender_rig_creature.py)를 라이브러리에 등록한다.
// 사용: node tools/asset-library/register_monster.mjs --spec <spec.json> --report <report.json> --prompt "..." [--taskId id] [--boss]
import { createHash } from 'node:crypto';
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IMPACT_CLIPS, LOGICAL_CLIPS, OPTIONAL_CLIPS, validateManifest } from './manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out[value.slice(2)] = all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? true : all[index + 1];
  return out;
}, {});
const need = (key) => { if (!args[key]) throw new Error(`missing --${key}`); return args[key]; };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const spec = JSON.parse(await readFile(need('spec'), 'utf8'));
const report = JSON.parse(await readFile(need('report'), 'utf8'));
if (!report.ok) throw new Error(`build failed: ${report.error}`);
const id = spec.id;
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('invalid id');
const bytes = await readFile(spec.output);
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const triangles = Math.floor((json.meshes || []).reduce((sum, mesh) => sum + mesh.primitives.reduce((s, p) => s + (json.accessors[p.indices]?.count || 0) / 3, 0), 0));
const animations = new Set((json.animations || []).map((a) => a.name));
const allowed = [...LOGICAL_CLIPS, ...OPTIONAL_CLIPS];
const clips = Object.fromEntries([...animations].filter((name) => allowed.includes(name)).sort().map((name) => [name, name]));
for (const key of LOGICAL_CLIPS) if (!clips[key]) throw new Error(`missing required clip ${key}`);
const impacts = Object.fromEntries(Object.entries(report.impacts || {}).filter(([key]) => IMPACT_CLIPS.includes(key) && clips[key]));
const source = spec.rigged || spec.input;
const rawSha256 = sha256(await readFile(source));
const manifestPath = resolve(root, 'asset-library/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const previous = manifest.assets.find((asset) => asset.id === id);
const entry = {
  id, kind: 'character', body: spec.profile === 'drake' ? 'quadruped' : 'biped', replaces: null,
  file: `/models/library/${id}.glb`, heightM: spec.height, triangles, bytes: bytes.length, sha256: sha256(bytes),
  clips, impacts, profile: spec.manifestProfile || spec.profile, ...(spec.hover ? { hover: spec.hover } : {}),
  provenance: {
    tool: 'Blender 5.2', account: 'owner subscription', taskId: String(args.taskId || previous?.provenance?.taskId || ''),
    prompt: String(args.prompt || previous?.provenance?.prompt || ''), createdAt: new Date().toISOString(), rawSha256,
  },
  license: 'owner-generated (Tripo subscription)', shared: true, ...(args.boss ? { boss: true } : {}),
};
manifest.assets = manifest.assets.filter((asset) => asset.id !== id);
manifest.assets.push(entry);
validateManifest(manifest);
const target = resolve(root, 'asset-library/normalized', `${id}.glb`);
const staged = `${target}.staged`;
await copyFile(spec.output, staged);
try { await rename(staged, target); } finally { await rm(staged, { force: true }); }
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ id, triangles, bytes: bytes.length, clips: Object.keys(clips).length, impacts }));

