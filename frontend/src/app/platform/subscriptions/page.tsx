"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpLeft,CalendarClock,Search} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {getManualSubscriptions,ManualSubscriptionDirectoryItem,PlatformPage} from "@/lib/platformApi";

function state(row:ManualSubscriptionDirectoryItem){
  if(!row.hasSubscription)return {label:"صلاحية موروثة",cls:"expired"};
  if(row.endedAtUtc)return {label:"منتهي يدوياً",cls:"paused"};
  if(!row.isActive)return {label:"الشركة موقوفة",cls:"paused"};
  if(row.accessExpiresAtUtc&&new Date(row.accessExpiresAtUtc)<=new Date())
    return {label:"انتهت المدة",cls:"expired"};
  return {label:"ساري",cls:"active"};
}
function Directory(){
  const {notify}=useToast();
  const [query,setQuery]=useState("");const [applied,setApplied]=useState("");
  const [page,setPage]=useState(1);
  const [data,setData]=useState<PlatformPage<ManualSubscriptionDirectoryItem>|null>(null);
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try{const qs=new URLSearchParams({page:String(page),pageSize:"20"});
      if(applied)qs.set("q",applied);setData(await getManualSubscriptions(qs));}
    catch(error){notify({kind:"error",title:"تعذّر تحميل الاشتراكات اليدوية",description:(error as Error).message});}
    finally{setLoading(false);}
  },[page,applied,notify]);useEffect(()=>{void load();},[load]);
  function search(e:FormEvent){e.preventDefault();setPage(1);setApplied(query.trim());}
  return <>
    <section className="pc-panel pc-search-panel"><form className="pc-directory-toolbar" onSubmit={search}>
      <label className="pc-search-box"><Search size={17}/><input aria-label="البحث عن اشتراك تاجر"
        placeholder="ابحث باسم الشركة أو معرّفها..." maxLength={120} value={query}
        onChange={e=>setQuery(e.target.value)}/></label>
      <button type="submit" className="pc-secondary">بحث</button>
      <Link href="/platform/plans" className="pc-secondary">إدارة الباقات <ArrowUpLeft size={15}/></Link>
    </form></section>
    <section className="pc-panel"><div className="pc-panel-heading"><div>
      <h3><CalendarClock size={19}/> اشتراكات التجار</h3>
      <p>كل ربط أو تجديد أو إنهاء يتم يدوياً من صفحة التاجر مع سبب وسجل تغييرات.</p>
    </div><span className="pc-muted">{data?.total??"—"} تاجر</span></div>
    <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
      <th>الشركة</th><th>الباقة المربوطة</th><th>صلاحية الوصول</th><th>الحالة</th><th></th>
    </tr></thead><tbody>{data?.items.map(item=>{
      const status=state(item);return <tr key={item.tenantId}>
        <td><strong dir="auto">{item.tenantName}</strong><small dir="ltr">{item.tenantSlug}</small></td>
        <td>{item.planName??"لم تربط بباقة بعد"}
          {item.planCode&&<small dir="ltr">{item.planCode}</small>}</td>
        <td>{item.accessExpiresAtUtc?new Date(item.accessExpiresAtUtc).toLocaleDateString("ar-SY-u-nu-latn"):"بلا انتهاء"}</td>
        <td><span className={"pc-status "+status.cls}>{status.label}</span></td>
        <td><Link className="pc-table-link" href={"/platform/tenants/"+item.tenantId}>
          إدارة الاشتراك <ArrowUpLeft size={14}/></Link></td>
      </tr>;
    })}</tbody></table></div>
    {loading&&<p className="pc-empty">جارٍ تحميل البيانات...</p>}
    {!loading&&data?.items.length===0&&<p className="pc-empty">ما في شركات مطابقة للبحث.</p>}
    <div className="pc-pager"><span>الصفحة {page} · الإجمالي {data?.total??0}</span><div>
      <button disabled={page<=1||loading} onClick={()=>setPage(n=>n-1)}>السابق</button>
      <button disabled={!data||page*20>=data.total||loading} onClick={()=>setPage(n=>n+1)}>التالي</button>
    </div></div></section>
    <div className="pc-note"><CalendarClock size={18}/><p>
      الاشتراكات هنا **تحدد صلاحية استعمال وثيقة فقط**. لا يوجد دفع، ولا إثبات دفع يدوي، ولا فواتير أو أسعار. تنتهي المدة تلقائياً بحسب التاريخ، لكن التجديد يحتاج إجراءً يدوياً منك.
    </p></div>
  </>;
}
export default function Page(){return <PlatformShell title="الاشتراكات اليدوية" description="إدارة مدة وصول كل تاجر بدون أي نظام دفع.">
  {()=> <Directory/>}</PlatformShell>;}
