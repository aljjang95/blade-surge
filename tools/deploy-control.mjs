import { randomUUID } from 'node:crypto';
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import config from './release-config.json' with { type: 'json' };

export function cloudflareQuery(env = process.env) {
  const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  const database = env.APEX_RSI_DB || config.leaseDatabaseId;
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !token || !/^[a-f0-9-]{36}$/.test(database)) throw new Error('Cloudflare 자격증명 경로를 확인하세요.');
  return async (sql, params = []) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true || result.result?.[0]?.success !== true) throw new Error(`배포 잠금 저장소 응답 오류 (${response.status})`);
    return result.result[0];
  };
}

export async function acquireDeploymentLease(query, { head, axis = config.leaseAxis, owner = randomUUID() }) {
  const read = async () => (await query('SELECT session FROM rsi_claim WHERE repo = ? AND axis = ?', [config.repository, axis])).results[0]?.session;
  try {
    await query('INSERT INTO rsi_claim (repo, axis, session, base_sha, started_at, note) VALUES (?, ?, ?, ?, ?, ?)',
      [config.repository, axis, owner, head, new Date().toISOString(), '검증된 배포 전환 잠금']);
  } catch {
    // 응답 단절 후에도 실제 INSERT 성공 여부를 같은 소유자 값으로 대조한다.
    if (await read() !== owner) throw new Error('동일 대상의 다른 배포가 잠금을 보유하고 있습니다.');
  }
  const assertHeld = async () => { if (await read() !== owner) throw new Error('배포 잠금 소유권을 잃었습니다.'); };
  await assertHeld();
  return { owner, assertHeld, release: async () => {
    const result = await query('DELETE FROM rsi_claim WHERE repo = ? AND axis = ? AND session = ?', [config.repository, axis, owner]);
    if (result.meta.changes !== 1) throw new Error('배포 잠금 해제를 확인하지 못했습니다.');
  } };
}

function syncDirectory(path) {
  let directory;
  try { directory = openSync(path, 'r'); fsyncSync(directory); }
  catch (error) { if (process.platform !== 'win32' || !['EINVAL', 'EISDIR', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { if (directory !== undefined) closeSync(directory); }
}

export class ReceiptPersistenceError extends Error {
  constructor(cause) {
    super('영수증 정본은 교체됐지만 디렉터리 동기화를 확인하지 못했습니다.', { cause });
    this.committed = true;
  }
}

export function persistDeployment(path, receipt, write = writeFileSync, synchronize = syncDirectory) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd, committed = false;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    write(fd, JSON.stringify(receipt, null, 2)); fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    committed = true;
    // Windows가 디렉터리 fsync를 지원하지 않아도 정본 교체 전 파일 fsync는 완료돼 있다.
    synchronize(dirname(path));
  } catch (error) {
    if (committed) throw new ReceiptPersistenceError(error);
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!committed) try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function commitReceipt(receipt, persist, patch) {
  const { persistenceUncertain, ...previous } = receipt;
  const next = { ...previous, ...patch };
  try { persist(next); }
  catch (error) {
    if (error.committed) { Object.assign(receipt, next); receipt.persistenceUncertain = true; }
    throw error;
  }
  delete receipt.persistenceUncertain;
  Object.assign(receipt, next);
}

export const canReleaseDeploymentLease = (receipt) => !receipt?.persistenceUncertain && !['deploying-unknown', 'outcome-unknown'].includes(receipt?.status);

export const latestDeployment = (list) => [...list].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];

export async function reconcileDeployment({ receipt, persist, observe, assertHeld, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await assertHeld();
      last = await observe();
      const current = latestDeployment(last.deployments);
      const ordered = [...last.deployments].sort((a, b) => Date.parse(a.created_on) - Date.parse(b.created_on));
      const previousIndex = ordered.findIndex((item) => item.id === receipt.rollbackDeploymentId);
      const additions = previousIndex >= 0 ? ordered.slice(previousIndex + 1) : [];
      if (last.live?.sha === receipt.head && last.live.dirty === false && current?.versions?.length === 1
        && current.versions[0].percentage === 100 && current.id !== receipt.rollbackDeploymentId
        && additions.length === 1 && last.tag === receipt.tag) {
        commitReceipt(receipt, persist, { status: 'version-verified', deploymentId: current.id, versionId: current.versions[0].version_id,
          verifiedAt: new Date().toISOString(), live: last.live });
        return receipt;
      }
      receipt.observedDeploymentIds = additions.map((item) => item.id);
    } catch { receipt.observationFailed = true; }
    if (attempt < 7) await wait(2000);
  }
  commitReceipt(receipt, persist, { status: 'outcome-unknown', lastObservedSHA: last?.live?.sha ?? null });
  throw new Error('원격 반영 상태를 확정하지 못했습니다. 잠금을 유지하고 영수증으로 재조정해야 합니다.');
}

export async function deployAndReconcile({ receipt, persist, deploy, observe, assertHeld, wait }) {
  await assertHeld();
  commitReceipt(receipt, persist, { status: 'deploying-unknown' });
  try { await deploy(); receipt.commandFailed = false; }
  catch { receipt.commandFailed = true; }
  // CLI의 종료 코드와 무관하게 실제 라이브·버전·소유 태그를 확인한다.
  persist(receipt);
  return reconcileDeployment({ receipt, persist, observe, assertHeld, wait });
}
