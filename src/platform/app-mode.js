import './app-mode.css';
import { mobileScreen, requestLandscapeScreen } from './landscape-screen.js';
import { onMediaQueryChange } from './startup-compat.js';

export function displayState(view = window, nav = navigator, doc = document) {
  const fullscreen = !!doc.fullscreenElement;
  const appMode = nav.standalone === true || view.matchMedia('(display-mode: standalone)').matches
    || (!fullscreen && view.matchMedia('(display-mode: fullscreen)').matches);
  return { appMode, fullscreen, canFullscreen: !!doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === 'function' };
}

/** 실제로 요청할 수 있는 화면 모드만 시작 버튼에 약속한다(iPhone Safari처럼 API가 없으면 일반 시작). */
export function bootStartLabel(screen, mobile) {
  if (!mobile || screen.fullscreen || screen.appMode) return '터치하여 시작';
  return screen.canFullscreen ? '전체화면 · 가로로 시작' : '터치하여 시작';
}

/** 전체화면 요청 결과를 사용자에게 그대로 알린다. 성공·이미 앱 화면이면 안내하지 않는다. */
export function fullscreenResultMessage(result) {
  if (result?.fullscreen === 'unavailable') return '브라우저가 전체 화면 요청을 거절해 일반 화면으로 진행합니다. 화면 설정에서 다시 시도하거나 홈 화면에 설치해 앱 아이콘으로 실행해 주세요.';
  if (result?.fullscreen === 'unsupported') return '이 브라우저는 게임 전체 화면을 지원하지 않습니다. 홈 화면에 추가한 뒤 앱 아이콘으로 실행하면 주소창 없이 플레이할 수 있습니다.';
  return '';
}

