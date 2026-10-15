// 실제 사용자 여정 QA의 페이지 안 관측 함수. page.evaluate 로 직렬화되므로 각 함수는 바깥 변수를 쓰지 않는다.
// 관측 전용 경계:
//  · 게임 함수를 바꾸거나(monkeypatch) app.step 을 부르지 않는다. 시간·HP·경제·선택 영웅·적·위치를 쓰지 않는다.
//  · 쓰는 것은 window.__journeyObs(이 도구의 관측 기록)뿐이다. requestAnimationFrame 콜백 하나가 게임 루프 다음에
//    현재 상태를 읽어 기록한다. 적/화살 식별은 이 기록 안의 WeakMap 으로 한다.

/** 전투 관측기를 설치하거나(이미 있으면) 구간 이름만 바꾼다. */
export function installObserver(phase) {
  const w = window;
  if (w.__journeyObs) { w.__journeyObs.phase = phase; return { installed: false, phase }; }
  const ids = new WeakMap(); let next = 1;
  const idOf = (o) => { if (!o) return null; let v = ids.get(o); if (v === undefined) { v = next++; ids.set(o, v); } return v; };
  const seen = new WeakSet(), live = [], hp = new Map();
  const obs = { phase, idOf, frames: [], shots: [], ended: [], damage: [], transitions: [], counters: { frames: 0, heldFrames: 0, movingDrawFrames: 0, shots: 0 }, stopped: false, lastError: null };
  let lastState = null, lastPlayer = null, lastSampleWall = 0, lastDodgeClock = null, attackFromDodge = false;
  const camYaw = () => { const e = w.app?.renderer?.camera?.matrixWorld?.elements; return e ? Math.atan2(-e[2], e[0]) : null; };
  const tick = () => {
    if (obs.stopped) return;
    requestAnimationFrame(tick);
    try {
      const app = w.app, b = app?.battle, p = b?.player;
      if (!b || !p || app.mode !== 'battle') return;
      if (p !== lastPlayer) { lastPlayer = p; lastState = null; lastDodgeClock = null; attackFromDodge = false; }
      const wall = performance.now(), clock = b.elapsed;
      obs.counters.frames++;
      const joy = !!app.input?.joy?.active, md = p.moveDir || { x: 0, z: 0 };
      const speed = Math.hypot(p.vel?.x || 0, p.vel?.z || 0);
      if (p.state !== lastState) {
        obs.transitions.push({ wall, clock, from: lastState, to: p.state, auto: !!p.auto, phase: obs.phase });
        if (p.state === 'dodge') lastDodgeClock = clock;
        attackFromDodge = p.state === 'attack' && lastState === 'dodge';
        lastState = p.state;
      }
      if (p.state === 'attack' && p.bowStringHeld) { obs.counters.heldFrames++; if (joy && speed > 0.3 && !p.auto) obs.counters.movingDrawFrames++; }
      for (const e of b.enemies) {
        const id = idOf(e), prev = hp.get(id);
        if (prev !== undefined && e.hp < prev - 1e-6) obs.damage.push({ wall, clock, id, type: e.type, from: Math.round(prev), to: Math.round(e.hp), alive: !!e.alive, boss: !!e.isBoss, phase: obs.phase });
        hp.set(id, e.hp);
      }
      const fresh = [];
      for (const a of b.projectiles) if (a.owner === p && a.mesh?.userData?.arrowVisual && !seen.has(a)) { seen.add(a); fresh.push(a); live.push(a); }
      if (fresh.length) {
        const t = p.rangerAim?.target, c = p.current;
        obs.counters.shots++;
        obs.shots.push({ seq: obs.counters.shots, wall, clock, phase: obs.phase, auto: !!p.auto, state: p.state, skill: p.state === 'skill' || p.state === 'ult',
          comboIdx: p.comboIdx, expected: p.state === 'attack' && c?.projectile === 'arrow' ? (c.arrowCount || 1) : null, count: fresh.length,
          pos: [p.pos.x, p.pos.z], yaw: p.yaw, vel: [p.vel.x, p.vel.z], speed, move: [md.x, md.z], joy, camYaw: camYaw(),
          dirs: fresh.map((a) => [a.dir.x, a.dir.z]), origin: [fresh[0].pos.x, fresh[0].pos.y, fresh[0].pos.z], arrowIds: fresh.map(idOf),
          target: t ? { id: idOf(t), x: t.pos.x, z: t.pos.z, hp: Math.round(t.hp), alive: !!t.alive, type: t.type, r: t.radius } : null,
          lockTarget: idOf(p.lockTarget), attackFromDodge, sinceDodge: lastDodgeClock === null ? null : clock - lastDodgeClock, held: !!p.bowStringHeld });
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const a = live[i];
        if (b.projectiles.includes(a)) continue;
        live.splice(i, 1);
        obs.ended.push({ id: idOf(a), wall, clock, t: a.t, life: a.life, hits: [...a.hit].map(idOf), end: [a.pos.x, a.pos.z] });
      }
      if (wall - lastSampleWall >= 100) {
        lastSampleWall = wall;
        let alive = 0; for (const e of b.enemies) if (e.alive && !e.spawning) alive++;
        obs.frames.push({ wall, clock, rt: app.renderer?.time ?? null, x: p.pos.x, z: p.pos.z, yaw: p.yaw, state: p.state, auto: !!p.auto, joy, move: [md.x, md.z], speed,
          hp: Math.round(p.hp), maxHp: p.maxHp, alive: !!p.alive, paused: !!b.paused, active: !!b.active, enemies: alive, kills: b.kills, dmg: Math.round(b.dmgDealt || 0),
          held: !!p.bowStringHeld, target: idOf(p.rangerAim?.target), phase: obs.phase });
      }
    } catch (error) { obs.lastError = String(error?.message || error); }
  };
  obs.drain = () => ({ frames: obs.frames.splice(0), shots: obs.shots.splice(0), ended: obs.ended.splice(0), damage: obs.damage.splice(0),
    transitions: obs.transitions.splice(0), counters: { ...obs.counters }, lastError: obs.lastError });
  w.__journeyObs = obs;
  requestAnimationFrame(tick);
  return { installed: true, phase };
}

