"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole, ArrowLeft, ShieldCheck } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import PasswordField from "@/components/PasswordField";
import { useToast } from "@/components/ToastProvider";
import { importApi, resetImportCsrf } from "@/lib/importApi";

export default function ImportLogin() {
  const router = useRouter();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await importApi("/api/auth/login", {
        method: "POST", body: JSON.stringify({ email: email.trim(), password })
      });
      resetImportCsrf();
      router.replace("/import");
      router.refresh();
    } catch (error) {
      notify({kind:"error",title:"لم يتم تسجيل الدخول",description:
        (error as Error).message || "تحقق من البريد وكلمة المرور ثم حاول مجدداً."});
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="im-login-page">
      <div className="im-login-brand">
        <span className="im-brand-icon"><BrandMark /></span>
        <div><strong>وثيقة</strong><small>WATHIQA / IMPORT MANAGEMENT</small></div>
      </div>
      <div className="im-login-grid">
        <section className="im-login-intro">
          <span className="im-eyebrow">مساحة التجارة والتوريد</span>
          <h1>من طلب الشراء،<br/>إلى آخر حاوية.</h1>
          <p>مساحة واحدة لمتابعة عمليات الاستيراد، الجهات التجارية، والدفعات والشحنات والمستندات. كل شركة تشوف بياناتها فقط.</p>
          <div className="im-login-foot"><ShieldCheck size={21}/> معلومات شركتك محفوظة ضمن مساحة عمل مستقلة.</div>
        </section>
        <form className="im-login-card" onSubmit={event => void login(event)}>
          <span className="im-login-card-icon"><LockKeyhole size={23} strokeWidth={1.7}/></span>
          <h2>تسجيل الدخول</h2>
          <p>أدخل بيانات حسابك للوصول إلى مساحة شركتك.</p>
          <label htmlFor="import-email">البريد الإلكتروني</label>
          <input id="import-email" type="email" dir="ltr" autoComplete="username" required maxLength={254}
            placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)}/>
          <label htmlFor="import-password">كلمة المرور</label>
          <PasswordField id="import-password" label="كلمة المرور" dir="ltr" autoComplete="current-password" required
            placeholder="••••••••••••" value={password} onChange={event => setPassword(event.target.value)}/>
          <button type="submit" className="btn primary im-login-submit" disabled={pending}>
            {pending ? "جارٍ التحقق..." : "الدخول إلى وثيقة"} <ArrowLeft size={18}/>
          </button>
          <div className="im-login-hint">الدخول متاح للحسابات التي أنشأها مدير الشركة فقط.</div>
          <Link href="/import/join" className="im-join-back">لديك دعوة للانضمام؟ فعّل حسابك</Link>
        </form>
      </div>
      <div className="im-login-legal">وثيقة · نظام إدارة عمليات الاستيراد</div>
    </main>
  );
}
