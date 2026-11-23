"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {ArrowUpLeft,ShieldAlert,ShieldCheck,Users} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import ManualSubscriptionControls from "@/components/ManualSubscriptionControls";
import {useToast} from "@/components/ToastProvider";
import {getPlatformAudits,getPlatformTenant,getPlatformTenantUsers,
  PlatformPage,platformApi,PlatformAudit,PlatformTenant,PlatformUser} from "@/lib/platformApi";

function TenantManagement({id}:{id:string}){
  const {notify}=useToast();
  const [tenant,setTenant]=useState<PlatformTenant|null>(null);
  const [people,setPeople]=useState<PlatformPage<PlatformUser>|null>(null);
  const [audit,setAudit]=useState<PlatformAudit[]>([]);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [statusReason,setStatusReason]=useState("");
  const [target,setTarget]=useState<PlatformUser|null>(null);
  const [userReason,setUserReason]=useState("");
  const load=useCallback(async()=>{
    try{const [t,users,audits]=await Promise.all([
      getPlatformTenant(id),getPlatformTenantUsers(id),getPlatformAudits(id)]);
      setTenant(t);setPeople(users);setAudit(audits.items);
    }catch(error){notify({kind:"error",title:"تعذّر تحميل تفاصيل الشركة",description:(error as Error).message});}
    finally{setLoading(false);}
  },[id,notify]);useEffect(()=>{void load();},[load]);
  async function changeActive(event:FormEvent){
    event.preventDefault();if(!tenant||busy)return;setBusy(true);
    try{await platformApi("/tenants/"+id+"/active",{method:"POST",body:JSON.stringify({
      isActive:!tenant.isActive,revision:tenant.platformRevision,reason:statusReason.trim()})});
      setStatusReason("");await load();notify({kind:"success",title:"تم تغيير حالة الشركة",
        description:"تحقق الوصول إلى حسابات التاجر يحصل على كل طلب محمي."});}
    catch(error){notify({kind:"error",title:"تعذّر تغيير حالة التاجر",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  async function changeUser(event:FormEvent){
    event.preventDefault();if(!target||busy)return;setBusy(true);
    try{await platformApi("/tenants/"+id+"/users/"+target.id+"/active",{method:"POST",
      body:JSON.stringify({isActive:!target.isActive,reason:userReason.trim()})});
      setTarget(null);setUserReason("");await load();
      notify({kind:"success",title:"تم تحديث المستخدم",description:"تم تسجيل التعديل مع السبب وهوية SuperAdmin."});}
    catch(error){notify({kind:"error",title:"تعذّر تعديل المستخدم",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  if(loading&&!tenant)return <div className="pc-panel pc-empty">جارٍ تحميل تفاصيل التاجر...</div>;
  if(!tenant)return <div className="pc-panel pc-empty">الشركة غير متاحة.</div>;
  const expired=tenant.accessExpiresAtUtc&&new Date(tenant.accessExpiresAtUtc)<=new Date();
  const active=tenant.isActive&&!expired;
  return <>
    <div className="pc-details-head"><div><Link className="pc-back" href="/platform/tenants"><ArrowUpLeft size={15}/> الرجوع إلى التجار</Link>
      <h2 dir="auto">{tenant.name}</h2><p dir="ltr">{tenant.slug}</p></div>
      <span className={"pc-status "+(!tenant.isActive?"paused":expired?"expired":"active")}>
        {!tenant.isActive?"موقوف":expired?"منتهي":"نشط"}</span>
    </div>
    <div className="pc-detail-grid">
      <section className="pc-panel pc-form-panel"><div className="pc-panel-heading"><div>
        <h3><ShieldCheck size={19}/> حالة الحساب</h3>
        <p>توقيف التاجر يوقف وصول جميع أعضاء الشركة فوراً، بدون محو بياناتهم.</p>
      </div></div><form className="pc-stack" onSubmit={e=>void changeActive(e)}>
        <div className="pc-current-value">الحالة الحالية <strong>{tenant.isActive?"مفعّل":"موقوف"}</strong></div>
        <label>سبب {tenant.isActive?"الإيقاف":"إعادة التفعيل"}
          <textarea required minLength={8} maxLength={1000} rows={2} value={statusReason}
            onChange={e=>setStatusReason(e.target.value)}
            placeholder="سبب موثّق يظل ضمن سجل عمليات المنصة"/></label>
        <button className={"pc-action-button "+(tenant.isActive?"danger":"restore")} type="submit" disabled={busy}>
          {tenant.isActive?<><ShieldAlert size={17}/> إيقاف الشركة</>:<><ShieldCheck size={17}/> إعادة تفعيل الشركة</>}
        </button>
      </form></section>
      <ManualSubscriptionControls tenantId={id} onChanged={load}/>
    </div>
    <section className="pc-panel"><div className="pc-panel-heading"><div>
      <h3><Users size={19}/> مستخدمو الشركة</h3>
      <p>بإمكان SuperAdmin إيقاف أو إعادة تفعيل حساب فردي، لكن لا يمكن تعطيل آخر مدير نشط للشركة.</p>
    </div><span className="pc-muted">{people?.total??0} مستخدم</span></div>
      <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
        <th>المستخدم</th><th>الصفة</th><th>صلاحية مالية</th><th>الحالة</th><th>إجراء</th>
      </tr></thead><tbody>{people?.items.map(u=><tr key={u.id}>
        <td><strong dir="auto">{u.displayName}</strong><small dir="ltr">{u.email}</small></td>
        <td>{u.role==="Admin"?"مدير التاجر":"موظف"}</td>
        <td>{u.role==="Admin"||u.canManagePayments?"تعديل":"قراءة فقط"}</td>
        <td><span className={"pc-status "+(u.isActive?"active":"paused")}>
          {u.isActive?"نشط":"معطّل"}</span></td>
        <td><button type="button" className="pc-text-action" disabled={busy}
          onClick={()=>{setTarget(u);setUserReason("");}}>
          {u.isActive?"تعطيل":"تفعيل"}</button></td>
      </tr>)}</tbody></table></div>
      {!people?.items.length&&<p className="pc-empty">لا يوجد مستخدمون مفعّلون لهذه الشركة بعد.</p>}
      {target&&<form className="pc-inline-confirm" onSubmit={e=>void changeUser(e)}>
        <strong>{target.isActive?"تعطيل":"تفعيل"} حساب {target.displayName}</strong>
        <label>السبب <input required minLength={8} maxLength={1000} value={userReason}
          onChange={e=>setUserReason(e.target.value)} placeholder="سبب القرار (8 أحرف على الأقل)"/></label>
        <button className="pc-primary" type="submit" disabled={busy}>تأكيد العملية</button>
        <button className="pc-secondary" type="button" onClick={()=>setTarget(null)}>إلغاء</button>
      </form>}
    </section>
    <section className="pc-panel"><div className="pc-panel-heading"><div>
      <h3>سجل التغييرات</h3><p>تعديلات SuperAdmin محفوظة بتاريخها وسببها، ولا يتم حذف السجل عند إيقاف الحساب.</p>
    </div></div><div className="pc-table-wrap"><table className="pc-table"><thead><tr>
      <th>الحدث</th><th>التاريخ</th><th>السبب</th>
    </tr></thead><tbody>{audit.map(a=><tr key={a.id}>
      <td dir="ltr">{a.action}</td><td>{new Date(a.occurredAtUtc).toLocaleString("ar-SY-u-nu-latn")}</td>
      <td>{a.reason}</td></tr>)}</tbody></table></div>
      {!audit.length&&<p className="pc-empty">لا توجد عمليات مدققة حالياً.</p>}
    </section>
    <div className="pc-note"><ShieldCheck size={18}/><p>حالة {active?"الشركة نشطة":"الشركة لا تمنح وصولاً حالياً"}.
      صلاحية SuperAdmin لا تعطي حق فتح ملفات التاجر الخاصة أو السجلات البنكية.</p></div>
  </>;
}
export default function Page(){const {id}=useParams<{id:string}>();
  return <PlatformShell title="إدارة التاجر" description="حالة الحساب والمستخدمون وصلاحية الوصول وسجل التغييرات.">
    {()=> <TenantManagement id={id}/>}</PlatformShell>;
}
