import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, OctagonX, TriangleAlert, X, type LucideIcon } from 'lucide-react';

// Componentes base de la interfaz. Alturas y texto siguen la densidad (variables --et-* de index.css);
// el foco visible lo da la regla global :focus-visible.

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** md: control normal (40/32 px según densidad); sm: barras de herramientas y filas (32/28 px). */
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-bold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-default',
    size === 'sm' ? 'h-(--et-control-sm) px-2.5 text-sm' : 'h-(--et-control) px-3.5 text-ui',
    variant === 'primary' && 'bg-accent text-accent-fg enabled:hover:bg-accent-hover',
    variant === 'secondary' && 'border border-line-strong bg-bg text-fg enabled:hover:bg-hover',
    variant === 'subtle' && 'text-fg enabled:hover:bg-hover',
    variant === 'danger' && 'border border-danger bg-bg text-danger enabled:hover:bg-danger-bg',
  );
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: BtnProps) {
  return <button type="button" {...rest} className={cx(buttonClass(variant, size), className)} />;
}

export function IconButton({
  label,
  className,
  children,
  active,
  variant = 'subtle',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  /** subtle: sin borde (barras); secondary: con borde, junto a botones secundarios; danger: acción destructiva. */
  variant?: 'subtle' | 'secondary' | 'danger';
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        // Área de pulsación ≥ 32 px en cualquier densidad.
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors enabled:hover:bg-hover disabled:opacity-40',
        variant === 'secondary' ? 'size-(--et-control) border border-line-strong bg-bg text-fg' : 'size-(--et-icon-btn) min-h-8 min-w-8',
        variant === 'subtle' && (active ? 'bg-active text-accent' : 'text-muted enabled:hover:text-fg'),
        variant === 'danger' && 'text-danger enabled:hover:bg-danger-bg',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------- Campos ----------

const fieldBase =
  'min-w-0 rounded-md border border-line-strong bg-bg text-fg placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-danger';

/** Ancho completo salvo que quien lo usa fije otro (w-…, flex-1, size-…). */
const fullWidth = (className?: string) => (/(^|\s)(w-|flex-1|size-)/.test(className ?? '') ? '' : 'w-full');

export function inputClass(size: 'sm' | 'md' = 'md', className?: string) {
  return cx(fieldBase, fullWidth(className), size === 'sm' ? 'h-(--et-control-sm) px-2 text-sm' : 'h-(--et-control) px-3 text-ui', className);
}

export function Input({
  className,
  inputSize = 'md',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'sm' | 'md'; ref?: Ref<HTMLInputElement> }) {
  return <input {...rest} className={inputClass(inputSize, className)} />;
}

export function Select({
  className,
  inputSize = 'md',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: 'sm' | 'md'; ref?: Ref<HTMLSelectElement> }) {
  return <select {...rest} className={inputClass(inputSize, cx('pr-1', className))} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...rest} className={cx(fieldBase, fullWidth(className), 'px-3 py-2 text-ui leading-normal', className)} />;
}

/** Etiqueta + control + ayuda + error. El control (hijo único) recibe id y aria-describedby. */
export function Field({
  label,
  help,
  error,
  children,
  className,
  id: idProp,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactElement;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const id = idProp ?? (child.props.id as string | undefined) ?? auto;
  const helpId = help ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const described = [child.props['aria-describedby'], helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-bold text-fg">
        {label}
      </label>
      {isValidElement(child)
        ? cloneElement(child, { id, 'aria-describedby': described, 'aria-invalid': error ? true : child.props['aria-invalid'] })
        : child}
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1 text-sm text-danger">
          <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

// ---------- Estado ----------

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const TONE_ICON: Record<Tone, LucideIcon> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  danger: OctagonX,
  info: Info,
  neutral: Info,
};

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok-bg text-ok',
  warn: 'border-warn/40 bg-warn-bg text-warn',
  danger: 'border-danger/40 bg-danger-bg text-danger',
  info: 'border-info/40 bg-info-bg text-info',
  neutral: 'border-line bg-soft text-muted',
};

/** Etiqueta de estado: siempre icono + texto (nunca solo color). */
export function StatusPill({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      title={title}
      className={cx('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px text-xs font-bold whitespace-nowrap', TONE_CLASS[tone], className)}
    >
      {icon ?? <Icon size={13} className="shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}
export const Badge = StatusPill;

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="et-spin inline-block shrink-0 rounded-full border-2 border-current border-t-transparent"
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
          <div className="flex h-(--et-toolbar) shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
            <div id={titleId} className="text-base font-bold">
              {title}
            </div>
            <IconButton label="Cerrar" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
    </dialog>,
    document.body,
  );
}

/** Aviso con icono. Por defecto, franja a lo ancho del panel; `inline` lo dibuja como recuadro. */
export function Banner({
  kind,
  children,
  actions,
  inline,
  className,
}: {
  kind: 'warn' | 'danger' | 'info' | 'ok';
  children: ReactNode;
  actions?: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  const Icon = TONE_ICON[kind];
  return (
    <div
      role={kind === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm',
        inline ? 'rounded-md border' : 'border-b',
        kind === 'warn' && 'border-warn/40 bg-warn-bg text-fg',
        kind === 'danger' && 'border-danger/40 bg-danger-bg text-fg',
        kind === 'info' && 'border-info/40 bg-info-bg text-fg',
        kind === 'ok' && 'border-ok/40 bg-ok-bg text-fg',
        className,
      )}
    >
      <Icon
        size={16}
        aria-hidden
        className={cx('mt-0.5 shrink-0', kind === 'warn' ? 'text-warn' : kind === 'danger' ? 'text-danger' : kind === 'ok' ? 'text-ok' : 'text-info')}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** Estado vacío: icono, frase y, si la hay, una acción. */
export function EmptyState({ icon, children, action, className }: { icon?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-muted', className)}>
      {icon && <span className="text-muted" aria-hidden>{icon}</span>}
      <div>{children}</div>
      {action}
    </div>
  );
}
export const Empty = EmptyState;

export function Card({ title, actions, children, className, ...rest }: HTMLAttributes<HTMLElement> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <section {...rest} className={cx('rounded-lg border border-line bg-bg', className)}>
      {(title || actions) && (
        <header className="flex min-h-(--et-toolbar) items-center justify-between gap-2 border-b border-line px-4 py-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Pestañas accesibles (role=tablist): flechas, Inicio y Fin mueven la selección. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  idPrefix,
}: {
  tabs: { id: T; label: ReactNode; icon?: ReactNode; title?: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  /** Si se da, cada pestaña controla el panel `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx('flex items-stretch gap-1 border-b border-line', className)}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={t.title}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'et-focus-inset -mb-px inline-flex h-(--et-control) items-center gap-1.5 border-b-2 px-3 text-sm font-bold transition-colors',
              selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Grupo de opciones excluyentes (radios nativos con aspecto de botones segmentados). */
export function ChoiceGroup<T extends string>({
  legend,
  help,
  name,
  value,
  options,
  onChange,
}: {
  legend: ReactNode;
  help?: ReactNode;
  name: string;
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
}) {
  const helpId = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={help ? helpId : undefined}>
      <legend className="mb-1.5 text-sm font-bold text-fg">{legend}</legend>
      <div className="inline-flex w-fit flex-wrap rounded-md border border-line-strong bg-bg p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.hint}
            className={cx(
              'relative inline-flex h-(--et-control-sm) cursor-pointer items-center rounded px-3 text-ui select-none',
              'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
              o.value === value ? 'bg-accent font-bold text-accent-fg' : 'text-fg hover:bg-hover',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
    </fieldset>
  );
}
