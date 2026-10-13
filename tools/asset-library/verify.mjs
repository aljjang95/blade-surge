import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { triangleLimit, validateManifest } from './manifest.mjs';
const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(process.argv[2] || `${root}/asset-library/manifest.json`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
validateManifest(manifest);
const seen = new Set();
for (const asset of manifest.assets) {
  if (seen.has(asset.id)) throw new Error(`duplicate id: ${asset.id}`);
  seen.add(asset.id);
  const publicPath = resolve(root, `.${asset.file}`);
  const normalizedPath = resolve(root, 'asset-library/normalized', `${asset.id}.glb`);
  const path = await stat(publicPath).then(() => publicPath).catch(() => normalizedPath);
  const bytes = await readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`artifact mismatch: ${asset.id}`);
  // 영웅은 대기·달리기, 몬스터는 대기·공격이 최소 논리 클립이다. 메시 전용 갑옷 단계(armorTier>1)는 1단계 클립을 공유한다.
  const meshOnly = asset.role === 'hero' && (asset.armorTier || 1) > 1 && !Object.keys(asset.clips || {}).length;
  const requiredClips = asset.role === 'hero' ? ['idle', 'run'] : asset.kind === 'prop' ? [] : ['idle', 'attack'];
  if (!meshOnly && requiredClips.some((key) => !asset.clips?.[key])) throw new Error(`missing clip key: ${asset.id}`);
  // 보스는 manifest 규칙과 같은 20,000 삼각형 예산을 쓴다.
  if (asset.triangles > triangleLimit(asset)) throw new Error(`triangle budget exceeded: ${asset.id}`);
}
console.log(`asset library verified: ${manifest.assets.length} asset(s)`);
