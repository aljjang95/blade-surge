import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';

test('manifest keeps install identity and does not prefer an external store app',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  expect(manifest).toMatchObject({id:'/',start_url:'/',scope:'/',display:'fullscreen',prefer_related_applications:false});
  expect(manifest.display_override).toContain('standalone');
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({src:'/img/icon.png',sizes:'512x512'})]));
});

test('offline fallback is truthful about connectivity and does not claim offline play',()=>{
  const html=readFileSync(new URL('../public/offline.html',import.meta.url),'utf8');
  expect(html).toContain('전투 시작과 동기화에는 인터넷 연결이 필요합니다');
  expect(html).toContain('진행 데이터를 읽거나 변경하지 않습니다');
  expect(html).not.toContain('오프라인 플레이');
});

test('settings exposes automatic quality and live PWA state labels',()=>{
  const source=readFileSync(new URL('../src/ui/meta.js',import.meta.url),'utf8');
  expect(source).toContain("['auto','low', 'mid', 'high']");
  expect(source).toContain("this._pwaStateListener=onPwaState;window.addEventListener('bladesurge:pwa-state',onPwaState)");
  expect(source).toContain('전투를 마친 뒤 업데이트를 적용할 수 있습니다.');
  expect(source).toContain('온라인 상태지만 업데이트를 확인하지 못했습니다.');
  expect(source).toContain("this._pwaStateListener=null;this.ui.closeModal()");
  expect(source).toContain('Safari 공유 버튼');
});
