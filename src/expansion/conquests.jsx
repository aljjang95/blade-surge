import React from 'react';
import { EXPEDITION_DEPTHS } from '../data/expedition-depths.js';
import { EXPEDITION_CONQUESTS, expeditionConquest } from '../data/expedition-conquests.js';
import { MATERIALS } from '../data/expansion.js';

export function ConquestRoutes({ service, launch, starting }) {
  const marks = service.s.conquests;
  return <section aria-label="전술 공략" className="exp-conquests">
    <p className="exp-depth-intro">심층 원정 이후, 전투의 방식으로 남기는 기록입니다. 조건을 달성하고 보스를 처치하면 표식과 최초 보상을 받습니다. 조건을 놓쳐도 원정 보상은 그대로 받습니다.</p>
    <p className="exp-conquest-total">정복 표식 <b>{marks.length} / {EXPEDITION_CONQUESTS.length}</b> · 추가 선택 창 없이 진행</p>
    <div className="exp-dungeon-grid">{EXPEDITION_DEPTHS.map(d => <article className="exp-conquest-region" key={d.id}>
      <img className="exp-conquest-art" src={d.art} alt="" loading="lazy" decoding="async"/>
      <div className="exp-card-body"><h3>{d.name}</h3><p>출격 에너지 {d.energy} · 심층 원정과 같은 기본 보상</p>
        {EXPEDITION_CONQUESTS.filter(c => c.dungeonId === d.id).map(c => {
          const access = service.conquestAccess(c.id), completed = marks.includes(c.id);
          return <section key={c.id} data-conquest={c.id} className="exp-conquest-task">
            <small>{completed ? `획득 · ${c.mark}` : c.previous ? '두 번째 공략' : '첫 번째 공략'}</small>
            <h4>{c.name}</h4><p>{c.objective}</p>
            <details className="ui-details"><summary>공략 방법 · 최초 보상</summary><p>{c.detail}</p><p>{completed ? '최초 보상 수령 완료 · 다시 도전하면 기본 보상만 받습니다.' : `골드 ${c.firstRewards.gold.toLocaleString('ko-KR')} · ${Object.entries(c.firstRewards.materials).map(([id,n]) => `${MATERIALS.find(m=>m.id===id).name} ${n}개`).join(' · ')} · ${c.mark}`}</p></details>
            <button className="exp-primary" disabled={!access.ok || starting} onClick={() => launch('dungeon', d.id, { depth: 'deep', conquestId: c.id })}>{!access.ok ? access.error : completed ? '공략 다시 도전' : '전술 공략 출격'}</button>
          </section>;
        })}
      </div>
    </article>)}</div>
  </section>;
}

export function ConquestResult({ result, launch }) {
  const def = expeditionConquest(result.conquestId);
  if (!def) return null;
  const outcome = result.rewards.conquest, next = EXPEDITION_CONQUESTS.find(c => c.previous === def.id);
  const success = result.win && result.conquest?.complete;
  return <section className="exp-conquest-result" aria-label="전술 공략 결과">
    <h3>{success ? '전술 공략 달성' : '전술 공략 미달성'}</h3>
    <p>{def.objective}</p><p>{result.conquest?.progress || 0} / {def.target} · {result.conquest?.failed ? '순서 조건을 놓쳤습니다.' : success ? def.mark : '다음 출격에서 다시 도전할 수 있습니다.'}</p>
    {!result.saveError && <p>{outcome?.firstClear ? `새 정복 표식 「${def.mark}」과 최초 보상이 저장되었습니다.` : success ? '보유한 표식입니다. 기본 원정 보상을 받았습니다.' : result.win ? '기본 원정 보상은 정상 지급되었습니다.' : '다시 준비해서 도전하세요.'}</p>}
    {success && next && !result.saveError && <button className="exp-primary" onClick={() => launch('dungeon', def.dungeonId, { depth: 'deep', conquestId: next.id })}>다음 공략 · {next.name}</button>}
  </section>;
}
