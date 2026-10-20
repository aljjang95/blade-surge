// 표시용 문자열·검증 보조 함수: DOM에 의존하지 않는 순수 함수(테스트 대상)

export const TABS = Object.freeze([
  { id: 'chat', label: '광장 채팅', short: '채팅', icon: 'chat' },
  { id: 'friends', label: '친구', short: '친구', icon: 'friends' },
  { id: 'party', label: '파티 모집', short: '파티 모집', icon: 'flag' },
  { id: 'fame', label: '명예의 전당', short: '명예의 전당', icon: 'trophy' },
  { id: 'board', label: '소식·제보', short: '소식·제보', icon: 'megaphone' },
]);
/** 넓은 화면 프레임으로 여는 탭. 나머지는 사이드 시트. */
export const WIDE_TABS = Object.freeze(new Set(['friends', 'fame', 'board']));
export const QUICK_PHRASES = Object.freeze(['굿!', '감사합니다!', '화이팅!', '수고하셨어요!', '같이 가요!']);
export const EMOJIS = Object.freeze(['😀', '😂', '😍', '👍', '🔥', '🎉', '😭', '🙏', '⚔️', '🛡️', '💪', '👏']);
export const NICK_MIN = 2;
export const NICK_MAX = 12;

/** 분류 → 라벨·색 톤. 서버 category 값과 같은 키. */
export const CATEGORIES = Object.freeze({
  notice: { label: '공지', chip: '공지·업데이트', tone: 'gold', icon: 'megaphone' },
  bug: { label: '버그 제보', chip: '버그 제보', tone: 'red', icon: 'bug' },
  request: { label: '업데이트 희망', chip: '업데이트 희망', tone: 'green', icon: 'refresh' },
  idea: { label: '아이디어', chip: '아이디어', tone: 'blue', icon: 'bulb' },
  question: { label: '질문', chip: '질문', tone: 'gray', icon: 'help' },
});
export const CATEGORY_ORDER = Object.freeze(['notice', 'bug', 'request', 'idea', 'question']);
/** 서버 status → 상태 칩. wontfix는 답변 완료로 묶는다. */
export const STATUSES = Object.freeze({
  open: { label: '', tone: 'none', icon: '' },
  reviewing: { label: '검토 중', tone: 'yellow', icon: 'clock' },
  planned: { label: '반영 예정', tone: 'purple', icon: 'calendar' },
  done: { label: '반영 완료', tone: 'green', icon: 'check' },
  wontfix: { label: '답변 완료', tone: 'gray', icon: 'reply' },
});

/** @param {number} [offsetMinutes] 기본은 이 기기의 시간대 */
function shifted(at, offsetMinutes) {
  const offset = offsetMinutes === undefined ? -new Date(at).getTimezoneOffset() : offsetMinutes;
  return new Date(at + offset * 60000);
}
const two = n => String(n).padStart(2, '0');

