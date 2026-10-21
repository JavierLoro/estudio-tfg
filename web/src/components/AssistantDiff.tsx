import { changedLines } from '../lib/assistant';

export function AssistantDiff({ before, after, undo }: { before: string; after: string; undo: boolean }) {
  const diff = changedLines(undo ? after : before, undo ? before : after);
  return <div className="mt-2 space-y-2 text-[13px]">
    <p>{diff.removed || diff.added ? `Fragmento sustituido desde la línea ${diff.line}: ${diff.removed} líneas antes y ${diff.added} después.` : 'Sin cambios.'}</p>
    {!!diff.removed && <div className="rounded border border-danger/40 bg-danger-bg p-2"><strong>− Fragmento anterior</strong><pre aria-label="Texto que se retira" className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{diff.before}</pre></div>}
    {!!diff.added && <div className="rounded border border-accent/40 bg-soft p-2"><strong>+ Fragmento nuevo</strong><pre aria-label="Texto que se añade" className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{diff.after}</pre></div>}
    <details><summary className="cursor-pointer">Comparar archivos completos</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><div><strong>Actual</strong><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-soft p-2">{undo ? after : before}</pre></div><div><strong>Resultado</strong><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-soft p-2">{undo ? before : after}</pre></div></div></details>
  </div>;
}
