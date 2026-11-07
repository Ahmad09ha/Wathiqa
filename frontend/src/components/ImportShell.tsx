"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpenText, Building2, LogOut, Menu, ShieldCheck, X, LayoutGrid, Users, ChevronLeft, ClipboardList, Ship } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { useToast } from "@/components/ToastProvider";
import { CurrentImportUser, ImportApiError, currentImportUser, importApi, resetImportCsrf } from "@/lib/importApi";

export default function ImportShell({
  section, title, description, children
}: {
  section: "home" | "orders" | "companies" | "team" | "operations";
  title: string;
  description: string;
  children: (user: CurrentImportUser) => React.ReactNode;
}) {
  const [user, setUser] = useState<CurrentImportUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const { notify } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await currentImportUser();
      setUser(data);
    } catch (error) {
      if (error instanceof ImportApiError && error.status === 401) {
        router.replace("/import/login");
      } else {
        notify({kind: "error", title: "تعذّر فتح مساحة العمل", description: (error as Error).message});
        if (error instanceof ImportApiError && error.status === 403) router.replace("/import/login");
      }
    } finally {
      setLoading(false);
    }
  }, [notify, router]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function logout() {
    try {
      await importApi<void>("/api/auth/logout", {method:"POST"});
      resetImportCsrf();
      router.replace("/import/login");
    } catch (error) {
      notify({kind:"error",title:"تعذّر تسجيل الخروج",description:(error as Error).message});
    }
  }

  if (loading || !user) return (
    <div className="im-wait">
      <span className="im-mark"><BrandMark /></span>
      <strong>وثيقة</strong>
      <p>{loading ? "جارٍ التحقق من صلاحية جلستك..." : "تعذّر فتح مساحة العمل."}</p>
      {!loading && <Link href="/import/login" className="btn primary">تسجيل الدخول</Link>}
    </div>
  );
  const expiryText = user.accessExpiresAtUtc
    ? new Date(user.accessExpiresAtUtc).toLocaleDateString("ar-SY-u-nu-latn")
    : null;
  const expiryTitle = user.accessExpiresAtUtc
    ? "تاريخ انتهاء الاشتراك حسب توقيت جهازك: " +
      new Date(user.accessExpiresAtUtc).toLocaleString("ar-SY-u-nu-latn", {
        dateStyle:"medium",timeStyle:"short"
      })
    : "لا يوجد تاريخ انتهاء تلقائي لهذا الحساب.";
  const navigation = [
    {name:"نظرة عامة", href:"/import", id:"home", icon:LayoutGrid},
    {name:"طلبات الشراء", href:"/import/orders", id:"orders", icon:ClipboardList},
    {name:"متابعة العمليات", href:"/import/operations", id:"operations", icon:Ship},
    {name:"الجهات والشركات", href:"/import/companies", id:"companies", icon:Building2},
    ...(user.role === "Admin" ? [{name:"الموظفون والصلاحيات", href:"/import/team", id:"team", icon:Users}] : [])
  ];
  return (
    <div className="im-app">
      {menuOpen && <button type="button" className="im-backdrop" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة" />}
      <aside className={"im-sidebar " + (menuOpen ? "is-open" : "")} aria-label="تنقل وثيقة">
        <div className="im-brand">
          <span className="im-brand-icon"><BrandMark /></span>
          <div><strong>وثيقة</strong><small>WATHIQA / IMPORT</small></div>
          <button type="button" className="im-close-mobile" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={21}/></button>
        </div>
        <div className="im-company">
          <span className="im-company-monogram">{user.name.slice(0,1)}</span>
          <div><small>مساحة عمل التاجر</small><strong dir="auto">{user.name}</strong>
            <span className={"im-access-type "+(expiryText?"trial":"unlimited")} title={expiryTitle}>
              {expiryText?"تجريبي · ينتهي "+expiryText:"حساب دائم · بدون انتهاء"}
            </span>
          </div>
        </div>
        <div className="im-sidebar-middle" data-lenis-prevent>
          <span className="im-nav-label">القائمة الرئيسية</span>
          <nav className="im-nav">
            {navigation.map(({name,href,id,icon:Icon}) =>
              <Link key={id} href={href} onClick={() => setMenuOpen(false)} className={"im-nav-link " + (section===id?"active":"")}>
                <Icon size={19} strokeWidth={1.7}/><span>{name}</span>
              </Link>
            )}
          </nav>
          <span className="im-nav-label im-nav-secondary">الأدوات القادمة</span>
          <div className="im-nav-upcoming">
            <BookOpenText size={18}/>
             <span>الحوالات المالية والتقارير المحاسبية قيد التطوير.</span>
          </div>
        </div>
        <div className="im-sidebar-bottom">
          <div className="im-user-identity">
            <span className="im-user-avatar">{user.displayName.slice(0,1)}</span>
            <div><strong dir="auto">{user.displayName}</strong><small>{user.role === "Admin" ? "مدير الشركة" : "موظف"}</small></div>
          </div>
          <button type="button" className="im-logout" onClick={() => void logout()}>
            <LogOut size={17}/> تسجيل الخروج
          </button>
        </div>
      </aside>
      <div className="im-main">
        <header className="im-header">
          <button type="button" className="im-menu-btn" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><Menu size={22}/></button>
          <div className="im-heading">
            <div className="im-crumb">مساحة العمل <ChevronLeft size={12}/> {title}</div>
            <h1>{title}</h1><p>{description}</p>
          </div>
          <div className="im-header-status">
            <ShieldCheck size={17}/><span>{user.role === "Admin" ? "حساب مدير" : "حساب موظف"}</span>
          </div>
        </header>
        <main className="im-content">{children(user)}</main>
      </div>
    </div>
  );
}
