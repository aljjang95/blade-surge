// core/remote 분할: 산출물 폴더의 모든 파일을 asset-split.json 규칙으로 분류하고, 파일별 내용 해시가 든 매니페스트를 만든다.
//  - writeAssetManifests: 최적화가 끝난 산출물 폴더에 asset-manifest.json(런타임용, remote 만)을 쓴다. 스토어 채널은 전체 목록도 만든다.
//  - stripRemote: 스토어 채널 web 폴더에서 remote 파일을 지운다(APK 에 싣지 않는다).
//  - verifyChannelBuild: core 가 빠짐없이 있고 remote 가 하나도 안 남았는지 검사한다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPLIT_FILE = path.join(here, 'asset-split.json');
export const MANIFEST_NAME = 'asset-manifest.json';
export const FULL_MANIFEST_NAME = 'asset-manifest.full.json';
export const MANIFEST_SCHEMA = 'blade-surge.asset-manifest.v1';
export const HASH_LENGTH = 16;

/** glob -> 정규식. * 는 / 를 넘지 않고 ** 는 넘으며 {a,b} 묶음을 지원한다. */
export function globToRegExp(glob) {
  let out = '', i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i += 2; if (glob[i] === '/') i += 1; continue; }
      out += '[^/]*'; i += 1; continue;
    }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) throw new Error(`닫히지 않은 중괄호: ${glob}`);
      out += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRegExp).join('|') + ')'; i = end + 1; continue;
    }
    out += escapeRegExp(c); i += 1;
  }
  return new RegExp(`^${out}$`);
}
const escapeRegExp = (text) => text.replace(/[.+?^$()|[\]\\]/g, '\\$&');

export async function loadSplit(file = SPLIT_FILE) {
  const split = JSON.parse(await fs.readFile(file, 'utf8'));
  return compileSplit(split);
}

export function compileSplit(split) {
  if (split.schema !== 'blade-surge.asset-split.v1') throw new Error('asset-split 스키마가 다릅니다.');
  const rules = split.rules.map((rule) => {
    if (rule.class !== 'core' && rule.class !== 'remote') throw new Error(`잘못된 class: ${rule.glob}`);
    if (rule.class === 'remote' && !rule.group) throw new Error(`remote 규칙에는 group 이 필요합니다: ${rule.glob}`);
    return { ...rule, re: globToRegExp(rule.glob) };
  });
  return { ...split, rules };
}

/** @returns {{class: 'core'|'remote', group: string|null, rule: object}|null} 일치하는 규칙이 없으면 null */
export function classify(relPath, split) {
  const rel = relPath.replace(/^\/+/, '');
  for (const rule of split.rules) if (rule.re.test(rel)) return { class: rule.class, group: rule.group || null, rule };
  return null;
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}
export const walkFiles = walk;

export const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LENGTH);

/** 산출물 폴더를 분류한다. 분류되지 않은 파일은 unclassified 에 모은다. 매니페스트 파일 자신은 제외한다. */
export async function scanOutput(outDir, split) {
  const core = {}, remote = {}, unclassified = [];
  for (const rel of await walk(outDir)) {
    if (rel === MANIFEST_NAME || rel === FULL_MANIFEST_NAME) continue;
    const verdict = classify(rel, split);
    if (!verdict) { unclassified.push(rel); continue; }
    const bytes = await fs.readFile(path.join(outDir, rel));
    const row = { h: hashBytes(bytes), b: bytes.length };
    if (verdict.class === 'core') core[rel] = row; else remote[rel] = { ...row, g: verdict.group };
  }
  return { core, remote, unclassified };
}

export function summarize(scan) {
  const groups = {};
  for (const row of Object.values(scan.remote)) {
    const group = (groups[row.g] ||= { files: 0, bytes: 0 });
    group.files += 1; group.bytes += row.b;
  }
  const sum = (rows) => Object.values(rows).reduce((total, row) => total + row.b, 0);
  return { groups, core: { files: Object.keys(scan.core).length, bytes: sum(scan.core) }, remoteTotal: { files: Object.keys(scan.remote).length, bytes: sum(scan.remote) } };
}

/**
 * 최적화가 끝난 산출물 폴더에 매니페스트를 쓴다. 분류되지 않은 파일이 있으면 실패한다.
 * full=true 이면 core 파일별 해시가 든 전체 목록(asset-manifest.full.json)도 쓴다(스토어 채널 빌드가 폴더 밖으로 옮긴다).
 */
export async function writeAssetManifests(outDir, { split = null, channel = 'web', release = null, full = false, log = console.log } = {}) {
  split ||= await loadSplit();
  const scan = await scanOutput(outDir, split);
  if (scan.unclassified.length) throw new Error(`core/remote 로 분류되지 않은 파일 ${scan.unclassified.length}개: ${scan.unclassified.slice(0, 8).join(', ')} — tools/optimize/asset-split.json 에 규칙을 추가하세요.`);
  const summary = summarize(scan);
  const manifest = { schema: MANIFEST_SCHEMA, channel, host: split.host, release, hashLength: HASH_LENGTH, groups: summary.groups, core: summary.core, remote: scan.remote };
  await fs.writeFile(path.join(outDir, MANIFEST_NAME), JSON.stringify(manifest) + '\n');
  if (full) await fs.writeFile(path.join(outDir, FULL_MANIFEST_NAME), JSON.stringify({ ...manifest, coreFiles: scan.core }, null, 1) + '\n');
  log(`[assets] core ${summary.core.files}개 ${(summary.core.bytes / 1e6).toFixed(1)}MB / remote ${summary.remoteTotal.files}개 ${(summary.remoteTotal.bytes / 1e6).toFixed(1)}MB (${Object.keys(summary.groups).length}개 묶음)`);
  return { manifest, scan, summary };
}

/** 스토어 채널 web 폴더에서 remote 파일을 지우고 지운 목록을 돌려준다. 빈 폴더도 치운다. */
export async function stripRemote(webDir, manifest) {
  const removed = [];
  for (const rel of Object.keys(manifest.remote)) {
    const target = path.resolve(webDir, rel);
    const relative = path.relative(webDir, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`산출물 밖 경로: ${rel}`);
    try { await fs.rm(target); removed.push(rel); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const prune = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name); await prune(sub);
      if (!(await fs.readdir(sub)).length) await fs.rmdir(sub);
    }
  };
  await prune(webDir);
  return removed;
}

/**
 * APK 에 들어갈 web 폴더 검사: 전체 목록의 core 가 하나도 빠지지 않고(해시 포함 일치), remote 는 하나도 없고, 모르는 파일이 없다.
 * @returns {Promise<string[]>} 문제 목록(비어 있으면 통과)
 */
export async function verifyChannelBuild(webDir, full) {
  const problems = [];
  const present = new Set((await walk(webDir)).filter((rel) => rel !== MANIFEST_NAME && rel !== FULL_MANIFEST_NAME));
  for (const [rel, row] of Object.entries(full.coreFiles)) {
    if (!present.has(rel)) { problems.push(`core 파일 없음: ${rel}`); continue; }
    const hash = hashBytes(await fs.readFile(path.join(webDir, rel)));
    if (hash !== row.h) problems.push(`core 해시 불일치: ${rel}`);
    present.delete(rel);
  }
  for (const rel of Object.keys(full.remote)) if (present.delete(rel)) problems.push(`remote 파일이 APK 폴더에 남음: ${rel}`);
  for (const rel of present) if (!(rel in full.remote)) problems.push(`매니페스트에 없는 파일: ${rel}`);
  return problems;
}
