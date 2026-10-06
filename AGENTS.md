# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Cursor…) que trabajen en este repositorio.

## Qué es

Estudio TFG: entorno self-hosted para escribir la memoria del TFG en LaTeX con el PDF al lado, consultar notas de Obsidian y capturar recursos. **El repo es solo la herramienta**; la memoria y las notas del usuario viven fuera (ver «Contenido personal»).

- Especificación vinculante: [docs/CONTRACT.md](docs/CONTRACT.md). Cualquier cambio de API, eventos o comportamiento visible se refleja ahí, en una sección versionada (v0.1, v0.2, v0.3…).
- Trabajo pendiente: issues de GitHub (`gh issue list --repo JavierLoro/estudio-tfg`).

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `server/` | API: Node ≥ 24, TypeScript ejecutado con `tsx` (sin compilar), Fastify 5, chokidar. Tests en `server/test/` con vitest. |
| `web/` | Interfaz: React 19, Vite, Tailwind 4, Dockview, CodeMirror 6, zustand. Estado en `src/state/`, paneles en `src/panels/`, cliente tipado en `src/api.ts`. |
| `worker/` | Compilación LaTeX en Docker (`texlive/texlive:latest-full`, latexmk, `-no-shell-escape`). JS sin dependencias npm; tests con `node --test`. |
| `templates/` | Plantilla de la memoria: `base/` (común; clase `estilo/memoria.cls` derivada de ARCO, GPL-2.0+) y `perfiles/<id>/` (datos de la institución, logo y capítulos; se copia encima de `base/`). |
| `scripts/` | `npm run init` y creación de la memoria desde la plantilla. |
| `test/fixtures/` | Datos de prueba ficticios. |
| `data/` | Compilaciones, historial y ajustes locales. Ignorado por git. |

## Comandos

```bash
npm run install:all          # dependencias de server y web
npm run worker               # worker TeX Live en Docker (127.0.0.1:8090)
npm run dev                  # API en :8787 (tsx watch) y web en :5173 (Vite, proxy /api)
npm test                     # tests del servidor (vitest)
npm run typecheck --prefix server
npm run build --prefix web   # tsc --noEmit + vite build
node --test worker/*.test.mjs # tests del worker
```

Antes de dar un cambio por terminado: tests del servidor en verde, `tsc` del servidor y de la web sin errores y `vite build` correcto. Si tocas la interfaz, pruébala en el navegador (`npm run dev`).

## Reglas del proyecto

### Contenido personal: nunca al repo
- La memoria (`MEMORIA_DIR`), las notas (`NOTES_DIR`), `data/` y `.env` no se versionan. Dentro del repo solo se permite `workspace/` (ignorada).
- No añadas al repo contenido del TFG del usuario, notas, rutas con datos reales ni builds. Los fixtures deben ser ficticios.
- Las mejoras de la plantilla van en `templates/base/` o en `templates/perfiles/<id>/`; no se propagan a una memoria ya creada. La plantilla compila con **0 avisos** (LaTeX y biber) en todos los perfiles: compruébalo con el worker tras cualquier cambio.

### No perder datos
- Los archivos en disco son la fuente de verdad: no hay base de datos.
- Escrituras atómicas (temporal + `rename`) con copia en `data/history`.
- Toda escritura lleva `baseRev` (sha256 de 16 caracteres); si no coincide, el servidor responde **409** y la interfaz resuelve el conflicto. No te saltes esta comprobación.
- Las rutas que llegan a la API se validan contra la raíz (`isInside`, sin `..` ni enlaces que escapen).

### Seguridad
- El worker no monta la memoria: el servidor le envía un tar de las fuentes, y el worker lo extrae rechazando enlaces, rutas absolutas y `..`. LaTeX siempre con `-no-shell-escape`.
- Los ajustes solo se cambian desde loopback o con `AUTH_TOKEN`, y las carpetas deben estar dentro de `ALLOWED_ROOTS`.

### Interfaz
- Todo texto visible al usuario va en **español**, igual que los mensajes de error de la API.
- Las dependencias pesadas (PDF.js, mermaid…) se cargan en diferido (`lazy`/`import()`) para no engordar el bundle inicial.
- Los colores salen de los tokens `--et-*` de `web/src/index.css`, que tienen variantes clara y oscura.
- Las preferencias locales se guardan en `localStorage` con el prefijo `et:`, a través de `src/lib/storage.ts`.

### Estilo de código
- Imita el código de alrededor: TypeScript estricto, comentarios breves en español, la misma densidad de comentarios y los mismos nombres.
- No añadas dependencias sin necesidad. El worker no usa npm.

## Git y licencia

- Mensajes de commit en español, una línea descriptiva (p. ej. «Inicio como vista propia (no pestaña) y ancho del panel lateral ajustable»).
- Autoría con el noreply de GitHub, como está configurado; no uses otros correos.
- Haz commit o push solo cuando lo pida el usuario.
- Licencia AGPL-3.0. La plantilla deriva de ARCO (GPL-2.0+): conserva su aviso de copyright en `templates/base/estilo/memoria.cls`. No copies código de repositorios sin licencia; solo las ideas.
