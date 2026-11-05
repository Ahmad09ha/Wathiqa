"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useState } from "react";
import {
  Bold, Italic, Undo2, Redo2, List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Table2, Plus, Trash2, Heading1, Heading2, ArrowUp, ArrowDown, Minus, GripHorizontal
} from "lucide-react";

type Props = { initial: string; onChange: (json: string) => void };
type ToolProps = {
  label: string; active?: boolean; disabled?: boolean;
  action: () => void; children: React.ReactNode;
};

function Tool({ label, active = false, disabled = false, action, children }: ToolProps) {
  return (
    <button type="button" className={"tool " + (active ? "on" : "")} title={label} aria-label={label}
      aria-pressed={active} onClick={action} disabled={disabled}
      onMouseDown={event => event.preventDefault()}>
      {children}
    </button>
  );
}

export default function DocumentEditor({ initial, onChange }: Props) {
  const [ready, setReady] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TableKit.configure({ table: { resizable: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] })
    ],
    content: JSON.parse(initial),
    editorProps: {
      attributes: { class: "document-content", spellcheck: "true", dir: "auto" }
    },
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON()))
  });

  useEffect(() => {
    if (editor && !ready) {
      editor.commands.setContent(JSON.parse(initial));
      setReady(true);
    }
  }, [editor, ready, initial]);

  if (!editor) return <div className="paper editor-loading">جارٍ تجهيز أدوات التحرير...</div>;

  const isTable = editor.isActive("table");
  function moveBlock(direction: number) {
    const documentNode = editor?.state.doc;
    if (!editor || !documentNode) return;
    const selection = editor.state.selection.from;
    let index = -1, offset = 0;
    for (let i = 0; i < documentNode.childCount; i++) {
      const child = documentNode.child(i);
      if (selection >= offset && selection <= offset + child.nodeSize) { index = i; break; }
      offset += child.nodeSize;
    }
    const other = index + direction;
    if (index < 0 || other < 0 || other >= documentNode.childCount) return;
    const json = editor.getJSON();
    if (!json.content) return;
    [json.content[index], json.content[other]] = [json.content[other], json.content[index]];
    editor.commands.setContent(json);
    editor.commands.focus();
  }

  return (
    <div className="editor-shell">
      <div className="toolbar" role="toolbar" aria-label="أدوات تنسيق المستند" data-lenis-prevent>
        <div className="toolbar-group">
          <Tool label="تراجع" action={() => editor.chain().focus().undo().run()}><Undo2 size={17}/></Tool>
          <Tool label="إعادة" action={() => editor.chain().focus().redo().run()}><Redo2 size={17}/></Tool>
        </div>
        <div className="tool-sep" />
        <div className="toolbar-group">
          <Tool label="عنوان رئيسي" active={editor.isActive("heading", { level: 1 })} action={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={19}/></Tool>
          <Tool label="عنوان فرعي" active={editor.isActive("heading", { level: 2 })} action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={19}/></Tool>
          <Tool label="عريض" active={editor.isActive("bold")} action={() => editor.chain().focus().toggleBold().run()}><Bold size={17}/></Tool>
          <Tool label="مائل" active={editor.isActive("italic")} action={() => editor.chain().focus().toggleItalic().run()}><Italic size={17}/></Tool>
        </div>
        <div className="tool-sep" />
        <div className="toolbar-group">
          <Tool label="قائمة نقطية" active={editor.isActive("bulletList")} action={() => editor.chain().focus().toggleBulletList().run()}><List size={17}/></Tool>
          <Tool label="قائمة مرقمة" active={editor.isActive("orderedList")} action={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={17}/></Tool>
          <Tool label="محاذاة لليسار" action={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={17}/></Tool>
          <Tool label="توسيط" action={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={17}/></Tool>
          <Tool label="محاذاة لليمين" action={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={17}/></Tool>
        </div>
        <div className="tool-sep" />
        <div className="toolbar-group">
          <Tool label="إضافة جدول (3×3)" action={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <Table2 size={17}/> <span className="tool-word">جدول</span>
          </Tool>
          {isTable && <>
            <Tool label="إضافة صف بالأسفل" action={() => editor.chain().focus().addRowAfter().run()}><Plus size={15}/><span className="tool-word">صف</span></Tool>
            <Tool label="إضافة عمود بعد الحالي" action={() => editor.chain().focus().addColumnAfter().run()}><Plus size={15}/><span className="tool-word">عمود</span></Tool>
            <Tool label="حذف الصف" action={() => editor.chain().focus().deleteRow().run()}><Minus size={15}/><span className="tool-word">صف</span></Tool>
            <Tool label="حذف العمود" action={() => editor.chain().focus().deleteColumn().run()}><Minus size={15}/><span className="tool-word">عمود</span></Tool>
            <Tool label="حذف الجدول" action={() => editor.chain().focus().deleteTable().run()}><Trash2 size={16}/></Tool>
          </>}
        </div>
        <div className="tool-sep"/>
        <div className="toolbar-group">
          <Tool label="تحريك القسم للأعلى" action={() => moveBlock(-1)}><ArrowUp size={17}/></Tool>
          <Tool label="تحريك القسم للأسفل" action={() => moveBlock(1)}><ArrowDown size={17}/></Tool>
        </div>
      </div>
      <div className="paper-frame">
        <div className="paper-label"><GripHorizontal size={16}/> مساحة التحرير</div>
        <div className="paper"><EditorContent editor={editor}/></div>
      </div>
      <p className="hint">اضغط داخل أي نص لتعديله، أو داخل خلية جدول لإضافة صفوف وأعمدة. يمكنك نقل القسم الحالي بأسهم شريط الأدوات.</p>
    </div>
  );
}
