"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpenText, Files, LayoutDashboard, Menu, PanelRightClose,
  ArrowUpLeft, FilePenLine
} from "lucide-react";
import BrandMark from "@/components/BrandMark";

export default function Workspace({
  children, title, subtitle, actions
}: {
  children: React.ReactNode; title: string; subtitle: string; actions?: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [section, setSection] = useState("");
  const pathname = usePathname();
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const syncHash = () => setSection(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);

  return (
    <div className="layout">
      <div className={"sidebar-scrim " + (mobileOpen ? "is-visible" : "")}
        onClick={() => setMobileOpen(false)} aria-hidden="true" />
      <aside className={"sidebar " + (mobileOpen ? "mobile-open" : "")} aria-label="القائمة الرئيسية">
        <div className="sidebar-inner">
          <div className="brand-lockup">
            <span className="brand-symbol" aria-hidden="true"><BrandMark /></span>
            <div className="brand-type">
              <strong>وثيقة</strong>
              <small>WATHIQA</small>
            </div>
            <button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="إغلاق القائمة">
              <PanelRightClose size={21}/>
            </button>
          </div>

          <div className="sidebar-navigation" data-lenis-prevent>
            <div className="nav-caption">مساحة العمل</div>
            <nav className="navlist">
              <Link href="/" className={"nav " + (pathname === "/" && section !== "#templates" && section !== "#documents" ? "active" : "")} onClick={() => { setSection(""); setMobileOpen(false); }}>
                <LayoutDashboard size={19} strokeWidth={1.75}/><span>نظرة عامة</span>
              </Link>
              <Link href="/#templates" className={"nav " + ((pathname === "/" && section === "#templates") || pathname.startsWith("/editor/template/") ? "active" : "")} onClick={() => { setSection("#templates"); setMobileOpen(false); }}>
                <BookOpenText size={19} strokeWidth={1.75}/><span>القوالب</span>
              </Link>
              <Link href="/#documents" className={"nav " + ((pathname === "/" && section === "#documents") || pathname.startsWith("/editor/document/") ? "active" : "")} onClick={() => { setSection("#documents"); setMobileOpen(false); }}>
                <Files size={19} strokeWidth={1.75}/><span>مستنداتي</span>
              </Link>
            </nav>
            <div className="nav-caption nav-caption-secondary">الأدوات</div>
            <div className="sidebar-notice">
              <FilePenLine size={20} strokeWidth={1.6}/>
              <span>صمّم القالب مرة واحدة، وأنشئ منه نسخاً مستقلة كلما احتجت.</span>
            </div>
          </div>

          <div className="sidebar-footer">
            <span className="sidebar-footer-dot" aria-hidden="true" />
            <div><strong>مساحة العمل المحلية</strong><small>إصدار تجريبي · خاص بهذا الجهاز</small></div>
          </div>
        </div>
      </aside>

      <main className="workspace" id="main-content">
        <header className="topbar">
          <div className="header-identity">
            <button className="btn mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="فتح القائمة" aria-expanded={mobileOpen}>
              <Menu size={20}/>
            </button>
            <div>
              <div className="breadcrumbs">مساحة العمل <ArrowUpLeft size={13} aria-hidden="true"/> <span>{title}</span></div>
              <h1 className="title">{title}</h1>
              <p className="subtitle">{subtitle}</p>
            </div>
          </div>
          {actions && <div className="actions top-actions">{actions}</div>}
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
