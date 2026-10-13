import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const PdfViewer = lazy(() => import('./components/PdfViewer'));
const requested = new URL(location.href).searchParams.get('pdf');
let pdf: string | null = null;
if (requested) {
  try {
    const url = new URL(requested, location.origin);
    if (url.origin === location.origin && (url.pathname.startsWith('/api/pdf/') || url.pathname === '/api/raw')) pdf = url.pathname + url.search;
  } catch { /* URL ajena o inválida: abrir la interfaz habitual. */ }
}
if (pdf) document.title = 'Documento PDF — Estudio TFG';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {pdf ? <div className="flex h-screen flex-col bg-bg text-fg">
      <div className="border-b border-line px-3 py-2 text-sm">Documento PDF</div>
      <Suspense fallback={<div className="p-3 text-muted">Cargando PDF…</div>}><PdfViewer url={pdf} synctex={false} /></Suspense>
    </div> : <App />}
  </StrictMode>,
);