/** 관측 구간 이름 바꾸기(관측 기록만 바꾼다). */
export function setObserverPhase(phase) { if (window.__journeyObs) window.__journeyObs.phase = phase; return !!window.__journeyObs; }

/** 누적 관측을 꺼낸다(관측 기록 배열만 비운다). */
export function drainObserver() { return window.__journeyObs ? window.__journeyObs.drain() : null; }

/** 제어 판단용 전투 상태 스냅샷(읽기 전용). */
export function readBattle() {
  const app = window.app, b = app?.battle, p = b?.player, obs = window.__journeyObs;
  const id = (o) => (obs?.idOf ? obs.idOf(o) : null);
  const e = app?.renderer?.camera?.matrixWorld?.elements;
  const modal = document.querySelector('#modal.show');
  const world = b?.world;
  const shown = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  return {
    wall: performance.now(), mode: app?.mode, active: !!b?.active, paused: !!b?.paused, pauseReasons: b?.pauseReasons ? [...b.pauseReasons] : [],
    stageStarting: !!app?.stageStarting, clock: b?.elapsed ?? null, camYaw: e ? Math.atan2(-e[2], e[0]) : 0,
    player: p ? { hero: p.def?.id, x: p.pos.x, z: p.pos.z, yaw: p.yaw, state: p.state, alive: !!p.alive, hp: p.hp, maxHp: p.maxHp, auto: !!p.auto, dodgeCd: p.dodgeCd || 0, r: p.radius || 0.55 } : null,
    enemies: (b?.enemies || []).filter((x) => x.alive).map((x) => ({ id: id(x), x: x.pos.x, z: x.pos.z, hp: Math.round(x.hp), maxHp: x.maxHp, spawning: !!x.spawning, boss: !!x.isBoss, elite: !!x.isElite, r: x.radius || 0.7, type: x.type, invuln: (x.invuln || 0) > 0 })),
    rooms: world?.rooms ? world.rooms.map((r) => ({ id: r.id, x: r.x, z: r.z, w: r.w, h: r.h, type: r.type, cleared: !!r.cleared, discovered: !!r.discovered, spawned: !!r.spawned, attunementPending: !!r.attunementPending })) : [],
    bossRoomId: world?.bossRoom?.id ?? null, sealed: !!world?.sealed, worldKey: world ? world.cols + 'x' + world.rows + '@' + world.minX + ',' + world.minZ : null,
    portal: b?.portal?.pos ? { x: b.portal.pos.x, z: b.portal.pos.z } : null,
    kills: b?.kills ?? 0, dmg: Math.round(b?.dmgDealt || 0),
    input: { enabled: !!app?.input?.enabled, joy: !!app?.input?.joy?.active },
    modal: modal ? { head: (modal.querySelector('h2')?.textContent || modal.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), buttons: [...modal.querySelectorAll('button')].map((x) => x.id || String(x.className)).slice(0, 8) } : null,
    cinematic: !!document.querySelector('.exp-cinematic'),
    result: app?.expeditionUI?.result ? { win: !!app.expeditionUI.result.win, saveError: app.expeditionUI.result.saveError || null } : null,
    resultVisible: shown('.exp-result-shell'), pausePanel: shown('#btn-resume'),
    potions: [...document.querySelectorAll('.exp-potions [data-potion]')].map((x) => ({ id: x.dataset.potion, n: Number(x.querySelector('b')?.textContent || 0), disabled: !!x.disabled })),
    autoButtonOn: !!document.querySelector('#btn-auto')?.classList.contains('on'),
  };
}

