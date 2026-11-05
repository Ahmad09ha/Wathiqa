export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5088";

export interface TemplateSummary {
  id: string; name: string; description: string; sourceFormat: string; updatedAt: string;
}
export interface DocumentSummary {
  id: string; name: string; templateId: string | null; updatedAt: string; revision: number;
}
export interface RecordDetail {
  id: string; name: string; contentJson: string; revision?: number; templateId?: string | null;
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "حدث خطأ غير متوقع. يرجى المحاولة مجدداً.";
}

function errorFromResponse(status: number, backendMessage?: string): ApiError {
  const message = (backendMessage || "").toLowerCase();
  if (status === 409) return new ApiError("هناك تعديل أحدث على المستند. أعد فتحه وراجع التغييرات قبل الحفظ.", status);
  if (status === 404) return new ApiError("لم نتمكن من العثور على العنصر المطلوب. ربما تم حذفه.", status);
  if (status === 413 || message.includes("size") || message.includes("too large"))
    return new ApiError("حجم الملف أكبر من الحد المسموح (10 ميغابايت). اختر ملفاً أصغر.", status);
  if (message.includes("no extractable text"))
    return new ApiError("لم نجد نصوصاً قابلة للاستخراج. قد يكون ملف PDF صورة ممسوحة ضوئياً.", status);
  if (message.includes("unable to read"))
    return new ApiError("تعذّر قراءة الملف. تأكد أنه سليم وغير محمي بكلمة مرور.", status);
  if (message.includes("supported formats"))
    return new ApiError("الملفات المدعومة هي PDF وWord ‏(DOCX) وExcel ‏(XLSX) فقط.", status);
  if (message.includes("name"))
    return new ApiError("اسم القالب أو المستند غير صالح. يرجى إدخال اسم واضح.", status);
  if (message.includes("content must"))
    return new ApiError("محتوى المستند غير صالح للحفظ. جرّب إعادة فتحه.", status);
  if (status === 400) return new ApiError("تعذّر إكمال الطلب بسبب بيانات غير صالحة. راجع المدخلات.", status);
  if (status === 401 || status === 403) return new ApiError("ليس لديك صلاحية لتنفيذ هذا الإجراء.", status);
  if (status === 503) return new ApiError("الخدمة غير متاحة حالياً. تأكد من تشغيل قاعدة البيانات.", status);
  if (status >= 500) return new ApiError("حدث خلل في الخادم. حاول مرة أخرى بعد قليل.", status);
  return new ApiError("تعذّر تنفيذ الطلب. يرجى المحاولة مجدداً.", status);
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; detail?: string };
    throw errorFromResponse(response.status, body.error || body.detail);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, {
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers }
    });
  } catch {
    throw new ApiError("تعذّر الاتصال بالخادم. تأكد من تشغيل البرنامج وحاول مجدداً.", 0);
  }
  return unwrap<T>(response);
}

export async function importTemplate(file: File): Promise<{ id: string; extractedLines: number }> {
  const suffix = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "xlsx"].includes(suffix || "")) throw new ApiError("اختر ملف PDF أو Word ‏(DOCX) أو Excel ‏(XLSX).", 400);
  if (file.size > 10_000_000) throw new ApiError("حجم الملف يتجاوز 10 ميغابايت. اختر ملفاً أصغر.", 413);
  if (file.size === 0) throw new ApiError("الملف فارغ. اختر ملفاً يحتوي على بيانات.", 400);
  const data = new FormData();
  data.append("file", file);
  let response: Response;
  try {
    response = await fetch(API + "/api/templates/import", { method: "POST", body: data });
  } catch {
    throw new ApiError("تعذّر رفع الملف. تحقق من اتصالك بالخادم ثم حاول مجدداً.", 0);
  }
  return unwrap(response);
}

export const getTemplates = () => request<TemplateSummary[]>("/api/templates");
export const getDocuments = () => request<DocumentSummary[]>("/api/documents");

export function localizeTitle(name: string): string {
  return name
    .replace("Sales Contract · October 2026", "عقد بيع · أكتوبر 2026")
    .replace("Sales Contract · September 2026", "عقد بيع · سبتمبر 2026")
    .replace(" · New document", " · نسخة جديدة")
    .replace(" · Copy", " · نسخة");
}
export function localizeDescription(description: string, sourceFormat?: string): string {
  if (sourceFormat === "starter")
    return "قالب عقد بيع ثنائي اللغة، قابل لتعديل البنود والشروط والجداول.";
  if (description.includes("Imported file") || description.includes("Headers/field"))
    return "قالب مستورد من ملف، يرجى مراجعة الحقول المستخرجة قبل الاستخدام.";
  return description || "قالب قابل للتعديل والتخصيص حسب الحاجة.";
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ar-SY-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}
export function sourceLabel(format: string): string {
  const labels: Record<string, string> = { starter: "قالب أساسي", blank: "قالب خاص", pdf: "ملف PDF", docx: "ملف Word", xlsx: "ملف Excel" };
  return labels[format.toLowerCase()] || "قالب مستورد";
}