export class AppModeView {
  constructor(app) {
    this.app = app;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'sq-btn app-mode-open'; button.id = 'app-mode-open';
    button.textContent = '앱 설치'; button.setAttribute('aria-label', '주소창 없이 플레이');
    document.querySelector('.lobby-left').append(button); button.onclick = () => this.open(button);
    const pauseButton = document.createElement('button'); pauseButton.type = 'button'; pauseButton.className = 'btn btn-ghost';
    pauseButton.textContent = '앱 화면 · 전체 화면'; pauseButton.onclick = () => this.open(pauseButton);
    document.querySelector('.pause-btns').append(pauseButton);
    const entry = this.entry = document.createElement('div'); entry.className = 'app-mode-entry';
    entry.innerHTML = '<span id="app-mode-boot-hint">주소창 없이 더 넓게</span><div><button type="button" id="app-mode-boot-install">앱 설치</button><button type="button" id="app-mode-boot-fullscreen">전체 화면</button></div>';
    document.querySelector('#boot-start').after(entry);
    entry.querySelector('#app-mode-boot-install').onclick = event => this.open(event.currentTarget);
    entry.querySelector('#app-mode-boot-fullscreen').onclick = event => this.toggleFullscreen(event.currentTarget);
    this.lobbyButton = button;
    const dialog = this.dialog = document.createElement('dialog'); dialog.id = 'app-mode-dialog'; dialog.className = 'app-mode-dialog';
    dialog.setAttribute('aria-labelledby', 'app-mode-title');
    dialog.innerHTML = '<header><span>BLADE SURGE · 화면 설정</span><button type="button" id="app-mode-close" aria-label="앱 화면 안내 닫기">닫기</button></header>'
      + '<h2 id="app-mode-title">주소창 없이 플레이</h2><p>홈 화면에 설치한 뒤 <b>BladeSurge 앱 아이콘</b>으로 실행하면 주소창 없이 즐길 수 있습니다.</p>'
      + '<p id="app-mode-status" role="status"></p><div class="app-mode-actions"><button type="button" id="app-mode-install">홈 화면에 설치</button>'
      + '<button type="button" id="app-mode-fullscreen">지금 전체 화면으로</button></div><ol id="app-mode-guide" tabindex="-1"></ol>'
      + '<p class="app-mode-fine">전체 화면을 나와도 게임은 유지됩니다. 전투 중이라면 일시 정지 메뉴에서 다시 켤 수 있습니다. '
      + '상태 표시줄과 탐색 막대를 실제로 숨길지는 브라우저와 기기가 정합니다.</p>';
    document.body.append(dialog);
    dialog.querySelector('#app-mode-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { if (this.opener?.isConnected) this.opener.focus(); });
    dialog.querySelector('#app-mode-install').onclick = async () => {
      if (!app.pwa.getState().canInstall) { this.showGuide(); return; }
      const result = await app.pwa.install(); this.render();
      if (result.outcome === 'accepted') this.message('설치가 진행됩니다. 완료되면 홈 화면의 BladeSurge 아이콘을 눌러 실행하세요.');
      else if (result.outcome === 'dismissed') this.message('설치를 취소했습니다. 아래 안내로 나중에 설치할 수 있습니다.');
      else this.showGuide();
    };
    dialog.querySelector('#app-mode-fullscreen').onclick = () => this.toggleFullscreen(this.opener);
    document.addEventListener('fullscreenchange', () => this.render());
    document.addEventListener('fullscreenerror', () => this.render());
    window.addEventListener('bladesurge:pwa-state', () => this.render());
    // 구형 MediaQueryList(addListener 만 있음)에서도 생성자가 실패하지 않고 화면 모드 변경을 구독한다.
    for (const mode of ['standalone', 'fullscreen']) onMediaQueryChange(window.matchMedia(`(display-mode: ${mode})`), () => this.render());
    this.render();
    const rotate = document.getElementById('btn-rotate-fullscreen');
    rotate.onclick = () => this.startLandscape();
  }
  /** 사용자 탭 안에서 바로 호출한다. notify가 켜져 있으면 거절·미지원을 토스트로 알린다. */
  startLandscape({ notify = true } = {}) {
    const request = requestLandscapeScreen();
    return request.then(result => {
      this.lastLandscapeRequest = result;
      this.render();
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      document.getElementById('rotate-screen-status').textContent = result.orientation === 'locked'
        ? '가로 화면으로 전환했습니다.' : portrait ? '휴대폰을 가로로 돌려주세요. 이 브라우저는 자동 회전을 지원하지 않을 수 있습니다.' : '가로 화면으로 준비됐습니다.';
      const notice = notify && fullscreenResultMessage(result);
      if (notice) { try { this.app.ui?.toast?.(notice); } catch { /* 안내 실패가 시작을 막지 않는다. */ } }
      return result;
    });
  }
  toggleFullscreen(opener) {
    // The request must stay directly inside the user's tap, before any await.
    const failed = (result = { fullscreen: 'unavailable' }) => { this.open(opener); this.message(fullscreenResultMessage(result)); };
    try {
      const request = document.fullscreenElement ? document.exitFullscreen() : this.startLandscape({ notify: false });
      Promise.resolve(request).then(result => {
        if (result?.fullscreen === 'unavailable' || result?.fullscreen === 'unsupported') { failed(result); return; }
        this.render(); if (this.dialog.open) this.dialog.close();
      }).catch(() => failed());
    } catch { failed(); }
  }
  message(text) { this.dialog.querySelector('#app-mode-status').textContent = text; }
  showGuide() { const guide = this.dialog.querySelector('#app-mode-guide'); guide.focus(); this.message('아래 순서대로 설치한 뒤 홈 화면의 앱 아이콘을 눌러 주세요.'); }
  open(opener) {
    this.opener = opener;
    if (this.app.mode === 'battle') this.app.ui.pause(true);
    this.app.input.clear(); this.render(); if (!this.dialog.open) this.dialog.showModal();
  }
  render() {
    const state = this.app.pwa.getState(), screen = displayState();
    const start = document.getElementById('boot-start');
    if (!start.disabled && !start.classList.contains('hidden')) start.textContent = bootStartLabel(screen, mobileScreen());
    this.entry.hidden = screen.appMode || screen.fullscreen;
    this.entry.querySelector('#app-mode-boot-fullscreen').hidden = !screen.canFullscreen;
    this.entry.querySelector('#app-mode-boot-hint').textContent = screen.canFullscreen ? '주소창 없이 더 넓게' : '홈 화면에 추가하면 주소창 없이 플레이';
    this.lobbyButton.textContent = screen.appMode || screen.fullscreen ? '화면 설정' : '앱 설치';
    this.message(screen.appMode ? '주소창 없는 앱 화면으로 실행 중입니다.' : screen.fullscreen ? '전체 화면으로 플레이 중입니다.'
      : state.installed ? '설치됐습니다. 홈 화면의 BladeSurge 아이콘으로 다시 열면 주소창이 사라집니다.'
        : screen.canFullscreen ? '현재 브라우저 화면입니다. 앱 설치 또는 전체 화면을 선택하세요.'
          : '이 브라우저는 게임 전체 화면을 지원하지 않습니다. 홈 화면에 설치하면 주소창 없이 플레이할 수 있습니다.');
    const install = this.dialog.querySelector('#app-mode-install'); install.hidden = screen.appMode;
    install.textContent = state.canInstall ? 'BladeSurge 앱 설치' : '홈 화면 설치 방법';
    const full = this.dialog.querySelector('#app-mode-fullscreen'); full.hidden = !screen.canFullscreen && !screen.fullscreen;
    full.textContent = screen.fullscreen ? '전체 화면 끝내기' : '지금 전체 화면으로';
    const guide = this.dialog.querySelector('#app-mode-guide'); guide.hidden = screen.appMode;
    const steps = state.platform === 'ios'
      ? ['Safari 공유 메뉴에서 홈 화면에 추가를 선택하세요.', '웹 앱으로 열기가 보이면 켠 뒤 추가를 누르세요.', '홈 화면의 BladeSurge 아이콘으로 실행하세요.']
      : state.platform === 'android'
        ? ['Chrome 메뉴 ⋮를 여세요.', '앱 설치 또는 홈 화면에 추가를 선택하고 설치하세요.', '홈 화면의 BladeSurge 아이콘으로 실행하세요.']
        : ['Chrome 또는 Edge의 주소창 설치 아이콘이나 메뉴를 여세요.', '이 페이지를 앱으로 설치하는 항목을 선택하세요.', '설치한 BladeSurge 앱으로 실행하세요.'];
    guide.replaceChildren(...steps.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  }
}