/** 보행 마스크 사본(문자열). 경로 계산은 Node 쪽 사본에서 한다. */
export function readGrid() {
  const w = window.app?.battle?.world;
  if (!w?.inner || !w.mask) return null;
  let inner = '', mask = '';
  for (let i = 0; i < w.inner.length; i++) inner += w.inner[i] ? '1' : '0';
  for (let i = 0; i < w.mask.length; i++) mask += w.mask[i] ? '1' : '0';
  return { cols: w.cols, rows: w.rows, minX: w.minX, minZ: w.minZ, bounds: w.bounds ? { ...w.bounds } : null, sealed: !!w.sealed, inner, mask };
}

/** 로비·준비창 상태(읽기 전용). */
export function readLobby() {
  const app = window.app, d = document.querySelector('.citadel-hub-dialog[open]');
  const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
  return {
    mode: app?.mode, tab: app?.meta?.tab, selected: app?.eco?.s?.selected, heroSel: app?.meta?.heroSel ?? null,
    energy: app?.eco?.s?.energy, energyT: app?.eco?.s?.energyT, energyMax: app?.eco?.energyMax ?? null, stageStarting: !!app?.stageStarting,
    prep: d ? { title: txt(d.querySelector('#citadel-destination-title')), cost: txt(d.querySelector('[data-citadel-cost]')), energyLabel: txt(d.querySelector('[data-citadel-energy]')), go: txt(d.querySelector('.citadel-hub-go')), goDisabled: !!d.querySelector('.citadel-hub-go')?.disabled } : null,
    battle: { active: !!app?.battle?.active, auto: app?.battle?.player ? !!app.battle.player.auto : null, hero: app?.battle?.player?.def?.id || null },
    journeyAuto: app?.journey?.s?.autoBattle ?? null, modal: !!document.querySelector('#modal.show'), cinematic: !!document.querySelector('.exp-cinematic'),
    result: app?.expeditionUI?.result ? { win: !!app.expeditionUI.result.win, saveError: app.expeditionUI.result.saveError || null } : null,
  };
}

/** 요소(ElementHandle.evaluate)의 중심이 실제로 눌리는지(가림·숨김·비활성) 확인한다. 강제 클릭 대신 이 결과로만 입력한다. */
export function probeNode(el) {
  if (!el || !el.isConnected) return { exists: false, visible: false };
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  const visible = r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !el.closest('[hidden]') && !el.closest('[inert]') && !el.closest('dialog:not([open])');
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const inView = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
  const hitEl = inView ? document.elementFromPoint(x, y) : null;
  return { exists: true, visible, inView, x, y, w: r.width, h: r.height, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    hit: !!hitEl && (hitEl === el || el.contains(hitEl)), hitDesc: hitEl ? (hitEl.id ? '#' + hitEl.id : hitEl.tagName.toLowerCase() + '.' + String(hitEl.className).split(' ')[0]) : null,
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) };
}

