// Read-only UI regression for Wathiqa's Arabic sidebar / orders experience.
// Uses isolated headless Edge/Chrome with mocked import API responses; no DB,
// credentials, mutations, or ShipsGo API calls. Run against local Next on :3000.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");mkdirSync(local,{recursive:true});
const browser=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if(!browser)throw Error("Edge or Chrome required");
const staff=process.argv.includes("--staff");
const profile=join(local,"wathiqa-ux-qa-"+process.pid+"-"+Date.now());
const chrome=spawn(browser,[
 "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
 "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+profile,"about:blank"
],{stdio:"ignore"});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function poll(fn,ms=24000){const end=Date.now()+ms;let error;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){error=e;}await sleep(220);}throw Error("Timed out"+(error?": "+error.message:""));}
const order={
 id:"00000000-0000-0000-0000-000000000001",number:"PO-2026-0001",supplierId:"supplier-1",
 supplierNameSnapshot:"xfm",supplierRef:"INV-2026-01",orderDate:"2026-10-22",currency:"USD",
 totalAmount:105838.65,paidAmount:0,remainingAmount:105838.65,paymentStatus:"Unpaid",
 isPaymentOverdue:false,unresolvedDifference:0,closedWithExceptions:false,
 arrivalStatus:"AtSea",clearanceStatus:"NotStarted",quantityKg:75330,containerCount:2,
 deliveredContainerCount:0,eta:null,status:"Draft",revision:1,itemCount:3
};
const user={
 id:"qa-user",email:"qa@example.invalid",displayName:"مستخدم تجربة",tenantId:"qa-tenant",
 name:"شركة تجريبية",slug:"qa",role:staff?"Staff":"Admin",canManagePayments:!staff,
 permissions:staff?["nav.dashboard","nav.orders"]:[],accessExpiresAtUtc:null
};
const page={page:1,pageSize:25,total:1,items:[order],financialsAvailable:true,
 summaries:[{currency:"USD",orderCount:1,totalAmount:105838.65,paidAmount:0,remainingAmount:105838.65}]};
