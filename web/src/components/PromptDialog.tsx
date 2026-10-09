import { useEffect, useId, useState } from 'react';
import { useUI } from '../state/ui';
import { Button, Modal } from './ui';

/** Diálogo de texto genérico (nombre de archivo, token…). */
export function PromptDialog() {
  const fieldId = useId();
  const prompt = useUI((s) => s.prompt);
  const close = useUI((s) => s.closePrompt);
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(prompt?.initial ?? '');
  }, [prompt]);
  return (
    <Modal
      open={!!prompt}
      onClose={() => close(null)}
      title={prompt?.title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button
            variant={prompt?.danger ? 'danger' : 'primary'}
            onClick={() => close(prompt?.confirm ? 'ok' : value)}
            disabled={!prompt?.confirm && !value.trim()}
            autoFocus={prompt?.confirm}
          >
            {prompt?.okLabel ?? 'Aceptar'}
          </Button>
        </>
      }
    >
      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt?.confirm) close('ok');
          else if (value.trim()) close(value);
        }}
      >
        {prompt?.label && <label htmlFor={prompt.confirm ? undefined : fieldId} className={prompt.confirm ? 'block text-[13px]' : 'mb-1 block text-[12px] text-muted'}>{prompt.label}</label>}
        {!prompt?.confirm && <input
          id={fieldId}
          autoFocus
          type={prompt?.password ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={prompt?.placeholder}
          className="h-8 w-full rounded-md border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-accent"
        />}
      </form>
    </Modal>
  );
}
