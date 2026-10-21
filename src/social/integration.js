// 블레이드 서지 ↔ tll-social 연결. 커뮤니티는 부가 기능이라 어떤 실패도 게임·보상을 막지 않는다.
import { createSocialClient } from '../../packages/tll-social/src/client/index.js';
import { createCommunityUI } from '../../packages/tll-social/src/ui/index.js';
import { icon } from '../../packages/tll-social/src/ui/icons.js';
import { resolveControlsTop } from '../../packages/tll-social/src/ui/layout.js';
import { ALL_DUNGEONS } from '../data/expansion.js';
import { HEROES } from '../data/heroes.js';
import { STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { buildIdentity } from '../platform/startup-compat.js';
import { SOCIAL_CONFIG } from './config.js';
import { googleSignIn } from './google-signin.js';

const START_DELAY_MS = 2500;
const WATCH_MS = 500;
const STYLE = `
#community-open{position:relative}
#community-open.tls-launch-off{opacity:.6}
#community-open .tls-launch-count{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--red);color:#fff;font-size:10px;font-weight:900;line-height:16px;text-align:center;box-shadow:0 0 6px var(--red)}
#community-open .tls-launch-count[hidden]{display:none}
#community-open svg{width:24px;height:24px;color:#9cc8ff}
.tls-nav-dot{position:absolute;top:8px;right:calc(50% - 30px);width:9px;height:9px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red);pointer-events:none}
.tls-nav-dot[hidden]{display:none}
`;
const BUILD_ID = buildIdentity(import.meta.url);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const quiet = fn => { try { return fn(); } catch (error) { if (typeof console !== 'undefined') console.warn('[social]', error && error.message); return undefined; } };

/** 화면에 실제로 보이는 요소의 영역. display:none·visibility:hidden이거나 크기가 0이면 null. */
function visibleRect(el) {
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  return rect;
}
/** 전투 중 띠·배지가 피해야 할 기존 HUD 버튼(시점·일시정지·AUTO 등)의 영역. */
const HUD_BUTTONS = '#hud button, #lobby-camera-toggle, #lobby-camera-pad > span';

/** 영웅 정보가 없는 기존 공개 신원에만 id 해시 초상을 쓴다. */
function portraitPool() {
  return Object.values(HEROES).filter(hero => hero && typeof hero.portrait === 'string');
}

/** 게임의 선택 영웅을 프로필 생성·변경과 초상 조회에 연결한다. */
export function bindCommunityHero(client, selectedHero) {
  const pool = portraitPool();
  const originalProfile = client.profile;
  const profile = (name, hero = selectedHero()) => originalProfile.call(client, name, hero);
  client.profile = profile;
  let syncing = false, active = true, retryAt = 0;
  const sync = async () => {
    const me = client.state.me, hero = selectedHero();
    if (!active || syncing || !me || !Object.hasOwn(HEROES, hero) || me.hero === hero || Date.now() < retryAt) return;
    syncing = true;
    try {
      const result = await client.setHero(hero);
      if (!result.ok) retryAt = Date.now() + Math.max(5000, result.retryAfterMs || 0);
    } catch { retryAt = Date.now() + 5000; }
    finally {
      syncing = false;
      // 응답 대기 중 다시 고른 영웅도 직렬로 보낸다. 같은 영웅의 실패는 다음 감시 주기에서 재시도한다.
      if (active && selectedHero() !== hero) void sync();
    }
  };
  const offState = client.on('state', () => { void sync(); });
  return {
    portraitFor(mini) {
      if (!mini) return null;
      const hero = Object.hasOwn(HEROES, mini.hero) ? HEROES[mini.hero] : null;
      if (hero && hero.portrait) return hero.portrait;
      if (mini.id === client.state.me?.id) {
        const selected = selectedHero();
        const ownHero = Object.hasOwn(HEROES, selected) ? HEROES[selected] : null;
        if (ownHero && ownHero.portrait) return ownHero.portrait;
      }
      if (!pool.length) return null;
      let h = 0;
      for (const ch of String(mini.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return pool[h % pool.length].portrait;
    },
    sync,
    destroy() {
      active = false;
      offState();
      if (client.profile === profile) client.profile = originalProfile;
    },
  };
}

/** 앱 시작 때 한 번 호출한다. 실패해도 게임은 그대로 돈다. */
export function setupCommunity(app) {
  if (app.social) return app.social;
  return quiet(() => build(app)) || null;
}

function build(app) {
  const config = SOCIAL_CONFIG;
  const contentIds = new Set(config.contents.map(c => c.id));
  const client = createSocialClient({ gameId: config.gameId, presence: { state: 'lobby' } });
  const heroProfile = bindCommunityHero(client, () => app.eco.s.selected);

  // ── 대략 fps: 프레임 간격의 이동 평균(보이는 동안만) ──
  let fps = 0, lastFrame = 0, sampling = true;
  const sample = now => {
    if (!sampling) return;
    if (lastFrame && !document.hidden) {
      const dt = now - lastFrame;
      if (dt > 0 && dt < 500) fps = fps ? fps * 0.95 + (1000 / dt) * 0.05 : 1000 / dt;
    }
    lastFrame = document.hidden ? 0 : now;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  const partyCode = () => {
    const p = app.party && app.party.party;
    return p && p.status !== 'closed' && /^[A-F0-9]{20}$/.test(p.code || '') ? p.code : null;
  };
  const inBattle = () => app.mode === 'battle' || !!(app.party && app.party.run);

  const hooks = {
    portraitFor: heroProfile.portraitFor,
    contentArt(id) { const d = ALL_DUNGEONS.find(item => item.id === id); return d && d.art ? d.art : null; },
    joinParty(code) {
      if (!app.party || app.party.run || app.mode !== 'lobby') return false;
      app.party.view.open();
      app.party.join(code);
      return true;
    },
    currentPartyCode: partyCode,
    currentPartyInfo() {
      const p = app.party && app.party.party;
      return p ? { members: Array.isArray(p.members) ? p.members.length : 1, slots: 4 } : null;
    },
    canRecruit() { return !!(app.party && app.party.isHost && app.party.party && app.party.party.status === 'lobby'); },
    openParty() { ui.close(); app.party && app.party.view.open(); },
    // 게임 팝업(출석 보상 등)이 떠 있을 때는 열지 않는다. 메뉴 창(#oath-menu)은 버튼을 누르는 순간 이미 닫힌다.
    canOpenPanel() { return app.mode === 'lobby' && !app.stageStarting && !inBattle() && !app.contextLost && !document.querySelector('dialog[open]:not(#oath-menu), #modal.show'); },
    diagnostics() {
      return {
        version: BUILD_ID,
        ua: String(navigator.userAgent || '').slice(0, 200),
        screen: window.innerWidth + 'x' + window.innerHeight + ' @' + (Math.round((window.devicePixelRatio || 1) * 100) / 100),
        scene: app.mode + (app.battle && app.battle.stage ? ' · ' + (app.battle.stage.code || '') : ''),
        fps: Math.round(fps),
      };
    },
    hudBottom() {
      const el = document.querySelector('#hud .hud-player');
      return el ? Math.ceil(el.getBoundingClientRect().bottom) : null;
    },
    controlsTop() {
      // #joy는 화면 왼쪽 절반을 덮는 투명 터치 영역이라 쓰지 않고, 눈에 보이는 조이스틱 원과 조작 버튼 묶음만 쓴다.
      const tops = ['#hud .actions', '#hud .joy-base'].map(sel => visibleRect(document.querySelector(sel))).filter(Boolean).map(rect => rect.top);
      return resolveControlsTop({ tops, hudBottom: hooks.hudBottom(), height: window.innerHeight });
    },
    hudObstacles() {
      return [...document.querySelectorAll(HUD_BUTTONS)].map(visibleRect).filter(Boolean)
        .map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }));
    },
    // 구글 로그인: 클라이언트 ID는 google-signin.js가 가진다(서버 GOOGLE_CLIENT_IDS와 같은 값).
    googleSignIn,
    discordInvite: typeof config.discordInvite === 'string' ? config.discordInvite : null,
  };

  const ui = createCommunityUI({ client, config, mount: document.body, hooks });

  // ── 로비 버튼 + 미확인 배지 ───────────────────────
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'community-open';
  launcher.className = 'sq-btn';
  launcher.setAttribute('aria-label', '커뮤니티');
  const count = document.createElement('span');
  count.className = 'tls-launch-count';
  count.hidden = true;
  const label = document.createElement('span');
  label.textContent = '커뮤니티';
  launcher.append(icon('chat', 24), label, count);
  launcher.addEventListener('click', () => {
    if (!hooks.canOpenPanel()) return;
    ui.toggle('chat');
  });
  // 파티 버튼(#party-open) 뒤에 붙는다. 기본 로비의 메뉴 정리(OathShell)가 이 버튼도 메뉴 묶음으로 옮긴다.
  const lobbyLeft = document.querySelector('.lobby-left');
  if (lobbyLeft) lobbyLeft.append(launcher);

  let navDot = null;
  const updateBadge = total => {
    count.hidden = total <= 0;
    count.textContent = total > 99 ? '99+' : String(total);
    const trigger = document.querySelector('#meta .oath-nav-menu');
    if (trigger) {
      if (!navDot || !navDot.isConnected) { navDot = document.createElement('em'); navDot.className = 'tls-nav-dot'; navDot.setAttribute('aria-hidden', 'true'); trigger.append(navDot); }
      navDot.hidden = total <= 0;
    }
    launcher.setAttribute('aria-label', total > 0 ? '커뮤니티, 확인할 소식 ' + total + '개' : '커뮤니티');
  };
  ui.on('badge', updateBadge);
  ui.on('phase', ({ phase }) => {
    const off = phase === 'offline';
    launcher.classList.toggle('tls-launch-off', off);
    launcher.title = off ? '오프라인' : '';
  });

  // ── 장면·파티·접속 상태 감시(게임 루프를 건드리지 않는다) ──
  let lastScene = '', lastWhere = '', lastParty = null;
  const watch = () => {
    if (document.hidden) return;
    void heroProfile.sync();
    const battle = inBattle();
    if (ui.battle !== battle) ui.setBattle(battle);
    // 출격 컷신(.exp-cinematic)이 떠 있는 동안은 띠·배지를 보류하고, 끝나면 다시 보인다.
    ui.setHold(!!document.querySelector('.exp-cinematic'));
    const code = partyCode();
    if (code !== lastParty) {
      lastParty = code;
      if (code) client.joinParty(code); else client.leaveParty();
    }
    const stage = app.battle && app.battle.stage;
    const where = battle ? String((stage && (stage.title || stage.name)) || '') : (code ? '파티 대기' : '');
    const scene = battle ? (app.party && app.party.run ? 'party' : 'battle') : (code ? 'party' : 'lobby');
    if (scene !== lastScene || where !== lastWhere) {
      lastScene = scene; lastWhere = where;
      client.setPresence(where ? { state: scene, where } : { state: scene });
    }
  };
  const timer = setInterval(() => quiet(watch), WATCH_MS);
  const startTimer = setTimeout(() => quiet(() => ui.start()), START_DELAY_MS);

  // ── 런 기록: 출격(begin)·승리 정산(settle)에 붙는다. 반환값과 보상은 그대로 둔다. ──
  const announce = result => {
    if (!result || !result.ok || !result.data) return;
    const d = result.data;
    const parts = [];
    if (d.firstClear && d.rank > 0) parts.push('서버 ' + d.rank + '번째 정복!');
    for (const title of Array.isArray(d.newTitles) ? d.newTitles : []) parts.push('칭호 획득: ' + escapeHtml(title && title.label));
    if (parts.length) quiet(() => app.ui.toast('🏆 ' + parts.join(' · '), 'gold'));
  };
  const finishRun = starting => {
    Promise.resolve(starting)
      .then(started => (started && started.ok && started.data && started.data.runId ? client.runClear(started.data.runId) : null))
      .then(announce)
      .catch(() => {});
  };
  const startRun = (contentId, mode) => {
    if (!contentIds.has(contentId) || ui.phase !== 'ready') return null;
    return client.runStart(contentId, mode);
  };

  const eco = app.expedition;
  if (eco && !eco.__social) {
    eco.__social = true;
    const runs = new Map();
    const begin = eco.begin.bind(eco), settle = eco.settle.bind(eco), abandon = eco.abandon.bind(eco);
    eco.begin = (...args) => {
      const result = begin(...args);
      quiet(() => { if (result && result.ok && result.ticket && result.ticket.kind === 'dungeon') { const p = startRun(result.ticket.target, 'solo'); if (p) runs.set(result.ticket.id, p); } });
      return result;
    };
    eco.settle = (ticket, outcome) => {
      const result = settle(ticket, outcome);
      quiet(() => {
        if (!result || !result.ok || !ticket || !runs.has(ticket.id)) return;
        const starting = runs.get(ticket.id);
        runs.delete(ticket.id);
        if (outcome && outcome.win === true) finishRun(starting);
      });
      return result;
    };
    eco.abandon = (ticket, ...rest) => {
      const result = abandon(ticket, ...rest);
      quiet(() => { if (result && result.ok && ticket) runs.delete(ticket.id); });
      return result;
    };
  }

  // 파티 원정: 시작 때 런을 열고, 방장이 보낸 finish가 승리면 각자 기록한다.
  // (현재 파티 원정은 캠페인 스테이지라 config.contents에 없으면 기록 없이 지나간다.)
  const party = app.party;
  if (party && !party.__social) {
    party.__social = true;
    let partyRun = null;
    const begin = party.begin.bind(party), complete = party.complete.bind(party);
    party.begin = (run, members) => {
      quiet(() => {
        partyRun = null;
        const idx = run && run.stageIdx;
        if (!Number.isInteger(idx)) return;
        const def = stageDef(Math.ceil(idx / STAGES_PER_CHAPTER), ((idx - 1) % STAGES_PER_CHAPTER) + 1);
        partyRun = startRun(def && def.dungeon && def.dungeon.id, 'party');
      });
      return begin(run, members);
    };
    party.complete = (win, stats) => {
      quiet(() => { if (win && partyRun) finishRun(partyRun); partyRun = null; });
      return complete(win, stats);
    };
  }

  const social = {
    client, ui, config,
    open: tab => ui.open(tab),
    close: () => ui.close(),
    destroy() {
      clearInterval(timer); clearTimeout(startTimer); sampling = false;
      heroProfile.destroy();
      ui.destroy(); client.destroy(); launcher.remove(); style.remove();
    },
  };
  app.social = social;
  return social;
}
