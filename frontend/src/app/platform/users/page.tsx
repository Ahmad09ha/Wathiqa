"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpLeft,Search,ShieldCheck,Users} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {getPlatformUsers,PlatformPage,PlatformUserDirectoryEntry} from "@/lib/platformApi";

function Directory(){
  const {notify}=useToast();const [query,setQuery]=useState("");const [applied,setApplied]=useState("");
  const [page,setPage]=useState(1);const [data,setData]=useState<PlatformPage<PlatformUserDirectoryEntry>|null>(null);
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try{const q=new URLSearchParams({page:String(page),pageSize:"20"});
      if(applied)q.set("q",applied);setData(await getPlatformUsers(q));}
    catch(error){notify({kind:"error",title:"تعذّر تحميل دليل المستخدمين",description:(error as Error).message});}
    finally{setLoading(false);}
  },[page,applied,notify]);useEffect(()=>{void load();},[load]);
  function search(event:FormEvent){event.preventDefault();setPage(1);setApplied(query.trim());}
  return <><section className="pc-panel pc-search-panel"><form onSubmit={search} className="pc-directory-toolbar">
    <label className="pc-search-box"><Search size={17}/><input value={query} maxLength={120}
      onChange={e=>setQuery(e.target.value)} placeholder="ابحث باسم المستخدم أو بريده"/></label>
    <button className="pc-secondary" type="submit">بحث</button><span className="pc-muted">{data?.total??"—"} مستخدم</span>
  </form></section>
    <section className="pc-panel"><div className="pc-panel-heading"><div><h3><Users size={19}/> دليل المستخدمين</h3>
      <p>كل مستخدم مربوط بـTenant محدد، والانتقال لإدارته يمر عبر صفحة التاجر.</p></div></div>
      <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
        <th>المستخدم</th><th>الشركة</th><th>الدور</th><th>الحالة</th><th></th>
      </tr></thead><tbody>{data?.items.map(u=><tr key={u.id}>
        <td><strong>{u.displayName}</strong><small dir="ltr">{u.email}</small></td>
        <td dir="auto">{u.tenantName}</td><td>{u.role}</td>
        <td><span className={"pc-status "+(u.isActive?"active":"paused")}>{u.isActive?"نشط":"معطّل"}</span></td>
        <td><Link className="pc-table-link" href={"/platform/tenants/"+u.tenantId}>
          عرض التاجر <ArrowUpLeft size={14}/></Link></td>
      </tr>)}</tbody></table></div>
      {loading&&<p className="pc-empty">جارٍ تحميل المستخدمين...</p>}
      {!loading&&data?.items.length===0&&<p className="pc-empty">لا يوجد مستخدمون مطابقون للبحث.</p>}
      <div className="pc-pager"><span>الصفحة {page}</span><div>
        <button disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}>السابق</button>
        <button disabled={!data||page*20>=data.total||loading} onClick={()=>setPage(x=>x+1)}>التالي</button>
      </div></div></section>
    <div className="pc-note"><ShieldCheck size={18}/><p>تظهر بيانات الحسابات الإدارية الأساسية فقط؛ لا يُعرض محتوى الطلبات أو الملفات الشخصية المخزنة داخل مساحة التاجر.</p></div>
  </>;
}
export default function Page(){return <PlatformShell title="المستخدمون" description="دليل حسابات التجار وصلاحيات الوصول الأساسية.">
  {()=> <Directory/>}</PlatformShell>;}
