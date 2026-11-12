// Real Postgres + .NET + loopback ShipsGo provider fixture.
// Never configure a real provider token; QA rows are uniquely tagged.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local"),base="http://127.0.0.1:5089";
const prefix=randomUUID().replaceAll("-","").slice(0,12),run="PA_QA_"+prefix;
const slug="pa-qa-"+prefix;
const email="owner-"+run.toLowerCase()+"@wathiqa.invalid";
const password="QA!Merchant9Aa"+randomUUID().replaceAll("-","").slice(0,14);
const account=JSON.parse(readFileSync(join(local,"platform-superadmin-account.json"),"utf8").replace(/^\uFEFF/,""));
const demos=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const fixture={run,tenantId:null,adminUserId:null,planIds:[],orderId:null,
  supplierId:null,shipmentIds:[],containerIds:[],trackingIds:[]};
const path=join(local,"platform-qa-fixture-"+run+".json");
const persist=()=>writeFileSync(path,JSON.stringify(fixture,null,2));
let passed=0;
function pass(label){console.log("PASS "+label);passed++}
function session(){return {cookies:{},csrf:""}}
async function api(s,path,method="GET",body){
  const headers={Accept:"application/json"};
  if(s){
    headers.Cookie=Object.entries(s.cookies)
      .filter(([name])=>path.startsWith("/api/platform")
        ?name.includes("platform")||name.includes("antiforgery")
        :!name.includes("platform")||name.includes("antiforgery"))
      .map(([k,v])=>k+"="+v).join("; ");
    if(method!=="GET")headers["X-Wathiqa-CSRF"]=s.csrf;
  }
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(base+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(20000)
  });
  if(s)for(const raw of response.headers.getSetCookie?.()||[]){
    const match=raw.match(/^([^=;]+)=([^;]*)/);if(match)s.cookies[match[1]]=match[2];
  }
  let data=null;
  try{data=await response.json()}catch{}
  return {status:response.status,data};
}
function expect(r,status,title){
  assert.equal(r.status,status,title+" "+JSON.stringify(r.data).slice(0,750));
  pass(title);return r.data;
}
async function login(s,endpoint,user,pwd){
  s.csrf=expect(await api(s,"/api/auth/csrf"),200,"Issued CSRF token").token;
  expect(await api(s,endpoint,"POST",{email:user,password:pwd}),200,"Signed into "+endpoint);
  s.csrf=(await api(s,"/api/auth/csrf")).data.token;
}
async function mock(){
  const response=await fetch("http://127.0.0.1:5099/__qa_stats",{signal:AbortSignal.timeout(7000)});
  assert.equal(response.status,200);
  return response.json();
}
try{
  persist();
  const platform=session();
  await login(platform,"/api/platform/auth/login",account.email,account.password);
  const input={name:run+" merchant",slug,adminEmail:email,adminPassword:password,
    accessMode:"Unlimited",accessExpiresAtUtc:null,
    reason:"QA direct password and tracked bills integration test"};
  const weak=await api(platform,"/api/platform/tenants","POST",{
    ...input,adminPassword:"weak"});
  assert.equal(weak.status,400);
  assert.equal(weak.data.error,"invalid_user_or_password");
  pass("Weak merchant admin password rejected before tenant creation");
  const tenant=expect(await api(platform,"/api/platform/tenants","POST",input),
    201,"SuperAdmin provisions a real Admin with supplied password");
  fixture.tenantId=tenant.id;fixture.adminUserId=tenant.adminUserId;persist();
  assert.equal(tenant.accountReady,true);
  assert.equal(tenant.invitationToken,null);
  assert(!JSON.stringify(tenant).includes(password));
  pass("No invitation and no plaintext password exposed by tenant API");
  const merchant=session();
  await login(merchant,"/api/auth/login",email,password);
  const me=expect(await api(merchant,"/api/auth/me"),200,
    "Provisioned merchant Admin logs in immediately");
  assert.equal(me.role,"Admin");assert.equal(me.tenantId,tenant.id);
  const planCode=slug+"-3m";
  const plan=expect(await api(platform,"/api/platform/plans","POST",{
    code:planCode,name:run+" tracking plan",durationMonths:3,
    maxTrackedBills:1,reason:"QA exactly one B/L per subscription cycle"
  }),201,"Platform creates one-B/L tracking plan");
  fixture.planIds.push({id:plan.id,code:planCode});persist();
  assert.equal(plan.maxTrackedBills,1);
  expect(await api(platform,"/api/platform/tenants/"+tenant.id+
    "/subscription/assign","POST",{
      planId:plan.id,revision:tenant.platformRevision,reason:"QA activate one tracked B/L"
    }),200,"Assign tracking plan to merchant");
  const company=expect(await api(merchant,"/api/companies","POST",{
    name:run+" supplier",type:"Supplier"
  }),201,"Merchant creates one test supplier");
  fixture.supplierId=company.id;persist();
  const order=expect(await api(merchant,"/api/orders","POST",{
    supplierId:company.id,customerId:null,supplierRef:run,
    orderDate:"2026-11-12",incoterm:"FOB",loadingPort:"Ningbo",
    dischargePort:"Latakia",currency:"USD",notes:run,
    items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",
      colorType:"White",quantity:1000,quantityUnit:"KG",
      unitPrice:2,priceUnit:"KG",hsCode:"540246"}]
  }),201,"Merchant creates one QA purchase order");
  fixture.orderId=order.id;persist();
  const bls=[];
  for(const suffix of ["A","B"]){
    const bl="MBL"+prefix.toUpperCase()+suffix;
    const shipment=expect(await api(merchant,"/api/orders/"+order.id+"/shipments","POST",{
      blNumber:bl,blType:"Original",blOriginalStatus:"NotReceived",
      shippingLineId:null,vessel:"QA SHIP",voyage:"QA1",
      portOfLoading:"Ningbo",portOfDischarge:"Latakia",
      etd:"2026-11-12",eta:"2026-12-12",freeTimeDays:12,
      trackingUrl:"",revision:null
    }),201,"Merchant creates QA B/L "+suffix);
    fixture.shipmentIds.push(shipment.id);persist();
    bls.push(shipment);
  }
  const container=expect(await api(merchant,"/api/shipments/"+bls[0].id+
    "/containers","POST",{
      number:"CSQU3054383",size:"40HC",sealNumber:"QA",
      grossWeightKg:18000,netWeightKg:17000,status:"Planned",
      acknowledgeInvalidDigit:false
    }),201,"B/L includes a registered ISO container");
  fixture.containerIds.push(container.id);persist();
  const refBL=expect(await api(merchant,"/api/shipments/"+bls[0].id+"/tracking",
    "POST",{referenceType:"BL",referenceNumber:bls[0].blNumber,carrierCode:"MSC"}),
    201,"Register first B/L reference (no ShipsGo credit)");
  fixture.trackingIds.push(refBL.id);persist();
  const refCT=expect(await api(merchant,"/api/shipments/"+bls[0].id+"/tracking",
    "POST",{referenceType:"CT",referenceNumber:container.number,carrierCode:"MSC"}),
    201,"Register container of first B/L (still no ShipsGo credit)");
  fixture.trackingIds.push(refCT.id);persist();
  const refSecond=expect(await api(merchant,"/api/shipments/"+bls[1].id+"/tracking",
    "POST",{referenceType:"BL",referenceNumber:bls[1].blNumber,carrierCode:"MSC"}),
    201,"Register second B/L reference");
  fixture.trackingIds.push(refSecond.id);persist();
  const editable=expect(await api(merchant,"/api/shipments/"+bls[1].id),
    200,"Read unactivated B/L before correction");
  const correctedNumber=editable.blNumber+"R";
  expect(await api(merchant,"/api/shipments/"+bls[1].id,"PUT",{
    ...editable,blNumber:correctedNumber,revision:editable.revision
  }),200,"Correct B/L before activation");
  const correctedRefs=expect(await api(merchant,"/api/shipments/"+bls[1].id+"/tracking"),
    200,"Read references after unactivated B/L correction");
  assert.equal(correctedRefs.records.find(x=>x.id===refSecond.id).referenceNumber,
    correctedNumber);
  pass("Pending B/L tracking reference is automatically relinked on correction");
  const before=expect(await api(merchant,"/api/shipments/"+bls[0].id+"/tracking"),
    200,"Read quota before activation");
  assert.equal(before.quota.limit,1);assert.equal(before.quota.used,0);
  assert.equal(before.provider,"ShipsGo");assert.equal(before.configured,true);
  assert.equal((await mock()).posts,0);
  const activated=expect(await api(merchant,"/api/tracking/"+refBL.id+"/refresh","POST"),
    200,"First ShipsGo B/L activates and fetches a cached voyage");
  assert.equal(activated.snapshot.vessel,"QA SEA VESSEL");
  assert.equal(activated.snapshot.latitude,31.12);
  assert.equal((await mock()).posts,1);
  const lockedBill=expect(await api(merchant,"/api/shipments/"+bls[0].id),
    200,"Read activated B/L for immutable-number guard");
  const forbiddenChange=await api(merchant,"/api/shipments/"+bls[0].id,"PUT",{
    ...lockedBill,blNumber:lockedBill.blNumber+"R",revision:lockedBill.revision
  });
  assert.equal(forbiddenChange.status,409);
  assert.equal(forbiddenChange.data.error,"tracking_bl_change_requires_reconciliation");
  pass("Activated B/L cannot be silently rebound to a different ShipsGo shipment");
  const after=expect(await api(merchant,"/api/shipments/"+bls[0].id+"/tracking"),
    200,"Quota reflects one activated B/L");
  assert.equal(after.quota.used,1);assert.equal(after.quota.remaining,0);
  const sameBill=expect(await api(merchant,"/api/tracking/"+refCT.id+"/refresh","POST"),
    200,"Container shares same ShipsGo MBL tracking, with no extra credit");
  assert.equal(sameBill.snapshot.voyage,"QA-01");
  assert.equal((await mock()).posts,1);
  const blocked=await api(merchant,"/api/tracking/"+refSecond.id+"/refresh","POST");
  assert.equal(blocked.status,403);assert.equal(blocked.data.error,"tracking_quota_exceeded");
  pass("Second distinct B/L blocked by plan limit; ShipsGo paid POST count stays one");
  const sub=expect(await api(platform,"/api/platform/tenants/"+tenant.id+
    "/subscription"),200,"Platform subscription remains tenant-bound");
  const renewed=expect(await api(platform,"/api/platform/tenants/"+tenant.id+
    "/subscription/renew","POST",{
      revision:sub.platformRevision,reason:"QA renew one B/L tracking cycle"
    }),200,"Renew subscription to start a fresh quota cycle");
  assert(renewed.platformRevision>sub.platformRevision);
  const postRenew=expect(await api(merchant,"/api/shipments/"+bls[1].id+"/tracking"),
    200,"New cycle begins with unused quota");
  assert.equal(postRenew.quota.used,0);
  const second=expect(await api(merchant,"/api/tracking/"+refSecond.id+"/refresh","POST"),
    200,"Second B/L activates after subscription renewal");
  assert.equal(second.snapshot.status,"IN_TRANSIT");
  assert.equal((await mock()).posts,2);
  const other=session();
  const demoB=demos.find(x=>x.slug==="demo-b");assert(demoB);
  await login(other,"/api/auth/login",demoB.email,demoB.password);
  assert.equal((await api(other,"/api/tracking/"+refBL.id+"/refresh","POST")).status,404);
  pass("Other tenant cannot access activation records");
  const audit=expect(await api(platform,"/api/platform/audits?tenantId="+tenant.id),
    200,"Platform audit remains secret-free");
  assert(!JSON.stringify(audit).includes(password));
  pass("No password stored in platform audit or API output");
  console.log("SHIPSGO_TEST_PASS_COUNT="+passed);
  console.log("SHIPSGO_QA_FIXTURE="+path);
}catch(error){
  console.error("SHIPSGO_TEST_FAILED="+error.stack);
  console.error("SHIPSGO_QA_FIXTURE="+path);
  process.exitCode=1;
}
