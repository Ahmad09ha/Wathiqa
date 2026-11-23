// WP-06 live PostgreSQL + HTTP contract tests.
// All generated IDs are recorded under .local for deliberate QA cleanup.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
const root=process.cwd(),local=join(root,".local");
const creds=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const base="http://127.0.0.1:5089";
const fixtures={run:"WP06_QA_"+randomUUID().replaceAll("-","").slice(0,9),users:[],companies:[],orders:[],shipments:[],containers:[],clearances:[]};
const fixturePath=join(local,"logistics-qa-fixtures-"+fixtures.run+".json");
function persist(){writeFileSync(fixturePath,JSON.stringify(fixtures,null,2))}
function track(kind,tenant,id){fixtures[kind].push({tenant,id});persist()}
let checks=0;
function check(condition,label){assert.ok(condition,label);console.log("PASS "+label);checks++}
async function send(session,path,method="GET",body){
 const headers={Accept:"application/json"};
 if(session){headers.Cookie=Object.entries(session.cookies).map(([k,v])=>k+"="+v).join("; ");if(method!=="GET")headers["X-Wathiqa-CSRF"]=session.csrf}
 if(body!==undefined)headers["Content-Type"]="application/json";
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:"manual"});
 for(const cookie of response.headers.getSetCookie?.()||[]){const m=cookie.match(/^([^=;]+)=([^;]*)/);if(m&&session)session.cookies[m[1]]=m[2]}
 let data=null; if(response.status!==204){const text=await response.text();if(text){try{data=JSON.parse(text)}catch{data=text}}}
 return {status:response.status,data};
}
async function login(account){
 const s={cookies:{},csrf:""};
 let r=await send(s,"/api/auth/csrf");assert.equal(r.status,200);s.csrf=r.data.token;
 r=await send(s,"/api/auth/login","POST",{email:account.email,password:account.password});assert.equal(r.status,200);
 r=await send(s,"/api/auth/csrf");s.csrf=r.data.token;
 return s;
}
function requireStatus(result,status,name){
 assert.equal(result.status,status,name+" "+JSON.stringify(result.data));
 check(true,name);
 return result.data;
}
function orderInput(supplierId){
 return {
   supplierId,customerId:null,supplierRef:fixtures.run,
   proformaInvoiceNumber:"PI-"+fixtures.run,contractNumber:"CTR-"+fixtures.run,
   contractDate:"2026-11-05",
  orderDate:"2026-11-06",incoterm:"FOB",loadingPort:"Ningbo",dischargePort:"Latakia",
  currency:"USD",notes:"WP06 disposable integration fixture",revision:null,
   items:[{productType:"POY",brand:"QA Brand",denier:"150/48",luster:"SD",grade:"AA",colorType:"White",
   quantity:1000,quantityUnit:"KG",unitPrice:1.5,priceUnit:"KG",hsCode:"540246"}]
 };
}
function shipmentInput(bl,shippingLineId=null,extras={}){
 return {blNumber:bl,blType:"Original",blOriginalStatus:"NotReceived",shippingLineId,
   vessel:"MV Testing",voyage:"V001",shipper:"QA Shipper",consignee:"QA Consignee",
   notifyParty:"QA Notify",shippedOnBoardDate:"2026-11-06",originalReceivedDate:null,
   packageCount:15,palletCount:5,portOfLoading:"Ningbo",portOfDischarge:"Latakia",
  etd:"2026-11-06",eta:"2026-11-20",freeTimeDays:14,
  trackingUrl:"https://example.org/tracking",revision:null,...extras};
}
function checkDigit(prefix){
 let s=0;
 for(let i=0;i<10;i++){
  const c=prefix[i]; let v=/\d/.test(c)?Number(c):10+c.charCodeAt(0)-65;
  if(/[A-Z]/.test(c))v+=Math.floor((v-1)/10);
  s+=v*Math.pow(2,i);
 }
 return String((s%11)%10);
}
function containerInput(number,extras={}){
 return {number,size:"40HC",sealNumber:"SEAL-QA",grossWeightKg:19000,netWeightKg:17000,
  status:"Planned",acknowledgeInvalidDigit:false,arrivedAtPortDate:null,deliveredDate:null,
  freeTimeEndDate:null,revision:null,...extras};
}
let a,b;
try{
 persist();
 a=await login(creds.find(x=>x.slug==="demo-a"));
 b=await login(creds.find(x=>x.slug==="demo-b"));
 check(true,"Two merchant sessions available for logistics isolation tests");
 const suppliers={};
 for(const [name,s] of [["A",a],["B",b]]){
  const p=requireStatus(await send(s,"/api/companies","POST",{name:fixtures.run+"-"+name+" Supplier",type:"Supplier"}),201,"Create QA supplier "+name);
  track("companies",name,p.id);
  suppliers[name]=p.id;
 }
 const line=requireStatus(await send(a,"/api/companies","POST",{name:fixtures.run+" Shipping",type:"ShippingLine"}),201,"Create shipping line");
 track("companies","A",line.id);
 const broker=requireStatus(await send(a,"/api/companies","POST",{name:fixtures.run+" Broker",type:"Broker"}),201,"Create customs broker");
 track("companies","A",broker.id);
  const oa=requireStatus(await send(a,"/api/orders","POST",orderInput(suppliers.A)),201,"Create Tenant A purchase order");
  track("orders","A",oa.id);
  check(oa.proformaInvoiceNumber==="PI-"+fixtures.run&&oa.contractNumber==="CTR-"+fixtures.run&&oa.contractDate==="2026-11-05"&&oa.items[0].brand==="QA Brand","Order contract, proforma and item brand persist");
  const legacyOrder=orderInput(suppliers.A);
  legacyOrder.revision=oa.revision;
  legacyOrder.items[0].id=oa.items[0].id;
  for(const k of ["proformaInvoiceNumber","contractNumber","contractDate"])delete legacyOrder[k];
  delete legacyOrder.items[0].brand;
  const backwardOrder=requireStatus(await send(a,"/api/orders/"+oa.id,"PUT",legacyOrder),200,"Legacy order edit succeeds without new metadata fields");
  check(backwardOrder.proformaInvoiceNumber===oa.proformaInvoiceNumber &&
    backwardOrder.contractNumber===oa.contractNumber &&
    backwardOrder.contractDate===oa.contractDate &&
    backwardOrder.items[0].brand===oa.items[0].brand,
    "Legacy order edit preserves contract, PI, brand and dates");
 const ob=requireStatus(await send(b,"/api/orders","POST",orderInput(suppliers.B)),201,"Create Tenant B purchase order");
 track("orders","B",ob.id);
 const bl1=fixtures.run.toUpperCase()+"-BL-1";
 const bl2=fixtures.run.toUpperCase()+"-BL-2";
  const sa=requireStatus(await send(a,"/api/orders/"+oa.id+"/shipments","POST",shipmentInput(bl1,line.id)),201,"Create B/L linked to original Order A");
  track("shipments","A",sa.id);
  check(sa.shipper==="QA Shipper"&&sa.consignee==="QA Consignee"&&sa.packageCount===15&&sa.palletCount===5,"B/L parties and package counts persist");
  const legacyBl=shipmentInput(bl1,line.id,{revision:sa.revision});
  for(const k of ["shipper","consignee","notifyParty","shippedOnBoardDate","originalReceivedDate","packageCount","palletCount"])delete legacyBl[k];
  const backwardsBl=requireStatus(await send(a,"/api/shipments/"+sa.id,"PUT",legacyBl),200,"Legacy shipment edit without new metadata succeeds");
  check(backwardsBl.shipper===sa.shipper && backwardsBl.consignee===sa.consignee &&
    backwardsBl.packageCount===sa.packageCount,
    "Legacy B/L update preserves shipper, consignee, package counts");
 check(sa.orderId===oa.id,"B/L reports exactly one owning order");
 requireStatus(await send(a,"/api/orders/"+oa.id+"/shipments","POST",shipmentInput(bl1,line.id)),409,"Duplicate B/L number within merchant rejected");
  requireStatus(await send(b,"/api/shipments/"+sa.id),404,"Merchant B cannot read Merchant A B/L");
  requireStatus(await send(b,"/api/shipments/"+sa.id+"/tracking"),404,"Other merchant cannot access tracking references");
  const trackList=requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking"),200,"Tracking list accessible within tenant");
  check(trackList.records.length===0,"No fabricated tracking records on new shipment");
  requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking","POST",
    {referenceType:"BL",referenceNumber:"WRONGBL",carrierCode:"MAEU"}),400,"Tracking B/L must match owning shipment");
  const blTracking=requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking","POST",
    {referenceType:"BL",referenceNumber:bl1,carrierCode:"MAEU"}),201,"Create provider tracking reference for B/L");
  requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking","POST",
    {referenceType:"BL",referenceNumber:bl1,carrierCode:"MAEU"}),200,"Repeated B/L registration is idempotent");
  requireStatus(await send(b,"/api/tracking/"+blTracking.id+"/refresh","POST"),404,"Cross-tenant tracking refresh rejected");
  if(!trackList.configured)requireStatus(await send(a,"/api/tracking/"+blTracking.id+"/refresh","POST"),503,"Unconfigured provider fails closed and does not fabricate AIS");
 requireStatus(await send(b,"/api/shipments/"+sa.id,"PUT",shipmentInput(bl1,null,{revision:1})),404,"Merchant B cannot edit Merchant A B/L");
 requireStatus(await send(b,"/api/shipments/"+sa.id+"/containers","POST",containerInput("CSQU3054383")),404,"Merchant B cannot add to Merchant A B/L");
 requireStatus(await send(b,"/api/orders/"+ob.id+"/shipments","POST",shipmentInput(bl1,line.id)),400,"Tenant B cannot attach Tenant A shipping line");
 const sb=requireStatus(await send(a,"/api/orders/"+oa.id+"/shipments","POST",shipmentInput(bl2)),201,"Second B/L linked to same Order A");
 track("shipments","A",sb.id);
 const all=requireStatus(await send(a,"/api/orders/"+oa.id+"/shipments"),200,"Order A lists two B/L records");
 check(all.length===2 && all.every(x=>x.orderId===oa.id),"Both B/L stay within their own one Order");
 const validPrefix="CSQU305438";
 check(checkDigit(validPrefix)==="3","Known BIC standard sample CSQU3054383 check digit matches");
  const first=requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers","POST",containerInput("CSQU3054383")),201,"Create standard ISO container");
  track("containers","A",first.id);
  requireStatus(await send(a,"/api/shipments/"+sb.id+"/tracking","POST",
    {referenceType:"CT",referenceNumber:first.number,carrierCode:""}),400,"Tracking container cannot be attached to unrelated B/L");
  const ctTracking=requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking","POST",
    {referenceType:"CT",referenceNumber:first.number,carrierCode:""}),201,"Register existing container for shipment tracking");
  const refetch=requireStatus(await send(a,"/api/shipments/"+sa.id+"/tracking"),200,"Re-read stored tracking references");
  check(refetch.records.some(t=>t.id===ctTracking.id&&t.lastSyncedAtUtc===null&&t.snapshot===null),"Unsynced tracking has no fake provider snapshot");
 check(first.checkDigitValid===true && first.status==="Planned","Valid check digit recorded");
 requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers","POST",containerInput("CSQU3054383")),409,"Duplicate container within same B/L rejected");
 const badNumber=validPrefix+"4";
 requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers","POST",containerInput(badNumber)),400,"Bad ISO check digit requires acknowledgment");
 const second=requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers","POST",containerInput(badNumber,{acknowledgeInvalidDigit:true})),201,"Operator may explicitly acknowledge bad check digit");
 track("containers","A",second.id);
 check(!second.checkDigitValid && second.invalidDigitAcknowledged,"Invalid BIC warning persists on container");
 const thirdNumber="MSCU123456"+checkDigit("MSCU123456");
 const third=requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers","POST",containerInput(thirdNumber)),201,"Create third container");
 track("containers","A",third.id);
 requireStatus(await send(a,"/api/containers/"+first.id,"PUT",containerInput(first.number,{status:"Delivered",revision:1})),400,"Delivered container requires arrival/delivery timestamps");
 const sea=requireStatus(await send(a,"/api/containers/"+first.id,"PUT",containerInput(first.number,{status:"AtSea",revision:1})),200,"Container advances to AtSea");
 const port=requireStatus(await send(a,"/api/containers/"+first.id,"PUT",containerInput(first.number,{status:"AtPort",revision:sea.revision,arrivedAtPortDate:"2026-11-19"})),200,"Container arrives at port with date");
 const delivered=requireStatus(await send(a,"/api/containers/"+first.id,"PUT",containerInput(first.number,{status:"Delivered",revision:port.revision,arrivedAtPortDate:"2026-11-19",deliveredDate:"2026-11-21"})),200,"Container delivered with chronological dates");
 requireStatus(await send(a,"/api/containers/"+first.id,"PUT",containerInput(first.number,{status:"AtSea",revision:delivered.revision})),400,"Delivered container cannot silently regress");
 const rollup=requireStatus(await send(a,"/api/orders/"+oa.id),200,"Fetch order rollup after delivery");
 check(rollup.containerCount===3 && rollup.deliveredContainerCount===1 &&
       rollup.arrivalStatus==="PartiallyDelivered","Order shows exactly 1 of 3 containers delivered");
 requireStatus(await send(a,"/api/orders/"+oa.id+"?revision="+rollup.revision,"DELETE"),409,"Order with shipments cannot be deleted");
 requireStatus(await send(b,"/api/containers/"+first.id,"PUT",containerInput(first.number,{revision:delivered.revision})),404,"Cross-tenant container update returns 404");
 requireStatus(await send(a,"/api/shipments/"+sa.id+"/clearance","PUT",{brokerId:broker.id,
  declarationNumber:"",submittedDate:"2026-11-20",releasedDate:null,status:"Released",notes:"",revision:null}),400,"Released customs requires release date");
  const ca=requireStatus(await send(a,"/api/shipments/"+sa.id+"/clearance","PUT",{brokerId:broker.id,
   declarationNumber:"DEC-001",submittedDate:"2026-11-20",releasedDate:"2026-11-22",status:"Released",notes:"QA",revision:null,
   chargesCurrency:"SYP",customsValue:150000,customsDutyAmount:3500,taxAmount:900,
   brokerFees:100,demurrageFees:240,detentionFees:0,deliveredToWarehouseDate:"2026-11-23"}),200,"First B/L customs status Released");
  track("clearances","A",ca.id);
  check(ca.chargesCurrency==="SYP"&&ca.demurrageFees===240&&ca.customsValue===150000&&
    ca.deliveredToWarehouseDate==="2026-11-23","Separate customs charges and warehouse date persist");
  const oldClearance=requireStatus(await send(a,"/api/shipments/"+sa.id+"/clearance","PUT",{
    brokerId:broker.id,declarationNumber:"DEC-001",submittedDate:"2026-11-20",
    releasedDate:"2026-11-22",status:"Released",notes:"Legacy status edit",
    revision:ca.revision}),200,"Legacy customs status edit succeeds without charges");
  check(oldClearance.chargesCurrency==="SYP"&&oldClearance.demurrageFees===240&&
    oldClearance.customsValue===150000,
    "Legacy customs update does not zero declared customs amounts");
  requireStatus(await send(a,"/api/shipments/"+sa.id+"/clearance","PUT",{brokerId:broker.id,
    declarationNumber:"DEC-001",submittedDate:"2026-11-20",releasedDate:"2026-11-22",
    status:"Released",notes:"QA",revision:ca.revision,chargesCurrency:"SYP",
    demurrageFees:-1}),400,"Negative customs fees rejected server-side");
 const cb=requireStatus(await send(a,"/api/shipments/"+sb.id+"/clearance","PUT",{brokerId:broker.id,
  declarationNumber:"",submittedDate:null,releasedDate:null,status:"MissingDocs",notes:"QA pending",revision:null}),200,"Second B/L customs status MissingDocs");
 track("clearances","A",cb.id);
 const after=requireStatus(await send(a,"/api/orders/"+oa.id),200,"Re-read order with mixed customs statuses");
 check(after.clearanceStatus==="Partial","Order clearance rolls up as Partial, B/L still separate");
 requireStatus(await send(b,"/api/shipments/"+sa.id+"/clearance"),404,"Tenant B cannot read Tenant A customs");
 const list=requireStatus(await send(a,"/api/shipments/"+sa.id+"/containers"),200,"List containers under their own B/L");
 check(list.length===3 && list.filter(x=>x.status==="Delivered").length===1,"Per-B/L container list preserves delivery split");
 console.log("LOGISTICS_API_PASS_COUNT="+checks);
 console.log("QA_FIXTURES_FILE="+fixturePath);
}catch(e){
 console.error("WP06_TEST_FAILED",e);
 console.error("QA fixtures saved for targeted clean-up:",fixturePath);
 process.exitCode=1;
}
