import { test, expect } from 'bun:test';
import { LazyWardrobe } from './lazy-wardrobe.js';

function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test('늦은 로드는 닫힌 화면을 열지 않고 최신 영웅만 표시한다', async () => {
  const original = globalThis.document, calls = [], host = { replaceChildren() {} }, modal = { classList:{contains:()=>true} };
  globalThis.document = {getElementById:id=>id==='modal'?modal:host,createElement:()=>({setAttribute(){}})};
  try {
    const flight = deferred(); let imports = 0;
    class Wardrobe { show(id){ calls.push(id); } hide(){ calls.push('hide'); } previewStop(){} }
    const lazy = new LazyWardrobe({}, () => { imports++; return flight.promise; });
    lazy.show('knight'); lazy.hide(); lazy.show('mage');
    flight.resolve({Wardrobe}); await flush();
    expect(imports).toBe(1); expect(calls).toEqual(['mage']);
    lazy.instance = {marker:true}; expect(lazy.instance.marker).toBe(true);
    lazy.hide(); expect(calls).toEqual(['mage','hide']);
  } finally { globalThis.document = original; }
});
test('닫힌 미리보기는 로드 후 재생하지 않고 실패한 로드는 재시도한다', async () => {
  const original = globalThis.document, calls = [], host = {isConnected:true,replaceChildren(){}};
  let opened = true;
  globalThis.document = {getElementById:id=>id==='modal'?{classList:{contains:()=>opened}}:host,createElement:()=>({setAttribute(){}})};
  try {
    const flight = deferred();
    class Wardrobe { preview(){calls.push('preview');} previewStop(){} show(){calls.push('show');} }
    const lazy = new LazyWardrobe({}, () => flight.promise);
    lazy.preview(host,'knight',{}); opened=false;
    flight.resolve({Wardrobe}); await flush(); expect(calls).toEqual([]);
    let tries=0;
    const retry = new LazyWardrobe({}, async()=>{if(++tries===1)throw Error('offline');return{Wardrobe};});
    retry.show('knight'); await flush(); expect(calls).toEqual([]);
    retry.show('knight'); await flush(); expect(calls).toEqual(['show']); expect(tries).toBe(2);
  } finally { globalThis.document = original; }
});
