// Browser probes must never substitute empty CSS for JavaScript carrying SRI.
// Allow only the real owned Cloudflare RUM telemetry POST; game/API writes stay blocked.
export function releaseRequestPolicy(url, method, origin) {
 const u=new URL(url);
 if(['GET','HEAD'].includes(method))return 'read';
 if(method==='POST'&&u.origin===origin&&u.pathname==='/cdn-cgi/rum')return 'telemetry';
 return 'block';
}
