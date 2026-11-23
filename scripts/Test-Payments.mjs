// WP-05: real local PostgreSQL, authenticated HTTP, CSRF and independent
// tenant sessions. Creates ONLY uniquely tagged QA entities; clean with
// scripts/Cleanup-ImportDocumentsQa.ps1 -Apply (review dry-run first).
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const root=process.cwd(), local=join(root,".local"), host="http://127.0.0.1:5089";
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="WP07_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const fixture={run,orders:[],companies:[],shipments:[],containers:[],documents:[],requirements:[],waivers:[]};
const file=join(local,"documents-qa-fixtures-"+run+".json");
const track=(type,tenant,id)=>{fixture[type].push({tenant,id});writeFileSync(file,JSON.stringify(fixture,null,2));};
writeFileSync(file,JSON.stringify(fixture,null,2));
let passCount=0;
const pass=s=>{passCount++;console.log("PASS "+s);};
async function call(session,path,method="GET",body){
  const headers={Accept:"application/json"};
  if(session){
    headers.Cookie=Object.entries(session.cookies).map(([k,v])=>k+"="+v).join("; ");
    if(!["GET","HEAD"].includes(method))headers["X-Wathiqa-CSRF"]=session.csrf;
  }
  if(body!==undefined&&!(body instanceof FormData))headers["Content-Type"]="application/json";
  const response=await fetch(host+path,{method,headers,body:body===undefined?undefined:
    body instanceof FormData?body:JSON.stringify(body),redirect:"manual"});
  if(session)for(const raw of response.headers.getSetCookie?.()||[]){
    const match=raw.match(/^([^=;]+)=([^;]*)/);if(match)session.cookies[match[1]]=match[2];
  }
  const raw=response.status===204?"":await response.text();
  let data=raw;try{data=JSON.parse(raw);}catch{}
  return{status:response.status,data};
}
function expect(response,status,label){
  assert.equal(response.status,status,label+" "+JSON.stringify(response.data).slice(0,700));
  pass(label);return response.data;
}
async function login(slug){
  const account=accounts.find(x=>x.slug===slug);assert(account);
  const session={cookies:{},csrf:""};
  session.csrf=(await call(session,"/api/auth/csrf")).data.token;
  expect(await call(session,"/api/auth/login","POST",{email:account.email,password:account.password}),200,"Login "+slug);
  session.csrf=(await call(session,"/api/auth/csrf")).data.token;
  return session;
}
const uniq=()=>randomUUID();
function orderInput(supplier,quantity,price=100){return{
  supplierId:supplier,customerId:null,supplierRef:run,orderDate:"2026-11-07",incoterm:"FOB",
  loadingPort:"Ningbo",dischargePort:"Latakia",currency:"USD",notes:run,
  items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",colorType:"White",
    quantity,quantityUnit:"KG",unitPrice:price,priceUnit:"KG",hsCode:"540246"}]};}
