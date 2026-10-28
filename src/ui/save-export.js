// 초기화 전 '현재 저장 내보내기': 파일과 복사용 코드(base64)로 만든다. 저장에는 서버 비밀이 없다.
const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export function buildSaveExport(state, now = Date.now()) {
  const json = JSON.stringify({ game: 'blade-surge', kind: 'save-export', version: 1, exportedAt: new Date(now).toISOString(), save: state }, null, 1);
  return { json, code: toBase64(json), fileName: `bladesurge-save-${new Date(now).toISOString().slice(0, 10)}.json` };
}
