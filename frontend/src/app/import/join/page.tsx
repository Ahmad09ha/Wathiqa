"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, UserRoundPlus } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { useToast } from "@/components/ToastProvider";
import { importApi, ImportApiError, resetImportCsrf } from "@/lib/importApi";

export default function JoinWathiqa() {
  const {notify} = useToast();
  const router = useRouter();
  const [token,setToken] = useState("");
  const [name,setName] = useState("");
  const [password,setPassword] = useState("");
  const [confirm,setConfirm] = useState("");
  const [pending,setPending] = useState(false);
  async function accept(event:FormEvent){
    event.preventDefault();
    if(pending)return;
    const cleanToken=token.replace(/[\s\u200B-\u200D\uFEFF]/gu,"");
    if(!cleanToken){
      notify({kind:"error",title:"أدخل رمز الدعوة أولاً"});
      return;
    }
    if(password!==confirm){
      notify({kind:"error",title:"كلمتا المرور غير متطابقتين"});
      return;
    }
    const missing=[
      password.length<12&&"12 محرفاً على الأقل",
      !/\p{Lu}/u.test(password)&&"حرفاً كبيراً",
      !/\p{Ll}/u.test(password)&&"حرفاً صغيراً",
      !/\p{Nd}/u.test(password)&&"رقماً",
      !/[^\p{L}\p{N}]/u.test(password)&&"رمزاً خاصاً مثل ! أو @"
    ].filter(Boolean);
    if(missing.length){
      notify({kind:"error",title:"كلمة المرور لا تحقق الشروط",
        description:"يلزم أن تحتوي على: "+missing.join("، ")+"."});
      return;
    }
    setPending(true);
    try {
      const submit = () => importApi("/api/auth/invitations/accept", {
        method:"POST",
        body:JSON.stringify({token:cleanToken,displayName:name.trim(),password})
      });
      try {
        await submit();
      } catch(error) {
        // The server validates CSRF before touching the one-time invitation.
        // A stale browser antiforgery token may therefore be safely retried once.
        if (!(error instanceof ImportApiError) || error.code !== "csrf_invalid")
          throw error;
        resetImportCsrf();
        await submit();
      }
      setToken("");setPassword("");setConfirm("");
      notify({kind:"success",title:"تم تفعيل حسابك",description:"يمكنك تسجيل الدخول ببريدك وكلمة المرور التي اخترتها."});
      router.replace("/import/login");
    } catch(error){
      notify({kind:"error",title:"تعذّر قبول الدعوة",description:(error as Error).message});
    } finally {setPending(false);}
  }
  return <main className="im-login-page">
    <div className="im-login-brand">
      <span className="im-brand-icon"><BrandMark/></span>
      <div><strong>وثيقة</strong><small>WATHIQA / INVITATION</small></div>
    </div>
    <div className="im-join-wrap">
      <form className="im-login-card" onSubmit={event=>void accept(event)}>
        <span className="im-login-card-icon"><UserRoundPlus size={24}/></span>
        <h2>قبول دعوة الانضمام</h2>
        <p>هذه الصفحة للموظفين الذين حصلوا على رمز دعوة من مدير شركتهم. رمز الدعوة صالح لمدة 48 ساعة ولمرة واحدة، وهو مختلف عن كلمة المرور الجديدة.</p>
        <label htmlFor="invite-token">رمز الدعوة</label>
        <input id="invite-token" dir="ltr" required autoComplete="off" maxLength={256}
          value={token} onChange={e=>setToken(e.target.value)} placeholder="الصق رمز الدعوة هنا"/>
        <label htmlFor="invite-display">اسمك الظاهر</label>
        <input id="invite-display" dir="auto" required minLength={2} maxLength={160}
          value={name} onChange={e=>setName(e.target.value)} placeholder="الاسم الكامل"/>
        <label htmlFor="invite-password">كلمة مرور جديدة</label>
        <input id="invite-password" dir="ltr" type="password" required minLength={12}
          autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
        <label htmlFor="invite-confirm">تأكيد كلمة المرور</label>
        <input id="invite-confirm" dir="ltr" type="password" required minLength={12}
          autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/>
        <div className="im-password-rule"><KeyRound size={15}/> 12 محرفاً على الأقل، مع حروف كبيرة وصغيرة ورقم ورمز خاص.</div>
        <button type="submit" className="btn primary im-login-submit" disabled={pending}>
          {pending?"جارٍ تفعيل الحساب...":"تفعيل حسابي"} <ArrowRight size={17}/>
        </button>
        <Link href="/import/login" className="im-join-back">لديك حساب؟ الرجوع لتسجيل الدخول</Link>
      </form>
    </div>
    <div className="im-login-legal">وثيقة · نظام إدارة عمليات الاستيراد</div>
  </main>;
}
