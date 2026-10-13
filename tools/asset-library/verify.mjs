import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { triangleLimit, validateManifest } from './manifest.mjs';
const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(process.argv[2] || `${root}/asset-library/manifest.json`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
validateManifest(manifest);
const seen = new Set();
const glbJson = (bytes) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const jointNames = (json) => new Set((json.skins || []).flatMap((skin) => skin.joints.map((index) => json.nodes[index].name)));
const heroJoints = new Map();
const tierChecks = [];
for (const asset of manifest.assets) {
  if (seen.has(asset.id)) throw new Error(`duplicate id: ${asset.id}`);
  seen.add(asset.id);
  const publicPath = resolve(root, `.${asset.file}`);
  const normalizedPath = resolve(root, 'asset-library/normalized', `${asset.id}.glb`);
  const path = await stat(publicPath).then(() => publicPath).catch(() => normalizedPath);
  const bytes = await readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`artifact mismatch: ${asset.id}`);
  // 런타임은 2·3단계 메시를 1단계 골격에 본 이름으로 다시 묶으므로, 1단계에 없는 본(예: neutral_bone)이 있으면 조용히 1단계로 남는다.
  if (asset.role === 'hero') {
    if ((asset.armorTier || 1) === 1) heroJoints.set(asset.heroId, jointNames(glbJson(bytes)));
    else tierChecks.push({ asset, joints: jointNames(glbJson(bytes)) });
  }
  // 영웅은 대기·달리기, 몬스터는 대기·공격이 최소 논리 클립이다. 메시 전용 갑옷 단계(armorTier>1)는 1단계 클립을 공유한다.
  const meshOnly = asset.role === 'hero' && (asset.armorTier || 1) > 1 && !Object.keys(asset.clips || {}).length;
  const requiredClips = asset.role === 'hero' ? ['idle', 'run'] : asset.kind === 'prop' ? [] : ['idle', 'attack'];
  if (!meshOnly && requiredClips.some((key) => !asset.clips?.[key])) throw new Error(`missing clip key: ${asset.id}`);
  // 보스는 manifest 규칙과 같은 20,000 삼각형 예산을 쓴다.
  if (asset.triangles > triangleLimit(asset)) throw new Error(`triangle budget exceeded: ${asset.id}`);
}
for (const { asset, joints } of tierChecks) {
  const base = heroJoints.get(asset.heroId);
  if (!base) throw new Error(`tier without tier1 skeleton: ${asset.id}`);
  const extra = [...joints].filter((name) => !base.has(name));
  if (extra.length) throw new Error(`tier skeleton not in tier1: ${asset.id} (${extra.slice(0, 4).join(', ')})`);
}
console.log(`asset library verified: ${manifest.assets.length} asset(s)`);
