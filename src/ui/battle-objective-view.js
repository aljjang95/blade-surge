const count = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const seconds = value => Math.floor(count(value) * 10) / 10;
const step = (title, action, values = {}) => Object.freeze({ title, action, progress: 0, total: 0,
  hold: 0, holdTotal: 0, roomId: null, ...values });

/** 종문 역순 공명(심층 종락 회랑). 정답 순서는 노출하지 않는다: roomId 는 점등 단계의 다음 방과 guide 가 있을 때의 guide 방뿐이다. */
function reverseBellsView(route) {
  const total = route.gates.length;
  if (route.phase === 'toll') {
    const last = route.lastToll;
    return step('소등 순서 기억', last ? `${last.label} 소등` : '종소리를 듣는 중', { progress: count(route.tollIndex), total });
  }
  if (route.phase === 'answer') {
    const guide = route.guide, values = { progress: count(route.progress), total, roomId: guide?.room.discovered ? guide.room.id : null };
    if (route.holdGate) { values.hold = seconds(route.hold); values.holdTotal = count(route.def.holdSeconds); }
    const hold = `중심 ${count(route.def.holdSeconds)}초`;
    return step('종문 역순 공명', guide ? `다음 ${guide.label} · ${hold}` : `마지막에 꺼진 종부터 ${hold}`, values);
  }
  const next = route.gates.find(gate => gate.phase === 'locked');
  const values = { progress: count(route.lit), total, roomId: next?.room.discovered ? next.room.id : null };
  if (next && !next.room.discovered) return step('종문 점등', '다음 구역을 찾아 이동', values);
  return step('종문 점등', '이 구역의 적을 처치해 종 깨우기', values);
}

/** 합창 장막(심층 종락 보스, BUNDLE-05). 카운터가 장막 또는 반격 창일 때만 보스방 목표창을 대신한다. 배율은 def 값에서 계산한다. */
function counterView(route) {
  const counter = route.counter, def = route.def?.counter;
  if (!def || (counter?.state !== 'veiled' && counter?.state !== 'open')) return null;
  const percent = value => Math.round(count(value) * 100);
  if (counter.state === 'veiled') return step('합창 장막', `마지막 울림 직후에만 장막이 걷힘 · 받는 피해 ${100 - percent(def.veil)}% 감소`);
  // 남은 시간은 올림(0.1초)이라 시계가 남아 있으면 0.0을 보이지 않는다.
  const left = (Math.ceil(count(counter.windowLeft) * 10 - 1e-9) / 10).toFixed(1);
  return step('합창 장막', `반격 창 ${left}초 · 받는 피해 ${percent(def.open)}%`,
    { hold: seconds(counter.windowLeft), holdTotal: count(counter.windowTotal) });
}

/** 사슬 집행자 후방 노출(잿불금고 심층, BUNDLE-14). 밸브를 모두 연 뒤 보스방에서 컨트롤러가 armored·exposed 일 때만 쓴다(밸브 진행 중에는 idle 이다).
 * 배율은 def.rear 에서 계산하고, 남은 시간은 올림(0.1초)이라 시계가 남아 있으면 0.0을 보이지 않는다. 컨트롤러 값은 읽기만 한다. */
function emberRearView(route) {
  const rear = route.rear, def = route.def?.rear;
  if (route.def?.kind !== 'cooling' || !rear || !def || (rear.state !== 'armored' && rear.state !== 'exposed')) return null;
  const title = '사슬 집행자 후방';
  if (rear.state === 'armored') return step(title, '용재 망치가 박히면 등 뒤로 · 정면은 사슬 갑주');
  const percent = value => Math.round(count(value) * 100);
  const left = (Math.ceil(count(rear.windowLeft) * 10 - 1e-9) / 10).toFixed(1);
  return step(title, `후방 노출 ${left}초 · 등 뒤 ${percent(def.rear)}% · 정면 ${percent(def.front)}%`,
    { hold: seconds(rear.windowLeft), holdTotal: count(rear.windowTotal) });
}

/** 재벼림 심층 거수의 사슬(BUNDLE-15). 보스방에서 컨트롤러가 chained·open·exposed 일 때만 쓴다(심장로 진행 중에는 idle 이다).
 * 사슬 수·버티기 시간·받는 피해 배율은 def.chains 에서 계산하고, 남은 시간은 올림(0.1초), 버틴 시간은 내림(0.1초)이다. 컨트롤러 값은 읽기만 한다. */
