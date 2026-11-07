"use client";

import Link from "next/link";
import { ArrowUpLeft, Building2, CircleDollarSign, Container, FileCheck2, ShieldCheck, Users, ClipboardList } from "lucide-react";
import ImportShell from "@/components/ImportShell";

export default function ImportHome() {
  return (
    <ImportShell section="home" title="نظرة عامة" description="مرحباً بك في مساحة إدارة عمليات الاستيراد.">
      {user => (
        <>
          <div className="im-page-intro">
            <div><span className="im-eyebrow">وثيقة / مساحة التاجر</span>
              <h2>كل عملية استيراد،<br/>بتفاصيلها الواضحة.</h2>
              <p>أنشئ طلبات الشراء وسجّل تفاصيل الخيوط والأسعار، وتابع الجهات التجارية ضمن مساحة عمل شركتك.</p>
            </div>
            <span className="im-page-mark"><Building2 size={37} strokeWidth={1.1}/></span>
          </div>
          <div className="im-section-header"><div><small>الخدمات المتاحة</small><h3>إدارة مساحة العمل</h3></div></div>
          <div className="im-dashboard-grid">
            <Link href="/import/orders" className="im-feature">
              <span className="im-feature-icon"><ClipboardList size={23}/></span>
              <strong>طلبات الشراء</strong>
              <p>أنشئ طلب شراء، وحدّد المورد وبنود الخيوط والكميات والأسعار، واحصل على رقم تلقائي لكل طلب.</p>
              <span className="im-feature-link">فتح الطلبات <ArrowUpLeft size={17}/></span>
            </Link>
            <Link href="/import/companies" className="im-feature">
              <span className="im-feature-icon"><Building2 size={23}/></span>
              <strong>الجهات والشركات</strong>
              <p>أضف الموردين والشركات المتعاملة معها، ضمن بيانات شركتك وحدها.</p>
              <span className="im-feature-link">فتح الدليل <ArrowUpLeft size={17}/></span>
            </Link>
            {user.role === "Admin" && (
              <Link href="/import/team" className="im-feature">
                <span className="im-feature-icon"><Users size={23}/></span>
                <strong>الموظفون والصلاحيات</strong>
                <p>دعوة موظفين، وإدارة حساباتهم وصلاحيات التعامل مع الماليات.</p>
                <span className="im-feature-link">إدارة الفريق <ArrowUpLeft size={17}/></span>
              </Link>
            )}
            <div className="im-feature im-feature-muted">
              <span className="im-feature-icon"><CircleDollarSign size={23}/></span>
              <strong>دفعات الطلبات</strong>
              <p>رح نفصل الاستحقاقات والحوالات والفروقات المحاسبية على مستوى الطلب.</p>
              <span className="im-feature-caption">قيد التطوير</span>
            </div>
            <Link href="/import/operations" className="im-feature">
              <span className="im-feature-icon"><Container size={23}/></span>
              <strong>الحاويات والمستندات</strong>
              <p>تابع الحاويات في البحر ومدة السماح، واكتشف المستندات المطلوبة والناقصة.</p>
              <span className="im-feature-link">متابعة التشغيل <ArrowUpLeft size={17}/></span>
            </Link>
          </div>
          <div className="im-info-strip">
            <ShieldCheck size={21}/>
            <div><strong>صلاحياتك الحالية</strong>
              <p>{user.role === "Admin"
                ? "أنت مدير هذه الشركة، ويمكنك إدارة حسابات الموظفين وصلاحياتهم."
                : user.canManagePayments
                  ? "يمكنك مشاهدة البيانات المالية وتعديلها ضمن شركتك."
                  : "يمكنك مشاهدة الأسعار والدفعات، لكن التعديل المالي يحتاج صلاحية خاصة."}</p>
            </div>
            <FileCheck2 size={22} className="im-info-secondary"/>
          </div>
        </>
      )}
    </ImportShell>
  );
}
