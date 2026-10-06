# Estudio TFG — contrato del piloto

Piloto mínimo: **no perder recursos** y **escribir la memoria con comodidad**.
Todo el contenido vive en archivos; no hay base de datos en el piloto.

## Piezas y carpetas

| Carpeta | Pieza | Tecnología |
| --- | --- | --- |
| `server/` | API + estáticos de `web/dist` | Node 24, TypeScript (tsx), Fastify 5, chokidar |
| `web/` | Interfaz | React 19, Vite, TypeScript, Tailwind 4, Dockview, CodeMirror 6, lucide-react |
| `worker/` | Compilación LaTeX | Imagen `texlive/texlive:latest-full` + Node (HTTP mínimo, sin dependencias) |
| `templates/esi-tfg/` | Plantilla base de la memoria (UCLM-ESI) | Se copia a `MEMORIA_DIR` con `npm run init` |
| `test/fixtures/` | Notas de prueba | Nunca usar el vault real en pruebas |
| `workspace/` | Contenido local por defecto | Ignorado por git |

`server` y `web` son paquetes npm independientes (cada uno con su `package-lock.json`). `worker` no tiene dependencias npm.

## Configuración (`.env`, leída por el server)

```
PORT=8787
NOTES_DIR=./workspace/notes            # p. ej. ~/Vault/MiCarpetaTFG
RESOURCES_SUBDIR=Recursos              # dentro de NOTES_DIR
MEMORIA_DIR=./workspace/memoria        # p. ej. ~/Documents/tfg-memoria
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

## Configuración desde la interfaz (v0.2)

### Precedencia y almacenamiento
- Ajustes editables: `notesDir`, `resourcesSubdir`, `memoriaDir`, `memoriaMain`.
- Se guardan en `data/settings.json` (ignorado por git). Precedencia: `settings.json` > `.env` > valores por defecto. `.env` queda como valores iniciales.
- Nueva variable `ALLOWED_ROOTS` (lista separada por `:`; por defecto el home del usuario; en Docker `/data`). Ninguna carpeta configurable ni navegable puede salir de ellas (comprobado con realpath).
- Se mantiene el bloqueo: `notesDir`/`memoriaDir` no pueden estar en carpetas versionadas del repo (solo `workspace/`).

### Seguridad
- `PUT /api/settings`, `POST /api/settings/init-memoria` y `GET /api/fs/dirs` exigen: `AUTH_TOKEN` configurado y válido, **o** petición desde loopback (127.0.0.1/::1) sin `AUTH_TOKEN` configurado. Si no, 403.

### API
- `GET /api/settings` → `{ values: {notesDir, resourcesSubdir, memoriaDir, memoriaMain}, sources: {<clave>: "settings"|"env"|"default"}, allowedRoots: string[], checks: Check[] }`
  `Check = { key, level: "ok"|"warning"|"error", message }` — p. ej. carpeta inexistente, `memoriaMain` no encontrado, vault sin `.obsidian` en la carpeta o sus padres (aviso), memoria dentro de notas o al revés (aviso).
- `PUT /api/settings` body parcial `{ notesDir?, resourcesSubdir?, memoriaDir?, memoriaMain? }` (admite `~`). Valida: absoluta tras expandir, existe y es carpeta, dentro de `ALLOWED_ROOTS`, fuera del repo salvo `workspace/`; `resourcesSubdir` relativa sin `..` (se crea si no existe). Errores → 400 `{ error, field }`. Si es válido: guarda, **aplica en caliente** (reconfigura rutas, reinicia el watcher, invalida caches) y emite SSE `event: settings` con los nuevos valores. → mismo formato que GET.
- `POST /api/settings/reset` body `{ keys: string[] }` → elimina esas claves de `settings.json` (vuelven a `.env`/defecto), aplica en caliente.
- `GET /api/fs/dirs?path=<abs>` → `{ path, parent: string|null, dirs: { name, path, isObsidianVault, hasMainTex, isGitRepo }[] }`. Sin `path` → lista `allowedRoots`. Oculta dotfiles. `parent` null al llegar a una raíz permitida.
- `POST /api/settings/init-memoria` body `{ dir }` → si `dir` no existe o está vacía: la crea, copia `templates/esi-tfg/`, `git init` + commit inicial; aplica `memoriaDir=dir`. Si no está vacía → 409. Misma lógica que `scripts/init.mjs` (compartir el código).
- `GET /api/status` añade `configured: boolean` (false si `notesDir` o `memoriaDir` no existen) y `instanceId` = hash corto de `notesDir|memoriaDir` (para claves de borradores en la web).

### Compilación sin montaje
- El worker **ya no monta `MEMORIA_DIR`**. `POST /compile` en el worker recibe `Content-Type: application/x-tar`, cabecera `X-Main: main.tex`, cuerpo = tar de las fuentes (sin ignorados ni auxiliares; máx 200 MB). El worker lo extrae en un temporal (rechaza entradas absolutas, `..`, symlinks y hardlinks) y compila igual que antes. La salida sigue yendo a `/out` (= `BUILD_DIR`).
- El server crea el tar desde el `memoriaDir` actual (paquete npm `tar`), con el mismo filtro que `sourceRev`.
- `docker-compose.yml`: quitar el volumen `/src` del worker (y su requisito de `MEMORIA_DIR`).

### Interfaz
- Icono **Ajustes** (engranaje) al pie de la barra de iconos → panel `settings` en Dockview.
- Por cada ajuste: valor actual, origen (`.env` / ajustes / defecto), botón **Elegir…** que abre un selector de carpetas navegable (`/api/fs/dirs`) con marcas «vault de Obsidian», «contiene main.tex», «repo git», migas de pan; campo de texto editable; «Restablecer» si viene de ajustes.
- `memoriaMain`: desplegable con los `.tex` de la raíz de la memoria.
- Botón **Crear memoria desde la plantilla** (elige carpeta vacía o nueva → `init-memoria`).
- Lista de `checks` con su nivel. Guardar aplica sin reiniciar; errores mostrados junto al campo.
- Al cambiar ajustes (respuesta o SSE `settings`): recargar árboles, recursos, búsqueda y última compilación; cerrar pestañas de archivos de raíces cambiadas (los borradores se conservan).
- Borradores y layout: clave con `instanceId` (`draft:<instanceId>:<root>:<path>`), migrando los existentes sin prefijo a la instancia actual una vez.
- Si `configured` es false al arrancar: abrir Ajustes automáticamente con un aviso.

## Plantilla combinada y vista Documento (v0.3)

### Plantilla `templates/esi-tfg/` (sustituye a la de ARCO)
- **Origen y licencia:** derivada de la clase GPL de ARCO (`esi-tfg.cls`, UCLM-ESI), saneada. De la plantilla de J. Salido solo se toman ideas (opciones de idioma/formato, guía por capítulo): **no se copia código ni texto** (su repositorio no declara licencia). Mantener la cabecera GPL y la atribución en `estilo/esi-tfg.cls` y en `LEEME.md`.
- **Estructura** (orden de carpetas = orden del PDF, todo en español):
  ```
  LEEME.md · datos.tex · tfg.tex · bibliografia.bib · figuras/
  0-inicio/{resumen,abstract,agradecimientos,acronimos}.tex
  1-capitulos/{01-introduccion,02-objetivos,03-antecedentes,04-metodologia,05-resultados,06-conclusiones}.tex
  2-anexos/a-anexo.tex
  estilo/esi-tfg.cls (+ logos)  ← no tocar
  ```
- `datos.tex`: solo comandos limpios (`\titulo`, `\autor`, `\email`, `\tutor`, `\cotutor`, `\departamento`, `\intensificacion`, `\fecha{mes}{año}`, `\ciudad`, `\palabrasClave`, `\idioma{espanol|ingles}`, `\formato{impresion|pantalla}`, `\estiloBibliografia{ieeetr}`). Campos opcionales vacíos u omitidos no rompen nada.
- `tfg.tex`: `\documentclass{estilo/esi-tfg}`, `\input{datos}` y la lista ordenada de `\input`/`\include`. Un apartado desactivado = línea comentada.
- Cada capítulo empieza con un comentario guía breve (redacción propia) sobre qué debe contener según la normativa de la ESI.
- Objetivo: **0 avisos** al compilar sin tocar; sin paquetes obsoletos (`epsfig`, `atbeginend`, `lettrine`, `tipa`, `blindtext`); pdflatex + bibtex; PDF ligero.
- `scripts/init.mjs` / `init-memoria` usan esta plantilla. La memoria actual del usuario (aún texto de plantilla) se regenera con ella tras confirmar que no tiene cambios propios.

### Vista Documento
- `GET /api/memoria/outline` → `{ main, items: OutlineItem[], words: number, generatedAt }`
  `OutlineItem = { id, kind: "datos"|"frontmatter"|"chapter"|"section"|"subsection"|"bibliography"|"appendix", title, number: string|null, file, line, enabled, words, warnings: string[], children: OutlineItem[] }`
  - Se construye siguiendo `MEMORIA_MAIN` recursivamente por `\input`/`\include` (sin comentarios, rutas relativas a la raíz, con o sin `.tex`, ciclos protegidos). Las líneas comentadas `% \include{…}` producen `enabled:false`.
  - Numeración como en el PDF: capítulos 1, 2…; secciones 1.1…; tras `\appendix`, A, B…; `\chapter*`/frontmatter sin número.
  - `words`: palabras de texto (sin comandos ni comentarios), aproximado. `warnings`: «vacío» (< 30 palabras), «TODO» si hay `TODO`/`\todo`, «errores» si la última compilación tiene diagnósticos en ese archivo/rango.
  - Se invalida con el watcher; SSE `event: outline` cuando cambia.
- `POST /api/memoria/sections` body `{ kind: "chapter"|"section"|"appendix", title, after?: id, parent?: id }`:
  - `chapter`/`appendix`: crea `1-capitulos/NN-<slug>.tex` (o `2-anexos/<letra>-<slug>.tex`) con `\chapter{title}\label{cap:<slug>}` + comentario guía, e inserta su `\include` en `tfg.tex` tras `after` (o al final del bloque). Numeración de archivos: siguiente número libre (no se renombran los existentes).
  - `section`: inserta `\section{title}` al final del capítulo `parent` (o tras `after`) en su archivo.
  - Usa las mismas garantías que `PUT /api/file` (revisión, backup, atómico); 409 si `tfg.tex` cambió entre lectura y escritura. → `{ item, file, line }`.
- Búsqueda: `GET /api/search?root=memoria` añade a cada resultado `outline: { id, number, title }` (apartado más interno que contiene la línea). La web agrupa por apartado en orden del documento.
- **Interfaz:** en la sección Memoria, pestañas **Documento | Archivos** (Documento por defecto). Árbol con número, título, palabras y avisos; apartados desactivados en gris; clic abre en la línea, ⌥clic al lado; filtro rápido arriba; total de palabras; botones «+ Capítulo», «+ Sección» (en el menú del capítulo) y «+ Anexo» con diálogo de título.
- Fase 2 (no ahora): activar/desactivar, reordenar arrastrando, «Ver en PDF» con SyncTeX.
