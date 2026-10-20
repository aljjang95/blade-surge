// 화면 모델: SDK 상태·서버 응답을 그리기 좋은 형태로 바꾸는 순수 함수(DOM 없음, 테스트 대상)
import { clip, contentName, fullName, presenceText } from './format.js';

const PARTY_CODE = /^[A-F0-9]{20}$/;

/** 알림 대상이 되는 메시지 종류별 행 모델. 차단한 사람의 메시지는 걸러 낸다. */
export function rowsFor(messages, { meId = null, blocks = null, config = null, now = Date.now(), nameOf = null } = {}) {
  const rows = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m.id !== 'string' || typeof m.text !== 'string') continue;
    if (m.from && blocks && blocks.has(m.from.id)) continue;
    const own = !!(meId && m.from && m.from.id === meId);
    if (m.kind === 'fame') {
      rows.push({ type: 'fame', id: m.id, at: m.at, from: m.from ?? null, ...fameLine(m, config) });
    } else if (m.kind === 'listing') {
      const model = listingModel({ ...(m.data && typeof m.data === 'object' ? m.data : {}), host: m.from }, { meId, config, now });
      if (model) rows.push({ type: 'listing', id: m.id, at: m.at, from: m.from ?? null, listing: model });
    } else if (m.kind === 'invite') {
      const code = m.data && typeof m.data.partyCode === 'string' && PARTY_CODE.test(m.data.partyCode) ? m.data.partyCode : null;
      rows.push({ type: 'invite', id: m.id, at: m.at, from: m.from ?? null, own, text: m.text, partyCode: code });
    } else if (m.kind === 'whisper') {
      const peerId = own ? m.to : m.from && m.from.id;
      const peer = own ? (typeof nameOf === 'function' ? nameOf(m.to) : null) : m.from;
      rows.push({ type: 'whisper', id: m.id, at: m.at, from: m.from ?? null, own, peerId: peerId ?? null, peer: peer ?? null, text: m.text });
    } else if (m.kind === 'system') {
      rows.push({ type: 'system', id: m.id, at: m.at, text: m.text });
    } else {
      rows.push({ type: 'chat', id: m.id, at: m.at, from: m.from ?? null, own, text: m.text, title: m.from && m.from.title ? m.from.title.label : '', titleId: m.from && m.from.title ? m.from.title.id : '' });
    }
  }
  return rows;
}

/** 서버 최초 공지 줄. 1등이면 시안 문구("서버 최초! {이름}님이 {던전}을 정복했습니다.")로 만든다. */
export function fameLine(msg, config) {
  const data = msg && msg.data && typeof msg.data === 'object' ? msg.data : {};
  const first = data.rank === 1 && typeof data.contentId === 'string';
  if (first && msg.from) {
    const dungeon = contentName(config, data.contentId);
    return { first: true, name: fullName(msg.from), text: '서버 최초! ', tail: josaEul(dungeon) + ' 정복했습니다.', dungeon, rank: 1 };
  }
  return { first: false, name: '', text: String(msg.text || ''), tail: '', dungeon: '', rank: Number.isFinite(data.rank) ? data.rank : 0 };
}

/** 받침 여부에 따라 을/를을 붙인다. */
export function josaEul(word) {
  const s = String(word || '');
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return s + ((code - 0xac00) % 28 ? '을' : '를');
  return s + '을(를)';
}
export function josaI(word) {
  const s = String(word || '');
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return s + ((code - 0xac00) % 28 ? '이' : '가');
  return s;
}

