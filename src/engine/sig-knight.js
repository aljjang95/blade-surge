import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * knight 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const SIGNATURES = {};
void IMPACT_KIND; void MARK_STYLE;
