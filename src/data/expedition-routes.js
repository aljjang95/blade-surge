import { DUNGEONS } from './expansion.js';
import { FIELD_DUNGEONS } from './open-fields.js';

// 물리 허브 관문은 기존 목록을 유지하고 실제 출격·기록은 모든 지역을 읽는다.
export const EXPEDITION_ROUTES = [...DUNGEONS,...FIELD_DUNGEONS];
