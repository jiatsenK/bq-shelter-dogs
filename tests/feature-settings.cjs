const assert = require('node:assert/strict');
const keys=['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays'];
module.exports = async (browser,base) => {
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>{window.__BQ_FEATURE_TEST__=true;localStorage.setItem('bq-onboarded','1');localStorage.setItem('bq-name-later','1');});
 let values=Object.fromEntries(keys.map(k=>[k,true])),revision=1,fail=false,conflict=false,puts=0;
 await context.route('**/api/**',route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];
  if(endpoint==='manage/settings') {
   if(route.request().method()==='PUT') {
    puts++; if(conflict)return route.fulfill({status:409,json:{error:'設定已被其他管理者修改，請重新讀取再調整'}});
    values=route.request().postDataJSON().values;revision++;
   }
   return route.fulfill({status:fail?503:200,json:fail?{error:'設定讀取失敗'}:{revision,values}});
  }
  if(endpoint==='feature-settings')return route.fulfill({status:fail?503:200,json:{ok:!fail,revision,values}});
  if(endpoint==='activities')return route.fulfill({json:{ok:true,activities:[{id:'testactivity',revision:1,date:'2026-10-24',kind:'kids',dogs:[]}]}});
  if(endpoint==='dogs')return route.fulfill({json:{dogs:[{id:'2026010101',dogId:'dog1',name:'阿福',cage:'A1',intro:'親人',formerIds:['2025010101']}],syncedAt:'2026-10-24T00:00:00Z'}});
  return route.fulfill({json:{ok:true,activities:[],rest:{},walkers:[],walks:[],departures:[],years:{}}});
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);
 try {
  await page.goto(base+'/admin/public/settings.html');
  await page.getByText('已讀取版本 1。調整後按儲存。').waitFor();
  assert.equal(await page.locator('input[type=checkbox]').count(),9,'舊編號併進出入所紀錄（#639）');
  assert.equal(await page.locator('#save-settings').isDisabled(),true);
  await page.locator('[name=showActivities]').uncheck();await page.locator('#save-settings').click();
  await page.getByText(/已儲存，版本 2/).waitFor();assert.equal(puts,1);
  conflict=true;await page.locator('[name=editIntro]').uncheck();await page.locator('#save-settings').click();
  await page.getByText(/設定已被其他管理者修改/).waitFor();
  assert.equal(await page.locator('[name=editIntro]').isChecked(),false);assert.equal(await page.locator('#save-settings').isDisabled(),true);
  await page.locator('#reload-settings').click();await page.getByText(/已讀取版本 2/).waitFor();
  assert.equal(await page.locator('[name=editIntro]').isChecked(),true);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:require('node:path').join(__dirname,`../.scratch/565-settings-${width}.png`),fullPage:true});}
  fail=true;await page.locator('#reload-settings').click();await page.getByText('設定讀取失敗',{exact:true}).waitFor();assert.equal(await page.locator('#save-settings').isDisabled(),true);
  fail=false; values=Object.fromEntries(keys.map(k=>[k,false]));
  await page.goto(base+'/public/index.html');await page.locator('#main .card').first().waitFor();
  await page.locator('[data-tab=info]').click();
  assert.deepEqual(await page.locator('[data-info-page] strong').allTextContents(),['在所統計','離所紀錄']);
  await page.evaluate(async()=>{const a=await import('/public/js/analysis.js');a.openInfoPage('activities');});
  await page.getByText('這項功能目前未開放',{exact:true}).waitFor();
  values=Object.fromEntries(keys.map(k=>[k,true]));revision++;
  await page.locator('#analysisBack').click();await page.locator('[data-tab=walk]').click();await page.locator('#syncBtn').click();await page.locator('[data-tab=info]').click();
  await page.locator('[data-info-page=activities]').waitFor();
  await page.locator('[data-info-page=activities]').click();
  await page.locator('[data-act-edit]').click();await page.locator('#actDate').waitFor();
  values.editActivity=false;
  const redraw = () => page.evaluate(async()=>{await (await import('/public/js/feature-settings.js')).loadSettings();(await import('/public/js/app.js')).render();});
  await redraw();assert.equal(await page.locator('#actDate').count(),0,'closed setting hides existing activity draft');
  values.editActivity=true;await redraw();await page.locator('#actDate').waitFor();
  fail=true;await redraw();assert.equal(await page.locator('#actDate').count(),0,'failed settings hide draft');
  fail=false;
  await page.goto(base+'/public/edits.html');await page.locator('#list').waitFor({state:'attached'});
  values.showUpdates=false;
  await page.reload();await page.getByText('這項功能目前未開放',{exact:true}).waitFor();
  fail=true;await page.reload();await page.getByText(/功能設定暫時無法確認/).waitFor();
 }finally{await context.close();}
};
