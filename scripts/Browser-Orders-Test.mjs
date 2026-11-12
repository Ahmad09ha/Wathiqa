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
let orderNumber=null, orderId=null;
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
    const x=JSON.parse(e.data);
    if(!x.id||!pending.has(x.id))return;
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
  try { await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(supplierName)+")"),15000); } catch(error) {await debugPage("supplier-create");throw error;}
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
  orderId=await evalJs("location.pathname.split('/').at(-1)");
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
  // WP-10: exercise the new private file flow on this disposable QA order.
  // Keep the legacy order creation test intact, then attach/reopen/delete one QA PDF.
  const qaPdf=join(local,"bilingual-contract.pdf");
  if(!existsSync(qaPdf))throw Error("Local QA PDF fixture missing");
  await navigate("http://127.0.0.1:3000/import/orders/"+orderId+"?mode=file");
  await poll(()=>evalJs("!!document.querySelector('.im-file-workspace .im-file-tabs')"),16000);
  await poll(()=>evalJs("!!document.querySelector('.im-file-picker input[type=file]')"));
  await command("DOM.enable");
  const dom=await command("DOM.getDocument",{depth:2});
  const picker=await command("DOM.querySelector",{
    nodeId:dom.root.nodeId,selector:".im-file-picker input[type=file]"
  });
  if(!picker.nodeId)throw Error("Private document picker missing");
  await command("DOM.setFileInputFiles",{nodeId:picker.nodeId,files:[qaPdf]});
  await poll(()=>evalJs("!!document.querySelector('.im-file-preview-frame iframe[src^=\"blob:\"]')"));
  pass("File-first workspace previews the local PDF before upload");
  await poll(()=>evalJs("!!document.querySelector('.im-file-upload-row button:not(:disabled)')"));
  await click(".im-file-upload-row button");

  try { await poll(()=>evalJs("!!document.querySelector('.im-file-doc-picker select')"),26000); } catch(error) { await debugPage("file-upload"); throw error; }
  const uploaded=await poll(()=>evalJs("(async()=>{const r=await fetch('/import-api/api/documents?orderId="+
    orderId+"&page=1&pageSize=100',{credentials:'include'});if(!r.ok)return null;"+
    "return (await r.json()).items.find(x=>x.originalFileName==='bilingual-contract.pdf'&&x.type==='Contract')||null;})()"),30000);
  if(!uploaded?.id || !uploaded.links?.some(x=>x.orderId===orderId))
    throw Error("File upload not linked to the temporary order");
  const previewStatus=await evalJs("(async()=>{const r=await fetch('/import-api/api/documents/"+
    uploaded.id+"/preview',{credentials:'include'});return {status:r.status,contentType:r.headers.get('content-type')};})()");
  if(previewStatus.status!==200 || !String(previewStatus.contentType).includes("application/pdf"))
    throw Error("Private PDF preview cannot be loaded after upload");
  pass("UI stores PDF on the correct Order and protected preview is retrievable");
  await navigate("http://127.0.0.1:3000/import/orders/"+orderId+"?mode=file");
  await poll(()=>evalJs("!!document.querySelector('.im-file-doc-picker select') && !!document.querySelector('.im-file-preview-frame iframe[src*=\"/preview\"]')"),30000);
  pass("Saved PDF remains selectable and visible after reopening the Order");
  const savedTabs=[
    ["دفوعات",".im-finance"],
    ["بوليصة",".im-logistics-view-bl"],
    ["تخليص",".im-logistics-view-customs"],
    ["تتبع",".im-track"]
  ];
  for(const [name,selector] of savedTabs){
    await evalJs("([...document.querySelectorAll('.im-file-tabs button')].find(x=>x.textContent.includes("+
      JSON.stringify(name)+"))).click()");
    await poll(()=>evalJs("!!document.querySelector("+JSON.stringify(selector)+")"),16000);
    pass("Existing Order opens the "+name+" tab");
  }
  // Soft-delete only the PDF uploaded by this disposable QA test, retaining audit.
  const cleaned=await evalJs("(async()=>{const r=await fetch('/import-api/api/auth/csrf',"+
    "{credentials:'include'});if(!r.ok)return r.status;const token=(await r.json()).token;"+
    "const deleted=await fetch('/import-api/api/documents/"+uploaded.id+
    "',{method:'DELETE',credentials:'include',headers:{'X-Wathiqa-CSRF':token}});return deleted.status;})()");
  if(cleaned!==204)throw Error("QA document cleanup failed: "+cleaned);
  pass("Uploaded QA document soft-deleted before temporary Order cleanup");
  // Create a second disposable Order with the source PDF selected BEFORE save.
  // This covers the original user journey (file first, then order fields).
  await navigate("http://127.0.0.1:3000/import/orders/from-file");
  await poll(()=>evalJs("!!document.querySelector('.im-file-workspace .im-order-editor')"),16000);
  await waitHydratedForm(".im-order-editor");
  await select(".im-order-fields select",supplierId,0);
  await enter('input[placeholder="CONT-2026-001"]',"WP10-CONT-"+Date.now().toString().slice(-8));
  const creationDoc=await command("DOM.getDocument",{depth:2});
  const creationInput=await command("DOM.querySelector",{
    nodeId:creationDoc.root.nodeId,selector:".im-file-picker input[type=file]"
  });
  if(!creationInput.nodeId)throw Error("New file-first Order has no source picker");
  await command("DOM.setFileInputFiles",{nodeId:creationInput.nodeId,files:[qaPdf]});
  await poll(()=>evalJs("!!document.querySelector('.im-file-preview-frame iframe[src^=\"blob:\"]')"));
  pass("New file-first Order accepts its PDF before any Order exists");
  await evalJs("document.querySelector('.im-order-editor').requestSubmit()");
  try {
    await poll(()=>evalJs("location.pathname.startsWith('/import/orders/')&&"+
      "location.pathname!=='/import/orders/from-file'&&location.search.includes('mode=file')&&"+
      "!!document.querySelector('.im-file-doc-picker select')"),35000);
  }catch(error){await debugPage("file-first-create");throw error}
  const createdFileOrderId=await evalJs("location.pathname.split('/').at(-1)");
  if(createdFileOrderId===orderId)throw Error("File-first creation did not make an independent Order");
  const createdFileOrderNumber=await evalJs("document.querySelector('.im-order-footer strong')?.textContent");
  if(!/^PO-\d{4}-\d+/.test(createdFileOrderNumber||""))throw Error("New file-first Order missing PO number");
  const createdFiles=await evalJs("(async()=>{const r=await fetch('/import-api/api/documents?orderId="+
    createdFileOrderId+"&page=1&pageSize=100',{credentials:'include'});"+
    "return r.ok?(await r.json()).items:null;})()");
  const newlyUploaded=createdFiles?.find(x=>x.originalFileName==="bilingual-contract.pdf");
  if(!newlyUploaded?.links?.some(x=>x.orderId===createdFileOrderId))
    throw Error("File-first creation did not store its reference PDF");
  pass("Create-from-file saves Order, then attaches private PDF by OrderId");
  const removed=await evalJs("(async()=>{const c=await fetch('/import-api/api/auth/csrf',{credentials:'include'});"+
    "const token=(await c.json()).token;return (await fetch('/import-api/api/documents/"+
    newlyUploaded.id+"',{method:'DELETE',credentials:'include',headers:{'X-Wathiqa-CSRF':token}})).status;})()");
  if(removed!==204)throw Error("Second QA reference document cleanup failed "+removed);
  await navigate("http://127.0.0.1:3000/import/orders");
  await poll(()=>evalJs("document.body.innerText.includes("+JSON.stringify(createdFileOrderNumber)+")"));
  await evalJs("(()=>{const a=[...document.querySelectorAll('.im-order-ref')].find(x=>x.textContent.includes("+
    JSON.stringify(createdFileOrderNumber)+"));a.closest('tr').querySelector('.im-table-delete').click()})()");
  await poll(()=>evalJs("!!document.querySelector('[role=alertdialog]')"));
  await click(".dialog-actions .danger");
  await poll(()=>evalJs("!document.body.innerText.includes("+JSON.stringify(createdFileOrderNumber)+")"),15000);
  pass("File-first QA source and Order removed without touching other Orders");


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
