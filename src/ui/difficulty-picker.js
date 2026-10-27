// 난이도 선택판(스토리·숙련·악몽·지옥 + 고통 단계). 관문 선택 시트와 캠페인 탭이 같이 쓴다.
// 상태는 모두 순수 모델(game/torment-ui-model.js difficultyPicker)에서 읽고, 바꾸는 것은 Economy.setDifficulty 하나뿐이다
// (해금 판정은 resolveDifficulty 가 다시 한다). 버튼은 한 번 만들어 두고 refresh() 로 상태만 바꿔 초점이 유지된다.
import { difficultyPicker } from '../game/torment-ui-model.js';
import { tormentId } from '../game/difficulty.js';
import './difficulty-picker.css';

const node = (tag, className = '', text = '') => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };
const press = (label, handler, className = '') => { const b = node('button', className, label); b.type = 'button'; b.addEventListener('click', () => handler(b)); return b; };

export class DifficultyPicker {
  /**
   * @param {any} app  app.eco / app.account 를 읽는다
   * @param {{ onChange?: () => void, includeBase?: boolean }} [options]  includeBase=false 면 고통 단계 줄만(기존 난이도 카드가 따로 있는 화면)
   */
  constructor(app, { onChange = null, includeBase = true } = {}) {
    this.app = app; this.onChange = onChange; this.ch = 1; this.st = 1; this.lastTier = 0; this.note = ''; this.model = null;
    this.root = node('div', 'dp'); this.root.dataset.base = String(includeBase);
    this.options = node('div', 'dp-options'); this.options.setAttribute('role', 'group'); this.options.setAttribute('aria-label', '전투 난이도');
    this.optionButtons = {};
    const ids = [...(includeBase ? ['story', 'adept', 'nightmare', 'hell'] : []), 'torment'];
    for (const id of ids) {
      const b = press('', () => this.choose(id), 'dp-option'); b.dataset.dp = id; b.append(node('span', 'dp-option-name'), node('small', 'dp-option-sub'));
      this.optionButtons[id] = b; this.options.append(b);
    }
    this.reason = node('p', 'dp-reason'); this.reason.id = `dp-reason-${Math.random().toString(36).slice(2, 8)}`; this.reason.setAttribute('role', 'status'); this.reason.setAttribute('aria-live', 'polite');
    this.torment = node('section', 'dp-torment'); this.torment.setAttribute('aria-label', '고통 단계');
    const stepper = node('div', 'dp-stepper'); stepper.setAttribute('role', 'group'); stepper.setAttribute('aria-label', '고통 단계 선택');
    this.down = press('', () => this.step(-1), 'dp-step dp-down'); this.down.setAttribute('aria-label', '고통 단계 낮추기'); this.down.append(node('span', 'dp-glyph', '−'));
    this.up = press('', () => this.step(1), 'dp-step dp-up'); this.up.setAttribute('aria-label', '고통 단계 올리기'); this.up.append(node('span', 'dp-glyph', '+'));
    this.tierLabel = node('output', 'dp-tier'); this.tierLabel.setAttribute('aria-live', 'polite');
    this.top = press('', () => this.step(0, true), 'dp-top');
    stepper.append(this.down, this.tierLabel, this.up, this.top);
    this.rule = node('p', 'dp-rule');
    this.info = node('ul', 'dp-info');
    this.infoItems = {};
    for (const key of ['enemy', 'reward', 'exp', 'energy']) { const li = node('li', `dp-chip dp-chip-${key}`); this.infoItems[key] = li; this.info.append(li); }
    this.full = node('p', 'dp-full'); this.decay = node('p', 'dp-decay');
    this.torment.append(stepper, this.info, this.full, this.decay, this.rule);
    this.root.append(this.options, this.reason, this.torment);
  }

  get eco() { return this.app.eco; }
  get serverAuthority() { return this.app.account?.authority === 'server'; }

  /** 어느 관문 기준으로 열림 여부를 판정할지(난이도 해금은 관문마다 다르다). */
  setStage(ch, st) { this.ch = ch; this.st = st; }

  readModel() {
    const { eco } = this;
    return difficultyPicker({ save: eco.s, ch: this.ch, st: this.st, current: eco.difficultyFor(this.ch, this.st).id, status: eco.tormentStatus(), serverAuthority: this.serverAuthority, lastTier: this.lastTier });
  }

