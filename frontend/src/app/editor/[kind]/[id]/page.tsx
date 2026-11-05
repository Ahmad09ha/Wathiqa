"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowRight, Download, Save, FileText, FilePenLine, CheckCheck } from "lucide-react";
import Workspace from "@/components/Workspace";
import { useToast } from "@/components/ToastProvider";
import { API, RecordDetail, friendlyError, localizeTitle, request } from "@/lib/api";

const DocumentEditor = dynamic(() => import("@/components/DocumentEditor"), { ssr: false });

export default function EditPage({ params }: { params: Promise<{kind: string; id: string}> }) {
  const { kind, id } = use(params);
  const router = useRouter();
  const { notify } = useToast();
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedName, setSavedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const isTemplate = kind === "template";
  const collection = isTemplate ? "templates" : "documents";
  const dirty = name !== savedName || content !== savedContent;

  useEffect(() => {
    if (kind !== "template" && kind !== "document") {
      notify({ kind: "error", title: "رابط غير صالح", description: "نوع المستند المطلوب غير معروف." });
      setLoading(false);
      return;
    }
    let cancelled = false;
    request<RecordDetail>("/api/" + collection + "/" + id)
      .then(data => {
        if (cancelled) return;
        const title = localizeTitle(data.name);
        setRecord(data);
        setName(title);
        setSavedName(title);
        setContent(data.contentJson);
        setSavedContent(data.contentJson);
      })
      .catch(error => {
        if (!cancelled) notify({ kind: "error", title: "تعذّر فتح المستند", description: friendlyError(error) });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collection, id, kind, notify]);

  useEffect(() => {
    if (!dirty) return;
    const warning = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [dirty]);

  async function save() {
    if (!record || saving) return;
    if (!name.trim()) {
      notify({ kind: "error", title: "اسم المستند مطلوب", description: "أدخل اسماً واضحاً قبل الحفظ." });
      return;
    }
    setSaving(true);
    try {
      const result = await request<{revision?: number}>("/api/" + collection + "/" + id, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(), content: JSON.parse(content),
          expectedRevision: record.revision ?? null
        })
      });
      setRecord({ ...record, revision: result.revision ?? record.revision });
      setSavedContent(content);
      setSavedName(name);
      notify({ kind: "success", title: "تم حفظ التعديلات", description: "أصبح بإمكانك الرجوع للمستند في أي وقت." });
    } catch (error) {
      notify({ kind: "error", title: "تعذّر حفظ التعديلات", description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  }

  function exportXlsx() {
    if (!record) return;
    if (dirty) {
      notify({ kind: "error", title: "يوجد تعديل لم يُحفظ", description: "احفظ آخر التعديلات أولاً حتى يظهر أحدث محتوى في ملف Excel." });
      return;
    }
    window.location.href = API + "/api/" + collection + "/" + id + "/export/xlsx";
  }

  async function useTemplate() {
    if (!isTemplate) return;
    if (dirty) {
      notify({ kind: "error", title: "احفظ القالب أولاً", description: "هناك تعديلات غير محفوظة. احفظها قبل إنشاء نسخة جديدة." });
      return;
    }
    try {
      const data = await request<{id: string}>("/api/documents", {
        method: "POST",
        body: JSON.stringify({ templateId: id, name: name + " · نسخة جديدة" })
      });
      notify({ kind: "success", title: "تم إنشاء نسخة مستقلة", description: "أي تعديل على النسخة الجديدة لن يغيّر القالب." });
      router.push("/editor/document/" + data.id);
    } catch (error) {
      notify({ kind: "error", title: "تعذّر إنشاء المستند", description: friendlyError(error) });
    }
  }

  return (
    <Workspace
      title={isTemplate ? "تحرير القالب" : "تحرير المستند"}
      subtitle={isTemplate ? "عدّل القالب الأساسي ليكون جاهزاً للنسخ القادمة." : "مساحة خاصة لهذا المستند، مستقلة عن القالب الأصلي."}
      actions={
        <>
          <button type="button" className="btn btn-outline" onClick={() => router.push("/")}>
            <ArrowRight size={17}/> رجوع للمكتبة
          </button>
          {isTemplate && <button type="button" className="btn" onClick={() => void useTemplate()}>إنشاء مستند</button>}
          <button type="button" className="btn btn-outline" onClick={exportXlsx} disabled={!record}>
            <Download size={17}/> تصدير Excel
          </button>
          <button type="button" className="btn primary" disabled={saving || !dirty || !record} onClick={() => void save()}>
            <Save size={17}/> {saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </button>
        </>
      }
    >
      {loading ? <div className="loading-state">جارٍ تجهيز المستند...</div> :
        record ? (
          <>
            <div className="editor-identity">
              <div className="editor-identity-icon">{isTemplate ? <FilePenLine size={24}/> : <FileText size={24}/>}</div>
              <div className="editor-identity-fields">
                <label htmlFor="document-name">{isTemplate ? "اسم القالب" : "اسم المستند"}</label>
                <input id="document-name" className="editname" dir="auto" maxLength={160}
                  value={name} placeholder="اسم المستند" onChange={event => setName(event.target.value)}/>
              </div>
              <div className={"editor-save-status " + (dirty ? "unsaved" : "")}>
                {dirty ? <><span className="status-dot"/> تغييرات غير محفوظة</> :
                  <><CheckCheck size={17}/> جميع التعديلات محفوظة</>}
              </div>
            </div>
            <DocumentEditor initial={record.contentJson} onChange={setContent}/>
          </>
        ) : (
          <div className="empty"><strong>لم نتمكن من فتح المستند</strong><p>يمكنك العودة إلى المكتبة والمحاولة مجدداً.</p></div>
        )
      }
    </Workspace>
  );
}
