import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useUI } from '../state/ui';
import { cx } from './ui';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return createPortal(
    <div className="pointer-events-none fixed right-3 bottom-3 z-[1200] flex w-[360px] max-w-[calc(100vw-24px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-bg px-3 py-2 text-[12.5px] shadow-pop"
        >
          <span className={cx('mt-0.5 shrink-0', t.kind === 'ok' && 'text-ok', t.kind === 'error' && 'text-danger', t.kind === 'warn' && 'text-warn', t.kind === 'info' && 'text-accent')}>
            {t.kind === 'ok' ? <CheckCircle2 size={14} /> : t.kind === 'error' ? <AlertCircle size={14} /> : t.kind === 'warn' ? <AlertTriangle size={14} /> : <Info size={14} />}
          </span>
          <div className="min-w-0 flex-1 break-words">{t.text}</div>
          {t.action && (
            <button
              type="button"
              className="shrink-0 font-semibold text-accent hover:underline"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Cerrar aviso" className="shrink-0 text-faint hover:text-fg" onClick={() => dismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
