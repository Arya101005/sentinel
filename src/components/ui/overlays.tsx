import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Dialog                                                                      */
/* -------------------------------------------------------------------------- */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-6">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl outline-none sm:rounded-xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-navy-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */
type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const push = React.useCallback((toast: { title: string; description?: string; tone?: ToastTone }) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, title: toast.title, description: toast.description, tone: toast.tone ?? 'info' }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 6000);
  }, []);

  const value = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        role="status"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto animate-fade-in rounded-lg border bg-white p-3.5 shadow-lg',
              toast.tone === 'success' && 'border-emerald-200',
              toast.tone === 'error' && 'border-red-200',
              toast.tone === 'info' && 'border-sky-200',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
                  toast.tone === 'success' && 'bg-emerald-500',
                  toast.tone === 'error' && 'bg-red-500',
                  toast.tone === 'info' && 'bg-sky-500',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{toast.description}</p>}
              </div>
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