/** 오후 8:14 */
export function clockText(at, offsetMinutes) {
  if (!Number.isFinite(at)) return '';
  const d = shifted(at, offsetMinutes);
  const h = d.getUTCHours();
  return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + two(d.getUTCMinutes());
}
/** 2025.08.10 */
export function dateText(at, offsetMinutes) {
  if (!Number.isFinite(at)) return '';
  const d = shifted(at, offsetMinutes);
  return d.getUTCFullYear() + '.' + two(d.getUTCMonth() + 1) + '.' + two(d.getUTCDate());
}
/** 2024.10.17 18:00 */
export function dateTimeText(at, offsetMinutes) {
  if (!Number.isFinite(at)) return '';
  const d = shifted(at, offsetMinutes);
  return dateText(at, offsetMinutes) + ' ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}
/** 클리어 시간: 07:31, 한 시간이 넘으면 1:02:03 */
export function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
}
/** 광장 1 · 87명 */
export function channelLabel(channelId, channels) {
  const n = /^world-(\d+)$/.exec(String(channelId || ''));
  const name = n ? '광장 ' + n[1] : '광장';
  const hit = Array.isArray(channels) ? channels.find(c => c && c.id === channelId) : null;
  return hit && Number.isFinite(hit.count) ? name + ' · ' + hit.count + '명' : name;
}
export function fullName(mini) {
  if (!mini) return '';
  return mini.tag ? mini.name + '#' + mini.tag : String(mini.name || '');
}
/** 이름#1234 → {name, tag}. 형식이 아니면 null */
export function parseFriendCode(value) {
  if (typeof value !== 'string') return null;
  const hit = value.normalize('NFKC').trim().match(/^(.{2,12})#(\d{4})$/u);
  return hit ? { name: hit[1], tag: hit[2] } : null;
}
export function clip(value, max) {
  const chars = [...String(value ?? '')];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}
/** 닉네임 검증. 서버 규칙(2~12자, 한글·영문·숫자·_)과 같다. */
export function checkNickname(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  const length = [...name].length;
  if (length < NICK_MIN || length > NICK_MAX) return { ok: false, name, error: 'length' };
  if (!/^[가-힣A-Za-z0-9_]+$/.test(name)) return { ok: false, name, error: 'chars' };
  return { ok: true, name, error: null };
}
/** 문자열 → 0~359 색상 값(초상 대체 원 색). 같은 id는 항상 같은 색. */
export function hueOf(value) {
  let h = 2166136261;
  for (const ch of String(value ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h % 360;
}
export function initialOf(name) {
  const first = [...String(name ?? '').trim()][0];
  return first ? first.toUpperCase() : '?';
}
export function badgeText(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}
/** 접속 위치 문구: 로비 · 던전 · 오로라 빙정호 · 파티 중 */
export function presenceText(presence) {
  if (!presence || typeof presence !== 'object') return '';
  const where = presence.where ? String(presence.where) : '';
  if (presence.state === 'battle') return where ? '던전 · ' + where : '던전';
  if (presence.state === 'party') return where ? '파티 · ' + where : '파티 중';
  return where ? '로비 · ' + where : '로비';
}
/** 칭호 id → 칩 색 톤 */
export function titleTone(titleId) {
  const id = String(titleId || '');
  if (id === 'founder') return 'gold';
  if (id === 'conqueror') return 'purple';
  if (id.startsWith('first:')) return 'gold';
  if (id.startsWith('pioneer:')) return 'orange';
  if (id.startsWith('vanguard:')) return 'blue';
  return 'blue';
}
export function contentName(config, id) {
  const hit = config && Array.isArray(config.contents) ? config.contents.find(c => c.id === id) : null;
  return hit ? hit.name : id ? String(id) : '자유 사냥';
}
/** 게시글 상태 칩. 답변이 달린 열린 글은 답변 완료로 보인다. */
export function statusChip(post) {
  if (!post) return STATUSES.open;
  if (post.status === 'open' && post.devReply) return STATUSES.wontfix;
  return STATUSES[post.status] || STATUSES.open;
}
export function boardCategory(value) {
  return CATEGORIES[value] || CATEGORIES.question;
}

const ERRORS = Object.freeze({
  'bad-key': '기기 정보가 올바르지 않아요. 기기 이전 코드를 다시 확인해 주세요.',
  'no-profile': '먼저 닉네임을 정해 주세요.',
  banned: '이용이 제한된 계정이에요.',
  rate: '너무 빨라요. 잠시 후에 다시 해 주세요.',
  muted: '채팅이 잠시 제한됐어요.',
  length: '글자 수를 확인해 주세요.',
  name: '닉네임은 한글·영문·숫자·_ 2~12자로 정해 주세요.',
  'name-full': '이 이름은 사용할 수 없어요. 다른 이름을 써 주세요.',
  'rename-cooldown': '닉네임은 24시간에 한 번만 바꿀 수 있어요.',
  code: '이름#1234 형식으로 입력해 주세요.',
  'player-not-found': '그런 모험가를 찾지 못했어요.',
  self: '나 자신에게는 할 수 없어요.',
  blocked: '차단한 상대예요.',
  'not-friend': '친구에게만 보낼 수 있어요.',
  'already-friends': '이미 친구예요.',
  'friends-full': '친구가 가득 찼어요.',
  'requests-full': '상대가 받을 수 있는 요청이 가득 찼어요.',
  'no-request': '이미 처리된 요청이에요.',
  'blocks-full': '차단 목록이 가득 찼어요.',
  duplicate: '같은 말을 계속 보낼 수 없어요.',
  repeat: '같은 말을 계속 보낼 수 없어요.',
  full: '이 광장은 가득 찼어요. 다른 광장을 골라 주세요.',
  'not-joined': '광장에 아직 들어가지 못했어요. 잠시 후 다시 시도해 주세요.',
  'hello-required': '연결 중이에요. 잠시 후 다시 시도해 주세요.',
  content: '알 수 없는 던전이에요.',
  members: '현재 인원이 정원보다 많을 수 없어요.',
  integer: '숫자 값을 확인해 주세요.',
  note: '한마디는 40자까지 쓸 수 있어요.',
  title: '제목은 2~40자로 써 주세요.',
  body: '내용을 확인해 주세요.',
  'post-not-found': '글을 찾지 못했어요.',
  category: '분류를 골라 주세요.',
  'admin-only': '관리자만 할 수 있어요.',
  'link-disabled': '구글 연동은 준비 중이에요.',
  'linked-elsewhere': '이미 다른 기록에 연결된 구글 계정이에요. 기록 되찾기를 이용해 주세요.',
  'already-linked': '이미 구글 계정이 연결돼 있어요.',
  'no-link': '이 구글 계정에 연결된 기록이 없어요.',
  'key-in-use': '이 기기 코드는 다른 기록에 쓰이고 있어요.',
  'bad-token': '구글 로그인을 확인하지 못했어요.',
  token: '구글 로그인을 확인하지 못했어요.',
  'too-fast': '기록이 너무 빨라 인정되지 않았어요.',
  channel: '광장을 찾지 못했어요.',
  offline: '오프라인이에요. 연결되면 다시 시도해 주세요.',
  network: '서버에 연결하지 못했어요.',
  timeout: '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.',
  'http-404': '커뮤니티 서버가 아직 준비되지 않았어요.',
  'http-503': '커뮤니티 서버가 점검 중이에요.',
  'fetch-unavailable': '이 환경에서는 커뮤니티를 쓸 수 없어요.',
  diag: '진단 정보를 보낼 수 없어요.',
});
/** 서버·SDK 오류 코드를 한국어 안내로 바꾼다. 알 수 없는 코드도 영어를 그대로 노출하지 않는다. */
export function errorMessage(code, retryAfterMs) {
  const base = ERRORS[code] || (typeof code === 'string' && code.startsWith('http-') ? '서버 오류가 났어요. 잠시 후 다시 시도해 주세요.' : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0 && ['rate', 'rename-cooldown', 'muted', 'requests-full'].includes(code)) {
    const sec = Math.ceil(retryAfterMs / 1000);
    const wait = sec >= 3600 ? Math.ceil(sec / 3600) + '시간' : sec >= 60 ? Math.ceil(sec / 60) + '분' : sec + '초';
    return base.replace(/[.]$/, '') + ' (약 ' + wait + ' 뒤)';
  }
  return base;
}
