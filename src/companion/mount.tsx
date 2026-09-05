import { createRoot, type Root } from 'react-dom/client';
import type { CompanionDirector } from './director';
import { CompanionPanel } from './CompanionPanel';

let companionRoot: Root | null = null;

export function mountCompanionPanel(host: HTMLElement, director: CompanionDirector): void {
  host.className = '';
  host.replaceChildren();
  companionRoot = createRoot(host);
  companionRoot.render(<CompanionPanel director={director} />);
}
