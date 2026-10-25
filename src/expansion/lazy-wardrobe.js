/** 착용 화면의 React 3D 렌더러는 처음 열 때만 받는다. */
export class LazyWardrobe {
  constructor(app, loader = () => import('./wardrobe.jsx')) {
    this.app = app; this.loader = loader; this.delegate = null; this.loading = null;
    this.instance = null; this.showVersion = 0; this.previewVersion = 0;
  }
  load() {
    if (this.delegate) return Promise.resolve(this.delegate);
    return this.loading ||= this.loader().then(({ Wardrobe }) => {
      this.delegate = new Wardrobe(this.app); return this.delegate;
    }).catch(error => { this.loading = null; throw error; });
  }
  status(host, retry, failed = false) {
    if (!host) return;
    const message = document.createElement(failed ? 'button' : 'p');
    message.className = 'wardrobe-loading';
    message.textContent = failed ? '불러오지 못했어요. 다시 시도' : '착용 모습을 불러오는 중';
    if (failed) { message.type = 'button'; message.onclick = retry; }
    else message.setAttribute('role', 'status');
    host.replaceChildren(message);
  }
  show(id, opts = {}) {
    const version = ++this.showVersion;
    if (this.delegate) { this.delegate.show(id, opts); return; }
    const host = document.getElementById('hero-wardrobe');
    this.status(host);
    void this.load().then(view => {
      if (version === this.showVersion) view.show(id, opts);
    }).catch(() => {
      if (version === this.showVersion) this.status(host, () => this.show(id, opts), true);
    });
  }
  hide() {
    this.showVersion++;
    if (this.delegate) this.delegate.hide();
    else document.getElementById('hero-wardrobe')?.replaceChildren();
  }
  preview(host, id, equipment) {
    this.previewStop();
    if (!host) return false;
    const version = this.previewVersion;
    const visible = () => version === this.previewVersion && host.isConnected &&
      !!document.getElementById('modal')?.classList.contains('show');
    if (this.delegate) return this.delegate.preview(host, id, equipment);
    this.status(host);
    void this.load().then(view => {
      if (visible()) view.preview(host, id, equipment);
    }).catch(() => {
      if (visible()) this.status(host, () => this.preview(host, id, equipment), true);
    });
    return true;
  }
  previewStop() { this.previewVersion++; this.delegate?.previewStop(); }
}
