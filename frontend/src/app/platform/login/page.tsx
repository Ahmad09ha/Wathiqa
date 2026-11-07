"use client";

import {FormEvent,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ArrowLeft,LockKeyhole,ShieldCheck} from "lucide-react";
import BrandMark from "@/components/BrandMark";
import {useToast} from "@/components/ToastProvider";
import {ImportApiError,platformApi} from "@/lib/platformApi";
import {resetImportCsrf} from "@/lib/importApi";

export default function PlatformLogin(){
  const router=useRouter();const {notify}=useToast();
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);
    try{
      await platformApi("/auth/login",{method:"POST",
        body:JSON.stringify({email:email.trim(),password})});
      resetImportCsrf();setPassword("");router.replace("/platform");router.refresh();
    }catch(error){notify({kind:"error",title:"تعذّر تسجيل الدخول إلى إدارة المنصة",
      description:error instanceof ImportApiError&&error.status===401
        ?"بيانات SuperAdmin غير صحيحة، أو الحساب مقفل مؤقتاً بعد محاولات فاشلة."
        :(error as Error).message||"تحقق من بيانات SuperAdmin."});}
    finally{setBusy(false);}
  }
  return <main className="pc-login-shell">
    <section className="pc-login-intro">
      <Link href="/import/login" className="pc-back-to-merchant"><ArrowLeft size={15}/> مساحة عمل التاجر</Link>
      <div className="pc-login-lockup"><span><BrandMark/></span><div><strong>وثيقة</strong><small>WATHIQA CONTROL PLANE</small></div></div>
      <div className="pc-login-message"><span className="pc-eyebrow">PRIVATE PLATFORM CONSOLE</span>
        <h1>إدارة المنصة.<br/><em>من مكان واحد.</em></h1>
        <p>مساحة مستقلة لإدارة التجار وحالات الوصول والمستخدمين وتتبّع العمليات الحساسة، بدون الدخول إلى مستندات العملاء أو حوالاتهم.</p>
        <div className="pc-login-security"><ShieldCheck size={19}/> وصول مخصص لحساب SuperAdmin فقط</div>
      </div>
      <small className="pc-login-footer">WATHIQA / SECURE ADMINISTRATION</small>
    </section>
    <div className="pc-login-form-area"><form className="pc-login-form" onSubmit={e=>void submit(e)}>
      <div className="pc-login-form-icon"><LockKeyhole size={25}/></div>
      <span className="pc-eyebrow">تسجيل دخول آمن</span>
      <h2>مرحباً بعودتك</h2><p>الدخول منفصل عن حسابات التجار العادية؛ لا يمكنك استخدام حساب مدير شركة هنا.</p>
      <label htmlFor="platform-email">البريد الإلكتروني</label>
      <input id="platform-email" required dir="ltr" type="email" maxLength={254} autoComplete="username"
        placeholder="owner@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      <label htmlFor="platform-password">كلمة المرور</label>
      <input id="platform-password" required dir="ltr" type="password" autoComplete="current-password"
        placeholder="••••••••••••••••" value={password} onChange={e=>setPassword(e.target.value)}/>
      <button type="submit" className="pc-primary" disabled={busy}>
        {busy?"جارٍ التحقق من الحساب...":"الدخول إلى إدارة المنصة"}<ArrowLeft size={18}/>
      </button>
      <div className="pc-login-warning">لا يوجد تسجيل عام لحسابات SuperAdmin. يتم إنشاء الحساب الأول عبر إجراء إداري آمن من السيرفر فقط.</div>
    </form></div>
  </main>;
}
