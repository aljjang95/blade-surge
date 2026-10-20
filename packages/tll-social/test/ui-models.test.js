import { describe, expect, test } from 'bun:test';
import { boardOrder, cleanDiag, diagLines, fameLine, fameModel, josaEul, listingModel, nameMenuItems, rowsFor, sortFriends, tickerText, unreadTotal } from '../src/ui/models.js';

const CONFIG = { contents: [{ id: 'emberwake_drydock', name: '불씨항 건선거' }, { id: 'aurora_icewell', name: '오로라 빙정호' }] };
const mini = (id, name, tag = '0001', title = null) => ({ id, name, tag, no: 1, title, linked: false });
const ME = 'p_' + 'a'.repeat(24), OTHER = 'p_' + 'b'.repeat(24);
const CODE = 'ABCDEF0123456789ABCD';

describe('메시지 행 모델', () => {
  test('일반 채팅은 칭호·내 메시지 여부를 담는다', () => {
    const rows = rowsFor([
      { id: '1', channel: 'world-1', kind: 'chat', from: mini(OTHER, '검은달', '4821', { id: 'first:x', label: '최초 정복자' }), text: '안녕', at: 1 },
      { id: '2', channel: 'world-1', kind: 'chat', from: mini(ME, '나', '0001'), text: '반가워요', at: 2 },
    ], { meId: ME });
    expect(rows[0]).toMatchObject({ type: 'chat', own: false, title: '최초 정복자', text: '안녕' });
    expect(rows[1]).toMatchObject({ type: 'chat', own: true });
  });
  test('차단한 사람의 메시지는 행으로 만들지 않는다', () => {
    const rows = rowsFor([{ id: '1', channel: 'world-1', kind: 'chat', from: mini(OTHER, '막힌사람'), text: 'hi', at: 1 }], { meId: ME, blocks: new Set([OTHER]) });
    expect(rows).toEqual([]);
  });
  test('잘못된 항목은 건너뛴다', () => {
    expect(rowsFor([null, { id: 3 }, { id: 'x' }, 'text'])).toEqual([]);
    expect(rowsFor(undefined)).toEqual([]);
  });
  test('서버 최초 공지는 시안 문구로 만든다', () => {
    const line = fameLine({ kind: 'fame', from: mini(OTHER, '검은달', '4821'), text: '원문', data: { contentId: 'emberwake_drydock', rank: 1 } }, CONFIG);
    expect(line.first).toBe(true);
    expect(line.text + line.name + '님이 ' + line.tail).toBe('서버 최초! 검은달#4821님이 불씨항 건선거를 정복했습니다.');
  });
  test('1등이 아닌 공지는 서버 문구를 그대로 쓴다', () => {
    const line = fameLine({ kind: 'fame', from: mini(OTHER, 'a'), text: '3번째로 정복했습니다', data: { contentId: 'emberwake_drydock', rank: 3 } }, CONFIG);
    expect(line.first).toBe(false);
    expect(line.text).toBe('3번째로 정복했습니다');
  });
  test('모집 메시지는 카드 모델로 바뀐다', () => {
    const rows = rowsFor([{ id: 'l', channel: null, kind: 'listing', from: mini(OTHER, '하늘'), text: '모집', at: 5, data: { id: 'x', partyCode: CODE, contentId: 'aurora_icewell', note: '딜러 구함', slots: 4, members: 2, expiresAt: 999999 } }], { meId: ME, config: CONFIG, now: 1000 });
    expect(rows[0].type).toBe('listing');
    expect(rows[0].listing).toMatchObject({ title: '[모집] 오로라 빙정호 2/4', joinable: true, own: false, note: '딜러 구함' });
  });
  test('초대는 파티 코드가 올바를 때만 코드를 담는다', () => {
    const rows = rowsFor([
      { id: 'i1', channel: null, kind: 'invite', from: mini(OTHER, '하늘'), text: '초대', at: 1, data: { partyCode: CODE } },
      { id: 'i2', channel: null, kind: 'invite', from: mini(OTHER, '하늘'), text: '초대', at: 1, data: { partyCode: 'zzz' } },
    ]);
    expect(rows[0].partyCode).toBe(CODE);
    expect(rows[1].partyCode).toBe(null);
  });
  test('보낸 귓속말은 상대 이름 조회 함수로 상대를 채운다', () => {
    const rows = rowsFor([{ id: 'w', channel: null, kind: 'whisper', from: mini(ME, '나'), to: OTHER, text: '비밀', at: 1 }], { meId: ME, nameOf: id => (id === OTHER ? mini(OTHER, '하늘') : null) });
    expect(rows[0]).toMatchObject({ type: 'whisper', own: true, peerId: OTHER });
    expect(rows[0].peer.name).toBe('하늘');
  });
});

