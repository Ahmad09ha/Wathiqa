"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpenText, Building2, LogOut, Menu, ShieldCheck, X, LayoutDashboard, Users, ChevronLeft, ClipboardList, Ship, Anchor, PanelRightClose, PanelRightOpen, Home } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import { useToast } from "@/components/ToastProvider";
import { CurrentImportUser, ImportApiError, currentImportUser, importApi, resetImportCsrf } from "@/lib/importApi";
import {hasFeature} from "@/lib/featurePermissions";

export default function ImportShell({
  section, title, description, children
}: {
  section: "home" | "orders" | "companies" | "reference" | "team" | "operations";
  title: string;
  description: string;
  children: (user: CurrentImportUser) => React.ReactNode;
}) {
  const [user, setUser] = useState<CurrentImportUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { notify } = useToast();

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("wathiqa.import.sidebar.compact") === "yes"); }
    catch { /* storage may be blocked */ }
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeButton = sidebarRef.current?.querySelector<HTMLButtonElement>(".im-close-mobile");
    closeButton?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key !== "Tab") return;
      const links = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")??[])]
        .filter(element=>element.getClientRects().length>0);
      if (!links.length) return;
      const first = links[0], last = links[links.length-1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    };
    const onResize = () => {if (window.innerWidth > 790) setMenuOpen(false);};
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      menuButtonRef.current?.focus();
    };
  }, [menuOpen]);
  function toggleCollapsed() {
    setCollapsed(previous => {
      try { window.localStorage.setItem("wathiqa.import.sidebar.compact", previous ? "no" : "yes"); }
      catch { /* storage may be blocked */ }
      return !previous;
    });
  }

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
  const sectionRights: Record<string,string> = {
    home:"nav.dashboard",orders:"nav.orders",reference:"nav.reference",
    operations:"nav.operations",companies:"nav.companies"
  };
  const canOpenSection = section==="team" ? user.role==="Admin"
    :hasFeature(user,sectionRights[section]);
  const navigation = [
    {name:"لوحة التحكم", href:"/import", id:"home", icon:LayoutDashboard},
    {name:"طلبات الشراء", href:"/import/orders", id:"orders", icon:ClipboardList},
    {name:"بيانات طلبات الشراء", href:"/import/reference-data", id:"reference", icon:Anchor},
    {name:"متابعة العمليات", href:"/import/operations", id:"operations", icon:Ship},
    {name:"الجهات والشركات", href:"/import/companies", id:"companies", icon:Building2},
    ...(user.role==="Admin" ? [{name:"الموظفون والصلاحيات",href:"/import/team",id:"team",icon:Users}] : [])
  ].filter(item=>item.id==="team"||hasFeature(user,sectionRights[item.id]));
  const navigationGroups = [
    {label:"مساحة العمل", ids:["home"]},
    {label:"العمليات", ids:["orders","reference","operations","companies"]},
    {label:"الإدارة", ids:["team"]}
  ].map(group=>({...group,items:navigation.filter(item=>group.ids.includes(item.id))}))
   .filter(group=>group.items.length>0);
  return (
    <div className={"im-app"+(collapsed?" im-layout-compact":"")}>
      {menuOpen && <button type="button" className="im-backdrop" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة" />}
      <aside ref={sidebarRef} id="wathiqa-import-navigation" className={"im-sidebar " + (menuOpen ? "is-open" : "")} aria-label="تنقل وثيقة">
        <div className="im-brand">
          <span className="im-brand-icon"><BrandMark /></span>
          <div className="im-brand-copy"><strong>وثيقة</strong><small>WATHIQA / IMPORT</small></div>
          <button type="button" className="im-collapse-desktop" aria-label={collapsed?"توسيع القائمة الجانبية":"طي القائمة الجانبية"}
            title={collapsed?"توسيع القائمة الجانبية":"طي القائمة الجانبية"} aria-expanded={!collapsed}
            onClick={toggleCollapsed}>{collapsed?<PanelRightOpen size={18}/>:<PanelRightClose size={18}/>}</button>
          <button type="button" className="im-close-mobile" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={21}/></button>
        </div>
        <div className="im-sidebar-middle" data-lenis-prevent>
          <nav className="im-nav" aria-label="أقسام مساحة العمل">
            {navigationGroups.map(group=><div className="im-nav-group" key={group.label}>
              <span className="im-nav-label">{group.label}</span>
              {group.items.map(({name,href,id,icon:Icon}) =>
                <Link key={id} href={href} onClick={() => setMenuOpen(false)}
                  title={collapsed?name:undefined} aria-label={name}
                  aria-current={section===id?"page":undefined}
                  className={"im-nav-link " + (section===id?"active":"")}>
                  <Icon size={19} strokeWidth={1.8}/><span className="im-nav-text">{name}</span>
                </Link>
              )}
            </div>)}
          </nav>
          <div className="im-nav-group im-nav-coming">
            <span className="im-nav-label">التقارير</span>
            <div className="im-nav-upcoming" title="التقارير والحوالات المالية قيد التطوير">
            <BookOpenText size={18}/>
              <span>الحوالات المالية والتقارير <small>قيد التطوير</small></span>
            </div>
          </div>
        </div>
        <div className="im-sidebar-bottom">
          <div className="im-user-identity" title={user.displayName+" · "+user.name+" · "+expiryTitle}>
            <span className="im-user-avatar">{user.displayName.slice(0,1)}</span>
            <div className="im-user-copy"><strong dir="auto">{user.displayName}</strong>
              <small>{user.role === "Admin" ? "مدير الشركة" : "موظف"} · <bdi dir="auto">{user.name}</bdi></small>
              <span className={"im-access-type "+(expiryText?"trial":"unlimited")}>
                {expiryText?"ينتهي "+expiryText:"حساب دائم · بدون انتهاء"}
              </span>
            </div>
          </div>
           <Button type="button" variant="ghost" className="im-logout" title="تسجيل الخروج"
             aria-label="تسجيل الخروج" onClick={() => void logout()}>
             <LogOut size={17}/><span className="im-nav-text">تسجيل الخروج</span>
            </Button>
        </div>
      </aside>
      <div className="im-main">
        <header className="im-header">
           <Button ref={menuButtonRef} type="button" variant="outline" className="im-menu-btn" onClick={() => setMenuOpen(true)}
             aria-controls="wathiqa-import-navigation" aria-expanded={menuOpen} aria-label="فتح القائمة"><Menu size={22}/></Button>
          <div className="im-heading">
            <div className="im-crumb"><Link href="/import"><Home size={13}/> مساحة العمل</Link><ChevronLeft size={13}/> {title}</div>
            <h1>{title}</h1><p>{description}</p>
          </div>
           <Badge variant="outline" className="im-header-status">
             <ShieldCheck size={17}/><span>{user.role === "Admin" ? "حساب مدير" : "حساب موظف"}</span>
           </Badge>
        </header>
        <main className="im-content">{canOpenSection ? children(user) :
          <div className="im-empty" role="alert"><ShieldCheck size={30}/>
            <strong>ما عندك صلاحية لعرض هذا القسم</strong>
            <p>يمكن لمدير شركتك تفعيل هذه الصفحة من «الموظفون والصلاحيات».</p>
            {navigation.length>0&&<Link href={navigation[0].href} className="btn btn-outline">
              الانتقال إلى قسم مسموح
            </Link>}
          </div>}</main>
      </div>
    </div>
  );
}
