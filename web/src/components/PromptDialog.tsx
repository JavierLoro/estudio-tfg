import { useEffect, useId, useState } from 'react';
import { useUI } from '../state/ui';
import { Button, Input, Modal } from './ui';

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
          <Button variant="subtle" onClick={() => close(null)}>
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
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt?.confirm) close('ok');
          else if (value.trim()) close(value);
        }}
      >
        {prompt?.label && <label htmlFor={prompt.confirm ? undefined : fieldId} className={prompt.confirm ? 'block text-ui' : 'mb-1 block text-sm font-bold text-fg'}>{prompt.label}</label>}
        {!prompt?.confirm && <Input
          id={fieldId}
          autoFocus
          type={prompt?.password ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={prompt?.placeholder}
        />}
      </form>
    </Modal>
  );
}
