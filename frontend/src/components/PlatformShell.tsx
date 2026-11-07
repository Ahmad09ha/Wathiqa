"use client";

import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {Activity,Building2,CalendarClock,LayoutDashboard,LogOut,Menu,ScrollText,ShieldCheck,Tags,Users,X} from "lucide-react";
import BrandMark from "@/components/BrandMark";
import {useToast} from "@/components/ToastProvider";
import {resetImportCsrf} from "@/lib/importApi";
import {ImportApiError,getPlatformMe,platformApi,PlatformIdentity} from "@/lib/platformApi";

export default function PlatformShell({title,description,children}: {
  title:string;description:string;
  children:(user:PlatformIdentity)=>React.ReactNode;
}) {
  const router=useRouter();const pathname=usePathname();
  const {notify}=useToast();
  const [account,setAccount]=useState<PlatformIdentity|null>(null);
  const [loading,setLoading]=useState(true);
  const [mobile,setMobile]=useState(false);
  const refresh=useCallback(async()=>{
    try{setAccount(await getPlatformMe());}
    catch(error){
      if(error instanceof ImportApiError&&(error.status===401||error.status===403)){
        router.replace("/platform/login");
      }else notify({kind:"error",title:"تعذّر التحقق من حساب SuperAdmin",description:(error as Error).message});
    }finally{setLoading(false);}
  },[router,notify]);
  useEffect(()=>{void refresh();},[refresh]);
  async function logout(){
    try{await platformApi<void>("/auth/logout",{method:"POST"});
      resetImportCsrf();setAccount(null);router.replace("/platform/login");}
    catch(error){notify({kind:"error",title:"تعذّر تسجيل الخروج",description:(error as Error).message});}
  }
  if(loading||!account)return <div className="pc-wait">
    <ShieldCheck size={36}/><strong>وثيقة / Platform</strong>
    <p>{loading?"جارٍ التحقق من هوية مدير المنصة...":"الصفحة متاحة لحساب SuperAdmin فقط."}</p>
    {!loading&&<Link href="/platform/login">الدخول إلى إدارة المنصة</Link>}
  </div>;
  const navigation=[
    {label:"نظرة عامة",url:"/platform",icon:LayoutDashboard},
    {label:"التجار والشركات",url:"/platform/tenants",icon:Building2},
    {label:"الباقات",url:"/platform/plans",icon:Tags},
    {label:"الاشتراكات اليدوية",url:"/platform/subscriptions",icon:CalendarClock},
    {label:"المستخدمون",url:"/platform/users",icon:Users},
    {label:"سجل العمليات",url:"/platform/audits",icon:ScrollText}
  ];
  return <div className="pc-app">
    {mobile&&<button className="pc-scrim" aria-label="إغلاق القائمة" onClick={()=>setMobile(false)}/>}
    <aside className={"pc-sidebar "+(mobile?"open":"")}>
      <div className="pc-brand">
        <span className="pc-brand-symbol"><BrandMark/></span>
        <div><strong>وثيقة <span>Control</span></strong><small>PLATFORM MANAGEMENT</small></div>
        <button className="pc-close-mobile" aria-label="إغلاق القائمة" onClick={()=>setMobile(false)}><X size={19}/></button>
      </div>
      <div className="pc-operator-tag"><ShieldCheck size={20}/>
        <div><small>صلاحية إدارة المنصة</small><strong>SuperAdmin</strong></div>
      </div>
      <div className="pc-navigation">
        <div className="pc-nav-hint">إدارة المنصة</div>
        <nav>{navigation.map(({url,label,icon:Icon})=><Link key={url} href={url}
          onClick={()=>setMobile(false)}
          className={"pc-nav-link "+(pathname===url||url!=="/platform"&&pathname.startsWith(url+"/")?"active":"")}>
          <Icon size={18}/>{label}</Link>)}</nav>
        <div className="pc-sidebar-message"><Activity size={17}/>
          <span>الاشتراكات تُدار يدوياً من SuperAdmin فقط. لا يوجد دفع أو فواتير أو تحصيل داخل المنصة.</span>
        </div>
      </div>
      <div className="pc-sidebar-end">
        <div className="pc-identity"><span>{account.displayName.slice(0,1)}</span>
          <div><strong>{account.displayName}</strong><small dir="ltr">{account.email}</small></div>
        </div>
        <button type="button" onClick={()=>void logout()}><LogOut size={17}/> تسجيل الخروج</button>
      </div>
    </aside>
    <div className="pc-main">
      <header className="pc-header"><div className="pc-header-title">
        <button type="button" className="pc-open-mobile" onClick={()=>setMobile(true)} aria-label="فتح القائمة"><Menu size={23}/></button>
        <div><div className="pc-breadcrumb">وثيقة / إدارة المنصة</div><h1>{title}</h1><p>{description}</p></div>
      </div><span className="pc-role-chip"><ShieldCheck size={15}/> SuperAdmin</span></header>
      <main className="pc-content">{children(account)}</main>
    </div>
  </div>;
}
