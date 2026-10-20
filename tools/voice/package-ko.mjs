// 검증된 WAV를 게임용 MP3로만 변환하고 입력·출력 해시 manifest를 남긴다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] || 'work/voice-ko';
const outDir = process.argv[3] || 'public/sfx/voice';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const rows = [];
mkdirSync(outDir, { recursive: true });
for (const heroId of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
  const sourceDir = join(root, 'lines-wav', heroId);
  for (const name of readdirSync(sourceDir).filter(value => value.endsWith('.wav')).sort()) {
    const key = name.slice(0, -4);
    const input = join(sourceDir, name);
    const output = join(outDir, `hero_${heroId}_${key}.mp3`);
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map_metadata', '-1', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${heroId}/${key}: ${result.stderr}`);
    rows.push({ heroId, key, input, inputSha256: hash(input), output, outputSha256: hash(output), conversion: 'wav-to-mp3', filters: [], postProcessing: 'none' });
  }
}
const heroIds = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const casts = heroIds.map(id => {
  const receiptPath = readdirSync(join(root, 'casting')).filter(name => name.startsWith(`${id}-seed-`) && name.endsWith('.receipt.json')).sort().at(-1);
  return { heroId: id, ...JSON.parse(readFileSync(join(root, 'casting', receiptPath), 'utf8')) };
});
const fishReceipts = heroIds.map(id => ({ heroId: id, ...JSON.parse(readFileSync(join(root, 'lines-wav', id, 'fish-receipt.json'), 'utf8')) }));
const manifest = { provider: { casting: 'runware', castingModel: 'bytedance:seed-audio@1.0', tts: 'fish', ttsModel: 's2.1-pro-free' },
  costUsd: casts.reduce((sum, receipt) => sum + Number(receipt.providerCostUsd || 0), 0), casting: casts.map(receipt => ({ heroId: receipt.heroId, taskUUID: receipt.taskUUID, imageSha256: receipt.imageSha256, outputSha256: receipt.sha256, providerCostUsd: receipt.providerCostUsd })),
  tts: fishReceipts.map(receipt => ({ refSha256: receipt.refSha256, outputCount: receipt.results.length, costUsd: receipt.costUsd, normalize: receipt.normalize, postProcessing: receipt.postProcessing })), humanListening: 'pending', files: rows };
writeFileSync(join(root, 'voice-ko-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ files: rows.length, costUsd: manifest.costUsd, manifest: join(root, 'voice-ko-manifest.json') }));
