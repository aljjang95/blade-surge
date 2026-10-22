// MMO P1-F: 계정 최소 UI — 결과 화면에 서버 정산 영수증을 덧붙인다(기존 결과 UI 파일은 바꾸지 않는다).
import { REWARD_LABEL } from '../game/economy.js';
import { ITEM_BY_ID } from '../data/items.js';

const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('ko-KR');

/** @param {any} app @param {{ receiptId: string, verdict: string, got?: any[], loot?: any[] }} receipt */
export function showReceipt(app, receipt) {
  const box = document.querySelector('#result .result-box') || document.getElementById('result');
  if (!box) return null;
  let el = document.getElementById('v1-receipt');
  if (!el) {
    el = document.createElement('div'); el.id = 'v1-receipt'; el.setAttribute('role', 'status');
    el.style.cssText = 'margin:6px 0;padding:6px 10px;border-radius:8px;background:rgba(20,30,48,.72);color:#e9f1ff;font-size:12px;line-height:1.5';
    box.prepend(el);
  }
  const gold = (receipt.got || []).filter((g) => g.k === 'gold').reduce((sum, g) => sum + g.n, 0);
  el.dataset.receiptId = receipt.receiptId; el.dataset.verdict = receipt.verdict; el.dataset.gold = String(gold);
  if (receipt.verdict === 'rejected') { el.textContent = '서버 정산을 확인하지 못해 이번 판 보상이 지급되지 않았습니다.'; return el; }
  const parts = (receipt.got || []).map((g) => `${(REWARD_LABEL[g.k] || [g.k])[0]} +${fmt(g.n)}`);
  const items = (receipt.loot || []).map((it) => ITEM_BY_ID[it.id]?.name).filter(Boolean);
  el.textContent = `서버 영수증 확인 · ${parts.join(' · ')}${items.length ? ` · 장비 ${items.length}개` : ''}`;
  return el;
}