  refresh() {
    const model = this.model = this.readModel(), t = model.torment;
    if (model.activeTier) this.lastTier = model.activeTier;
    for (const option of model.options) {
      const b = this.optionButtons[option.id]; if (!b) continue;
      const sub = option.id === 'torment' ? (option.unlocked ? (t.tier ? `T${t.tier}` : `T${t.top}`) : '잠김') : option.unlocked ? `×${option.rewardMul.toFixed(2)}` : '잠김';
      b.querySelector('.dp-option-name').textContent = option.name;
      b.querySelector('.dp-option-sub').textContent = sub;
      b.dataset.locked = String(!option.unlocked); b.setAttribute('aria-disabled', String(!option.unlocked));
      b.setAttribute('aria-pressed', String(option.active)); b.dataset.active = String(option.active);
      b.setAttribute('aria-label', `${option.name}${option.id === 'torment' && t.tier ? ` ${t.tier}단계` : ''}${option.unlocked ? option.id === 'torment' ? `, 최고 해금 ${t.top}단계` : `, 보상 ${option.rewardMul.toFixed(2)}배` : `, 잠김: ${option.requirement}`}`);
    }
    // 사유 한 줄: 방금 누른 잠긴 항목 → 아니면 고통 단계가 닫힌 이유(처음 보는 사람이 해금 조건을 바로 읽게).
    const tormentOption = model.options.find((o) => o.id === 'torment');
    this.reason.textContent = this.note || (tormentOption && !tormentOption.unlocked ? `고통: ${tormentOption.requirement}` : '');
    this.reason.hidden = !this.reason.textContent; this.reason.dataset.tone = this.note || (tormentOption && !tormentOption.unlocked) ? 'locked' : '';
    this.torment.hidden = !t.unlocked;
    if (t.unlocked) {
      this.tierLabel.textContent = `고통 ${t.tier}단계`;
      this.tierLabel.dataset.active = String(!!model.activeTier);
      this.down.disabled = !t.canDown; this.up.disabled = !t.canUp;
      this.top.textContent = `최고 T${t.top}`; this.top.disabled = t.tier >= t.top; this.top.setAttribute('aria-label', `해금된 가장 높은 단계 ${t.top}단계로`);
      const info = t.info;
      this.infoItems.enemy.textContent = info.enemyText; this.infoItems.reward.textContent = info.rewardText; this.infoItems.exp.textContent = info.expText; this.infoItems.energy.textContent = info.energyText;
      this.full.textContent = info.fullText; this.full.dataset.tone = info.decayed ? 'low' : 'ok';
      this.decay.textContent = info.decayNote; this.decay.hidden = !info.decayNote;
      this.rule.textContent = `해금 T${t.top} · 최고 클리어 T${t.best} · 지역 최종 보스(X-10)를 깨면 다음 단계가 열려요`;
    }
    return model;
  }

  choose(id) {
    const model = this.model || this.refresh(), option = model.options.find((o) => o.id === id);
    if (!option) return;
    if (!option.unlocked) { this.note = `${option.name}: ${option.requirement}`; this.refresh(); return; }
    this.note = '';
    this.apply(id === 'torment' ? tormentId(model.torment.tier || model.torment.top) : id);
  }

  step(delta, jumpTop = false) {
    const t = (this.model || this.refresh()).torment;
    if (!t.unlocked) return;
    const next = jumpTop ? t.top : Math.max(1, Math.min(t.top, (t.tier || t.top) + delta));
    this.note = '';
    this.apply(tormentId(next));
  }

  apply(difficultyId) {
    // 호스트가 다시 그리며 이 판을 새 자리로 옮기면 초점이 사라진다. 누른 버튼을 기억했다가 되돌린다.
    const active = document.activeElement, keep = active instanceof HTMLElement && this.root.contains(active) ? active : null;
    this.eco.setDifficulty(difficultyId, this.ch, this.st);
    this.refresh();
    this.onChange?.();
    if (keep && keep.isConnected && !keep.disabled && document.activeElement !== keep) keep.focus({ preventScroll: true });
  }
}
