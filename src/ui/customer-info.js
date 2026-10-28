// 결제창(KG이니시스) 구매자 정보 입력. 이름·휴대폰·이메일을 받아 결제창 호출에만 쓰고 서버·localStorage에 저장하지 않는다.
// 같은 탭 세션 동안 다시 묻지 않도록 메모리에만 보관한다(새로고침하면 사라진다).
let remembered = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 입력값 검증·정규화. 통과하면 { ok: true, customer }, 아니면 { ok: false, field, message }. */
export function validateCustomer(raw = {}) {
  const fullName = String(raw.fullName ?? '').trim();
  const phoneNumber = String(raw.phoneNumber ?? '').replace(/[\s-]/g, '');
  const email = String(raw.email ?? '').trim();
  if (fullName.length < 2 || fullName.length > 30) return { ok: false, field: 'fullName', message: '이름을 2자 이상 입력해 주세요.' };
  if (!/^01[0-9]{8,9}$/.test(phoneNumber)) return { ok: false, field: 'phoneNumber', message: '휴대폰 번호를 숫자로 정확히 입력해 주세요. (예: 01012345678)' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return { ok: false, field: 'email', message: '이메일 주소 형식을 확인해 주세요.' };
  return { ok: true, customer: { fullName, phoneNumber, email } };
}

export function forgetCustomer() { remembered = null; }

/** 결제수단 표시 이름. */
export const PAY_METHOD_LABEL = Object.freeze({ CARD: '신용·체크카드', KAKAOPAY: '카카오페이', NAVERPAY: '네이버페이', TOSSPAY: '토스페이' });

/**
 * 구매자 정보 모달을 띄우고 { fullName, phoneNumber, email } 또는 null(취소)을 돌려준다.
 * @param {{ modal: Function, closeModal: Function }} ui
 */
export function askCustomerInfo(ui, methods = ['CARD']) {
  const choices = methods.filter((m) => Object.hasOwn(PAY_METHOD_LABEL, m));
  // 결제수단이 카드 하나면 예전처럼 저장된 정보로 바로 진행한다. 여럿이면 매번 수단을 고른다(정보는 미리 채움).
  if (remembered && choices.length <= 1) return Promise.resolve({ ...remembered, method: 'CARD' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const field = (id, label, type, mode, ph, auto) => `<label class="cust-row" for="${id}"><span>${label}</span><input id="${id}" type="${type}" inputmode="${mode}" autocomplete="${auto}" placeholder="${esc(ph)}" maxlength="100"></label>`;
    const html = `<h2>구매자 정보</h2><p>결제창(카드사) 본인 확인에만 쓰이며 저장되지 않아요.</p>`
      + field('cust-name', '이름', 'text', 'text', '홍길동', 'name')
      + field('cust-phone', '휴대폰', 'tel', 'tel', '01012345678', 'tel')
      + field('cust-email', '이메일', 'email', 'email', 'name@example.com', 'email')
      + (choices.length > 1 ? `<fieldset class="cust-methods"><legend>결제수단</legend>${choices.map((m, i) => `<label class="cust-method"><input type="radio" name="cust-method" value="${m}"${i === 0 ? ' checked' : ''}> ${PAY_METHOD_LABEL[m]}</label>`).join('')}</fieldset>` : '')
      + '<p id="cust-err" role="alert" style="color:var(--red);min-height:1.2em"></p>'
      + '<div class="modal-btns"><button class="btn btn-ghost" id="cust-cancel">취소</button><button class="btn btn-gold" id="cust-ok">결제 계속</button></div>';
    ui.modal(html, {
      onClose: () => finish(null),
      onOpen: (box) => {
        const q = (id) => box.querySelector(id);
        // 모바일 가로 화면: 키보드가 올라와도 입력칸·버튼이 보이도록 포커스 시 스크롤한다(모달 박스가 세로 스크롤).
        box.querySelectorAll('input').forEach((el) => el.addEventListener('focus', () => { setTimeout(() => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 250); }));
        const submit = () => {
          const v = validateCustomer({ fullName: q('#cust-name').value, phoneNumber: q('#cust-phone').value, email: q('#cust-email').value });
          if (!v.ok) { q('#cust-err').textContent = v.message; box.querySelector({ fullName: '#cust-name', phoneNumber: '#cust-phone', email: '#cust-email' }[v.field])?.focus(); return; }
          remembered = v.customer;
          const picked = box.querySelector('input[name="cust-method"]:checked')?.value;
          finish({ ...v.customer, method: choices.includes(picked) ? picked : 'CARD' });
          ui.closeModal();
        };
        q('#cust-ok').onclick = submit;
        q('#cust-cancel').onclick = () => { finish(null); ui.closeModal(); };
        box.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } else if (event.key === 'Escape') { event.preventDefault(); q('#cust-cancel').click(); } };
        if (remembered) { q('#cust-name').value = remembered.fullName; q('#cust-phone').value = remembered.phoneNumber; q('#cust-email').value = remembered.email; }
        q('#cust-name').focus({ preventScroll: true });
      },
    });
  });
}
