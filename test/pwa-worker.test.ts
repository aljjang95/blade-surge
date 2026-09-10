import { expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const origin='https://game.example';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function harness() {
  const listeners:Record<string,Function>={}, stores=new Map<string,Map<string,Response>>();
  let network:Function=async()=>new Response('asset'), skipped=0, claimed=0;
  const key=(r:any)=>new URL(typeof r==='string'?r:r.url,origin).href;
  const caches={keys:async()=>[...stores.keys()],delete:async(n:string)=>stores.delete(n),open:async(n:string)=>{
    if(!stores.has(n)) stores.set(n,new Map()); const data=stores.get(n)!;
    return {addAll:async(urls:any[])=>{for(const url of urls)data.set(key(url),new Response('offline'));},
      put:async(r:any,v:Response)=>{data.set(key(r),v.clone());},delete:async(r:any)=>data.delete(key(r)),
      keys:async()=>[...data.keys()].map(url=>new Request(url)),match:async(r:any)=>data.get(key(r))?.clone()};
  }};
  const self={location:{origin},addEventListener:(name:string,fn:Function)=>{listeners[name]=fn;},
    skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}};
  class WorkerRequest extends Request { constructor(url:any,init?:RequestInit){super(typeof url==='string'?new URL(url,origin):url,init);} }
  runInNewContext(source,{self,caches,URL,Request:WorkerRequest,Response,Promise,fetch:(request:any)=>network(request)});
  async function lifecycle(name:string,data?:any) { const pending:Promise<any>[]=[]; listeners[name]({data,waitUntil:(p:Promise<any>)=>pending.push(p)}); await Promise.all(pending); }
  async function request(path:string,init:any={}) {
    const pending:Promise<any>[]=[]; let response:Promise<Response>|undefined;
    listeners.fetch({request:{url:new URL(path,origin).href,method:'GET',headers:new Headers(),mode:'cors',...init},
      waitUntil:(p:Promise<any>)=>pending.push(p),respondWith:(p:Promise<Response>)=>{response=p;}});
    const intercepted=!!response, result=response?await response:undefined;
    await Promise.all(pending); return {intercepted,result};
  }
  return {stores,lifecycle,request,setNetwork:(fn:Function)=>{network=fn;},counts:()=>({skipped,claimed})};
}
test('minimal precache budget and explicit update activation keep other caches intact',async()=>{
  const h=harness(); await h.lifecycle('install');
  expect(h.counts().skipped).toBe(0);
  const shell=[...h.stores.values()][0]; expect(shell.size).toBe(3);
  const total=['img/icon.png','offline.html','manifest.webmanifest'].reduce((n,p)=>n+statSync(new URL('../public/'+p,import.meta.url)).size,0);
  expect(total).toBeLessThan(512*1024);
  h.stores.set('blade-surge-pwa-old-shell',new Map());h.stores.set('another-app',new Map());
  await h.lifecycle('activate'); expect(h.stores.has('blade-surge-pwa-old-shell')).toBe(false); expect(h.stores.has('another-app')).toBe(true);
  await h.lifecycle('message',{type:'IGNORE'});expect(h.counts().skipped).toBe(0);
  await h.lifecycle('message',{type:'APPLY_UPDATE'});expect(h.counts().skipped).toBe(1);
});
test('API, billing, auth, version, POST and protected asset responses never enter cache',async()=>{
  const h=harness();
  for(const path of ['/api/companion','/checkout','/auth/token','/payment','/version.json','https://other.example/img/a.png']) {
    expect((await h.request(path)).intercepted).toBe(false);
  }
  expect((await h.request('/img/a.png',{method:'POST'})).intercepted).toBe(false);
  expect((await h.request('/img/a.png',{headers:new Headers({authorization:'token'})})).intercepted).toBe(false);
  expect((await h.request('/img/a.png',{headers:new Headers({range:'bytes=0-10'})})).intercepted).toBe(false);
  h.setNetwork(async()=>new Response('private',{headers:{'cache-control':'private, no-store'}}));
  await h.request('/img/a.png'); expect(h.stores.size).toBe(0);
});
test('network-first assets refresh, cache stays bounded, offline navigation tells the truth',async()=>{
  const h=harness(); await h.lifecycle('install');
  for(let i=0;i<28;i++) await h.request(`/img/${i}.webp`);
  const runtime=[...h.stores.entries()].find(([name])=>name.endsWith('-runtime'))![1];
  expect(runtime.size).toBe(24);expect(runtime.has(origin+'/img/0.webp')).toBe(false);
  h.setNetwork(async()=>new Response('new'));
  expect(await (await h.request('/img/27.webp')).result?.text()).toBe('new');
  h.setNetwork(async()=>new Response(new Uint8Array(1024*1024+1)));
  await h.request('/img/large.webp');expect(runtime.has(origin+'/img/large.webp')).toBe(false);
  h.setNetwork(async()=>{throw new Error('offline');});
  expect(await (await h.request('/img/27.webp')).result?.text()).toBe('new');
  expect(await (await h.request('/',{mode:'navigate'})).result?.text()).toBe('offline');
  expect([...runtime.keys()].some(key=>new URL(key).pathname==='/')).toBe(false);
});
