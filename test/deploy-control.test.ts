import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireDeploymentLease, canReleaseDeploymentLease, deployAndReconcile, persistDeployment, reconcileDeployment, RECONCILABLE_STATUSES } from '../tools/deploy-control.mjs';

test('rename 후 EIO는 정본과 메모리를 맞추고 배포 잠금을 유지한다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-sync-')), path = join(directory, 'receipt.json');
  const receipt = { status: 'prepared', persistenceUncertain: false }; let called = false;
  try {
    persistDeployment(path, receipt);
    await expect(deployAndReconcile({ receipt,
      persist: (value: typeof receipt) => persistDeployment(path, value, writeFileSync, () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); }),
      deploy: () => { called = true; }, observe: async () => ({}), assertHeld: async () => {}, wait: async () => {},
    })).rejects.toThrow('정본은 교체');
    expect(JSON.parse(readFileSync(path, 'utf8')).status).toBe('deploying-unknown');
    expect(receipt.status).toBe('deploying-unknown'); expect(receipt.persistenceUncertain).toBe(true);
    expect(called).toBe(false); expect(canReleaseDeploymentLease(receipt)).toBe(false);
  } finally { unlinkSync(path); rmdirSync(directory); }
});

test('영수증 교체 전 쓰기 실패에도 이전 재조정 영수증은 온전히 남는다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-receipt-')), path = join(directory, 'receipt.json');
  try {
    persistDeployment(path, { status: 'deploying-unknown', leaseOwner: 'retained' });
    expect(() => persistDeployment(path, { status: 'version-verified' }, () => { throw new Error('disk full'); })).toThrow('disk full');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ status: 'deploying-unknown', leaseOwner: 'retained' });
    expect(readdirSync(directory)).toEqual(['receipt.json']);
  } finally { unlinkSync(path); rmdirSync(directory); }
});

test('종료 상태 저장 후 EIO로 남은 잠금도 새 프로세스에서 원격 호출 없이 해제한다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-aborted-')), path = join(directory, 'receipt.json');
  const owner = crypto.randomUUID(); let session: string | undefined = owner;
  const mutations: string[] = []; let observations = 0;
  const query = async (sql: string) => {
    if (sql.startsWith('SELECT')) return { results: session ? [{ session }] : [], meta: { changes: 0 } };
    mutations.push(sql);
    if (sql.startsWith('DELETE')) { session = undefined; return { results: [], meta: { changes: 1 } }; }
    throw new Error('Unexpected INSERT');
  };
  const observe = async () => { observations++; return {}; };
  try {
    const receipt = { status: 'prepared', leaseOwner: owner };
    const lease = await acquireDeploymentLease(query, { head: 'a'.repeat(40), owner, mustExist: true });
    await expect(reconcileDeployment({ receipt, assertHeld: lease.assertHeld, observe,
      persist: (value: typeof receipt) => persistDeployment(path, value, writeFileSync, () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); }),
    })).rejects.toThrow('정본은 교체');
    expect(receipt.status).toBe('aborted-before-deploy'); expect(canReleaseDeploymentLease(receipt)).toBe(false);
    expect(mutations).toEqual([]); expect(session).toBe(owner);
    const recovered = JSON.parse(readFileSync(path, 'utf8'));
    expect(RECONCILABLE_STATUSES).toContain(recovered.status);
    const resumed = await acquireDeploymentLease(query, { head: 'a'.repeat(40), owner: recovered.leaseOwner, mustExist: true });
    await reconcileDeployment({ receipt: recovered, assertHeld: resumed.assertHeld, observe, persist: (value: typeof receipt) => persistDeployment(path, value) });
    expect(canReleaseDeploymentLease(recovered)).toBe(true);
    await resumed.release(); expect(session).toBeUndefined();
    expect(mutations.length).toBe(1); expect(mutations[0].startsWith('DELETE')).toBe(true); expect(observations).toBe(0);
  } finally { unlinkSync(path); rmdirSync(directory); }
});

test('호출 직전 영수증 저장이 실패하면 원격 호출도 상태 승격도 없다', async () => {
  let called = false; const receipt = { status: 'prepared' };
  await expect(deployAndReconcile({ receipt, persist: () => { throw new Error('disk full'); }, deploy: () => { called = true; }, observe: async () => ({}), assertHeld: async () => {}, wait: async () => {} })).rejects.toThrow('disk full');
  expect(called).toBe(false); expect(receipt.status).toBe('prepared');
});

test('같은 원격 키의 동시 배포 중 하나만 실행부에 들어가며 다른 소유자는 해제할 수 없다', async () => {
  const db = new Database(':memory:');
  db.run('CREATE TABLE rsi_claim (repo TEXT, axis TEXT, session TEXT, base_sha TEXT, started_at TEXT, note TEXT, PRIMARY KEY(repo, axis))');
  const query = async (sql: string, params: (string | number | null)[] = []) => {
    if (sql.startsWith('SELECT')) return { results: db.query(sql).all(...params), meta: { changes: 0 } };
    return { results: [], meta: { changes: db.query(sql).run(...params).changes } };
  };
  try {
    const leases = await Promise.allSettled([acquireDeploymentLease(query, { head: 'a'.repeat(40), owner: crypto.randomUUID() }), acquireDeploymentLease(query, { head: 'a'.repeat(40), owner: crypto.randomUUID() })]);
    expect(leases.filter((result) => result.status === 'fulfilled').length).toBe(1);
    expect(leases.filter((result) => result.status === 'rejected').length).toBe(1);
    const lease = leases.find((result) => result.status === 'fulfilled')! as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireDeploymentLease>>>;
    const wrongDelete = await query('DELETE FROM rsi_claim WHERE session = ?', ['intruder']);
    expect(wrongDelete.meta.changes).toBe(0);
    await lease.value.assertHeld(); await lease.value.release();
    expect(db.query('SELECT * FROM rsi_claim').all().length).toBe(0);
  } finally { db.close(); }
});

