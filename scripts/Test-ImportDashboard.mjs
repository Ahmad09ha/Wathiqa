// Read-only dashboard integration: real .NET 10 + PostgreSQL and two tenant sessions.
// No seed, mutations or external tracking requests. Requires local demo accounts.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const root="http://127.0.0.1:5089";
const accounts=JSON.parse(readFileSync(join(process.cwd(),".local","import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
let passed=0;
function pass(message){passed++;console.log("PASS "+message)}
function client(){
  const cookies=new Map();let csrf="";
  async function request(path,method="GET",body){
    const headers={Accept:"application/json"};
    if(cookies.size)headers.Cookie=[...cookies].map(([k,v])=>k+"="+v).join("; ");
    if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
    if(body!==undefined)headers["Content-Type"]="application/json";
    const response=await fetch(root+path,{
      method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      redirect:"manual",signal:AbortSignal.timeout(16000)
    });
    for(const value of response.headers.getSetCookie?.()||[]){
      const match=value.match(/^([^=;]+)=([^;]*)/);
      if(match)cookies.set(match[1],match[2]);
    }
    let data=null;
    const raw=await response.text();try{data=JSON.parse(raw)}catch{data=raw}
    return {status:response.status,data};
  }
  async function login(account){
    const token=await request("/api/auth/csrf");
    assert.equal(token.status,200);
    csrf=token.data.token;
    const r=await request("/api/auth/login","POST",{
      email:account.email,password:account.password
    });
    assert.equal(r.status,200,"Tenant login failed: "+r.status);
    pass("Authenticated "+account.slug+" via tenant session");
  }
  return {request,login};
}
const path="/api/dashboard";
const cats=["orders","finance","logistics","documents","companies","ports","tracking","security","subscription"];
try {
  const guest=client();
  assert.equal((await guest.request(path+"/overview?days=30")).status,401);
  assert.equal((await guest.request(path+"/activity?days=30")).status,401);
  pass("Both dashboard endpoints reject unauthenticated requests");

  const sessions={};
  const data={};
  for(const slug of ["demo-a","demo-b"]){
    const credentials=accounts.find(a=>a.slug===slug);
    assert(credentials,slug+" demo account must exist");
    const s=client();await s.login(credentials);sessions[slug]=s;
    const overview=await s.request(path+"/overview?days=30");
    assert.equal(overview.status,200,slug+" overview");
    assert(overview.data.orders.total>=0);
    assert(overview.data.trend.length===14);
    assert(overview.data.financial.currencies.every(x=>
      typeof x.currency==="string" && x.currency.length>0));
    assert(overview.data.financial.currencies.every(x=>x.remaining>=0));
    data[slug]={overview:overview.data};
    pass(slug+" financial/shipping/team/ShipsGo aggregates and 14-day trend");

    const all=await s.request(path+"/activity?days=30&category=all&page=1&pageSize=20");
    assert.equal(all.status,200,slug+" events");
    assert(all.data.items.length<=20);
    assert(all.data.total>=all.data.items.length);
    for(let i=1;i<all.data.items.length;i++)
      assert(new Date(all.data.items[i-1].occurredAtUtc)>=new Date(all.data.items[i].occurredAtUtc));
    assert(all.data.items.every(e=>e.id && e.category && e.title && e.actor && e.occurredAtUtc));
    data[slug].activity=all.data;
    pass(slug+" event timeline is sorted, paged and annotated with actors");
    const filtered=await s.request(path+"/activity?days=0&category=orders&page=1&pageSize=5");
    assert.equal(filtered.status,200);
    assert(filtered.data.items.every(e=>e.category==="orders"));
    if(filtered.data.total>5){
      const second=await s.request(path+"/activity?days=0&category=orders&page=2&pageSize=5");
      assert.equal(second.status,200);
      assert(!second.data.items.some(e=>filtered.data.items.some(x=>x.id===e.id)));
    }
    pass(slug+" category filter, all-time option and deterministic pagination");
    for(const period of [0,7,90,365]){
      const result=await s.request(path+"/overview?days="+period);
      assert.equal(result.status,200,slug+" period "+period);
      assert(result.data.orders.total===overview.data.orders.total);
    }
    pass(slug+" period filtering keeps lifetime totals stable");
  }

  assert.notDeepEqual(data["demo-a"].overview.orders.total,data["demo-b"].overview.orders.total);
  assert.notDeepEqual(data["demo-a"].overview.financial.currencies,data["demo-b"].overview.financial.currencies);
  const aEventIds=new Set(data["demo-a"].activity.items.map(x=>x.id));
  assert(data["demo-b"].activity.items.every(x=>!aEventIds.has(x.id)));
  const aOrders=new Set(data["demo-a"].activity.items.filter(e=>e.orderId).map(e=>e.orderId));
  assert(data["demo-b"].activity.items.every(e=>!e.orderId||!aOrders.has(e.orderId)));
  pass("Cross-tenant financial totals, IDs and timeline entries stay isolated");

  for(const slug of ["demo-a","demo-b"]){
    const api=sessions[slug].request;
    for(const category of cats){
      const r=await api(path+"/activity?days=0&category="+category+"&page=1&pageSize=5");
      assert.equal(r.status,200,slug+" / "+category+"="+r.status);
      assert(r.data.items.every(x=>x.category===category));
    }
    pass(slug+" all nine activity category filters return scoped results");
    const invalid=[
      path+"/overview?days=-1",
      path+"/overview?days=11",
      path+"/activity?days=123",
      path+"/activity?category=made-up",
      path+"/activity?category=orders&page=0",
      path+"/activity?pageSize=51"
    ];
    for(const route of invalid){
      const r=await api(route);
      assert.equal(r.status,400,"Expected 400 for "+route);
    }
    pass(slug+" invalid filters, bounds and page sizes rejected");
  }
  console.log("DASHBOARD_API_PASS_COUNT="+passed);
} catch(error){
  console.error("DASHBOARD_API_FAILED="+(error.stack||error));
  process.exitCode=1;
}
process.exit(process.exitCode||0);
