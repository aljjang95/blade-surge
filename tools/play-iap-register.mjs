#!/usr/bin/env node
// Play 인앱 상품 등록 스크립트 (새 monetization API: oneTimeProducts / subscriptions).
// 정본은 src/shared/iap-catalog.js. 기본값은 dry-run(요청 출력만, 네트워크 없음).
//   node tools/play-iap-register.mjs                  dry-run: 요청 메서드·경로·본문 출력
//   NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --probe   GET 두 개만 호출해 현재 등록 상태 출력
//     (클라우드 세션은 프록시 경유가 필요하다. 환경변수 없이 401이 나오면 이 때문이다.)
//   node tools/play-iap-register.mjs --write-json     store/googleplay/iap-products.json 재생성
//   node tools/play-iap-register.mjs --apply --i-have-owner-approval   실제 쓰기(대표님 확인 뒤에만)
// 키는 스크립트에 없다. APEX_CLOUD_URL 프록시(/p/play/...)가 붙인다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IAP_PACKAGE, IAP_PRODUCTS, IAP_CATALOG_VERSION } from '../src/shared/iap-catalog.js';

const REGIONS_VERSION = '2022/02';
export const JSON_PATH = fileURLToPath(new URL('../store/googleplay/iap-products.json', import.meta.url));

/** 영어 listing 번역표(카탈로그 한국어 기준). */
export const EN_LISTINGS = Object.freeze({
  remove_ads_v1: { title: 'Remove Ads', description: 'Permanently turns off interstitial ads (per account, restored on any device).' },
  starter_pack_v1: { title: 'First Purchase Starter Pack', description: '1 guaranteed SSR summon ticket, 1,000 gems, 50,000 gold (once per account).' },
  monthly_card_v1: { title: 'Monthly Card', description: '1,200 gems on every payment plus 100 gems daily while active (auto-renews, cancel anytime).' },
  season_pass_s1: { title: 'Season 1 Premium Pass', description: 'Unlocks the premium reward track for Season 1 (already reached tiers can be claimed).' },
});

const enabled = (catalog) => catalog.filter((p) => p.enabled);

/** 카탈로그 → Play 등록 형식 정의(iap-products.json 의 내용). */
export function buildDefinition(catalog = IAP_PRODUCTS) {
  return {
    _comment: 'src/shared/iap-catalog.js 에서 생성됨(node tools/play-iap-register.mjs --write-json). 직접 고치지 말고 카탈로그를 고친다. 가격은 후보이며 등록·공개는 대표님 확인 뒤.',
    packageName: IAP_PACKAGE,
    catalogVersion: IAP_CATALOG_VERSION,
    products: enabled(catalog).map((p) => {
      const en = EN_LISTINGS[p.id];
      if (!en) throw new Error(`영어 listing 누락: ${p.id}`);
      return {
        id: p.id,
        type: p.type,
        kind: p.type === 'subscription' ? 'subscription' : 'oneTimeProduct',
        priceKRW: p.priceKRW,
        currencyCode: 'KRW',
        regionCode: 'KR',
        ...(p.type === 'subscription' ? { basePlanId: p.basePlanId, billingPeriodDuration: 'P1M' } : { purchaseOptionId: 'default' }),
        listings: [
          { languageCode: 'ko-KR', title: p.title, description: p.description },
          { languageCode: 'en-US', title: en.title, description: en.description },
        ],
      };
    }),
  };
}

/**
 * 등록 요청 목록. path 는 .../applications/{pkg} 기준 상대 경로, query 는 객체.
 * 필드명은 monetization.onetimeproducts / monetization.subscriptions 문서 기준이며,
 * "apply 전 확인" 표시는 읽기 응답·공식 문서로 재확인할 항목이다.
 */
export function buildRequests(catalog = IAP_PRODUCTS) {
  const reqs = [];
  for (const p of enabled(catalog)) {
    const en = EN_LISTINGS[p.id];
    if (!en) throw new Error(`영어 listing 누락: ${p.id}`);
    const price = { currencyCode: 'KRW', units: String(p.priceKRW) };
    if (p.type === 'subscription') {
      const basePlanId = p.basePlanId || 'monthly';
      reqs.push({
        step: `${p.id} 생성`,
        method: 'POST',
        path: '/subscriptions',
        query: { productId: p.id, 'regionsVersion.version': REGIONS_VERSION },
        body: {
          packageName: IAP_PACKAGE,
          productId: p.id,
          // listings.benefits 필수 여부: apply 전 확인
          listings: [
            { languageCode: 'ko-KR', title: p.title, benefits: ['결제마다 보석 1,200', '기간 중 매일 보석 100'], description: p.description },
            { languageCode: 'en-US', title: en.title, benefits: ['1,200 gems per payment', '100 gems daily while active'], description: en.description },
          ],
          basePlans: [{
            basePlanId,
            autoRenewingBasePlanType: {
              billingPeriodDuration: 'P1M',
              gracePeriodDuration: 'P3D',
              accountHoldDuration: 'P30D',
              resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE',
              legacyCompatible: true, // apply 전 확인
            },
            regionalConfigs: [{ regionCode: 'KR', newSubscriberAvailability: true, price }],
          }],
          // taxAndComplianceSettings(세금 분류): 대표님 확인 사항, 필드 형식 apply 전 확인
        },
      });
      reqs.push({
        step: `${p.id} 기본 요금제 활성화`,
        method: 'POST',
        path: `/subscriptions/${p.id}/basePlans/${basePlanId}:activate`,
        query: {},
        body: {},
      });
    } else {
      reqs.push({
        step: `${p.id} 생성/수정`,
        method: 'PATCH',
        path: `/oneTimeProducts/${p.id}`,
        query: {
          allowMissing: 'true',
          'regionsVersion.version': REGIONS_VERSION,
          updateMask: 'listings,purchaseOptions,taxAndComplianceSettings',
        },
        body: {
          packageName: IAP_PACKAGE,
          productId: p.id,
          listings: [
            { languageCode: 'ko-KR', title: p.title, description: p.description },
            { languageCode: 'en-US', title: en.title, description: en.description },
          ],
          purchaseOptions: [{
            purchaseOptionId: 'default',
            buyOption: { legacyCompatible: true, multiQuantityEnabled: false }, // apply 전 확인
            regionalPricingAndAvailabilityConfigs: [{ regionCode: 'KR', price, availability: 'AVAILABLE' }],
          }],
          // taxAndComplianceSettings: 대표님 확인 후 값 지정. updateMask 에는 있으나 본문 생략 시 기본값 적용 여부 apply 전 확인
        },
      });
      reqs.push({
        step: `${p.id} 구매 옵션 활성화`,
        method: 'POST',
        path: `/oneTimeProducts/${p.id}/purchaseOptions:batchUpdateStates`,
        query: {},
        // 요청 객체 필드명(activatePurchaseOptionRequest 등)·latencyTolerance: apply 전 확인
        body: { requests: [{ activatePurchaseOptionRequest: { packageName: IAP_PACKAGE, productId: p.id, purchaseOptionId: 'default' } }] },
      });
    }
  }
  return reqs;
}

