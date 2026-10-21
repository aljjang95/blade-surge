// feel-fixture-qa.mjs 의 원시 프레임 기록(raw.json)을 지표 표로 줄인다. 순수 계산만 하며 단위 테스트가 같은 함수를 쓴다.
// 사용: node tools/feel-fixture-report.mjs <before/raw.json> [after/raw.json] [out.md] [stripDir]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const FRAME_MS = 1000 / 60;
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const markF = (s, label, nth = 0) => s.marks.filter(m => m.label === label)[nth]?.f;

/** 프레임 f(1부터 시작하는 q.frame)의 행. rows[i].f 가 프레임 번호다. */
const rowAt = (rows, f) => rows.find(r => r.f === f);
const between = (rows, a, b) => rows.filter(r => r.f >= a && r.f < b);

/** 정지(실시간 ms): ImpactClock.step 과 같은 규칙으로 직전 프레임 뒤 남은 정지(stop)를 한 프레임(1/60초)씩 소비한다. 슬로우와 겹쳐도 정지분만 센다. */
export function frozenMs(rows) {
  let ms = 0;
  for (let i = 1; i < rows.length; i++) ms += Math.min(Math.max(0, rows[i - 1].stop), 1 / 60) * 1000;
  return ms;
}

/** 넉백 이동(m): 적 넉백 속도 × 시뮬레이션 dt 의 합. AI 이동과 분리된 순수 넉백 거리다. */
export function knockbackDistance(rows, ei) {
  let d = 0;
  for (const r of rows) { const e = r.e[ei]; if (e) d += e.kb * r.sc / 60; }
  return d;
}

/** 플린치(렌더 피벗 오프셋) 정점과 정점의 10% 아래로 가라앉는 데 걸린 실시간 ms. */
export function flinch(rows, ei) {
  let peak = 0, peakAt = -1;
  rows.forEach((r, i) => { const v = r.e[ei]?.mr || 0; if (v > peak) { peak = v; peakAt = i; } });
  if (peakAt < 0 || peak <= 0) return { peak: 0, settleMs: 0 };
  let end = rows.length;
  for (let i = peakAt; i < rows.length; i++) if ((rows[i].e[ei]?.mr || 0) < peak * .1) { end = i; break; }
  return { peak, settleMs: (end) * FRAME_MS };
}

/** 대상 중 이 구간에서 가장 먼저 섬광이 켜진 적(맞은 적). */
export function struckIndex(rows) {
  for (const r of rows) { const i = r.e.findIndex(e => e.fl > 0); if (i >= 0) return i; }
  return -1;
}

/** 영웅 클립 전환마다: 이전 클립 가중치가 0 이 되기까지(ms), 전환 프레임의 뼈 회전 변화 / 주변 중앙값(튐 비율). */
export function transitions(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].pa === rows[i - 1].pa) continue;
    let j = i; while (j < rows.length && rows[j].w.length > 1) j++;
    const around = rows.slice(Math.max(0, i - 6), Math.min(rows.length, i + 7)).filter((_, k) => k !== Math.min(6, i)).map(r => r.pose).filter(v => v > 0);
    const base = Math.max(1, median(around));
    out.push({ f: rows[i].f, from: rows[i - 1].pa, to: rows[i].pa, blendMs: (j - i + 1) * FRAME_MS, popDeg: rows[i].pose, popRatio: r1(rows[i].pose / base) });
  }
  return out;
}

/** 공격 단계 동안 참인 진행 구간들(공격 시작 기준 ms). key: 'cq'(다음 타 예약) 또는 'cd'(회피 취소). */
export function windows(rows, start, end, key) {
  const seg = between(rows, start, end), out = []; let open = null;
  seg.forEach(r => { const t = (r.f - start) * FRAME_MS; if (r[key] && open === null) open = t; if (!r[key] && open !== null) { out.push([r1(open), r1(t)]); open = null; } });
  if (open !== null) out.push([r1(open), r1((end - start) * FRAME_MS)]);
  return out;
}

