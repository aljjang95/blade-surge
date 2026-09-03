// apex-secrets — Secrets Store 값을 세션에 건네는 워커.
// GET /v1/secrets?names=A,B   Authorization: Bearer <CF 토큰>
// 토큰의 sha256 이 APEX_GATE_SHA256 과 다르면 404 (존재 자체를 숨긴다). 값은 로그에 남기지 않는다.
const EXPOSABLE = ['GITHUB_DEPLOY_KEY_BLADE_SURGE_B64', 'FISH_API_KEY', 'RUNWARE_API_KEY', 'ADMIN_API_TOKEN', 'TAVILY_API_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'BROWSERBASE_API_KEY', 'DEEPSEEK_API_KEY', 'GLM_API_KEY'];

async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const auth = req.headers.get('authorization') || '';
    const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    let gate = '';
    try { gate = await env.APEX_GATE_SHA256.get(); } catch (e) { return new Response('gate unavailable', { status: 500 }); }
    if (!tok || (await sha256(tok)) !== gate) return new Response('not found', { status: 404 });
    if (url.pathname === '/v1/names') return Response.json({ names: EXPOSABLE.filter((n) => env[n]) });
    if (url.pathname !== '/v1/secrets') return new Response('not found', { status: 404 });
    const names = (url.searchParams.get('names') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const out = {}, missing = [];
    for (const n of names) {
      if (!EXPOSABLE.includes(n) || !env[n]) { missing.push(n); continue; }
      try { out[n] = await env[n].get(); } catch (e) { missing.push(n); }
    }
    return Response.json({ secrets: out, missing }, { headers: { 'cache-control': 'no-store' } });
  },
};
