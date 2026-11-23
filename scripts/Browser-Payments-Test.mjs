// WP-05 real Edge/Chrome acceptance: proof-linked 5k discrepancy -> same-order
// expense -> allocation -> Admin exceptional close -> actual bank refund.
// All mutations target only a tagged QA Order from scripts/Test-Payments.mjs.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";

const filepath=process.argv[2];
assert(filepath&&existsSync(resolve(filepath)),"Pass fixture path from Test-Payments.mjs");
const fixture=JSON.parse(readFileSync(resolve(filepath),"utf8").replace(/^\uFEFF/,""));
assert(/^WP07_QA_[a-f0-9]{9}$/.test(fixture.run),"Refusing an untagged fixture");
assert(fixture.warningOrderId&&fixture.warningSupplierId&&fixture.warningTransferId&&
  fixture.warningPaymentProofId&&fixture.warningExpenseProofId,"Missing browser-specific QA IDs");
const local=join(process.cwd(),".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const account=accounts.find(x=>x.slug==="demo-a");assert(account);
const exe=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
assert(exe,"Edge or Chrome not found");
const profile=join(local,"browser-wp05-"+process.pid+"-"+Date.now());
const browser=spawn(exe,["--headless=new","--disable-gpu","--no-first-run",
  "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+profile,"about:blank"],
{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,timeout=25000){
  const end=Date.now()+timeout;let error;
  while(Date.now()<end){try{const value=await fn();if(value)return value}catch(e){error=e}
    await sleep(280)}
  throw Error("Browser timeout"+(error?": "+error.message:""));
}
let socket,sequence=0,passed=0;
const pending=new Map();
function pass(text){passed++;console.log("PASS "+text)}
try{
  const port=await poll(()=>{
    const file=join(profile,"DevToolsActivePort");
    return existsSync(file)?Number(readFileSync(file,"utf8").split(/\r?\n/)[0]):0;
  });
  const tabs=await poll(async()=>{
    const response=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(1600)});
    return response.ok?response.json():null;
  });
  const tab=tabs.find(x=>x.type==="page");assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{socket.addEventListener("open",ok,{once:true});
    socket.addEventListener("error",fail,{once:true});});
  socket.addEventListener("message",ev=>{
    const r=JSON.parse(ev.data);if(!r.id||!pending.has(r.id))return;
    const job=pending.get(r.id);pending.delete(r.id);clearTimeout(job.timeout);
    if(r.error)job.reject(Error(JSON.stringify(r.error)));else job.resolve(r.result);
  });
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timeout=setTimeout(()=>{if(pending.delete(id))reject(Error("CDP timeout "+method))},18000);
    pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
  });
  async function evalJs(expression){
    const result=await cmd("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error("Browser JS "+JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const navigate=async path=>{await cmd("Page.navigate",{url:"http://127.0.0.1:3000"+path});
    await poll(()=>evalJs("document.readyState==='complete'"))};
  async function fill(selector,value){
    return evalJs("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!el)throw Error('Missing form field '+"+JSON.stringify(selector)+");"+
      "const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;"+
      "Object.getOwnPropertyDescriptor(proto,'value').set.call(el,"+JSON.stringify(value)+");"+
      "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  }
  async function select(selector,value){
    return evalJs("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!el)throw Error('Missing select');"+
      "Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");"+
      "el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  }
  const click=selector=>evalJs("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
    "if(!el)throw Error('Missing button');el.click();return true})()");
  const finance=()=>evalJs("(async()=>{const r=await fetch('/import-api/api/orders/"+
    fixture.warningOrderId+"/finances',{credentials:'include'});"+
    "return {status:r.status,data:await r.json()}})()");
  async function screenshot(name){const shot=await cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(join(local,name),Buffer.from(shot.data,"base64"));}
  await cmd("Page.enable");await cmd("Runtime.enable");
  await cmd("Emulation.setDeviceMetricsOverride",{width:1366,height:850,deviceScaleFactor:1,mobile:false});
  await navigate("/import/login");
  await poll(()=>evalJs("document.querySelector('#import-email')!==null"));
  await fill("#import-email",account.email);await fill("#import-password",account.password);
  await evalJs("document.querySelector('.im-login-card').requestSubmit()");
  await poll(()=>evalJs("location.pathname==='/import' && document.querySelector('.im-sidebar')!==null"));
  pass("Actual browser signs in as tenant Admin via same-origin cookie");
  await navigate("/import/orders/"+fixture.warningOrderId);
  await poll(()=>evalJs("document.querySelector('.im-finance-table')!==null && "+
    "document.querySelector('.im-finance-alert')?.innerText.includes('5,000.00')"),30000);
  const initial=await finance();assert.equal(initial.status,200);
  assert.equal(initial.data.unresolvedDifference,5000);
  assert.equal(initial.data.appliedCommercial,100000);
  const alert=await evalJs("document.querySelector('.im-finance-alert')?.innerText");
  assert(alert.includes("فرق محاسبي غير مسوّى"));
  pass("Arabic UI visibly warns that 5,000 USD stays on originating Order");
  await screenshot("wathiqa-wp05-5000-discrepancy.png");
  await click('[data-finance-action="expense"]');
  await poll(()=>evalJs("document.querySelector('[data-finance-field=description]')!==null"));
  await fill('[data-finance-field="amount"]','3000');
  await fill('[data-finance-field="description"]','Documented supplier charge for same purchase order');
  await select('[data-finance-field="beneficiary"]',fixture.warningSupplierId);
  await select('[data-finance-field="proof"]',fixture.warningExpenseProofId);
  await evalJs("document.querySelector('.im-finance-form').requestSubmit()");
  const afterExpense=await poll(async()=>{const result=await finance();
    return result.status===200&&result.data.expenses.length===1?result.data:null;},30000);
  assert.equal(afterExpense.unresolvedDifference,5000);
  pass("Arabic form records expense without pretending it has been paid");
  await click('[data-finance-action="allocation"]');
  await poll(()=>evalJs("document.querySelector('[data-finance-field=expense]')!==null"));
  await fill('[data-finance-field="amount"]','3000');
  await select('[data-finance-field="transfer"]',fixture.warningTransferId);
  await select('[data-finance-field="expense"]',afterExpense.expenses[0].id);
  await evalJs("document.querySelector('.im-finance-form').requestSubmit()");
  const afterAllocation=await poll(async()=>{const result=await finance();
    return result.status===200&&result.data.unresolvedDifference===2000?result.data:null;},30000);
  assert.equal(afterAllocation.appliedExpenses,3000);
  pass("Arabic settlement form moves only 3,000 to proven same-order expense");
  await poll(()=>evalJs("document.querySelector('.im-finance-alert')?.innerText.includes('2,000.00')"));
  await screenshot("wathiqa-wp05-2000-remains.png");
  await click('[data-finance-action="close"]');
  await poll(()=>evalJs("document.querySelector('[data-finance-field=reason]')!==null"));
  await fill('[data-finance-field="reason"]',
    'Administrative closure with outstanding refund discrepancy recorded');
  await evalJs("document.querySelector('.im-finance-form').requestSubmit()");
  await poll(async()=>{const result=await finance();return result.data.status==='Closed' &&
    result.data.unresolvedDifference===2000;},30000);
  await poll(()=>evalJs("document.querySelector('.im-finance-alert')?.innerText.includes('مغلق إدارياً')"));
  pass("Admin exception close preserves visible 2,000 unresolved difference");
  await click('[data-finance-action="return"]');
  await poll(()=>evalJs("document.querySelector('[data-finance-field=transfer]')!==null"));
  await fill('[data-finance-field="amount"]','2000');
  await fill('[data-finance-field="date"]','2026-11-08');
  await fill('[data-finance-field="reference"]','BANK-RETURN-'+fixture.run);
  await fill('[data-finance-field="reason"]','Actual bank refund for remaining surplus');
  await select('[data-finance-field="transfer"]',fixture.warningTransferId);
  await select('[data-finance-field="proof"]',fixture.warningPaymentProofId);
  await evalJs("document.querySelector('.im-finance-form').requestSubmit()");
  await poll(async()=>{const result=await finance();return result.data.unresolvedDifference===0 &&
    result.data.actualReturns===2000 && result.data.status==='Closed';},30000);
  await poll(()=>evalJs("document.querySelector('.im-finance-success')?.innerText.includes('لا يوجد فرق')"));
  pass("Recorded actual bank return clears discrepancy without reopening closed Order");
  await screenshot("wathiqa-wp05-settled-ledger.png");
  await cmd("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(500);
  const overflow=await evalJs("document.documentElement.scrollWidth-document.documentElement.clientWidth");
  assert(overflow<=2,"Financial mobile page overflow "+overflow);
  await screenshot("wathiqa-wp05-mobile.png");
  pass("RTL financial tables/forms fit mobile viewport without page overflow");
  console.log("WP05_BROWSER_PASS_COUNT="+passed);
  console.log("WP05_BROWSER_SCREENSHOTS=.local/wathiqa-wp05-*.png");
}catch(error){
  console.error("WP05_BROWSER_FAILED",error);
  try{if(socket?.readyState===WebSocket.OPEN){
    const id=9999;const state=await new Promise(resolve=>{
      const listener=event=>{const msg=JSON.parse(event.data);if(msg.id!==id)return;
        socket.removeEventListener('message',listener);resolve(msg.result?.result?.value??msg.error)};
      socket.addEventListener('message',listener);
      socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{
        expression:"(()=>({url:location.href,text:document.body.innerText.slice(-1700)}))()",
        returnByValue:true}}));setTimeout(()=>resolve('timeout'),3000);
    });console.error('WP05_BROWSER_DIAG',JSON.stringify(state));}}
  catch{}
  process.exitCode=1;
}finally{
  try{socket?.close()}catch{}
  try{const task=spawn('taskkill.exe',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore',detached:true});
    task.unref();}catch{browser.kill()}
}
process.exit(process.exitCode||0);
