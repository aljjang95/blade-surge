import './starter-village-ui.css';
import * as THREE from 'three';
import { DUNGEONS } from '../data/expansion.js';
import { HEROES } from '../data/heroes.js';
import { HERO_TRAITS } from '../data/hero-traits.js';
import { STARTER_DUMMIES } from '../data/starter-village.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { regionDungeonState } from '../game/region-dungeon-gate.js';
import { audio } from '../engine/audio.js';
import { bindHeroPortrait } from './hero-portraits.js';
import { openRuneOverview } from './rune-socket.js';

// 초보자 마을(1지역 첫 마을) 상호작용 창: 안내자·훈련장·의뢰 게시판·대장장이·영웅 비석.
// 배치 데이터는 src/data/starter-village.js, 장면은 src/game/starter-village-scene.js 가 맡고, 이 파일은 눌렀을 때 일어나는 일만 잇는다.
// 창은 citadel-hub 의 기존 dialog 를 그대로 빌려 쓴다(showModal · ESC · 바깥 누르기 · 초점 복귀는 CitadelHubUI.close 가 맡는다).
// 열고 닫기는 게임 저장(eco.s)과 에너지를 바꾸지 않는다. 기기 편의 기록만 localStorage 키 하나에 남긴다(docs/starter-village.md).

export const STARTER_PROGRESS_KEY = 'blade-surge.starter-village.v1';
/** 허수아비를 이만큼 치면 '훈련장' 단계가 끝난다. */
export const PRACTICE_GOAL = 3;
const PRACTICE_MAX = 9999;

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * 초보자 마을 진행 기록 정규화. 모르는 필드·잘못된 값은 버리고 기본값으로 돌린다. 멱등이다.
 * @param {unknown} raw
 * @returns {{ practiced: number, boardSeen: boolean, smithVisited: boolean }}
 */
export function normalizeStarterProgress(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {any} */ (raw) : {};
  return {
    practiced: isCount(value.practiced) ? Math.min(PRACTICE_MAX, Math.floor(value.practiced)) : 0,
    boardSeen: value.boardSeen === true,
    smithVisited: value.smithVisited === true,
  };
}

/** 저장 공간이 막힌 브라우저(getter 예외)·손상 JSON 은 기본값. */
export function readStarterProgress(storage) {
  try {
    const raw = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STARTER_PROGRESS_KEY);
    return normalizeStarterProgress(raw ? JSON.parse(raw) : null);
  } catch { return normalizeStarterProgress(null); }
}

/** 마지막 쓰기가 실패했으면 이번 세션 사본을 계속 쓴다(차단된 브라우저에서 연습 수가 0으로 돌아가지 않게). */
export function refreshStarterProgress(session, lastWriteOk, storage) {
  if (session && lastWriteOk === false) return normalizeStarterProgress(session);
  try {
    const raw = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STARTER_PROGRESS_KEY);
    if (raw === null || raw === undefined) return normalizeStarterProgress(session ?? null);
    return normalizeStarterProgress(JSON.parse(raw));
  } catch { return normalizeStarterProgress(session ?? null); }
}

export function writeStarterProgress(progress, storage) {
  try { (storage === undefined ? globalThis.localStorage : storage)?.setItem(STARTER_PROGRESS_KEY, JSON.stringify(normalizeStarterProgress(progress))); return true; } catch { return false; }
}

/** 관문 1-1 을 깼는가. 실제 저장(progress)에서만 읽는다. */
const stageOneCleared = (save) => ((save?.progress?.stars?.['1-1'] ?? 0) > 0) || ((save?.progress?.unlocked ?? 1) > 1);

/**
 * 안내자 단계 체크리스트. 아직 안 끝난 첫 단계가 next 다.
 * @param {{ practiced: number, boardSeen: boolean, smithVisited: boolean }} progress @param {any} save eco.s
 */
export function starterChecklist(progress, save) {
  const steps = [
    { id: 'training', label: `훈련장에서 허수아비 ${PRACTICE_GOAL}번 치기`, hint: '서쪽 울타리 훈련장에서 \'연습\'을 눌러 보세요.', done: progress.practiced >= PRACTICE_GOAL, detail: `${Math.min(progress.practiced, PRACTICE_GOAL)} / ${PRACTICE_GOAL}` },
    { id: 'board', label: '의뢰 게시판 보기', hint: '분수 왼쪽 위(북서쪽)의 게시판에 첫 의뢰가 붙어 있어요.', done: progress.boardSeen, detail: '' },
    { id: 'smith', label: '대장간 들르기', hint: '동쪽 대장간의 도르에게 말을 걸어 보세요.', done: progress.smithVisited, detail: '' },
    { id: 'sortie', label: '출격 포탈에서 관문 1-1 출격', hint: '북쪽 끝 출격 포탈에서 관문 1-1 을 고르세요.', done: stageOneCleared(save), detail: '' },
  ];
  const next = steps.find((step) => !step.done);
  return steps.map((step) => ({ ...step, next: step === next }));
}

