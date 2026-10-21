import { useState } from 'react';
import { assistantRequest, scopeSummary, useAssistant, useAssistantPermissions, type AssistantThread } from '../state/assistant';
import { useDocs } from '../state/docs';
import { useUI } from '../state/ui';
import { errorMessage } from '../api';
import { Button } from './ui';
import { DirPicker } from './DirPicker';
import { relUnder } from '../lib/abspath';
import { useSettings } from '../state/settings';

export function AssistantPermissions() {
  const { permissions, setPermissions } = useAssistantPermissions();
  const thread = useAssistant(s => s.thread);
  const account = useAssistant(s => s.account?.active);
  const docs = useDocs(s => s.docs);
  const status = useUI(s => s.status), settings = useSettings(s => s.data);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revoke = async () => {
    if (!thread) return;
    setBusy(true); setError('');
    try {
      const value = await assistantRequest<AssistantThread>(`/threads/${thread.id}/revoke`, {});
      if (value.account === useAssistant.getState().account?.active && value.instance === useUI.getState().status?.instanceId && useAssistant.getState().thread?.id === value.id) useAssistant.setState({ thread: value });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const available = [...Object.values(docs).filter(d => d.status === 'ready' && /\.(tex|md|bib|txt|mmd)$/i.test(d.path)), ...permissions.documents]
    .filter((d, i, all) => all.findIndex(other => other.root === d.root && other.path === d.path) === i);
  return <section aria-label="Permisos del asistente" className="space-y-3 rounded-lg border border-line bg-bg p-3 text-[13px]">
    {thread && <div className="space-y-2 border-b border-line pb-3"><h2 className="font-semibold">Esta conversación</h2>
      <p>{scopeSummary(thread.scope)} · {thread.scope.prepareChanges ? 'puede preparar cambios' : 'solo consulta'}.</p>
      {!!thread.scope.documents?.length && <ul className="break-all text-muted">{thread.scope.documents.map(d => <li key={`${d.root}:${d.path}`}>{d.root === 'memoria' ? 'Memoria' : 'Notas'} · {d.path}</li>)}</ul>}
      {thread.permissionsOutdated && <p className="text-warn">Permisos anteriores: inicia una conversación nueva para consultar o preparar cambios. Este historial se conserva para su consulta y recuperación local.</p>}
      {thread.revoked ? <p role="status" className="text-muted">Acceso retirado. Esta conversación ya no puede consultar fuentes ni aplicar propuestas. El historial y la revisión para deshacer cambios guardados siguen disponibles localmente.</p> : <><p className="text-muted">Retirar acceso detiene la consulta y bloquea nuevos envíos y aplicación de propuestas. No retira lo ya enviado a OpenAI ni revierte archivos guardados; estos pueden deshacerse tras revisión.</p><Button disabled={busy} onClick={() => void revoke()}>Retirar acceso de esta conversación</Button></>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>}
    <h2 className="font-semibold">Próximas conversaciones</h2>
    <p className="text-muted">Estos controles no cambian el chat actual. Para usar otros permisos, pulsa «Nueva conversación» en el asistente.</p>
    <h2 className="font-semibold">Qué puede consultar</h2>
    <p className="text-muted">Las fuentes que el agente consulte se envían a OpenAI. Elige documentos o ámbitos completos; PDF e imágenes y preparar cambios requieren permisos separados. Solo actúa cuando envías un mensaje.</p>
    <p className="text-muted">Estos permisos se usan al iniciar una conversación nueva y se conservan durante esta sesión para la cuenta y el proyecto actuales. Las conversaciones existentes mantienen sus permisos originales.</p>
    {!account && <p className="text-warn">Conecta una cuenta de ChatGPT antes de elegir sus permisos.</p>}
    <fieldset disabled={!account} className="space-y-3 disabled:opacity-60">
      <legend className="sr-only">Fuentes para conversaciones nuevas</legend>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.memoria} onChange={e => setPermissions({ memoria: e.target.checked })} />Memoria actual (diagramas aparte)</label>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.diagrams} onChange={e => setPermissions({ diagrams: e.target.checked })} />Consultar diagramas</label>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.library} onChange={e => setPermissions({ library: e.target.checked })} />Fichas y metadatos de Biblioteca</label>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.allNotes} onChange={e => setPermissions({ allNotes: e.target.checked })} />Todas las notas (la Biblioteca se autoriza aparte)</label>
      {!permissions.allNotes && <div className="space-y-2"><Button disabled={!status?.notesDir} onClick={() => setPicker(true)}>Elegir carpeta de notas…</Button>
        <ul>{permissions.folders.split('\n').filter(Boolean).map((dir, i) => <li key={i} className="flex items-center gap-2"><span className="min-w-0 break-all">{dir}</span><Button aria-label={`Retirar carpeta ${dir}`} onClick={() => setPermissions({ folders: permissions.folders.split('\n').filter(value => value !== dir).join('\n') })}>Retirar</Button></li>)}</ul>
        <details><summary className="cursor-pointer">Introducir rutas manualmente</summary><label className="mt-2 block">Carpetas de notas permitidas, relativas al vault (una por línea)<textarea aria-label="Carpetas de notas permitidas" rows={3} value={permissions.folders} onChange={e => setPermissions({ folders: e.target.value })} className="mt-1 block w-full rounded border border-line bg-bg p-2 font-mono" placeholder="Investigación" /></label></details>
      </div>}
      <details><summary className="cursor-pointer">Elegir archivos abiertos concretos</summary><div className="mt-2 space-y-2">
        {!available.length && <p className="text-muted">Abre un documento en la aplicación para poder elegirlo aquí.</p>}
        {available.map(d => <label key={`${d.root}:${d.path}`} className="flex gap-2 break-all"><input type="checkbox" checked={permissions.documents.some(item => item.root === d.root && item.path === d.path)} onChange={e => setPermissions({ documents: e.target.checked ? [...permissions.documents, { root: d.root, path: d.path }] : permissions.documents.filter(item => item.root !== d.root || item.path !== d.path) })} />{d.root === 'memoria' ? 'Memoria' : 'Notas'} · {d.path}</label>)}
      </div></details>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.attachments} onChange={e => setPermissions({ attachments: e.target.checked })} />Consultar PDF e imágenes de las fuentes autorizadas</label>
    </fieldset>
    <fieldset disabled={!account} className="space-y-2 disabled:opacity-60"><legend className="mb-2 font-semibold">Qué puede preparar</legend>
      <label className="flex gap-2"><input type="checkbox" checked={permissions.prepareChanges} onChange={e => setPermissions({ prepareChanges: e.target.checked })} />Preparar cambios en textos existentes autorizados</label>
      <p className="text-muted">Solo notas Markdown, LaTeX y bibliografía manual. Se revisan antes de aplicar. Consultar diagramas o fichas no permite modificarlos. Crear, mover, enviar a papelera y adaptar plantillas todavía no están disponibles.</p>
    </fieldset>
    <p className="text-muted">Se aplican al seleccionarlos. No necesitas pulsar Guardar. Los cambios en archivos siempre requieren revisión y «Aplicar y guardar».</p>
    {status && <DirPicker open={picker} onClose={() => setPicker(false)} title="Elegir carpeta de notas para el asistente" initialPath={status.notesDir} allowedRoots={[status.notesDir]} pathSep={settings?.pathSep ?? '/'}
      hint="Solo se autorizarán las notas de la carpeta elegida. Biblioteca se concede aparte. Consultarlas envía su contenido a OpenAI."
      validate={path => {
        const dir = relUnder(status.notesDir, path), resources = status.resourcesSubdir.replaceAll('\\', '/');
        if (dir === null) return 'Elige una carpeta dentro de tus notas.';
        return dir && (dir === resources || dir.startsWith(resources + '/')) ? 'Esta carpeta pertenece a Biblioteca. Autoriza sus fichas con la casilla de Biblioteca.' : null;
      }}
      onSelect={path => { const dir = relUnder(status.notesDir, path); if (dir === null) return; setPermissions(dir ? { folders: [...new Set([...permissions.folders.split('\n').filter(Boolean), dir.replaceAll('\\', '/')])].join('\n') } : { allNotes: true }); setPicker(false); }} />}
  </section>;
}
