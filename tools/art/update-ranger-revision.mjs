import fs from 'node:fs'; import { createHash } from 'node:crypto';
// node tools/art/update-ranger-revision.mjs [revision.json] — 생략하면 v1 기록.
const p = process.argv[2] || 'src/data/ranger-library-revision-v1.json', rev = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = fs.readFileSync('public' + rev.output.path); rev.output.sha256 = createHash('sha256').update(out).digest('hex');
const len = out.readUInt32LE(12), j = JSON.parse(out.subarray(20, 20 + len));
rev.clips = Object.fromEntries(j.animations.map(a => [a.name, +Math.max(...a.samplers.map(s => j.accessors[s.input].max[0])).toFixed(4)]));
fs.writeFileSync(p, JSON.stringify(rev, null, 2) + '\n'); console.log(rev.output.sha256, JSON.stringify(rev.clips));
