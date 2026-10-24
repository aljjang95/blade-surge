import { audio } from '../engine/audio.js';
import { markEmergingGates } from '../data/citadel-hub.js';

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * 로비 마을 칩과 마을 선택, 새 지역 해금 축하.
 * 상태는 Economy(campaignTownState/setCampaignTown/markTownCelebrated)가 갖고, 장면 반영은 app.syncCampaignTown 이 한다.
 * 칩은 상단 바(프로필과 재화 사이)에 붙고 로비(던전) 탭에서만 보인다. 마을 목록은 칩 아래 가장자리 패널이다.
 */
export class CampaignTownUI {
  constructor(app) {
    this.app = app;
    this.chip = document.createElement('button');
    this.chip.type = 'button'; this.chip.id = 'campaign-town-chip'; this.chip.className = 'campaign-town-chip';
    this.chip.setAttribute('aria-haspopup', 'true'); this.chip.setAttribute('aria-expanded', 'false'); this.chip.setAttribute('aria-controls', 'campaign-town-menu');
    this.menu = document.createElement('div');
    this.menu.id = 'campaign-town-menu'; this.menu.className = 'campaign-town-menu'; this.menu.hidden = true; this.menu.setAttribute('role', 'group'); this.menu.setAttribute('aria-label', '마을 선택');
    const topbar = document.querySelector('#meta .topbar');
    topbar?.insertBefore(this.chip, topbar.querySelector('.currencies'));
    document.getElementById('meta')?.append(this.menu);
    this.chip.addEventListener('click', () => (this.menu.hidden ? this.open() : this.close()));
    this.outside = (event) => { if (!this.menu.hidden && !this.menu.contains(event.target) && !this.chip.contains(event.target)) this.close(false); };
    this.key = (event) => { if (event.key === 'Escape' && !this.menu.hidden) { event.stopPropagation(); this.close(); } };
    document.addEventListener('pointerdown', this.outside, true); document.addEventListener('keydown', this.key, true);
    this.unsubscribe = app.eco.onChange?.(() => this.render());
    this.render();
  }

  get eco() { return this.app.eco; }

  /** 로비(던전) 탭에서만 칩을 보인다. 다른 탭으로 가면 목록도 닫는다. */
  sync(tab = this.app.meta?.tab) {
    const visible = tab === 'home';
    this.chip.hidden = !visible;
    if (!visible) this.close(false);
    this.render();
  }

  render() {
    const state = this.eco.campaignTownState(), list = this.eco.campaignTownList(), now = list[state.current - 1];
    this.chip.dataset.chapter = String(state.current);
    this.chip.style.setProperty('--town-accent', now.accent);
    this.chip.innerHTML = `<small>REGION 0${now.chapter}</small><b>${esc(now.name)}</b><i aria-hidden="true">▾</i>`;
    this.chip.setAttribute('aria-label', `현재 마을 ${now.name}. 눌러서 해금한 마을로 이동`);
    this.menu.innerHTML = list.map((town) => `<button type="button" class="campaign-town-row${town.current ? ' on' : ''}${town.unlocked ? '' : ' lock'}" data-town="${town.chapter}" role="menuitemradio" aria-checked="${town.current}" ${town.unlocked ? '' : 'aria-disabled="true"'} style="--town-accent:${town.accent}">
      <span class="campaign-town-mark" aria-hidden="true">${town.chapter}</span><span class="campaign-town-copy"><b>${esc(town.name)}</b><small>${town.unlocked ? esc(town.mood) : esc(town.unlockHint)}</small></span><em>${town.current ? '현재' : town.unlocked ? '이동' : '잠김'}</em></button>`).join('');
    this.menu.querySelectorAll('[data-town]').forEach((button) => button.addEventListener('click', () => this.choose(+button.dataset.town)));
  }

  open() {
    this.render(); this.menu.hidden = false; this.chip.setAttribute('aria-expanded', 'true');
    audio.play('ui_select', { vol: 0.35 });
    (this.menu.querySelector('.campaign-town-row.on') || this.menu.querySelector('.campaign-town-row'))?.focus({ preventScroll: true });
  }

  close(restoreFocus = true) {
    if (this.menu.hidden) return;
    this.menu.hidden = true; this.chip.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.chip.focus({ preventScroll: true });
  }

  choose(chapter) {
    const town = this.eco.campaignTownList()[chapter - 1];
    if (!town?.unlocked) { this.app.ui?.toast(`${town?.unlockHint || '아직 열리지 않은 마을입니다.'}`, 'red'); audio.play('ui_error', { vol: 0.3 }); return false; }
    const changed = chapter !== this.eco.campaignTownState().current;
    if (!this.eco.setCampaignTown(chapter)) { this.app.ui?.toast('마을을 바꾸지 못했습니다. 저장 공간을 확인해 주세요.', 'red'); return false; }
    this.close();
    if (changed) { this.app.syncCampaignTown(); this.app.ui?.toast(`마을 이동 · ${town.name}`, 'gold'); }
    this.render();
    return true;
  }

