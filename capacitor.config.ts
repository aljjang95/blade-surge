import type { CapacitorConfig } from '@capacitor/cli';
import base from './capacitor.config.json';
import path from 'node:path';
import providers from './config/store-providers.json';

// CLI에 없는 --web-dir 옵션 대신 설정에서 소유한 채널 산출물을 선택한다.
const selected = process.env.BLADE_STORE_WEB_DIR;
const owned = ['googleplay', 'onestore'].map(channel => path.resolve('work/store-builds', channel, 'web'));
if (selected && !owned.includes(path.resolve(selected))) throw Error('잘못된 스토어 웹 산출물 경로');
const config: CapacitorConfig = { ...base, webDir: selected ?? base.webDir,
  android: { ...base.android, loggingBehavior: 'none' },
  // 공개 OAuth audience·ONE license는 실제 제품에서 확인한 값만 주입한다. 개인 키는 여기에 넣지 않는다.
  plugins: { BladeStore: {
    googleWebClientId: process.env.BLADESURGE_GOOGLE_WEB_CLIENT_ID ?? '',
    oneStoreGoogleIdentityEnabled: process.env.BLADESURGE_ONESTORE_GOOGLE_IDENTITY_ENABLED === 'true',
    // 원스토어 라이선스 키는 공개키(비밀 아님)라 config/store-providers.json 에 둔다. env 가 있으면 env 우선.
    oneStoreLicenseKey: process.env.BLADESURGE_ONESTORE_PUBLIC_LICENSE_KEY ?? providers.onestore.licensePublicKey ?? '',
  } },
};
export default config;
