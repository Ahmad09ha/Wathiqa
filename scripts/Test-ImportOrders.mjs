// Real PostgreSQL + HTTP integration tests for WP-04.
// Uses local-only demo accounts and cleans up all disposable draft orders
// with the public API; does not touch old editor or real business records.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const creds = JSON.parse(readFileSync(join(root, ".local/import-demo-accounts.json"), "utf8").replace(/^\uFEFF/, ""));
const base = process.env.WATHIQA_TEST_URL || "http://127.0.0.1:5089";
const adminA = creds.find(x => x.slug === "demo-a");
const adminB = creds.find(x => x.slug === "demo-b");
if (!adminA || !adminB) throw Error("Missing demo accounts, run scripts/Bootstrap-ImportDemo.ps1");
let passed = 0;
const created = { A: [], B: [] };
const suppliers = { A: [], B: [] };
function ok(message) { ++passed; process.stdout.write("PASS " + message + "\n"); }
async function send(session, path, method = "GET", body) {
  const headers = { Accept: "application/json" };
  if (session) {
    headers.Cookie = Object.entries(session.cookies).map(([k,v])=>k + "=" + v).join("; ");
    if (!["GET", "HEAD"].includes(method)) headers["X-Wathiqa-CSRF"] = session.token;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  for (const cookie of (res.headers.getSetCookie?.() || [])) {
    const match = cookie.match(/^([^=;]+)=([^;]*)/);
    if (session && match) session.cookies[match[1]] = match[2];
  }
  let data = null; if (res.status !== 204) {
    const text = await res.text();
    if (text) { try {data=JSON.parse(text)}catch{data=text} }
  }
  return {status:res.status,data,headers:res.headers};
}
async function sessionFor(account) {
  const session = { cookies:{}, token: "" };
  let r=await send(session,"/api/auth/csrf");
  assert.equal(r.status,200); session.token=r.data.token;
  r=await send(session,"/api/auth/login","POST",{email:account.email,password:account.password});
  assert.equal(r.status,200,JSON.stringify(r.data));
  r=await send(session,"/api/auth/csrf");
  session.token=r.data.token;
  return session;
}
async function expect(res,status,label) {
  assert.equal(res.status,status,label+": "+JSON.stringify(res.data));
  ok(label);
}
function request(supplierId,items,extras={}) {
  return {
    supplierId, customerId:null, supplierRef:"PI-QA-"+randomUUID().slice(0,8),
    orderDate:"2026-11-06", incoterm:"FOB", loadingPort:"Ningbo",
    dischargePort:"Latakia", currency:"USD", notes:"اختبار قابل للتنظيف",
    items, revision:null, ...extras
  };
}
const kgLine = {productType:"POY",denier:"150/48",luster:"SD",grade:"AA",colorType:"Raw White",quantity:500,quantityUnit:"KG",unitPrice:2,priceUnit:"KG",hsCode:"540246"};
const tonLine = {productType:"DTY",denier:"75/36",luster:"FD",grade:"A",colorType:"Dope Dyed",quantity:2,quantityUnit:"TON",unitPrice:1000,priceUnit:"TON",hsCode:"540233"};
const oneCentLine = {productType:"FDY",denier:"",luster:"",grade:"AA",colorType:"",quantity:1,quantityUnit:"KG",unitPrice:1.005,priceUnit:"KG",hsCode:""};
let a,b;
try {
  await expect(await send(null,"/api/orders"),401,"Anonymous orders list is denied");
  a=await sessionFor(adminA); b=await sessionFor(adminB);
  ok("Two distinct tenants signed in");
  const names="QA-Order-"+randomUUID().slice(0,8);
  let r=await send(a,"/api/companies","POST",{name:names+"-A",type:"Supplier"});
  assert.equal(r.status,201,JSON.stringify(r.data));const supplierA=r.data.id;suppliers.A.push(supplierA);
  r=await send(b,"/api/companies","POST",{name:names+"-B",type:"Supplier"});
  assert.equal(r.status,201,JSON.stringify(r.data));const supplierB=r.data.id;suppliers.B.push(supplierB);
  ok("Isolated tenant suppliers created");
  r=await send(a,"/api/orders","POST",request(supplierA,[kgLine,tonLine]));
  assert.equal(r.status,201,"create: "+JSON.stringify(r.data));
  const orderA=r.data;created.A.push({id:orderA.id,revision:orderA.revision});
  assert.equal(orderA.totalAmount,3000);
  assert.equal(orderA.items.length,2);
  assert.equal(orderA.items[0].quantityKg,500);
  assert.equal(orderA.items[1].quantityKg,2000);
  assert.equal(orderA.items[1].lineTotal,2000);
  assert.equal(orderA.status,"Draft");
  assert.equal(orderA.paidAmount,null);
  assert.equal(orderA.paymentStatus,null);
  assert.equal(orderA.financialsAvailable,false);
  assert.match(orderA.number,/^PO-2026-\d{4,}$/);
  ok("Two-item draft: 500 KG and 2 TON correctly total $3,000");
  r=await send(a,"/api/orders/"+orderA.id);
  assert.equal(r.status,200);assert.equal(r.data.totalAmount,3000);
  ok("Own tenant can read an order and all line items");
  await expect(await send(b,"/api/orders/"+orderA.id),404,"Tenant B cannot GET tenant A order");
  await expect(await send(b,"/api/orders/"+orderA.id,"PUT",request(supplierB,[kgLine],{revision:1})),404,"Tenant B cannot update tenant A order");
  await expect(await send(b,"/api/orders/"+orderA.id+"?revision=1","DELETE"),404,"Tenant B cannot delete tenant A order");
  const filteredB=await send(b,"/api/orders?search="+encodeURIComponent(orderA.number));
  assert.equal(filteredB.status,200);assert.equal(filteredB.data.total,0);
  ok("Cross-tenant order filtered list returns zero");
  await expect(await send(b,"/api/orders","POST",request(supplierA,[kgLine])),400,"Tenant B cannot use tenant A supplier as FK");
  await expect(await send(a,"/api/orders","POST",request(supplierA,[{...kgLine,quantity:0}])),400,"Zero quantity rejected");
  await expect(await send(a,"/api/orders","POST",request(supplierA,[{...kgLine,unitPrice:-10}])),400,"Negative unit price rejected");
  await expect(await send(a,"/api/orders","POST",request(supplierA,[{...kgLine,quantity:1.0001}])),400,"Excessive KG precision rejected");
  r=await send(a,"/api/orders","POST",request(supplierA,[oneCentLine]));
  assert.equal(r.status,201,JSON.stringify(r.data));
  created.A.push({id:r.data.id,revision:r.data.revision});
  assert.equal(r.data.totalAmount,1.01);
  ok("MidpointRounding.AwayFromZero rounds 1.005 to $1.01");
  await expect(await send(a,"/api/orders/"+orderA.id,"PUT",request(supplierA,[kgLine],{revision:1,orderDate:"2027-01-01"})),409,"Number/year immutable on edit");
  await expect(await send(a,"/api/orders/"+orderA.id,"PUT",request(supplierA,[{...kgLine,id:randomUUID()}],{revision:1})),400,"Foreign/nonexistent line ID cannot be injected");
  const r2=await send(a,"/api/orders","POST",request(supplierA,[kgLine]));
  assert.equal(r2.status,201);
  created.A.push({id:r2.data.id,revision:r2.data.revision});
  await expect(await send(a,"/api/orders/"+orderA.id,"PUT",request(supplierA,[{...kgLine,id:r2.data.items[0].id}],{revision:1})),400,"Another order's line cannot be hijacked");
  r=await send(a,"/api/orders/"+orderA.id,"PUT",request(supplierA,[{...tonLine,id:orderA.items[1].id},kgLine],{revision:1,supplierRef:"PI-UPDATED"}));
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.revision,2);
  assert.equal(r.data.totalAmount,3000);
  assert.equal(r.data.items.length,2);
  assert.equal(r.data.supplierRef,"PI-UPDATED");
  created.A[0].revision=2;
  ok("Updating draft lines, ordering and revision succeeds");
  await expect(await send(a,"/api/orders/"+orderA.id,"PUT",request(supplierA,[kgLine],{revision:1})),409,"Stale revision rejected");
  const ownList=await send(a,"/api/orders?page=1&pageSize=2&currency=USD&supplierId="+supplierA);
  assert.equal(ownList.status,200);
  assert.equal(ownList.data.pageSize,2);
  assert.ok(ownList.data.total>=3);
  ok("Server paging and supplier/currency filters work");
  await expect(await send(a,"/api/orders?pageSize=500"),400,"Unsafe page size denied");
  const parallel=await Promise.all(Array.from({length:6},(_,i)=>send(a,"/api/orders","POST",request(supplierA,[{...kgLine,denier:"QA"+i}]))));
  for(const item of parallel) assert.equal(item.status,201,JSON.stringify(item.data));
  parallel.forEach(item=>created.A.push({id:item.data.id,revision:item.data.revision}));
  const numbers=parallel.map(x=>Number(x.data.number.split("-").at(-1))).sort((x,y)=>x-y);
  assert.equal(new Set(numbers).size,numbers.length);
  for(let i=1;i<numbers.length;i++) assert.equal(numbers[i]-numbers[i-1],1);
  ok("Six concurrent orders receive unique and consecutive tenant-specific numbers");
  r=await send(b,"/api/orders","POST",request(supplierB,[kgLine]));
  assert.equal(r.status,201);created.B.push({id:r.data.id,revision:r.data.revision});
  assert.match(r.data.number,/^PO-2026-\d{4,}$/);
  const tenantBNumbers=(await send(b,"/api/orders")).data.items.map(x=>x.number);
  assert.ok(tenantBNumbers.includes(r.data.number));
  assert.ok(!tenantBNumbers.includes(orderA.number) || orderA.number===r.data.number);
  ok("Tenant B numbering is independently maintained");
  await expect(await send(a,"/api/orders/"+orderA.id+"?revision=1","DELETE"),409,"Stale draft-delete revision rejected");
  r=await send(a,"/api/orders/"+orderA.id+"?revision=2","DELETE");
  assert.equal(r.status,204);created.A=created.A.filter(x=>x.id!==orderA.id);
  await expect(await send(a,"/api/orders/"+orderA.id),404,"Soft-deleted draft is no longer accessible");
} finally {
  // Leave unexpected manual records untouched; only delete IDs captured here.
  for(const [key,session] of [["A",a],["B",b]]) {
    if(!session) continue;
    for(const order of created[key]) {
      try {const r=await send(session,"/api/orders/"+order.id+"?revision="+order.revision,"DELETE");if(r.status!==204) console.error("QA cleanup order failed",order.id,r.status)}catch(e){console.error("QA cleanup request failed",e.message)}
    }
    for(const id of suppliers[key]) {
      try {await send(session,"/api/companies/"+id,"DELETE")}catch(e){console.error("QA cleanup supplier failed",e.message)}
    }
  }
}
console.log("ORDER_API_PASS_COUNT="+passed);
