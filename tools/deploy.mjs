#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guard, readVersion } from './deploy-guard.mjs';
import { acquireDeploymentLease, canReleaseDeploymentLease, cloudflareQuery, deployAndReconcile, latestDeployment, persistDeployment, reconcileDeployment } from './deploy-control.mjs';
import config from './release-config.json' with { type: 'json' };

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const run = (file, args = [], capture = false) => execFileSync(process.execPath, [file, ...args], {
  encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout: 120000,
});
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const deployments = () => JSON.parse(run(wrangler, ['deployments', 'list', '--json', '--name', config.worker], true));
const receiptPath = '_autopipe/evidence/release-deployment.json';
mkdirSync('_autopipe/evidence', { recursive: true });
const persist = (receipt) => persistDeployment(receiptPath, receipt);
let query, lease, receipt;
try {
  query = cloudflareQuery();
  if (process.argv.includes('--force')) throw new Error('force 우회는 지원하지 않습니다.');
  const recovering = process.argv.includes('--reconcile');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (recovering) {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!['prepared', 'deploying-unknown', 'outcome-unknown', 'version-verified'].includes(receipt.status) || receipt.head !== head || receipt.target !== config.origin || !/^[a-f0-9-]{36}$/.test(receipt.leaseOwner)) throw new Error('재조정할 배포 영수증과 HEAD가 다릅니다.');
    lease = await acquireDeploymentLease(query, { head, owner: receipt.leaseOwner, mustExist: true });
  } else {
    lease = await acquireDeploymentLease(query, { head });
    const preflight = await guard();
    if (preflight.head !== head) throw new Error('잠금 획득 중 HEAD가 바뀌었습니다.');
    const previous = latestDeployment(deployments());
    if (!previous?.id || previous.versions?.length !== 1 || previous.versions[0].percentage !== 100) throw new Error('단일 rollback 버전을 확정할 수 없습니다.');
    receipt = { ...preflight, status: 'prepared', preparedAt: new Date().toISOString(), leaseOwner: lease.owner,
      tag: 'bs-' + lease.owner.replaceAll('-', '').slice(0, 20), rollbackDeploymentId: previous.id, rollbackVersionId: previous.versions[0].version_id };
    persist(receipt);
    run('node_modules/vite/bin/vite.js', ['build']); run('tools/write-version.mjs');
    const artifact = JSON.parse(readFileSync('dist/version.json', 'utf8'));
    if (artifact.sha !== head || artifact.dirty !== false) throw new Error('빌드와 검증한 커밋이 다릅니다.');
    const finalGuard = await guard(preflight.live);
    if (finalGuard.head !== head || latestDeployment(deployments()).id !== previous.id) throw new Error('준비 중 배포 기준이 바뀌었습니다.');
  }
  const observe = async () => {
    const live = await readVersion(), list = deployments(), current = latestDeployment(list);
    const version = current?.versions?.[0]?.version_id;
    const details = version ? JSON.parse(run(wrangler, ['versions', 'view', version, '--json', '--name', config.worker], true)) : {};
    return { live, deployments: list, tag: details.annotations?.['workers/tag'] };
  };
  const checks = { receipt, persist, observe, assertHeld: lease.assertHeld };
  if (recovering) await reconcileDeployment(checks);
  else await deployAndReconcile({ ...checks, deploy: () => run(wrangler, ['deploy', '--name', config.worker, '--tag', receipt.tag]) });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) { console.error(`배포 검증 중단: ${error.message}`); process.exitCode = 1; }
finally {
  if (lease && canReleaseDeploymentLease(receipt)) {
    try { await lease.release(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
