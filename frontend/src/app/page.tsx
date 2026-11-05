"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpLeft, CalendarDays, FilePlus2, FileText, FolderOpen, Plus, Trash2,
  Upload, Files, ChevronLeft, FileSpreadsheet
} from "lucide-react";
import Workspace from "@/components/Workspace";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import {
  DocumentSummary, TemplateSummary, getDocuments, getTemplates, formatDate,
  friendlyError, importTemplate, localizeDescription, localizeTitle, request, sourceLabel
} from "@/lib/api";

type Removal = { kind: "templates" | "documents"; id: string; name: string };

export default function Home() {
  const router = useRouter();
  const { notify } = useToast();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const createInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([getTemplates(), getDocuments()]);
      setTemplates(t);
      setDocuments(d);
    } catch (error) {
      notify({ kind: "error", title: "تعذّر تحميل المكتبة", description: friendlyError(error) });
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (creating) createInput.current?.focus(); }, [creating]);

  async function createBlank() {
    if (creatingBusy) return;
    setCreatingBusy(true);
    try {
      const response = await request<{id: string}>("/api/templates", {
        method: "POST", body: JSON.stringify({ name: name.trim() || "قالب جديد" })
      });
      notify({ kind: "success", title: "تم إنشاء القالب", description: "يمكنك الآن إضافة الحقول والجداول وتعديل شكل المستند." });
      router.push("/editor/template/" + response.id);
    } catch (error) {
      notify({ kind: "error", title: "تعذّر إنشاء القالب", description: friendlyError(error) });
    } finally {
      setCreatingBusy(false);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const response = await importTemplate(file);
      notify({ kind: "success", title: "اكتمل استيراد الملف", description: "تم استخراج الحقول. راجع المحتوى قبل استخدام القالب." });
      router.push("/editor/template/" + response.id);
    } catch (error) {
      notify({ kind: "error", title: "تعذّر استيراد الملف", description: friendlyError(error) });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function newDocument(template: TemplateSummary) {
    try {
      const response = await request<{id: string}>("/api/documents", {
        method: "POST", body: JSON.stringify({ templateId: template.id, name: localizeTitle(template.name) + " · نسخة جديدة" })
      });
      notify({ kind: "success", title: "نسختك جاهزة", description: "هذا المستند مستقل عن القالب الأصلي." });
      router.push("/editor/document/" + response.id);
    } catch (error) {
      notify({ kind: "error", title: "تعذّر إنشاء المستند", description: friendlyError(error) });
    }
  }

  async function confirmRemoval() {
    if (!removal || removing) return;
    setRemoving(true);
    try {
      await request<void>("/api/" + removal.kind + "/" + removal.id, { method: "DELETE" });
      notify({
        kind: "success",
        title: removal.kind === "templates" ? "تم حذف القالب" : "تم حذف المستند",
        description: removal.kind === "templates" ? "النسخ المستقلة التي أُنشئت منه ستبقى محفوظة." : undefined
      });
      setRemoval(null);
      await reload();
    } catch (error) {
      notify({ kind: "error", title: "تعذّر الحذف", description: friendlyError(error) });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Workspace
      title="مكتبة المستندات"
      subtitle="أنشئ قوالب مرنة، وحرّر مستنداتك واحتفظ بكل نسخة بشكل مستقل."
      actions={
        <>
          <input ref={input} type="file" hidden accept=".pdf,.docx,.xlsx"
            aria-label="اختيار ملف للاستيراد" onChange={event => void importFile(event.target.files?.[0])}/>
          <button type="button" className="btn btn-outline" disabled={uploading} onClick={() => input.current?.click()}>
            <Upload size={17} strokeWidth={1.8}/> {uploading ? "جارٍ الاستيراد..." : "استيراد ملف"}
          </button>
          <button type="button" className="btn primary" onClick={() => {
            setCreating(value => !value);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}>
            <Plus size={19} strokeWidth={1.9}/> قالب جديد
          </button>
        </>
      }
    >
      <div className="page-intro">
        <div><span className="eyebrow">مكتبتي / إدارة الملفات</span><p>كل مستند يبدأ من فكرة. احتفظ بقوالبك، وعدّل عليها بحرية.</p></div>
        <span className="intro-stamp"><FileSpreadsheet size={19}/> استوديو العقود</span>
      </div>

      {creating && (
        <div className="create-panel" role="region" aria-label="إضافة قالب جديد">
          <div className="create-panel-icon"><FilePlus2 size={22}/></div>
          <div className="create-panel-main">
            <h2>قالب جديد من الصفر</h2>
            <p>ابدأ بصفحة فارغة ثم أضف النصوص والحقول والجداول بالطريقة التي تناسبك.</p>
            <div className="create-form">
              <input className="field" ref={createInput} type="text" maxLength={160}
                placeholder="اكتب اسم القالب، مثلاً: عقد توريد"
                value={name} onChange={event => setName(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") void createBlank(); }}/>
              <button type="button" className="btn primary" disabled={creatingBusy} onClick={() => void createBlank()}>
                {creatingBusy ? "جارٍ الإنشاء..." : "إنشاء القالب"} <ArrowUpLeft size={16}/>
              </button>
              <button type="button" className="btn btn-text" onClick={() => setCreating(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <section className="library-section" id="templates" aria-labelledby="templates-title">
        <div className="section-head">
          <div className="section-heading"><span className="section-kicker">01 / الأساس</span><h2 className="section-title" id="templates-title">القوالب</h2><p>هياكل جاهزة يمكنك تعديلها أو إنشاء مستند جديد منها.</p></div>
          <div className="section-rule" aria-hidden="true" />
        </div>
        {isLoading ? <div className="loading-state">جارٍ تحميل القوالب...</div> :
          templates.length > 0 ?
          <div className="cards">
            {templates.map(template => (
              <article className="card" key={template.id}>
                <div className="card-top">
                  <span className="card-icon"><FileText size={22} strokeWidth={1.65}/></span>
                  <span className="card-source">{sourceLabel(template.sourceFormat)}</span>
                </div>
                <div className="card-copy">
                  <h3 dir="auto">{localizeTitle(template.name)}</h3>
                  <p>{localizeDescription(template.description, template.sourceFormat)}</p>
                </div>
                <div className="card-footer">
                  <button type="button" className="btn primary card-main-action" onClick={() => void newDocument(template)}>
                    استخدام القالب <ArrowUpLeft size={17}/>
                  </button>
                  <button type="button" className="btn card-secondary-action" onClick={() => router.push("/editor/template/" + template.id)}>
                    تعديل
                  </button>
                  <button type="button" className="icon-btn card-delete" aria-label={"حذف القالب " + localizeTitle(template.name)}
                    title="حذف القالب" onClick={() => setRemoval({ kind: "templates", id: template.id, name: localizeTitle(template.name) })}>
                    <Trash2 size={17}/>
                  </button>
                </div>
              </article>
            ))}
          </div> :
          <div className="empty">
            <FolderOpen size={28} strokeWidth={1.5}/>
            <strong>لا توجد قوالب بعد</strong>
            <p>أنشئ قالباً جديداً أو استورد ملفاً للبدء.</p>
          </div>
        }
      </section>

      <section className="library-section documents-section" id="documents" aria-labelledby="documents-title">
        <div className="section-head">
          <div className="section-heading"><span className="section-kicker">02 / الأرشيف</span><h2 className="section-title" id="documents-title">المستندات المحفوظة</h2><p>نسخك الخاصة محفوظة هنا ويمكن تعديل كل واحدة منها على حدة.</p></div>
          <div className="section-rule" aria-hidden="true" />
        </div>
        {isLoading ? <div className="loading-state">جارٍ تحميل المستندات...</div> :
          documents.length > 0 ?
          <div className="cards">
            {documents.map(document => (
              <article className="card document-card" key={document.id}>
                <div className="card-top">
                  <span className="card-icon"><Files size={22} strokeWidth={1.65}/></span>
                  <span className="card-source">نسخة محفوظة</span>
                </div>
                <div className="card-copy">
                  <h3 dir="auto">{localizeTitle(document.name)}</h3>
                  <p className="date-label"><CalendarDays size={15}/> آخر تعديل: {formatDate(document.updatedAt)}</p>
                </div>
                <div className="card-footer">
                  <button type="button" className="btn primary card-main-action" onClick={() => router.push("/editor/document/" + document.id)}>
                    فتح المستند <ChevronLeft size={17}/>
                  </button>
                  <span className="revision-label">إصدار {document.revision}</span>
                  <button type="button" className="icon-btn card-delete" title="حذف المستند"
                    aria-label={"حذف المستند " + localizeTitle(document.name)}
                    onClick={() => setRemoval({ kind: "documents", id: document.id, name: localizeTitle(document.name) })}>
                    <Trash2 size={17}/>
                  </button>
                </div>
              </article>
            ))}
          </div> :
          <div className="empty">
            <Files size={28} strokeWidth={1.5}/>
            <strong>مكتبة المستندات فارغة</strong>
            <p>اضغط «استخدام القالب» لإنشاء أول نسخة مستقلة.</p>
          </div>
        }
      </section>

      <ConfirmDialog
        open={Boolean(removal)}
        title={removal?.kind === "templates" ? "حذف هذا القالب؟" : "حذف هذا المستند؟"}
        description={removal?.kind === "templates"
          ? "سيُحذف القالب من المكتبة، لكن المستندات التي أنشأتها منه ستبقى محفوظة. لا يمكن التراجع عن الحذف."
          : "سيُحذف المستند نهائياً من المكتبة. لا يمكن التراجع عن هذا الإجراء."}
        pending={removing}
        onCancel={() => setRemoval(null)}
        onConfirm={() => void confirmRemoval()}
      />
    </Workspace>
  );
}
