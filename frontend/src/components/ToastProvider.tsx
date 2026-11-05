"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "error" | "success" | "info";
type ToastOptions = { kind: ToastKind; title: string; description?: string };
type Toast = ToastOptions & { id: number; closing: boolean };
type ToastContextType = { notify: (options: ToastOptions) => void };
const ToastContext = createContext<ToastContextType | null>(null);

function ToastItem({
  toast, dismiss, remove
}: { toast: Toast; dismiss: (id: number) => void; remove: (id: number) => void }) {
  useEffect(() => {
    if (!toast.closing) {
      const timer = window.setTimeout(() => dismiss(toast.id), toast.kind === "error" ? 6500 : 4300);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => remove(toast.id), 280);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.kind, toast.closing, dismiss, remove]);

  const Icon = toast.kind === "error" ? AlertCircle : toast.kind === "success" ? CheckCircle2 : Info;
  return (
    <div className={"toast-item " + toast.kind + (toast.closing ? " toast-exit" : "")}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}>
      <span className="toast-icon"><Icon size={20} strokeWidth={1.8} /></span>
      <div className="toast-copy">
        <strong>{toast.title}</strong>
        {toast.description && <p>{toast.description}</p>}
      </div>
      <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="إغلاق الإشعار" title="إغلاق">
        <X size={17} />
      </button>
      <span className="toast-timer" aria-hidden="true" />
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const notify = useCallback((options: ToastOptions) => {
    const id = ++idRef.current;
    setToasts(current => [...current.filter(t => !t.closing).slice(-2), { ...options, id, closing: false }]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts(current => current.map(t => t.id === id ? { ...t, closing: true } : t));
  }, []);
  const remove = useCallback((id: number) => {
    setToasts(current => current.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toast-stack" aria-label="إشعارات النظام" dir="rtl">
        {toasts.map(t => <ToastItem key={t.id} toast={t} dismiss={dismiss} remove={remove} />)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
