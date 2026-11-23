"use client";

import {useCallback,useEffect,useState} from "react";
import {ScrollText,ShieldCheck} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {getPlatformAudits,PlatformPage,PlatformAudit} from "@/lib/platformApi";

const actions:Record<string,string>={
  TenantCreated:"إنشاء شركة",TenantActiveChanged:"حالة شركة",
  TenantAccessChanged:"صلاحية وصول",TenantUserActiveChanged:"تفعيل مستخدم",
  SuperAdminLockout:"قفل حساب إدارة المنصة",
  ManualPlanCreated:"إنشاء باقة",ManualPlanActiveChanged:"حالة باقة",
  ManualSubscriptionAssigned:"تعيين اشتراك يدوي",
  ManualSubscriptionRenewed:"تجديد اشتراك يدوي",
  ManualSubscriptionEnded:"إنهاء اشتراك يدوي"
};
function AuditDirectory(){
  const {notify}=useToast();const [page,setPage]=useState(1);
  const [data,setData]=useState<PlatformPage<PlatformAudit>|null>(null);const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try{setData(await getPlatformAudits(undefined,page));}
    catch(error){notify({kind:"error",title:"تعذّر تحميل سجل الإدارة",description:(error as Error).message});}
    finally{setLoading(false);}
  },[page,notify]);useEffect(()=>{void load();},[load]);
  return <><section className="pc-panel"><div className="pc-panel-heading"><div>
    <h3><ScrollText size={19}/> سجل إدارة المنصة</h3>
    <p>كل إجراء حساس يحتفظ بالسبب وهوية منفّذه والوقت والتغييرات قبل وبعد.</p>
  </div><span className="pc-muted">{data?.total??"—"} عملية</span></div>
    <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
      <th>الإجراء</th><th>الشركة</th><th>المنفّذ</th><th>الوقت</th><th>السبب</th>
    </tr></thead><tbody>{data?.items.map(a=><tr key={a.id}>
      <td><strong>{actions[a.action]||a.action}</strong><small dir="ltr">{a.action}</small></td>
      <td><small dir="ltr">{a.tenantId?.slice(0,8)||"المنصة"}</small></td>
      <td><small dir="ltr">{a.operatorId.slice(0,8)}</small></td>
      <td>{new Date(a.occurredAtUtc).toLocaleString("ar-SY-u-nu-latn")}</td>
      <td>{a.reason}</td>
    </tr>)}</tbody></table></div>
    {loading&&<p className="pc-empty">جارٍ تحميل سجل العمليات...</p>}
    {!loading&&data?.items.length===0&&<p className="pc-empty">لا توجد عمليات مسجلة حتى الآن.</p>}
    <div className="pc-pager"><span>الصفحة {page}</span><div>
      <button disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}>السابق</button>
      <button disabled={!data||page*25>=data.total||loading} onClick={()=>setPage(x=>x+1)}>التالي</button>
    </div></div>
  </section><div className="pc-note"><ShieldCheck size={18}/><p>سجل المنصة مستقل عن Audit المحاسبة الخاص بكل تاجر. لا يحتوي على كلمات مرور أو رموز الدعوات.</p></div></>;
}
export default function Page(){return <PlatformShell title="سجل عمليات المنصة" description="أثر الإجراءات الإدارية الحساسة ومَن نفذها.">
  {()=> <AuditDirectory/>}</PlatformShell>;}