/**
 * 첫 의뢰 카드. 완료 표시는 실제 저장 상태에서 읽는다.
 * 던전은 region-dungeon-gate.js 가 지금 마을에 세운 첫 관문 던전(보이는 던전)이다. 없으면 카드를 뺀다.
 */
export function starterBoardCards(progress, save) {
  /** @type {Array<{ id: string, title: string, body: string, done: boolean, action: string, actionLabel: string, progress: string, dungeonId?: string }>} */
  const cards = [{ id: 'stage-1-1', title: '관문 1-1 정화', body: '출격 포탈에서 첫 관문을 정화하세요.', done: stageOneCleared(save), action: 'stage', actionLabel: '관문 선택', progress: '' }];
  const dungeonId = regionDungeonState(save).gateIds[0];
  const def = DUNGEONS.find((dungeon) => dungeon.id === dungeonId);
  if (def) cards.push({ id: `dungeon:${def.id}`, title: `${def.name} 다녀오기`, body: def.description || '마을 북쪽 관문 던전에 다녀오세요.',
    done: (save?.expedition?.stats?.[def.id] ?? 0) > 0, action: 'dungeon', actionLabel: '입장 확인', progress: '', dungeonId: def.id });
  cards.push({ id: 'practice', title: `허수아비 ${PRACTICE_GOAL}번 치기`, body: '훈련장에서 기본기를 익혀요.', done: progress.practiced >= PRACTICE_GOAL, action: '', actionLabel: '', progress: `${Math.min(progress.practiced, PRACTICE_GOAL)} / ${PRACTICE_GOAL}` });
  return cards;
}

/** 영웅 비석 문구. 데이터의 기존 문구(HEROES.title · HERO_TRAITS)만 쓴다. */
export function starterStoneCopy(heroId) {
  const hero = HEROES[heroId], trait = HERO_TRAITS[heroId];
  if (!hero) return null;
  return { name: hero.name, title: hero.title || '', role: trait?.role || '', line: trait?.line || '', intro: trait?.intro || '' };
}

export class StarterVillageUI {
  /** @param {any} app @param {any} hub CitadelHubUI (dialog·close·openDestination 을 빌려 쓴다) */
  constructor(app, hub) {
    this.app = app; this.hub = hub;
    this.mem = null; this.writeOk = undefined; this.lastPractice = 0;
  }

  get progress() { return (this.mem = refreshStarterProgress(this.mem, this.writeOk)); }
  remember(patch) {
    const next = normalizeStarterProgress({ ...this.progress, ...patch });
    if (next.practiced === this.mem?.practiced && next.boardSeen === this.mem?.boardSeen && next.smithVisited === this.mem?.smithVisited) return next;
    this.mem = next; this.writeOk = writeStarterProgress(next); return next;
  }

  /** 눌렀을 때의 진입점. 처리했으면 true. */
  interact(spot, trigger) {
    switch (spot.kind) {
      case 'guide': return this.openGuide(spot, trigger);
      case 'board': return this.openBoard(spot, trigger);
      case 'smith': return this.openSmith(spot, trigger);
      case 'story': return this.openStone(spot, trigger);
      case 'training': return this.practice();
      default: return false;
    }
  }

  /** 출격 포탈: 관문 선택 화면(docs/stage-select.md). */
  openStageSelect(trigger) {
    const opened = this.app.commandUI?.openPreparation(trigger);
    return opened !== false;
  }

