import { HEROES } from '../data/heroes.js';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import './party.css';

const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
export class PartyView {
  constructor(session) {
    this.session = session;
    const open = node('button', 'sq-btn', '파티'); open.type = 'button'; open.id = 'party-open'; open.setAttribute('aria-label', '파티 던전');
    open.addEventListener('click', () => this.open()); document.querySelector('.lobby-left').append(open);
    this.dialog = node('dialog', 'party-dialog'); this.dialog.setAttribute('aria-label', '파티 던전');
    const head = node('header'); head.append(node('div', '', 'BLADE SURGE · 함께 걷는 원정'));
    const close = node('button', '', '닫기'); close.type = 'button'; close.onclick = () => { this.dialog.close(); if (this.session.finishing) this.session.leave(); }; head.append(close);
    this.dialog.append(head, node('h2', '', '함께, 던전 끝까지'));
    this.dialog.append(node('p', 'party-description', '친구에게 초대 링크를 보내고 2~4명이 같은 던전에서 함께 싸우세요.'));
    this.body = node('div'); this.dialog.append(this.body); document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => { if (this.session.run) event.preventDefault(); });
    this.notice = node('p', 'party-message'); this.notice.setAttribute('role', 'status'); this.dialog.append(this.notice);
    this.connectionNote = node('p', 'party-message'); this.connectionNote.setAttribute('role', 'status'); this.connectionNote.hidden = true; this.dialog.append(this.connectionNote);
    this.hud = node('div', 'party-hud'); this.hud.setAttribute('aria-label', '파티원 상태'); this.hud.hidden = true; document.body.append(this.hud);
    this.hpList = node('div', 'party-health-list'); this.battleNotice = node('div', 'party-presence');
    this.battleNotice.setAttribute('role', 'status'); this.battleNotice.hidden = true; this.hud.append(this.hpList, this.battleNotice);
    this.render();
  }
  open() { this.render(); if (!this.dialog.open) this.dialog.showModal(); }
  message(text) { this.notice.textContent = text; }
  button(text, action, parent = this.body) { const b = node('button', 'party-button', text); b.type = 'button'; b.onclick = action; parent.append(b); return b; }
  render() {
    const s = this.session, party = s.party; this.body.replaceChildren();
    if (!party) this.updatePresence({ kind: 'connected' });
    if (!party || party.status === 'closed') {
      const label = node('label', '', '모험가 이름'); const name = node('input'); name.maxLength = 20; name.value = s.name; name.setAttribute('aria-label', '모험가 이름'); label.append(name); this.body.append(label);
      const heroLabel = node('label', '', '함께할 영웅'); const hero = node('select'); hero.setAttribute('aria-label', '파티 영웅');
      for (const def of Object.values(HEROES)) { const option = node('option', '', def.name); option.value = def.id; hero.append(option); }
      hero.value = s.heroId; hero.onchange = () => { s.heroId = hero.value; }; heroLabel.append(hero); this.body.append(heroLabel);
      this.button('파티 만들기', () => { s.name = name.value; void s.create(); }).disabled = s.connecting;
      const join = node('label', '', '초대 코드'); const code = node('input'); code.placeholder = '친구의 초대 코드'; code.autocomplete = 'off'; code.spellcheck = false; code.value = s.inviteCode || ''; code.setAttribute('aria-label', '초대 코드'); join.append(code); this.body.append(join);
      this.button('파티 참가', () => { s.name = name.value; void s.join(code.value); }).disabled = s.connecting;
      this.body.append(node('p', 'party-fine', '선택한 영웅으로 참가합니다. 파티 원정은 Lv.20과 던전 능력치로 보정되며 에너지 소비가 없습니다. 캠페인 진행·개인 장비 보상은 별도로 유지됩니다.'));
      return;
    }
    const invite = node('div', 'party-invite'); const code = node('input'); code.value = party.code.match(/.{1,5}/g).join('-'); code.readOnly = true; code.setAttribute('aria-label', '파티 초대 코드'); invite.append(code);
    this.button('초대 링크 복사', async () => { try { await navigator.clipboard.writeText(s.inviteUrl()); this.message('초대 링크를 복사했습니다.'); } catch { code.value = s.inviteUrl(); code.select(); this.message('초대 링크를 선택했습니다. 복사해 친구에게 보내 주세요.'); } }, invite); this.body.append(invite);
    this.body.append(node('p', 'party-fine', '방장이 같은 세계를 진행합니다. 방장이 메뉴를 열면 일시 정지하며, 화면을 떠나 전투 정보가 멈추면 최대 60초 동안 기다립니다. 파티는 생성 후 45분 동안 유효합니다.'));
    const list = node('ul', 'party-members');
    for (const m of party.members) {
      const li = node('li'); const img = node('img'); img.src = HEROES[m.heroId].portrait; img.alt = '';
      li.append(img, node('strong', '', m.name + (m.id === party.hostId ? ' · 방장' : '')), node('span', '', HEROES[m.heroId].name), node('small', '', m.ready ? '준비 완료' : '준비 중')); list.append(li);
    }
    this.body.append(list);
    if (party.status === 'lobby') {
      const stageLabel = node('label', '', '함께 탐험할 던전'); const select = node('select'); select.setAttribute('aria-label', '파티 던전 선택');
      for (const ch of CHAPTERS) {
        const group = node('optgroup'); group.label = ch.name;
        for (let st = 1; st <= STAGES_PER_CHAPTER; st++) { const def = stageDef(ch.id, st); const option = node('option', '', def.name + ' · ' + def.dungeon.name); option.value = String(def.idx); group.append(option); }
        select.append(group);
      }
      select.value = String(s.stageIdx); select.disabled = !s.isHost; select.onchange = () => { s.send({type:'stage',stageIdx:Number(select.value)}); }; stageLabel.append(select); this.body.append(stageLabel);
      const me = party.members.find(m => m.id === s.playerId);
      this.button(me?.ready ? '준비 취소' : '준비 완료', () => s.send({ type: 'ready', ready: !me?.ready }));
      if (s.isHost) this.button('함께 출격', () => s.start()).disabled = party.members.length < 2 || party.members.some(m => !m.ready);
      this.body.append(node('p', 'party-fine', '두 명 이상이 준비를 마치면 방장이 출격할 수 있습니다.'));
    } else if (party.status === 'running') this.body.append(node('p', '', '함께 원정 중입니다.'));
    else this.body.append(node('p', '', '원정이 끝났습니다. 새 파티를 만들어 다시 도전하세요.'));
    this.button('파티 나가기', () => s.leave());
  }
  updateHud() {
    const s = this.session; this.hud.hidden = !s.run || s.finishing;
    if (this.hud.hidden) return;
    this.hpList.replaceChildren();
    for (const member of s.members) {
      const p = s.players.get(member.id); if (!p) continue;
      const chip = node('div', 'party-chip'); const bar = node('progress'); bar.max = p.maxHp; bar.value = p.hp;
      chip.append(node('span', '', member.name + (p.hp <= 0 ? ' · 합류 대기' : '')), bar); this.hpList.append(chip);
    }
    this.updatePresence(s.connectionStatus());
  }
  updatePresence(status) {
    const text = { checking: '연결 확인 중 · 잠시 기다려 주세요.',
      'host-waiting': '방장 응답 대기 · 전투 정보가 도착하면 이어집니다.',
      'host-paused': '방장이 원정을 일시 정지했습니다.' }[status.kind] || '';
    for (const note of [this.connectionNote, this.battleNotice]) {
      if (note.textContent !== text) note.textContent = text;
      note.hidden = !text;
    }
  }
  result(win, stats, reason) {
    this.updatePresence({ kind: 'connected' });
    this.hud.hidden = true; this.body.replaceChildren();
    this.body.append(node('h3', '', win ? '함께 이뤄낸 승리' : '다음 원정에서 다시 만나요'));
    this.body.append(node('p', '', reason || `${stats.roomsCleared}개 구역 · ${stats.kills}마리 처치 · ${Math.round(stats.elapsed)}초`));
    this.button('로비로 돌아가기', () => { this.dialog.close(); this.session.leave(); });
    this.notice.textContent = win ? '협동 원정 완료. 캠페인과 개인 장비 기록은 그대로 유지됩니다.' : '연결 종료와 실패는 클리어로 기록하지 않습니다.';
    if (!this.dialog.open) this.dialog.showModal();
  }
}
