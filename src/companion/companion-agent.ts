export type CompanionTactic = 'gather' | 'guard' | 'break';

export type CompanionMessageRole = 'companion' | 'player';

export interface CompanionMessage {
  id: number;
  role: CompanionMessageRole;
  text: string;
  at: number;
}

export interface CompanionContext {
  mode: 'lobby' | 'battle';
  heroName: string;
  floor: number;
  hpRatio: number;
  enemiesNear: number;
  combo: number;
  roomsCleared: number;
  totalRooms: number;
  bossName: string;
  power: number;
}

export interface CompanionSnapshot {
  open: boolean;
  connected: boolean;
  tactic: CompanionTactic;
  bond: number;
  status: string;
  quality: 'high' | 'mid' | 'low';
  messages: readonly CompanionMessage[];
  context: CompanionContext;
  dialoguePending: boolean;
  dialogueError: string;
  proposedTactic: CompanionTactic | null;
}

interface PersistedCompanionState {
  tactic: CompanionTactic;
  bond: number;
  messages: CompanionMessage[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CompanionAgentOptions {
  storage?: StorageLike;
  now?: () => number;
}

const STORAGE_KEY = 'blade-surge.companion.v1';
const GREETING = '봉인 해독자 네브입니다. 전장과 장비를 함께 읽겠습니다. 몰이, 수호, 파쇄 중 하나를 명령해 주세요.';
const VALID_TACTICS = new Set<CompanionTactic>(['gather', 'guard', 'break']);

const EMPTY_CONTEXT: CompanionContext = {
  mode: 'lobby',
  heroName: '모험가',
  floor: 0,
  hpRatio: 1,
  enemiesNear: 0,
  combo: 0,
  roomsCleared: 0,
  totalRooms: 0,
  bossName: '',
  power: 0,
};

const TACTIC_COPY: Record<CompanionTactic, { status: string; reply: string }> = {
  gather: {
    status: '몰이 진형',
    reply: '몰이 진형으로 전환합니다. 적의 바깥선을 접어 중앙에 묶고, 계약자의 마무리 타이밍을 열겠습니다.',
  },
  guard: {
    status: '수호 진형',
    reply: '수호 진형으로 전환합니다. 체력이 절반 아래로 내려가면 봉인막을 열어 회복시키겠습니다.',
  },
  break: {
    status: '파쇄 진형',
    reply: '파쇄 진형으로 전환합니다. 정예와 보스의 빈틈을 우선 포착해 경직과 파열 피해를 넣겠습니다.',
  },
};

function parsePersistedState(value: unknown): PersistedCompanionState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<PersistedCompanionState>;
  const messages = Array.isArray(state.messages) ? state.messages.filter((message): message is CompanionMessage => {
    if (!message || typeof message !== 'object') return false;
    return Number.isSafeInteger(message.id) && message.id > 0 && message.id < 1e12
      && (message.role === 'companion' || message.role === 'player')
      && typeof message.text === 'string' && Number.isFinite(message.at) && message.at >= 0;
  }).slice(-18).map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, 2000), at: message.at })) : [];
  return {
    tactic: typeof state.tactic === 'string' && VALID_TACTICS.has(state.tactic) ? state.tactic : 'gather',
    bond: typeof state.bond === 'number' && Number.isFinite(state.bond) ? Math.max(1, Math.min(100, Math.floor(state.bond))) : 1,
    messages,
  };
}

export class CompanionAgent {
  private readonly storage?: StorageLike;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly seenEvents = new Set<string>();
  private nextMessageId = 1;
  private snapshot: CompanionSnapshot;

