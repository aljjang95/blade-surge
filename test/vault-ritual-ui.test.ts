// 계승 의식·도감 UI 모델(docs/GEAR_VAULT_INHERIT.md 덩어리 3). 화면 없는 순수 모델 + 모달 HTML 문자열로 확인한다.
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ritualModel, dexModel, vaultModel, openVault, inBattle, rewardText, RITUAL_FAIL_TEXT, RITE_PHASES } from '../src/ui/vault-panel.js';
import { GEAR_DEX_MILESTONES } from '../src/game/gear-dex.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);
const newEco = () => { const e: any = grandfather(new Economy({ now: () => T, storage: memory(), rng: () => .5 })); e.s.gold = 10_000_000; e.s.lineageSigil = 5; e.s.roster.owned = [...new Set([...e.s.roster.owned, 'knight', 'mage', 'rogue'])]; return e; };
const stash = (eco: any, rarity: string, hero: string, enh = 0) => { const it = eco.addItem(rarity, 'weapon', undefined, 0, hero); it.enh = enh; expect(eco.vaultDeposit(it.uid).ok).toBe(true); return it; };
const ms = (d: any, id: string) => d.milestones.find((m: any) => m.id === id);
/** openVault 가 만든 모달 HTML 만 잡는 가짜 화면(DOM 없이 문자열 계약을 본다). */
const harness = (eco: any, battle = false) => {
  const shown: string[] = [];
  const ui: any = { modal: (html: string) => { shown.push(html); }, closeModal() {}, toast() {}, confirm: async () => true };
  const meta: any = { eco, ui, app: { battle: { active: battle }, stageStarting: false } };
  return { meta, shown, last: () => shown[shown.length - 1] };
};

describe('ritualModel', () => {
  test('견적은 Economy 그대로: 골드·문장·남은 횟수, 강화 +15는 문장 2개', () => {
    const eco = newEco(), a = stash(eco, 'L', 'knight', 3), b = stash(eco, 'L', 'knight', 15);
    const qa = ritualModel(eco, a.uid, 'mage'), qb = ritualModel(eco, b.uid, 'mage');
    expect(qa).toMatchObject({ ok: true, reason: null, text: '', sigil: 1, haveSigil: 5, left: 2, max: 2 });
    expect(qb.sigil).toBe(2);
    expect(qa.gold).toBe(eco.vaultRitualQuote(a.uid, 'mage').gold);
  });

  test('거부 사유 한국어 문구: bound·same·daily·gold·sigil·hero·item·battle', () => {
    const eco = newEco(), it = stash(eco, 'L', 'knight', 0);
    expect(ritualModel(eco, it.uid, 'knight')).toMatchObject({ ok: false, reason: 'same', text: RITUAL_FAIL_TEXT.same });
    eco.s.lineageSigil = 0; expect(ritualModel(eco, it.uid, 'mage')).toMatchObject({ ok: false, reason: 'sigil', text: RITUAL_FAIL_TEXT.sigil });
    eco.s.lineageSigil = 5; eco.s.gold = 0; expect(ritualModel(eco, it.uid, 'mage')).toMatchObject({ reason: 'gold', text: RITUAL_FAIL_TEXT.gold });
    eco.s.gold = 10_000_000; expect(ritualModel(eco, 999999, 'mage')).toMatchObject({ reason: 'item', text: RITUAL_FAIL_TEXT.item });
    expect(ritualModel(eco, it.uid, 'nobody')).toMatchObject({ reason: 'hero', text: RITUAL_FAIL_TEXT.hero });   // 모르는·미소유 영웅
    expect(ritualModel(eco, it.uid, 'mage', { battle: true })).toMatchObject({ ok: false, reason: 'battle', text: RITUAL_FAIL_TEXT.battle });
    for (const k of ['bound', 'same', 'daily', 'gold', 'sigil', 'hero', 'item', 'battle']) expect(RITUAL_FAIL_TEXT[k as keyof typeof RITUAL_FAIL_TEXT]).toMatch(/[가-힣]/);
  });

  test('하루 2회를 쓰면 daily 문구, 남은 횟수 0', () => {
    const eco = newEco(), items = [stash(eco, 'L', 'knight'), stash(eco, 'L', 'knight'), stash(eco, 'L', 'knight')];
    expect(eco.vaultRitual(items[0].uid, 'mage').ok).toBe(true); expect(eco.vaultRitual(items[1].uid, 'mage').ok).toBe(true);
    expect(ritualModel(eco, items[2].uid, 'mage')).toMatchObject({ ok: false, reason: 'daily', left: 0, text: RITUAL_FAIL_TEXT.daily });
  });
});