export function baseUrl(env = process.env) {
  const root = (env.APEX_CLOUD_URL || '').replace(/\/+$/, '');
  return `${root}/p/play/androidpublisher/v3/applications/${IAP_PACKAGE}`;
}

const fullUrl = (base, r) => {
  const qs = new URLSearchParams(r.query || {}).toString();
  return base + r.path + (qs ? `?${qs}` : '');
};

/**
 * mode: 'dry-run'(기본, 네트워크 없음) | 'probe'(GET 두 개) | 'apply'(approved:true 필요).
 * 반환: { mode, requests, results }. 실패 시 apply 는 즉시 멈추고 failed 에 요청·상태만 담는다.
 */
/** @param {{ fetch?: any, mode?: string, approved?: boolean, base?: string, catalog?: readonly any[], log?: (m: string) => void }} [opts] */
export async function run({ fetch: f, mode = 'dry-run', approved = false, base = baseUrl(), catalog = IAP_PRODUCTS, log = () => {} } = {}) {
  const requests = buildRequests(catalog);
  if (mode === 'apply' && !approved) {
    throw new Error('apply 는 --apply 와 --i-have-owner-approval 둘 다 필요하다(대표님 확인 사항).');
  }
  if (mode === 'dry-run') {
    for (const r of requests) log(`${r.method} ${r.path}${Object.keys(r.query).length ? '?' + new URLSearchParams(r.query) : ''}  # ${r.step}\n${JSON.stringify(r.body, null, 2)}`);
    return { mode, requests, results: [] };
  }
  if (typeof f !== 'function') throw new Error('fetch 가 필요하다');
  if (mode === 'probe') {
    const results = [];
    for (const path of ['/oneTimeProducts', '/subscriptions']) {
      const res = await f(base + path, { method: 'GET' });
      let ids = [];
      if (res.status === 200) {
        const j = await res.json().catch(() => ({}));
        ids = (j.oneTimeProducts || j.subscriptions || []).map((x) => x.productId);
      }
      results.push({ path, status: res.status, productIds: ids });
      log(`GET ${path} -> ${res.status}${res.status === 204 ? ' (빈 목록)' : ''}${res.status === 401 ? ' (프록시 미경유? NODE_USE_ENV_PROXY=1 로 다시)' : ''} ids=[${ids.join(', ')}]`);
    }
    return { mode, requests, results };
  }
  if (mode !== 'apply') throw new Error(`알 수 없는 mode: ${mode}`);
  const results = [];
  for (const r of requests) {
    const res = await f(fullUrl(base, r), { method: r.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    results.push({ step: r.step, status: res.status });
    if (res.status < 200 || res.status >= 300) {
      log(`실패: ${r.method} ${r.path} -> ${res.status}`);
      return { mode, requests, results, failed: { step: r.step, method: r.method, path: r.path, status: res.status } };
    }
    log(`ok ${r.method} ${r.path} -> ${res.status}`);
  }
  return { mode, requests, results };
}

async function main(argv) {
  const has = (a) => argv.includes(a);
  if (has('--write-json')) {
    writeFileSync(JSON_PATH, JSON.stringify(buildDefinition(), null, 2) + '\n');
    console.log(`쓴 파일: ${JSON_PATH}`);
    return 0;
  }
  const mode = has('--apply') ? 'apply' : has('--probe') ? 'probe' : 'dry-run';
  if (mode === 'apply' && !has('--i-have-owner-approval')) {
    console.error('거부: --apply 는 --i-have-owner-approval 과 함께만 동작한다(대표님 확인 사항).');
    return 2;
  }
  if (mode !== 'dry-run' && !process.env.APEX_CLOUD_URL) {
    console.error('APEX_CLOUD_URL 이 없다.');
    return 2;
  }
  const out = await run({ fetch: globalThis.fetch, mode, approved: has('--i-have-owner-approval'), log: console.log });
  if (mode === 'dry-run') console.log(`\n(dry-run) 요청 ${out.requests.length}건, 네트워크 호출 없음.`);
  return out.failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
