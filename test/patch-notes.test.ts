import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyTitle, main, nextPatchVersion, parsePrs, renderDraft } from '../tools/patch-notes.mjs';
import { parseFrontMatter, validateMeta } from '../src/shared/news-core.js';

const record = (sha: string, subject: string, body = '') => `${sha}\x1f${subject}\x1f${body}\x1e`;

describe('패치노트 분류', () => {
  test('문서·테스트·기획·perf 등은 내부로 뺀다', () => {
    for (const title of ['문서: 초보자 마을 Tripo 소품 운영 반영 기록', '테스트: 실제 시계 의존 제거(픽업 교대)', '기획: 출시·운영 트랙', 'perf: 렌더 비용 줄임', 'docs: 인계', '리팩터: 모듈 분리', '인계 정리', 'chore: 의존성'])
      expect(classifyTitle(title)).toBe('internal');
  });
  test('실제 최근 PR 제목들이 기대한 칸으로 간다', () => {
    expect(classifyTitle("보상 고리: 결과 화면에 '이 보상으로 지금 할 것' 버튼 (캠페인·탑·던전·결투장)")).toBe('개선');
    expect(classifyTitle('아트 t8: 기사·야만전사·마법사 구르기 몸 꺼짐 수정(원본 몸 접지 띠 곡선)')).toBe('버그 수정');
    expect(classifyTitle('소환 배너: 정사각 초상 대체 그림 잘림·확대 흐림 수정 + 소환 3차 운영 기록')).toBe('버그 수정');
    expect(classifyTitle('소환 3차: SSR 2호 검은 고양이 사냥꾼 + 11-09 그믐밤 픽업')).toBe('새 콘텐츠');
    expect(classifyTitle('소환 2차: 첫 신규 SSR 늑대인간 족장 + 할로윈 픽업 교대 + 소환 화면 결함 수정')).toBe('새 콘텐츠');
    expect(classifyTitle('상점 밸런스: 1레벨 전설 강화석·골드 금고 잠금')).toBe('밸런스');
    expect(classifyTitle('상점 아바타 카드 겹침 수정: 행 높이를 내용에 맞춤')).toBe('버그 수정');
    expect(classifyTitle('초보자 마을: Tripo 소품 8종으로 코드 모델 교체')).toBe('개선');
  });
});

describe('PR 목록 읽기', () => {
  test('스쿼시 제목의 (#번호)와 머지 커밋 본문 제목을 읽고 같은 PR 은 한 번만', () => {
    const log = [
      record('a'.repeat(40), '보상 고리: 버튼 (#286)'),
      record('b'.repeat(40), 'Merge pull request #290 from x/art', '아트 t7: 망토 맞춤\n\n자세한 설명'),
      record('c'.repeat(40), '아트 t7: 망토 맞춤 (#290)'),
      record('d'.repeat(40), '직접 푸시한 변경'),
      record('e'.repeat(40), '초보자 마을 소품 (#292) (#296)'),
    ].join('');
    const rows = parsePrs(log);
    expect(rows.map((row) => [row.pr, row.title])).toEqual([[286, '보상 고리: 버튼'], [290, '아트 t7: 망토 맞춤'], [null, '직접 푸시한 변경'], [296, '초보자 마을 소품']]);
  });
  test('빈 로그는 빈 목록', () => { expect(parsePrs('')).toEqual([]); });
});

