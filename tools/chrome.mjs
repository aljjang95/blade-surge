// 헤드리스 크롬 실행 경로 해결.
// 컨테이너에 미리 깔린 크로미움(빌드 번호가 playwright 기대치와 다를 수 있다)을 먼저 쓴다.
// 없으면 undefined 를 넘겨 playwright 기본 경로로 떨어진다.
import fs from 'node:fs';
const CANDIDATES = ['/opt/pw-browsers/chromium', process.env.CHROME_PATH];
export const CHROME = CANDIDATES.find((p) => p && fs.existsSync(p));
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
export const launchOpts = (extra = {}) => ({ args: GL_ARGS, ...(CHROME ? { executablePath: CHROME } : {}), ...extra });