export function heroMetrics(h) {
  const S = h.scenarios, m = { hero: h.hero };
  // 3타 콤보
  {
    const s = S.combo3, rows = s.rows, p0 = markF(s, 'press-0'), c = [0, 1, 2].map(k => markF(s, 'contact-' + k));
    m.latencyMs = r1((c[0] - p0) * FRAME_MS);
    m.cadenceMs = [r1((c[1] - c[0]) * FRAME_MS), r1((c[2] - c[1]) * FRAME_MS)];
    m.hits = c.map((f, k) => {
      const w = between(rows, f, k < 2 ? c[k + 1] : f + 40), ei = struckIndex(w);
      const fl = ei >= 0 ? flinch(w, ei) : { peak: 0, settleMs: 0 };
      const hitRow = rowAt(rows, f + 1);
      return { hitstopMs: r1(frozenMs(w)), flinch: r2(fl.peak), flinchMs: r1(fl.settleMs), kbM: ei >= 0 ? r2(knockbackDistance(w, ei)) : 0,
        flashMs: ei >= 0 ? r1(w.filter(r => r.e[ei].fl > 0).length * FRAME_MS) : 0, enemyClip: ei >= 0 ? hitRow?.e[ei]?.an : null, enemyState: ei >= 0 ? hitRow?.e[ei]?.st : null };
    });
    m.queueWindowMs = windows(rows, p0, c[1], 'cq');
    const camSteps = rows.slice(1).map((r, i) => Math.hypot(r.cam[0] - rows[i].cam[0], r.cam[1] - rows[i].cam[1], r.cam[2] - rows[i].cam[2]));
    m.cameraMaxStepCm = r1(Math.max(...camSteps) * 100); m.fovRange = r1(Math.max(...rows.map(r => r.fov)) - Math.min(...rows.map(r => r.fov)));
    m.comboTransitions = transitions(rows);
  }
  // 회피 취소
  {
    const s = S.dodgeCancel, rows = s.rows, c0 = markF(s, 'contact-0'), pd = markF(s, 'press-dodge'), ds = markF(s, 'dodge-start'), de = markF(s, 'dodge-end');
    const atkStart = markF(s, 'press-0');
    m.dodge = { cancelAfterContactMs: r1((pd - c0) * FRAME_MS), pressToDodgeMs: r1((ds - pd) * FRAME_MS), dodgeMs: r1((de - ds) * FRAME_MS),
      iframesMs: r1(between(rows, ds, de + 30).filter(r => r.inv > 0).length * FRAME_MS),
      cancelWindowsMs: windows(rows, atkStart, ds, 'cd'),
      resumeMs: r1((markF(s, 'resume-contact') - markF(s, 'press-resume')) * FRAME_MS),
      transitions: transitions(between(rows, pd - 2, de + 12)) };
    const a = rowAt(rows, ds), b = rowAt(rows, de); m.dodge.travelM = a && b ? r2(Math.hypot(b.px - a.px, b.pz - a.pz)) : null;
  }
  // 피격
  {
    const s = S.hurt, rows = s.rows, lf = markF(s, 'light-hit'), hf = markF(s, 'heavy-inject');
    const light = between(rows, lf, lf + 30), heavy = between(rows, hf + 1, hf + 60);
    const pk = w => Math.max(0, ...w.map(r => r.pmr));
    m.hurt = { lightFlinch: r2(pk(light)), lightFlashMs: r1(light.filter(r => r.pfl > 0).length * FRAME_MS), lightState: rowAt(rows, lf + 1)?.ps,
      heavyStateMs: r1(heavy.filter(r => r.ps === 'hurt').length * FRAME_MS), heavyClip: heavy.find(r => r.ps === 'hurt')?.pa || null,
      heavyKbM: heavy.length ? r2(Math.hypot(heavy.at(-1).px - heavy[0].px, heavy.at(-1).pz - heavy[0].pz)) : 0,
      heavyHitstopMs: r1(frozenMs(heavy)), transitions: transitions(between(rows, hf - 2, hf + 40)) };
  }
  // 처치
  {
    const s = S.kill, rows = s.rows, n = Object.keys(s.marks.filter(x => x.label.startsWith('contact-'))).length;
    const fin = markF(s, 'contact-' + (n - 1)), c0 = markF(s, 'contact-0');
    const after = between(rows, fin, fin + 160);
    const slow = s.stops.filter(x => x.slowmo);
    const deadAt = after.findIndex(r => !r.e[0].a);
    const goneAt = after.findIndex(r => r.e[0].dead || !r.e[0].vis);
    m.kill = { finisherHitstopMs: r1(frozenMs(between(rows, fin, fin + 20))), slowmo: slow.map(x => x.slowmo), killed: deadAt >= 0,
      eliteDeathClip: deadAt >= 0 ? after[deadAt + 1]?.e[0].an : null, eliteLaunchM: r2(Math.max(0, ...after.map(r => r.e[0].y))),
      eliteRemoveMs: goneAt >= 0 ? r1(goneAt * FRAME_MS) : null };
    const t = between(rows, c0, c0 + 160);
    m.kill.trash = [1, 2].map(i => ({ killed: t.some(r => !r.e[i].a), clip: t.find(r => !r.e[i].a)?.e[i].an || null, launchM: r2(Math.max(0, ...t.map(r => r.e[i].y))),
      kbM: r2(knockbackDistance(t, i)) }));
    m.kill.keys = s.keys;
  }
  // 스킬·궁극기
  for (const name of ['skill', 'ult']) {
    const s = S[name], rows = s.rows, p = s.marks[0].f;
    const first = rows.find(r => r.f > p && r.e.some(e => e.fl > 0));
    const hit = new Set(); rows.forEach(r => r.e.forEach((e, i) => { if (e.fl > 0) hit.add(i); }));
    m[name] = { pressToFirstHitMs: first ? r1((first.f - p) * FRAME_MS) : null, struck: hit.size, hitstopMs: r1(frozenMs(rows)),
      slowmo: s.stops.filter(x => x.slowmo).map(x => x.slowmo), stops: s.stops.filter(x => x.sec).length,
      maxStopMs: r1(Math.max(0, ...s.stops.filter(x => x.sec).map(x => x.sec)) * 1000),
      kbMaxM: r2(Math.max(0, ...rows[0].e.map((_, i) => knockbackDistance(rows, i)))),
      fovRange: r1(Math.max(...rows.map(r => r.fov)) - Math.min(...rows.map(r => r.fov))), transitions: transitions(rows) };
  }
  return m;
}

