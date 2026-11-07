// Local-only security acceptance tests for two provisioned tenant accounts.
// Restores the original trial expiry even after assertion failures.
// NEVER point this at a production database.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,unlinkSync} from "node:fs";
import {join} from "node:path";

const local=join(process.cwd(),".local");
const seeds=JSON.parse(readFileSync(join(local,"import-access-accounts.json"),"utf8").replace(/^\uFEFF/,""));
assert.equal(seeds.length,2);
const trialSeed=seeds.find(x=>x.slug==="trial-access");
const permanentSeed=seeds.find(x=>x.slug==="unlimited-access");
assert(trialSeed?.password&&permanentSeed?.password);
const psqlExe="C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const sqlPath=join(local,"access-seed-qa.sql");
const backupPath=join(local,"access-seed-qa-recovery.json");
function sql(statement){
 const guard="DO $qa$ BEGIN "+
   "IF current_database() <> 'wathiqa_import_dev' THEN RAISE EXCEPTION 'Not the isolated QA DB'; END IF; "+
   "IF (SELECT COUNT(*) FROM \"Tenants\" WHERE \"Slug\"='trial-access') <> 1 THEN RAISE EXCEPTION 'Missing trial tenant'; END IF; "+
   "END $qa$;\n";
 writeFileSync(sqlPath,guard+statement,"utf8");
 try{
  const result=spawnSync(psqlExe,["-h","127.0.0.1","-p","55432","-U","wathiqa_import_dev",
    "-d","wathiqa_import_dev","-v","ON_ERROR_STOP=1","-t","-A","-f",sqlPath],{
      encoding:"utf8",env:{...process.env,PGPASSFILE:join(local,"import-pgpass.conf")}
    });
  if(result.status!==0)throw Error("QA SQL failed: "+result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
 }finally{try{unlinkSync(sqlPath)}catch{}}
}
let checks=0;
function pass(label){checks++;console.log("PASS "+label)}
const base="http://127.0.0.1:5089";
const newSession=()=>({cookies:{},csrf:null});
async function request(session,path,method="GET",body){
 const headers={Accept:"application/json"};
 if(session){
  headers.Cookie=Object.entries(session.cookies).map(([k,v])=>k+"="+v).join("; ");
  if(!["GET","HEAD"].includes(method))headers["X-Wathiqa-CSRF"]=session.csrf;
 }
 if(body!==undefined)headers["Content-Type"]="application/json";
 const res=await fetch(base+path,{method,headers,
   body:body===undefined?undefined:JSON.stringify(body),redirect:"manual"});
 if(session)for(const c of res.headers.getSetCookie?.()||[]){
  const match=c.match(/^([^=;]+)=([^;]*)/);
  if(match)session.cookies[match[1]]=match[2];
 }
 let data=null;try{data=await res.json()}catch{}
 return {status:res.status,data};
}
async function login(seed,password=seed.password){
 const session=newSession();
 const csrf=await request(session,"/api/auth/csrf");
 assert.equal(csrf.status,200);
 session.csrf=csrf.data.token;
 const attempt=await request(session,"/api/auth/login","POST",{email:seed.email,password});
 return {session,attempt};
}
function expectStatus(response,status,label){
 assert.equal(response.status,status,label+": "+JSON.stringify(response.data));
 pass(label);return response.data;
}
let original=null,changed=false;
try{
 original=sql("SELECT \"AccessExpiresAtUtc\"::text FROM \"Tenants\" WHERE \"Slug\"='trial-access';").at(-1);
 assert(original&&Date.parse(original)>Date.now(),"Seeded trial must have a future expiry");
 writeFileSync(backupPath,JSON.stringify({slug:"trial-access",originalExpiresAtUtc:original},null,2));
 pass("Trial has a persistent, future, absolute UTC expiration");
 const noExpiry=sql("SELECT COALESCE(\"AccessExpiresAtUtc\"::text,'NEVER') FROM \"Tenants\" WHERE \"Slug\"='unlimited-access';").at(-1);
 assert.equal(noExpiry,"NEVER");
 pass("Unlimited tenant has SQL NULL expiry");
 const trial=await login(trialSeed),unlimited=await login(permanentSeed);
 expectStatus(trial.attempt,200,"Trial Admin logs in before expiration");
 expectStatus(unlimited.attempt,200,"Unlimited Admin logs in");
 const trialMe=expectStatus(await request(trial.session,"/api/auth/me"),200,
   "Trial session can fetch authenticated profile");
 const unlimitedMe=expectStatus(await request(unlimited.session,"/api/auth/me"),200,
   "Unlimited session can fetch authenticated profile");
 assert(trialMe.accessExpiresAtUtc);
 assert.equal(unlimitedMe.accessExpiresAtUtc,null);
 assert.notEqual(trialMe.tenantId,unlimitedMe.tenantId);
 pass("Tenant isolation and trial/unlimited API metadata are correct");
 expectStatus(await request(trial.session,"/api/companies"),200,
   "Trial can access tenant data before expiry");
 expectStatus(await request(unlimited.session,"/api/companies"),200,
   "Unlimited can access its own tenant data");
 const expiredAt=new Date(Date.now()-60*60*1000).toISOString();
 const updated=sql("UPDATE \"Tenants\" SET \"AccessExpiresAtUtc\"='"+expiredAt+"'::timestamptz "+
   "WHERE \"Slug\"='trial-access' AND \"AccessExpiresAtUtc\" IS NOT NULL;");
 assert(updated.some(x=>x==="UPDATE 1"),"Expected exactly one trial row");
 changed=true;
 pass("QA-only: simulate the trial expiration date passing");
 expectStatus(await request(trial.session,"/api/auth/me"),401,
   "Trial already-signed-in session is revoked after expiry");
 expectStatus(await request(trial.session,"/api/companies"),401,
   "Old trial session cannot access tenant APIs");
 const expired=await login(trialSeed);
 assert.equal(expired.attempt.status,403);
 assert.equal(expired.attempt.data?.error,"account_expired");
 pass("Correct password on expired trial returns account_expired");
 expectStatus((await login(trialSeed,"incorrect-password")).attempt,401,
   "Wrong password does not reveal that trial is expired");
 expectStatus(await request(unlimited.session,"/api/auth/me"),200,
   "Unlimited existing session remains valid when trial expires");
 expectStatus((await login(permanentSeed)).attempt,200,
   "Unlimited new login still succeeds while trial is expired");
}finally{
 if(changed&&original){
  const safe=original.replaceAll("'","''");
  const restore=sql("UPDATE \"Tenants\" SET \"AccessExpiresAtUtc\"='"+safe+"'::timestamptz WHERE \"Slug\"='trial-access';");
  assert(restore.some(x=>x==="UPDATE 1"),"Failed to restore trial timestamp");
  const saved=sql("SELECT \"AccessExpiresAtUtc\"::text FROM \"Tenants\" WHERE \"Slug\"='trial-access';").at(-1);
  assert.equal(saved,original,"Expiry must restore with microsecond precision");
  pass("Original trial expiry restored without renewal or shortening");
  unlinkSync(backupPath);
 }else if(original){try{unlinkSync(backupPath)}catch{}}
}
expectStatus((await login(trialSeed)).attempt,200,
  "Trial login works again after exact QA restoration");
console.log("ACCESS_SEED_TEST_PASS_COUNT="+checks);