/** 파티 모집 카드 모델. 데이터가 올바르지 않으면 null. */
export function listingModel(raw, { meId = null, config = null, now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const partyCode = typeof raw.partyCode === 'string' && PARTY_CODE.test(raw.partyCode) ? raw.partyCode : null;
  const slots = Number.isInteger(raw.slots) ? raw.slots : 4, members = Number.isInteger(raw.members) ? raw.members : 1;
  if (!partyCode) return null;
  const host = raw.host && typeof raw.host === 'object' ? raw.host : null;
  const name = contentName(config, raw.contentId);
  const expired = Number.isFinite(raw.expiresAt) && raw.expiresAt <= now;
  const own = !!(meId && host && host.id === meId);
  const full = members >= slots;
  return {
    id: raw.id ?? null, partyCode, host, own, expired, full,
    contentId: raw.contentId ?? null, contentName: name,
    members, slots,
    title: '[모집] ' + name + ' ' + members + '/' + slots,
    note: typeof raw.note === 'string' ? raw.note : '',
    joinable: !own && !expired && !full,
    stateText: own ? '내 모집' : expired ? '마감' : full ? '가득 참' : '참가',
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0,
  };
}

/**
 * 전투 중 띠에 보여 줄 한 줄. 파티 채팅·서버 공지·귓속말·초대만 보인다.
 * 광장(world-*) 잡담은 설계 노드 battle-chat-ticker가 '파티 채팅·서버 공지'만 띠에 올리도록 정했고,
 * 전투 중에 많은 사람의 광장 대화가 계속 흘러 플레이를 방해하지 않게 하려는 의도라 일부러 제외한다. 바꾸려면 설계 노드부터 고친다.
 */
export function tickerText(msg, { meId = null, blocks = null } = {}) {
  if (!msg || typeof msg.text !== 'string') return null;
  if (msg.from && blocks && blocks.has(msg.from.id)) return null;
  if (msg.from && meId && msg.from.id === meId) return null;
  const who = msg.from ? msg.from.name : '';
  if (msg.kind === 'chat' && typeof msg.channel === 'string' && msg.channel.startsWith('party:')) return clip(who + ': ' + msg.text, 60);
  if (msg.kind === 'fame') return clip('👑 ' + msg.text, 70);
  if (msg.kind === 'whisper') return clip('귓속말 ' + who + ': ' + msg.text, 60);
  if (msg.kind === 'invite') return clip(msg.text, 60);
  return null;
}

/** 친구 목록: 온라인 먼저, 같은 상태끼리 이름순. */
export function sortFriends(friends) {
  const list = [];
  const source = friends instanceof Map ? [...friends.entries()] : Array.isArray(friends) ? friends.map(f => [f.mini && f.mini.id, f]) : [];
  for (const [id, entry] of source) {
    if (!entry) continue;
    const mini = entry.mini ?? null;
    list.push({ id: id ?? (mini && mini.id) ?? '', mini, online: entry.online === true, presence: entry.presence ?? null });
  }
  list.sort((a, b) => (a.online === b.online ? fullName(a.mini).localeCompare(fullName(b.mini), 'ko') : a.online ? -1 : 1));
  return list;
}
export function friendWhere(entry) {
  if (!entry.online) return '오프라인';
  return presenceText(entry.presence) || '접속 중';
}

/** 명예의 전당 화면 모델. fame은 GET /fame 응답, selectedId는 고른 콘텐츠. */
export function fameModel(fame, selectedId, { meId = null, config = null, myClears = null } = {}) {
  const contents = Array.isArray(fame && fame.contents) ? fame.contents : [];
  const total = Number.isFinite(fame && fame.total) ? fame.total : contents.length;
  const cards = contents.map(c => ({ id: c.id, name: c.name, firstBy: Array.isArray(c.first) && c.first[0] ? c.first[0].player : null, cleared: Array.isArray(c.first) && c.first.length > 0 }));
  const picked = contents.find(c => c.id === selectedId) ?? contents.find(c => Array.isArray(c.first) && c.first.length) ?? contents[0] ?? null;
  const first = picked && Array.isArray(picked.first) ? picked.first : [];
  const fastest = picked && Array.isArray(picked.fastest) ? picked.fastest : [];
  const slot = rank => first.find(e => e.rank === rank) ?? first[rank - 1] ?? null;
  const conquest = (Array.isArray(fame && fame.conquest) ? fame.conquest : []).map((e, i) => ({ rank: i + 1, mini: e.player, cleared: e.cleared, lastAt: e.lastAt }));
  const mine = meId ? conquest.find(e => e.mini && e.mini.id === meId) : null;
  return {
    total, cards,
    selected: picked ? { id: picked.id, name: picked.name || contentName(config, picked.id), empty: first.length === 0 } : null,
    podium: [2, 1, 3].map(rank => ({ rank, entry: slot(rank) })),
    runnersUp: first.slice(3, 10),
    fastest: fastest.slice(0, 3),
    conquest,
    me: meId ? { rank: mine ? mine.rank : 0, cleared: mine ? mine.cleared : (Number.isFinite(myClears) ? myClears : 0), listed: !!mine } : null,
    players: Number.isFinite(fame && fame.players) ? fame.players : 0,
    foundersLeft: Number.isFinite(fame && fame.foundersLeft) ? fame.foundersLeft : 0,
  };
}

/** 게시판 목록: 가장 최근 공지를 맨 위 고정 글로 올린다. 공감순 정렬일 때는 서버 순서를 그대로 둔다. */
export function boardOrder(items, { sort = 'new', category = '' } = {}) {
  const list = Array.isArray(items) ? items.filter(p => p && typeof p.id === 'number') : [];
  if (sort !== 'new' || (category && category !== 'notice')) return { pinned: null, rest: list };
  const pinned = list.find(p => p.category === 'notice') ?? null;
  return { pinned, rest: pinned ? list.filter(p => p !== pinned) : list };
}
export function excerpt(body, max = 80) {
  return clip(String(body || '').replace(/\s+/g, ' ').trim(), max);
}

export const DIAG_LABELS = Object.freeze({ version: '버전', ua: '기기·브라우저', screen: '화면 크기', scene: '현재 장면', fps: '프레임(대략)', where: '위치', dpr: '화면 배율' });
/** 서버 규칙(문자열·유한한 숫자만, 키 64자, 전체 1KB 이하)에 맞게 진단 정보를 정리한다. */
export function cleanDiag(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const k = String(key).normalize('NFKC').trim().slice(0, 64);
    if (!k) continue;
    if (typeof raw === 'string') out[k] = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').trim().slice(0, 200);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[k] = Math.round(raw * 100) / 100;
  }
  const encoder = new TextEncoder();
  const keys = Object.keys(out);
  while (keys.length && encoder.encode(JSON.stringify(out)).length > 1000) delete out[keys.pop()];
  return keys.length ? out : null;
}
export function diagLines(diag) {
  if (!diag || typeof diag !== 'object') return [];
  return Object.entries(diag).map(([k, v]) => (DIAG_LABELS[k] || k) + ': ' + v);
}

/** 채널별 미확인 개수 합계 */
export function unreadTotal(unread) {
  let total = 0;
  if (unread instanceof Map) for (const n of unread.values()) total += n > 0 ? n : 0;
  return total;
}

/** 이름 메뉴 항목: 내 이름이면 메뉴가 없고, 친구면 '친구 요청' 대신 '친구 삭제'를 보여 준다. */
export function nameMenuItems({ meId, target, friendIds = new Set(), blockedIds = new Set(), canWhisper = true }) {
  if (!target || !meId || target.id === meId) return [];
  const items = [{ id: 'profile', label: '프로필' }];
  if (!friendIds.has(target.id)) items.push({ id: 'friend', label: '친구 요청' });
  items.push({ id: 'whisper', label: '귓속말', disabled: !canWhisper });
  if (friendIds.has(target.id)) items.push({ id: 'unfriend', label: '친구 삭제' });
  items.push(blockedIds.has(target.id) ? { id: 'unblock', label: '차단 해제' } : { id: 'block', label: '차단' });
  items.push({ id: 'report', label: '신고' });
  return items;
}
export const REPORT_REASONS = Object.freeze(['욕설·비하', '도배·광고', '사기·사칭', '기타']);