describe('버전·초안', () => {
  test('다음 패치 버전은 기존 파일 중 가장 높은 값에서 +1', () => {
    expect(nextPatchVersion([])).toBe('1.0.0');
    expect(nextPatchVersion(['2026-10-27-patch-1-0-3.md', '2026-10-20-patch-1-0-2.md', '2026-10-26-season-1-start.md'])).toBe('1.0.4');
    expect(nextPatchVersion(['2026-11-01-patch-1-1-0.md', '2026-10-27-patch-1-0-9.md'])).toBe('1.1.1');
  });
  test('초안은 draft 머리말을 가지며 build-news 의 파서와 검증을 통과하고 내부 변경은 주석으로만 남는다', () => {
    const rows = parsePrs([
      record('a'.repeat(40), '새 영웅 추가 (#1)'), record('b'.repeat(40), '구르기 꺼짐 수정 (#2)'), record('c'.repeat(40), '결과 화면 버튼 (#3)'), record('d'.repeat(40), '문서: 인계 (#4)'),
    ].join(''));
    const draft = renderDraft({ rows, version: '1.0.4', now: new Date('2026-10-27T05:00:00Z'), since: 'abc', until: 'HEAD' });
    const { meta, body } = parseFrontMatter(draft, '초안');
    expect(meta).toMatchObject({ type: 'patch', version: '1.0.4', draft: true });
    expect(validateMeta(meta, '초안').date).toBe('2026-10-27T14:00:00+09:00');
    expect(body).toContain('## 새 콘텐츠\n- 새 영웅 추가 (#1)');
    expect(body).toContain('## 버그 수정\n- 구르기 꺼짐 수정 (#2)');
    expect(body).toContain('## 개선\n- 결과 화면 버튼 (#3)');
    expect(body).not.toContain('문서');
    expect(draft).toContain('# 내부: #4 문서: 인계');
    expect(body.indexOf('## 새 콘텐츠')).toBeLessThan(body.indexOf('## 개선'));
  });
  test('이용자 변경이 없으면 자리표시 문장을 넣는다', () => {
    const draft = renderDraft({ rows: [{ pr: 1, sha: 'a'.repeat(40), title: '문서: 기록' }], version: '1.0.0', now: new Date('2026-10-27T00:00:00Z'), since: 'a', until: 'HEAD' });
    expect(parseFrontMatter(draft).body).toContain('이용자에게 보이는 변경이 아직 없어요');
  });
});

describe('명령 실행', () => {
  const dirs: string[] = [];
  const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'patch-notes-')); dirs.push(dir); return dir; };
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // 얕은 복제(CI 의 fetch-depth 1)에서는 HEAD~5 가 없어서 HEAD 로 대신한다(빈 범위여도 명령은 성공해야 한다).
  const earlier = () => { try { return execFileSync('git', ['rev-parse', 'HEAD~5'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return head(); } };
  const quiet = async (fn: () => Promise<number>) => {
    const log = console.log, err = console.error;
    console.log = () => {}; console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = err; }
  };

  test('--since 로 초안을 만들고, 같은 파일이 있으면 덮어쓰지 않고 종료 코드 1', async () => {
    const dir = tmp();
    const args = ['--since', earlier(), '--until', head(), '--version', '9.9.9', '--date', '2030-01-02', '--out-dir', dir];
    expect(await quiet(() => main(args))).toBe(0);
    const file = join(dir, '2030-01-02-patch-9-9-9.md');
    expect(existsSync(file)).toBe(true);
    const first = readFileSync(file, 'utf8');
    expect(parseFrontMatter(first).meta.draft).toBe(true);
    writeFileSync(file, `${first}\n수동 수정`);
    expect(await quiet(() => main(args))).toBe(1);
    expect(readFileSync(file, 'utf8')).toContain('수동 수정');
  });

  test('운영 version.json 을 못 읽고 --since 도 없으면 종료 코드 2', async () => {
    const failing = (async () => { throw new Error('offline'); }) as any;
    expect(await quiet(() => main(['--out-dir', tmp()], { fetchImpl: failing }))).toBe(2);
  });

  test('운영 sha 를 읽으면 그것을 기준으로 쓴다', async () => {
    const dir = tmp();
    const live = (async () => ({ ok: true, json: async () => ({ sha: earlier() }) })) as any;
    expect(await quiet(() => main(['--until', head(), '--version', '9.9.8', '--date', '2030-01-03', '--out-dir', dir], { fetchImpl: live }))).toBe(0);
    expect(existsSync(join(dir, '2030-01-03-patch-9-9-8.md'))).toBe(true);
  });

  test('없는 기준 커밋·잘못된 옵션·버전은 종료 코드 2', async () => {
    const dir = tmp();
    expect(await quiet(() => main(['--since', 'deadbeef00000000', '--out-dir', dir]))).toBe(2);
    expect(await quiet(() => main(['--bogus', 'x']))).toBe(2);
    expect(await quiet(() => main(['--since', earlier(), '--version', 'abc', '--out-dir', dir]))).toBe(2);
    expect(await quiet(() => main(['--since', earlier(), '--date', '내일', '--out-dir', dir]))).toBe(2);
  });
});
