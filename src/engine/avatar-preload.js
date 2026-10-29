// 영웅 화면 아바타 몸체 미리 불러오기.
// 영웅 화면에 들어오면 그 영웅의 보유·판매 아바타 몸체를 백그라운드에서 하나씩 받아 둔다. 그래야 입기/벗기가 같은 프레임에 몸만 바뀐다.
// 메모리 상한: 미리 받은 아바타 몸은 최근 영웅 순으로 limit 개까지만 남기고, 넘치면 오래된 것부터 해제한다.
// 실제 해제는 release(id) 가 판단한다(입은 인스턴스가 있거나 기본 몸이면 거절 → 다음 정리 때 다시 시도).

/** 미리 받아 둘 아바타 몸 수 상한(영웅 둘 분량). 아바타 몸 GLB 한 개는 약 10k 삼각형 + 2k 텍스처 몇 장이다. */
export const AVATAR_PRELOAD_LIMIT = 4;

/**
 * @param {{ preload: (avatarId: string) => Promise<unknown>, release: (avatarId: string) => boolean, limit?: number }} deps
 */
export function createAvatarPreloader({ preload, release, limit = AVATAR_PRELOAD_LIMIT }) {
  /** 미리 받은(또는 받는 중) 아바타 id, 최근 사용이 뒤. */
  const held = [];
  let queue = [], running = false, generation = 0;
  const touch = (id) => { const at = held.indexOf(id); if (at >= 0) held.splice(at, 1); held.push(id); };
  const trim = (keep) => {
    // 오래된 것부터, 지금 영웅 것은 남긴다. 해제를 거절한 것(입은 몸)은 목록에 남겨 다음 정리 때 다시 본다.
    for (let i = 0; i < held.length && held.length > limit;) {
      const id = held[i];
      if (keep.has(id) || !release(id)) { i++; continue; }
      held.splice(i, 1);
    }
  };
  const pump = async (mine) => {
    if (running) return;
    running = true;
    try {
      while (queue.length && mine === generation) {
        const id = queue.shift();
        // 한 번에 하나씩 받는다(파싱·텍스처 디코드를 몰아 프레임을 막지 않게).
        try { await preload(id); } catch { /* 실패한 몸은 교체 시 기존 비동기 경로가 다시 받는다 */ }
      }
    } finally { running = false; }
    if (mine !== generation && queue.length) void pump(generation);
  };
  return {
    /**
     * 영웅 화면 진입·영웅 전환. ids 는 우선순위 순(착용·고른 것 먼저). 이 영웅 것은 상한과 무관하게 받아 둔다.
     * @param {string[]} ids
     */
    focus(ids) {
      const wanted = [...new Set(ids.filter(Boolean))];
      generation++;
      queue = wanted.filter((id) => !held.includes(id));
      for (const id of wanted) touch(id);
      trim(new Set(wanted));
      void pump(generation);
      return queue.length;
    },
    /** 영웅 화면을 떠남: 대기열만 멈추고 받아 둔 몸은 상한 안에서 남긴다(다시 들어오면 즉시). */
    pause() { generation++; queue = []; },
    /** 상한을 무시하고 받아 둔 몸을 모두 해제 시도한다. 해제된 수를 돌려준다. */
    clear() {
      generation++; queue = [];
      let freed = 0;
      for (let i = 0; i < held.length;) { if (release(held[i])) { held.splice(i, 1); freed++; } else i++; }
      return freed;
    },
    /** 진단·테스트: 미리 받은 목록(오래된 것이 앞). */
    held() { return [...held]; },
    pending() { return [...queue]; },
  };
}
