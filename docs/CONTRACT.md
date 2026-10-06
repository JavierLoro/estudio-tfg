# Estudio TFG — contrato del piloto

Piloto mínimo: **no perder recursos** y **escribir la memoria con comodidad**.
Todo el contenido vive en archivos; no hay base de datos en el piloto.

## Piezas y carpetas

| Carpeta | Pieza | Tecnología |
| --- | --- | --- |
| `server/` | API + estáticos de `web/dist` | Node 24, TypeScript (tsx), Fastify 5, chokidar |
| `web/` | Interfaz | React 19, Vite, TypeScript, Tailwind 4, Dockview, CodeMirror 6, lucide-react |
| `worker/` | Compilación LaTeX | Imagen `texlive/texlive:latest-full` + Node (HTTP mínimo, sin dependencias) |
| `test/fixtures/` | Notas y memoria de prueba | Nunca usar el vault real en pruebas |

`server` y `web` son paquetes npm independientes (cada uno con su `package-lock.json`). `worker` no tiene dependencias npm.

## Configuración (`.env`, leída por el server)

```
PORT=8787
NOTES_DIR=./test/fixtures/notes        # real: /Users/javierlc/Documents/Vault/DespachoTrabajo
RESOURCES_SUBDIR=Recursos              # dentro de NOTES_DIR
MEMORIA_DIR=./test/fixtures/memoria    # real: /Users/javierlc/Documents/tfg-memoria
MEMORIA_MAIN=main.tex
BUILD_DIR=./data/builds
WORKER_URL=http://localhost:8090
AUTH_TOKEN=                            # vacío = sin auth (solo local)
```

## Raíces (`root`)

- `notes` → `NOTES_DIR` (Markdown + adjuntos).
- `memoria` → `MEMORIA_DIR` (LaTeX).

Rutas siempre **relativas a la raíz**, con `/`. El server rechaza `..`, rutas absolutas y symlinks que salgan de la raíz (400).

**Ignorar siempre** en árbol, búsqueda y watcher: archivos y carpetas que empiezan por `.`, `*.lock`, `*.sync-conflict-*`, `node_modules`, y en `memoria` los auxiliares de LaTeX (`*.aux *.log *.out *.toc *.lof *.lot *.lol *.bbl *.blg *.fls *.fdb_latexmk *.synctex.gz *.acn *.acr *.alg`) y `build/`.
Los `*.sync-conflict-*` se cuentan aparte y se exponen en `GET /api/status` para avisar.

## Revisiones y no pérdida de datos

- `rev` = sha256 hex del contenido en disco (primeros 16 caracteres).
- Guardar exige `baseRev`. Si el disco cambió → **409** con el contenido y `rev` actuales; el server **no escribe**.
- Escritura atómica: archivo temporal en la misma carpeta + `rename`.
- Antes de sobrescribir, copia la versión anterior a `BUILD_DIR/../history/<root>/<path>/<timestamp>.bak` (se conservan las 20 últimas por archivo).
- Crear nunca sobrescribe (409 si existe).

## API (JSON, prefijo `/api`)

Errores: `{ "error": string }` con código HTTP adecuado.
Si `AUTH_TOKEN` está definido: cabecera `Authorization: Bearer <token>` o cookie `et_token` (la web la pide una vez y la guarda).

### Estado
- `GET /api/status` → `{ notesDir, memoriaDir, memoriaMain, resourcesSubdir, syncConflicts: string[], worker: "up"|"down" }`

### Archivos
- `GET /api/tree?root=notes|memoria` → `{ root, entries: Entry[] }`
  `Entry = { path, name, type: "file"|"dir", children?: Entry[] }`, ordenado: carpetas primero, luego alfabético (es).
- `GET /api/file?root&path` → `{ root, path, content, rev, mtime }` (solo texto: `.md .tex .bib .sty .cls .txt .mmd .bst .json .yml .yaml .c .py .ts .js .csv`; otros → 415).
- `PUT /api/file` body `{ root, path, content, baseRev }` → `{ rev, mtime }` | 409 `{ error:"conflict", content, rev }`.
- `POST /api/file` body `{ root, path, content }` → `{ rev }` | 409 si existe. Crea carpetas intermedias.
- `GET /api/raw?root&path` → el archivo binario con su content-type (imágenes, PDF de figuras, adjuntos).

### Notas (Markdown)
- `GET /api/notes/resolve?target=<wikilink>` → `{ path } | 404`. Resuelve `[[Nombre]]`, `[[Carpeta/Nombre]]`, con o sin `.md`, como Obsidian: ruta exacta primero, luego por nombre de archivo (insensible a mayúsculas) en todo `notes`.
- `GET /api/notes/backlinks?path` → `{ items: { path, title, snippet }[] }`.

