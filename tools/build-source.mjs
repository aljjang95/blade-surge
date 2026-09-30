import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export function sourceSnapshot(root = projectRoot) {
  const names = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  const files = [...new Set(names.split('\0').filter(Boolean))].sort().map(file => {
    const full = path.resolve(root, file), stat = statSync(full);
    if (!stat.isFile()) throw Error(`Build input is not a regular file: ${file}`);
    return { file, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') };
  });
  return { algorithm: 'SHA256', digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