  /** 허수아비 한 번: 공격 동작 · 허수아비 흔들림 · 타격음. 창을 열지 않는다. */
  practice() {
    const app = this.app, show = app.showcase;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!show) return false;
    // 연타로 소리·동작이 겹치지 않게 짧게 쉰다. 쉬는 동안 누른 것은 세지 않는다.
    if (now - this.lastPractice < 380) return true;
    this.lastPractice = now;
    this.faceDummy(show);
    this.playAttack(show);
    app.arena?.lobbyHall?.userData?.starter?.strike(app.hubMovement?.position);
    audio.hit('slash', { light: true });
    const before = this.progress.practiced, after = this.remember({ practiced: before + 1 }).practiced;
    if (before < PRACTICE_GOAL && after >= PRACTICE_GOAL) app.ui?.toast('연습 완료! 실제 전투에서는 회피와 스킬도 써 보세요.');
    else if (after < PRACTICE_GOAL) app.ui?.toast(`허수아비 연습 ${after} / ${PRACTICE_GOAL}`);
    return true;
  }

  faceDummy(show) {
    const position = this.app.hubMovement?.position;
    if (!position || !show.root) return;
    let best = null, bestDistance = Infinity;
    for (const dummy of STARTER_DUMMIES) {
      const distance = Math.hypot(dummy.x - position.x, dummy.z - position.z);
      if (distance < bestDistance) { bestDistance = distance; best = dummy; }
    }
    if (best && bestDistance > .05) show.root.rotation.y = Math.atan2(best.x - position.x, best.z - position.z);
  }

  /** 영웅의 첫 콤보 공격 클립을 한 번 재생하고 끝나면 Idle 로 돌아온다. 감소된 움직임 설정이면 동작만 건너뛴다. */
  playAttack(show) {
    const app = this.app;
    if (!show.mixer || !show.clips || app.reducedMotion?.matches) return null;
    const name = [show.def?.combo?.[0]?.anim, ...Object.keys(show.clips).filter((key) => /Attack/i.test(key))].find((key) => key && show.clips[key]);
    if (!name) return null;
    const action = show.mixer.clipAction(show.clips[name]);
    const previous = show.gesture || app.hubMovement?.animation || (show.clips.Idle && show.mixer.clipAction(show.clips.Idle));
    action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).setEffectiveTimeScale(1);
    action.clampWhenFinished = false; action.play();
    if (previous && previous !== action) action.crossFadeFrom(previous, .08, false);
    show.gesture = action; show.t = 0;
    if (app.hubMovement) app.hubMovement.animation = action;
    const onDone = (event) => {
      if (event.action !== action) return;
      show.mixer.removeEventListener('finished', onDone);
      // 그 사이 걷기가 시작됐다면 걷기 클립이 이미 이어받았다(HubMovement._setMoving).
      if (show.gesture !== action || app.hubMovement?.moving || !show.clips.Idle) return;
      const idle = show.mixer.clipAction(show.clips.Idle);
      idle.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      idle.crossFadeFrom(action, .16, false);
      show.gesture = null;
      if (app.hubMovement) app.hubMovement.animation = idle;
    };
    show.mixer.addEventListener('finished', onDone);
    return action;
  }

  // ---- 창 ----

  /** hub 의 dialog 를 이 상호작용 창으로 연다. 이미 열려 있거나 입장 처리 중이면 열지 않는다. */
  show(spot, trigger, { eyebrow, title, description, body, actions = [], cardActions = [] }) {
    const hub = this.hub, dialog = hub.dialog;
    if (hub.opened || hub.busy || this.app.mode !== 'lobby' || this.app.stageStarting) return false;
    hub.trigger = trigger; hub.returnFocus = trigger?.isConnected ? trigger : document.activeElement;
    hub.dialogSpot = null; hub.opened = true;
    dialog.classList.add('starter-village-dialog'); dialog.dataset.starter = spot.kind;
    dialog.style.setProperty('--citadel-near-accent', spot.accent || '#d3c29c');
    dialog.innerHTML = `<div class="starter-dialog">
      <header class="starter-dialog-head"><div><small>${safe(eyebrow)}</small><h2 id="citadel-destination-title">${safe(title)}</h2><p id="citadel-destination-description">${safe(description)}</p></div>
        <button type="button" class="starter-dialog-x" aria-label="닫기">×</button></header>
      <div class="starter-dialog-body">${body}</div>
      <footer class="starter-dialog-foot"><button type="button" class="starter-dialog-back">돌아가기</button>${actions.map((action) =>
        `<button type="button" class="starter-dialog-action" data-starter-action="${safe(action.id)}"${action.disabled ? ' disabled' : ''}>${safe(action.label)}</button>`).join('')}</footer></div>`;
    dialog.querySelector('.starter-dialog-x').addEventListener('click', () => hub.close());
    dialog.querySelector('.starter-dialog-back').addEventListener('click', () => hub.close());
    for (const action of actions) dialog.querySelector(`[data-starter-action="${action.id}"]`)?.addEventListener('click', () => action.run());
    for (const button of dialog.querySelectorAll('[data-starter-card-action]')) {
      const card = cardActions.find((entry) => entry.id === button.dataset.starterCardAction);
      if (card) button.addEventListener('click', () => card.run());
    }
    dialog.showModal();
    (dialog.querySelector('[data-starter-action]:not([disabled])') || dialog.querySelector('.starter-dialog-back'))?.focus({ preventScroll: true });
    return true;
  }

  /** 창을 닫고 초점을 돌려준 뒤 다음 화면을 연다. */
  leave(next) {
    const trigger = this.hub.returnFocus;
    this.hub.close();
    next(trigger);
  }

  openGuide(spot, trigger) {
    const steps = starterChecklist(this.progress, this.app.eco.s);
    const next = steps.find((step) => step.next);
    const body = `<ol class="starter-steps" aria-label="첫 목표">${steps.map((step, index) => `<li data-done="${step.done}"${step.next ? ' aria-current="step"' : ''}>
      <span class="starter-step-mark" aria-hidden="true">${step.done ? '✓' : index + 1}</span><span class="starter-step-copy"><b>${safe(step.label)}${step.detail && !step.done ? ` <em>${safe(step.detail)}</em>` : ''}</b>${step.next ? `<small>${safe(step.hint)}</small>` : ''}</span>${step.next ? '<i>다음</i>' : ''}</li>`).join('')}</ol>`;
    return this.show(spot, trigger, { eyebrow: '초보자 마을', title: spot.label,
      description: next ? `처음 오셨군요! 순서대로 해 보면 금세 익숙해질 거예요. 다음은 '${next.label}' 입니다.` : '첫 목표를 모두 마쳤어요. 이제 마음 가는 곳으로 떠나 보세요!',
      body, actions: next?.id === 'sortie' ? [{ id: 'stage', label: '관문 선택', run: () => this.leave((from) => this.openStageSelect(from)) }] : [] });
  }

  openBoard(spot, trigger) {
    this.remember({ boardSeen: true });
    const cards = starterBoardCards(this.progress, this.app.eco.s);
    const cardActions = cards.filter((card) => card.action).map((card) => ({ id: card.id, label: card.actionLabel, run: () => this.leave((from) => {
      if (card.action === 'dungeon') this.hub.openDestination(citadelHotspot(`dungeon:${card.dungeonId}`), from);
      else this.openStageSelect(from);
    }) }));
    const body = `<ul class="starter-cards">${cards.map((card) => `<li data-done="${card.done}"><div><b>${safe(card.title)}</b><span>${safe(card.body)}</span></div>
      <em>${card.done ? '완료' : card.progress || '진행 전'}</em>${card.action && !card.done ? `<button type="button" data-starter-card-action="${safe(card.id)}">${safe(card.actionLabel)}</button>` : ''}</li>`).join('')}</ul>`;
    // 의뢰 버튼은 카드 안에만 둔다(푸터에는 '돌아가기'만).
    return this.show(spot, trigger, { eyebrow: '오늘의 의뢰', title: spot.label, description: '마을 사람들이 남긴 첫 의뢰예요. 하나씩 해결해 보세요.', body, cardActions });
  }

  openSmith(spot, trigger) {
    this.remember({ smithVisited: true });
    const body = `<p class="starter-tip">장비는 강화할수록 강해지지만 실패할 수도 있어요. 룬은 장비 소켓에 박아 가문 공명을 맞추면 효과가 더 커집니다.</p>`;
    return this.show(spot, trigger, { eyebrow: '대장간', title: spot.label, description: '"장비를 손보고 룬을 박고 싶다면 언제든 오게."', body, actions: [
      { id: 'enhance', label: '장비 강화', run: () => this.leave(() => this.app.meta?.openTab('heroes')) },
      { id: 'rune', label: '룬 소켓', run: () => this.leave(() => this.app.meta && openRuneOverview(this.app.meta, this.app.eco.s.selected)) },
    ] });
  }

  openStone(spot, trigger) {
    const heroId = this.app.eco.s.selected, copy = starterStoneCopy(heroId);
    if (!copy) return false;
    const body = `<div class="starter-stone"><img alt="" width="88" height="88"><div><b>${safe(copy.name)}${copy.title ? ` · ${safe(copy.title)}` : ''}</b>${copy.role ? `<span>${safe(copy.role)}${copy.line ? ` · ${safe(copy.line)}` : ''}</span>` : ''}${copy.intro ? `<p>${safe(copy.intro)}</p>` : ''}</div></div>`;
    const opened = this.show(spot, trigger, { eyebrow: '시작 영웅의 비석', title: copy.name, description: copy.title ? `${copy.title}의 이야기가 새겨져 있습니다.` : '이 마을에서 처음 검을 든 영웅의 이야기.', body });
    if (opened) bindHeroPortrait(this.hub.dialog.querySelector('.starter-stone img'), this.app, heroId);
    return opened;
  }
}
