import './app-mode.css';

export function displayState(view = window, nav = navigator, doc = document) {
  const fullscreen = !!doc.fullscreenElement;
  const appMode = nav.standalone === true || view.matchMedia('(display-mode: standalone)').matches
    || (!fullscreen && view.matchMedia('(display-mode: fullscreen)').matches);
  return { appMode, fullscreen, canFullscreen: !!doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === 'function' };
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
    entry.innerHTML = '<span>주소창 없이 더 넓게</span><div><button type="button" id="app-mode-boot-install">앱 설치</button><button type="button" id="app-mode-boot-fullscreen">전체 화면</button></div>';
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
      + '<p class="app-mode-fine">전체 화면을 나와도 게임은 유지됩니다. 전투 중이라면 일시 정지 메뉴에서 다시 켤 수 있습니다.</p>';
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
    window.addEventListener('bladesurge:pwa-state', () => this.render());
    for (const mode of ['standalone', 'fullscreen']) window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', () => this.render());
    this.render();
  }
  toggleFullscreen(opener) {
    // The request must stay directly inside the user's tap, before any await.
    const failed = () => { this.open(opener); this.message('이 브라우저에서는 전체 화면을 열지 못했습니다. 홈 화면 설치 안내를 이용해 주세요.'); };
    try {
      const request = document.fullscreenElement ? document.exitFullscreen()
        : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      Promise.resolve(request).then(() => { this.render(); if (this.dialog.open) this.dialog.close(); }).catch(failed);
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
    this.entry.hidden = screen.appMode || screen.fullscreen;
    this.entry.querySelector('#app-mode-boot-fullscreen').hidden = !screen.canFullscreen;
    this.lobbyButton.textContent = screen.appMode || screen.fullscreen ? '화면 설정' : '앱 설치';
    this.message(screen.appMode ? '주소창 없는 앱 화면으로 실행 중입니다.' : screen.fullscreen ? '전체 화면으로 플레이 중입니다.'
      : state.installed ? '설치됐습니다. 홈 화면의 BladeSurge 아이콘으로 다시 열면 주소창이 사라집니다.' : '현재 브라우저 화면입니다. 앱 설치 또는 전체 화면을 선택하세요.');
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