describe('모집 카드', () => {
  test('내 모집·마감·가득 참은 참가할 수 없다', () => {
    const base = { partyCode: CODE, slots: 4, members: 2, contentId: null, expiresAt: 5000 };
    expect(listingModel({ ...base, host: mini(ME, 'me') }, { meId: ME, now: 1000 }).joinable).toBe(false);
    expect(listingModel({ ...base, host: mini(OTHER, 'a') }, { meId: ME, now: 6000 }).stateText).toBe('마감');
    expect(listingModel({ ...base, members: 4, host: mini(OTHER, 'a') }, { meId: ME, now: 1000 }).stateText).toBe('가득 참');
    expect(listingModel({ ...base, host: mini(OTHER, 'a') }, { meId: ME, now: 1000 }).joinable).toBe(true);
  });
  test('콘텐츠가 없으면 자유 사냥, 잘못된 파티 코드는 버린다', () => {
    expect(listingModel({ partyCode: CODE, slots: 4, members: 1 }, {}).contentName).toBe('자유 사냥');
    expect(listingModel({ partyCode: 'bad', slots: 4, members: 1 }, {})).toBe(null);
    expect(listingModel(null, {})).toBe(null);
  });
});

describe('전투 중 띠에 보일 메시지', () => {
  const opts = { meId: ME, blocks: new Set([OTHER + 'x']) };
  test('파티 채팅·서버 공지·귓속말·초대만 보인다', () => {
    expect(tickerText({ kind: 'chat', channel: 'party:' + CODE, from: mini(OTHER, '하늘'), text: '왼쪽!' }, opts)).toBe('하늘: 왼쪽!');
    expect(tickerText({ kind: 'fame', text: '서버 최초' }, opts)).toContain('서버 최초');
    expect(tickerText({ kind: 'whisper', from: mini(OTHER, '하늘'), text: '안녕' }, opts)).toContain('귓속말');
    expect(tickerText({ kind: 'invite', from: mini(OTHER, '하늘'), text: '초대' }, opts)).toBe('초대');
  });
  test('광장 잡담·모집·내 메시지는 보이지 않는다', () => {
    expect(tickerText({ kind: 'chat', channel: 'world-1', from: mini(OTHER, '하늘'), text: 'x' }, opts)).toBe(null);
    expect(tickerText({ kind: 'listing', text: 'x' }, opts)).toBe(null);
    expect(tickerText({ kind: 'chat', channel: 'party:' + CODE, from: mini(ME, '나'), text: 'x' }, opts)).toBe(null);
  });
  test('차단한 사람의 말은 숨긴다', () => {
    expect(tickerText({ kind: 'chat', channel: 'party:' + CODE, from: mini(OTHER, '하늘'), text: 'x' }, { meId: ME, blocks: new Set([OTHER]) })).toBe(null);
  });
  test('긴 문장은 잘린다', () => {
    expect([...tickerText({ kind: 'fame', text: '가'.repeat(200) }, opts)].length).toBeLessThanOrEqual(70);
  });
});

describe('친구 목록·메뉴', () => {
  test('온라인이 먼저, 같은 상태는 이름순', () => {
    const map = new Map([
      ['a', { mini: mini('a', '다람', '1'), online: false, presence: null }],
      ['b', { mini: mini('b', '가을', '2'), online: true, presence: null }],
      ['c', { mini: mini('c', '나무', '3'), online: true, presence: null }],
    ]);
    expect(sortFriends(map).map(f => f.id)).toEqual(['b', 'c', 'a']);
  });
  test('이름 메뉴: 내 이름은 메뉴 없음, 친구는 친구 요청 대신 숨김', () => {
    expect(nameMenuItems({ meId: ME, target: mini(ME, 'me') })).toEqual([]);
    const stranger = nameMenuItems({ meId: ME, target: mini(OTHER, 'a') }).map(i => i.id);
    expect(stranger).toEqual(['profile', 'friend', 'whisper', 'block', 'report']);
    const friend = nameMenuItems({ meId: ME, target: mini(OTHER, 'a'), friendIds: new Set([OTHER]) }).map(i => i.id);
    expect(friend).toEqual(['profile', 'whisper', 'unfriend', 'block', 'report']);
    const blocked = nameMenuItems({ meId: ME, target: mini(OTHER, 'a'), blockedIds: new Set([OTHER]) }).map(i => i.id);
    expect(blocked).toContain('unblock');
  });
  test('미확인 합계', () => {
    expect(unreadTotal(new Map([['world-1', 3], ['dm', 2], ['x', 0]]))).toBe(5);
    expect(unreadTotal(null)).toBe(0);
  });
});