  /**
   * 새 지역 해금 축하. 화면 위쪽 가장자리 띠로 보여 전투·결과 화면을 가리지 않는다.
   * 보여 준 뒤 한 번만 저장하므로 같은 해금을 다시 축하하지 않는다.
   */
  celebrate(unlock, { markSeen = true, fromLobby = false } = {}) {
    if (!unlock) return false;
    document.querySelector('.region-unlock-banner')?.remove();
    const node = document.createElement('div');
    node.className = 'region-unlock-banner'; node.setAttribute('role', 'status'); node.style.setProperty('--town-accent', unlock.accent || '#ffd27a');
    node.innerHTML = `<span aria-hidden="true">★</span><b>새 지역 해금 · ${esc(unlock.name)}</b><small>로비로 돌아가면 새 마을로 이동합니다</small>`;
    document.body.append(node);
    audio.play('jingle_win1', { vol: 0.55 });
    setTimeout(() => node.remove(), 4800);
    if (markSeen) this.eco.markTownCelebrated(unlock.chapter);
    // 로비로 돌아갈 때 한 번 '새 마을 도착' 연출을 보인다(세션 상태, 저장 아님).
    this.pendingArrival = unlock;
    if (this.app.mode === 'lobby') this.arrive(unlock, { raise: fromLobby });
    return true;
  }

  /**
   * 새 마을 도착 연출. 짧은 이동 전환(가장자리에서 걷히는 마을 색 장막, 입력을 막지 않음)과 위쪽 가장자리 띠.
   * 새 던전 관문은 광장 장면이 땅에서 솟아오르게 그린다(citadel-hub-scene emerging). 플레이 영역에 창을 띄우지 않는다.
   */
  arrive(unlock = this.pendingArrival, { raise = false } = {}) {
    if (!unlock) return false;
    this.pendingArrival = null;
    // 결과 화면을 거치지 않고 로비에서 처음 알게 된 해금(앱이 결과 전에 닫힌 경우)은 이미 지어진 광장을 한 번 다시 지어 새 관문을 솟아오르게 한다.
    if (raise && this.app.arena?.lobbyHall && this.eco.campaignTownState().current === unlock.chapter) {
      try {
        const state = this.app.expedition?.regionDungeons?.();
        const fresh = (state?.gateIds || []).filter((id) => state.byId[id]?.region === unlock.chapter);
        if (fresh.length) { markEmergingGates(fresh); this.app.arena.buildLobby(); }
      } catch (error) { console.warn('town arrival rebuild failed', error); }
    }
    const opened = (() => { try { return this.app.expedition?.regionDungeons?.().entries.filter((entry) => entry.region === unlock.chapter && entry.open).length || 0; } catch { return 0; } })();
    document.querySelector('.town-arrival-veil')?.remove(); document.querySelector('.town-arrival-banner')?.remove(); document.querySelector('.region-unlock-banner:not([data-qa-held])')?.remove();
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      const veil = document.createElement('div');
      veil.className = 'town-arrival-veil'; veil.setAttribute('aria-hidden', 'true'); veil.style.setProperty('--town-accent', unlock.accent || '#ffd27a');
      document.body.append(veil); setTimeout(() => veil.remove(), 1400);
    }
    const node = document.createElement('div');
    node.className = 'town-arrival-banner'; node.setAttribute('role', 'status'); node.style.setProperty('--town-accent', unlock.accent || '#ffd27a');
    node.dataset.chapter = String(unlock.chapter);
    node.innerHTML = `<small>REGION 0${unlock.chapter} · 새 마을 도착</small><b>${esc(unlock.name)}</b>${opened ? `<em>새 던전 ${opened}곳이 열렸습니다</em>` : ''}`;
    document.body.append(node);
    audio.play('ui_glass', { vol: 0.45 });
    setTimeout(() => node.remove(), 5200);
    return true;
  }

  /** 로비로 돌아왔는데 아직 축하하지 못한 해금이 있으면(결과 화면 전에 앱이 닫힌 경우) 한 번 알린다. */
  announcePending() {
    if (this.pendingArrival) return this.arrive();
    const state = this.eco.campaignTownState();
    if (state.celebrated >= state.latest) return false;
    const town = this.eco.campaignTownList()[state.latest - 1];
    return this.celebrate({ chapter: state.latest, name: town.name, accent: town.accent }, { fromLobby: true });
  }

  destroy() {
    document.removeEventListener('pointerdown', this.outside, true); document.removeEventListener('keydown', this.key, true);
    this.unsubscribe?.(); this.chip.remove(); this.menu.remove();
  }
}
