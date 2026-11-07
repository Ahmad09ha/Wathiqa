import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const local = path.join(process.cwd(), ".local");
mkdirSync(local, { recursive: true });
const accounts = JSON.parse(readFileSync(path.join(local, "import-demo-accounts.json"), "utf8").replace(/^\uFEFF/, ""));
const admin = accounts.find(x => x.slug === "demo-a");
if (!admin) throw new Error("Demo A account was not bootstrapped");
const chromeExecutable = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(existsSync);
if (!chromeExecutable) throw new Error("Headless Chrome/Edge unavailable");
const chrome = spawn(chromeExecutable, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9227", "--remote-allow-origins=*",
  "--user-data-dir=" + path.join(local, "import-browser-qa-profile"), "about:blank"
], {stdio:"ignore"});

const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function waitFor(fn, timeout = 18000) {
  const end = Date.now()+timeout;
  let error;
  while(Date.now()<end){
    try{const value=await fn();if(value) return value;}
    catch(e){error=e;}
    await sleep(250);
  }
  throw new Error("Timed out waiting for browser state"+(error?" ("+error.message+")":""));
}
let socket, count = 0;
const passed = msg => {console.log("PASS "+msg);count++;};
try{
  const pages = await waitFor(async()=>{
    const r=await fetch("http://127.0.0.1:9227/json/list");
    return r.ok? await r.json():null;
  });
  const target=pages.find(p=>p.type==="page");
  if(!target)throw new Error("Missing browser target");
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener("open",resolve,{once:true});
    socket.addEventListener("error",reject,{once:true});
  });
  let number=0;
  const pending=new Map();
  socket.addEventListener("message",event=>{
    const msg=JSON.parse(event.data);
    if(!msg.id || !pending.has(msg.id))return;
    const task=pending.get(msg.id);pending.delete(msg.id);
    if(msg.error) task.reject(new Error(JSON.stringify(msg.error)));
    else task.resolve(msg.result);
  });
  function command(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++number; pending.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
      setTimeout(()=>{if(pending.delete(id))reject(new Error("CDP timeout "+method));},13000);
    });
  }
  async function evalJs(expression){
    const result=await command("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function goto(url){
    await command("Page.navigate",{url});
    await waitFor(()=>evalJs("document.readyState==='complete'"),12000);
  }
  async function screenshot(name){
    const response=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(path.join(local,name),Buffer.from(response.data,"base64"));
  }
  async function fill(selector,value){
    const code="(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"
      +"if(!el)throw Error('Missing input');"
      +"const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
      +"setter.call(el,"+JSON.stringify(value)+");"
      +"el.dispatchEvent(new Event('input',{bubbles:true}));return true})()";
    await evalJs(code);
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride",{width:1366,height:850,deviceScaleFactor:1,mobile:false});
  await goto("http://localhost:3000/import/login");
  await waitFor(()=>evalJs("document.querySelector('#import-email')!==null"));
  if(!await evalJs("document.documentElement.dir==='rtl' && document.body.innerText.includes('تسجيل الدخول')"))
    throw new Error("Arabic login not rendered");
  passed("Arabic login form renders on Wathiqa route");
  await evalJs("document.querySelector('a.im-join-back').click()");
  await waitFor(()=>evalJs("location.pathname==='/import/join' && !!document.querySelector('#invite-token')"),10000);
  passed("Invited employee can open secure account activation form");
  await evalJs("document.querySelector('a.im-join-back').click()");
  await waitFor(()=>evalJs("location.pathname==='/import/login' && !!document.querySelector('#import-email')"),10000);
  await fill("#import-email",admin.email);
  await fill("#import-password",admin.password);
  await evalJs("(()=>{document.querySelector('form').requestSubmit();return true})()");
  await waitFor(()=>evalJs("location.pathname==='/import' && document.body.innerText.includes('Demo Merchant A')"),21000);
  passed("Real browser form creates authenticated tenant session through Next.js rewrite");
  if(!await evalJs('(()=>{const el=document.querySelector(".im-sidebar");const r=el.getBoundingClientRect();return getComputedStyle(el).position==="fixed"&&Math.abs(r.right-document.documentElement.clientWidth)<3})()'))
    throw new Error("New sidebar not fixed on the right");
  passed("Authenticated right-side sidebar is fixed");
  await screenshot("wathiqa-import-dashboard.png");
  await evalJs('document.querySelector("a.im-nav-link[href=\\"/import/companies\\"]").click()');
  await waitFor(()=>evalJs("location.pathname==='/import/companies' && document.body.innerText.includes('الجهات والشركات')"),14000);
  passed("Merchant companies navigation loads");
  await evalJs("(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent.includes('إضافة جهة')).click();return true})()");
  await waitFor(()=>evalJs("!!document.querySelector('input[placeholder*=\\\"مورّد\\\"]')"),6000);
  const name="Browser QA Supplier "+Date.now().toString().slice(-8);
  await fill('input[placeholder*="مورّد"]',name);
   await evalJs("(()=>{document.querySelector('.im-add-form').requestSubmit();return true})()");
   await waitFor(()=>evalJs("document.body.innerText.includes("+JSON.stringify(name)+")"),14000);
   passed("Browser creates tenant-owned company with Arabic UI");
   await evalJs("(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes("+JSON.stringify(name)+"));if(!row)throw Error('QA company row missing');row.querySelector('button.im-table-edit').click();return true})()");
   await waitFor(()=>evalJs("document.querySelector('.im-add-form')?.innerText.includes('تعديل بيانات الجهة')"),7000);
   await fill('.im-company-extra-fields input[type="email"]','browser-contact@example.invalid');
   await evalJs("document.querySelector('.im-add-form').requestSubmit()");
   await waitFor(()=>evalJs("!document.querySelector('.im-add-form')"),13000);
   passed("Browser edits contact details of an existing Company");
   await evalJs("(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes("+JSON.stringify(name)+"));if(!row)throw Error('QA company row missing');row.querySelector('button.im-table-edit').click();return true})()");
   await waitFor(()=>evalJs("document.querySelector('.im-company-extra-fields input[type=\\\"email\\\"]')?.value==='browser-contact@example.invalid'"),7500);
   passed("Edited company contact email survives API reload");
   await evalJs("(()=>{document.querySelector('.im-add-form .im-company-form-actions button.btn-outline').click();return true})()");
   await waitFor(()=>evalJs("!document.querySelector('.im-add-form')"),5000);
   // The new directory uses server-side type/search filtering, not just a
   // client-side filter over an unbounded company array.
   await evalJs("(()=>{const el=document.querySelector('.im-company-filter-type');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'Broker');el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
   await waitFor(()=>evalJs("document.body.innerText.includes('لا توجد نتائج مطابقة')"),12000);
   await evalJs("(()=>{const el=document.querySelector('.im-company-filter-type');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'Supplier');el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
   await waitFor(()=>evalJs("[...document.querySelectorAll('tbody tr')].some(r=>r.innerText.includes("+JSON.stringify(name)+"))"),12000);
   passed("Directory server-side type filter removes/restores the searched company");
   // Delete only the company created by THIS QA run, never the first merchant
   // table row (which might be an actual existing customer record).
   await evalJs("(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes("+JSON.stringify(name)+"));if(!row)throw Error('QA company row missing');row.querySelector('button.im-table-delete').click();return true})()");
  await waitFor(()=>evalJs("!!document.querySelector('[role=alertdialog]')"),6000);
  await evalJs("document.querySelector('.dialog-actions .danger').click()");
  await waitFor(()=>evalJs("!document.body.innerText.includes("+JSON.stringify(name)+")"),15000);
  passed("Browser delete confirmation soft-deletes company");
  await evalJs('document.querySelector("a.im-nav-link[href=\\"/import/team\\"]").click()');
  await waitFor(()=>evalJs("location.pathname==='/import/team' && document.body.innerText.includes('أعضاء الشركة')"),13000);
  if(!await evalJs("document.body.innerText.includes('دعوة موظف') && document.body.innerText.includes('الصلاحيات المالية')"))
    throw new Error("Team management features are missing");
  passed("Admin staff/permission management renders");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(600);
  if(!await evalJs("document.documentElement.scrollWidth <= document.documentElement.clientWidth+2"))
    throw new Error("Mobile horizontal overflow");
  passed("Mobile interface does not overflow");
  await evalJs("document.querySelector('.im-menu-btn').click()");
  await waitFor(()=>evalJs('(()=>{const r=document.querySelector(".im-sidebar").getBoundingClientRect();return Math.abs(r.right-document.documentElement.clientWidth)<3})()'),6000);
  passed("Mobile navigation opens from the right");
  await screenshot("wathiqa-import-mobile.png");
  await evalJs("document.querySelector('.im-close-mobile').click()");
  await waitFor(()=>evalJs("!document.querySelector('.im-sidebar').classList.contains('is-open')"));
  passed("Mobile menu closes");
  await command("Emulation.setDeviceMetricsOverride",{width:1366,height:850,deviceScaleFactor:1,mobile:false});
  await evalJs("document.querySelector('.im-logout').click()");
  await waitFor(()=>evalJs("location.pathname==='/import/login'"),15000);
  passed("Logout returns browser to sign-in");
  console.log("IMPORT_BROWSER_PASS_COUNT="+count);
  console.log("SCREENSHOTS=.local/wathiqa-import-dashboard.png,.local/wathiqa-import-mobile.png");
}finally{
  try{socket?.close();}catch{}
  try{chrome.kill();}catch{}
}
