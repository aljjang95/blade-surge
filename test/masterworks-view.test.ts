import { expect, test } from 'bun:test';
import { MasterworksView } from '../src/ui/masterworks.js';

function fixture(result:any=null) {
  const calls:string[]=[],ticket={id:7};
  const controller:any={open:(tab:string)=>calls.push(`open:${tab}`)};
  let current=result;
  Object.defineProperty(controller,'result',{get:()=>current,set:(value:any)=>{calls.push('clear-result');current=value;}});
  const view:any=Object.create(MasterworksView.prototype);
  Object.assign(view,{notice:{textContent:''},dialog:{open:true,close(){calls.push('close');this.open=false;}},app:{expeditionUI:controller,expeditionTicket:ticket,toLobby:()=>{expect(controller.result).toBeNull();calls.push('lobby');}}});
  return {view,controller,calls,ticket};
}

for(const tab of ['dungeons','forge'])test(`settled result routes to ${tab} after clearing result and returning to lobby`,()=>{
  const {view,controller,calls}=fixture({win:true,rewards:{gold:100}});
  expect(view.openExpedition(tab)).toEqual({ok:true});
  expect(calls).toEqual(['close','clear-result','lobby',`open:${tab}`]);expect(controller.result).toBeNull();
});

test('lobby expedition navigation only closes the journal and opens the requested tab',()=>{
  const {view,calls}=fixture();expect(view.openExpedition('dungeons').ok).toBe(true);
  expect(calls).toEqual(['close','open:dungeons']);
});

test('failed settlement preserves its result, ticket and journal and explains retry',()=>{
  const result={saveError:true,win:true,rewards:{gold:100}};
  const {view,controller,calls,ticket}=fixture(result);
  expect(view.openExpedition('forge')).toEqual({ok:false,error:'settlement'});
  expect(calls).toEqual([]);expect(controller.result).toBe(result);expect(view.app.expeditionTicket).toBe(ticket);
  expect(view.dialog.open).toBe(true);expect(view.notice.textContent).toContain('정산을 다시 저장');
  result.saveError=false;expect(view.openExpedition('forge').ok).toBe(true);
  expect(calls).toEqual(['close','clear-result','lobby','open:forge']);
});
