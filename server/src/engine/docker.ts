import { Readable } from 'node:stream';
import type { Diagnostic } from '../compile.ts';
import { HttpError, badRequest } from '../errors.ts';
import type { Engine } from './index.ts';

export const WORKER_DOWN_MSG = 'Worker de compilación no disponible';
function normDiagnostics(v: unknown): Diagnostic[] {
  if (!Array.isArray(v)) return [];
  return v.map((d: any) => ({
    severity: d?.severity === 'warning' ? 'warning' : 'error',
    file: typeof d?.file === 'string' ? d.file : '',
    line: typeof d?.line === 'number' && Number.isFinite(d.line) ? d.line : null,
    message: typeof d?.message === 'string' ? d.message : String(d?.message ?? ''),
  }));
}


export function dockerEngine(url: string): Engine {
  return {
    type: 'docker',
    async health() {
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        const body: any = res.ok ? await res.json().catch(() => null) : null;
        const ok = body?.ok === true;
        return { ok, version: typeof body?.version === 'string' ? body.version : null,
          capabilities: { compile: ok, svg2pdf: ok && body?.capacidades?.svg2pdf !== false },
          ...(!ok ? { message: !res.ok ? `El servicio de compilación de Docker respondió con un error HTTP ${res.status}.`
            : !body || typeof body.ok !== 'boolean' ? 'El servicio de compilación de Docker devolvió una respuesta no válida.'
              : 'El servicio de compilación de Docker respondió, pero no está listo para compilar.' } : {}) };
      } catch (error) {
        return { ok: false, version: null, capabilities: { compile: false, svg2pdf: false },
          message: error instanceof Error && error.name === 'TimeoutError'
            ? 'El servicio de compilación de Docker no respondió en el tiempo de espera (1,5 segundos).'
            : 'El servidor no pudo conectar con el servicio de compilación de Docker.' };
      }
    },
    async compile(sources, main, signal, options) {
      if (options?.preview) {
        const health = await fetch(`${url}/health`, {signal: AbortSignal.timeout(1500)}).then(r => r.json()).catch(() => null) as any;
        if (health?.capacidades?.comparacion !== true) throw new HttpError(503, 'Actualiza el worker para comparar estilos sin afectar al PDF de la memoria');
      }
      let res: Response;
      try {
        res = await fetch(`${url}/compile`, {
          method: 'POST', headers: { 'content-type': 'application/x-tar', 'x-main': encodeURIComponent(main), ...(options?.preview ? {'x-preview':'1'} : {}) },
          body: Readable.toWeb(sources) as any, duplex: 'half', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
        } as RequestInit);
      } catch (e: any) {
        throw new HttpError(503, e?.name === 'TimeoutError' ? `${WORKER_DOWN_MSG} (tiempo de espera agotado)` : WORKER_DOWN_MSG);
      }
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* sin JSON */ }
      if (!res.ok && !body?.diagnostics) {
        const msg = typeof body?.error === 'string' ? body.error : text.slice(0, 300);
        throw new HttpError(502, `Error del worker (HTTP ${res.status}): ${msg}`);
      }
      return { ok: !!body?.ok, buildId: typeof body?.buildId === 'string' ? body.buildId : '',
        durationMs: typeof body?.durationMs === 'number' ? body.durationMs : null,
        pdf: typeof body?.pdf === 'string' ? body.pdf : null, diagnostics: normDiagnostics(body?.diagnostics) };
    },
    async svg2pdf(svg) {
      let res: Response;
      try {
        res = await fetch(`${url}/svg2pdf`, {
          method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: svg, signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new HttpError(503, 'Worker de compilación no disponible: no se puede convertir el diagrama a PDF');
      }
      if (!res.ok) {
        let msg = `el worker respondió ${res.status}`;
        try {
          const b = await res.json() as { error?: unknown };
          if (typeof b?.error === 'string') msg = b.error;
        } catch { /* sin JSON */ }
        if (res.status === 400 || res.status === 413) throw badRequest(`SVG no válido: ${msg}`);
        if (res.status === 404) throw new HttpError(503, 'El worker no sabe convertir diagramas: reconstrúyelo (npm run worker)');
        throw new HttpError(502, `No se pudo convertir el diagrama a PDF: ${msg}`);
      }
      const pdf = Buffer.from(await res.arrayBuffer());
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(502, 'El worker no devolvió un PDF');
      return pdf;
    },
  };
}