const fmtPops = list => { const worst = list.reduce((a, b) => (b.popRatio > (a?.popRatio || 0) ? b : a), null); return worst ? `${worst.popDeg}° ×${worst.popRatio} (${worst.from}→${worst.to})` : '-'; };

export function table(before, after = null) {
  const heroes = Object.keys(before.heroes);
  const lines = [];
  const row = (label, fn) => {
    const cells = heroes.map(h => { const b = fn(heroMetrics(before.heroes[h])); const a = after?.heroes[h] ? fn(heroMetrics(after.heroes[h])) : null; return a === null || String(a) === String(b) ? String(b) : `${b} → **${a}**`; });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  };
  lines.push(`| 지표 | ${heroes.join(' | ')} |`, `|---|${heroes.map(() => '---').join('|')}|`);
  row('입력→첫 타격 프레임 ms', m => m.latencyMs);
  row('콤보 간격 ms (1→2, 2→3)', m => m.cadenceMs.join(' / '));
  row('히트스톱 ms (1/2/3타)', m => m.hits.map(h => h.hitstopMs).join(' / '));
  row('적 플린치 정점(m+rad)/가라앉음 ms (3타)', m => `${m.hits[2].flinch} / ${m.hits[2].flinchMs}`);
  row('적 넉백 m (1/2/3타)', m => m.hits.map(h => h.kbM).join(' / '));
  row('적 섬광 ms (3타)', m => m.hits[2].flashMs);
  row('적 피격 클립 (1/3타)', m => `${m.hits[0].enemyClip} / ${m.hits[2].enemyClip}`);
  row('카메라 프레임당 최대 이동 cm / FOV 변화', m => `${m.cameraMaxStepCm} / ${m.fovRange}`);
  row('콤보 전환 블렌드 ms(최대)', m => r1(Math.max(...m.comboTransitions.map(t => t.blendMs))));
  row('콤보 전환 최악 튐', m => fmtPops(m.comboTransitions));
  row('다음 타 예약 창 ms', m => m.queueWindowMs.map(w => w.join('–')).join(', '));
  row('회피 취소 창 ms(1타)', m => m.dodge.cancelWindowsMs.map(w => w.join('–')).join(', '));
  row('회피 입력→시작 ms / 무적 ms / 이동 m', m => `${m.dodge.pressToDodgeMs} / ${m.dodge.iframesMs} / ${m.dodge.travelM}`);
  row('회피 전환 최악 튐', m => fmtPops(m.dodge.transitions));
  row('피격(경타) 플린치 / 섬광 ms', m => `${m.hurt.lightFlinch} / ${m.hurt.lightFlashMs}`);
  row('피격(강타) 경직 ms / 클립 / 밀림 m / 정지 ms', m => `${m.hurt.heavyStateMs} / ${m.hurt.heavyClip} / ${m.hurt.heavyKbM} / ${m.hurt.heavyHitstopMs}`);
  row('스킬1 입력→첫 피격 ms / 맞은 수 / 정지 ms', m => `${m.skill.pressToFirstHitMs} / ${m.skill.struck} / ${m.skill.hitstopMs}`);
  row('궁극기 입력→첫 피격 ms / 맞은 수 / 최대 정지 ms', m => `${m.ult.pressToFirstHitMs} / ${m.ult.struck} / ${m.ult.maxStopMs}`);
  row('궁극기 슬로우 [배율,초,복귀]', m => m.ult.slowmo.map(s => `[${s.join(',')}]`).join(' '));
  row('정예 마무리 처치: 정지 ms / 슬로우', m => `${m.kill.finisherHitstopMs} / ${m.kill.slowmo.map(s => `[${s.join(',')}]`).join(' ')}`);
  row('정예 사망 클립 / 들림 m / 사라짐 ms', m => `${m.kill.eliteDeathClip} / ${m.kill.eliteLaunchM} / ${m.kill.eliteRemoveMs}`);
  row('졸개 평타 처치: 클립 / 들림 m / 넉백 m', m => m.kill.trash.map(t => `${t.clip}/${t.launchM}/${t.kbM}`).join(', '));
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [bArg, aArg, outArg] = process.argv.slice(2);
  const before = JSON.parse(readFileSync(bArg, 'utf8'));
  const after = aArg && existsSync(aArg) ? JSON.parse(readFileSync(aArg, 'utf8')) : null;
  const md = table(before, after);
  if (outArg) writeFileSync(outArg, md + '\n');
  console.log(md);
}
