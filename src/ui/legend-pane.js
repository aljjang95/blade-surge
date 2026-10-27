// 영웅 화면의 '전설' 탭 본문(장비·성장·스킬·세트 옆 다섯 번째 탭). 계정 공통 전설 수련의 요약을 보여 주고 판(LegendView)을 연다.
// Lv.80 전에는 잠금 사유와 첫 점수 효과 미리보기만 보인다. 규칙·계산은 모두 game/legend-ui-model.js 와 Economy 가 맡는다.
import { legendBoard } from '../game/legend-ui-model.js';
import { HEROES } from '../data/heroes.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');

/** 계정의 영웅 중 가장 높은 레벨. */
export function maxHeroLevel(eco) {
  let max = 1;
  for (const id of Object.keys(eco.s.heroes || {})) if (HEROES[id] && eco.ownHero?.(id) !== false) max = Math.max(max, Math.floor(Number(eco.s.heroes[id]?.level) || 1));
  return max;
}

/** 탭 본문 HTML. */
export function legendPaneHtml(meta) {
  const eco = meta.eco, board = legendBoard(eco.legendState(), { maxHeroLevel: maxHeroLevel(eco), gold: eco.s.gold });
  const branches = board.branches.map((b) => '<li class="hl-branch"><b>' + esc(b.name) + '</b><span>' + b.spent + '점</span><small>키스톤 ' + b.openKeystones + '/' + b.keystones.length + '</small></li>').join('');
  const lock = board.locked ? '<p class="hl-lock" role="note">' + esc(board.lockReason) + '</p>' : '';
  const sample = board.branches[0].nodes[0];
  return '<section class="hs-legend" aria-label="전설 수련 요약" data-locked="' + board.locked + '">' +
    '<div class="hl-top"><div class="hl-rank" role="status" aria-label="전설 ' + num(board.rank) + '단계"><small>전설</small><b>' + num(board.rank) + '</b><small>단계</small></div>' +
    '<div class="hl-points" role="status" aria-label="남은 전설 점수 ' + board.points + '"><small>남은 점수</small><b>' + board.points + '</b></div></div>' +
    '<progress class="hl-exp" max="' + Math.max(1, board.need) + '" value="' + Math.min(board.exp, board.need) + '" aria-label="다음 단계까지 경험치 ' + esc(board.expText) + '"></progress>' +
    '<p class="hl-exp-text">' + esc(board.expText) + ' · ' + board.pct + '%</p>' + lock +
    '<ul class="hl-branches" aria-label="갈래별 사용한 점수">' + branches + '</ul>' +
    '<p class="hl-next">' + esc(board.upcomingText) + '</p>' +
    (board.locked ? '<p class="hl-hint">Lv.80 이후 얻는 경험치가 전설 단계로 쌓입니다. 예: ' + esc(sample.name) + ' 1점 ' + esc(sample.nextText) + ' ' + esc(sample.statLabel) + '</p>' : '') +
    '<button type="button" class="btn btn-gold hl-open" id="h-legend-open" aria-haspopup="dialog">전설 수련 판 열기' + (board.points > 0 ? '<small>남은 점수 ' + board.points + '</small>' : '') + '</button></section>';
}

export function bindLegendPane(meta, panel) {
  const open = panel.querySelector('#h-legend-open');
  if (open) open.onclick = () => meta.openLegend(open);
}
