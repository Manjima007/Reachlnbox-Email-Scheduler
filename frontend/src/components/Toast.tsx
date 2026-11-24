import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface ToastState {
  message: string;
  kind: 'success' | 'error' | 'info';
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  const Icon = toast.kind === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className="fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl">
      <Icon size={18} className={toast.kind === 'error' ? 'text-rose-500' : 'text-emerald-500'} />
      <p className="text-sm text-slate-700">{toast.message}</p>
      <button onClick={onDismiss} className="ml-2 text-slate-400 hover:text-slate-700">
        <X size={15} />
      </button>
    </div>
  );
}
