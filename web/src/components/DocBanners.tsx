import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  discardDraft,
  indicatorOf,
  keepMine,
  loadDisk,
  loadDoc,
  restoreDraft,
  saveDoc,
  useDocs,
  type DocIndicator,
} from '../state/docs';
import type { EditorLang } from '../lib/editor';
import { formatDate } from '../lib/paths';
import { ReadOnlyEditor } from './CodeEditor';
import { Banner, Button, Modal, Spinner, cx } from './ui';

const LABEL: Record<DocIndicator, string> = {
  guardado: 'Guardado',
  'sin guardar': 'Sin guardar',
  conflicto: 'Conflicto',
  guardando: 'Guardando…',
  cargando: 'Cargando…',
  error: 'Error',
};

export function indicatorColor(i: DocIndicator) {
  switch (i) {
    case 'guardado':
      return 'bg-ok';
    case 'sin guardar':
      return 'bg-warn';
    case 'conflicto':
    case 'error':
      return 'bg-danger';
    default:
      return 'bg-faint';
  }
}

export function SaveIndicator({ docKey, compact }: { docKey: string; compact?: boolean }) {
  const ind = useDocs((s) => indicatorOf(s.docs[docKey]));
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" title={LABEL[ind]} aria-label={`Estado: ${LABEL[ind]}`}>
      {ind === 'guardando' ? <Spinner size={9} /> : <span className={cx('inline-block h-2 w-2 rounded-full', indicatorColor(ind))} />}
      {!compact && <span>{LABEL[ind]}</span>}
    </span>
  );
}

/** Avisos del documento: error de carga, borrador recuperable, eliminado, conflicto. */
export function DocBanners({ docKey, lang }: { docKey: string; lang: EditorLang }) {
  const doc = useDocs((s) => s.docs[docKey]);
  const [dialog, setDialog] = useState<null | 'ask' | 'both'>(null);
  const conflictId = doc?.conflict ? `${doc.conflict.source}:${doc.conflict.rev}` : null;
  // Un 409 al guardar abre el diálogo directamente.
  useEffect(() => {
    if (conflictId?.startsWith('save:')) setDialog('ask');
    if (!conflictId) setDialog(null);
  }, [conflictId]);
  if (!doc) return null;
  const close = () => setDialog(null);
  const mine = () => {
    close();
    void keepMine(docKey);
  };
  const disk = () => {
    close();
    loadDisk(docKey);
  };

  return (
    <>
      {doc.status === 'error' && (
        <Banner kind="danger" actions={<Button onClick={() => loadDoc(doc.root, doc.path)}>Reintentar</Button>}>
          No se pudo abrir «{doc.path}»: {doc.error}
        </Banner>
      )}
      {doc.draftOffer && (
        <Banner
          kind="warn"
          actions={
            <>
              <Button variant="primary" onClick={() => restoreDraft(docKey)}>
                Restaurar borrador
              </Button>
              <Button onClick={() => discardDraft(docKey)}>Descartar</Button>
            </>
          }
        >
          Hay un borrador local sin guardar ({formatDate(doc.draftOffer.savedAt)}) distinto del archivo en disco.
        </Banner>
      )}
      {doc.deleted && !doc.conflict && (
        <Banner kind="warn" actions={<Button onClick={() => saveDoc(docKey)}>Guardar de nuevo</Button>}>
          Este archivo se ha eliminado del disco. Tu contenido sigue aquí.
        </Banner>
      )}
      {doc.conflict && (
        <Banner
          kind="danger"
          actions={
            <>
              <Button variant="primary" onClick={mine}>
                Quedarme con lo mío
              </Button>
              <Button onClick={disk}>Cargar lo del disco</Button>
              <Button onClick={() => setDialog('both')}>Ver ambos</Button>
            </>
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle size={13} />
            {doc.conflict.source === 'save'
              ? 'El archivo cambió en disco desde que lo abriste; no se ha guardado.'
              : 'El archivo cambió en disco mientras tenías cambios sin guardar.'}
          </span>
        </Banner>
      )}
      <Modal
        open={dialog === 'ask' && !!doc.conflict}
        onClose={close}
        title="Conflicto al guardar"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog('both')}>
              Ver ambos
            </Button>
            <Button onClick={disk}>Cargar lo del disco</Button>
            <Button variant="primary" onClick={mine} autoFocus>
              Quedarme con lo mío
            </Button>
          </>
        }
      >
        <div className="space-y-2 p-4 text-[13px] leading-relaxed">
          <p>
            «{doc.path}» ha cambiado en disco (otro dispositivo, Syncthing u otro programa) desde que lo abriste. No se ha
            sobrescrito nada.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li><b className="text-fg">Quedarme con lo mío</b>: guarda tu versión encima (la anterior queda en el historial del servidor).</li>
            <li><b className="text-fg">Cargar lo del disco</b>: descarta tus cambios locales.</li>
            <li><b className="text-fg">Ver ambos</b>: compara las dos versiones lado a lado.</li>
          </ul>
        </div>
      </Modal>
      <Modal
        open={dialog === 'both' && !!doc.conflict}
        onClose={close}
        title={`Comparar «${doc.path}»`}
        width="min(1200px, 96vw)"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cerrar
            </Button>
            <Button onClick={disk}>Cargar lo del disco</Button>
            <Button variant="primary" onClick={mine}>
              Quedarme con lo mío
            </Button>
          </>
        }
      >
        {doc.conflict && (
          <div className="grid h-[65vh] grid-cols-2 divide-x divide-line">
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-line bg-soft px-3 py-1 text-[11px] font-semibold text-muted">Lo mío (editor)</div>
              <ReadOnlyEditor content={doc.content} lang={lang} />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-line bg-soft px-3 py-1 text-[11px] font-semibold text-muted">
                En disco (rev {doc.conflict.rev})
              </div>
              <ReadOnlyEditor content={doc.conflict.content} lang={lang} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
