// 채널은 빌드 시 고정한다. URL·UA·저장 값으로 다른 스토어 SDK를 선택하지 않는다.
export const STORE_CHANNEL = typeof __BLADE_CHANNEL__ === 'string' ? __BLADE_CHANNEL__ : 'web';
export const STORE_API = 'https://blade.tllhouse.com/api/store';
export const STORE_PRODUCTS = Object.freeze({ googleplay: 'remove_ads_v1', onestore: 'remove_ads_v1',
  'apps-in-toss': 'ait.0000085379.795abd69.3e2153580e.1772243239' });
export const TOSS_AD_GROUP = 'ait.v2.live.b311470e6321418c';
