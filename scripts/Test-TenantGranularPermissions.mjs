// Tenant Staff visibility QA on a disposable platform-created tenant.
// Revoke permissions while the Staff session is still authenticated.
// Cleanup with scripts/Cleanup-PlatformSuperAdminQa.ps1 -FixturePath <path> -Apply.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const platform=JSON.parse(readFileSync(join(local,"platform-superadmin-account.json"),"utf8").replace(/^\uFEFF/,""));
const demos=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="PA_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const slug="pa-qa-"+run.slice(6);
const adminEmail="permissions-admin-"+run.toLowerCase()+"@wathiqa.invalid";
const staffEmail="permissions-staff-"+run.toLowerCase()+"@wathiqa.invalid";
const adminPassword="QA!Admin9Aa"+randomUUID().replaceAll("-").slice(0,15);
const staffPassword="QA!Staff9Aa"+randomUUID().replaceAll("-").slice(0,15);
const fixture={run,tenantId:null,adminUserId:null,planIds:[]};
const fixturePath=join(local,"platform-qa-fixture-"+run+".json");
const save=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2),"utf8");
const root="http://127.0.0.1:5089";
let count=0;
const pass=x=>{count++;console.log("PASS "+x)};
const guid=randomUUID();
function session(){
  const cookies={};let csrf="";
  async function request(path,method="GET",body){
    const headers={Accept:"application/json",
      Cookie:Object.entries(cookies).map(([key,value])=>key+"="+value).join("; ")};
    if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
    if(body!==undefined)headers["Content-Type"]="application/json";
    const response=await fetch(root+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      redirect:"manual",signal:AbortSignal.timeout(20000)});
    for(const cookie of response.headers.getSetCookie?.()||[]){
      const m=cookie.match(/^([^=;]+)=([^;]*)/);
      if(m)cookies[m[1]]=m[2];
    }
    let data;try{data=await response.json()}catch{data=null}
    return {status:response.status,data};
  }
  async function login(path,email,password){
    csrf=(await request("/api/auth/csrf")).data.token;
    const r=await request(path,"POST",{email,password});
    assert.equal(r.status,200,JSON.stringify(r.data));
    csrf=(await request("/api/auth/csrf")).data.token;
  }
  async function init(){csrf=(await request("/api/auth/csrf")).data.token}
  return {request,login,init};
}
function expect(r,status,label){
  assert.equal(r.status,status,label+" "+JSON.stringify(r.data));
  pass(label);return r.data;
}
try {
  save();
  const owner=session();await owner.login("/api/platform/auth/login",platform.email,platform.password);
  const created=expect(await owner.request("/api/platform/tenants","POST",{
    name:run+" merchant",slug,adminEmail,adminPassword,accessMode:"Unlimited",
    accessExpiresAtUtc:null,reason:"Granular visibility per tenant local QA"
  }),201,"Disposable merchant created");
  fixture.tenantId=created.id;fixture.adminUserId=created.adminUserId;save();

  const admin=session();await admin.login("/api/auth/login",adminEmail,adminPassword);
  const invite=expect(await admin.request("/api/users/invitations","POST",{
    email:staffEmail
  }),200,"Merchant Admin invites one Staff member");
  const guest=session();await guest.init();
  const accepted=expect(await guest.request("/api/auth/invitations/accept","POST",{
    token:invite.token,displayName:"Permissions QA Staff",password:staffPassword
  }),201,"Invited Staff account accepted");
  const staffId=accepted.id;
  const staff=session();await staff.login("/api/auth/login",staffEmail,staffPassword);
  const me=expect(await staff.request("/api/auth/me"),200,"Staff can inspect its permissions");
  assert.equal(me.role,"Staff");
  assert.equal(me.permissions.length,12,"Legacy/new Staff starts with prior accessible features");
  expect(await staff.request("/api/dashboard/overview?days=30"),200,
    "Legacy Staff dashboard access preserved");

  expect(await admin.request("/api/users/"+created.adminUserId+"/visibility","PUT",{
    permissions:[]
  }),400,"Merchant Admin cannot remove own implicit permissions");
  expect(await admin.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:["nav.orders","nav.orders"]
  }),400,"Duplicate rights are rejected");
  expect(await admin.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:["nav.orders","platform.superadmin"]
  }),400,"Unknown rights are rejected");

  expect(await admin.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:["nav.orders","tab.info"]
  }),200,"Admin saves restricted Staff allow-list");
  const listed=expect(await admin.request("/api/users"),200,"Admin sees updated team rights");
  assert.deepEqual(listed.find(x=>x.id===staffId).permissions.sort(),
    ["nav.orders","tab.info"]);
  const current=expect(await staff.request("/api/auth/me"),200,
    "Existing Staff session immediately receives the new rights");
  assert.deepEqual(current.permissions.sort(),["nav.orders","tab.info"]);
  expect(await staff.request("/api/dashboard/overview"),403,
    "Revoked dashboard returns 403 without logging Staff out");
  expect(await staff.request("/api/orders"),200,
    "Allowed orders list remains available");
  expect(await staff.request("/api/orders/"+guid),404,
    "Allowed information tab reaches tenant-scoped entity lookup");
  expect(await staff.request("/api/orders/"+guid+"/finances"),403,
    "Hidden payments tab is forbidden at API");
  expect(await staff.request("/api/orders/"+guid+"/shipments"),403,
    "Hidden B/L and customs tabs are forbidden at API");
  expect(await staff.request("/api/shipments/"+guid+"/tracking"),403,
    "Hidden tracking tab is forbidden at API");
  expect(await staff.request("/api/operations/containers"),403,
    "Revoked operations sidebar entry is forbidden at API");
  expect(await staff.request("/api/companies"),403,
    "Revoked company directory is forbidden at API");
  const options=expect(await staff.request("/api/companies/options"),200,
    "Allowed order editor can read minimal company selector options");
  assert(Array.isArray(options));
  assert(options.every(x=>Object.keys(x).sort().join(",")==="id,name,type"));
  expect(await staff.request("/api/documents"),403,
    "Disabled document viewing is forbidden at API");
  expect(await staff.request("/api/companies/quick","POST",{type:"Broker",name:"Invalid Broker"}),400,
    "Order quick-add cannot create unrestricted company types");
  expect(await staff.request("/api/companies/quick","POST",{type:"Supplier",name:" "}),400,
    "Quick-add validation executes for permitted order-info Staff");
  expect(await staff.request("/api/users"),403,
    "Staff cannot manage other employees");

  const demoB=demos.find(x=>x.slug==="demo-b");
  assert(demoB,"Need demo-b Admin credentials");
  const other=session();await other.login("/api/auth/login",demoB.email,demoB.password);
  expect(await other.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:["nav.dashboard"]
  }),404,"Foreign tenant Admin cannot modify Staff by UUID");

  expect(await admin.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:["nav.orders","tab.payments","documents.view"]
  }),200,"Admin can grant only financial-view and documents");
  expect(await staff.request("/api/orders/"+guid+"/finances"),404,
    "Financial read now passes the permission gate");
  expect(await staff.request("/api/document-requirements"),200,
    "Document view can be granted independently");
  expect(await staff.request("/api/orders/"+guid+"/shipments"),404,
    "Document viewer can reach shipment selector without B/L permission");
  expect(await staff.request("/api/orders","POST",{}),403,
    "Order create is forbidden when info tab is hidden");
  expect(await staff.request("/api/orders/"+guid+"/payment-schedules","POST",{}),403,
    "Payment mutation still requires CanManagePayments beyond visibility");

  expect(await admin.request("/api/users/"+staffId+"/payment-permission","PUT",{
    canManagePayments:true
  }),200,"Admin grants existing financial-write right");
  expect(await admin.request("/api/users/"+staffId+"/visibility","PUT",{
    permissions:[]
  }),200,"Admin revokes all Staff feature permissions");
  expect(await staff.request("/api/orders"),403,
    "Immediate revocation blocks former orders access");
  expect(await staff.request("/api/orders/"+guid+"/finances"),403,
    "Financial write flag cannot bypass revoked visibility");
  expect(await staff.request("/api/auth/me"),200,
    "Staff can still sign in to request access from tenant Admin");
  const audits=expect(await admin.request("/api/dashboard/activity?category=security&days=0"),200,
    "Admin can see tenant-scoped security audit history");
  assert(audits.items.some(x=>x.action==="StaffVisibility"),
    "Visibility change should create an auditable security event");

  console.log("TENANT_PERMISSIONS_PASS_COUNT="+count);
}catch(error){
  console.error("TENANT_PERMISSIONS_FAILED="+(error.stack||error));
  process.exitCode=1;
}finally{
  console.log("TENANT_PERMISSIONS_QA_FIXTURE="+fixturePath);
}
process.exit(process.exitCode||0);