function fixture() {
  const head = 'a'.repeat(40);
  const receipt = { head, status: 'prepared', tag: 'qa-tag', rollbackDeploymentId: 'old', rollbackVersionId: 'old-version' };
  const old = { id: 'old', created_on: '2026-09-05T00:00:00Z', versions: [{ version_id: 'old-version', percentage: 100 }] };
  const current = { id: 'new', created_on: '2026-09-05T01:00:00Z', versions: [{ version_id: 'new-version', percentage: 100 }] };
  const states: string[] = [];
  return { head, receipt, old, current, states, persist: (value: typeof receipt) => { states.push(value.status); }, assertHeld: async () => {}, wait: async () => {} };
}

test('재조정은 없는 잠금을 생성하지 않으며 다른 소유자의 잠금도 보존한다', async () => {
  for (const session of [undefined, 'other-owner']) {
    const mutations: string[] = [];
    const query = async (sql: string) => {
      if (sql.startsWith('SELECT')) return { results: session ? [{ session }] : [], meta: { changes: 0 } };
      mutations.push(sql); return { results: [], meta: { changes: 1 } };
    };
    await expect(acquireDeploymentLease(query, { head: 'a'.repeat(40), owner: crypto.randomUUID(), mustExist: true })).rejects.toThrow('소유권');
    expect(mutations).toEqual([]);
  }
});

test('준비 중 종료돼 남은 자기 잠금은 원격 호출 없이 안전하게 종료한다', async () => {
  const f = fixture(); let observed = false;
  const result = await reconcileDeployment({ ...f, observe: async () => { observed = true; return {}; } });
  expect(result.status).toBe('aborted-before-deploy');
  expect(canReleaseDeploymentLease(result)).toBe(true); expect(observed).toBe(false);
});

test('검증 영수증의 동일 소유자 잠금만 재개하여 재검증 후 삭제한다', async () => {
  const owner = crypto.randomUUID(); let session: string | undefined = owner; const operations: string[] = [];
  const query = async (sql: string) => {
    operations.push(sql);
    if (sql.startsWith('SELECT')) return { results: session ? [{ session }] : [], meta: { changes: 0 } };
    if (sql.startsWith('DELETE')) { session = undefined; return { results: [], meta: { changes: 1 } }; }
    throw new Error('Unexpected INSERT');
  };
  const lease = await acquireDeploymentLease(query, { head: 'a'.repeat(40), owner, mustExist: true });
  const f = fixture(); f.receipt.status = 'version-verified';
  const receipt = await reconcileDeployment({ ...f, assertHeld: lease.assertHeld,
    observe: async () => ({ live: { sha: f.head, dirty: false }, tag: f.receipt.tag, deployments: [f.old, f.current] }) });
  expect(receipt.status).toBe('version-verified');
  if (canReleaseDeploymentLease(receipt)) await lease.release();
  expect(session).toBeUndefined(); expect(operations.some((sql) => sql.startsWith('INSERT'))).toBe(false);
});
test('원격 반영 뒤 CLI가 throw해도 actual head·태그·deployment를 재조정한다', async () => {
  const f = fixture(); let deployed = false;
  const result = await deployAndReconcile({ ...f, deploy: async () => { deployed = true; throw new Error('connection lost'); },
    observe: async () => ({ live: { sha: deployed ? f.head : 'b'.repeat(40), dirty: false }, tag: f.receipt.tag, deployments: [f.old, f.current] }) });
  expect(f.states[0]).toBe('deploying-unknown');
  expect(result.status).toBe('version-verified'); expect(result.commandFailed).toBe(true);
});
test('검증 저장 직후 종료돼 잠금이 남아도 같은 영수증으로 재조정할 수 있다', async () => {
  const f = fixture(); f.receipt.status = 'version-verified';
  const result = await reconcileDeployment({ ...f, observe: async () => ({ live: { sha: f.head, dirty: false }, tag: f.receipt.tag, deployments: [f.old, f.current] }) });
  expect(result.status).toBe('version-verified'); expect(canReleaseDeploymentLease(result)).toBe(true);
});
test('원격 상태 불명 또는 잠금 밖의 다른 배포가 끼면 성공을 기록하지 않는다', async () => {
  for (const conflict of [false, true]) {
    const f = fixture();
    await expect(deployAndReconcile({ ...f, deploy: async () => { throw new Error('uncertain'); }, observe: async () => ({
      live: { sha: conflict ? f.head : 'b'.repeat(40), dirty: false }, tag: f.receipt.tag,
      deployments: conflict ? [f.old, { ...f.current, id: 'intervening', created_on: '2026-09-05T00:30:00Z' }, f.current] : [f.old],
    }) })).rejects.toThrow('원격 반영 상태');
    expect(f.states.at(-1)).toBe('outcome-unknown'); expect(f.states).not.toContain('version-verified');
  }
});
