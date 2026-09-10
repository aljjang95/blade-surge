import { expect, test } from 'bun:test';
import { UI } from '../src/ui/ui.js';
import { Meta } from '../src/ui/meta.js';

function unavailableUI() {
  const ui=Object.create(UI.prototype), notices:string[]=[], buttons:Record<string,any>={};
  Object.assign(ui,{modal:(html:string,options:any)=>{
    notices.push(html); options.onOpen({querySelector:(selector:string)=>(buttons[selector] ||= {})});
  }, closeModal:()=>{}});
  return {ui,notices,buttons};
}

test('cash SKU and premium-pass entry points cannot grant from an unavailable payment sheet',async()=>{
  const {ui,notices,buttons}=unavailableUI();
  const state={gems:73,gold:321,purchases:[],pass:{premium:false},spentKRW:0}, before=JSON.stringify(state);
  let grants=0;
  const eco={s:state,sku:()=>({id:'starter',kind:'cash',once:true}),purchase:()=>{grants++;},buyPass:()=>{grants++;}};
  const meta=Object.assign(Object.create(Meta.prototype),{eco,ui});
  await meta.buy('starter');
  buttons['#p-cancel'].onclick();
  await meta.buyPass();
  buttons['#p-cancel'].onclick();
  expect(grants).toBe(0); expect(JSON.stringify(state)).toBe(before);
  expect(notices.length).toBe(2); expect(notices.every(n=>n.includes('스토어 결제가 연결되지'))).toBe(true);
  expect(buttons['#p-ok']).toBeUndefined();
});

test('rewarded-ad entry point keeps settlement intact and starts no pretend advertisement',()=>{
  const {ui,notices,buttons}=unavailableUI();
  const result={win:true,reward:{gold:120,stones:2},bonusPending:false,bonusClaimed:false};
  let grants=0;
  Object.assign(ui,{resultData:result,app:{battle:{result}},el:{result:{classList:{contains:()=>true}}},
    eco:{doubleStageRewards:()=>{grants++;}},adTimer:null});
  const before=JSON.stringify(result);
  expect(ui.watchAd()).toBe(false);
  buttons['#ad-cancel'].onclick();
  expect(ui.adTimer).toBeNull(); expect(grants).toBe(0); expect(JSON.stringify(result)).toBe(before);
  expect(notices[0]).toContain('기본 보상은 그대로'); expect(notices[0]).not.toContain('ad-cnt');
});