describe('명예의 전당', () => {
  const entry = (rank, id, name, bestMs) => ({ rank, at: 1723000000000 + rank, bestMs, player: mini(id, name, '000' + rank) });
  const FAME = {
    total: 12, players: 100, foundersLeft: 900,
    contents: [
      { id: 'emberwake_drydock', name: '불씨항 건선거', first: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(r => entry(r, 'p_' + String(r).repeat(24).slice(0, 24), '이름' + r, 400000 + r * 1000)), fastest: [entry(1, 'p_' + '1'.repeat(24), '이름1', 400000)] },
      { id: 'aurora_icewell', name: '오로라 빙정호', first: [], fastest: [] },
    ],
    conquest: [{ player: mini('p_' + '1'.repeat(24), '이름1'), cleared: 12, lastAt: 1 }, { player: mini(ME, '나'), cleared: 5, lastAt: 2 }],
  };
  test('시상대는 2·1·3 순서, 4~10위는 따로', () => {
    const m = fameModel(FAME, 'emberwake_drydock', { meId: ME });
    expect(m.podium.map(p => p.rank)).toEqual([2, 1, 3]);
    expect(m.podium[1].entry.player.name).toBe('이름1');
    expect(m.runnersUp.map(e => e.rank)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });
  test('아무도 못 깬 던전은 빈 시상대', () => {
    const m = fameModel(FAME, 'aurora_icewell', { meId: ME });
    expect(m.selected.empty).toBe(true);
    expect(m.podium.every(p => p.entry === null)).toBe(true);
    expect(m.cards.map(c => c.cleared)).toEqual([true, false]);
  });
  test('내 순위는 정복 순위 목록 안에서 찾고, 없으면 내 클리어 수로 대신한다', () => {
    expect(fameModel(FAME, null, { meId: ME }).me).toEqual({ rank: 2, cleared: 5, listed: true });
    const out = fameModel({ ...FAME, conquest: [] }, null, { meId: ME, myClears: 3 });
    expect(out.me).toEqual({ rank: 0, cleared: 3, listed: false });
  });
  test('고른 던전이 없으면 처음 정복된 던전을 보여 준다', () => {
    expect(fameModel(FAME, 'nope', {}).selected.id).toBe('emberwake_drydock');
    expect(fameModel(null, null, {}).selected).toBe(null);
  });
});

describe('게시판', () => {
  const posts = [
    { id: 5, category: 'bug' }, { id: 4, category: 'notice' }, { id: 3, category: 'idea' }, { id: 2, category: 'notice' },
  ];
  test('최신순에서는 가장 최근 공지를 고정한다', () => {
    const { pinned, rest } = boardOrder(posts, { sort: 'new', category: '' });
    expect(pinned.id).toBe(4);
    expect(rest.map(p => p.id)).toEqual([5, 3, 2]);
  });
  test('공감순·다른 분류에서는 고정하지 않는다', () => {
    expect(boardOrder(posts, { sort: 'top' }).pinned).toBe(null);
    expect(boardOrder(posts, { sort: 'new', category: 'bug' }).pinned).toBe(null);
  });
  test('진단 정보 정리: 문자열·숫자만, 1KB 이하', () => {
    const diag = cleanDiag({ version: 'abc123', fps: 59.987, ua: 'x'.repeat(500), bad: { a: 1 }, nan: NaN, '': 'x' });
    expect(diag.version).toBe('abc123');
    expect(diag.fps).toBe(59.99);
    expect(diag.ua.length).toBeLessThanOrEqual(200);
    expect(diag.bad).toBeUndefined();
    expect(diag.nan).toBeUndefined();
    expect(new TextEncoder().encode(JSON.stringify(diag)).length).toBeLessThanOrEqual(1000);
    expect(cleanDiag(null)).toBe(null);
    expect(cleanDiag([1])).toBe(null);
  });
  test('진단 줄은 한국어 라벨', () => {
    expect(diagLines({ version: 'v1', fps: 60 })).toEqual(['버전: v1', '프레임(대략): 60']);
  });
});

describe('조사', () => {
  test('을/를', () => {
    expect(josaEul('불씨항 건선거')).toBe('불씨항 건선거를');
    expect(josaEul('유리 정원')).toBe('유리 정원을');
  });
});