describe('금고 시트 HTML', () => {
  test('일반 꺼내기가 bound 면 안내 문구와 의식 버튼, 꺼내기는 비활성', () => {
    const eco = newEco(), it = stash(eco, 'L', 'knight', 4), h = harness(eco);
    expect(vaultModel(eco, 'mage').stored[0].quote.reason).toBe('bound');
    openVault(h.meta, 'mage', { tab: 'vault', selected: it.uid });
    const html = h.last();
    expect(html).toContain('계승 의식으로만 옮길 수 있어요');
    expect(html).toContain('id="v-ritual"'); expect(html).not.toMatch(/id="v-ritual"[^>]*disabled/);
    expect(html).toMatch(/id="v-take" disabled/);
    expect(html).toContain('의식 필요');
  });

  test('전투 중에는 의식 버튼이 비활성이고 시트도 시작 불가', () => {
    const eco = newEco(), it = stash(eco, 'L', 'knight'), h = harness(eco, true);
    expect(inBattle(h.meta)).toBe(true);
    openVault(h.meta, 'mage', { tab: 'vault', selected: it.uid });
    expect(h.last()).toMatch(/id="v-ritual" disabled/);
    openVault(h.meta, 'mage', { tab: 'vault', selected: it.uid, view: 'ritual' });
    expect(h.last()).toMatch(/id="ritual-go" disabled/); expect(h.last()).toContain(RITUAL_FAIL_TEXT.battle);
  });

  test('의식 시트: 견적(골드·문장·남은 횟수)과 시작 버튼', () => {
    const eco = newEco(), it = stash(eco, 'L', 'knight', 15), h = harness(eco);
    openVault(h.meta, 'mage', { tab: 'vault', selected: it.uid, view: 'ritual' });
    const html = h.last(), q = eco.vaultRitualQuote(it.uid, 'mage');
    expect(html).toContain('계승 의식'); expect(html).toContain('2/2'); expect(html).toContain('보유 5');
    expect(html).toContain(q.gold.toLocaleString('en-US')); expect(html).toMatch(/id="ritual-go"(?! disabled)/);
    expect(html).toContain('확률 없이');
  });

  test('연출 시트는 이미 확정된 결과(계승 n·골드·문장)를 담고, 건너뛰기 안내가 있다', () => {
    const eco = newEco(), it = stash(eco, 'L', 'knight', 15), h = harness(eco);
    const r = eco.vaultRitual(it.uid, 'mage'); expect(r.ok).toBe(true);
    const rite = { itemId: it.id, enh: 15, from: 'knight', heroId: 'mage', hops: r.hops, gold: r.gold, sigil: r.sigil };
    openVault(h.meta, 'mage', { view: 'rite', rite: { ...rite, reduce: false } }); const full = h.last();
    openVault(h.meta, 'mage', { view: 'rite', rite: { ...rite, reduce: true } }); const reduced = h.last();
    for (const html of [full, reduced]) { expect(html).toContain('계승 1'); expect(html).toContain('강화·룬 그대로'); expect(html).toContain('id="rite-result"'); expect(html).toContain('id="rite-ok"'); }
    expect(full).toContain('화면을 누르면 건너뜁니다'); expect(reduced).not.toContain('화면을 누르면 건너뜁니다');   // reduced-motion: 안내만 다르고 결과는 같다
    expect(full.replace(/data-reduce="\d"|<p class="vault-hint"[^>]*>[^<]*<\/p>/g, '')).toBe(reduced.replace(/data-reduce="\d"|<p class="vault-hint"[^>]*>[^<]*<\/p>/g, ''));
    expect(RITE_PHASES.map(([p]) => p)).toEqual(['send', 'glow', 'arrive', 'done']); expect(RITE_PHASES[3][1]).toBeLessThanOrEqual(8000); expect(RITE_PHASES[3][1]).toBeGreaterThanOrEqual(5000);
  });
});

describe('dexModel · 도감 화면', () => {
  test('드랍·계승 수, 슬롯별 수, 마일스톤 상태 locked → ready → claimed', () => {
    const eco = newEco();
    const d0 = dexModel(eco, 'mage');
    expect(d0.drop.total).toBe(Object.keys(ITEM_BY_ID).length); expect(d0.milestones.every((m: any) => m.state === 'locked')).toBe(true);
    // 계승 도감 5종 달성: 서로 다른 L 5종을 의식으로 받는다.
    const ls = Object.values(ITEM_BY_ID).filter((d: any) => d.rarity === 'L');
    const keep = eco.s.inventory.length;
    for (const def of ls.slice(0, 3)) { const it = eco.pushItem((def as any).id, { owner: 'knight' }); eco.vaultDeposit(it.uid); }
    const uids = eco.s.inventory.slice(keep).map((x: any) => x.uid);
    expect(eco.vaultRitual(uids[0], 'mage').ok).toBe(true);
    const d1 = dexModel(eco, 'mage'); expect(d1.kin.n).toBe(1); expect(ms(d1, 'kin5').have).toBe(1);
    eco.s.gearDex.kin.mage = Object.keys(ITEM_BY_ID).slice(0, 5);
    expect(ms(dexModel(eco, 'mage'), 'kin5').state).toBe('ready');
    expect(eco.gearDexClaim('mage', 'kin5').ok).toBe(true);
    expect(ms(dexModel(eco, 'mage'), 'kin5').state).toBe('claimed');
    expect(ms(dexModel(eco, 'knight'), 'kin5').state).toBe('locked');   // 영웅별
  });

  test('도감 시트 HTML: 영웅 칩·마일스톤 행·수령 버튼 상태', () => {
    const eco = newEco(), h = harness(eco);
    eco.s.gearDex = { v: 1, drop: {}, kin: { mage: Object.keys(ITEM_BY_ID).slice(0, 5) }, claimed: {} };
    openVault(h.meta, 'mage', { tab: 'dex' });
    const html = h.last();
    expect(html).toContain('장비 도감'); expect(html).toContain('data-dex-hero="knight"'); expect(html).toContain('계승 도감 5종');
    expect(html).toMatch(/data-dex-claim="kin5"(?! disabled)/); expect(html).toMatch(/data-dex-claim="kin15" disabled/);
    expect(GEAR_DEX_MILESTONES.length).toBe(7);
  });

  test('rewardText: 0 과 빈 값은 빼고 한국어 이름', () => {
    expect(rewardText({ lineageSigil: 2, stones2: 5, gold: 0 })).toBe('계승 문장 2 · 상급 강화석 5');
    expect(rewardText({})).toBe('');
  });
});
