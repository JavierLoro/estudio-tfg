import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'default', size = 'sm', className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50',
        size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'default' && 'border border-line-strong bg-bg text-fg hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger-bg',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
        active && 'bg-active text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="et-spin inline-block rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}

const modalStack: HTMLDialogElement[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
  footer,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number | string;
  footer?: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const generatedId = useId();
  const titleId = labelledBy ?? generatedId;
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    modalStack.push(dialog);
    const initial = dialog.querySelector<HTMLElement>('[autofocus], input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)');
    initial?.focus();
    return () => {
      modalStack.splice(modalStack.indexOf(dialog), 1);
      dialog.close();
      // El invocador puede desaparecer al guardar, mover o cerrar un diálogo padre.
      if (previous?.isConnected && previous.getClientRects().length && !previous.closest('dialog:not([open]), [inert]') && !previous.matches(':disabled')) previous.focus();
      else {
        const remaining = modalStack.at(-1);
        (remaining?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? document.querySelector<HTMLElement>('#root button:not(:disabled)'))?.focus();
      }
    };
  }, [open]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog || modalStack.at(-1) !== dialog) return;
    // Deshabilitar el botón pulsado puede mandar el foco a body durante una operación.
    const active = document.activeElement;
    if (dialog.contains(active) && !(active as HTMLElement)?.matches(':disabled')) return;
    const target = [...dialog.querySelectorAll<HTMLElement>('input, textarea, select, button, [tabindex]')]
      .find((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
    (target ?? dialog).focus();
  });
  if (!open) return null;
  return createPortal(
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={title != null ? titleId : undefined}
      aria-label={title == null ? 'Diálogo' : undefined}
      className="et-modal fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-fg"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => {
        // Los atajos globales no deben operar sobre el fondo mientras se edita un diálogo.
        e.stopPropagation();
        if (e.key !== 'Tab') return;
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]')]
          .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && !el.closest('[inert]'));
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { e.preventDefault(); e.currentTarget.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === e.currentTarget)) { e.preventDefault(); first.focus(); }
      }}
    >
    <div
      className="flex h-full items-start justify-center bg-black/30 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-pop"
        style={{ width }}
      >
        {title != null && (
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
            <div id={titleId} className="text-[13px] font-semibold">
              {title}
            </div>
            <IconButton label="Cerrar" onClick={onClose}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-3 py-2">{footer}</div>}
      </div>
    </div>
    </dialog>,
    document.body,
  );
}

export function Banner({
  kind,
  children,
  actions,
}: {
  kind: 'warn' | 'danger' | 'info';
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      role={kind === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-[12px]',
        kind === 'warn' && 'border-warn/30 bg-warn-bg text-warn',
        kind === 'danger' && 'border-danger/30 bg-danger-bg text-danger',
        kind === 'info' && 'border-line bg-soft text-muted',
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] text-faint">{children}</div>;
}
