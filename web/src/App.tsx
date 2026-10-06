import { useEffect } from 'react';
import { registerTokenPrompt } from './api';
import { CaptureModal } from './components/CaptureModal';
import { ContextMenuHost } from './components/ContextMenu';
import { Header } from './components/Header';
import { PromptDialog } from './components/PromptDialog';
import { QuickOpen } from './components/QuickOpen';
import { Rail } from './components/Rail';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { Workspace } from './components/Workspace';
import { docKey } from './lib/paths';
import { initCaptureQueue } from './state/captureQueue';
import { useCompile } from './state/compile';
import { anyDirty, flushDrafts, saveDoc } from './state/docs';
import { connectEvents } from './state/events';
import { useUI } from './state/ui';
import { activeFile } from './state/workspace';

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
    void ui.refreshStatus().then(() => {
      // Tras autenticarse (si hacía falta) el resto de peticiones ya llevan el token.
      connectEvents();
      void ui.refreshTree('memoria');
      void ui.refreshTree('notes');
      void ui.refreshResources();
      void useCompile.getState().fetchLast();
      initCaptureQueue();
    });
    const t = setInterval(() => void useUI.getState().refreshStatus(), 60_000);
    return () => clearInterval(t);
  }, []);
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault();
        const ui = useUI.getState();
        ui.setQuickOpen(!ui.quickOpen);
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault();
        useUI.getState().setCaptureOpen(true);
      } else if (k === 's' && !e.defaultPrevented) {
        // ⌘S fuera del editor (p. ej. nota en modo lectura): guardar el archivo activo.
        e.preventDefault();
        const f = activeFile();
        if (f) void saveDoc(docKey(f.root, f.path));
      } else if (k === 'b' && !e.shiftKey && !e.defaultPrevented) {
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
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Rail />
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1" aria-label="Área de trabajo">
          <Workspace />
        </main>
      </div>
      <CaptureModal />
      <QuickOpen />
      <PromptDialog />
      <ContextMenuHost />
      <Toasts />
    </div>
  );
}
