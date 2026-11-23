"use client";

import ImportShell from "@/components/ImportShell";
import TenantDashboard from "@/components/TenantDashboard";

export default function ImportHome() {
  return <ImportShell section="home" title="لوحة متابعة الشركة"
    description="إحصائيات الاستيراد وسجل أنشطة الفريق في مكان واحد.">
    {user => <TenantDashboard user={user}/>}
  </ImportShell>;
}
