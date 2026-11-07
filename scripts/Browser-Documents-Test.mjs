// WP-07: real browser upload, private preview, multiple document links,
// Admin checklist and mobile layout. QA fixtures cleaned by targeted script.
import {spawn} from "node:child_process";
import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
const local=join(process.cwd(),".local");
mkdirSync(local,{recursive:true});
const run="WP07_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const fixture={run,orders:[],companies:[],shipments:[],containers:[],documents:[],requirements:[],waivers:[]};
const fixturePath=join(local,"documents-qa-fixtures-"+run+".json");
const persist=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
function track(kind,id){if(!fixture[kind].some(x=>x.id===id)){fixture[kind].push({tenant:"A",id});persist()}}
persist();
function pdfSample(){
 let pdf="%PDF-1.4\n";
 const offsets=[0];
 const content="BT /F1 15 Tf 60 700 Td (Wathiqa Private Document QA) Tj ET";
 const objects=[
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  "<< /Length "+Buffer.byteLength(content)+" >>\nstream\n"+content+"\nendstream",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
 ];
 for(const [i,obj] of objects.entries()){
  offsets.push(Buffer.byteLength(pdf));
  pdf+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";
 }
 const start=Buffer.byteLength(pdf);
 pdf+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";
 for(const offset of offsets.slice(1))
  pdf+=String(offset).padStart(10,"0")+" 00000 n \n";
 pdf+="trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n";
 return Buffer.from(pdf);
}
const pdfName="wathiqa-private-qa-"+run+".pdf";
const pdfPath=join(local,pdfName);
writeFileSync(pdfPath,pdfSample());
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const admin=accounts.find(x=>x.slug==="demo-a");
assert(admin,"Missing demo merchant");
const cookies={};
let csrf="";
async function api(path,method="GET",body){
 const headers={Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
 if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const response=await fetch("http://127.0.0.1:5089"+path,{method,headers,
  body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie?.()||[]){
  const m=value.match(/^([^=;]+)=([^;]*)/);if(m)cookies[m[1]]=m[2];
 }
 if(!response.ok)throw Error(method+" "+path+" returned "+response.status+" "+await response.text());
 return response.status===204?null:response.json();
}
const init=await api("/api/auth/csrf");csrf=init.token;
await api("/api/auth/login","POST",{email:admin.email,password:admin.password});
csrf=(await api("/api/auth/csrf")).token;
const supplier=await api("/api/companies","POST",{name:run+" browser QA supplier",type:"Supplier"});
track("companies",supplier.id);
const order=await api("/api/orders","POST",{
 supplierId:supplier.id,customerId:null,supplierRef:run,orderDate:"2026-11-06",
 incoterm:"FOB",loadingPort:"Ningbo",dischargePort:"Latakia",currency:"USD",notes:run,
 revision:null,items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",
 colorType:"Raw White",quantity:1000,quantityUnit:"KG",unitPrice:1,priceUnit:"KG",hsCode:"540246"}]
});
track("orders",order.id);
const shipment=await api("/api/orders/"+order.id+"/shipments","POST",{
 blNumber:run+"-BL",blType:"Original",blOriginalStatus:"NotReceived",
 shippingLineId:null,vessel:"MV Wathiqa",voyage:"QA-1",portOfLoading:"Ningbo",
 portOfDischarge:"Latakia",etd:null,eta:null,freeTimeDays:14,trackingUrl:"",revision:null
});
track("shipments",shipment.id);
function checkDigit(prefix){let s=0;for(let i=0;i<10;i++){
 const c=prefix[i];let n=/\d/.test(c)?Number(c):10+c.charCodeAt(0)-65;
 if(/[A-Z]/.test(c))n+=Math.floor((n-1)/10);s+=n*2**i;
}return String((s%11)%10)}
for(const number of ["CSQU3054383","MSCU123456"+checkDigit("MSCU123456")]){
 const c=await api("/api/shipments/"+shipment.id+"/containers","POST",{
  number,size:"40",sealNumber:"QA",grossWeightKg:19000,netWeightKg:15000,
  status:"Planned",acknowledgeInvalidDigit:false,arrivedAtPortDate:null,
  deliveredDate:null,freeTimeEndDate:null,revision:null
 });
 track("containers",c.id);
}
const edge=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if(!edge)throw Error("Edge/Chrome missing");
const profile=join(local,"browser-documents-"+process.pid+"-"+Date.now());
const browser=spawn(edge,["--headless=new","--disable-gpu","--no-first-run",
 "--remote-debugging-port=0","--remote-allow-origins=*",
 "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
async function poll(test,timeout=18000){
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){try{const value=await test();if(value)return value}catch(error){last=error}await sleep(260)}
 throw Error("Browser timeout"+(last?": "+last.message:""));
}
let socket,checks=0,seq=0;
const requests=new Map();
function pass(label){checks++;console.log("PASS "+label)}
try{
 const port=await poll(()=>{
  const path=join(profile,"DevToolsActivePort");
  return existsSync(path)?Number(readFileSync(path,"utf8").split(/\r?\n/)[0]):0;
 },18000);
 const tabs=await poll(async()=>{
  const r=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(1800)});
  return r.ok?await r.json():null;
 });
 const tab=tabs.find(x=>x.type==="page");assert(tab,"No CDP browser page");
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true});
 });
 socket.addEventListener("message",event=>{
  const obj=JSON.parse(event.data);
  if(!obj.id||!requests.has(obj.id))return;
  const entry=requests.get(obj.id);requests.delete(obj.id);
  clearTimeout(entry.timer);
  if(obj.error)entry.reject(Error(JSON.stringify(obj.error)));
  else entry.resolve(obj.result);
 });
 function command(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{if(requests.delete(id))reject(Error("CDP timeout "+method))},16000);
   requests.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error("JS exception "+JSON.stringify(result.exceptionDetails));
  return result.result.value;
 }
 async function navigate(url){
  await command("Page.navigate",{url});
  await poll(()=>evaluate("document.readyState==='complete'"),18000);
 }
 async function fill(selector,value){
  return evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing input');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
   "setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function click(selector){
  return evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing clickable');e.click();return true})()");
 }
 async function select(selector,value){
  return evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing select');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
   "setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 }
 async function shot(name){
  const result=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(local,name),Buffer.from(result.data,"base64"));
 }
 await command("Page.enable");
 await command("Runtime.enable");
 await command("DOM.enable");
 await command("Emulation.setDeviceMetricsOverride",{width:1360,height:845,deviceScaleFactor:1,mobile:false});
 await navigate("http://127.0.0.1:3000/import/login");
 await poll(()=>evaluate("(()=>{const f=document.querySelector('form');if(!f)return false;const k=Object.keys(f).find(x=>x.startsWith('__reactProps$'));return Boolean(k&&f[k]?.onSubmit)})()"));
 await fill("#import-email",admin.email);
 await fill("#import-password",admin.password);
 await evaluate("document.querySelector('form').requestSubmit()");
 await poll(()=>evaluate("location.pathname==='/import'&&document.body.innerText.includes('طلبات الشراء')"),23000);
 pass("Authenticated merchant browser session established");
 await navigate("http://127.0.0.1:3000/import/orders/"+order.id);
 await poll(()=>evaluate("!!document.querySelector('.im-documents .im-doc-upload') && !!document.querySelector('.im-logistics')"),18000);
 pass("Document upload and checklist rendered inside Purchase Order");
 await evaluate("(()=>{const b=[...document.querySelectorAll('.im-doc-target-modes button')].find(x=>x.textContent.includes('حاويات محددة'));b.click();return true})()");
 await poll(()=>evaluate("document.querySelectorAll('.im-doc-container-choice').length===2"),10000);
 await evaluate("(()=>{const c=[...document.querySelectorAll('.im-doc-container-choice input')];c[0].click();c[1].click();return true})()");
 await poll(()=>evaluate("document.querySelectorAll('.im-doc-container-choice input:checked').length===2"),5000);
 pass("User selects two containers as targets for one B/L file");
 const documentNode=(await command("DOM.getDocument",{depth:1})).root.nodeId;
 const query=await command("DOM.querySelector",{nodeId:documentNode,selector:".im-doc-drop input[type=file]"});
 assert(query.nodeId>0,"File picker DOM missing");
 await command("DOM.setFileInputFiles",{nodeId:query.nodeId,files:[pdfPath]});
 await poll(()=>evaluate("document.querySelector('.im-doc-drop strong')?.textContent?.includes("+JSON.stringify(pdfName)+")"),12000);
 pass("Real browser file input accepts selected PDF");
 await evaluate("document.querySelector('form.im-doc-upload').requestSubmit()");
 await poll(()=>evaluate("document.querySelectorAll('.im-doc-row').length===1 && document.querySelectorAll('.im-doc-row .im-doc-link-chip').length===2"),22000);
 pass("Browser upload saves one document linked to two containers");
 const allDocs=await api("/api/documents?orderId="+order.id);
 assert.equal(allDocs.total,1);
 track("documents",allDocs.items[0].id);
 const docId=allDocs.items[0].id;
 // Upload opens the newly saved PDF preview automatically; clicking the
 // Preview button immediately would toggle it CLOSED.
 if(!await evaluate("!!document.querySelector('.im-doc-preview iframe')"))
   await click(".im-doc-row-actions button");
 await poll(()=>evaluate("!!document.querySelector('.im-doc-preview iframe')"),9000);
 const previewHttp=await evaluate("(async()=>{const f=document.querySelector('.im-doc-preview iframe');const r=await fetch(f.src,{credentials:'same-origin'});return {ok:r.ok,mime:r.headers.get('content-type'),noSniff:r.headers.get('x-content-type-options')}})()");
 assert(previewHttp.ok && previewHttp.mime==="application/pdf" && previewHttp.noSniff==="nosniff");
 pass("Same-origin PDF preview authenticated and nosniff protected");
 await evaluate("document.querySelector('.im-doc-preview').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(2600);
 await shot("wathiqa-documents-pdf-preview.png");
 await evaluate("(()=>{document.querySelector('.im-doc-add-link').click();return true})()");
 await poll(()=>evaluate("!!document.querySelector('.im-doc-relink')"));
 await evaluate("(()=>{const b=[...document.querySelectorAll('.im-doc-relink .im-doc-target-modes button')].find(x=>x.textContent.includes('بوليصة شحن'));b.click();return true})()");
 await poll(()=>evaluate("!!document.querySelector('.im-doc-relink select')"));
 await click(".im-doc-relink .btn.primary");
 await poll(()=>evaluate("document.querySelectorAll('.im-doc-row .im-doc-link-chip').length===3"),18000);
 pass("Same PDF linked to owning B/L without re-upload");
 await click(".im-doc-requirements .im-doc-section-heading button");
 await poll(()=>evaluate("!!document.querySelector('.im-doc-rule-form')"));
 await evaluate("document.querySelector('.im-doc-rule-form').requestSubmit()");
 await poll(()=>evaluate("document.querySelector('.im-doc-checklist')?.innerText.includes('مكتمل')"),18000);
 const rules=await api("/api/document-requirements");
 const found=rules.find(r=>r.targetType==="Shipment"&&r.stage==="Any"&&r.documentType==="BillOfLading");
 assert(found,"Browser admin rule was not saved");
 track("requirements",found.id);
 pass("Admin enables B/L checklist requirement and document satisfies it");
 await evaluate("document.querySelector('.im-documents').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(700);
 await shot("wathiqa-documents-desktop.png");
 await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(550);
 const overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
 if(overflow>2)throw Error("Document page horizontal overflow "+overflow);
 await evaluate("document.querySelector('.im-documents').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(450);
 await shot("wathiqa-documents-mobile.png");
 pass("Document section mobile layout fits viewport");
 console.log("DOCUMENT_BROWSER_PASS_COUNT="+checks);
 console.log("SCREENSHOTS=.local/wathiqa-documents-desktop.png,.local/wathiqa-documents-mobile.png");
}catch(error){
 console.error("DOCUMENT_BROWSER_FAILED",error);
 try{
  const state=await (async()=>{if(!socket||socket.readyState!==WebSocket.OPEN)return null;
   const id=998;
   return new Promise(resolve=>{
    const handler=event=>{
     const x=JSON.parse(event.data);if(x.id!==id)return;
     socket.removeEventListener("message",handler);resolve(x.result?.result?.value||x.error);
    };
    socket.addEventListener("message",handler);
    socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:"(()=>({url:location.href,text:document.body.innerText.slice(-1500),alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.innerText)}))()",returnByValue:true}}));
    setTimeout(()=>resolve("timeout"),3500);
   });
  })();
  console.error("DOCUMENT_BROWSER_PAGE_DIAG",JSON.stringify(state));
 }catch{}
 process.exitCode=1;
}finally{
 try{
  const docs=await api("/api/documents?orderId="+order.id);
  for(const d of docs.items||[])track("documents",d.id);
 }catch{}
 try{socket?.close()}catch{}
 try{
  const killer=spawn("taskkill.exe",["/PID",String(browser.pid),"/T","/F"],{stdio:"ignore",detached:true});
  killer.unref();
 }catch{browser.kill()}
}
process.exit(process.exitCode||0);
