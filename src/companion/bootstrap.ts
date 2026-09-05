import { CompanionDirector } from './director';
import './companion.css';

interface AppWithCompanion {
  mode: 'boot' | 'lobby' | 'battle';
  models: Record<string, unknown>;
  eco?: { s?: { settings?: { quality?: 'high' | 'mid' | 'low' } } };
}

function createLauncher(host: HTMLElement, director: CompanionDirector): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'companion-launcher companion-bootstrap-launcher';
  button.setAttribute('aria-label', '네브와 대화하기');

  const mark = document.createElement('span');
  mark.className = 'companion-launcher-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = 'N';

  const copy = document.createElement('span');
  copy.className = 'companion-launcher-copy';
  const name = document.createElement('b');
  name.textContent = '네브';
  const status = document.createElement('small');
  copy.append(name, status);

  const dot = document.createElement('span');
  dot.className = 'companion-link-dot';
  dot.setAttribute('aria-hidden', 'true');
  button.append(mark, copy, dot);
  host.appendChild(button);

  const sync = () => {
    const snapshot = director.getSnapshot();
    status.textContent = snapshot.status;
    host.classList.toggle('is-connected', snapshot.connected);
    button.setAttribute('aria-label', `네브와 대화하기. 현재 ${snapshot.status}`);
  };
  sync();
  const unsubscribe = director.subscribe(sync);

  let loading = false;
  button.addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    button.disabled = true;
    status.textContent = '3D 링크 연결 중';
    director.setOpen(true);
    try {
      const { mountCompanionPanel } = await import('./mount');
      unsubscribe();
      mountCompanionPanel(host, director);
    } catch (error) {
      director.setOpen(false);
      loading = false;
      button.disabled = false;
      status.textContent = '연결 재시도';
      console.error('companion panel load failed', error);
    }
  });

  return unsubscribe;
}

export function createCompanion(app: AppWithCompanion): CompanionDirector {
  const host = document.createElement('div');
  host.id = 'companion-root';
  host.className = 'companion-ui';
  document.body.appendChild(host);
  const director = new CompanionDirector(app);
  createLauncher(host, director);
  return director;
}
