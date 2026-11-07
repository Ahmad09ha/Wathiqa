"use client";

import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpLeft,Building2,CalendarClock,ShieldCheck,Users} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {getPlatformOverview,getPlatformTenants,PlatformOverview,PlatformTenant} from "@/lib/platformApi";

const dateText=(v:string|null)=>v?new Date(v).toLocaleDateString("ar-SY-u-nu-latn"):"بلا انتهاء";
function state(tenant:PlatformTenant){
  if(!tenant.isActive)return ["موقوف","paused"];
  if(tenant.accessExpiresAtUtc&&new Date(tenant.accessExpiresAtUtc)<=new Date())return ["منتهي","expired"];
  return ["نشط","active"];
}

function OverviewPage(){
  const {notify}=useToast();const [overview,setOverview]=useState<PlatformOverview|null>(null);
  const [tenants,setTenants]=useState<PlatformTenant[]>([]);const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    try{const [stats,rows]=await Promise.all([getPlatformOverview(),getPlatformTenants(new URLSearchParams({pageSize:"6"}))]);
      setOverview(stats);setTenants(rows.items);
    }catch(error){notify({kind:"error",title:"تعذّر تحميل نظرة المنصة",description:(error as Error).message});}
    finally{setLoading(false);}
  },[notify]);useEffect(()=>{void load();},[load]);
  return <>
    <div className="pc-intro"><div><span className="pc-eyebrow">PLATFORM OPERATIONS</span>
      <h2>كل التجار، إدارة واحدة.</h2>
      <p>تتحكم بوصول كل شركة وتراجع المستخدمين وسجل التغييرات. معلومات الاستيراد الخاصة بالتجار تبقى في مساحاتهم فقط.</p>
    </div><div className="pc-intro-icon"><ShieldCheck size={37}/></div></div>
    <div className="pc-statline">
      {([
        {label:"إجمالي التجار",value:overview?.totalTenants??"—",icon:Building2},
        {label:"شركات نشطة",value:overview?.active??"—",icon:ShieldCheck},
        {label:"اشتراكات وصول منتهية",value:overview?.expired??"—",icon:CalendarClock},
        {label:"حسابات المستخدمين",value:overview?.accounts??"—",icon:Users}
      ]).map(({label,value,icon:Icon})=><div key={label} className="pc-stat">
        <span><Icon size={17}/>{label}</span><strong dir="ltr">{value}</strong></div>)}
    </div>
    <section className="pc-panel"><div className="pc-panel-heading">
      <div><h3>أحدث الشركات</h3><p>حالة الوصول الفعلية للحسابات في المنصة</p></div>
      <Link href="/platform/tenants" className="pc-link">عرض جميع التجار <ArrowUpLeft size={16}/></Link>
    </div>
    <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
      <th>اسم الشركة</th><th>المستخدمون</th><th>انتهاء الوصول</th><th>الحالة</th><th></th>
    </tr></thead><tbody>{tenants.map(x=>{
      const [label,status]=state(x);return <tr key={x.id}>
        <td><strong dir="auto">{x.name}</strong><small dir="ltr">{x.slug}</small></td>
        <td>{x.userCount}</td><td>{dateText(x.accessExpiresAtUtc)}</td>
        <td><span className={"pc-status "+status}>{label}</span></td>
        <td><Link className="pc-table-link" href={"/platform/tenants/"+x.id}>إدارة <ArrowUpLeft size={14}/></Link></td>
      </tr>;
    })}</tbody></table></div>
    {!loading&&tenants.length===0&&<p className="pc-empty">ما في شركات مضافة بعد. أضف أول تاجر من صفحة التجار.</p>}
    {loading&&<p className="pc-empty">جارٍ تحميل بيانات المنصة...</p>}
    </section>
    <div className="pc-note"><ShieldCheck size={18}/>
      <p><strong>سياسة المنصة:</strong> الباقات والاشتراكات تُدار يدوياً حصراً من حساب SuperAdmin، مع حفظ كل تجديد وتغيير. لا تتضمن وثيقة أي نظام دفع أو تحصيل أو فواتير لاشتراكاتها.</p>
    </div>
  </>;
}
export default function Page(){return <PlatformShell title="نظرة عامة" description="ملخص حالة التجار وحسابات المنصة.">
  {()=> <OverviewPage/>}</PlatformShell>;}
