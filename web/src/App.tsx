import { lazy, Suspense, useEffect } from 'react';
import { matchesShortcut } from './lib/shortcuts';
import { registerTokenPrompt, type Status } from './api';
import { CaptureQueueDialog } from './components/CaptureQueueDialog';
import { ResourceConflictDialog } from './components/ResourceConflictDialog';
import { CaptureModal } from './components/CaptureModal';
import { ContextMenuHost } from './components/ContextMenu';
import { Header } from './components/Header';
import { MoveDialog } from './components/MoveDialog';
import { InsertFigureDialog, NewDiagramDialog } from './components/DiagramDialogs';
import { PromptDialog } from './components/PromptDialog';
import { QuickOpen } from './components/QuickOpen';
import { Rail } from './components/Rail';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { Workspace } from './components/Workspace';
import { HomePanel } from './panels/HomePanel';
import { Banner, Button, Spinner } from './components/ui';
import { docKey } from './lib/paths';
import { initCaptureQueue } from './state/captureQueue';
import { useCompile } from './state/compile';
import { useOutline } from './state/outline';
import { anyDirty, flushDrafts, saveDoc } from './state/docs';
import { connectEvents } from './state/events';
import { initInstance, useSettings, watchSettingsTransitions } from './state/settings';
import { useUI } from './state/ui';
import { activeFile } from './state/workspace';
const BibliotecaPanel = lazy(() => import('./panels/BibliotecaPanel'));
const DesktopSetup = lazy(() => import('./components/DesktopSetup'));

function useBoot() {
  useEffect(() => {
    registerTokenPrompt(() =>
      useUI.getState().ask({
        title: 'Acceso',
        label: 'El servidor pide un token de acceso (AUTH_TOKEN). Se guardará en este navegador.',
        password: true,
        okLabel: 'Entrar',
      }),
    );
    const ui = useUI.getState();
    // Arranque en cuanto llegue el primer estado (puede tardar si el server está caído).
    let started = false;
    let stopQueue: (() => void) | undefined;
    const start = (status: Status) => {
      if (started) return;
      started = true;
      // La instancia (claves de borradores y layout) debe fijarse antes de montar el área de trabajo.
      initInstance(status);
      watchSettingsTransitions();
      // Tras autenticarse (si hacía falta) el resto de peticiones ya llevan el token.
      connectEvents();
      void ui.refreshTree('memoria');
      void ui.refreshTree('notes');
      void ui.refreshResources();
      void useCompile.getState().fetchLast();
      void useOutline.getState().refresh();
      stopQueue = initCaptureQueue();
    };
    const unsub = useUI.subscribe((s) => s.status && start(s.status));
    void ui.refreshStatus().then(() => {
      const s = useUI.getState().status;
      if (s) start(s);
    });
    const t = setInterval(() => void useUI.getState().refreshStatus(), 60_000);
    return () => {
      clearInterval(t);
      stopQueue?.();
      unsub();
    };
  }, []);
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (matchesShortcut(e, 'quickOpen')) {
        e.preventDefault();
        const ui = useUI.getState();
        ui.setQuickOpen(!ui.quickOpen);
      } else if (matchesShortcut(e, 'capture')) {
        e.preventDefault();
        useUI.getState().setCaptureOpen(true);
      } else if (matchesShortcut(e, 'save')) {
        // Mod-S fuera del editor (p. ej. nota en modo lectura): guardar el archivo activo.
        e.preventDefault();
        if (useUI.getState().libraryView) return;
        const f = activeFile();
        if (f) void saveDoc(docKey(f.root, f.path));
      } else if (matchesShortcut(e, 'sidebar')) {
        const target = e.target as HTMLElement;
        if (target.closest('.cm-editor, input, textarea')) return;
        e.preventDefault();
        useUI.getState().toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useUnloadGuard() {
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      flushDrafts();
      if (anyDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => flushDrafts();
    const onVis = () => document.visibilityState === 'hidden' && flushDrafts();
    window.addEventListener('beforeunload', onBefore);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}

/** Durante arrastres (separadores, pestañas) los iframes no deben capturar el ratón. */
function useDragGuard() {
  useEffect(() => {
    const on = () => document.body.classList.add('et-dragging');
    const off = () => document.body.classList.remove('et-dragging');
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('.dv-sash')) on();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', off, true);
    window.addEventListener('dragstart', on, true);
    window.addEventListener('dragend', off, true);
    window.addEventListener('drop', off, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', off, true);
      window.removeEventListener('dragstart', on, true);
      window.removeEventListener('dragend', off, true);
      window.removeEventListener('drop', off, true);
    };
  }, []);
}

export function App() {
  useBoot();
  useGlobalKeys();
  useUnloadGuard();
  useDragGuard();
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const homeView = useUI((s) => s.homeView);
  const libraryView = useUI((s) => s.libraryView);
  const ready = useSettings((s) => s.ready);
  const statusError = useUI((s) => s.statusError);
  const motor = useUI((s) => s.status?.motor);
  return (
    <div className="flex h-full flex-col">
      <Header />
      {(motor?.seleccion === 'local' || motor?.seleccion === 'auto' || motor?.tipo === 'local') && (
        <Banner kind="warn">
          {motor?.seleccion === 'auto' && 'El modo Automático puede usar TeX del sistema si Docker no responde. '}
          TeX del sistema ejecuta herramientas con los permisos del usuario y no es un sandbox. Compila solo fuentes de confianza.
        </Banner>
      )}
      <div className="flex min-h-0 flex-1">
        <Rail />
        {sidebarOpen && !homeView && !libraryView && <Sidebar />}
        {libraryView && ready && <main className="min-w-0 flex-1 overflow-hidden" aria-label="Biblioteca"><Suspense fallback={<div className="p-6"><Spinner/></div>}><BibliotecaPanel/></Suspense></main>}
        {homeView && ready && (
          <main className="min-w-0 flex-1 overflow-hidden bg-soft" aria-label="Inicio">
            <HomePanel />
          </main>
        )}
        <main className={(homeView || libraryView) && ready ? 'hidden' : 'flex min-w-0 flex-1'} aria-label="Área de trabajo">
          {ready ? (
            <Workspace />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-ui text-muted">
              {statusError ? (
                <>
                  <p className="text-danger">No se pudo contactar con el servidor: {statusError}</p>
                  <Button onClick={() => void useUI.getState().refreshStatus()}>Reintentar</Button>
                </>
              ) : (
                <p className="flex items-center gap-2">
                  <Spinner size={12} /> Conectando con el servidor…
                </p>
              )}
            </div>
          )}
        </main>
      </div>
      <CaptureModal />
      <CaptureQueueDialog />
      <ResourceConflictDialog />
      <QuickOpen />
      <MoveDialog />
      <NewDiagramDialog />
      <InsertFigureDialog />
      <PromptDialog />
      <ContextMenuHost />
      <Toasts />
      {ready && <Suspense fallback={null}><DesktopSetup /></Suspense>}
    </div>
  );
}
