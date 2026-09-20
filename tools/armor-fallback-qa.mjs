// Bounded failed-download check in a fresh browser context; test inventory is browser-local only.
export async function verifyArmorFallback(browser, origin, screenshotPath) {
 const context=await browser.newContext({viewport:{width:880,height:400},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 const errors=[];let page;
 try {
  await context.route('**/*',route=>{
   const r=route.request(),u=r.url();
   if(u===origin+'/models/armor-pilot/v1/a_rime.glb')return route.fulfill({status:503,contentType:'text/plain',body:'intentional local QA fixture'});
   if(u.startsWith(origin+'/')&&r.method()==='GET'||/^(data|blob):/.test(u))return route.continue();
   return route.abort();
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').tap();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
  const uid=await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;app.eco.s.selected='knight';const i={id:'a_rime',uid:app.eco.s.invSeq++,enh:0};app.eco.s.inventory.push(i);app.eco.emit();app.meta.openTab('heroes');app.meta.showItem(i.uid,'knight');return i.uid;});
  await page.locator('#i-eq').tap();await page.waitForTimeout(180);
  const state=await page.evaluate(()=>{const r=app.showcase.root,base=[];r.traverse(o=>{if(o.isSkinnedMesh&&/^TLL_Knight_/.test(o.name))base.push(o.visible);});return{equipped:app.eco.hero('knight').equip.armor,error:r.userData.equipmentAppearanceError,appearance:r.userData.equipmentAppearance||null,baseVisible:base.length>0&&base.every(Boolean),face:!!r.getObjectByName('Knight_Head'),inventory:app.eco.s.inventory.map(i=>i.id)};});
  const notice=await page.getByText('장비 외형을 불러오지 못해 기본 모습으로 표시합니다.').first().isVisible();
  await page.screenshot({path:screenshotPath});
  return {pass:state.equipped===uid&&state.error==='a_rime'&&state.appearance===null&&state.baseVisible&&state.face&&notice&&!errors.length,state,notice,errors};
 } finally {await context.close();}
}
