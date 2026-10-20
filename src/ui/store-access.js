import { STORE_CHANNEL } from '../platform/store-channel.js';
import { StoreController } from '../platform/store-controller.js';

export function setupStoreAccess(app) {
  if (STORE_CHANNEL === 'web') return null;
  const controller = new StoreController(app);
  let refreshModal = () => Promise.resolve();
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.id = 'store-options'; trigger.textContent = '광고 · 구매 복원';
  trigger.addEventListener('click', () => {
    if (!controller.active() || controller.busy) return;
    app.ui.modal('<h2 id="store-title">광고 · 구매 복원</h2><p>광고 제거는 현재 스토어의 계정에서 복원됩니다.</p><p id="store-notice" role="status">스토어 연결 확인 중…</p><div class="modal-btns"><button id="store-buy" disabled>광고 제거</button><button id="store-restore" disabled>구매 복원</button><button id="store-ad" disabled>전면광고 보기</button><button id="store-privacy" hidden>광고 개인정보 설정</button><button id="m-cancel">닫기</button></div>', { onOpen: box => {
      const notice = box.querySelector('#store-notice'), buy = box.querySelector('#store-buy'), restore = box.querySelector('#store-restore'),
        ad = box.querySelector('#store-ad'), privacy = box.querySelector('#store-privacy'), cancel = box.querySelector('#m-cancel');
      const visible = () => notice.isConnected && box.querySelector('#store-notice') === notice && app.ui.el.modal.classList.contains('show');
      let priceReady = false;
      const render = () => {
        if (!visible()) return;
        buy.disabled = !controller.active() || controller.busy || !controller.capabilities?.billing || !priceReady;
        restore.disabled = !controller.active() || controller.busy || !controller.capabilities?.billing;
        ad.disabled = !controller.active() || controller.busy || !controller.capabilities?.ads; cancel.disabled = controller.busy;
        privacy.hidden = !controller.adapter?.capabilities?.privacyOptionsRequired;
        privacy.disabled = controller.busy;
        notice.textContent = controller.capabilities?.billing ? '상품과 가격을 확인한 뒤 현재 스토어에서 결제합니다.' : '현재 스토어 결제가 준비 중입니다.';
      };
      const close = () => { if (controller.busy) return; refreshModal = () => Promise.resolve(); box.removeEventListener('keydown', trap); box.removeAttribute('role'); box.removeAttribute('aria-modal'); box.removeAttribute('aria-labelledby'); app.ui.closeModal(); trigger.focus(); };
      const trap = event => {
        if (!visible()) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const buttons = [...box.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden);
        if (!buttons.length) { event.preventDefault(); return; }
        const index = buttons.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus(); }
      };
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'store-title');
      box.addEventListener('keydown', trap); cancel.focus();
      const run = async action => {
        buy.disabled = restore.disabled = ad.disabled = privacy.disabled = cancel.disabled = true;
        const result = await action();
        if (visible()) { render(); notice.textContent = result.ok ? '처리를 마쳤습니다. 구매 권한은 서버에서 확인합니다.' : '처리를 완료하지 못했습니다. 스토어 상태를 확인한 뒤 다시 시도해 주세요.'; }
      };
      buy.onclick = () => run(() => controller.purchase()); restore.onclick = () => run(() => controller.restore());
      ad.onclick = () => run(() => controller.showAd()); privacy.onclick = () => run(() => controller.privacyOptions()); cancel.onclick = close;
      const refresh = async () => {
        const generation = controller.generation; priceReady = false; render();
        await controller.init();
        if (generation !== controller.generation || !visible()) return;
        if (controller.capabilities?.billing) {
          try {
            const product = (await controller.adapter.products())[0], price = product?.displayAmount ?? product?.formattedPrice;
            if (generation !== controller.generation || !visible()) return;
            if (typeof price === 'string' && price.length) { priceReady = true; if (visible()) buy.textContent = `광고 제거 · ${price}`; }
          } catch { if (generation !== controller.generation || !visible()) return; priceReady = false; }
        }
        if (generation === controller.generation) render();
      };
      refreshModal = refresh; void refresh();
    } });
  });
  // 메뉴 창은 묶음 구조라 직접 붙이지 않고 상점 묶음에 넣는다.
  if (app.oathShell?.place) app.oathShell.place(trigger); else document.querySelector('.oath-menu-grid').append(trigger);
  void controller.activate().catch(() => {});
  window.addEventListener('pagehide', event => { void (event.persisted ? controller.suspend() : controller.dispose()).then(() => refreshModal()).catch(() => {}); });
  window.addEventListener('pageshow', event => { if (event.persisted) void controller.resume().then(() => refreshModal()).catch(() => {}); });
  return controller;
}
