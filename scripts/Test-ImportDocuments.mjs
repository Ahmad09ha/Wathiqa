// WP-07 real HTTP + PostgreSQL + private disk verification.
// Writes fixture IDs only under gitignored .local, for targeted QA cleanup.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="WP07_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const fixture={run,orders:[],companies:[],shipments:[],containers:[],documents:[],requirements:[],waivers:[]};
const filePath=join(local,"documents-qa-fixtures-"+run+".json");
const persist=()=>writeFileSync(filePath,JSON.stringify(fixture,null,2));
const track=(kind,tenant,id)=>{fixture[kind].push({tenant,id});persist()};
persist();
const host="http://127.0.0.1:5089";
let tests=0;
const pass=label=>{console.log("PASS "+label);tests++};
const sessions={};
async function request(session,path,method="GET",body){
 const headers={Accept:"application/json"};
 if(session){headers.Cookie=Object.entries(session.cookies).map(([k,v])=>k+"="+v).join("; ");
  if(!["GET","HEAD"].includes(method))headers["X-Wathiqa-CSRF"]=session.csrf;
 }
 if(body!==undefined&&!(body instanceof FormData))headers["Content-Type"]="application/json";
 const result=await fetch(host+path,{method,headers,
  body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:"manual"});
 const raw=result.headers.getSetCookie?.()||[];
 for(const c of raw){
  const match=c.match(/^([^=;]+)=([^;]*)/);
  if(match&&session)session.cookies[match[1]]=match[2];
 }
 const ct=result.headers.get("content-type")||"";
 let data=null;
 if(method!=="HEAD"&&result.status!==204){
  if(ct.includes("application/json")||ct.includes("problem+json"))
   data=await result.json().catch(()=>null);
  else if(ct.includes("pdf")||ct.includes("image")||ct.includes("octet-stream"))
   data=Buffer.from(await result.arrayBuffer());
  else data=await result.text();
 }
 return {status:result.status,data,headers:result.headers};
}
function expect(r,status,label){
 assert.equal(r.status,status,label+" "+JSON.stringify(r.data).slice(0,500));
 pass(label);return r.data;
}
async function login(slug){
 const acc=accounts.find(x=>x.slug===slug);assert(acc,"Missing demo account "+slug);
 const session={cookies:{},csrf:""};
 let r=await request(session,"/api/auth/csrf");assert.equal(r.status,200);
 session.csrf=r.data.token;
 r=await request(session,"/api/auth/login","POST",{email:acc.email,password:acc.password});
 // Other integration suites use the same loopback IP. Honor the server's
 // login throttle instead of disabling production rate limiting for QA.
 for(let attempts=0;r.status===429&&attempts<4;attempts++){
   console.log("QA_AUTH_RATE_LIMITED_RETRY="+(attempts+1));
   await new Promise(resolve=>setTimeout(resolve,18000));
   r=await request(session,"/api/auth/login","POST",{email:acc.email,password:acc.password});
 }
 assert.equal(r.status,200);
 r=await request(session,"/api/auth/csrf");assert.equal(r.status,200);
 session.csrf=r.data.token;
 return session;
}
const samplePdf=Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
function payload(buf,filename,type,targets,notes="QA private document"){
 const fd=new FormData();
 fd.append("file",new Blob([buf],{type:"application/octet-stream"}),filename);
 fd.append("type",type);fd.append("notes",notes);
 if(targets.orderId)fd.append("orderId",targets.orderId);
 if(targets.shipmentId)fd.append("shipmentId",targets.shipmentId);
 for(const id of targets.containerIds||[])fd.append("containerIds",id);
 return fd;
}
function orderInput(supplier){
 return {supplierId:supplier,customerId:null,supplierRef:run,orderDate:"2026-11-06",
 incoterm:"FOB",loadingPort:"Ningbo",dischargePort:"Latakia",currency:"USD",notes:run,
 revision:null,items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",
 colorType:"Raw White",quantity:1000,quantityUnit:"KG",unitPrice:1,priceUnit:"KG",hsCode:"540246"}]};
}
function shipmentInput(number){
 return {blNumber:number,blType:"Original",blOriginalStatus:"NotReceived",
 shippingLineId:null,vessel:"MV QA",voyage:"QA-1",portOfLoading:"Ningbo",
 portOfDischarge:"Latakia",etd:null,eta:null,freeTimeDays:14,trackingUrl:"",revision:null};
}
function checkDigit(prefix){
 let sum=0;for(let i=0;i<10;i++){
  const c=prefix[i];let v=/\d/.test(c)?Number(c):10+c.charCodeAt(0)-65;
  if(/[A-Z]/.test(c))v+=Math.floor((v-1)/10);
  sum+=v*2**i;
 }
 return String((sum%11)%10);
}
function container(number){
 return {number,size:"40",sealNumber:"QA",grossWeightKg:20000,netWeightKg:18000,
 status:"Planned",acknowledgeInvalidDigit:false,arrivedAtPortDate:null,deliveredDate:null,
 freeTimeEndDate:null,revision:null};
}
async function setup(name,s,tenant){
 const c=expect(await request(s,"/api/companies","POST",{name:run+"-"+name+" Supplier",type:"Supplier"}),201,
   "Create disposable "+name+" supplier");
 track("companies",tenant,c.id);
 const order=expect(await request(s,"/api/orders","POST",orderInput(c.id)),201,
   "Create disposable "+name+" order");
 track("orders",tenant,order.id);
 return order;
}
try{
 const unauth=await request(null,"/api/documents?orderId="+randomUUID());
 expect(unauth,401,"Private documents deny unauthenticated listing");
 const a=await login("demo-a"),b=await login("demo-b");
 pass("Two merchant sessions established");
 const oa=await setup("A",a,"A");
 const ob=await setup("B",b,"B");
 const sha=expect(await request(a,"/api/orders/"+oa.id+"/shipments","POST",shipmentInput(run+"-BL-A")),201,"Create B/L for merchant A");
 track("shipments","A",sha.id);
 const sha2=expect(await request(a,"/api/orders/"+oa.id+"/shipments","POST",shipmentInput(run+"-BL-A2")),201,
  "Create second B/L under same Merchant A order");
 track("shipments","A",sha2.id);
 const ca=expect(await request(a,"/api/shipments/"+sha.id+"/containers","POST",
  container("CSQU3054383")),201,"Create container A1");
 track("containers","A",ca.id);
 const n2="MSCU123456"+checkDigit("MSCU123456");
 const cb=expect(await request(a,"/api/shipments/"+sha.id+"/containers","POST",
  container(n2)),201,"Create container A2");
 track("containers","A",cb.id);
 const separate=expect(await request(a,"/api/shipments/"+sha2.id+"/containers","POST",
  container("HLBU123456"+checkDigit("HLBU123456"))),201,"Create container under A's different B/L");
 track("containers","A",separate.id);
 const sb=expect(await request(b,"/api/orders/"+ob.id+"/shipments","POST",
  shipmentInput(run+"-BL-B")),201,"Create B/L for merchant B");
 track("shipments","B",sb.id);
 const bContainer=expect(await request(b,"/api/shipments/"+sb.id+"/containers","POST",
  container("MSCU123456"+checkDigit("MSCU123456"))),201,"Create container B");
 track("containers","B",bContainer.id);
 const csrfDenied=await fetch(host+"/api/documents",{
  method:"POST",headers:{Cookie:Object.entries(a.cookies).map(([k,v])=>k+"="+v).join("; ")},
  body:payload(samplePdf,"without-csrf.pdf","BillOfLading",{shipmentId:sha.id})
 });
 assert.equal(csrfDenied.status,400);
 pass("Multipart upload rejects missing CSRF token");
 expect(await request(a,"/api/documents","POST",
  payload(Buffer.from("MZ-evil-file"),"fake.pdf","BillOfLading",{shipmentId:sha.id})),
  400,"Executable disguised as PDF rejected by magic bytes");
 expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"fake.exe","BillOfLading",{shipmentId:sha.id})),
  400,"Executable extension rejected even with PDF signature");
 expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"fake.jpg","BillOfLading",{shipmentId:sha.id})),
  400,"PDF content with JPG extension rejected");
 const tooLarge=Buffer.alloc(25*1024*1024+1);
 samplePdf.copy(tooLarge,0,0,Math.min(samplePdf.length,tooLarge.length));
 expect(await request(a,"/api/documents","POST",
  payload(tooLarge,"oversized.pdf","BillOfLading",{shipmentId:sha.id})),
  400,"PDF larger than 25MB refused before private blob creation");
 expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"bl.pdf","BillOfLading",{containerIds:[ca.id,bContainer.id]})),
  404,"Cross-tenant multi-container target rejected before file storage");
 expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"bl.pdf","BillOfLading",{containerIds:[ca.id,separate.id]})),
  400,"One BillOfLading file cannot represent two B/L even within same Order");
 expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"bl.pdf","BillOfLading",{orderId:oa.id,shipmentId:sha.id})),
  400,"Simultaneous Order and Shipment target rejected");
 const uploaded=expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"../../bill-of-lading.pdf","BillOfLading",{containerIds:[ca.id,cb.id]})),
  201,"Upload one PDF and attach to two containers");
 assert.equal(uploaded.document.links.length,2);
 assert.equal(uploaded.document.originalFileName,"bill-of-lading.pdf");
 assert.equal(uploaded.document.contentType,"application/pdf");
 assert.equal(uploaded.document.sha256,createHash("sha256").update(samplePdf).digest("hex"));
 track("documents","A",uploaded.document.id);
 pass("One blob metadata, two valid tenant-owned links, sanitized filename, SHA-256");
 const docId=uploaded.document.id;
 expect(await request(null,"/api/documents/"+docId+"/content"),401,
  "Anonymous users cannot download private document content");
 expect(await request(a,"/api/documents/"+docId+"/links","POST",{shipmentId:sha2.id}),400,
  "Existing B/L file cannot be linked to a different shipment of same Order");
 const addParent=expect(await request(a,"/api/documents/"+docId+"/links","POST",
  {shipmentId:sha.id}),200,"Same B/L file can also link to its owning shipment");
 assert.equal(addParent.links.length,3);
 pass("One physical document reused across its shipment and two containers");
 const cList=expect(await request(a,"/api/documents?containerId="+ca.id),200,"Container 1 lists shared document");
 assert.equal(cList.total,1);
 const cList2=expect(await request(a,"/api/documents?containerId="+cb.id),200,"Container 2 lists shared document");
 assert.equal(cList2.total,1);
 pass("Both containers independently resolve the same Document ID");
 const orderDocs=expect(await request(a,"/api/documents?orderId="+oa.id),200,"Order aggregates docs linked via its containers");
 assert.equal(orderDocs.total,1);
 const pdf=expect(await request(a,"/api/documents/"+docId+"/content"),200,"Merchant A downloads private PDF");
 assert(pdf.equals(samplePdf));
 assert.equal((await request(a,"/api/documents/"+docId+"/content")).headers.get("x-content-type-options"),"nosniff");
 const downloadHeader=(await request(a,"/api/documents/"+docId+"/content")).headers.get("content-disposition")||"";
 assert.match(downloadHeader,/attachment/i);
 assert(!downloadHeader.includes("../"));
 pass("Private content bytes match original; nosniff header present");
 const previewResponse=await request(a,"/api/documents/"+docId+"/preview");
 expect(previewResponse,200,"Merchant A previews PDF through authenticated endpoint");
 assert.equal(previewResponse.headers.get("content-type"),"application/pdf");
 const previewCsp=previewResponse.headers.get("content-security-policy")||"";
 // Chromium's native PDF viewer is already sandboxed; adding another
 // CSP sandbox blocks PDF rendering. Require same-origin framing and
 // forbid ordinary embedded active content instead.
 assert.match(previewCsp,/frame-ancestors 'self'/);
 assert.match(previewCsp,/default-src 'none'/);
 assert.match(previewCsp,/object-src 'none'/);
 pass("Preview has PDF MIME and safe native-viewer-compatible CSP");
 expect(await request(b,"/api/documents/"+docId),404,"Merchant B cannot GET Merchant A document metadata");
 expect(await request(b,"/api/documents/"+docId+"/content"),404,"Merchant B cannot download Merchant A blob by guessed ID");
 expect(await request(b,"/api/documents/"+docId+"/preview"),404,"Merchant B cannot preview Merchant A blob");
 expect(await request(b,"/api/documents/"+docId+"/links","POST",{containerIds:[bContainer.id]}),404,
  "Merchant B cannot link Merchant A document");
 expect(await request(a,"/api/documents/"+docId+"/links","POST",{orderId:ob.id}),404,
  "Merchant A cannot link document to another merchant order");
 // A second order in Tenant A cannot share the same BillOfLading proof.
 const oa2=await setup("A-2",a,"A");
 expect(await request(a,"/api/documents/"+docId+"/links","POST",{orderId:oa2.id}),400,
  "BillOfLading proof cannot be attached to another purchase order in same tenant");
 const directDoc=expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"contract.pdf","Contract",{orderId:oa2.id})),201,
  "Attach a Contract directly to the second purchase order");
 track("documents","A",directDoc.document.id);
 const directOrder=expect(await request(a,"/api/orders/"+oa2.id),200,
  "Read order revision before document-protected deletion");
 expect(await request(a,"/api/orders/"+oa2.id+"?revision="+directOrder.revision,"DELETE"),409,
  "Order with active direct documents cannot disappear silently");
 expect(await request(a,"/api/documents/"+directDoc.document.id,"DELETE"),204,
  "Soft-delete the direct Contract and links before order deletion");
 const duplicate=expect(await request(a,"/api/documents","POST",
  payload(samplePdf,"duplicate.pdf","BillOfLading",{shipmentId:sha.id})),201,
  "Second upload of same content reports duplicate SHA within tenant");
 track("documents","A",duplicate.document.id);
 assert.equal(duplicate.duplicateInTenant,true);pass("Repeated content warning scoped to tenant SHA");
 // Actual admin-set requirement, no default required docs.
 const beforeRules=expect(await request(a,"/api/document-requirements"),200,"Read merchant document requirements");
 const exists=beforeRules.some(x=>x.targetType==="Container"&&x.stage==="Any"&&x.documentType==="BillOfLading");
 assert.equal(exists,false,"QA must not overwrite an existing tenant rule");
 const rule=expect(await request(a,"/api/document-requirements","PUT",{
  targetType:"Container",stage:"Any",documentType:"BillOfLading",isRequired:true
 }),200,"Admin explicitly marks BillOfLading required for containers");
 track("requirements","A",rule.id);
 const check1=expect(await request(a,"/api/document-requirements/checklist?containerId="+ca.id),200,
  "Checklist for linked container");
 assert.equal(check1.items.find(x=>x.id===rule.id).status,"satisfied");
 pass("Linked file satisfies Admin-configured requirement");
 expect(await request(b,"/api/document-requirements/checklist?containerId="+ca.id),404,
  "Merchant B cannot inspect checklist for A container");
 const thirdNumber="HLBU123456"+checkDigit("HLBU123456");
 const third=expect(await request(a,"/api/shipments/"+sha.id+"/containers","POST",
  container(thirdNumber)),201,"Create container A3 without documents");
 track("containers","A",third.id);
 const checkMissing=expect(await request(a,"/api/document-requirements/checklist?containerId="+third.id),200,
  "Checklist for unlinked container");
 assert.equal(checkMissing.items.find(x=>x.id===rule.id).status,"missing");
 pass("Unlinked required document appears as genuinely missing");
 expect(await request(a,"/api/document-requirements/"+rule.id+"/waivers","POST",
  {containerIds:[third.id],reason:"short"}),400,"Admin waiver without meaningful reason rejected");
 const waiver=expect(await request(a,"/api/document-requirements/"+rule.id+"/waivers","POST",
  {containerIds:[third.id],reason:"Document unavailable from shipping line; manual review."}),
  201,"Admin approves reasoned exception");
 track("waivers","A",waiver.id);
 const waived=expect(await request(a,"/api/document-requirements/checklist?containerId="+third.id),200,
  "Checklist reflects administrative waiver");
 assert.equal(waived.items.find(x=>x.id===rule.id).status,"waived");
 pass("Waived distinct from missing and satisfied");
 expect(await request(a,"/api/document-waivers/"+waiver.id,"DELETE"),204,
  "Admin revokes waiver with history retained");
 const again=expect(await request(a,"/api/document-requirements/checklist?containerId="+third.id),200,
  "Checklist after revoked waiver");
 assert.equal(again.items.find(x=>x.id===rule.id).status,"missing");
 pass("Revoked waiver immediately restores missing");
 const attachedLinks=uploaded.document.links;
 const firstContainerLink=attachedLinks.find(x=>x.containerId===ca.id);
 assert(firstContainerLink,"Expected explicit link to the first container");
 expect(await request(a,"/api/document-links/"+firstContainerLink.id,"DELETE"),204,
  "Remove document link from first container");
 const listAfterUnlink=expect(await request(a,"/api/documents?containerId="+ca.id),200,
  "First container no longer lists unlinked document");
 assert.equal(listAfterUnlink.total,0);
 const otherStill=expect(await request(a,"/api/documents?containerId="+cb.id),200,
  "Second container still lists same blob");
 assert.equal(otherStill.total,1);
 pass("Unlinking one target does not remove another target's file");
 const afterUnlink=expect(await request(a,"/api/document-requirements/checklist?containerId="+ca.id),200,
  "First container checklist after unlink");
 assert.equal(afterUnlink.items.find(x=>x.id===rule.id).status,"missing");
 expect(await request(a,"/api/documents/"+docId,"DELETE"),204,
  "Soft-delete original Document and links");
 expect(await request(a,"/api/documents/"+docId+"/content"),404,
  "Soft-deleted document no longer downloadable");
 const afterDelete=expect(await request(a,"/api/document-requirements/checklist?containerId="+cb.id),200,
  "Checklist after document deletion");
 assert.equal(afterDelete.items.find(x=>x.id===rule.id).status,"missing");
 pass("Deleting document makes requirements missing again");
 const policyWaiver=expect(await request(a,"/api/document-requirements/"+rule.id+"/waivers","POST",{
  containerIds:[third.id],reason:"Temporary waiver before changing mandatory policy."
 }),201,"Admin creates temporary waiver before policy change");
 track("waivers","A",policyWaiver.id);
 const inactive=expect(await request(a,"/api/document-requirements","PUT",{
  targetType:"Container",stage:"Any",documentType:"BillOfLading",isRequired:false
 }),200,"Admin can explicitly make document non-required");
 assert.equal(inactive.isRequired,false);
 const noRequired=expect(await request(a,"/api/document-requirements/checklist?containerId="+cb.id),200,
  "Checklist distinguishes not-required");
 assert.equal(noRequired.items.find(x=>x.id===rule.id).status,"not_required");
 pass("Not-required is neither waived nor missing");
 expect(await request(a,"/api/document-requirements","PUT",{
  targetType:"Container",stage:"Any",documentType:"BillOfLading",isRequired:true
 }),200,"Admin can restore a previously disabled document requirement");
 const revived=expect(await request(a,"/api/document-requirements/checklist?containerId="+third.id),200,
  "Checklist after re-enabling mandatory document");
 assert.equal(revived.items.find(x=>x.id===rule.id).status,"missing");
 pass("Disabling and re-enabling requirement does not reactivate old waiver");
 expect(await request(a,"/api/document-requirements","PUT",{
  targetType:"Container",stage:"Any",documentType:"BillOfLading",isRequired:false
 }),200,"Admin restores demo rule to non-required before QA cleanup");
 console.log("DOCUMENT_API_PASS_COUNT="+tests);
 console.log("QA_FIXTURES_PATH="+filePath);
}catch(e){
 console.error("DOCUMENT_API_TEST_FAILED",e);
 console.error("TEST_DATA_FOR_TARGETED_CLEANUP",filePath);
 process.exitCode=1;
}
