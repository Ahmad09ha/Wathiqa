"use client";

const BASE = "/import-api";
let csrfValue: string | null = null;

export interface CurrentImportUser {
  id: string;
  email: string;
  displayName: string;
  tenantId: string;
  name: string;
  slug: string;
  role: "Admin" | "Staff";
  canManagePayments: boolean;
  accessExpiresAtUtc: string | null;
}
export interface ImportCompany {
  id: string;
  name: string;
  type: string;
  createdAtUtc: string;
  nameEn: string;
  country: string;
  city: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
  taxNo: string;
  defaultCurrency: string;
  notes: string;
}
export interface TenantPort {
  id: string | null;
  name: string;
  country: string;
  source: "Catalog" | "History";
  createdAtUtc: string | null;
}
export const fetchTenantPorts = () => importApi<TenantPort[]>("/api/ports");
export const createTenantPort = (name: string, country = "") =>
  importApi<TenantPort>("/api/ports", {
    method:"POST",body:JSON.stringify({name,country})
  });
export interface ImportCompaniesPage {
  page: number;
  pageSize: number;
  total: number;
  items: ImportCompany[];
}
export interface ImportTeamUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  role: "Admin" | "Staff";
  canManagePayments: boolean;
}
export interface PurchaseOrderItem {
  id: string;
  position: number;
  productType: string;
  brand: string;
  denier: string;
  luster: string;
  grade: string;
  colorType: string;
  quantityKg: number;
  unitPrice: number;
  priceUnit: "KG" | "TON";
  lineTotal: number;
  hsCode: string;
}
export interface PurchaseOrder {
  id: string;
  number: string;
  numberYear: number;
  supplierId: string;
  supplierNameSnapshot: string;
  customerId: string | null;
  customerNameSnapshot: string | null;
  supplierRef: string;
  proformaInvoiceNumber: string;
  contractNumber: string;
  contractDate: string | null;
  orderDate: string;
  incoterm: string;
  loadingPort: string;
  dischargePort: string;
  currency: string;
  notes: string;
  totalAmount: number;
  paidAmount: number | null;
  remainingAmount: number | null;
  paymentStatus: string | null;
  financialsAvailable: boolean;
  closedWithExceptions: boolean;
  closureReason: string | null;
  closedAtUtc: string | null;
  arrivalStatus: string;
  clearanceStatus: string;
  status: string;
  revision: number;
  items: PurchaseOrderItem[];
}
export interface OrderListItem {
  id: string;
  number: string;
  orderDate: string;
  supplierId: string;
  supplierNameSnapshot: string;
  supplierRef: string;
  currency: string;
  totalAmount: number;
  paidAmount: number | null;
  remainingAmount: number | null;
  paymentStatus: string | null;
  isPaymentOverdue: boolean;
  unresolvedDifference: number;
  closedWithExceptions: boolean;
  arrivalStatus: string;
  clearanceStatus: string;
  quantityKg: number;
  containerCount: number;
  deliveredContainerCount: number;
  eta: string | null;
  status: string;
  revision: number;
  itemCount: number;
}
export interface OrdersPage {
  page: number;
  pageSize: number;
  total: number;
  items: OrderListItem[];
  financialsAvailable: boolean;
  summaries: {
    currency: string;
    orderCount: number;
    totalAmount: number;
    paidAmount: number | null;
    remainingAmount: number | null;
  }[];
}
export interface OrderInputItem {
  id?: string;
  productType: string;
  brand?: string;
  denier: string;
  luster: string;
  grade: string;
  colorType: string;
  quantity: number;
  quantityUnit: "KG" | "TON";
  unitPrice: number;
  priceUnit: "KG" | "TON";
  hsCode: string;
}
export interface SaveOrderInput {
  supplierId: string;
  customerId: string | null;
  supplierRef: string;
  proformaInvoiceNumber?: string;
  contractNumber?: string;
  contractDate?: string | null;
  metadataEdited?: boolean;
  orderDate: string;
  incoterm: string;
  loadingPort: string;
  dischargePort: string;
  currency: string;
  notes: string;
  revision?: number | null;
  items: OrderInputItem[];
}
export class ImportApiError extends Error {
  constructor(public readonly status: number, message: string,
    public readonly code?: string) {
    super(message);
    this.name = "ImportApiError";
  }
}
const ArabicErrors: Record<string, string> = {
  payments_not_configured: "فلاتر المدفوعات والتأخير لم تتفعّل بعد؛ نظام الحوالات والاستحقاقات ما زال قيد التنفيذ.",
  invalid_filter: "أحد فلاتر البحث غير صالح.",
  invalid_filter_date: "أدخل التاريخ بصيغة صحيحة.",
  invalid_filter_date_range: "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.",
  account_expired: "انتهت صلاحية الحساب التجريبي (3 أشهر). تواصل مع مسؤول النظام لتجديد الاشتراك.",
  invalid_invitation: "رمز الدعوة غير صالح.",
  invalid_or_expired_invitation: "انتهت صلاحية الدعوة أو تم استخدامها.",
  invalid_user_or_password: "بيانات الحساب أو كلمة المرور غير صالحة.",
  invalid_company_name_or_type: "راجع اسم الشركة ونوعها.",
  invalid_company_details: "راجع بيانات الجهة، البريد الإلكتروني، العملة والأطوال المسموحة للحقول.",
  invalid_port_details: "اسم الميناء مطلوب (2 إلى 160 حرفاً)، والدولة اختيارية حتى 100 حرف.",
  port_already_exists: "هذا الميناء موجود مسبقاً في دليل شركتك. اختره من القائمة.",
  company_in_use: "هذه الجهة مرتبطة بطلبات شراء أو شحنات أو تخليص نشط. لا يمكن تغيير نوعها أو حذفها قبل معالجة هذه الارتباطات.",
  invitation_already_pending: "توجد دعوة سارية لهذا البريد.",
  email_already_registered: "البريد الإلكتروني مستخدم بالفعل.",
  invalid_email: "أدخل بريداً إلكترونياً صحيحاً.",
  admin_permission_is_implicit: "مدير الشركة يمتلك هذه الصلاحية تلقائياً.",
  cannot_deactivate_self: "لا يمكنك تعطيل حسابك بنفسك.",
  csrf_invalid: "انتهت صلاحية رمز الحماية. حدّث الصفحة وأعد المحاولة."
  ,supplier_or_customer_unavailable: "المورّد أو العميل المحدد غير متاح ضمن شركتك."
  ,invalid_order_items: "الطلب يحتاج بنداً واحداً على الأقل، وبحد أقصى 100 بند."
  ,invalid_order_item: "أحد بنود الطلب غير صالح."
  ,product_type_required: "يرجى إدخال نوع الخيط في كل بند."
  ,invalid_order_date: "تاريخ الطلب غير صالح."
  ,invalid_incoterm: "شروط التسليم غير صالحة."
  ,unsupported_currency: "عملة الطلب غير مدعومة في هذه المرحلة."
  ,invalid_quantity_or_price_unit: "وحدة الكمية أو التسعير غير صالحة."
  ,quantity_and_price_must_be_positive: "الكمية والسعر يجب أن يكونا أكبر من صفر."
  ,quantity_precision: "الكمية بالكيلوغرام تدعم ثلاث خانات عشرية فقط."
  ,unit_price_precision: "سعر الوحدة يدعم أربع خانات عشرية فقط."
  ,line_amount_too_small: "قيمة أحد البنود صغيرة جداً."
  ,order_amount_too_large: "القيمة تتجاوز الحدود المدعومة."
  ,foreign_order_item: "لا يمكن استخدام بند من طلب مختلف."
  ,stale_order_revision: "تم تعديل هذا الطلب من جلسة أخرى؛ حدّث الصفحة قبل الحفظ."
  ,revision_required: "يجب تحميل أحدث نسخة من الطلب قبل التعديل."
  ,order_number_year_immutable: "لا يمكن تغيير سنة الطلب بعد إصدار رقمه."
  ,only_draft_orders_editable: "يمكن تعديل الطلبات بحالة مسودة فقط."
  ,only_draft_orders_deletable: "يمكن حذف المسودات فقط."
  ,order_creation_conflict: "حصل تعارض أثناء إنشاء الطلب؛ يرجى إعادة المحاولة."
  ,order_update_conflict: "تعذّر حفظ التعديل بسبب تعارض في البيانات."
  ,invalid_pagination: "رقم الصفحة أو حجمها غير صالح."
  ,invalid_bl_number: "رقم بوليصة الشحن غير صالح."
  ,duplicate_bl_number: "رقم بوليصة الشحن مستخدم سابقاً ضمن شركتك."
  ,invalid_bl_type: "نوع بوليصة الشحن غير صالح."
  ,invalid_bl_status: "حالة مستند البوليصة غير صالحة."
  ,shipping_line_unavailable: "شركة الشحن غير موجودة ضمن حساب شركتك أو نوعها غير صحيح."
  ,invalid_shipment_dates: "تاريخ الوصول المتوقع يجب ألا يسبق تاريخ المغادرة."
  ,invalid_free_time: "مدة السماح يجب أن تكون بين صفر و180 يوماً."
  ,invalid_tracking_url: "رابط التتبع يجب أن يكون رابط HTTPS صالحاً."
  ,stale_shipment_revision: "تم تعديل البوليصة؛ أعد تحميل البيانات قبل الحفظ."
  ,invalid_container_number: "رقم الحاوية يجب أن يحتوي 3 أحرف ثم U ثم 7 أرقام."
  ,container_check_digit_unacknowledged: "رقم التحقق بالحاوية غير مطابق لمعيار ISO 6346. يرجى المراجعة والإقرار بالتحذير إذا كنت متأكداً."
  ,duplicate_container_number: "رقم الحاوية مستخدم ضمن البوليصة نفسها."
  ,invalid_container_size: "حجم الحاوية يجب أن يكون 20 أو 40 أو 40HC."
  ,invalid_container_status: "حالة الحاوية غير مدعومة."
  ,invalid_container_weights: "أوزان الحاوية غير منطقية أو تتجاوز الحدود."
  ,arrival_date_required: "أدخل تاريخ وصول الحاوية إلى الميناء."
  ,delivery_date_required: "أدخل تاريخ تسليم الحاوية."
  ,invalid_container_dates: "تواريخ الوصول أو التسليم أو Free Time غير متناسقة."
  ,container_status_reversal_not_supported: "لا يمكن الرجوع بحالة الحاوية للخلف دون مسار تصحيح موثق."
  ,stale_container_revision: "الحاوية عُدّلت من جلسة أخرى؛ أعد التحميل."
  ,only_planned_container_deletable: "لا يمكن حذف حاوية دخلت مراحل الشحن؛ يحتاج الأمر تصحيحاً موثقاً."
  ,invalid_clearance_status: "حالة التخليص غير صالحة."
  ,broker_unavailable: "المخلّص الجمركي غير موجود ضمن شركتك."
  ,clearance_release_date_required: "أدخل تاريخ الإفراج عند اختيار حالة مخلّص."
  ,invalid_clearance_dates: "تواريخ البيان الجمركي والإفراج غير متسقة."
  ,stale_clearance_revision: "سجل التخليص تغير؛ حدّث البيانات."
  ,order_has_shipments: "لا يمكن حذف طلب مرتبط ببوالص شحن."
  ,order_has_documents: "لا يمكن حذف طلب له مستندات مرفقة؛ أزل روابطها أولاً."
  ,order_changed_retry: "حدث تعديل متزامن للطلب؛ أعد المحاولة بعد تحديثه."
  ,multipart_required: "يجب إرسال الملف عبر نموذج رفع ملفات."
  ,document_file_required: "اختر ملفاً واحداً للرفع."
  ,unsupported_document_format: "صيغة الملف غير مدعومة. المسموح PDF أو JPG أو PNG فقط."
  ,invalid_document_size: "الملف فارغ أو أكبر من 25 MB."
  ,invalid_file_signature: "محتوى الملف لا يطابق نوعه. لا يكفي تغيير الامتداد."
  ,document_malware_detected: "تم رفض الملف لأنه يحتوي على مؤشرات أمنية خطرة. لا ترفع الملف مجدداً."
  ,scanner_unavailable: "فحص أمان الملفات غير متاح حالياً؛ لم يتم حفظ المستند. حاول لاحقاً."
  ,document_security_scan_required: "هذا المستند يحتاج فحص أمان قبل إتاحته."
  ,invalid_document_type: "نوع المستند غير صالح."
  ,invalid_document_notes: "ملاحظات المستند طويلة جداً."
  ,invalid_document_target: "جهة ربط المستند غير صالحة."
  ,invalid_document_targets: "اختر حاويات صالحة بحد أقصى 20 حاوية."
  ,exactly_one_document_target_kind: "حدد نطاقاً واحداً للربط: طلب أو بوليصة أو حاويات."
  ,document_target_not_found: "الجهة المحددة غير متاحة ضمن شركتك."
  ,bill_of_lading_cross_order: "ملف بوليصة الشحن لا يمكن ربطه بطلب أو بوليصة مختلفة."
  ,document_link_exists: "الملف مرتبط مسبقاً بهذه الجهة."
  ,document_link_conflict: "حصل تعارض أثناء إنشاء الربط؛ حدّث الصفحة."
  ,invalid_document_requirement: "نوع المتطلب أو مرحلته غير صالح."
  ,waiver_not_required: "لا يمكن استثناء مستند غير مطلوب."
  ,waiver_reason_required: "اكتب سبباً واضحاً للاستثناء الإداري، 8 أحرف على الأقل."
  ,waiver_exactly_one_target: "حدد سجلاً واحداً فقط للاستثناء."
  ,waiver_target_mismatch: "نوع السجل لا يطابق المتطلب."
  ,waiver_already_exists: "هناك استثناء ساري لهذا المتطلب."
  ,document_used_as_financial_evidence: "المستند مثبت كدليل لقيد مالي؛ لا يمكن حذفه أو إزالة ربطه بالطلب."
  ,invalid_payment_schedule: "راجع مبلغ خطة الدفع وتاريخ الاستحقاق ونوعه."
  ,invalid_transfer: "راجع مبلغ الحوالة وتاريخها والمرجع والمستفيد."
  ,invalid_order_expense: "المصروف يحتاج مبلغاً صالحاً ومستفيداً ووصفاً ومستنداً."
  ,invalid_payment_allocation: "راجع مبلغ التسوية والحوالة المرتبطة بالمصروف."
  ,invalid_transfer_correction: "راجع بيانات تصحيح الحوالة وسبب التصحيح."
  ,invalid_bank_return: "راجع بيانات المبلغ المسترد وسبب الاسترداد وإثباته."
  ,closure_reason_required: "اكتب سبباً موثّقاً لا يقل عن 8 أحرف."
  ,payment_proof_not_linked_to_order: "أرفق مستند إثبات دفع مرتبطاً بهذا الطلب نفسه."
  ,expense_evidence_not_linked_to_order: "أرفق مستند المصروف مرتبطاً بهذا الطلب نفسه."
  ,schedule_exceeds_commercial_amount: "مجموع خطة الدفع تجاوز قيمة بضاعة الطلب."
  ,idempotency_key_reused: "تم استخدام مفتاح العملية لبيانات مختلفة؛ حدّث الشاشة."
  ,payment_beneficiary_unavailable: "المستفيد غير موجود في دليل الشركات الخاص بك."
  ,expense_payee_mismatch: "مستفيد الحوالة لا يطابق مستفيد المصروف؛ لا يمكن اعتبار المصروف مدفوعاً."
  ,allocation_exceeds_available: "المبلغ يتجاوز المتاح بالحوالة أو المتبقي من المصروف."
  ,transfer_correction_requires_reconciliation: "الحوالة لها استرداد فعلي أو مصروف مسدّد؛ تحتاج معالجة مالية قبل تصحيح القيد."
  ,return_exceeds_unallocated_transfer: "لا يمكن استرداد أموال مسدّدة مسبقاً للبضاعة أو المصاريف."
  ,order_cancellation_requires_settlement: "الطلب مرتبط بوقائع مالية أو تشغيلية؛ لا يمكن إلغاؤه دون معالجة موثّقة."
  ,order_has_financial_records: "لا يمكن تغيير الطلب أو حذفه بعد تسجيل وقائع مالية."
  ,order_cannot_close: "حالة الطلب الحالية لا تسمح بالإغلاق."
  ,order_cannot_cancel: "هذا الطلب ليس مسودة قابلة للإلغاء."
  ,transfer_not_active: "الحوالة لم تعد فعّالة."
  ,transfer_already_voided: "تم إبطال القيد السابق لهذه الحوالة."
  ,order_cancelled: "الطلب ملغى ولا يقبل إضافة حوالات جديدة."
  ,invalid_tenant_onboarding: "راجع بيانات الشركة، بريد المدير، مدة الوصول، وسبب الإنشاء."
  ,tenant_slug_taken: "المعرّف مستخدم لشركة أخرى. اختر معرّفاً فريداً."
  ,stale_platform_revision: "تم تعديل هذه الشركة من جلسة أخرى. حدّث الصفحة قبل إعادة الإجراء."
  ,no_status_change: "حالة الشركة لم تتغير. حدّث البيانات قبل الحفظ."
  ,no_access_change: "مدة الوصول المختارة مطابقة للقيمة الحالية."
  ,reason_required: "العملية تحتاج سبباً موثّقاً لا يقل عن 8 أحرف."
  ,invalid_access_change: "تحقق من تاريخ انتهاء الوصول وسبب التعديل."
  ,cannot_disable_last_tenant_admin: "لا يمكن تعطيل آخر مدير نشط للشركة. فعّل مديراً بديلاً أولاً."
  ,invalid_manual_plan: "تحقق من اسم الباقة ومعرّفها ومدتها وسبب الإنشاء."
  ,manual_plan_code_taken: "معرّف هذه الباقة مستخدم مسبقاً."
  ,manual_plan_unchanged: "حالة الباقة لم تتغير."
  ,manual_plan_unavailable: "الباقة غير موجودة أو غير فعّالة. اختر باقة نشطة."
  ,invalid_manual_subscription: "اختر باقة واكتب سبباً موثّقاً للتعديل."
  ,manual_subscription_same_plan: "الاشتراك مربوط بالفعل بهذه الباقة. استخدم التجديد لتمديده."
  ,manual_subscription_not_renewable: "هذا الاشتراك غير قابل للتجديد. يجب أن يكون نشطاً ومحدّد المدة وباقته فعّالة."
  ,manual_subscription_already_ended: "الاشتراك منتهٍ بالفعل أو غير موجود."
  ,subscription_managed: "هذه الشركة مرتبطة باشتراك يدوي. استخدم إدارة الاشتراك بدل تعديل تاريخ الوصول مباشرة."
  ,tracking_invalid_type: "اختر رقم حاوية أو رقم بوليصة."
  ,tracking_invalid_number: "رقم التتبع غير صالح."
  ,tracking_invalid_container: "راجع صيغة رقم الحاوية ISO 6346."
  ,tracking_bl_must_match_shipment: "رقم البوليصة يجب أن يطابق البوليصة المحددة."
  ,tracking_container_not_in_shipment: "لا يمكن تتبع حاوية غير مسجلة ضمن هذه البوليصة. أضفها من تبويب البوليصة أولاً."
  ,tracking_reference_limit: "وصلت هذه البوليصة للحد الأقصى من مراجع التتبع."
  ,tracking_subscription_required: "لتفعيل تتبّع ShipsGo يلزم اشتراك فعّال مربوط بباقة."
  ,tracking_quota_disabled: "باقتك لا تتضمن تتبّع البوالص. تواصل مع مسؤول المنصة."
  ,tracking_quota_exceeded: "استهلكت العدد المسموح من البوالص في باقتك. جدد الاشتراك أو غيّر الباقة."
  ,tracking_activation_pending_review: "طلب التتبع السابق يحتاج مراجعة قبل إعادة إرساله لمنع خصم رصيد ShipsGo مرتين."
  ,tracking_provider_no_credits: "رصيد ShipsGo الخاص بالمنصة غير كافٍ."
  ,tracking_provider_invalid_reference: "رقم البوليصة أو شركة الشحن غير مقبولين لدى ShipsGo."
  ,tracking_provider_ambiguous_registration: "ShipsGo استلم طلباً لكن رقم تأكيده غير واضح؛ لن نكرره كي لا يتم الخصم مرتين."
  ,tracking_bl_change_requires_reconciliation: "لا يمكن تغيير رقم البوليصة بعد تفعيل التتبع المدفوع. اطلب مراجعة التتبع من مسؤول المنصة."
  ,platform_schema_upgrade_required: "قاعدة بيانات المنصة لم تُحدَّث بعد لإضافة حدود تتبّع البوالص. يلزم تطبيق ترحيلات قاعدة البيانات على الخادم من مسؤول النشر."
  ,tracking_invalid_carrier: "رمز شركة الشحن يجب أن يكون من حرفين إلى 12 حرفاً أو رقماً."
  ,tracking_reference_conflict: "رقم التتبع مسجل بالفعل. أعد تحميل البيانات."
  ,tracking_not_configured: "خدمة التتبع البحري غير مفعّلة على السيرفر."
  ,tracking_provider_auth_failed: "مفتاح مزوّد التتبع غير صالح أو غير مخوّل."
  ,tracking_provider_rate_limited: "انتهى حد الاستعلامات المسموح من شركة التتبع حالياً."
  ,tracking_provider_unavailable: "خدمة شركة التتبع غير متاحة. البيانات المحفوظة لم تتغير."
  ,tracking_provider_no_data: "لم يجد مزوّد التتبع بيانات لهذا الرقم بعد."
  ,tracking_provider_invalid_response: "أعاد مزوّد التتبع بيانات غير متوقعة."
  ,tracking_provider_timeout: "انتهت مهلة استجابة مزوّد التتبع."
  ,tracking_refresh_too_soon: "تم طلب تحديث قريباً. انتظر مدة التحديث قبل طلب استعلام جديد."
};
const InvitationIdentityErrors: Record<string, string> = {
  PasswordTooShort: "كلمة المرور قصيرة؛ الحد الأدنى 12 محرفاً.",
  PasswordRequiresDigit: "أضف رقماً واحداً على الأقل إلى كلمة المرور.",
  PasswordRequiresLower: "أضف حرفاً صغيراً واحداً على الأقل إلى كلمة المرور.",
  PasswordRequiresUpper: "أضف حرفاً كبيراً واحداً على الأقل إلى كلمة المرور.",
  PasswordRequiresNonAlphanumeric: "أضف رمزاً خاصاً مثل ! أو @ إلى كلمة المرور.",
  PasswordRequiresUniqueChars: "كلمة المرور تحتاج تنوعاً أكبر من المحارف.",
  DuplicateEmail: "هذا البريد مسجل مسبقاً؛ تواصل مع مدير الشركة.",
  DuplicateUserName: "هذا البريد مسجل مسبقاً؛ تواصل مع مدير الشركة.",
  InvalidEmail: "البريد المرتبط بالدعوة غير صالح؛ اطلب دعوة جديدة من المدير.",
  InvalidUserName: "البريد المرتبط بالدعوة غير مدعوم؛ تواصل مع المدير."
};
async function acquireCsrf(): Promise<string> {
  if (csrfValue) return csrfValue;
  let response: Response;
  try {
    response = await fetch(BASE + "/api/auth/csrf", { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new ImportApiError(0, "تعذّر الاتصال بالخادم. تحقق من تشغيل وثيقة.");
  }
  if (!response.ok) throw new ImportApiError(response.status, "تعذّر إنشاء رمز الحماية.");
  const data = await response.json() as { token: string };
  if (!data.token) throw new ImportApiError(500, "رمز الحماية غير متوفر.");
  csrfValue = data.token;
  return csrfValue;
}
export function resetImportCsrf() { csrfValue = null; }

export async function importApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-Wathiqa-CSRF", await acquireCsrf());
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      ...options, method, credentials: "same-origin", cache: "no-store", headers
    });
  } catch {
    throw new ImportApiError(0, "تعذّر الاتصال بالخادم. تحقق من تشغيل وثيقة.");
  }
  if (!response.ok) {
    let code: string | undefined;
    let details: string[] | undefined;
    try {
      const payload = await response.json() as { error?: string; details?: unknown };
      code = payload.error;
      if (Array.isArray(payload.details))
        details = payload.details.filter((x): x is string => typeof x === "string");
    } catch { /* no body */ }
    const identityMessages = code === "invalid_user_or_password"
      ? [...new Set((details || []).map(x => InvitationIdentityErrors[x]).filter(Boolean))]
      : [];
    const message = (identityMessages.length ? identityMessages.join(" ") : null) ||
      (code && ArabicErrors[code]) || ({
      400: "بيانات الطلب غير صالحة. راجع المدخلات.",
      401: "انتهت الجلسة أو لم تسجّل الدخول بعد.",
      403: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
      404: "العنصر المطلوب غير موجود أو غير متاح لك.",
      409: "حدث تعارض في البيانات؛ راجع آخر التغييرات.",
      413: "الملف كبير جداً؛ الحد الأقصى للمستند الواحد 25 MB.",
      429: "محاولات كثيرة. حاول مجدداً بعد دقيقة.",
      500: "حدث خطأ في الخادم. حاول لاحقاً."
    } as Record<number, string>)[response.status] || "تعذّر تنفيذ العملية.";
    if (code === "csrf_invalid") resetImportCsrf();
    throw new ImportApiError(response.status, message, code);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export const currentImportUser = () => importApi<CurrentImportUser>("/api/auth/me");
export const fetchImportCompanies = () => importApi<ImportCompany[]>("/api/companies");
export const fetchImportCompaniesPage = (params: URLSearchParams) =>
  importApi<ImportCompaniesPage>("/api/companies/search?" + params.toString());
export const fetchOrders = (params: URLSearchParams) =>
  importApi<OrdersPage>("/api/orders?" + params.toString());
export const fetchOrder = (id: string) =>
  importApi<PurchaseOrder>("/api/orders/" + encodeURIComponent(id));
