import React, { useState } from 'react';
import { HEROES } from '../data/heroes.js';
import { resourceArt } from '../ui/illustrated.js';
import { dungeonJourney } from '../ui/dungeon-journey.js';
import './dungeon-journey.css';

export function DungeonJourney({ app, service }) {
  const journey = dungeonJourney(service);
  const [selected, setSelected] = useState(journey.current?.dungeon.id);
  const node = journey.nodes.find(entry => entry.dungeon.id === selected) || journey.current;
  if (!node) return null;
  const dungeon = node.dungeon;
  const prepare = () => {
    // 준비창은 지도와 같은 기존 출격 서비스·소유권 경계를 사용한다.
    app.expeditionUI.prepareDungeon(dungeon.id, document.getElementById('journey-prepare'));
  };
  return <section className="dungeon-journey" aria-label="레벨 1부터 이어지는 던전 여정">
    <header className="dungeon-journey-heading"><div><small>YOUR ADVENTURE</small><h2>한 걸음씩, 다음 던전으로</h2></div><span>{journey.cleared} / {journey.nodes.length} 정복</span></header>
    <div className="dungeon-journey-layout">
      <nav className="dungeon-journey-map" aria-label="던전 여정 지도">
        <svg className="journey-path journey-path-wide" viewBox="0 0 600 240" preserveAspectRatio="none" aria-hidden="true"><path d="M50 60 H550 Q595 60 595 120 Q595 180 550 180 H50"/></svg>
        <svg className="journey-path journey-path-tall" viewBox="0 0 300 480" preserveAspectRatio="none" aria-hidden="true"><path d="M50 60 H250 Q292 60 292 120 Q292 180 250 180 H50 Q8 180 8 240 Q8 300 50 300 H250 Q292 300 292 360 Q292 420 250 420 H50"/></svg>
        {journey.nodes.map(({ dungeon: route, index, unlocked, cleared }) => {
          const current = journey.current?.dungeon.id === route.id;
          const rowWide = Math.floor(index / 6), rowTall = Math.floor(index / 3);
          return <button key={route.id} type="button" className="journey-node" data-journey-node={route.id} data-state={cleared ? 'cleared' : unlocked ? 'open' : 'locked'}
            aria-pressed={selected === route.id} aria-current={current ? 'step' : undefined}
            aria-label={`${route.name} · 원정 레벨 ${route.minLevel} · ${cleared ? '정복 완료' : unlocked ? '도전 가능' : '미해금, 조건 보기'}`}
            style={{ '--journey-col': rowWide % 2 ? 6 - index % 6 : index % 6 + 1, '--journey-row': rowWide + 1,
              '--journey-col-tall': rowTall % 2 ? 3 - index % 3 : index % 3 + 1, '--journey-row-tall': rowTall + 1, '--journey-accent': route.accent || '#a9d9be' }}
            onClick={() => setSelected(route.id)}>
            <span className="journey-node-art"><img src={route.art} alt="" loading="lazy" decoding="async"/>{cleared && <i>✓</i>}{current && <img className="journey-hero" src={HEROES[app.eco.s.selected].portrait} alt="현재 목표"/>}</span>
            <b>{route.name}</b><small>{cleared ? '정복 완료' : `Lv.${route.minLevel}${unlocked ? ' · 도전' : ' · 잠김'}`}</small>
          </button>;
        })}
      </nav>
      <article className="journey-destination" data-journey-selected={dungeon.id}>
        <img className="journey-destination-art" src={dungeon.art} alt={`${dungeon.name} 원화`}/>
        <div><small>{node.cleared ? '정복한 지역 · 다시 도전' : node.unlocked ? '다음 모험' : '해금할 다음 지역'}</small><h3>{dungeon.name}</h3>
          <p>원정 Lv.{dungeon.minLevel} · 에너지 {dungeon.energy}</p>
          <div className="journey-rewards"><span><img src={resourceArt('gold')} alt=""/>+{dungeon.rewards.gold}</span><span><img src={resourceArt('xp')} alt=""/>EXP +{dungeon.rewards.xp}</span></div>
          <button type="button" id="journey-prepare" onClick={prepare}>{node.unlocked ? '출격 준비' : '해금 조건 보기'} <span>→</span></button>
          <p className="journey-destination-note">{node.reason || '승리하면 다음 던전이 이어집니다. 보상과 진행은 자동 저장됩니다.'}</p>
        </div>
      </article>
    </div>
  </section>;
}
