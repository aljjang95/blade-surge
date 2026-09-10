import { HERO_LEVEL_CAP, masteryLabel } from '../game/rpg-core.js';

const number = value => Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ko-KR');
function node(tag, cls, text) {
  const el = document.createElement(tag); if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(text, run, cls = '') {
  const el = node('button', cls, text); el.type = 'button'; el.addEventListener('click', run); return el;
}
function statGrid(values) {
  const dl = node('dl', 'rpg-stats');
  for (const [key, value] of values) { const item = node('div'); item.append(node('dt', '', key), node('dd', '', value)); dl.append(item); }
  return dl;
}
function illustration(id,cls='rpg-illustration') { const image=node('img',cls);image.src=`/img/ui-crafted/${id}.webp`;image.alt='';image.setAttribute('aria-hidden','true');return image; }
function portraitOf(def,cls) {
  if(typeof def?.portrait!=='string'||!/^\/img\/[\w/.-]+\.(webp|png|jpg)$/.test(def.portrait))return null;
  const image=node('img',cls);image.src=def.portrait;image.alt=def.name;image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});return image;
}
function folded(label,text) {const section=node('details','rpg-notes');section.append(node('summary','',label),node('p','rpg-muted',text));return section;}

/** DOM-only view. Data is rendered as text; native dialog owns focus and Escape. */
export class RpgView {
  constructor(app, battle, catalogue, rules) {
    this.app = app; this.battle = battle; this.catalogue = catalogue; this.rules = rules;
    this.tab = 'bestiary'; this.selected = null; this.query = ''; this.rank = '';
    this.dialog = node('dialog', 'rpg-dialog'); this.dialog.id = 'rpg-codex';
    this.dialog.setAttribute('aria-labelledby', 'rpg-title');
    const head = node('header', 'rpg-heading'), title = node('h2', '', '원정 기록'); title.id = 'rpg-title';
    head.append(title, button('닫기', () => this.close(), 'rpg-close'));
    const tabs = node('nav', 'rpg-tabs'); tabs.setAttribute('aria-label', '원정 기록 메뉴');
    this.heroTab = button('영웅 능력치', () => this.setTab('hero'));
    this.monsterTab = button('몬스터 도감', () => this.setTab('bestiary'));
    this.heroTab.append(illustration('nav-heroes','rpg-tab-art'));this.monsterTab.append(illustration('nav-journal','rpg-tab-art'));
    tabs.append(this.heroTab, this.monsterTab);
    this.content = node('div', 'rpg-content');
    this.dialog.append(head, tabs, this.content); document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      this.battle.setPaused('rpg-codex', false);
      if (this.trigger?.isConnected) this.trigger.focus();
    });
    this.lobbyButton = button('도감 · 능력치', e => this.open(e.currentTarget), 'sq-btn rpg-open');
    document.querySelector('.lobby-left')?.append(this.lobbyButton);
    this.hudButton = button('도감', e => this.open(e.currentTarget), 'hud-btn');
    document.querySelector('.hud-right-top')?.prepend(this.hudButton);
    this.xp = node('div', 'rpg-xp'); this.xp.id = 'rpg-hud-xp';
    this.xpText = node('span'); this.xpBar = node('progress'); this.xpBar.max = 1;
    this.xpBar.setAttribute('aria-label', '다음 레벨까지의 경험치'); this.xp.append(this.xpText, this.xpBar);
    document.querySelector('.hud-bars')?.append(this.xp);
    this.target = node('div', 'rpg-target'); this.target.hidden = true;
    document.querySelector('.hud-center')?.append(this.target);
    this.announcement = node('div', 'rpg-announcement'); this.announcement.setAttribute('role', 'status');
    document.getElementById('hud')?.append(this.announcement);
    this.result = node('p', 'rpg-result'); this.result.hidden = true;
    document.querySelector('.result-stats')?.after(this.result);
    this.refresh();
  }
  open(trigger = null) {
    if (this.app.mode === 'boot' || this.app.stageStarting || this.dialog.open) return;
    this.trigger = trigger;
    this.battle.ensureRpg(); this.render();
    if (this.app.mode === 'battle' && this.battle.active) this.battle.setPaused('rpg-codex', true);
    try { this.dialog.showModal(); }
    catch (error) { this.battle.setPaused('rpg-codex', false); throw error; }
  }
  close() { if (this.dialog.open) this.dialog.close(); }
  setTab(tab) { this.tab = tab; this.render(); }
  render() {
    this.heroTab.setAttribute('aria-pressed', String(this.tab === 'hero'));
    this.monsterTab.setAttribute('aria-pressed', String(this.tab === 'bestiary'));
    this.content.replaceChildren();
    if (this.tab === 'hero') this.renderHero(); else this.renderBestiary();
  }
  heroData(withStats = true) {
    const id = this.app.mode === 'battle' && this.battle.heroId ? this.battle.heroId : this.app.eco.s.selected;
    const hero = this.app.eco.hero(id), def = this.rules.HEROES[id];
    return { id, hero, def, stats: withStats ? this.rules.heroStats(def, hero, this.app.eco.heroEquipBonus(id)) : null };
  }
  renderHero() {
    const { hero, def, stats } = this.heroData();
    const capped = hero.level >= HERO_LEVEL_CAP, need = this.rules.levelExp(hero.level);
    const box = node('section', 'rpg-hero');
    const cover=node('div','rpg-hero-cover'),portrait=portraitOf(def,'rpg-hero-portrait'),identity=node('div');
    if(portrait)cover.append(portrait);
    identity.append(node('h3','',`Lv.${hero.level} ${def.name}`),node('p','rpg-muted',capped?'최고 레벨':`EXP ${number(hero.exp)} / ${number(need)}`));cover.append(identity);box.append(cover);
    const growth=node('div','rpg-growth'),progress=node('progress');progress.max=1;progress.value=capped?1:Math.max(0,Math.min(1,hero.exp/need));progress.setAttribute('aria-label','다음 레벨까지의 경험치');
    growth.append(illustration('hero-xp'),progress,node('span','',capped?'MAX':`다음 레벨 ${number(Math.max(0,need-hero.exp))}`));box.append(growth);
    box.append(statGrid([['전투력', number(stats.power)], ['최대 체력', number(stats.hp)], ['공격력', number(stats.atk)],
      ['방어력', number(stats.def)], ['치명타 확률', `${Math.round(stats.crit * 100)}%`], ['치명타 피해', `${Math.round(stats.critDmg * 100)}%`],
      ['이동 속도', String(stats.spd)], ['승급', `${hero.star}성`]]));
    box.append(node('p','rpg-reference','장비 · 레벨 기준'),folded('능력치 · 경험치 기준','장착 장비와 레벨을 반영한 기본 능력치입니다. 전투 중 일시 강화 효과는 제외합니다. 몬스터 처치 경험치는 즉시 반영됩니다. 스테이지 완료 경험치는 별도 보상이며, 소환된 몬스터는 처치 경험치를 주지 않습니다.'));
    this.content.append(box);
  }
  renderBestiary() {
    const records = this.battle.ensureRpg().bestiary;
    const discovered = this.catalogue.filter(entry => records[entry.id]?.seen).length;
    const cover=node('div','rpg-book-cover');cover.append(illustration('nav-journal'),node('p','rpg-summary',`발견 ${discovered} / ${this.catalogue.length}`));this.content.append(cover);
    const filters = node('div', 'rpg-filters');
    this.search = node('input'); this.search.type = 'search'; this.search.placeholder = '발견한 몬스터 검색'; this.search.value = this.query;
    this.search.setAttribute('aria-label', '발견한 몬스터 이름 검색');
    const select = node('select'); select.setAttribute('aria-label', '몬스터 등급');
    for (const label of ['', '일반', '정예', '보스']) { const option = node('option', '', label || '모든 등급'); option.value = label; select.append(option); }
    select.value = this.rank;
    this.search.addEventListener('input', () => { this.query = this.search.value; this.renderList(); });
    select.addEventListener('change', () => { this.rank = select.value; this.renderList(); });
    filters.append(this.search, select); this.content.append(filters);
    const split = node('div', 'rpg-split'); this.list = node('div', 'rpg-list'); this.list.setAttribute('aria-label', '몬스터 목록');
    this.detail = node('section', 'rpg-detail'); this.detail.setAttribute('aria-label', '몬스터 상세');
    split.append(this.list, this.detail); this.content.append(split); this.renderList();
  }
  renderList() {
    const records = this.battle.ensureRpg().bestiary, q = this.query.trim().toLocaleLowerCase('ko-KR');
    const filtered = this.catalogue.filter(entry => (!this.rank || entry.rank === this.rank) &&
      (!q || (records[entry.id]?.seen && entry.def.name.toLocaleLowerCase('ko-KR').includes(q))));
    this.list.replaceChildren();
    if (!filtered.some(entry => entry.id === this.selected)) this.selected = filtered.find(entry => records[entry.id]?.seen)?.id || filtered[0]?.id || null;
    for (const entry of filtered) {
      const record = records[entry.id], found = !!record?.seen;
      const item = button('', () => { this.selected = entry.id; this.renderList(); this.detail.scrollIntoView?.({block:'nearest',behavior:'auto'}); }); item.dataset.monster = entry.id;
      item.setAttribute('aria-pressed', String(entry.id === this.selected));
      const portrait=found?portraitOf(entry.def,'rpg-list-portrait'):null;
      if(portrait)item.append(portrait);
      const label=node('div','rpg-list-label');label.append(node('span','rpg-rank',entry.rank),node('strong','',found?entry.def.name:'미발견'),node('small','',found?`${masteryLabel(record)} · ${number(record.kills)}회`:'기록 잠김'));item.append(label);
      this.list.append(item);
    }
    if (!filtered.length) this.list.append(node('p', 'rpg-empty', '조건에 맞는 발견 기록이 없습니다.'));
    this.renderDetail(filtered.find(entry => entry.id === this.selected), records);
  }
  renderDetail(entry, records) {
    this.detail.replaceChildren();
    if (!entry) { this.detail.append(node('p', 'rpg-empty', '다른 검색어나 등급을 선택하세요.')); return; }
    const record = records[entry.id];
    if (!record?.seen) { this.detail.append(illustration('nav-journal','rpg-locked-art'), node('h3', '', '미발견 몬스터'), node('p', 'rpg-muted', '조우하면 기록이 열립니다.')); return; }
    this.detail.append(node('p', 'rpg-eyebrow', `${entry.rank} · ${masteryLabel(record)}`), node('h3', '', entry.def.name),
      node('p', 'rpg-muted', `최고 조우 Lv.${record.highestLevel} · ${number(record.kills)}회 처치`));
    const portrait=portraitOf(entry.def,'rpg-portrait');if(portrait)this.detail.append(portrait);
    this.detail.append(node('p', 'rpg-reference', `${entry.reference} · Lv.${entry.level}`), statGrid([
      ['체력', number(entry.stats.hp)], ['공격력', number(entry.stats.atk)], ['피해 감소', `${Math.round(entry.stats.armor * 100)}%`],
      ['처치 EXP', number(entry.xp)], ['이동 속도', String(entry.stats.speed)], ['공격 거리', String(entry.stats.range)]
    ]));
    const places = [...new Set(entry.locations.map(location => location.chapter))];
    this.detail.append(node('h4', '', '출현 지역'), node('p', '', places.join(' · ') || '고정 출현 구역 없음'));
    const facts = [];
    if (entry.def.ranged) facts.push('원거리 공격');
    if (entry.def.behavior === 'shield') facts.push('정면 방패 방어와 가드 브레이크');
    if (entry.def.behavior === 'bomber') facts.push('접근 후 자폭');
    if (entry.def.behavior === 'shaman') facts.push('주변 아군 회복 및 소환');
    if (entry.def.tactic) facts.push(entry.def.tactic);
    const tactics=folded('전투 특징',facts.join(' · ')||'접근 공격과 공격 예고를 확인하세요.');tactics.append(illustration('posture-break','rpg-tactic-art'));
    this.detail.append(tactics,folded('기록 기준','능력치는 표시된 기준 구역의 값입니다. 진행 구역에 따라 달라지며, 도감 연구 단계 자체는 추가 보상을 지급하지 않습니다.'));
  }
  levelUp(level, count) {
    this.announcement.textContent = `LEVEL UP · Lv.${level}${count > 1 ? ` (+${count})` : ''}`;
    clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { this.announcement.textContent = ''; }, 2400);
    this.refresh();
  }
  refresh() {
    const { hero } = this.heroData(false), capped = hero.level >= HERO_LEVEL_CAP;
    const need = this.rules.levelExp(hero.level), ratio = capped ? 1 : Math.max(0, Math.min(1, hero.exp / need));
    const text = `Lv.${hero.level} · ${capped ? 'MAX' : `EXP ${number(hero.exp)} / ${number(need)}`}`;
    if (this.xpText.textContent !== text) { this.xpText.textContent = text; this.xpBar.value = ratio; }
    const battle = this.battle, candidate = battle.player?.lockTarget || battle.lastTarget;
    const visible = this.app.mode === 'battle' && candidate?.alive && !candidate.spawning && battle.player?.distTo(candidate) <= 14;
    this.target.hidden = !visible;
    if (visible) this.target.textContent = `Lv.${candidate.level || 1} ${candidate.def.name} · HP ${number(candidate.hp)} / ${number(candidate.maxHp)}`;
    this.result.hidden = !battle.result;
    if (battle.result) this.result.textContent = `처치 EXP +${number(battle.combatXp)} · 전투 중 이미 반영됨`;
    if (this.dialog.open && this.tab === 'hero' && this.heroSignature !== text) { this.heroSignature = text; this.content.replaceChildren(); this.renderHero(); }
  }
}
