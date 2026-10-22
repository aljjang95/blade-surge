// MMO P1-F: 이 기기의 로컬 세이브를 서버 계정으로 한 번 올린다. 로컬 원문은 지우지 않는다.
import { parityHash } from '../shared/state-hash.js';

/** @param {import('./account-client.js').AccountClient} client @param {string} installId @param {any} eco */
export async function importLocalSave(client, installId, eco) {
  const save = JSON.parse(JSON.stringify(eco.s));
  try { return await client.importSave(installId, save, parityHash(eco.s)); }
  catch (error) {
    // 이미 임포트한 설치·계정은 정상 상태다(재임포트 거부).
    const code = /** @type {any} */ (error)?.body?.error;
    if (code === 'already-imported' || code === 'install-imported') return { status: 'already', code };
    throw error;
  }
}
