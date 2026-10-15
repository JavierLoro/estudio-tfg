import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useUI } from '../state/ui';
import { Button, IconButton, cx } from './ui';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return createPortal(
    <div className="pointer-events-none fixed right-3 bottom-3 z-[1200] flex w-[360px] max-w-[calc(100vw-24px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-bg py-1 pr-1 pl-3 text-ui shadow-pop"
        >
          <span aria-hidden className={cx('mt-2 shrink-0', t.kind === 'ok' && 'text-ok', t.kind === 'error' && 'text-danger', t.kind === 'warn' && 'text-warn', t.kind === 'info' && 'text-info')}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertCircle size={16} /> : t.kind === 'warn' ? <AlertTriangle size={16} /> : <Info size={16} />}
          </span>
          <div className="min-w-0 flex-1 py-1.5 break-words">{t.text}</div>
          {t.action && (
            <Button
              size="sm"
              variant="subtle"
              className="text-accent!"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </Button>
          )}
          <IconButton label="Cerrar aviso" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </IconButton>
        </div>
      ))}
    </div>,
    document.body,
  );
}
