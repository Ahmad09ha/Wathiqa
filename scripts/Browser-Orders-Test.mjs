import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const local=join(process.cwd(),".local");
mkdirSync(local,{recursive:true});
const creds=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const admin=creds.find(x=>x.slug==="demo-a");
if(!admin)throw Error("Missing demo-a");
const browser=[
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if(!browser)throw Error("Chrome/Edge browser missing");
// Each run gets its own browser profile and OS-assigned CDP port. Reusing
// a profile after a timed-out test can silently attach to an orphan process.
const profile=join(local,"import-orders-edge-qa-"+process.pid+"-"+Date.now());
const chrome=spawn(browser,[
  "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
  "--remote-debugging-port=0","--remote-allow-origins=*",
  "--user-data-dir="+profile,"about:blank"
],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,ms=18000){
  const end=Date.now()+ms;let error;
  while(Date.now()<end){try{const v=await fn();if(v)return v}catch(e){error=e}await sleep(300)}
  throw Error("Timed out waiting for UI"+(error?": "+error.message:""));
}
let socket, sequence=0,count=0, supplierName="Browser Orders QA "+Date.now().toString().slice(-9);
let orderNumber=null;
const pending=new Map();
function pass(message){count++;console.log("PASS "+message)}
try {
  const debugPort=await poll(()=>{
    const portFile=join(profile,"DevToolsActivePort");
    return existsSync(portFile)?Number(readFileSync(portFile,"utf8").split(/\r?\n/)[0]):0;
  },20000);
  console.log("ORDER_QA_BROWSER_READY="+debugPort);
  const pages=await poll(async()=>{
    const r=await fetch("http://127.0.0.1:"+debugPort+"/json/list",{signal:AbortSignal.timeout(1800)});
    return r.ok?await r.json():null;
  },16000);
  const target=pages.find(x=>x.type==="page");
  if(!target)throw Error("No CDP tab");
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{socket.addEventListener("open",res,{once:true});socket.addEventListener("error",rej,{once:true})});
  socket.addEventListener("message",e=>{
    const x=JSON.parse(e.data);if(!x.id||!pending.has(x.id))return;
    const p=pending.get(x.id);pending.delete(x.id);
    clearTimeout(p.timer);
    if(x.error)p.reject(Error(JSON.stringify(x.error)));else p.resolve(x.result);
  });
  function command(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{if(pending.delete(id))reject(Error("CDP timed out: "+method))},15000);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evalJs(expression){
    const out=await command("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(out.exceptionDetails)throw Error("Browser expression error: "+JSON.stringify(out.exceptionDetails));
    return out.result.value;
  }
  async function navigate(url){
    await command("Page.navigate",{url});
    await poll(()=>evalJs("document.readyState==='complete'"),16000);
  }
  async function enter(selector,value,index=0){
    return evalJs("(()=>{const el=document.querySelectorAll("+JSON.stringify(selector)+")["+index+"];if(!el)throw Error('missing "+selector+"');"+
      "const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
      "s.call(el,"+JSON.stringify(String(value))+");el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
  }
  async function select(selector,value,index=0){
    return evalJs("(()=>{const el=document.querySelectorAll("+JSON.stringify(selector)+")["+index+"];if(!el)throw Error('missing select');"+
      "const s=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
      "s.call(el,"+JSON.stringify(String(value))+");el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  }
  async function click(selector,index=0){
    return evalJs("(()=>{const el=document.querySelectorAll("+JSON.stringify(selector)+")["+index+"];if(!el)throw Error('missing clickable "+selector+"');el.click();return true;})()");
  }
  async function shot(name){
    const res=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(join(local,name),Buffer.from(res.data,"base64"));
  }
  async function waitHydratedForm(selector="form"){
    await poll(()=>evalJs("(()=>{const f=document.querySelector("+JSON.stringify(selector)+");if(!f)return false;const k=Object.keys(f).find(x=>x.startsWith('__reactProps$'));return !!(k && typeof f[k]?.onSubmit==='function')})()"),18000);
  }
  async function debugPage(stage){
    try{
      const state=await evalJs("(()=>({url:location.href,body:document.body.innerText.slice(0,1300),alerts:[...document.querySelectorAll('[role=alert],.toast-item')].map(x=>x.innerText),hydrated:[...document.forms].map(f=>Object.keys(f).some(k=>k.startsWith('__reactProps$')))}))()");
      console.error("ORDER_QA_PAGE_DIAG "+stage+" "+JSON.stringify(state));
      await shot("wathiqa-orders-qa-failure.png");
    }catch(error){console.error("ORDER_QA_DIAG_FAILED "+String(error))}
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride",{width:1360,height:840,deviceScaleFactor:1,mobile:false});
  await navigate("http://127.0.0.1:3000/import/login");
  await poll(()=>evalJs("!!document.querySelector('#import-email')"));
  await waitHydratedForm();
  await enter("#import-email",admin.email);
  await enter("#import-password",admin.password);
  await evalJs("document.querySelector('form').requestSubmit()");
  try {
    await poll(()=>evalJs("location.pathname==='/import' && document.body.innerText.includes('طلبات الشراء')"),20000);
  } catch(error) {
    await debugPage("login");
    throw error;
  }
  pass("Login and Orders navigation visible in Arabic");
  await navigate("http://127.0.0.1:3000/import/companies");
  await poll(()=>evalJs("!!document.querySelector('button') && document.body.innerText.includes('إضافة جهة')"));
  await evalJs("(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent.includes('إضافة جهة')).click()})()");
  await poll(()=>evalJs("!!document.querySelector('input[placeholder*=\\\"مورّد\\\"]')"));
  await enter('input[placeholder*="مورّد"]',supplierName);
  await evalJs("document.querySelector('.im-add-form').requestSubmit()");
  await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(supplierName)+")"),12000);
  pass("UI creates disposable supplier");
  await navigate("http://127.0.0.1:3000/import/orders");
  await poll(()=>evalJs("!!document.querySelector('.im-order-toolbar')"));
  await click('a[href="/import/orders/new"]');
  await poll(()=>evalJs("location.pathname==='/import/orders/new' && !!document.querySelector('.im-order-editor')"),13000);
  pass("Orders list opens create form");
  const supplierId=await evalJs("(()=>{const o=[...document.querySelectorAll('.im-order-fields select')[0].options].find(x=>x.textContent.includes("+JSON.stringify(supplierName)+"));return o?.value})()");
  if(!supplierId)throw Error("Supplier was not loaded into the order form");
  await select(".im-order-fields select",supplierId,0);
  await enter('input[placeholder="PI-2026-0001"]',"PI-BROWSER-2026");
  await enter('.im-order-line input[type="number"]',500,0);
  await enter('.im-order-line input[type="number"]',2,1);
  await click(".im-add-line");
  await poll(()=>evalJs("document.querySelectorAll('.im-order-line').length===2"));
  await enter('.im-order-line input[type="number"]',2,2);
  await enter('.im-order-line input[type="number"]',1000,3);
  // Four select elements: first line quantity/price, then second line
  // quantity/price. Only the second line is entered in metric tons.
  await select(".im-order-line .im-order-pricing select","TON",2);
  await select(".im-order-line .im-order-pricing select","TON",3);
  console.log("ORDER_QA_FORM_VALUES="+await evalJs("JSON.stringify([...document.querySelectorAll('.im-order-pricing')].map(x=>[...x.querySelectorAll('input,select')].map(y=>y.value)))"));
  await evalJs("document.querySelector('.im-order-editor').requestSubmit()");
  await poll(()=>evalJs("location.pathname.startsWith('/import/orders/') && location.pathname!=='/import/orders/new' && document.querySelector('.im-order-footer strong')?.textContent?.startsWith('PO-')"),20000);
  orderNumber=await evalJs("document.querySelector('.im-order-footer strong')?.textContent");
  if(!/^PO-\d{4}-\d+/.test(orderNumber||""))throw Error("Missing generated PO number");
  try {
    await poll(()=>evalJs("document.body.innerText.includes('3,000.00')"),14000);
  } catch(error) {
    await debugPage("total");
    throw error;
  }
  pass("Order form creates two items with server total 3,000 USD and generated PO number");
  await shot("wathiqa-orders-editor-desktop.png");
  await navigate("http://127.0.0.1:3000/import/orders");
  await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(orderNumber)+")"),15000);
  pass("Orders table displays newly saved purchase order");
  await evalJs("(()=>{const a=[...document.querySelectorAll('.im-order-ref')].find(x=>x.textContent.includes("+JSON.stringify(orderNumber)+"));a.click()})()");
  await poll(()=>evalJs("location.pathname.startsWith('/import/orders/') && !!document.querySelector('.im-order-editor')"),16000);
  await enter('input[placeholder="PI-2026-0001"]',"PI-BROWSER-UPDATED");
  await evalJs("document.querySelector('.im-order-editor').requestSubmit()");
  await poll(()=>evalJs("document.querySelector('input[placeholder=\\\"PI-2026-0001\\\"]')?.value==='PI-BROWSER-UPDATED' && document.body.innerText.includes('3,000.00')"),14000);
  pass("Order detail is editable and keeps server calculated total");
  await navigate("http://127.0.0.1:3000/import/orders");
  await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(orderNumber)+")"));
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(700);
  if(!await evalJs("document.documentElement.scrollWidth<=document.documentElement.clientWidth+2"))
    throw Error("Mobile horizontal overflow in orders list");
  await shot("wathiqa-orders-list-mobile.png");
  pass("Orders list mobile layout fits viewport");
  await command("Emulation.setDeviceMetricsOverride",{width:1360,height:840,deviceScaleFactor:1,mobile:false});
  await evalJs("(()=>{const a=[...document.querySelectorAll('.im-order-ref')].find(x=>x.textContent.includes("+JSON.stringify(orderNumber)+"));const row=a.closest('tr');row.querySelector('.im-table-delete').click()})()");
  await poll(()=>evalJs("!!document.querySelector('[role=alertdialog]')"));
  await click(".dialog-actions .danger");
  await poll(()=>evalJs("!document.body.innerText.includes("+JSON.stringify(orderNumber)+")"),13000);
  pass("User can delete draft order via confirmation without deleting unrelated orders");
  await navigate("http://127.0.0.1:3000/import/companies");
  await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(supplierName)+")"),14000);
  await evalJs("(()=>{let tr=[...document.querySelectorAll('tr')].find(x=>x.textContent.includes("+JSON.stringify(supplierName)+"));tr.querySelector('button.im-table-delete').click()})()");
  await poll(()=>evalJs("!!document.querySelector('[role=alertdialog]')"));
  await click(".dialog-actions .danger");
  await poll(()=>evalJs("!document.body.innerText.includes("+JSON.stringify(supplierName)+")"),14000);
  pass("QA supplier soft-deleted after order soft-deletion");
  console.log("ORDER_BROWSER_PASS_COUNT="+count);
  console.log("SCREENSHOTS=.local/wathiqa-orders-editor-desktop.png,.local/wathiqa-orders-list-mobile.png");
}finally{
  try{socket?.close()}catch{}
  try{
    if(process.platform==="win32"){
      // Kill only this test's process tree, without blocking Node on
      // Windows' taskkill process or keeping CDP handles alive in CI.
      const killer=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],{stdio:"ignore",detached:true});
      killer.unref();
    } else chrome.kill();
  }catch{try{chrome.kill()}catch{}}
}
// Headless Edge may leave CDP/HTTP keep-alive handles even after termination.
// The full test has passed at this point, so exit explicitly to give CI a
// deterministic process status instead of hanging until the runner timeout.
process.exit(0);