  constructor({ storage, now = () => Date.now() }: CompanionAgentOptions = {}) {
    this.storage = storage;
    const restored = this.restore();
    const messages = restored?.messages.length ? restored.messages : [{
      id: 1,
      role: 'companion' as const,
      text: GREETING,
      at: now(),
    }];
    this.nextMessageId = messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;
    this.now = now;
    this.snapshot = {
      open: false,
      connected: false,
      tactic: restored?.tactic ?? 'gather',
      bond: restored?.bond ?? 1,
      status: '봉인 대기',
      quality: 'high',
      messages,
      context: EMPTY_CONTEXT,
      dialoguePending: false,
      dialogueError: '',
      proposedTactic: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CompanionSnapshot => this.snapshot;

  setOpen(open: boolean): void {
    if (this.snapshot.open === open) return;
    this.commit({ open });
  }

  setQuality(quality: CompanionSnapshot['quality']): void {
    if (this.snapshot.quality === quality) return;
    this.commit({ quality });
  }

  setConnected(connected: boolean): void {
    if (this.snapshot.connected === connected) return;
    this.commit({ connected, status: connected ? TACTIC_COPY[this.snapshot.tactic].status : '봉인 대기' });
  }

  setTactic(tactic: CompanionTactic, announce = true): void {
    if (!VALID_TACTICS.has(tactic)) return;
    const changed = this.snapshot.tactic !== tactic;
    this.commit({ tactic, status: TACTIC_COPY[tactic].status });
    if (announce && changed) this.addMessage('companion', TACTIC_COPY[tactic].reply);
  }

  updateContext(context: CompanionContext): void {
    this.commit({ context });
  }

  beginDialogue(input: string): void {
    this.addMessage('player', input);
    this.commit({ dialoguePending: true, dialogueError: '', proposedTactic: null });
  }

  finishDialogue(reply: string, proposedTactic: CompanionTactic | null): void {
    this.addMessage('companion', reply);
    this.commit({ dialoguePending: false, dialogueError: '', proposedTactic, bond: Math.min(100, this.snapshot.bond + 1) });
  }

  resetDialogue(error = ''): void {
    this.commit({ dialoguePending: false, dialogueError: error, proposedTactic: null });
  }

  reset(): boolean {
    this.seenEvents.clear(); this.nextMessageId = 2;
    this.snapshot = { ...this.snapshot, open: false, connected: false, tactic: 'gather', bond: 1, status: '봉인 대기',
      messages: [{ id: 1, role: 'companion', text: GREETING, at: this.now() }], context: { ...EMPTY_CONTEXT },
      dialoguePending: false, dialogueError: '', proposedTactic: null };
    const saved = this.persist();
    for (const listener of this.listeners) listener();
    return saved;
  }

  reply(rawInput: string): string | null {
    const input = rawInput.trim().slice(0, 240);
    if (!input) return null;
    this.addMessage('player', input);
    const normalized = input.replace(/\s+/g, '').toLowerCase();
    const decision = this.decide(normalized);
    if (decision.tactic) this.setTactic(decision.tactic, false);
    this.addMessage('companion', decision.text);
    this.commit({ bond: Math.min(100, this.snapshot.bond + 1) });
    return decision.text;
  }

  observe(event: string, detail: Record<string, unknown> = {}): void {
    const key = `${event}:${String(detail.id ?? detail.floor ?? detail.roomsCleared ?? '')}`;
    const repeatable = event === 'battle-start' || event === 'victory' || event === 'defeat';
    if (!repeatable && this.seenEvents.has(key)) return;
    if (!repeatable) this.seenEvents.add(key);

    if (event === 'battle-start') {
      this.seenEvents.clear();
      this.addMessage('companion', `${this.snapshot.context.floor || detail.floor || 1}층 봉인과 동기화했습니다. ${TACTIC_COPY[this.snapshot.tactic].status}으로 따라붙겠습니다.`);
    } else if (event === 'boss-spotted') {
      this.addMessage('companion', `${String(detail.name || '보스')}의 핵이 드러났습니다. 파쇄 진형으로 바꾸면 경직 창을 더 자주 열 수 있습니다.`);
    } else if (event === 'low-hp') {
      this.addMessage('companion', '생명 반응이 위험선입니다. 수호 진형을 명령하면 다음 봉인막을 회복에 사용하겠습니다.');
    } else if (event === 'room-clear') {
      const cleared = Number(detail.roomsCleared || 0);
      if (cleared === 1 || cleared % 3 === 0) this.addMessage('companion', `${cleared}개 구역 정화 완료. 남은 길과 보상 밀도를 다시 계산했습니다.`);
    } else if (event === 'victory') {
      this.addMessage('companion', '층의 핵이 멎었습니다. 방금 전투 기록을 다음 층의 전술 기억으로 남기겠습니다.');
      this.commit({ bond: Math.min(100, this.snapshot.bond + 3), status: '전투 기록 완료' });
    } else if (event === 'defeat') {
      this.addMessage('companion', '봉인은 끊기지 않았습니다. 마지막 교전의 위험 구간을 기억했습니다. 장비와 진형을 바꿔 다시 들어가죠.');
      this.commit({ status: '재정비 제안' });
    } else if (event === 'guard-heal') {
      this.commit({ status: '수호막 전개' });
    } else if (event === 'gather-cast') {
      this.commit({ status: '균열 견인' });
    } else if (event === 'break-cast') {
      this.commit({ status: '핵 파쇄' });
    }
  }

  private decide(input: string): { tactic?: CompanionTactic; text: string } {
    const context = this.snapshot.context;
    if (/(몰이|모아|끌어|집중|한곳)/.test(input)) return { tactic: 'gather', text: TACTIC_COPY.gather.reply };
    if (/(수호|지켜|회복|힐|보호)/.test(input)) return { tactic: 'guard', text: TACTIC_COPY.guard.reply };
    if (/(파쇄|보스|정예|강공|극딜)/.test(input)) return { tactic: 'break', text: TACTIC_COPY.break.reply };
    if (/(어디|길|방향|목표)/.test(input)) {
      if (context.bossName) return { text: `${context.bossName}이 전장에 있습니다. 파쇄 진형으로 핵을 끊거나, 몰이 진형으로 소환수를 먼저 묶는 선택이 좋습니다.` };
      const remaining = Math.max(0, context.totalRooms - context.roomsCleared);
      return { text: `현재 ${context.roomsCleared}/${context.totalRooms || '?'}구역을 읽었습니다. 남은 구역은 ${remaining || '미확인'}개입니다. 미니맵의 붉은 봉인 방향을 따라가겠습니다.` };
    }
    if (/(장비|강화|세트|스탯|전투력)/.test(input)) {
      return { text: `현재 전투력은 ${context.power.toLocaleString('ko-KR')}입니다. 수치만 올리기보다 2세트 동사를 먼저 완성하고, +8 이후에는 보호 주문서가 있을 때 강화하는 편이 안전합니다.` };
    }
    if (/(상태|보고|상황|체력)/.test(input)) {
      return { text: `체력 ${Math.round(context.hpRatio * 100)}%, 근접 위협 ${context.enemiesNear}체, 콤보 ${context.combo}. 현재 명령은 ${TACTIC_COPY[this.snapshot.tactic].status}입니다.` };
    }
    if (/(고마|잘했|좋아|믿)/.test(input)) return { text: '그 말도 전투 기록에 남기겠습니다. 다음 균열에서도 같은 편으로 서겠습니다.' };
    return { text: `전장 문맥은 읽었습니다. “적을 몰아”, “나를 지켜”, “보스를 파쇄해”처럼 의도를 주시면 행동까지 바로 바꾸겠습니다.` };
  }

  private addMessage(role: CompanionMessageRole, text: string): void {
    const messages = [...this.snapshot.messages, { id: this.nextMessageId++, role, text, at: this.now() }].slice(-24);
    this.commit({ messages });
  }

  private commit(patch: Partial<CompanionSnapshot>): void {
    const shouldPersist = patch.tactic !== undefined || patch.bond !== undefined || patch.messages !== undefined;
    this.snapshot = { ...this.snapshot, ...patch };
    if (shouldPersist) this.persist();
    for (const listener of this.listeners) listener();
  }

  private restore(): PersistedCompanionState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return parsePersistedState(value);
    } catch {
      return null;
    }
  }

  private persist(): boolean {
    if (!this.storage || !this.snapshot) return false;
    try {
      const value: PersistedCompanionState = {
        tactic: this.snapshot.tactic,
        bond: this.snapshot.bond,
        messages: [...this.snapshot.messages].slice(-18),
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch {
      // Storage can be unavailable in privacy mode; the live companion remains usable.
      return false;
    }
  }
}
