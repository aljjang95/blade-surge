import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { GRADE_UP_COST } from '../src/data/hero-grades.js';
import { SkillTreeView, skillDetail, heroSkillPoints } from '../src/ui/skill-tree.js';
import { TranscendView } from '../src/ui/transcend.js';

// 최소 DOM: 화면이 만든 노드 트리를 그대로 들고 있고, 버튼 click 은 disabled 면 무시한다(실제 브라우저와 같다).
class El {
  tagName: string; children: El[] = []; parent: El | null = null; attrs: Record<string, string> = {}; dataset: Record<string, string> = {};
  className = ''; hidden = false; disabled = false; onclick: ((e?: any) => any) | null = null; src = ''; alt = ''; id = ''; private own = '';
  style = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  set textContent(v: string) { this.own = String(v); this.children = []; }
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  append(...nodes: El[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceChildren() { this.children = []; this.own = ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener() {} removeEventListener() {}
  get isConnected() { let n: El = this; while (n.parent) n = n.parent; return n === host; }
  contains(n: El | null) { while (n) { if (n === this) return true; n = n.parent; } return false; }
  focus() { (globalThis as any).document.activeElement = this; }
  click() { return this.disabled ? undefined : this.onclick?.({}); }
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  key(k: string) { return this.all().find((n) => n.dataset.key === k)!; }
  byClass(c: string) { return this.all().filter((n) => n.className.split(' ').includes(c)); }
}
let host: El;
const priorDoc = Object.getOwnPropertyDescriptor(globalThis, 'document'), priorStore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  host = new El('div'); const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: host, activeElement: null, createElement: (t: string) => new El(t), getElementById: (id: string) => (id === 'meta' ? host : null) } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => {
  for (const [k, d] of [['document', priorDoc], ['localStorage', priorStore]] as const) { if (d) Object.defineProperty(globalThis, k, d); else Reflect.deleteProperty(globalThis, k); }
});

/** 진짜 Economy 와 meta 대역. confirm 은 답을 미리 정하고, 물어본 내용을 기록한다. */
function setup(heroId = 'knight', answer = true) {
  const eco: any = new Economy(), toasts: string[] = [], asked: any[] = [], tabs: any[] = [];
  eco.s.selected = heroId;
  const meta: any = { eco, tab: 'heroes', toasts, asked, tabs,
    ui: { toast: (m: string) => toasts.push(m), confirm: async (title: string, body: string, opts: any) => { asked.push({ title, body, ok: opts?.ok }); return answer; } },
    openTab: (tab: string, sub: string) => tabs.push([tab, sub]), renderHeroes() {}, trackFunnel() {}, offerGold() {} };
  return { eco, meta };
}
const spOf = (view: any) => Number(view.root.byClass('st-sp-num')[0].textContent);

test('스킬 트리: SP 원은 실제 남은 SP이고, + 를 누르면 레벨이 오르고 SP가 줄어든다', () => {
  const { eco, meta } = setup(); const h = eco.hero('knight'); h.level = 5;
  const view: any = new SkillTreeView(meta); expect(view.open('knight')).toBe(true);
  const before = eco.skillPoints('knight').available;
  expect(spOf(view)).toBe(before);
  const lv0 = h.skills[0];
  view.root.key('plus-0').click();
  expect(h.skills[0]).toBe(lv0 + 1);
  expect(eco.skillPoints('knight').available).toBe(before - 1);
  expect(spOf(view)).toBe(before - 1);
  expect(view.root.byClass('st-count')[0].textContent).toBe((lv0 + 1) + '/10');
});

test('스킬 트리: 잠긴 각성 스킬은 이유를 읽어 주고 습득 버튼이 꺼져 있다', () => {
  const { eco, meta } = setup(); eco.hero('knight').level = 5;
  const view: any = new SkillTreeView(meta); view.open('knight', 4);
  const cell = view.root.key('cell-4');
  expect(cell.getAttribute('aria-label')).toContain('잠김, 캐릭터 Lv.' + HEROES.knight.skills[4].unlock + ' 필요');
  expect(cell.className).toContain('is-locked');
  expect(view.root.key('learn').disabled).toBe(true);
  expect(view.root.key('learn').textContent).toBe('Lv.' + HEROES.knight.skills[4].unlock + '에 해금');
  view.root.key('learn').click();
  expect(eco.hero('knight').skills[4]).toBe(0);
});

test('스킬 트리: 관문 레벨에 닿은 각성 스킬은 "습득 가능"으로 빛나고 SP 2로 배운 뒤 Q/E에 장착된다', () => {
  const { eco, meta } = setup(); const h = eco.hero('knight'); h.level = 10;
  const view: any = new SkillTreeView(meta); view.open('knight');
  const cell = view.root.key('cell-4');
  expect(cell.className).toContain('is-ready');
  expect(cell.getAttribute('aria-label')).toContain('습득 가능');
  cell.click();
  const learn = view.root.key('learn');
  expect(learn.textContent).toBe('습득 (SP 2)');
  const before = eco.skillPoints('knight').available;
  learn.click();
  expect(h.skills[4]).toBe(1);
  expect(eco.skillPoints('knight').available).toBe(before - 2);
  view.root.key('equip-E').click();
  expect(h.skillLoadout[1]).toBe(4);
  expect(view.root.key('cell-4').textContent).toContain('E');
});

test('스킬 트리: Lv.20 미만 초기화는 무료이고 SP가 모두 돌아온다', async () => {
  const { eco, meta } = setup(); const h = eco.hero('knight'); h.level = 12;
  const view: any = new SkillTreeView(meta); view.open('knight');
  view.root.key('plus-0').click(); view.root.key('plus-1').click();
  const scrolls = eco.s.skillResets;
  expect(eco.skillPoints('knight').spent).toBeGreaterThan(0);
  await view.root.key('reset').click();
  expect(meta.asked.at(-1).ok).toBe('무료 초기화');
  expect(eco.skillPoints('knight').spent).toBe(0);
  expect(spOf(view)).toBe(eco.skillPoints('knight').earned);
  expect(eco.s.skillResets).toBe(scrolls);
});

test('스킬 초기화: Lv.20 이상은 초기화서 1개를 쓰고, 초기화서·보석이 없으면 상점 강화 탭으로 안내한다', async () => {
  const { eco, meta } = setup(); const h = eco.hero('knight'); h.level = 25;
  const view: any = new SkillTreeView(meta); view.open('knight');
  view.root.key('plus-0').click();
  eco.s.skillResets = 1;
  await view.root.key('reset').click();
  expect(eco.s.skillResets).toBe(0);
  expect(eco.skillPoints('knight').spent).toBe(0);
  view.root.key('plus-0').click(); eco.s.gems = 0; view.render();
  expect(view.root.key('reset').textContent).toContain(String(eco.skillResetQuote('knight').gemPrice));
  await view.root.key('reset').click();
  expect(meta.asked.at(-1).ok).toBe('상점 보기');
  expect(meta.tabs.at(-1)).toEqual(['shop', 'enh']);
  expect(eco.skillPoints('knight').spent).toBeGreaterThan(0);
  expect(view.isOpen).toBe(false);
});

test('초월: 재료가 모자라면 부족 표시와 함께 버튼이 꺼지고, 채우면 SR→SSR로 오르고 스킬 피해 표시가 바뀐다', async () => {
  const { eco, meta } = setup('mage'); const h = eco.hero('mage'); h.level = 10;
  const def = HEROES.mage, damageBefore = skillDetail(def, h, 0, heroSkillPoints(eco, 'mage')).damage.now;
  const view: any = new TranscendView(meta); view.open('mage');
  expect(view.root.key('go').disabled).toBe(true);
  expect(view.root.byClass('tc-mat').some((n: El) => n.className.includes('is-short'))).toBe(true);
  const cost = GRADE_UP_COST.SSR; h.shards = cost.shards; eco.s.transcendStones = cost.transcendStones; eco.s.gold = cost.gold; view.render();
  const go = view.root.key('go');
  expect(go.disabled).toBe(false);
  expect(view.root.byClass('tc-gem-wrap').find((n: El) => n.className.includes('is-current'))!.dataset.grade).toBe('SR');
  await go.click();
  expect(h.grade).toBe('SSR');
  expect(eco.s.transcendStones).toBe(0);
  expect(view.root.byClass('tc-gem-wrap').find((n: El) => n.className.includes('is-current'))!.dataset.grade).toBe('SSR');
  expect(skillDetail(def, h, 0, heroSkillPoints(eco, 'mage')).damage.now).not.toBe(damageBefore);
  // 다음 단계 SSSR 은 재료가 없으니 꺼진 채로 남는다.
  expect(view.root.key('go').disabled).toBe(true);
});

test('초월: 최고 등급이면 "최고 등급"으로 잠기고 초월 패키지는 상점 패키지 탭으로 간다', () => {
  const { eco, meta } = setup('knight'); eco.hero('knight').grade = 'SSSR';
  const view: any = new TranscendView(meta); view.open('knight');
  const go = view.root.key('go');
  expect(go.textContent).toBe('최고 등급'); expect(go.disabled).toBe(true);
  view.root.key('pack').click();
  expect(meta.tabs.at(-1)).toEqual(['shop', 'pack']);
  expect(view.isOpen).toBe(false);
});
