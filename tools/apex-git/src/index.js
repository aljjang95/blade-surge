// apex-git — GitHub REST API 로 가는 인증 프록시.
//
//   ANY /gh/<api.github.com 경로>    →  api.github.com/<경로> (PAT 부착)
//   GET /v1/whoami                   →  토큰 주인 + 남은 레이트리밋 (연결 점검용)
//
// 게이트가 안 맞으면 404 (존재 자체를 숨긴다). PAT 값은 절대 응답·로그에 싣지 않는다.
// 사고 반경을 줄이려고 ALLOW_OWNER 밖의 저장소 경로는 거부한다.
const ALLOW_OWNER = 'aljjang95';
const UA = 'apex-git-worker';

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** /repos/<owner>/... 형태면 owner 를 검사한다. 그 외 경로는 읽기 전용 메타(user, rate_limit)만 허용 */
function pathAllowed(p, method) {
  if (p.startsWith('/repos/')) return p.split('/')[2] === ALLOW_OWNER;
  if (method === 'GET' && (p === '/user' || p === '/rate_limit')) return true;
  return false;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const auth = req.headers.get('authorization') || '';
    const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    let gate = '';
    try { gate = await env.APEX_GATE_SHA256.get(); } catch (e) { return new Response('gate unavailable', { status: 500 }); }
    if (!tok || (await sha256(tok)) !== gate) return new Response('not found', { status: 404 });

    let pat = '';
    try { pat = await env.GITHUB_PAT.get(); } catch (e) { return Response.json({ error: 'GITHUB_PAT 미설정 — Secrets Store 에 넣어라' }, { status: 503 }); }
    if (!pat || pat.startsWith('PLACEHOLDER')) return Response.json({ error: 'GITHUB_PAT 가 자리표시자다 — Cloudflare 대시보드에서 실제 토큰으로 바꿔라' }, { status: 503 });

    const ghFetch = (path, init = {}) => fetch('https://api.github.com' + path, {
      ...init,
      headers: { authorization: `Bearer ${pat}`, accept: 'application/vnd.github+json', 'user-agent': UA, 'x-github-api-version': '2022-11-28', ...(init.headers || {}) },
    });

    if (url.pathname === '/v1/whoami') {
      const r = await ghFetch('/user');
      const j = await r.json().catch(() => ({}));
      return Response.json({ ok: r.ok, login: j.login || null, scopes: r.headers.get('x-oauth-scopes'), remaining: r.headers.get('x-ratelimit-remaining') }, { status: r.ok ? 200 : r.status });
    }

    if (!url.pathname.startsWith('/gh/')) return new Response('not found', { status: 404 });
    const ghPath = url.pathname.slice(3) + url.search;   // '/gh' 만 떼고 나머지는 그대로
    if (!pathAllowed(url.pathname.slice(3), req.method)) return Response.json({ error: `허용되지 않은 경로: ${ALLOW_OWNER} 저장소만 가능` }, { status: 403 });

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();
    const r = await ghFetch(ghPath, { method: req.method, body, headers: { 'content-type': 'application/json' } });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  },
};