### Recursos (captura)
- `POST /api/capture` multipart: `url?`, `title?`, `note?`, `tags?` (coma), `file?` (uno). Al menos `url`, `note` o `file`.
  - Si hay `url` sin `title`: el server intenta leer `<title>`/`og:title` (timeout 4 s, máx 1 MB; si falla, usa el host).
  - Crea `NOTES_DIR/RESOURCES_SUBDIR/AAAA-MM-DD <título saneado>.md` (sufijo ` 2`, ` 3`… si existe) con:
    ```
    ---
    type: resource
    title: "<título>"
    url: <url>              # si hay
    captured: 2026-10-06T10:00:00+02:00
    status: inbox
    tags:
      - recurso
      - <tags…>
    attachment: "adjuntos/<archivo>"   # si hay
    ---

    <note>
    ```
  - Adjunto en `RESOURCES_SUBDIR/adjuntos/` (nombre saneado, sin sobrescribir). Máx 50 MB.
  - → `{ path, title }`
- `GET /api/resources` → `{ items: { path, title, url?, captured, status, tags, attachment? }[] }` (frontmatter de los `.md` de `RESOURCES_SUBDIR`, recientes primero).
- `PATCH /api/resources` body `{ path, status?, tags?, baseRev? }` → actualiza solo esas claves del frontmatter, preservando el resto del archivo.

### Búsqueda
- `GET /api/search?q&root=notes|memoria|all` → `{ items: { root, path, line, snippet }[] }` (máx 200, insensible a mayúsculas y tildes, también por nombre de archivo).

### Memoria (compilación)
- `POST /api/compile` → compila `MEMORIA_MAIN` vía worker. Una sola compilación a la vez (si hay una en curso, se espera a ella).
  → `{ ok, buildId, startedAt, durationMs, diagnostics: Diagnostic[], pdfUrl: string|null, sourceRev }`
  `Diagnostic = { severity: "error"|"warning", file, line: number|null, message }`
  `sourceRev` = hash del conjunto de fuentes compiladas. Si falla, `pdfUrl` apunta al último PDF correcto (o null).
- `GET /api/compile/last` → el último resultado (o 404).
- `GET /api/pdf/<buildId>.pdf` → PDF.
- `GET /api/compile/log/<buildId>` → texto del log.

### Eventos (SSE)
- `GET /api/events` → `event: change` con `data: { root, path, kind: "add"|"change"|"unlink" }`; `event: compile` con el resultado al terminar.

## Worker (HTTP, puerto 8090)

- `GET /health` → `{ ok: true }`
- `POST /compile` body `{ main: "main.tex" }` → copia `/src` (montado **solo lectura**, = `MEMORIA_DIR`) a un temporal, ejecuta
  `latexmk -pdf -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape <main>` con timeout 120 s, y escribe en `/out/<buildId>/` (`main.pdf`, `main.log`).
  → `{ ok, buildId, durationMs, pdf: "<buildId>/main.pdf"|null, log: "<buildId>/main.log", diagnostics }`
- El server comparte `/out` como `BUILD_DIR`. El parseo de diagnósticos (`file:line: mensaje`, `LaTeX Warning`, `Citation … undefined`, `Overfull` se ignora) lo hace el worker.

## Interfaz

- **Barra de iconos** (52 px, izquierda): Inicio, Memoria, Notas, Recursos, Buscar. Abre un **panel lateral plegable** (~260 px) con la lista de esa sección; el clic abre en el área central.
- **Cabecera compacta** (40 px): nombre, búsqueda rápida (⌘K), botón **Capturar** (⌘⇧C), estado de guardado global, aviso de conflictos de Syncthing.
- **Área central: Dockview.** Tipos de panel: `latex`, `note`, `pdf`, `resource`, `search`, `home`. Abrir/abrir al lado (⌥clic o menú). Layout guardado en `localStorage` y restaurado.
- **LaTeX:** CodeMirror 6 con `@codemirror/legacy-modes` (stex), números de línea, buscar, ⌘S guarda, ⌘↵ guarda y compila. Diagnósticos de la última compilación como marcas en el editor y lista clicable.
- **PDF:** `<iframe>` del visor nativo con `pdfUrl`; banda «PDF desactualizado» si se ha guardado después de `sourceRev`/compilación; botón compilar.
- **Nota:** modo lectura (react-markdown + remark-gfm + frontmatter oculto/plegable + wikilinks clicables + bloques mermaid renderizados) y modo edición (CodeMirror markdown). Backlinks al pie.
- **Recursos:** lista con filtro por estado/tag; abrir URL; marcar `inbox` → `revisado` / `descartado`.
- **Captura:** modal de 3 campos (URL, nota, adjunto; título opcional; arrastrar archivo). Enter guarda. Si falla la red, se guarda en `localStorage` y se reintenta.
- **Inicio:** últimos archivos abiertos, recursos `inbox`, estado de la última compilación.
- **Sin pérdida:** borrador de cada editor en `localStorage` mientras no esté guardado; al abrir, si existe borrador distinto, ofrecerlo. En 409, diálogo con «quedarme con lo mío / cargar lo del disco / ver ambos». Indicador por pestaña: guardado · sin guardar · conflicto.
- Tema claro/oscuro según sistema. Español en toda la UI.
- Dev: Vite en 5173 con proxy `/api` → 8787. Prod: el server sirve `web/dist`.
