"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpLeft,Check,ClipboardCopy,Plus,Search,ShieldCheck} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {AccessMode,getPlatformTenants,PlatformPage,platformApi,PlatformTenant,TenantCreation} from "@/lib/platformApi";

function TenantDirectory(){
  const {notify}=useToast();
  const [q,setQ]=useState("");const [committed,setCommitted]=useState("");
  const [status,setStatus]=useState("");const [page,setPage]=useState(1);
  const [data,setData]=useState<PlatformPage<PlatformTenant>|null>(null);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [name,setName]=useState("");const [slug,setSlug]=useState("");
  const [email,setEmail]=useState("");const [mode,setMode]=useState<AccessMode>("Expires");
  const [expiry,setExpiry]=useState("");const [reason,setReason]=useState("");
  const [created,setCreated]=useState<TenantCreation|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);
    try{const params=new URLSearchParams({page:String(page),pageSize:"20"});
      if(committed)params.set("q",committed);if(status)params.set("status",status);
      setData(await getPlatformTenants(params));
    }catch(error){notify({kind:"error",title:"تعذّر تحميل التجار",description:(error as Error).message});}
    finally{setLoading(false);}
  },[page,committed,status,notify]);useEffect(()=>{void load();},[load]);
  async function create(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);
    try{
      const row=await platformApi<TenantCreation>("/tenants",{method:"POST",
        body:JSON.stringify({name:name.trim(),slug:slug.trim().toLowerCase(),adminEmail:email.trim(),
          accessMode:mode,accessExpiresAtUtc:mode==="Unlimited"?null:expiry?expiry+"T23:59:59Z":null,
          reason:reason.trim()})});
      setCreated(row);setCreateOpen(false);setName("");setSlug("");setEmail("");setReason("");
      await load();notify({kind:"success",title:"تم إنشاء مساحة التاجر",description:"رمز دعوة المدير يظهر مرة واحدة فقط، احفظه الآن."});
    }catch(error){notify({kind:"error",title:"تعذّر إنشاء التاجر",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  return <>
    <div className="pc-panel pc-search-panel"><form className="pc-directory-toolbar" onSubmit={e=>{
      e.preventDefault();setPage(1);setCommitted(q.trim());}}>
      <label className="pc-search-box"><Search size={17}/><input aria-label="البحث عن شركة" placeholder="ابحث بالاسم أو المعرف..."
        value={q} onChange={e=>setQ(e.target.value)} maxLength={120}/></label>
      <select aria-label="حالة الشركة" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
        <option value="">كل الحالات</option><option value="active">نشطة</option>
        <option value="suspended">موقوفة</option><option value="expired">منتهية</option>
      </select><button type="submit" className="pc-secondary">تطبيق البحث</button>
      <button type="button" className="pc-primary" onClick={()=>{setCreated(null);setCreateOpen(x=>!x);}}>
        <Plus size={17}/> إضافة تاجر</button>
    </form></div>
    {createOpen&&<section className="pc-panel pc-form-panel">
      <div className="pc-panel-heading"><div><h3>إضافة شركة جديدة</h3>
        <p>سيُنشأ Tenant مستقل مع دعوة لمرة واحدة لأول Admin، وليس حساباً بكلمة مرور تُعرض للمنصة.</p></div></div>
      <form onSubmit={e=>void create(e)} className="pc-form-grid">
        <label>اسم الشركة<input required maxLength={180} minLength={2} value={name}
          onChange={e=>setName(e.target.value)} placeholder="مثلاً: شركة التوريدات"/></label>
        <label>المعرّف (Slug)<input required dir="ltr" minLength={3} maxLength={80}
          pattern="[a-z0-9][a-z0-9-]*" value={slug}
          onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="merchant-company"/></label>
        <label>بريد مدير الشركة<input required dir="ltr" type="email" value={email} maxLength={254}
          onChange={e=>setEmail(e.target.value)} placeholder="admin@company.com"/></label>
        <label>نوع حق الوصول<select value={mode} onChange={e=>setMode(e.target.value as AccessMode)}>
          <option value="Expires">محدد بتاريخ انتهاء</option><option value="Unlimited">بلا انتهاء</option>
        </select></label>
        {mode==="Expires"&&<label>صالح حتى (UTC)<input required type="date" value={expiry}
          onChange={e=>setExpiry(e.target.value)}/></label>}
        <label className="pc-field-wide">سبب الإنشاء (للتدقيق)<textarea required minLength={8} maxLength={1000}
          rows={2} value={reason} onChange={e=>setReason(e.target.value)}
          placeholder="مثلاً: تفعيل حساب جديد بناءً على اتفاق مباشر"/></label>
        <div className="pc-form-actions"><button className="pc-primary" disabled={busy} type="submit">
          {busy?"جارٍ إنشاء المساحة...":"إنشاء التاجر ودعوة المدير"}</button>
          <button type="button" className="pc-secondary" onClick={()=>setCreateOpen(false)}>إلغاء</button></div>
      </form>
    </section>}
    {created&&<section className="pc-one-time"><Check size={23}/><div><strong>تم إنشاء {created.name}</strong>
      <p>هذا رمز دعوة Admin، صالح لمدة 48 ساعة ويظهر لمرة واحدة. شاركه مع مدير الشركة عبر قناة آمنة.</p>
      <code dir="ltr">{created.invitationToken}</code>
      <div className="pc-one-time-actions"><button type="button" className="pc-secondary"
        onClick={()=>void navigator.clipboard.writeText(created.invitationToken).then(()=>
          notify({kind:"success",title:"تم نسخ رمز الدعوة"})).catch(()=>
          notify({kind:"error",title:"تعذر النسخ"}))}>
        <ClipboardCopy size={15}/> نسخ رمز الدعوة</button>
        <Link className="pc-link" href="/import/join">صفحة قبول الدعوة <ArrowUpLeft size={14}/></Link>
      </div></div></section>}
    <section className="pc-panel"><div className="pc-panel-heading"><div>
      <h3>دليل الشركات</h3><p>تاريخ الوصول وحالة التعليق منفصلان عن فواتير اشتراكات المنصة.</p></div>
      <span className="pc-muted">{data?.total??"—"} شركة</span></div>
      <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
        <th>الشركة</th><th>المستخدمون</th><th>حق الوصول</th><th>الحالة</th><th></th>
      </tr></thead><tbody>{data?.items.map(t=>{
        const expired=t.accessExpiresAtUtc&&new Date(t.accessExpiresAtUtc).getTime()<=Date.now();
        const statusText=!t.isActive?"موقوف":expired?"منتهي":"نشط";
        return <tr key={t.id}><td><strong dir="auto">{t.name}</strong><small dir="ltr">{t.slug}</small></td>
          <td>{t.userCount}</td><td>{t.accessExpiresAtUtc?
            new Date(t.accessExpiresAtUtc).toLocaleDateString("ar-SY-u-nu-latn"):"دائم"}</td>
          <td><span className={"pc-status "+(!t.isActive?"paused":expired?"expired":"active")}>{statusText}</span></td>
          <td><Link className="pc-table-link" href={"/platform/tenants/"+t.id}>إدارة <ArrowUpLeft size={14}/></Link></td>
        </tr>;
      })}</tbody></table></div>
      {loading&&<p className="pc-empty">جارٍ البحث...</p>}
      {!loading&&data?.items.length===0&&<p className="pc-empty">لا توجد شركات تطابق الفلاتر.</p>}
      <div className="pc-pager"><span>الصفحة {page} · إجمالي {data?.total??0}</span>
        <div><button disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}>السابق</button>
          <button disabled={!data||page*20>=data.total||loading} onClick={()=>setPage(x=>x+1)}>التالي</button></div>
      </div>
    </section><div className="pc-note"><ShieldCheck size={18}/>
      <p>إدارة التاجر لا تمنح SuperAdmin حق قراءة طلباته أو مستنداته أو حوالاته الخاصة.</p></div>
  </>;
}
export default function Page(){return <PlatformShell title="التجار والشركات" description="إنشاء مساحات التجار ومتابعة حالة الوصول.">
  {()=> <TenantDirectory/>}</PlatformShell>;}