async function upload(session,orderId,kind="PaymentProof"){
  const bytes=Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  const form=new FormData();
  form.append("file",new Blob([bytes],{type:"application/pdf"}),"payment-"+run+".pdf");
  form.append("type",kind);form.append("orderId",orderId);
  const response=expect(await call(session,"/api/documents","POST",form),201,
    "Proof document uploaded and linked to exact order");
  track("documents",session.label,response.document.id);
  return response.document.id;
}
async function revision(s,id){return(await call(s,"/api/orders/"+id+"/finances")).data.revision;}
function amounts(data,commercial,gross,appliedExpense,difference){
  assert.equal(data.commercialAmount,commercial);
  assert.equal(data.grossActiveTransferred,gross);
  assert.equal(data.appliedCommercial,Math.min(commercial,gross));
  assert.equal(data.appliedExpenses,appliedExpense);
  assert.equal(data.unresolvedDifference,difference);
  assert.equal(data.grossActiveTransferred,data.appliedCommercial+data.appliedExpenses+data.unresolvedDifference);
}
try{
  expect(await call(null,"/api/orders/"+uniq()+"/finances"),401,"Financial reports require login");
  const a=await login("demo-a"),b=await login("demo-b");a.label="A";b.label="B";
  const supplier=expect(await call(a,"/api/companies","POST",{name:run+" supplier",type:"Supplier"}),201,
    "Create Tenant A supplier");track("companies","A",supplier.id);
  const broker=expect(await call(a,"/api/companies","POST",{name:run+" broker",type:"Broker"}),201,
    "Create Tenant A broker");track("companies","A",broker.id);
  const ownB=expect(await call(b,"/api/companies","POST",{name:run+" B supplier",type:"Supplier"}),201,
    "Create Tenant B supplier");track("companies","B",ownB.id);
  const order=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,1000)),201,
    "Create 100,000 USD purchase order");track("orders","A",order.id);
  const orderB=expect(await call(b,"/api/orders","POST",orderInput(ownB.id,100)),201,
    "Create separate Tenant B order");track("orders","B",orderB.id);
  const proof=await upload(a,order.id);
  const otherProof=await upload(b,orderB.id);
  const empty=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"Read empty financial state");
  amounts(empty,100000,0,0,0);
  expect(await call(b,"/api/orders/"+order.id+"/finances"),404,"Tenant B cannot read Tenant A finances");
  expect(await call(b,"/api/orders/"+order.id+"/payment-schedules","POST",
    {kind:"Advance",amount:1000,dueDate:"2026-11-01",idempotencyKey:uniq(),revision:1}),404,
    "Foreign Tenant cannot add schedule");
  const advanceInput={kind:"Advance",amount:60000,dueDate:"2026-11-01",notes:"Due first",
    idempotencyKey:uniq(),revision:await revision(a,order.id)};
  expect(await call(a,"/api/orders/"+order.id+"/payment-schedules","POST",advanceInput),201,
    "Create planned advance without pretending money was sent");
  expect(await call(a,"/api/orders/"+order.id+"/payment-schedules","POST",
    {...advanceInput,revision:await revision(a,order.id)}),200,"Repeated schedule key replays original");
  const balance=expect(await call(a,"/api/orders/"+order.id+"/payment-schedules","POST",
    {kind:"Balance",amount:40000,dueDate:"2026-11-15",notes:"Balance",
      idempotencyKey:uniq(),revision:await revision(a,order.id)}),201,"Create planned balance");
  const before=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"Plans alone leave payment at zero");
  amounts(before,100000,0,0,0);assert.equal(before.isPaymentOverdue,true);
  expect(await call(a,"/api/orders/"+order.id+"/payment-schedules","POST",
    {kind:"Other",amount:1,dueDate:"2026-11-08",idempotencyKey:uniq(),revision:before.revision}),409,
    "Cannot plan more than commercial order amount");
  const transferInput={amount:105000,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",
    method:"BankTransfer",reference:run,proofDocumentId:proof,idempotencyKey:uniq(),revision:before.revision};
  const transfer=expect(await call(a,"/api/orders/"+order.id+"/payment-transfers","POST",transferInput),201,
    "Record real 105k transfer, auto-apply only 100k to goods");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers","POST",transferInput),200,
    "Retry with same idempotency key does not duplicate transfer");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers","POST",
    {...transferInput,amount:100000}),409,"Same idempotency key with changed payload rejected");
  let current=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"105k transfer creates same-order 5k discrepancy");
  amounts(current,100000,105000,0,5000);
  assert.equal(current.commercialRemainingDue,0);
  assert.equal(current.paymentStatus,"Paid");
  assert.equal(current.isPaymentOverdue,false);
  assert(current.schedules.every(x=>x.remaining===0));
  expect(await call(a,"/api/orders/"+order.id,"PUT",
    {...orderInput(supplier.id,500),revision:current.revision}),409,
    "Cannot rewrite commercial totals after real financial facts");
  expect(await call(a,"/api/orders/"+order.id+"?revision="+current.revision,"DELETE"),409,
    "Cannot delete Order with financial history");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers","POST",
    {...transferInput,proofDocumentId:otherProof,idempotencyKey:uniq(),revision:current.revision}),400,
    "Document from another tenant/order cannot prove payment");
  const expenseEvidence=await upload(a,order.id,"Other");
  const brokerExpense=expect(await call(a,"/api/orders/"+order.id+"/expenses","POST",
    {amount:5000,payeeCompanyId:broker.id,category:"Customs",description:"Customs broker invoice",
      evidenceDocumentId:expenseEvidence,idempotencyKey:uniq(),revision:current.revision}),201,
    "Record unpaid third-party customs expense");
  current=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"Recording expense does not imply paying it");
  amounts(current,100000,105000,0,5000);
  expect(await call(a,"/api/orders/"+order.id+"/expenses/"+brokerExpense.id+"/allocations","POST",
    {transferId:transfer.id,amount:5000,idempotencyKey:uniq(),revision:current.revision}),409,
    "Yarn supplier remittance cannot pay unrelated broker");
  const ownExpense=expect(await call(a,"/api/orders/"+order.id+"/expenses","POST",
    {amount:3000,payeeCompanyId:supplier.id,category:"Other",description:"Same-order supplier charge",
      evidenceDocumentId:expenseEvidence,idempotencyKey:uniq(),revision:current.revision}),201,
    "Record supported same-beneficiary expense");
  const allocInput={transferId:transfer.id,amount:3000,idempotencyKey:uniq(),revision:await revision(a,order.id)};
  expect(await call(a,"/api/orders/"+order.id+"/expenses/"+ownExpense.id+"/allocations","POST",allocInput),201,
    "Allocate 3000 only to documented expense on same order");
  expect(await call(a,"/api/orders/"+order.id+"/expenses/"+ownExpense.id+"/allocations","POST",allocInput),200,
    "Expense allocation idempotent retry");
  current=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"Partial reconciliation preserves 2k difference");
  amounts(current,100000,105000,3000,2000);
  const refundInput={amount:2000,returnDate:"2026-11-08",bankReference:"REF-"+run,
    proofDocumentId:proof,reason:"Bank returned actual surplus",idempotencyKey:uniq(),revision:current.revision};
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers/"+transfer.id+"/returns","POST",refundInput),201,
    "Real bank return is separate event, not voiding old transfer");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers/"+transfer.id+"/returns","POST",refundInput),200,
    "Bank return idempotency guards replay");
  current=expect(await call(a,"/api/orders/"+order.id+"/finances"),200,"2k return clears remainder without concealing history");
  amounts(current,100000,103000,3000,0);
  assert.equal(current.actualReturns,2000);assert.equal(current.transfers[0].state,"Active");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers/"+transfer.id+"/returns","POST",
    {...refundInput,amount:1,idempotencyKey:uniq(),revision:current.revision}),409,
    "Cannot return already allocated money");
  expect(await call(a,"/api/orders/"+order.id+"/payment-transfers/"+transfer.id+"/correct","POST",
    {amount:100000,transferDate:"2026-11-07",method:"BankTransfer",reference:"correction",
      proofDocumentId:proof,reason:"Wrong amount recorded in ledger",idempotencyKey:uniq(),revision:current.revision}),409,
    "Correction blocked when transfer already has expense allocations/real return");
  const order2=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,50)),201,
    "Create separate order for independent clerical correction");track("orders","A",order2.id);
  const proof2=await upload(a,order2.id);
  const t2Input={amount:5500,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",method:"BankTransfer",
    reference:"original ledger entry",proofDocumentId:proof2,idempotencyKey:uniq(),revision:order2.revision};
  const t2=expect(await call(a,"/api/orders/"+order2.id+"/payment-transfers","POST",t2Input),201,
    "Record mistaken 5,500 entry on separate 5,000 order");
  const correctInput={amount:5000,transferDate:"2026-11-07",method:"BankTransfer",
    reference:"correct bank evidence",proofDocumentId:proof2,
    reason:"Original amount entered incorrectly",idempotencyKey:uniq(),revision:await revision(a,order2.id)};
  const t2Fixed=expect(await call(a,"/api/orders/"+order2.id+"/payment-transfers/"+t2.id+"/correct","POST",correctInput),201,
    "Void old ledger entry and create linked corrected transfer atomically");
  expect(await call(a,"/api/orders/"+order2.id+"/payment-transfers/"+t2.id+"/correct","POST",correctInput),200,
    "Correction replay returns same replacement");
  const f2=expect(await call(a,"/api/orders/"+order2.id+"/finances"),200,"Corrected transfer recalculates financial totals");
  amounts(f2,5000,5000,0,0);
  assert.equal(f2.transfers.length,2);
  assert.equal(f2.transfers.find(x=>x.id===t2.id).state,"Voided");
  assert.equal(f2.transfers.find(x=>x.id===t2Fixed.id).replacesTransferId,t2.id);
  expect(await call(a,"/api/orders/"+order.id+"/expenses/"+ownExpense.id+"/allocations","POST",
    {transferId:t2Fixed.id,amount:1,idempotencyKey:uniq(),revision:await revision(a,order.id)}),404,
    "Allocation cannot link transfer from another order, even same supplier");
  expect(await call(b,"/api/orders/"+order2.id+"/finances"),404,"Other tenant cannot read corrected bank history");
  const incomplete=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,10)),201,
    "Create administratively closable unpaid order");track("orders","A",incomplete.id);
  const closed=expect(await call(a,"/api/orders/"+incomplete.id+"/close","POST",
    {revision:incomplete.revision,reason:"Supplier dispute; administratively archived for reconciliation"}),200,
    "Admin closes with documented exception, not fictional payment");
  assert.equal(closed.closedWithExceptions,true);
  const fclosed=expect(await call(a,"/api/orders/"+incomplete.id+"/finances"),200,"Closed order retains unpaid financial obligation");
  assert.equal(fclosed.commercialRemainingDue,1000);
  assert.equal(fclosed.status,"Closed");
  expect(await call(a,"/api/orders/"+incomplete.id+"/cancel","POST",
    {revision:fclosed.revision,reason:"Attempt invalid cancellation"}),409,
    "A closed order cannot be silently cancelled");
  const blockedCancel=expect(await call(a,"/api/orders/"+order2.id+"/cancel","POST",
    {revision:f2.revision,reason:"No safe refund or balance disposition"}),409,
    "Cannot cancel purchase order with actual transfer history");
  const safe=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,3)),201,
    "Create bare draft for safe cancellation");track("orders","A",safe.id);
  expect(await call(a,"/api/orders/"+safe.id+"/cancel","POST",
    {revision:safe.revision,reason:"Duplicate unissued purchase draft"}),200,
    "Safe draft cancellation is audited without erasing order");
  expect(await call(a,"/api/orders/"+safe.id+"/payment-transfers","POST",
    {...transferInput,proofDocumentId:proof,idempotencyKey:uniq(),revision:2}),409,
    "Cancelled draft cannot accept bank payments");
  expect(await call(a,"/api/orders/"+safe.id+"/payment-schedules","POST",
    {kind:"Advance",amount:50,dueDate:"2026-11-07",revision:2,idempotencyKey:uniq()}),409,
    "Cancelled draft cannot receive a planned payment");
  const audited=expect(await call(a,"/api/orders/"+order2.id+"/payment-audits"),200,
    "Read tenant-scoped immutable payment audit events");
  assert(audited.items.some(x=>x.action==="TransferVoidReplace" &&
    x.beforeJson.includes(t2.id)&&x.afterJson.includes(t2Fixed.id)));
  expect(await call(b,"/api/orders/"+order2.id+"/payment-audits"),404,
    "Tenant B cannot read another merchant's correction audit");
  const ordered=expect(await call(a,"/api/orders?q="+run),200,
    "Financial order report derives paid and outstanding from allocations");
  assert.equal(ordered.financialsAvailable,true);
  assert.equal(ordered.items.find(x=>x.id===order.id).paidAmount,100000);
  assert.equal(ordered.items.find(x=>x.id===order.id).remainingAmount,0);
  assert.equal(ordered.items.find(x=>x.id===order.id).unresolvedDifference,0);
  assert.equal(ordered.items.find(x=>x.id===incomplete.id).remainingAmount,1000);
  assert.equal(ordered.items.find(x=>x.id===incomplete.id).closedWithExceptions,true);
  const paidList=expect(await call(a,"/api/orders?q="+run+"&payment=Paid"),200,
    "Paid filter uses commercial allocation facts");
  assert.equal(paidList.total,2);
  assert(paidList.items.every(x=>x.remainingAmount===0));
  const owing=expect(await call(a,"/api/orders?q="+run+"&payment=Outstanding"),200,
    "Outstanding filter includes all orders still owing goods value");
  assert.equal(owing.total,2);
  assert(owing.items.every(x=>x.remainingAmount>0));
  const closedList=expect(await call(a,"/api/orders?q="+run+"&status=Closed"),200,
    "Administrative close remains visible in financial reports");
  assert.equal(closedList.total,1);
  assert.equal(closedList.items[0].id,incomplete.id);
  const overdueOrder=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,7)),201,
    "Create different unpaid order for genuine overdue schedule");track("orders","A",overdueOrder.id);
  const overdueSchedule=expect(await call(a,"/api/orders/"+overdueOrder.id+"/payment-schedules","POST",
    {kind:"Balance",amount:700,dueDate:"2026-11-01",idempotencyKey:uniq(),
      revision:overdueOrder.revision}),201,"Create unpaid schedule with due date in the past");
  const overdueFilter=expect(await call(a,"/api/orders?q="+run+"&overdue=true"),200,
    "Overdue report finds only orders with uncovered past-due schedules");
  assert.equal(overdueFilter.total,1);
  assert.equal(overdueFilter.items[0].id,overdueOrder.id);
  const proofList=expect(await call(a,"/api/documents?orderId="+order.id),200,
    "Retrieve order-specific proof document metadata");
  const proofRow=proofList.items.find(x=>x.id===proof);
  assert(proofRow?.links.find(x=>x.orderId===order.id),"PaymentProof must have direct order link");
  const proofLink=proofRow.links.find(x=>x.orderId===order.id);
  expect(await call(a,"/api/document-links/"+proofLink.id,"DELETE"),409,
    "Financial evidence cannot be unlinked while a transfer needs it");
  expect(await call(a,"/api/documents/"+proof,"DELETE"),409,
    "Financial evidence cannot be soft-deleted while referenced by payment history");
  expect(await call(a,"/api/companies/"+broker.id,"DELETE"),409,
    "Broker receiving documented expense cannot be removed from commercial directory");
  const concurrent=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,10)),201,
    "Create isolated concurrency QA order");track("orders","A",concurrent.id);
  const proofConcurrent=await upload(a,concurrent.id);
  const raceInput={amount:600,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",
    method:"BankTransfer",reference:"RACE-"+run,proofDocumentId:proofConcurrent,
    revision:concurrent.revision};
  const raced=await Promise.all([
    call(a,"/api/orders/"+concurrent.id+"/payment-transfers","POST",
      {...raceInput,idempotencyKey:uniq()}),
    call(a,"/api/orders/"+concurrent.id+"/payment-transfers","POST",
      {...raceInput,idempotencyKey:uniq()})
  ]);
  assert.deepEqual(raced.map(x=>x.status).sort(),[201,409]);
  pass("Two concurrent writes with same Order revision serialize: exactly one succeeds");
  const afterRace=expect(await call(a,"/api/orders/"+concurrent.id+"/finances"),200,
    "Concurrent transaction does not double-count money");
  assert.equal(afterRace.grossActiveTransferred,600);
  assert.equal(afterRace.transfers.length,1);
  const invite=expect(await call(a,"/api/users/invitations","POST",
    {email:"finance-qa-"+run.toLowerCase()+"@wathiqa.invalid"}),200,
    "Admin invites ordinary Staff for financial visibility/permission test");
  const staffPassword="Q!a123456789_"+uniq().replaceAll("-","").slice(0,12);
  const staffEmail="finance-qa-"+run.toLowerCase()+"@wathiqa.invalid";
  const staffSession={cookies:{},csrf:""};
  staffSession.csrf=(await call(staffSession,"/api/auth/csrf")).data.token;
  const staff=expect(await call(staffSession,"/api/auth/invitations/accept","POST",
    {token:invite.token,displayName:"Financial QA Staff",password:staffPassword}),201,
    "Staff activates own non-financial-writing account");
  const staffLogin={cookies:{},csrf:""};
  staffLogin.csrf=(await call(staffLogin,"/api/auth/csrf")).data.token;
  expect(await call(staffLogin,"/api/auth/login","POST",
    {email:staffEmail,password:staffPassword}),200,"Staff authenticates with separate session");
  staffLogin.csrf=(await call(staffLogin,"/api/auth/csrf")).data.token;
  expect(await call(staffLogin,"/api/orders/"+order.id+"/finances"),200,
    "Ordinary Staff may view company financial balances");
  expect(await call(staffLogin,"/api/orders/"+order.id+"/payment-transfers","POST",
    {...transferInput,idempotencyKey:uniq(),revision:await revision(a,order.id)}),403,
    "Staff without CanManagePayments cannot write a transfer");
  expect(await call(staffLogin,"/api/orders/"+overdueOrder.id+"/close","POST",
    {reason:"Administrative exception reserved for tenant Admin",revision:2}),403,
    "Staff cannot administratively close orders even with company read rights");
  expect(await call(a,"/api/users/"+staff.id+"/payment-permission","PUT",
    {canManagePayments:true}),200,"Admin grants Staff CanManagePayments live");
  const authorizedStaffTransfer=expect(await call(staffLogin,"/api/orders/"+concurrent.id+"/payment-transfers","POST",
    {amount:100,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",method:"BankTransfer",
      reference:"STAFF-"+run,proofDocumentId:proofConcurrent,
      idempotencyKey:uniq(),revision:await revision(a,concurrent.id)}),201,
    "Staff with CanManagePayments may record a correctly scoped transaction");
  assert(authorizedStaffTransfer.id);
  expect(await call(a,"/api/users/"+staff.id+"/payment-permission","PUT",
    {canManagePayments:false}),200,"Admin revokes Staff payment permission live");
  expect(await call(staffLogin,"/api/orders/"+concurrent.id+"/payment-transfers","POST",
    {amount:50,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",method:"BankTransfer",
      reference:"REVOKED-"+run,proofDocumentId:proofConcurrent,
      idempotencyKey:uniq(),revision:await revision(a,concurrent.id)}),403,
    "Revoked Staff loses money-write permission without re-login");
  expect(await call(a,"/api/users/"+staff.id+"/active","PUT",{isActive:false}),200,
    "Admin disables test Staff account after permission verification");
  const documentRaceOrder=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,4)),201,
    "Create independent proof/deletion race QA order");track("orders","A",documentRaceOrder.id);
  const raceProofDocument=await upload(a,documentRaceOrder.id);
  const proofRace=await Promise.all([
    call(a,"/api/orders/"+documentRaceOrder.id+"/payment-transfers","POST",
      {amount:400,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",method:"BankTransfer",
        reference:"PROOF-RACE-"+run,proofDocumentId:raceProofDocument,
        revision:documentRaceOrder.revision,idempotencyKey:uniq()}),
    call(a,"/api/documents/"+raceProofDocument,"DELETE")
  ]);
  assert([[201,409],[400,204]].some(expected=>
    expected.every((status,index)=>status===proofRace[index].status)),
    "Unexpected payment/proof deletion race: "+JSON.stringify(proofRace.map(x=>x.status)));
  pass("Proof deletion and payment write serialize: never accept a transfer with deleted evidence");
  const proofRaceResult=expect(await call(a,"/api/orders/"+documentRaceOrder.id+"/finances"),200,
    "Financial state remains valid after proof deletion race");
  assert.equal(proofRaceResult.transfers.length,proofRace[0].status===201?1:0);
  // Leave a deliberately unresolved, uniquely tagged QA discrepancy for the
  // real-browser acceptance test, then remove it via guarded QA cleanup.
  const browserOrder=expect(await call(a,"/api/orders","POST",orderInput(supplier.id,1000)),201,
    "Create proof-backed browser demo Order worth 100k");
  track("orders","A",browserOrder.id);
  const browserProof=await upload(a,browserOrder.id);
  const browserExpenseProof=await upload(a,browserOrder.id,"Other");
  const browserTransfer=expect(await call(a,"/api/orders/"+browserOrder.id+"/payment-transfers","POST",
    {amount:105000,beneficiaryCompanyId:supplier.id,transferDate:"2026-11-07",
      method:"BankTransfer",reference:"BROWSER-"+run,
      proofDocumentId:browserProof,idempotencyKey:uniq(),revision:browserOrder.revision}),201,
    "Create unresolved 5000 discrepancy for Arabic browser review");
  fixture.warningOrderId=browserOrder.id;fixture.warningTransferId=browserTransfer.id;
  fixture.warningSupplierId=supplier.id;
  fixture.warningPaymentProofId=browserProof;
  fixture.warningExpenseProofId=browserExpenseProof;
  writeFileSync(file,JSON.stringify(fixture,null,2));
  console.log("WP05_PAYMENT_API_PASS_COUNT="+passCount);
  console.log("WP05_QA_FIXTURE="+file);
}catch(error){
  console.error("WP05_TEST_FAILED",error);
  console.error("WP05_QA_FIXTURE="+file);
  process.exitCode=1;
}