function ashforgeChainView(route) {
  const chains = route.chains, def = route.def?.chains;
  if (route.def?.kind !== 'cooling' || !chains || !def) return null;
  const state = chains.state, title = '거수의 사슬', total = count(def.count);
  if (state === 'chained') {
    if (chains.pulling) return step(title, '사슬이 망치 쪽으로 끌림 · 반대편 기둥으로');
    return step(title, `남은 사슬 ${count(chains.chainsLeft)}/${total} · 망치가 끄는 반대편 기둥에서 버티기`);
  }
  if (state === 'open') {
    const left = (Math.ceil(count(chains.windowLeft) * 10 - 1e-9) / 10).toFixed(1);
    return step(title, `기둥 열림 ${left}초 · 행동 없이 ${seconds(chains.hold).toFixed(1)}/${count(def.hold).toFixed(1)}초`,
      { hold: seconds(chains.hold), holdTotal: count(chains.holdTotal) || count(def.hold) });
  }
  if (state === 'exposed') {
    const left = (Math.ceil(count(chains.exposedLeft) * 10 - 1e-9) / 10).toFixed(1);
    return step(title, `사슬 끊김 · 휘청 ${left}초 · 받는 피해 ${Math.round(count(def.exposedMult) * 100)}%`,
      { hold: seconds(chains.exposedLeft), holdTotal: count(chains.exposedTotal) });
  }
  return null;
}

/** 혜성 기사단장 푸른 궤도선(BUNDLE-06). 보스 궤도가 armed·warn 일 때 고리 단계 대신 보스방 목표를 보인다. 남은 시간은 올림(0.1초)이다. */
function bossOrbitView(route, bossRoom) {
  const orbit = route.bossOrbit, state = orbit?.state;
  if (state !== 'armed' && state !== 'warn') return null;
  const title = '푸른 궤도선', roomId = bossRoom?.id ?? null;
  if (state === 'armed') return step(title, '평소 유성은 푸른 선 바깥 · 중심 유성 예고 땐 선 밖으로', { roomId });
  const left = (Math.ceil(count(orbit.warnLeft) * 10 - 1e-9) / 10).toFixed(1);
  return step(title, orbit.kind === 'center' ? `중심 유성 ${left}초 · 푸른 선 밖으로` : `바깥 유성 ${left}초 · 푸른 선 안쪽으로`,
    { roomId, hold: count(orbit.warnLeft), holdTotal: count(orbit.warnTotal) });
}

