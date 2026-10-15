import { useEffect, useState } from 'react';
import { assistantRequest, refreshAssistantAccount, useAssistant, type ChatGPTAccountView } from '../state/assistant';
import { errorMessage } from '../api';
import { Button, Modal, Spinner } from './ui';
import { load, save } from '../lib/storage';

export function ChatGPTAccount({ announce = false }: { announce?: boolean }) {
  const account = useAssistant(s => s.account), [busy, setBusy] = useState(false), [error, setError] = useState(''), [welcome, setWelcome] = useState(false);
  useEffect(() => { void refreshAssistantAccount().catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => {
    if (!account?.pending) return;
    const timer = setInterval(() => void refreshAssistantAccount().catch(e => setError(errorMessage(e))), 1000);
    return () => clearInterval(timer);
  }, [account?.pending]);
  const active = account?.accounts.find(a => a.id === account.active);
  useEffect(() => { setWelcome(announce && !!active?.connected && active.enabled && !load('et:chatgpt:welcome:' + active.id, false)); }, [announce, active?.id, active?.connected, active?.enabled]);
  const action = async (path: string, body: object = {}) => {
    setBusy(true); setError('');
    try { useAssistant.setState({ thread: null, context: [], draft: '', account: await assistantRequest<ChatGPTAccountView>('/account/' + path, body) }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <section className="space-y-2 rounded border border-line bg-soft p-3" aria-label="Cuenta de ChatGPT">
    <div className="flex flex-wrap items-center gap-2">
      <strong>ChatGPT</strong>
      {!!account?.accounts.length && <select aria-label="Cuenta de ChatGPT" className="max-w-full rounded border border-line bg-bg p-1" value={account.active ?? ''} disabled={busy || account.pending} onChange={e => void action('select', { id: e.target.value })}>
        {account.accounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.connected ? '' : ' · desconectada'}</option>)}
      </select>}
      <Button onClick={() => void action('connect')} disabled={busy || account?.pending}>Continuar con ChatGPT</Button>
      {active && <Button onClick={() => void action(active.connected ? 'disconnect' : 'connect', { id: active.id })} disabled={busy || account?.pending}>{active.connected ? 'Desconectar' : 'Reconectar'}</Button>}
      {active?.connected && !active.enabled && <Button onClick={() => void action('connect', { id: active.id })} disabled={busy || account?.pending}>Autorizar uso del plan</Button>}
      {account?.pending && <><Spinner size={12} /><span>Completa la conexión en el navegador.</span><Button onClick={() => void action('cancel')} disabled={busy}>Cancelar conexión</Button></>}
    </div>
    {active?.connected && <p className="text-muted">{active.enabled ? 'Usando tu plan de ChatGPT.' : 'El uso del plan no está autorizado. Pulsa «Autorizar uso del plan» para conceder el permiso.'} <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer" className="text-accent underline">Gestionar uso en ChatGPT</a></p>}
    {account && !account.persistent && <p className="text-warn">Sin almacenamiento seguro: la conexión solo se conservará durante esta sesión.</p>}
    {(error || account?.error) && <p role="alert" className="text-danger">{error || account?.error}</p>}
    <Modal open={welcome} onClose={() => { if (active) save('et:chatgpt:welcome:' + active.id, true); setWelcome(false); }} title="Estás usando tu plan de ChatGPT" footer={<Button onClick={() => { if (active) save('et:chatgpt:welcome:' + active.id, true); setWelcome(false); }}>Entendido</Button>}>
      <p>Las consultas elegibles usan tu plan de ChatGPT o el saldo permitido en sus ajustes. Los PDF e imágenes también consumen uso. Puedes revisar los límites y el acceso de esta app en ChatGPT.</p>
    </Modal>
  </section>;
}
