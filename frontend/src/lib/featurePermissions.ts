// Shared UI labels only. Server checks every key and every request against
// the live database; these constants are not an authorization boundary.
export const featureGroups = [
  {title:"القائمة الرئيسية",description:"إظهار الصفحات في القائمة اليمينية",
    items:[
      {key:"nav.dashboard",label:"نظرة عامة والإحصائيات"},
      {key:"nav.orders",label:"طلبات الشراء"},
      {key:"nav.reference",label:"بيانات طلبات الشراء (الموردون والعملاء والموانئ)"},
      {key:"nav.operations",label:"متابعة العمليات"},
      {key:"nav.companies",label:"الجهات والشركات"}
    ]},
  {title:"تبويبات إدخال الطلب من ملف",description:"تظهر هذه الخيارات فقط إذا كانت صفحة طلبات الشراء مسموحة",
    items:[
      {key:"tab.info",label:"معلومات الطلب والعقد والأسعار"},
      {key:"tab.payments",label:"الدفعات والحوالات"},
      {key:"tab.bl",label:"بوليصة الشحن B/L والحاويات"},
      {key:"tab.customs",label:"التخليص الجمركي"},
      {key:"tab.tracking",label:"تتبع الشحنة ShipsGo"}
    ]},
  {title:"المستندات والمرفقات",description:"صلاحيات منفصلة للاطلاع والرفع والإدارة",
    items:[
      {key:"documents.view",label:"مشاهدة وتحميل المستندات"},
      {key:"documents.upload",label:"رفع المستندات وإدارة ارتباطاتها"}
    ]}
] as const;

export type FeaturePermissionKey = typeof featureGroups[number]["items"][number]["key"];

export const allFeaturePermissions: string[] =
  featureGroups.flatMap(group=>group.items.map(item=>item.key));

export function hasFeature(
  user: {role:"Admin"|"Staff";permissions:string[]}, key:string
):boolean{
  return user.role==="Admin"||user.permissions.includes(key);
}