/** 녹청 심층 생명 제단과 포자 수로(BUNDLE-11). 점등 순서는 지금 켜진 제단만 알려 주고, 4/4 뒤에는 수로 단계를 보인다. 수로가 끝나면 null(기존 보스 흐름). */
function sporeAltarsView(route) {
  const title = '생명 제단 정화', total = route.gates.length, progress = count(route.progress);
  if (!route.complete) {
    const gate = (route.lit === undefined ? route.gates[route.progress] : route.lit) || route.gates[route.progress];
    if (!gate) return null;
    const values = { progress, total, roomId: gate.room.discovered ? gate.room.id : null };
    if (!gate.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
    if (!gate.ready) return step(title, '뿌리 빛 제단 · 이 구역의 적 처치', values);
    return step(title, `뿌리 빛 제단 중심에서 ${count(route.def.holdSeconds)}초 유지`, { ...values, hold: seconds(route.hold), holdTotal: count(route.def.holdSeconds) });
  }
  const channel = route.channel, values = { progress, total };
  if (!channel || channel.phase === 'idle') return step(title, '남은 구역 정화', values);
  if (channel.phase === 'done') return null;
  const roomId = channel.room?.discovered === false ? null : channel.room?.id ?? route.def.channel?.roomId ?? null;
  if (channel.phase === 'open') return step('포자 수로 돌파', '서쪽 수로 입구로 이동', { ...values, roomId });
  return step('포자 수로 돌파', `포자 물결이 지나간 뒤 동쪽 출구로 · ${Math.ceil(count(channel.left))}초`, { ...values, roomId });
}

/** 성운 첨탑 외곽 고리(심층 BUNDLE-12 '외곽 고리 정화', 일반 BUNDLE-13 '외곽 고리 이탈'). 별자리 4/4 뒤에만 부른다.
 * 제목·행동 문구는 정의의 문구 필드(title·label·shard)로 만든다(BUNDLE-13 PLAN 3.1). 고리가 끝나면 null(기존 보스 흐름). */
function astralRingView(route) {
  const ring = route.ring, def = route.def.ring, total = route.gates.length, progress = count(route.progress);
  if (!ring || ring.phase === 'idle') return step('별자리 복원', '남은 구역 정화', { progress, total });
  if (ring.phase !== 'open' && ring.phase !== 'running') return null;
  const title = def.title ?? '외곽 고리 정화', shard = def.shard ?? '파편';
  const room = ring.room, roomId = room && typeof room === 'object' ? room.discovered === false ? null : room.id ?? def.roomId ?? null
    : Number.isFinite(room) ? room : def.roomId ?? null;
  if (ring.phase === 'open') return step(title, `${def.label ?? '성좌 외곽 고리'}로 이동`, { progress: count(ring.purified), total: ring.marks.length, roomId });
  // 남은 시간은 올림이라 시계가 남아 있으면 0초를 보이지 않는다. 유지량은 지금 유지 중인 성표의 값이다.
  const held = ring.held >= 0 ? ring.marks[ring.held] : null;
  return step(title, `${shard}이 모이면 중심 밖으로 · ${Math.ceil(count(ring.left))}초`, { progress: count(ring.purified), total: ring.marks.length,
    hold: held ? seconds(held.hold) : 0, holdTotal: count(def.holdSeconds), roomId });
}

/** 현재 컨트롤러의 상태만 투영하며 전투 정산과 퍼즐 정답에는 접근하지 않는다. */
function mainObjectiveView(battle) {
  const world = battle?.world;
  if (!world) return step('원정 목표', '전장을 준비하고 있습니다.');
  const boss = world.bossRoom;
  if (boss?.cleared) return step('정화 완료', '원정 결과를 확인하세요.');
  const route = battle.routeObjectives;
  const routeKind = route?.def?.kind;
  if (route?.world === world && (routeKind === 'orbits' || routeKind === 'deep-orbits')) {
    const orbit = bossOrbitView(route, boss);
    if (orbit) return orbit;
  }
  const pendingAltar = world.rooms.find(room => room.attunementPending && !room.attuned && !room.cleared);
  if (pendingAltar && (!route || route.coexistsAttunement)) {
    return step('보물 제단 공명', '중심에서 2초 유지', { roomId: pendingAltar.discovered ? pendingAltar.id : null,
      hold: seconds(pendingAltar.attunementT), holdTotal: 2 });
  }
  if (route?.world === world && !route.closed && Array.isArray(route.gates)) {
    if (route.def?.kind === 'spore-altars') {
      const spore = sporeAltarsView(route);
      if (spore) return spore;
    }
    if (route.def?.kind === 'reverse-bells' && route.phase !== 'done') return reverseBellsView(route);
    // 일반 성운(constellations)은 정의에 ring 이 있는 경우에만(BUNDLE-13) 고리 단계를 보인다.
    if ((route.def?.kind === 'deep-constellations' || (route.def?.kind === 'constellations' && route.ring && route.def.ring)) && route.complete) {
      const ringStep = astralRingView(route);
      if (ringStep) return ringStep;
    }
    if (route.def?.kind === 'reverse-bells') {
      const veil = counterView(route);
      if (veil) return veil;
    }
    if (route.def?.kind === 'cooling') {
      // 밸브가 모두 열린 뒤 보스방에서만 컨트롤러가 armored 이므로 밸브 단계보다 앞에 둔다.
      const rearStep = emberRearView(route);
      if (rearStep) return rearStep;
      const chainStep = ashforgeChainView(route);
      if (chainStep) return chainStep;
    }
    if (route.def?.kind === 'thrones' && route.maze && route.complete) {
      // 왕좌를 모두 부순 뒤: 구역이 남았으면 정화 안내, 거울 미궁이 도는 동안은 탈출 안내. 탈출하면 보스 흐름으로 이어진다.
      const values = { progress: count(route.progress), total: route.gates.length };
      if (route.maze.phase === 'idle') return step('가짜 왕좌 파괴', '남은 구역 정화', values);
      if (route.maze.phase === 'running') {
        return step('거울 미궁 탈출', `모래 발자국을 따라 진짜 거울로 · ${Math.ceil(count(route.maze.left))}초`, { ...values, roomId: route.maze.room.id });
      }
    }
    const gate = route.gates[route.progress];
    if (gate) {
      const kind = route.def?.kind;
      const title = kind === 'constellations' || kind === 'deep-constellations' ? '별자리 복원' : kind === 'records' ? '기록 복원'
        : kind === 'thrones' ? '가짜 왕좌 파괴'
        : kind === 'orbits' ? '궤도 고리 정렬'
        : kind === 'deep-orbits' ? '궤도 고리 연결'
        : kind === 'cooling' ? route.copy?.title || '냉각선 복구' : `${route.noun || '종문'} ${route.verb || '조율'}`;
      if (kind === 'deep-orbits') {
        // 순서가 자유라 다음 고리는 영웅이 있는 활성 고리 또는 첫 미연결 고리다. 판정 값은 컨트롤러가 정한 것만 읽는다.
        const next = route.current || gate;
        const values = { progress: count(route.progress), total: route.gates.length, roomId: next.room.discovered ? next.room.id : null };
        // 남은 시간은 올림(0.1초)이라 시계가 남아 있으면 0.0을 보이지 않는다.
        const left = `${(Math.ceil(count(next.clock) * 10 - 1e-9) / 10).toFixed(1)}`;
        if (!next.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
        const offBy = () => route.offBy(next);
        switch (next.phase) {
          case 'ready': return step(title, `룬석을 밀면 붕괴 ${route.def.collapseSeconds}초 시작 · 별까지 ${offBy()}°`, values);
          case 'collapse': return step(title, `붕괴 ${left}초 · 룬석을 별에 맞추기 · ${offBy()}°`, values);
          case 'shelter': return step(title, `붕괴 ${left}초 · 중심 쉼터 연결`,
            { ...values, hold: seconds(next.connectT), holdTotal: count(route.def.connectSeconds) });
          case 'storm': {
            if (!next.present) return step(title, '유성 폭풍 중단 · 고리 구역으로 돌아가기', values);
            const shots = count(route.def.storm?.shelters?.length) || 3, k = Math.min(shots, count(next.stormIndex) + 1);
            return step(title, next.stormWarn ? `유성 폭풍 ${k}/${shots} · 빈 원으로 이동` : `유성 폭풍 ${k}/${shots} · 빈 원 안에서 대기`, values);
          }
          case 'connected': return step(title, '고리 연결 완료', values);
          default: return step(title, '이 구역의 적을 먼저 처치', values);
        }
      }
      if (kind === 'orbits') {
        // 순서가 자유라 다음 고리는 아직 정렬하지 않은 첫 고리다. 남은 각도만 보여준다.
        const next = route.current || gate;
        const values = { progress: count(route.progress), total: route.gates.length, roomId: next.room.discovered ? next.room.id : null };
        if (!next.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
        if (!next.ready) return step(title, '이 구역의 적을 먼저 처치', values);
        if (next.warn === 'center') return step(title, '중심 유성 · 푸른 선 밖으로', values);
        return step(title, `룬석을 밀어 별에 맞추기 · ${route.offBy(next)}°`, values);
      }
      if (kind === 'thrones') {
        // 순서가 자유라 다음 왕좌는 아직 부수지 않은 첫 왕좌다. 균열 수만 보여준다.
        const next = route.current || gate;
        const values = { progress: count(route.progress), total: route.gates.length, roomId: next.room.discovered ? next.room.id : null,
          hold: count(next.hits), holdTotal: count(route.def.hits) };
        if (!next.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
        if (!next.ready) return step(title, '이 구역의 적을 먼저 처치', values);
        return step(title, next.phase === 'still' ? '모래시계 멈춤 · 지금 왕좌 공격' : '모래시계 회전 · 멈출 때까지 대기', values);
      }
      const values = { progress: count(route.progress), total: route.gates.length,
        roomId: gate.room.discovered ? gate.room.id : null };
      if (!gate.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
      if (!gate.ready) return step(title, '이 구역의 적과 증원 처치', values);
      if (kind === 'constellations' || kind === 'deep-constellations') {
        // 단계만 읽고 단서의 실제 내용은 월드 소품에 유지한다.
        const action = route.phase === 'retry' ? '판 밖으로 나와 다시 읽기' : route.phase === 'select'
          ? '월드 단서와 같은 판에서 1초 유지' : route.phase === 'read'
            ? '모래시계 단서 1초 읽기' : '전투를 마치고 모래시계로 이동';
        return step(title, action, { ...values, hold: route.phase === 'read' ? seconds(route.read) : seconds(route.hold),
          holdTotal: route.phase === 'read' ? count(route.def.readSeconds) : route.phase === 'select' ? count(route.def.holdSeconds) : 0 });
      }
      // 충격파 창이 있는 정의(재벼림·잿불금고 심층)는 충격파(밀물)가 지나간 가열 구간에만 조작판이 열린다.
      const shocked = kind === 'cooling' && !!route.def?.shockWindow;
      const action = shocked ? gate.phase === 'warning' || gate.phase === 'vent'
        ? `${route.words?.avoidLong ?? '망치 충격파를 피한 뒤'} 옮겨 간 조작판으로 이동` : route.padOpen(gate) ? '청록 조작판에서 2초 유지'
        : `${route.words?.afterLong ?? '망치 충격파 뒤'} 옮겨 간 조작판으로 이동`
        : kind === 'cooling' ? gate.phase === 'warning' || gate.phase === 'vent'
        ? '분출을 피하고 청록 조작판으로 이동' : '청록 조작판에서 2초 유지'
        : kind === 'records' ? '기록대에서 2초 유지' : '중심에서 2초 유지';
      return step(title, action, { ...values, hold: seconds(route.hold), holdTotal: count(route.def.holdSeconds) });
    }
  }
  const remaining = world.rooms.filter(room => !room.cleared && !['start', 'boss'].includes(room.type)).length;
  if (world.sealed) return step('보스 봉인 해제', `남은 구역 ${remaining}곳 정화`, {
    progress: world.rooms.filter(room => room.cleared && !['start', 'boss'].includes(room.type)).length,
    total: world.rooms.filter(room => !['start', 'boss'].includes(room.type)).length });
  if (!boss?.discovered) return step('보스 찾기', '미탐험 구역을 따라 이동');
  const atBoss = battle.curRoom?.id === boss.id;
  return step('보스 처치', atBoss ? battle.boss?.alive ? '공격 예고를 피하고 보스를 공격' : '보스 출현에 대비'
    : '발견한 보스 구역으로 이동', { roomId: boss.id });
}

export function battleObjectiveView(battle) {
  const primary = mainObjectiveView(battle), conquest = battle?.conquest;
  if (!conquest || conquest.world !== battle.world || !conquest.def) return primary;
  const { kind, priority, order, target } = conquest.def;
  const instruction = kind === 'altars' ? `${order.map(id => id === 2 ? 'A' : 'B').join(' → ')} 제단`
    : kind === 'priority' ? `표식 ${priority === 'first' ? '먼저' : '마지막'} 처치`
      : kind === 'breaks' ? '보스 BREAK' : 'BREAK 중 명중';
  return Object.freeze({ ...primary, challenge: conquest.failed ? '전술 조건 미달 · 원정 계속'
    : conquest.progress >= target ? '전술 조건 달성 · 보스 처치 후 기록'
      : `전술 · ${instruction} · ${conquest.progress}/${target}` });
}

/** 생성기가 만든 실제 순서와 연결을 읽고 미발견 지형은 복사하지 않는다. */
export function discoveredMapView(world) {
  if (!world) return { rooms: [], corridors: [], sealed: false };
  const known = world.rooms.filter(room => room.discovered);
  const roomByCell = new Map(world.rooms.map(room => [`${room.gx},${room.gy}`, room]));
  const corridors = [];
  for (const [from, to] of world.linkPending || []) {
    const a = roomByCell.get(from.join(',')), b = roomByCell.get(to.join(','));
    if (!a?.discovered || !b?.discovered) continue;
    corridors.push({ fromId: a.id, toId: b.id, points: [[a.x, a.z], [b.x, a.z], [b.x, b.z]],
      width: world.layout?.width || 6, sealed: !!world.sealed && (a === world.bossRoom || b === world.bossRoom) });
  }
  return { rooms: known.map(room => ({ id: room.id, x: room.x, z: room.z, w: room.w, h: room.h,
    type: room.type, label: room.label || '', cleared: !!room.cleared, attunementPending: !!room.attunementPending,
    conquestLabel: room.conquestLabel || '' })), corridors, sealed: !!world.sealed };
}

export function discoveredPoint(view, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (view.rooms.some(room => Math.abs(x - room.x) <= room.w / 2 && Math.abs(z - room.z) <= room.h / 2)) return true;
  return view.corridors.some(corridor => corridor.points.slice(1).some(([bx, bz], index) => {
    const [ax, az] = corridor.points[index], half = corridor.width / 2;
    return x >= Math.min(ax, bx) - half && x <= Math.max(ax, bx) + half
      && z >= Math.min(az, bz) - half && z <= Math.max(az, bz) + half;
  }));
}

/** 현재 플레이어 위치는 공개 정보이며 미발견 방의 크기는 경계에 넣지 않는다. */
export function discoveredMapBounds(view, playerPosition) {
  return { minX: Math.min(playerPosition.x - 6, ...view.rooms.map(room => room.x - room.w / 2)),
    maxX: Math.max(playerPosition.x + 6, ...view.rooms.map(room => room.x + room.w / 2)),
    minZ: Math.min(playerPosition.z - 6, ...view.rooms.map(room => room.z - room.h / 2)),
    maxZ: Math.max(playerPosition.z + 6, ...view.rooms.map(room => room.z + room.h / 2)) };
}
