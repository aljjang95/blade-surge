// Capacitor 앱 WebView(Android 기본 https://localhost, iOS capacitor://localhost)용 최소 CORS.
// 파티·커뮤니티·동행 대화·MMO 계정(v1) API만 대상이고, 허용 목록 밖 출처에는 아무 헤더도 붙이지 않는다.
// 클라이언트는 쿠키가 아니라 Authorization 헤더·티켓을 쓰므로 Allow-Credentials는 내보내지 않는다.
export const NATIVE_ORIGINS: readonly string[] = ['https://localhost', 'capacitor://localhost'];
const METHODS = ['GET', 'POST', 'DELETE'];
const REQUEST_HEADERS = ['accept', 'authorization', 'content-type'];
const NATIVE_ROUTE = /^\/api\/(?:party|social|companion|v1)(?:\/|$)/;

/** CORS 대상 경로이며 요청 Origin이 허용 목록에 있으면 그 origin, 아니면 null. */
export function nativeOrigin(request: Request, pathname: string): string | null {
  if (!NATIVE_ROUTE.test(pathname)) return null;
  const origin = request.headers.get('origin');
  return origin !== null && NATIVE_ORIGINS.includes(origin) ? origin : null;
}

const VARY = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';

/** 허용 출처의 OPTIONS preflight 응답. 메서드·헤더가 허용 밖이면 403. */
export function preflight(request: Request, origin: string): Response {
  const method = request.headers.get('access-control-request-method');
  const asked = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
  if (!method || !METHODS.includes(method) || asked.some(h => !REQUEST_HEADERS.includes(h))) {
    return new Response(JSON.stringify({ error: 'cors-denied' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: VARY } });
  }
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': METHODS.join(', '),
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type', 'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store', Vary: VARY,
  } });
}

/**
 * 같은 출처 전제로 만들어진 기존 처리기가 앱 요청을 평소처럼 검사하도록, 허용 출처 요청을 정식 출처 요청으로 바꾼다.
 * 브라우저가 붙이는 Origin·Sec-Fetch-Site만 고치며 경로·본문·인증 헤더는 그대로다.
 */
export function asSameOrigin(request: Request, appOrigin: string): Request {
  const headers = new Headers(request.headers);
  headers.set('origin', appOrigin);
  headers.set('sec-fetch-site', 'same-origin');
  return new Request(request, { headers });
}

/** 응답에 CORS 헤더를 붙인다. WebSocket 업그레이드(101)는 CORS 대상이 아니므로 그대로 둔다. */
export function withCors(response: Response, origin: string): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', 'Retry-After');
  headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
