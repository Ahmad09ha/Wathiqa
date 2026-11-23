"use client";
import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";

export default function ConfirmDialog({
  open, title, description, pending, onCancel, onConfirm
}: {
  open: boolean; title: string; description: string; pending?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel, pending]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
       <Card className="dialog gap-0 py-0" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
        <div className="dialog-top">
          <span className="dialog-icon"><AlertTriangle size={23} /></span>
           <Button type="button" variant="ghost" aria-label="إغلاق" className="icon-btn" onClick={onCancel} disabled={pending}><X size={19}/></Button>
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-desc">{description}</p>
        <div className="dialog-actions">
           <Button variant="outline" className="btn" type="button" ref={cancelRef} onClick={onCancel} disabled={pending}>إلغاء</Button>
           <Button variant="destructive" className="btn danger" type="button" onClick={onConfirm} disabled={pending}>{pending ? "جارٍ الحذف..." : "نعم، احذف"}</Button>
        </div>
      </Card>
    </div>
  );
}
