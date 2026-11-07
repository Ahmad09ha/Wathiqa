// WP-08 live PostgreSQL + authenticated HTTP. Generates only scoped QA rows.
// Cleanup using scripts/Cleanup-ImportDocumentsQa.ps1 -Apply (dry-run first).
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="WP07_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const fixture={run,orders:[],companies:[],shipments:[],containers:[],documents:[],requirements:[],waivers:[]};
const fixturePath=join(local,"documents-qa-fixtures-"+run+".json");
const persist=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
function track(type,tenant,id){fixture[type].push({tenant,id});persist()}
const host="http://127.0.0.1:5089";
let count=0;
function pass(label){count++;console.log("PASS "+label)}
async function call(session,path,method="GET",body){
 const headers={Accept:"application/json"};
 if(session){
  headers.Cookie=Object.entries(session.cookies).map(([key,value])=>key+"="+value).join("; ");
  if(!["GET","HEAD"].includes(method))headers["X-Wathiqa-CSRF"]=session.csrf;
 }
 if(body!==undefined&&!(body instanceof FormData))headers["Content-Type"]="application/json";
 const response=await fetch(host+path,{method,headers,
  body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:"manual"});
 if(session)for(const raw of response.headers.getSetCookie?.()||[]){
  const match=raw.match(/^([^=;]+)=([^;]*)/);
  if(match)session.cookies[match[1]]=match[2];
 }
 let data=null;
 if(response.status!==204){
  const text=await response.text();
  try{data=JSON.parse(text)}catch{data=text}
 }
 return {status:response.status,data};
}
function expect(response,status,label){
 assert.equal(response.status,status,label+" "+JSON.stringify(response.data).slice(0,650));
 pass(label);return response.data;
}
async function login(slug){
 const account=accounts.find(x=>x.slug===slug);
 assert(account,"Missing "+slug);
 const session={cookies:{},csrf:""};
 const initial=await call(session,"/api/auth/csrf");
 assert.equal(initial.status,200);session.csrf=initial.data.token;
 let logged=await call(session,"/api/auth/login","POST",
  {email:account.email,password:account.password});
 for(let i=0;logged.status===429&&i<4;i++){
  await new Promise(resolve=>setTimeout(resolve,18000));
  logged=await call(session,"/api/auth/login","POST",
   {email:account.email,password:account.password});
 }
 assert.equal(logged.status,200,"Login "+slug+": "+JSON.stringify(logged.data));
 session.csrf=(await call(session,"/api/auth/csrf")).data.token;
 return session;
}
function item(quantity=1000,price=2){
 return {productType:"POY",denier:"150/48",luster:"SD",grade:"AA",colorType:"White",
  quantity,quantityUnit:"KG",unitPrice:price,priceUnit:"KG",hsCode:"540246"};
}
function orderInput(supplier,currency,orderDate,extra={}){
 return {supplierId:supplier,customerId:null,supplierRef:run,orderDate,incoterm:"FOB",
   loadingPort:"Ningbo",dischargePort:"Latakia",currency,notes:run,
   revision:null,items:[item()],...extra};
}
function shipmentInput(number){
 return {blNumber:number,blType:"Original",blOriginalStatus:"NotReceived",
  shippingLineId:null,vessel:"QA Vessel",voyage:"QA-8",portOfLoading:"Ningbo",
  portOfDischarge:"Latakia",etd:"2026-11-01",eta:"2026-11-15",
  freeTimeDays:14,trackingUrl:"",revision:null};
}
function checkDigit(prefix){
 let sum=0;
 for(let i=0;i<10;i++){
  const c=prefix[i];
  let value=/\d/.test(c)?Number(c):10+c.charCodeAt(0)-65;
  if(/[A-Z]/.test(c))value+=Math.floor((value-1)/10);
  sum+=value*2**i;
 }
 return String((sum%11)%10);
}
function containerInput(number,extra={}){
 return {number,size:"40HC",sealNumber:"WP08",grossWeightKg:19000,
  netWeightKg:17000,status:"Planned",acknowledgeInvalidDigit:false,
  arrivedAtPortDate:null,deliveredDate:null,freeTimeEndDate:null,revision:null,...extra};
}
const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
function uploadFile(type,target){
 const form=new FormData();
 form.append("file",new Blob([pdf],{type:"application/pdf"}),"wp08-"+run+".pdf");
 form.append("type",type);
 if(target.containerId)form.append("containerIds",target.containerId);
 if(target.shipmentId)form.append("shipmentId",target.shipmentId);
 return form;
}
function query(base,values){return base+"?"+new URLSearchParams(values).toString()}
try{
 persist();
 expect(await call(null,"/api/operations/containers"),401,
  "Anonymous cannot list operational containers");
 expect(await call(null,"/api/operations/document-gaps"),401,
  "Anonymous cannot list missing documents");
 const a=await login("demo-a"),b=await login("demo-b");
 pass("Two independent tenant sessions");
 const companyA=expect(await call(a,"/api/companies","POST",
   {name:run+" A supplier",type:"Supplier"}),201,"Tenant A supplier");
 track("companies","A",companyA.id);
  const companyB=expect(await call(b,"/api/companies","POST",
    {name:run+" B supplier",type:"Supplier"}),201,"Tenant B supplier");
  track("companies","B",companyB.id);
  const companyA2=expect(await call(a,"/api/companies","POST",
    {name:run+" A broker",type:"Broker"}),201,"Tenant A second trading party for paging");
  track("companies","A",companyA2.id);
  const companiesPage1=expect(await call(a,query("/api/companies/search",
    {search:run,page:1,pageSize:1})),200,"Directory server search first page");
  assert.equal(companiesPage1.total,2);
  assert.equal(companiesPage1.items.length,1);
  const companiesPage2=expect(await call(a,query("/api/companies/search",
    {search:run,page:2,pageSize:1})),200,"Directory server search second page");
  assert.equal(companiesPage2.total,2);
  assert.notEqual(companiesPage1.items[0].id,companiesPage2.items[0].id);
  const filteredCompanies=expect(await call(a,query("/api/companies/search",
    {search:run,type:"Supplier"})),200,"Directory company type filter");
  assert.equal(filteredCompanies.total,1);
  assert.equal(filteredCompanies.items[0].id,companyA.id);
  const bCompanySearch=expect(await call(b,query("/api/companies/search",
    {search:run})),200,"Directory paging keeps tenant B isolated");
  assert.equal(bCompanySearch.total,1);
  expect(await call(a,"/api/companies/search?pageSize=0"),400,
    "Directory refuses invalid page size");
  expect(await call(a,"/api/companies/search?type=Invention"),400,
    "Directory refuses unknown company type");
  // WP-03 commercial directory extension. Existing create clients still send
  // only Name/Type; additional optional details must round-trip without ever
  // allowing a foreign tenant to inspect or replace them.
  const originalProfile=expect(await call(a,"/api/companies/"+companyA.id),200,
    "Existing minimal company create remains backward-compatible");
  assert.equal(originalProfile.nameEn,"");
  assert.equal(originalProfile.defaultCurrency,"");
  const profile={name:companyA.name,type:companyA.type,
    nameEn:"  Example Yarn Exporters  ",country:"China",city:"Ningbo",
    address:"Port district",contactName:"Operations QA",phone:"+86 100 200 300",
    email:"qa-contact@example.invalid",taxNo:"QA-2026",defaultCurrency:"usd",
    notes:"  Profile details preserved per tenant.  "};
  const updatedProfile=expect(await call(a,"/api/companies/"+companyA.id,"PUT",profile),200,
    "Update non-financial company metadata");
  assert.equal(updatedProfile.nameEn,"Example Yarn Exporters");
  assert.equal(updatedProfile.defaultCurrency,"USD");
  assert.equal(updatedProfile.notes,"Profile details preserved per tenant.");
  const savedProfile=expect(await call(a,"/api/companies/"+companyA.id),200,
    "Company contact profile persists in PostgreSQL");
  assert.equal(savedProfile.address,"Port district");
  assert.equal(savedProfile.email,"qa-contact@example.invalid");
  expect(await call(b,"/api/companies/"+companyA.id),404,
    "Merchant B cannot read Merchant A commercial profile");
  expect(await call(b,"/api/companies/"+companyA.id,"PUT",profile),404,
    "Merchant B cannot modify Merchant A commercial profile");
  expect(await call(a,"/api/companies/"+companyA.id,"PUT",{
    ...profile,email:"invalid-email"}),400,
    "Invalid contact email is rejected without losing previous data");
  expect(await call(a,"/api/companies/"+companyA.id,"PUT",{
    ...profile,defaultCurrency:"GBP"}),400,
    "Unsupported company currency is rejected");
  assert.equal((await call(a,"/api/companies/"+companyA.id)).data.email,
    "qa-contact@example.invalid");
  pass("Invalid company updates preserve previously saved profile");
  const oa=expect(await call(a,"/api/orders","POST",
    orderInput(companyA.id,"USD","2026-11-01")),201,"Create USD Order A");
  track("orders","A",oa.id);
  expect(await call(a,"/api/companies/"+companyA.id,"DELETE"),409,
    "Cannot soft-delete a Supplier referenced by an active Order");
  expect(await call(a,"/api/companies/"+companyA.id,"PUT",{
    ...profile,type:"Broker"}),409,
    "Cannot change a referenced Supplier into an incompatible company type");
  assert.equal((await call(a,"/api/companies/"+companyA.id)).data.type,"Supplier");
  pass("Rejected company mutation retains active supplier reference");
 const oe=expect(await call(a,"/api/orders","POST",
   orderInput(companyA.id,"EUR","2026-10-25")),201,"Create EUR Order A");
 track("orders","A",oe.id);
 const ob=expect(await call(b,"/api/orders","POST",
   orderInput(companyB.id,"USD","2026-11-01")),201,"Create USD Order B");
 track("orders","B",ob.id);

 const onlyA=expect(await call(a,query("/api/orders",
  {q:run,page:1,pageSize:1})),200,"Search matches all tenant A fixture orders");
 assert.equal(onlyA.total,2);
 assert.equal(onlyA.items.length,1);
  assert.equal(onlyA.financialsAvailable,true);
  assert(onlyA.items[0].paidAmount===0 && onlyA.items[0].paymentStatus==="Unpaid");
 assert.deepEqual(new Set(onlyA.summaries.map(x=>x.currency)),new Set(["EUR","USD"]));
 assert(onlyA.summaries.every(x=>x.totalAmount===2000&&x.orderCount===1));
  assert(onlyA.summaries.every(x=>x.paidAmount===0&&x.remainingAmount===2000));
  pass("Financial totals group by currency BEFORE paging; no planned or fictitious transfers");
 const next=expect(await call(a,query("/api/orders",
  {q:run,page:2,pageSize:1})),200,"Pagination second page");
 assert.equal(next.total,2);
 assert.notEqual(next.items[0].id,onlyA.items[0].id);
 const bFiltered=expect(await call(b,query("/api/orders",{q:run})),200,
  "Same query under Merchant B");
 assert.equal(bFiltered.total,1);
 assert.equal(bFiltered.items[0].id,ob.id);
 pass("Filtered order totals and content are tenant-isolated");
 const byCurrency=expect(await call(a,query("/api/orders",{q:run,currency:"EUR"})),200,
  "Currency filter");
 assert.equal(byCurrency.total,1);assert.equal(byCurrency.items[0].id,oe.id);
 const byDate=expect(await call(a,query("/api/orders",
   {q:run,from:"2026-11-01",to:"2026-11-01"})),200,
  "Inclusive date filter");
 assert.equal(byDate.total,1);assert.equal(byDate.items[0].id,oa.id);
 const supplierFilter=expect(await call(a,query("/api/orders",
   {q:run,supplierId:companyB.id})),200,"Cross-tenant Supplier ID cannot select records");
 assert.equal(supplierFilter.total,0);
 expect(await call(a,query("/api/orders",
  {from:"2026-12-31",to:"2026-01-01"})),400,
  "Reject inverted date bounds");
 expect(await call(a,query("/api/orders",{sort:"injected"})),400,
  "Reject unsupported sort key");
  const unpaid=expect(await call(a,query("/api/orders",{q:run,payment:"Unpaid"})),200,
   "Real payment filter finds the two unpaid QA Orders");
  assert.equal(unpaid.total,2);
  const overdue=expect(await call(a,query("/api/orders",{q:run,overdue:true})),200,
   "Overdue filter derives from actual due schedules, not Draft default");
  assert.equal(overdue.total,0);
 const byValue=expect(await call(a,query("/api/orders",{q:run,sort:"totalDesc"})),200,
  "Sort by amount");
 assert.equal(byValue.total,2);

 const sa=expect(await call(a,"/api/orders/"+oa.id+"/shipments","POST",
  shipmentInput(run+"-SHIP-A")),201,"Create B/L A");
 track("shipments","A",sa.id);
 const sb=expect(await call(b,"/api/orders/"+ob.id+"/shipments","POST",
  shipmentInput(run+"-SHIP-B")),201,"Create B/L B");
 track("shipments","B",sb.id);
 const c1=expect(await call(a,"/api/shipments/"+sa.id+"/containers","POST",
  containerInput("CSQU3054383")),201,"Create container A1");
 track("containers","A",c1.id);
 const c2=expect(await call(a,"/api/shipments/"+sa.id+"/containers","POST",
  containerInput("MSCU123456"+checkDigit("MSCU123456"))),201,"Create container A2");
 track("containers","A",c2.id);
 const bc=expect(await call(b,"/api/shipments/"+sb.id+"/containers","POST",
  containerInput("CSQU3054383")),201,"Create container B1");
 track("containers","B",bc.id);
 const sea=expect(await call(a,"/api/containers/"+c1.id,"PUT",
  containerInput(c1.number,{status:"AtSea",freeTimeEndDate:"2026-11-05",
   revision:c1.revision})),200,"Advance A1 to AtSea with Free Time date");
 const port=expect(await call(a,"/api/containers/"+c2.id,"PUT",
  containerInput(c2.number,{status:"AtSea",revision:c2.revision})),200,
  "Advance A2 to AtSea");
 const arrival=expect(await call(a,"/api/containers/"+c2.id,"PUT",
  containerInput(c2.number,{status:"AtPort",arrivedAtPortDate:"2026-11-06",
   freeTimeEndDate:"2026-11-09",revision:port.revision})),200,"Advance A2 to AtPort");
 expect(await call(a,"/api/containers/"+c2.id,"PUT",
  containerInput(c2.number,{status:"Delivered",arrivedAtPortDate:"2026-11-06",
   deliveredDate:"2026-11-07",freeTimeEndDate:"2026-11-09",revision:arrival.revision})),
  200,"Deliver A2 (will not appear in active Free Time report)");
 const arrived=expect(await call(a,query("/api/orders",
  {q:run,arrival:"PartiallyDelivered"})),200,
  "Filter by derived partial arrival status");
 assert.equal(arrived.total,1);assert.equal(arrived.items[0].id,oa.id);
 assert.equal(arrived.items[0].containerCount,2);
 assert.equal(arrived.items[0].deliveredContainerCount,1);
 assert.equal(arrived.items[0].eta,"2026-11-15");
 pass("Arrival counters and ETA are derived from B/L & container facts");
 const atSea=expect(await call(a,query("/api/operations/containers",
  {orderId:oa.id,status:"AtSea"})),200,
  "AtSea report filters one active container A1");
 assert.equal(atSea.total,1);assert.equal(atSea.items[0].id,c1.id);
 const free=expect(await call(a,query("/api/operations/containers",
  {orderId:oa.id,freeTimeWindowDays:"7"})),200,
  "Free Time report includes overdue non-delivered container A1");
 assert.equal(free.total,1);assert.equal(free.items[0].id,c1.id);
 const allB=expect(await call(b,query("/api/operations/containers",{status:"AtSea"})),200,
  "Merchant B cannot see Tenant A's AtSea containers");
 assert.equal(allB.total,0);
 expect(await call(b,query("/api/operations/containers",{orderId:oa.id})),200,
  "Merchant B querying A's orderId gets an empty safe list");
 expect(await call(a,query("/api/operations/containers",{freeTimeWindowDays:"99"})),400,
  "Reject excessively long Free Time window");

 const before=expect(await call(a,query("/api/operations/document-gaps",
  {orderId:oa.id})),200,"No implicit mandatory document policy");
 assert.equal(before.total,0);
 const existingRules=expect(await call(a,"/api/document-requirements"),200,
  "Check Admin rules before mutating shared demo-tenant config");
 assert(!existingRules.some(x=>x.targetType==="Container"&&x.stage==="Any"&&
  x.documentType==="InsuranceCertificate"),
  "Refusing to overwrite a pre-existing requirement rule");
 assert(!existingRules.some(x=>x.targetType==="Shipment"&&x.stage==="PartiallyDelivered"&&
  x.documentType==="QualityCertificate"),
  "Refusing to overwrite a pre-existing stage-specific rule");
 const containerRule=expect(await call(a,"/api/document-requirements","PUT",
  {targetType:"Container",stage:"Any",documentType:"InsuranceCertificate",isRequired:true}),
  200,"Admin configures Container requirement");
 track("requirements","A",containerRule.id);
 const shipmentRule=expect(await call(a,"/api/document-requirements","PUT",
  {targetType:"Shipment",stage:"PartiallyDelivered",documentType:"QualityCertificate",
   isRequired:true}),200,"Admin configures stage-specific partial B/L requirement");
 track("requirements","A",shipmentRule.id);
 const missing=expect(await call(a,query("/api/operations/document-gaps",
  {orderId:oa.id})),200,"Missing documents report reads Admin rules");
 assert.equal(missing.total,3);
 assert(missing.items.some(x=>x.targetId===sa.id&&x.documentType==="QualityCertificate"));
 assert(missing.items.filter(x=>x.targetType==="Container").length===2);
 pass("One shipment and two containers show their own missing docs");
 const bMissing=expect(await call(b,"/api/operations/document-gaps"),200,
  "Tenant B does not inherit Tenant A's document rules or gaps");
 assert.equal(bMissing.total,0);

 const upload=expect(await call(a,"/api/documents","POST",
  uploadFile("InsuranceCertificate",{containerId:c1.id})),201,
  "Attach InsuranceCertificate to Container A1 only");
 track("documents","A",upload.document.id);
 const afterUpload=expect(await call(a,query("/api/operations/document-gaps",
  {orderId:oa.id})),200,
  "Uploading one scoped file removes exactly one gap");
 assert.equal(afterUpload.total,2);
 assert(afterUpload.items.some(x=>x.targetId===c2.id&&x.documentType==="InsuranceCertificate"));
 assert(!afterUpload.items.some(x=>x.targetId===c1.id&&x.documentType==="InsuranceCertificate"));
 pass("Container document link cannot satisfy a different container");
 const waiver=expect(await call(a,"/api/document-requirements/"+containerRule.id+"/waivers",
  "POST",{containerIds:[c2.id],reason:"Shipment insurance copy pending independent review."}),
  201,"Admin waives other Container's missing document with audit");
 track("waivers","A",waiver.id);
 const afterWaiver=expect(await call(a,query("/api/operations/document-gaps",
  {orderId:oa.id})),200,"Waived gap removed from missing report");
 assert.equal(afterWaiver.total,1);
 assert.equal(afterWaiver.items[0].targetId,sa.id);
 expect(await call(a,"/api/document-waivers/"+waiver.id,"DELETE"),204,
  "Admin revokes temporary waiver");
 const again=expect(await call(a,query("/api/operations/document-gaps",
  {orderId:oa.id})),200,"Revoked waiver returns the gap");
 assert.equal(again.total,2);
 const orderCount=expect(await call(a,query("/api/orders",
  {q:run,sort:"eta"})),200,"ETA sort works across orders with/without shipments");
 assert.equal(orderCount.total,2);
 console.log("WP08_API_PASS_COUNT="+count);
 console.log("WP08_QA_FIXTURE="+fixturePath);
}catch(error){
 console.error("WP08_TEST_FAILED",error);
 console.error("WP08_QA_FIXTURE="+fixturePath);
 process.exitCode=1;
}