let socket=null,sequence=0;const pending=new Map();
const pass=(message)=>console.log("PASS "+message);
try {
 const port=await poll(()=>{const path=join(profile,"DevToolsActivePort");return existsSync(path)?Number(readFileSync(path,"utf8").split(/\r?\n/)[0]):0;});
 const tabs=await poll(async()=>{const response=await fetch("http://127.0.0.1:"+port+"/json/list");return response.ok?response.json():null;});
 const tab=tabs.find(x=>x.type==="page");assert.ok(tab);
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 function send(method,params={}){return new Promise((resolve,reject)=>{
  const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout "+method));},20000);
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
 });}
 socket.addEventListener("message",msg=>{
  const data=JSON.parse(msg.data);
  if(data.method==="Fetch.requestPaused"){
    const {requestId,request}=data.params;
    let response;
    if(request.url.includes("/api/auth/me")) response=user;
    else if(request.url.includes("/api/companies/options")) response=[{id:"supplier-1",name:"xfm",type:"Supplier"}];
    else if(request.url.includes("/api/orders")) response=page;
    else response={error:"mock_route_not_available"};
    const body=Buffer.from(JSON.stringify(response)).toString("base64");
    void send("Fetch.fulfillRequest",{requestId,responseCode:200,
     responseHeaders:[{name:"Content-Type",value:"application/json"}],body}).catch(console.error);
    return;
  }
  if(!data.id||!pending.has(data.id))return;
  const p=pending.get(data.id);pending.delete(data.id);clearTimeout(p.timer);
  data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);
 });
 await send("Page.enable");await send("Runtime.enable");
 await send("Fetch.enable",{patterns:[{urlPattern:"*://127.0.0.1:3000/import-api/api/*",requestStage:"Request"}]});
 async function evalJs(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error("Browser JS error "+JSON.stringify(r.exceptionDetails));return r.result.value;}
 async function go(url){await send("Page.navigate",{url:"http://127.0.0.1:3000"+url});await poll(()=>evalJs("document.readyState==='complete'"));}
 async function screenshot(file){const r=await send("Page.captureScreenshot",{format:"jpeg",quality:80,captureBeyondViewport:false});writeFileSync(join(local,staff?file.replace("ux-","ux-staff-"):file),Buffer.from(r.data,"base64"));}
 await send("Emulation.setDeviceMetricsOverride",{width:1440,height:940,deviceScaleFactor:1,mobile:false});
 await go("/import/orders");
 await poll(()=>evalJs("document.querySelectorAll('.im-report-orders-table tbody tr').length===1"));
 assert.equal(await evalJs("document.querySelectorAll('.im-nav-group .im-nav-link').length"),staff?2:6);
 if(staff){
   assert.equal(await evalJs("document.querySelectorAll('.im-order-create-actions a').length"),0);
   assert.ok(await evalJs("!!document.querySelector('.im-order-readonly-notice')"));
 }
 pass("Navigation groups and permission-filtered links render");
 assert.equal(await evalJs("document.querySelectorAll('.im-orders-stat').length"),4);
 assert.equal(await evalJs("document.querySelector('.im-orders-filter-advanced').hidden"),true);
 pass("Orders show four summary cards and compact default filters");
 const filterLayout=await evalJs("(()=>{const shell=document.querySelector('.im-orders-results').getBoundingClientRect();const row=document.querySelector('.im-orders-filter-main').getBoundingClientRect();return {shell:shell.width,row:row.width};})()");
 assert.ok(filterLayout.row>filterLayout.shell*.85,"filters should span card width "+JSON.stringify(filterLayout));
 pass("Primary search fields use the full available filter card width");
 const before=await evalJs("Math.round(document.querySelector('.im-sidebar').getBoundingClientRect().width)");
 assert.ok(before>=250&&before<=300, "desktop expanded sidebar width "+before);
 await screenshot("wathiqa-ux-orders-desktop.jpg");
 await evalJs("document.querySelector('.im-orders-advanced-toggle').click()");
 assert.equal(await evalJs("document.querySelector('.im-orders-filter-advanced').hidden"),false);
 assert.ok(await evalJs("document.querySelector('[aria-label=\"ترتيب النتائج\"]')!==null"));
 pass("Advanced filters expand without losing their inputs");
 await evalJs("document.querySelector('.im-collapse-desktop').click()");
 await poll(()=>evalJs("document.querySelector('.im-app').classList.contains('im-layout-compact')"));
 await sleep(350);
 const compact=await evalJs("Math.round(document.querySelector('.im-sidebar').getBoundingClientRect().width)");
 assert.ok(compact>=78&&compact<=86, "compact width "+compact);
 assert.equal(await evalJs("localStorage.getItem('wathiqa.import.sidebar.compact')"),"yes");
 pass("Desktop sidebar collapses to an icon rail and saves preference");
 await go("/import/orders");
 await poll(()=>evalJs("!!document.querySelector('.im-collapse-desktop')"));
 await poll(()=>evalJs("document.querySelector('.im-app').classList.contains('im-layout-compact')"));
 pass("Compact sidebar preference persists across navigation");
 await screenshot("wathiqa-ux-orders-compact.jpg");
 await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(650);
 const mobile=await evalJs("({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,mainMargin:getComputedStyle(document.querySelector('.im-main')).marginRight,navWidth:document.querySelector('.im-sidebar').getBoundingClientRect().width})");
 assert.ok(mobile.scroll<=mobile.client+2,"mobile horizontal overflow "+JSON.stringify(mobile));
 assert.equal(parseFloat(mobile.mainMargin),0);
 assert.ok(mobile.navWidth>250,"mobile drawer uses full width "+JSON.stringify(mobile));
 pass("390px RTL mobile layout has no page overflow and uses full-width drawer");
 await screenshot("wathiqa-ux-orders-mobile.jpg");
 await evalJs("document.querySelector('.im-menu-btn').click()");
 await poll(()=>evalJs("document.querySelector('.im-sidebar').classList.contains('is-open')"));
 await poll(()=>evalJs("document.activeElement?.classList.contains('im-close-mobile')"));
 await sleep(450);
 const drawer=await evalJs("(()=>{const r=document.querySelector('.im-sidebar').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth};})()");
 assert.ok(drawer.left>=0&&drawer.right<=drawer.viewport+2&&drawer.width>250,
   "mobile drawer must finish entirely on screen "+JSON.stringify(drawer));
 assert.ok(await evalJs("document.querySelector('.im-backdrop')!==null"));
 await screenshot("wathiqa-ux-sidebar-mobile.jpg");
 await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
 await poll(()=>evalJs("!document.querySelector('.im-sidebar').classList.contains('is-open')"));
 await poll(()=>evalJs("document.activeElement?.classList.contains('im-menu-btn')"));
 pass("Mobile menu traps focus, overlays page, closes with Escape and restores focus");
 console.log("WATHIQA_UX_BROWSER_QA=PASS role="+(staff?"Staff":"Admin"));
 console.log("SCREENSHOTS=.local/wathiqa-ux-orders-desktop.jpg,.local/wathiqa-ux-orders-compact.jpg,.local/wathiqa-ux-orders-mobile.jpg,.local/wathiqa-ux-sidebar-mobile.jpg");
} catch(error){
 console.error("WATHIQA_UX_BROWSER_QA=FAIL",error);
 process.exitCode=1;
} finally {
 try{socket?.close();}catch{}
 try{const killer=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],{stdio:"ignore",detached:true});killer.unref();}catch{chrome.kill();}
}
process.exit(process.exitCode||0);