/** 요소를 담은 스크롤 영역 정보(실제 터치 스와이프 방향을 고르는 데만 쓴다). */
export function scrollerOf(el) {
  if (!el) return null;
  let s = el.parentElement;
  while (s && s !== document.body) { const cs = getComputedStyle(s); if ((/(auto|scroll)/.test(cs.overflowX) && s.scrollWidth > s.clientWidth + 2) || (/(auto|scroll)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight + 2)) break; s = s.parentElement; }
  if (!s || s === document.body) return null;
  const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
  return { x: r.x, y: r.y, w: r.width, h: r.height, horizontal: /(auto|scroll)/.test(cs.overflowX) && s.scrollWidth > s.clientWidth + 2, scrollLeft: s.scrollLeft, scrollTop: s.scrollTop, tag: s.id ? '#' + s.id : s.tagName.toLowerCase() + '.' + String(s.className).split(' ')[0] };
}

/** 아이템 그림의 실제 DOM 속성(src, data-*)을 그대로 읽는다. 새 정체성 속성이 생겨도 같이 기록된다. */
export function readImages(selector) {
  return [...document.querySelectorAll(selector)].map((img) => {
    const host = img.closest('[data-uid], [data-inv], [data-slot], article, .is-head-art') || img.parentElement;
    return { src: img.getAttribute('src'), currentSrc: img.currentSrc || null, data: { ...img.dataset }, alt: img.getAttribute('alt'), complete: img.complete, naturalWidth: img.naturalWidth,
      host: host ? { tag: host.tagName.toLowerCase(), cls: String(host.className).slice(0, 80), data: { ...host.dataset }, label: host.getAttribute('aria-label') || host.getAttribute('title') || null, text: (host.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) } : null };
  });
}

/** 착용 모습(R3F) 준비 상태(읽기 전용). */
export function readWardrobe() {
  const canvas = document.querySelector('#hero-wardrobe canvas'), r = canvas?.getBoundingClientRect();
  const imgs = [...document.querySelectorAll('#tab-heroes img')].filter((img) => img.getBoundingClientRect().width > 0);
  return { instance: !!window.app?.wardrobe?.instance, canvas: r ? [Math.round(r.width), Math.round(r.height)] : null, loadingText: document.querySelector('#hero-wardrobe .wardrobe-loading')?.textContent || null,
    caption: (document.querySelector('#hero-wardrobe .wardrobe-caption')?.textContent || '').trim(), images: imgs.length, imagesReady: imgs.every((img) => img.complete && img.naturalWidth > 0) };
}

/** 실제 렌더러 GPU 문자열(관측). 새 WebGL 컨텍스트를 만들지 않고 게임 컨텍스트의 디버그 확장만 읽는다. */
export function readGpu() {
  try {
    const gl = window.app?.renderer?.r?.getContext?.();
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext };
  } catch (error) { return { error: String(error?.message || error) }; }
}

/** 교정 궁수 리그의 런타임 존재(읽기 전용: 이름 탐색과 속성 읽기만). */
export function readRangerRig() {
  const p = window.app?.battle?.player;
  if (!p) return null;
  const m = p.model, names = ['RangerBowGrip_L', 'RangerDrawNock_R', 'Bow_String_Upper', 'Bow_String_Lower'];
  return { hero: p.def?.id, weapon: p.def?.weapon, ranged: !!p.def?.ranged, sockets: Object.fromEntries(names.map((n) => [n, !!m?.getObjectByName?.(n)])), upperClip: !!p.clips?.RangerBowUpper,
    rangerAim: !!p.rangerAim, bowLayers: !!p.bowLayers, manualBow: !!p.manualBow, auto: !!p.auto, combo: (p.def?.combo || []).map((c) => ({ projectile: c.projectile || null, arrowCount: c.arrowCount || 1, range: c.range })) };
}
