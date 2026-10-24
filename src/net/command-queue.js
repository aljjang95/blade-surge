// MMO P1-F: 명령 큐. UI가 부르는 기존 Economy 메서드를 계정 인스턴스에서만 감싸 성공한 결정적 명령을
// 서버 /cmd로 순서대로 보낸다(UI 파일은 바꾸지 않는다). 각 명령에는 클라이언트 상태 해시를 붙여
// 그림자 모드에서는 패리티를 측정하고, 서버 권위 모드에서는 해시가 다르면 서버 문서로 덮어쓴다.
import { OPS, validateOp } from '../shared/v1-ops.js';
import { parityHash } from '../shared/state-hash.js';
import { newCid } from './account-client.js';

/** Economy 메서드 인자 → /cmd args. 메서드 이름이 op 이름과 같다(selectHero는 상태 변화로 감지). */
const TO_ARGS = {
  resetSkills: (id, opts) => [id, !!opts?.useGems],
  enhance: (uid, opts) => [uid, !!opts?.protect, !!opts?.bless],
  equipAvatar: (heroId, id = null) => [heroId, id ?? null],
  setDifficulty: (id, ch = 1, st = 1) => [id, ch, st],
  claimDaily: () => [], claimMonthly: () => [],
  pull: (n, banner = 'hero') => [n, banner], pullSSR: () => [], exchangeMileage: () => [],
};

export class CommandQueue {
  /** @param {any} eco @param {import('./account-client.js').AccountClient} client @param {{ authority: () => string, adopt: (doc: any, rev: number) => void, onResult?: (entry: any, response: any) => void, onError?: (error: unknown) => void }} hooks */
  constructor(eco, client, hooks) {
    this.eco = eco; this.client = client; this.hooks = hooks;
    this.pending = []; this.busy = false; this.depth = 0; this.suspended = 0;
    this.stats = { sent: 0, matched: 0, mismatched: 0, rejected: 0 };
    this.lastSelected = eco.s.selected;
    for (const op of Object.keys(OPS)) if (op !== 'selectHero' && typeof eco[op] === 'function') this.wrap(op);
    eco.onChange(() => this.watchSelection());
  }
  wrap(op) {
    const eco = this.eco, original = eco[op], toArgs = TO_ARGS[op] || ((...args) => args);
    eco[op] = (...args) => {
      const outer = !this.depth && !this.suspended, before = outer ? parityHash(eco.s) : null;
      this.depth++;
      let result;
      try { result = original.apply(eco, args); }
      finally { this.depth--; }
      if (outer) this.lastSelected = eco.s.selected;
      // 다른 명령 안에서 불린 호출과 서버 문서 적용 중의 호출은 보내지 않는다.
      // 반환값이 없는 기존 메서드(equip·unequip)는 상태가 바뀌었을 때만 성공으로 본다.
      const ok = result === undefined ? before !== parityHash(eco.s) : OPS[op].ok(result);
      if (outer && ok) this.push(op, toArgs(...args));
      return result;
    };
  }
  watchSelection() {
    // 감싼 명령 안에서 바뀐 선택(chooseStarter)은 그 명령이 서버에서 같이 바꾼다. 따로 selectHero 를 보내지 않는다.
    if (this.suspended || this.depth > 0 || this.eco.s.selected === this.lastSelected) return;
    this.lastSelected = this.eco.s.selected;
    this.push('selectHero', [this.lastSelected]);
  }
  push(op, args) {
    if (!validateOp(op, args)) return;
    this.pending.push({ cid: newCid(), op, args, clientHash: parityHash(this.eco.s) });
    void this.flush();
  }
  /** 그림자 모드: 로컬 정본 상태를 서버 그림자 문서로 다시 맞춘다(전투 보상 등 명령 밖 변화 뒤). 큐 순서를 지킨다. */
  snapshot() {
    if (this.hooks.authority() !== 'shadow') return;
    this.pending = this.pending.filter((e) => e.op !== '__snapshot');
    this.pending.push({ cid: newCid(), op: '__snapshot', save: JSON.parse(JSON.stringify(this.eco.s)), clientHash: parityHash(this.eco.s) });
    void this.flush();
  }
  /** 서버 문서를 적용하는 동안에는 감싼 메서드·선택 변화가 명령을 만들지 않는다. */
  quiet(fn) { this.suspended++; try { return fn(); } finally { this.suspended--; this.lastSelected = this.eco.s.selected; } }
  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length) {
        const entry = this.pending[0];
        let response = null;
        try {
          response = entry.op === '__snapshot' ? await this.client.shadowSnapshot(entry.cid, entry.save, entry.clientHash)
            : await this.client.cmd({ cid: entry.cid, op: entry.op, args: entry.args, clientHash: entry.clientHash });
          this.stats.sent++;
        }
        catch (error) {
          const status = /** @type {any} */ (error)?.status;
          // 네트워크 오류: 큐를 보존하고 다음 기회에 다시 보낸다.
          if (!status) { this.hooks.onError?.(error); break; }
          this.stats.rejected++;
          this.pending.shift();
          this.hooks.onResult?.(entry, { error: /** @type {any} */ (error).body?.error, status });
          if (this.hooks.authority() === 'server') await this.resync();
          continue;
        }
        this.pending.shift();
        if (response.match === false) this.stats.mismatched++; else if (response.match) this.stats.matched++;
        this.hooks.onResult?.(entry, response);
        // 서버 권위: 해시가 다르면 서버 문서가 정본이다. 대기 명령이 남아 있으면 마지막 응답에서 한 번에 맞춘다.
        if (this.hooks.authority() === 'server' && response.match === false && !this.pending.length && response.doc) this.hooks.adopt(response.doc, response.rev);
      }
    } finally { this.busy = false; }
  }
  async resync() {
    try { const me = await this.client.me(); this.pending.length = 0; this.hooks.adopt(me.doc, me.rev); }
    catch (error) { this.hooks.onError?.(error); }
  }
}
