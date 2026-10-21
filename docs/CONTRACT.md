# Estudio TFG — contrato del piloto

Piloto mínimo: **no perder recursos** y **escribir la memoria con comodidad**.
Todo el contenido vive en archivos; no hay base de datos en el piloto.

## Piezas y carpetas

| Carpeta | Pieza | Tecnología |
| --- | --- | --- |
| `server/` | API + estáticos de `web/dist` | Node 24, TypeScript (tsx), Fastify 5, chokidar |
| `web/` | Interfaz | React 19, Vite, TypeScript, Tailwind 4, Dockview, CodeMirror 6, lucide-react |
| `worker/` | Compilación LaTeX | Imagen `texlive/texlive:latest-full` + Node (HTTP mínimo, sin dependencias) |
| `templates/` | Plantilla de la memoria: `base/` + `perfiles/<id>/` (v0.5) | Se copia a `MEMORIA_DIR` con `npm run init` |
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
- `PATCH /api/resources` body `{ path, status?, tags?, baseRev }` → actualiza solo esas claves del frontmatter, preservando el resto del archivo.

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
- Nueva variable `ALLOWED_ROOTS` (lista separada por el delimitador del sistema del servidor: `:` en macOS/Linux y `;` en Windows; por defecto el home del usuario; en Docker `/data`). Ninguna carpeta configurable ni navegable puede salir de ellas (comprobado con realpath).
- Precisión de portabilidad (A3): `ALLOWED_ROOTS=C:\Users\yo;D:\TFG` permite dos raíces en Windows sin dividir las letras de unidad. En Docker se usa el separador del contenedor (`:`), aunque el navegador esté en Windows. Se ignoran entradas vacías y espacios exteriores; se mantienen la resolución de rutas relativas, la expansión de `~`, la canonicalización con realpath y la eliminación de raíces duplicadas.
- Se mantiene el bloqueo: `notesDir`/`memoriaDir` no pueden estar en carpetas versionadas del repo (solo `workspace/`).

### Seguridad
- `PUT /api/settings`, `POST /api/settings/init-memoria` y `GET /api/fs/dirs` exigen: `AUTH_TOKEN` configurado y válido, **o** petición desde loopback (127.0.0.1/::1) sin `AUTH_TOKEN` configurado. Si no, 403.

### API
- `GET /api/settings` → `{ values: {notesDir, resourcesSubdir, memoriaDir, memoriaMain}, sources: {<clave>: "settings"|"env"|"default"}, allowedRoots: string[], checks: Check[] }`
  `Check = { key, level: "ok"|"warning"|"error", message }` — p. ej. carpeta inexistente, `memoriaMain` no encontrado, vault sin `.obsidian` en la carpeta o sus padres (aviso), memoria dentro de notas o al revés (aviso).
- `PUT /api/settings` body parcial `{ notesDir?, resourcesSubdir?, memoriaDir?, memoriaMain? }` (admite `~`). Valida: absoluta tras expandir, existe y es carpeta, dentro de `ALLOWED_ROOTS`, fuera del repo salvo `workspace/`; `resourcesSubdir` relativa sin `..` (se crea si no existe). Errores → 400 `{ error, field }`. Si es válido: guarda, **aplica en caliente** (reconfigura rutas, reinicia el watcher, invalida caches) y emite SSE `event: settings` con los nuevos valores. → mismo formato que GET.
- `POST /api/settings/reset` body `{ keys: string[] }` → elimina esas claves de `settings.json` (vuelven a `.env`/defecto), aplica en caliente.
- `GET /api/fs/dirs?path=<abs>` → `{ path, parent: string|null, dirs: { name, path, isObsidianVault, hasMainTex, isGitRepo }[] }`. Sin `path` → lista `allowedRoots`. Oculta dotfiles. `parent` null al llegar a una raíz permitida.
- `POST /api/settings/init-memoria` body `{ dir }` → si `dir` no existe o está vacía: la crea, copia la plantilla (`templates/esi-tfg/`; desde v0.5, `templates/base/` + perfil), `git init` + commit inicial; aplica `memoriaDir=dir`. Si no está vacía → 409. Misma lógica que `scripts/init.mjs` (compartir el código).
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

### Plantilla `templates/esi-tfg/` (sustituye a la de ARCO; desde v0.5, `templates/base/` + `templates/perfiles/esi-uclm/`)
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

## SyncTeX (v0.4)

El worker deja `main.synctex.gz` junto al PDF con las rutas `Input:` relativas a la raíz de la memoria (los archivos de TeX Live quedan absolutos). El server lo analiza bajo demanda y guarda en memoria las 3 últimas compilaciones consultadas.

Coordenadas siempre en **puntos PDF (bp)**, origen en la **esquina superior izquierda** de la página; `page` empieza en 1. `build` es opcional: por defecto, la compilación del último PDF bueno (la de `pdfUrl`). Mismo `AUTH_TOKEN` que el resto de `/api`.

- `GET /api/synctex/forward?file=<ruta>&line=<n>[&build=<buildId>]` → `{ build, page, x, y, w, h }`
  - `file`: relativa a la memoria (`./` y `.tex` opcionales). `{x, y, w, h}` = rectángulo de las líneas del PDF donde está esa línea del código (unión de sus cajas de línea contiguas, en la primera página donde aparece; `y` = borde superior).
  - Línea sin contenido propio (en blanco, comentario, `\end{…}`…) → la siguiente línea del archivo que lo tenga; si no hay, la anterior.
- `GET /api/synctex/inverse?page=<n>&x=<pt>&y=<pt>[&build=<buildId>]` → `{ build, file, line }`
  - `file` siempre relativa a la memoria y editable: nunca un archivo de TeX Live ni un auxiliar generado (`.aux`, `.toc`, `.bbl`…). Clic entre líneas → la línea siguiente si el hueco es claro (entre párrafos, bajo un título); si no, la más cercana.
- `GET /api/synctex/outline[?build=<buildId>]` → `{ build, items: [{ id, page, y }] }`
  - Posición en el PDF del título de cada apartado activo de la vista Documento (`id` como en `/api/memoria/outline`), en orden del documento; se omiten los que no aparecen en el PDF (p. ej. «Datos del trabajo»). `y` = borde superior, como en `forward`.
  - Se calcula como `forward` sobre `file:line` de cada apartado, pero ignorando las páginas que TeX envió mientras leía esa línea (el `\cleardoublepage` de un `\chapter` deja registros suyos en la página anterior).
- `GET /api/synctex/file/<buildId>` → el `synctex.gz` tal cual (`application/gzip`, caché `immutable` como el PDF).
- Errores: **400** si `file` no es relativa o contiene `..`, `line`/`page` no son enteros ≥ 1, `x`/`y` no son números o `build` no es un buildId válido. **404** `Aún no hay ningún PDF compilado` (sin `build` y sin PDF bueno), `No hay datos de SyncTeX para esta compilación`, `No se encontró <file>:<line> en el PDF` o `No se encontró código de la memoria en esa posición del PDF`.
- Contrastado con el CLI `synctex view/edit` del worker: misma página en todas las líneas comparables; mismo borde superior (±4 pt) en las líneas de texto. Diferencias deliberadas: no se salta a páginas en blanco (un `\chapter` en `\cleardoublepage` va al título, no a la página vacía previa) y en tablas se devuelve la fila de esa línea.

### Visor PDF (interfaz)

- El panel PDF usa PDF.js (`pdfjs-dist`), cargado en diferido al abrir el panel y con su worker aparte; no aumenta el bundle inicial.
- Páginas virtualizadas, zoom (ajustar al ancho, página completa, %; ⌘± y ⌘/Ctrl + rueda), búsqueda de texto (⌘F) y páginas oscuras opcionales (colores invertidos). El zoom y el modo oscuro se recuerdan (`et:pdf-scale`, `et:pdf-dark`).
- Al recompilar se conservan la página, el desplazamiento y el zoom.
- **PDF → código**: ⌘/Ctrl+clic en el PDF abre el `.tex` en esa línea (⌥ para abrirlo al lado).
- **Código → PDF**: «Ver en PDF» (⌘⇧J o botón en el editor de un `.tex` de la memoria; menú de cada apartado en la vista Documento) salta a la página y resalta la zona unos segundos.
- **Apartado visible**: la vista Documento marca (barra de acento, `aria-current="location"`) el apartado que se está viendo en el PDF: el último cuyo título queda por encima de un cuarto de la altura visible del visor (si está plegado, su antepasado visible). Usa `/api/synctex/outline`, que se relee al cambiar el PDF mostrado o el índice. Mientras se desplaza el PDF, el árbol se desplaza para mantenerlo visible, salvo si el puntero o el foco están en el árbol; no cambia la selección ni el foco.
- Siempre se consulta el SyncTeX del build que se está mostrando (`build` = el de `pdfUrl`).

## Plantilla genérica con perfiles de institución y panel «Datos del trabajo» (v0.5)

La plantilla deja de ser solo de la ESI: la clase es genérica y lo institucional sale de un **perfil**. Nada de lo que escribe el usuario se toca.

### Estructura en el repo

```
templates/
  base/                      archivos comunes: tfg.tex, datos.tex, 0-inicio/, 2-anexos/, bibliografia.bib,
                             figuras/, estilo/memoria.cls, LEEME.md, .gitignore
  perfiles/<id>/             lo propio de cada perfil, se copia ENCIMA de base/:
    perfil.json              { "id", "nombre", "descripcion" }
    estilo/institucion.tex   datos de la institución (formato abajo)
    estilo/logo.pdf          (opcional)
    1-capitulos/…            capítulos de partida con sus guías
    (cualquier otro archivo) sustituye al de base/; p. ej. esi-uclm trae su tfg.tex
                             (otros nombres de capítulo) y su datos.tex (ejemplos de la ESI)
```

Perfiles de serie: `esi-uclm` (por defecto; equivale a la plantilla v0.3) y `generico` (sin logo; capítulos Introducción, Objetivos, Estado de la cuestión, Desarrollo, Resultados, Conclusiones). `templates/esi-tfg/` desaparece.

La clase pasa a ser `estilo/memoria.cls` (`\documentclass{estilo/memoria}`), derivada de la anterior (mantiene la cabecera GPL y la atribución a ARCO). Lee `estilo/institucion.tex` **antes de `\LoadClass`** (con `\InputIfFileExists`), por eso puede fijar el tamaño de letra. Si falta, usa los valores del perfil genérico.

### `estilo/institucion.tex`

Un comando por línea, con `%` para comentarios. Todos son opcionales; vacío = no se muestra.

| Comando | Valores | Por defecto (genérico) |
|---|---|---|
| `\universidad{…}` | texto | vacío |
| `\escuela{…}` | texto (escuela o facultad) | vacío |
| `\logo{…}` | archivo dentro de `estilo/` (`.pdf`, `.png`, `.jpg`); vacío = sin logo | vacío |
| `\tipoTrabajo{…}` | `tfg` \| `tfm` \| `tesis` \| `otro` | `tfg` |
| `\nombreTrabajo{…}` | texto que sustituye al del tipo («Trabajo Fin de Grado»…) | vacío |
| `\titulacion{…}` | texto («Grado en Ingeniería Informática») | vacío |
| `\etiquetaEspecialidad{…}` | texto («Tecnología específica», «Mención»); vacío = no se muestra la especialidad | vacío |
| `\idiomaPortadas{…}` | `espanol` \| `ingles` \| `documento` (el de `\idioma`) | `documento` |
| `\tamanoLetra{…}` | `10pt` \| `11pt` \| `12pt` | `12pt` |
| `\margenes{int}{ext}{sup}{inf}` | longitudes TeX (`35mm`) | `30mm` `25mm` `25mm` `25mm` |
| `\interlineado{…}` | `1` \| `1.15` \| `1.25` \| `1.5` \| `2` | `1.5` |

Perfil `esi-uclm`: Universidad de Castilla-La Mancha, Escuela Superior de Informática, `esi_logo.pdf`, `tfg`, Grado en Ingeniería Informática, «Tecnología específica», portadas en `espanol`, `12pt`, márgenes `35mm 20mm 25mm 25mm`, `1.5`.

Las portadas se generan con estos datos; si existe `estilo/portada.tex` se usa en su lugar (vía de escape para formatos muy distintos).

### `datos.tex` (v0.5)

Los de v0.3 (`\titulo`, `\autor`, `\email`, `\tutor`, `\cotutor`, `\departamento`, `\intensificacion`, `\fecha{mes}{año}`, `\ciudad`, `\palabrasClave`, `\idioma`, `\formato`, `\estiloBibliografia`) más:

| Comando | Valores | Por defecto |
|---|---|---|
| `\keywords{…}` | palabras clave en inglés (para el Abstract) | vacío |
| `\modo{…}` | `borrador` (marca «BORRADOR», `\todo` visibles) \| `final` (un `\todo` es un error) | `borrador` |
| `\licencia{…}` | `reservados` \| `cc-by` \| `cc-by-sa` \| `cc-by-nc-sa` \| `ninguna` (texto en la página de créditos) | `reservados` |
| `\atribucion{…}` | `si` \| `no` (página final de atribución a la clase de ARCO) | `si` |

`\estiloBibliografia` pasa a biblatex + biber: `ieee` \| `apa` \| `numeric` \| `authoryear` \| `alphabetic` (por defecto `ieee`). Los nombres antiguos se aceptan: `ieeetr`→`ieee`, `plain`→`numeric`, `alpha`→`alphabetic`, `apalike`→`apa`. `\bibliography{bibliografia}` en `tfg.tex` sigue funcionando (la clase lo convierte en `\addbibresource` + `\printbibliography`). Fechas en español con minúscula: «junio de 2026».

### API del panel

Los dos archivos son de la raíz `memoria`. Cada campo se lee de la **primera línea no comentada** que empieza por su comando y se reescribe **solo su argumento** (llaves equilibradas), conservando el resto de la línea (comentarios). Si el comando no está, se añade al final bajo `%% Añadido por Estudio TFG`. Los valores viajan sin escapar; el server escapa `& % $ # _ { } ~ ^ \` al escribir y deshace esos escapes al leer.

- `GET /api/memoria/datos` → `{ datos: Record<campo, string>, institucion: Record<campo, string>, rev: { datos: string|null, institucion: string|null } }`
  - Claves: el nombre del comando sin `\` (`titulo`, `fecha` …). Comandos de dos o más argumentos: `fecha` → `{ fechaMes, fechaAnio }`; `margenes` → `{ margenInterior, margenExterior, margenSuperior, margenInferior }`.
  - `rev` = null si el archivo no existe (memoria anterior a v0.5).
- `PUT /api/memoria/datos` `{ datos?: Partial, institucion?: Partial, baseRev: { datos?: string, institucion?: string } }` → igual que GET.
  - **409** `{ error, current }` si el `baseRev` de un archivo tocado no coincide (current = respuesta GET actual). **400** `{ error, field }` si un valor no está en su lista (`modo`, `licencia`, `tipoTrabajo`…), una longitud no es válida o la memoria no tiene `institucion.tex` y se piden campos de institución.
  - Escritura atómica con copia en el historial, como el resto; emite el evento de cambio normal.
- `POST /api/memoria/logo` (multipart, campo `file`: pdf, png o jpg, máx. 5 MB) → guarda `estilo/logo.<ext>`, pone `\logo{logo.<ext>}` y devuelve lo mismo que GET. `DELETE /api/memoria/logo` → `\logo{}`.
- `GET /api/templates/perfiles` → `{ perfiles: [{ id, nombre, descripcion }] }`.
- `POST /api/settings/init-memoria` acepta además `{ perfil?: string }` (por defecto `esi-uclm`); `npm run init` acepta `--perfil <id>`.

### Interfaz

- En la vista Documento, «Datos del trabajo» abre el panel **Datos del trabajo** (pestaña `datos`) en vez de `datos.tex`; el menú de esa fila ofrece también «Abrir datos.tex».
- Secciones del panel: **Trabajo** (título, autor, email, tutor, cotutor, departamento, especialidad, fecha, ciudad), **Resumen** (palabras clave, keywords), **Documento** (idioma, formato, modo, bibliografía, licencia, atribución), **Institución** (todos los de `institucion.tex`, con subida del logo y vista previa).
- Guardado al salir de cada campo (o ⌘S), con indicador «Guardado» como los editores; un 409 muestra los valores nuevos y avisa. Tras guardar, si el PDF queda desactualizado se ofrece «Compilar».
- Si la memoria no tiene `institucion.tex` (anterior a v0.5), la sección Institución muestra «Esta memoria usa la plantilla anterior; podrás actualizarla más adelante» y no se puede editar.
- Ajustes → «Crear memoria desde plantilla» deja elegir el perfil.

## Actualizar plantilla (v0.6)

Lleva una memoria existente a la plantilla actual **sin tocar lo que ha escrito el usuario**. Sirve para memorias v0.3 (`estilo/esi-tfg.cls`) y para futuras versiones de `estilo/memoria.cls`.

### Versiones y manifiestos

- `templates/manifiestos/<version>.json` = `{ version, clase, archivos: { "<ruta>": "<sha256>" } }`: el hash de cada archivo **tal como lo creó la plantilla** en esa versión (por perfil cuando difieran: clave `"<perfil>:<ruta>"`). Hay uno para `v0.3` (generado desde el commit 2529624, `templates/esi-tfg/`) y otro para la versión actual. `npm run template:manifest` regenera el actual; un test falla si está desactualizado.
- La versión de la clase de una memoria se lee de su `\ProvidesClass` (`estilo/memoria.cls` o `estilo/esi-tfg.cls`).
- Un archivo de la memoria está **sin tocar** si su hash coincide con el de su manifiesto; solo esos se pueden sustituir sin preguntar.

### Qué hace (por tipo de archivo)

| Archivo | Acción |
|---|---|
| `estilo/` (clase, logo) | Zona «no tocar»: se sustituye la clase; `estilo/esi-tfg.cls` se retira; se añade `estilo/institucion.tex` del perfil elegido (y su logo) si no existe. Nunca se pisa un `institucion.tex` existente |
| `tfg.tex` | Edición puntual en el sitio: `\documentclass{estilo/esi-tfg}` → `{estilo/memoria}`; el bloque `\tableofcontents` … `\lstlistoflistings` → `\indices` solo si esas líneas siguen como en la plantilla. Nada más |
| `datos.tex` | Se conservan todos los valores; se añaden los comandos que falten (`\keywords`, `\modo`, `\licencia`, `\atribucion`…) bajo `%% Añadido por Estudio TFG`. Si el perfil es `esi-uclm` y falta `\ciudad`, se añade `\ciudad{Ciudad Real}` (antes era el valor por defecto de la clase) |
| Contenido (`0-inicio/`, `1-capitulos/`, `2-anexos/`, `bibliografia.bib`, `LEEME.md`) | Se sustituye **solo si está sin tocar**; si el usuario lo cambió, se deja y se lista como «revisar a mano» con el motivo (p. ej. «abstract.tex escribe las keywords a mano: usa \mostrarPalabrasClave») |
| `.gitignore` | Se añaden las líneas que falten |
| Cualquier otro archivo | No se toca |

### API

- `GET /api/memoria/plantilla?perfil=<id>` → `{ estado, versionMemoria, versionPlantilla, perfil, cambios: [{ archivo, accion, motivo }], revisar: [{ archivo, motivo }] }`
  - `estado`: `actual` | `desactualizada` | `desconocida` (no se reconoce la clase: no se ofrece actualizar).
  - `accion`: `crear` | `sustituir` | `editar` | `retirar`. `perfil`: el pedido, o el deducido (`esi-uclm` si usa el logo de la ESI; si no, `generico`).
  - Es una vista previa: no escribe nada.
- `POST /api/memoria/plantilla/actualizar` `{ perfil }` → `{ aplicados: [...cambios], revisar, commit: string|null, deshacer: string }`
  - **409** si algún archivo afectado tiene cambios sin guardar (el cliente guarda todo antes) o cambió desde la vista previa (se recalcula en el momento y se compara con la que se envía: `{ perfil, cambios }`).
  - Cada archivo afectado se copia antes al historial; la operación guarda un registro `deshacer` (id).
  - Si la memoria es un repositorio git: commit **solo de los archivos afectados** con el mensaje «Actualizar plantilla a <versión>»; los demás cambios del usuario no se incluyen. Sin git, `commit` = null.
- `POST /api/memoria/plantilla/deshacer` `{ id }` → restaura los archivos desde el historial (y, si hubo commit y sigue siendo el último, lo revierte con un commit nuevo). Solo la última actualización.

### Interfaz

- El panel **Datos del trabajo** muestra, si `estado = desactualizada`, un aviso «Hay una versión nueva de la plantilla» con «Actualizar…»; en la sección Institución sustituye al aviso de «plantilla anterior».
- «Actualizar…» abre un diálogo: selector de perfil (solo si no hay `institucion.tex`), lista de cambios agrupada (crear / sustituir / editar / retirar) y «Revisar a mano», y los botones Cancelar / Actualizar. Al terminar: guarda todo antes, aplica, recompila y muestra el resultado con «Deshacer».

### Precisiones de la implementación (v0.6)

Ampliaciones y detalles que el texto anterior no fijaba:

- **Manifiestos.** La versión actual se llama `PLANTILLA_VERSION` (`scripts/memoria-template.mjs`, hoy `v0.5`, la versión del contrato que introdujo la plantilla) y `clase` es `"<nombre> <versión>"` del `\ProvidesClass` (`"estilo/memoria v3.0"`, `"estilo/esi-tfg v2.0"`). Campos añadidos: `comandosDatos` (comandos del `datos.tex` de esa versión; los que añade la actualización son los de la versión actual que no estaban en la de la memoria). Un valor de `archivos` puede ser una lista de hashes conocidos (el primero es el actual): `v0.3` acepta también la clase anterior al arreglo de epstopdf, y `npm run template:manifest` conserva los hashes antiguos de la misma versión. Si cambia la versión de la clase, el script se niega a sobrescribir: hay que subir `PLANTILLA_VERSION`. `--check` comprueba sin escribir; `--v0.3` regenera `v0.3.json` desde git.
- En `v0.3.json` los capítulos van con clave `esi-uclm:` (la plantilla v0.3 equivale a ese perfil): con el perfil genérico no se cambian los capítulos de la ESI por los del genérico, aunque sigan sin tocar.
- **Vista previa.** Cada cambio lleva además `rev` (revisión de 16 caracteres del archivo en la vista previa; `null` si no existe). `datos.tex` y `.gitignore` solo se editan al pasar de una versión a otra; en la misma versión solo se sustituyen la clase (si difiere) y el contenido sin tocar con un hash antiguo. `\keywords` se añade con las de ejemplo solo si `\palabrasClave` sigue siendo la de ejemplo; si no, vacía. Los comandos añadidos llevan el comentario que tienen en la plantilla. `estilo/esi-tfg.cls` no se retira si `tfg.tex` aún la usa (se lista en «revisar»). Un perfil desconocido en `?perfil=` → **400** `{ error, field: "perfil" }`; con `institucion.tex` el parámetro se ignora.
- **Actualizar.** La comparación con la vista previa usa `archivo`, `accion` y, si el cliente los envía, `motivo` y `rev`. El **409** responde `{ error, actual }` (`actual` = vista previa recalculada); también si la memoria ya está al día o es `desconocida`. Si el commit falla, los archivos quedan actualizados y se añade a `revisar` `{ archivo: ".git", motivo }`. Un archivo afectado con cambios sin commit previos entra en el commit con ellos.
- **Deshacer.** Responde `{ restaurados: string[], commit: string|null }`. El registro es `data/history/plantilla/<id>.json` (contenido anterior de cada archivo y hash del nuevo). **409** si `id` no es la última actualización, si ya se deshizo o si algún archivo afectado cambió después (no se pisa nada). El commit de deshacer se construye con un índice temporal: revierte solo las rutas de ese commit y no toca el resto del índice ni de la carpeta.
- **Interfaz.** El aviso sale arriba del panel y, si no hay `institucion.tex`, también en la sección Institución (en lugar del de «plantilla anterior»). Al abrir el diálogo se recalcula la vista previa; si al aplicar hay un 409, el diálogo muestra la lista nueva para confirmarla otra vez. Antes de aplicar se guardan el panel y todos los documentos de la memoria; si un archivo afectado sigue sin guardar o en conflicto, no se aplica.

## Gestión de archivos: carpetas, renombrar, mover y papelera (v0.7)

Operaciones de archivo para las dos raíces (`notes` y `memoria`), pensadas sobre todo para las notas. **Nada se borra de verdad** y los enlaces se mantienen al renombrar o mover.

### API

- `POST /api/dir` `{ root, path }` → 201 `{ path }`. Crea carpetas intermedias. **409** si ya existe (archivo o carpeta).
- `POST /api/move` `{ root, from, to, updateLinks?: boolean }` (por defecto `true`) → `{ path, moved: [{ from, to }], updated: [{ path, rev }] }`
  - Sirve para renombrar y para mover, archivos o carpetas (con todo su contenido). Crea carpetas intermedias de `to`.
  - `moved` lista cada archivo movido (una carpeta se expande en sus archivos). `updated` lista los archivos reescritos para mantener enlaces.
  - **404** si `from` no existe; **409** si `to` ya existe; **400** si `to` está dentro de `from`, si alguna ruta sale de la raíz o es la raíz.
  - Los archivos reescritos se guardan como cualquier escritura: atómica, con copia en el historial y bloqueo; emiten su evento `change`.
- `DELETE /api/file?root&path` (archivo o carpeta) → `{ path, trashPath }`. Mueve a la papelera:
  - `notes`: `<notas>/.trash/<path>` (la papelera de Obsidian). Si ya existe, se añade ` (2)`, ` (3)`… antes de la extensión.
  - `memoria`: `data/trash/memoria/<marca de tiempo>/<path>` (fuera del git de la memoria).
  - `trashPath` es opaco para el cliente: solo sirve para restaurar.
- `POST /api/trash/restore` `{ root, path, trashPath }` → `{ path }`. Devuelve el archivo o carpeta a `path`; **409** si `path` existe ahora.
- Eventos: además de `add`/`change`/`unlink`, el server emite `event: change` con `{ root, path: <to>, from, kind: "move" }` por cada archivo movido, **antes** de los `unlink`/`add` que detecte el vigilante. `.trash/` sigue oculta del árbol y la búsqueda (como toda carpeta que empieza por punto).

### Mantener enlaces (`updateLinks`)

Se calcula con las rutas **antes** de mover: cada enlace que apuntaba a un archivo movido se reescribe para que siga apuntando a él, y los enlaces relativos **dentro** de los archivos movidos se recalculan. Solo se reescribe el destino del enlace; el resto del texto no cambia.

- `notes` (en todos los `.md`):
  - Wikilinks `[[destino]]`, `[[destino|alias]]`, `[[destino#título]]`, `[[destino^bloque]]` y embebidos `![[…]]`. El destino se resuelve con la misma lógica que `GET /api/notes/resolve`. Se conserva la forma: si era solo el nombre y el nuevo nombre sigue sin ser ambiguo, queda solo el nombre nuevo; si llevaba ruta, ruta nueva; con o sin `.md` como estaba.
  - Enlaces Markdown `[texto](ruta)` y `![alt](ruta)` relativos (no `http:`, `mailto:`…), respetando la codificación (`%20`) y los anclajes `#…`.
  - En notas de recurso, el campo `attachment:` del frontmatter.
- `memoria` (en todos los `.tex`): `\input{…}`, `\include{…}`, `\includegraphics[…]{…}`, `\bibliography{…}`, `\addbibresource{…}`; rutas relativas a la raíz de la memoria, con o sin extensión como estaban. En `\includegraphics`, se tienen en cuenta las carpetas de `\graphicspath` de la plantilla (`figuras/`, `estilo/`).
- No se reescriben enlaces dentro de bloques de código (``` … ``` y `` `…` `` en Markdown; `verbatim`/`lstlisting` y comentarios `%` en LaTeX).

### Interfaz

- **Menú contextual del árbol**:
  - Archivo: Abrir, Abrir al lado, Renombrar (F2), Mover a…, Eliminar (Supr / ⌘⌫), Copiar ruta.
  - Carpeta: Nueva nota aquí / Nuevo archivo aquí, Nueva carpeta aquí, Renombrar, Mover a…, Eliminar, Copiar ruta.
  - Zona vacía del árbol: Nueva nota / Nuevo archivo, Nueva carpeta.
- **Cabecera de la sección**: botones «Nueva nota» y «Nueva carpeta» (en la memoria, «Nuevo archivo» y «Nueva carpeta»).
- **Renombrar** en línea dentro del árbol: el nombre se selecciona sin la extensión; ↵ confirma, Esc cancela; si no se escribe extensión se conserva la que tenía.
- **Mover**: arrastrar y soltar archivos y carpetas sobre una carpeta o sobre la raíz (la carpeta destino se resalta y se despliega tras un momento), o «Mover a…» (diálogo con buscador de carpetas y «Nueva carpeta…»).
- **Eliminar**: va a la papelera sin pedir confirmación para un archivo (toast con «Deshacer»); para una carpeta se confirma indicando cuántos archivos contiene. Si el archivo tiene cambios sin guardar, se pide confirmación.
- **Pestañas abiertas**: antes de mover se guardan los documentos afectados con cambios; después, las pestañas, los borradores, recientes y el estado de carpetas desplegadas pasan a la ruta nueva sin cerrar ni recargar el editor. Al eliminar se cierran sus pestañas.
- Tras mover, toast «Movida a <ruta> · N archivos con enlaces actualizados».
- **Crear**: una nota nueva se abre en modo edición. En la búsqueda rápida (⌘K), si no hay coincidencia exacta, se ofrece «Crear nota «texto»» (admite `Carpeta/Nombre`). Al pulsar un `[[enlace]]` a una nota que no existe, se ofrece crearla (en la carpeta de la nota actual).

### Precisiones de la implementación (v0.7)

Detalles del servidor que el texto anterior no fijaba:

- **Respuestas.** `POST /api/move` añade `failed: [{ path, error }]` **solo** si alguna reescritura de enlaces falló: el movimiento ya está hecho, `updated` lista lo que sí se reescribió y los archivos de `failed` quedan como estaban (nunca a medias). `moved` lista los archivos no ignorados (los ocultos, `*.lock`… se mueven con la carpeta pero no se listan). Renombrar cambiando solo mayúsculas (`nota.md` → `Nota.md`) no da 409 aunque el sistema de archivos no las distinga. `POST /api/dir` también da **409** si un tramo de la ruta es un archivo. `DELETE /api/file` da **404** si no existe y **400** con la raíz, fuera de ella o dentro de `.trash/`. `POST /api/trash/restore` da **404** si `trashPath` no está en la papelera (o sale de ella).
- **`trashPath`.** En `notes` es la ruta dentro de `.trash/` (p. ej. `A/n (2).md`); en `memoria`, `<marca de tiempo>/<path>` dentro de `data/trash/memoria/`. El sufijo ` (n)` se pone en el tramo que choque (si una carpeta intermedia de la papelera es un archivo, también en ella). Al restaurar se quitan las carpetas que queden vacías en la papelera.
- **Sin sobrescribir nunca.** Un archivo se mueve con `link` + `unlink` (falla si el destino existe); una carpeta, con `rename`. Si cruza de dispositivo (`EXDEV`), se copia sin sobrescribir y solo después se quita el origen. Mover, eliminar, restaurar y crear carpeta se serializan por raíz, y un archivo suelto además con su bloqueo (no se cruza con un guardado).
- **Eventos.** `move` se emite justo cuando el destino ya existe (tras el `rename`/`link`), antes de quitar el origen: nunca se anuncia un movimiento que falló, y llega antes que el `unlink`/`add` del vigilante (el `add` además espera a que el archivo se estabilice). Los eventos del vigilante **no se suprimen**: llegan después y son inofensivos (un `unlink` de una ruta que ya no está abierta y un `add` que refresca el árbol). Eliminar y restaurar no emiten nada propio: basta el `unlink`/`add` del vigilante (`.trash/` está ignorada). Los archivos con enlaces reescritos emiten su `change` por el vigilante, como cualquier guardado.
- **Resolución de wikilinks.** `GET /api/notes/resolve` y el mantenimiento de enlaces usan el mismo resolvedor (`makeResolver`, indexado). Desde v0.7 también ignora `^bloque` (`[[Nota^b]]` resuelve a `Nota`).
- **Cuándo se reescribe un enlace (notas).** Se resuelve con los archivos y la ruta de la nota de antes; si con los de después ya no apunta al mismo archivo, se reescribe. Esto incluye enlaces a notas **no movidas** cuyo significado cambiaría (p. ej. `[[Nota]]` cuando otra `Nota.md` llega a la raíz). «Solo el nombre» se conserva solo si el nombre es único tras mover; si no, pasa a ruta desde la raíz. Una ruta parcial (`Carpeta/Nota`) pasa a ruta completa. `[[#título]]` (misma nota) no se toca. En una tabla, `[[Nota\|alias]]` se respeta.
- **Enlaces Markdown.** Forma relativa a la nota (`../B/x.md`, `./img.png`; en una nota de la raíz, toda ruta se toma como relativa) → sigue relativa desde la ruta nueva; desde la raíz → ruta desde la raíz; solo el nombre (resuelto por nombre) → nombre si es único. Se conservan `#anclaje`, título `"…"` y `<…>`. Codificación: si el original llevaba `%XX` de caracteres no ASCII se codifica cada tramo con `encodeURIComponent`; si no, solo espacio, `%`, `(`, `)`, `#`, `<`, `>` (un nombre nuevo con espacios lleva `%20`). Se omiten `http:`, `mailto:`… y las rutas que empiezan por `/` o `#`.
- **`attachment:`.** En cualquier nota con ese campo en el frontmatter (no solo en `Recursos/`): relativo a la carpeta de la nota (como lo escribe la captura) o, si no existe así, desde la raíz; se conserva la forma y las comillas (`"…"`, `'…'` o sin comillas).
- **Código (Markdown).** Bloques ``` y ~~~ (cierre con el mismo carácter y al menos la misma longitud) y código en línea con el mismo número de comillas, sin cruzar una línea en blanco. Los wikilinks del frontmatter (propiedades de Obsidian) sí se reescriben.
- **LaTeX.** `\input{x}` busca `x.tex` y luego `x`; `\include{x}`, `x.tex`; `\bibliography{a,b}` (cada uno) `a.bib` y luego `a`; `\addbibresource` exacto; `\includegraphics` (también con `*` y varios `[…]`) en la raíz y luego en las carpetas de `\graphicspath` declaradas en los `.tex`/`.cls`/`.sty` de la memoria (si no hay ninguna, `figuras/` y `estilo/`), con las extensiones `.pdf .png .jpg .jpeg .mps .jbig2 .jb2 .eps` (y en mayúsculas). Si el original iba relativo a una carpeta de `\graphicspath`, el nuevo también cuando es posible. Se omiten comentarios `%` (no `\%`), los entornos `verbatim`, `Verbatim`, `lstlisting`, `minted` y `comment`, `\verb` y `\lstinline`, y los argumentos con macros (`\`, `#`, `$`).
- **Límites.** Solo se reescriben archivos de hasta 2 MB en UTF-8 válido; los demás se dejan sin tocar. Cada archivo reescrito: bloqueo, copia en el historial (con su ruta nueva si se movió) y escritura atómica.

## Autocompletado LaTeX y diagramas para la memoria (v0.8)

### Autocompletado de citas, referencias y acrónimos

- `GET /api/memoria/refs` → `{ citas: Cita[], etiquetas: Etiqueta[], acronimos: Acronimo[] }`
  - `Cita = { key, tipo, titulo, autor, anio, archivo }`: entradas de los `.bib` de la memoria (los de `\bibliography{…}`/`\addbibresource{…}` de los `.tex` y, si no hay, todos los `.bib`). `autor` abreviado («García y Pérez», «Sommerville et al.»); campos LaTeX simplificados para mostrar (sin llaves ni comandos).
  - `Etiqueta = { label, tipo, texto, archivo, linea }`: cada `\label{…}` de los `.tex` (sin comentarios). `tipo`: `capitulo` | `seccion` | `figura` | `tabla` | `listado` | `ecuacion` | `anexo` | `otro`, según el entorno o comando que la contiene; `texto` = el título o el `\caption` asociado.
  - `Acronimo = { sigla, significado, archivo, linea }`: los `\acro{…}{…}` de la memoria.
  - Se calcula bajo demanda con caché que se invalida con los eventos de cambio de la memoria.
- En el editor LaTeX, CodeMirror ofrece sugerencias al escribir dentro de:
  - `\cite{`, `\textcite{`, `\parencite{`, `\autocite{`, `\citep{`, `\citet{`, `\nocite{` (varias claves separadas por comas): clave, título, autor y año; filtra por clave, título o autor.
  - `\ref{`, `\pageref{`, `\autoref{`, `\cref{`, `\Cref{`, `\eqref{`: etiqueta con su tipo y texto.
  - `\ac{`, `\acs{`, `\acl{`, `\acf{`, `\acp{`…: sigla y significado.
  - La lista se refresca al guardar cualquier archivo de la memoria. No sustituye a los avisos de la compilación.

### Diagramas

Los diagramas viven en la memoria: fuente en `diagramas/<nombre>.mmd` (Mermaid) y figura exportada en `figuras/diagramas/<nombre>.pdf` (vectorial, lo que usa LaTeX) junto a `figuras/diagramas/<nombre>.svg`. Así se compilan y versionan con la memoria.

- **Panel Diagrama**: abrir un `.mmd` de la memoria abre el panel `diagram` (fuente a la izquierda con CodeMirror; vista previa en vivo a la derecha con Mermaid, con el error de sintaxis y su línea si no se puede dibujar). Barra: guardar, **Exportar** (PDF + SVG; también PNG a 2× para descargar), **Insertar en la memoria**, y el estado de la figura: «Sin exportar» | «Exportada» | «Desactualizada» (la fuente cambió desde la última exportación).
- **Vista previa editable**: el panel es un editor visual ([Visimer](https://github.com/inkeep/visimer), MIT, sobre nuestro Mermaid) con cuatro zonas: barra superior (nombre, estado de la figura, **Código**, Deshacer, Guardar, PNG, Exportar, Insertar), **paleta «Bloques»** a la izquierda, lienzo en el centro y **propiedades** a la derecha, más una barra de estado («Diagrama de flujo · N bloques · M conexiones · Guardado / Sin guardar»). La paleta depende del tipo (flujo: Inicio / fin, Paso, Decisión, Datos, Base de datos y Grupo; secuencia: Participante, Actor, Mensaje y Nota; estados: Estado, Inicio, Fin y Decisión; clases: Clase y Atributo o método; entidad-relación: Entidad, Atributo y Relación). Un bloque se **arrastra al lienzo** (soltado sobre otro bloque se une a él; soltado en vacío queda suelto) o se añade con un clic (unido al seleccionado en flujo y estados); el nuevo queda seleccionado y con su texto en edición. Con un bloque seleccionado aparece una barra flotante propia (Cambiar texto, Cambiar forma, Conectar —clic en el bloque de destino—, Añadir bloque después y Borrar) y el panel de propiedades muestra su texto, forma (o tipo), conexiones entrantes y salientes (con etiqueta editable, quitar y «Conectar con…» con búsqueda) y la dirección del diagrama (↓ / →, en flujo, estados y clases); sin selección, los datos del diagrama. Doble clic escribe sobre el bloque. Cada edición reescribe el `.mmd` al momento como un cambio más del documento (sin guardar, borrador, ⌘S y ⌘Z/⇧⌘Z como en el editor de código) y lo escrito en el código vuelve a dibujar el lienzo. El botón **Código** de la barra muestra u oculta el editor de código a la izquierda del lienzo (por defecto oculto; se recuerda en `et:diagram:code`); en un diagrama sin edición visual se muestra siempre y el lienzo es de solo lectura («Este tipo de diagrama solo se puede editar con código»). En paneles estrechos la paleta queda en iconos y las propiedades pasan a un cajón (`et:diagram:palette`, `et:diagram:props`).
- **Nuevo diagrama**: desde el árbol de la memoria (menú de carpeta y cabecera) y la búsqueda rápida; pide nombre y plantilla: flujo, secuencia, estados, arquitectura (bloques con subgrafos), modelo de datos (ER) y clases. Crea `diagramas/<nombre>.mmd`.
- **Aspecto de impresión**: tema claro y neutro (blanco y negro con grises), sin depender del tema de la app; etiquetas como texto SVG puro (sin `foreignObject`) para que la conversión a PDF sea fiel; la misma fuente para medir en el navegador y para dibujar el PDF (una fuente libre servida por la app e instalada en el worker), parecida a la sans de la memoria.
- **Exportar**: el navegador dibuja el SVG y lo envía; el server lo convierte a PDF con el worker y guarda los dos archivos. La figura exportada lleva un registro de qué versión de la fuente la generó.
  - `POST /api/diagramas/exportar` `{ path, svg, rev }` (`path` = el `.mmd`; `rev` = la revisión de la fuente que se dibujó) → `{ pdf, svg, exportadoEn }`. **409** si la fuente cambió (`rev` distinto). **400** si el SVG no es válido o supera 5 MB.
  - `GET /api/diagramas/estado?path` → `{ estado: 'sin-exportar'|'exportado'|'desactualizado', pdf, svg, exportadoEn }`.
  - Worker: `POST /svg2pdf` (cuerpo `image/svg+xml`, máx. 5 MB) → `application/pdf`. Conversión sin shell, con tiempo límite, sin red; rechaza SVG con referencias externas (`href` a http/https/file).
  - Una figura exportada solo cambia con una exportación explícita.
- **Insertar en la memoria**: diálogo con el capítulo o archivo destino (lista de la vista Documento), posición (en el cursor si ese archivo está abierto en un editor; si no, al final del apartado elegido), pie de figura, etiqueta (`fig:<nombre>` por defecto) y ancho (% del texto). Exporta si hace falta e inserta:

  ```latex
  \begin{figure}[htbp]
    \centering
    \includegraphics[width=0.8\textwidth]{diagramas/<nombre>}
    \caption{<pie>}
    \label{fig:<nombre>}
  \end{figure}
  ```

  (`diagramas/<nombre>` se resuelve dentro de `figuras/` por el `\graphicspath` de la plantilla.) Después ofrece compilar.
- **Avisos**: el árbol de la memoria marca los diagramas desactualizados; la vista Documento muestra un aviso en el apartado que incluye una figura desactualizada.
- **Sección Diagramas** (barra lateral, entre Memoria y Notas): lista los diagramas de `diagramas/` con el estado de su figura (Exportada / Desactualizada / Sin exportar) y cuántas veces se usa en la memoria; filtro, «Nuevo diagrama» y, por diagrama (clic derecho o ⋯): Abrir, Abrir al lado, Exportar, Insertar en la memoria, Ver uso en…, Renombrar (renombra también `figuras/diagramas/<nombre>.{pdf,svg}`; los `\includegraphics` se actualizan), Copiar `\includegraphics` y Eliminar (a la papelera; si la figura se usa en la memoria se conserva para que siga compilando).
- **Desde las notas**: cada bloque ```mermaid de una nota (modo lectura) tiene «Usar en la memoria», que **copia** el bloque a `diagramas/<nombre>.mmd` (pidiendo el nombre) y abre el panel Diagrama. Es una copia explícita: la nota y el diagrama quedan independientes.

### Precisiones de la implementación: diagramas (v0.8)

- **Rutas.** Solo se exportan los `.mmd` dentro de `diagramas/` (también en subcarpetas: `diagramas/a/b.mmd` → `figuras/diagramas/a/b.{pdf,svg}`, `\includegraphics{diagramas/a/b}`); cualquier otro `.mmd` de la memoria abre el panel pero no se exporta (**400**). Al crear, el nombre se sanea (sin tildes, espacios ni símbolos: `[A-Za-z0-9_-]` y `/`).
- **Registro de la exportación.** Va dentro del SVG exportado, justo tras la etiqueta `<svg>`: `<metadata id="estudio-tfg-diagrama">{"fuente":"diagramas/x.mmd","rev":"<rev del .mmd>","exportadoEn":"<ISO>"}</metadata>` (JSON escapado para XML). `estado`: `sin-exportar` si falta el PDF o el SVG; `exportado` si el `rev` registrado es el del `.mmd` en disco; `desactualizado` si no (también si el SVG no tiene registro). Volver a exportar sustituye el registro.
- **Exportar.** El server comprueba el SVG (raíz `<svg>`, ≤ 5 MB, sin `foreignObject`) y `rev` antes de llamar al worker y otra vez, con los bloqueos del `.mmd` y de las dos figuras, antes de escribir; **409** `{ error, rev }` (`rev` = la actual). Escribe primero el PDF y después el SVG (con el registro), cada uno atómico y con copia en el historial si ya existía; no emite eventos propios (bastan los del vigilante). Errores: **400** con el motivo del worker si rechaza el SVG, **502** si el worker falla o no devuelve un PDF, **503** si no responde (o no tiene `/svg2pdf`: hay que reconstruirlo).
- **`GET /api/diagramas/estado` sin `path`** → `{ items: { path, nombre, estado, pdf, svg, exportadoEn, usos: { file, line }[] }[] }`: todos los `.mmd` de `diagramas/` y, en `usos`, cada `\includegraphics` (fuera de comentarios) de los `.tex` que apunta a la figura (`diagramas/x`, `figuras/diagramas/x`, con o sin extensión). Lo usan las marcas del árbol y el aviso de la vista Documento (el aviso va en el apartado más interno del mismo archivo que empieza antes del `\includegraphics`, y en sus padres).
- **Worker `POST /svg2pdf`.** `rsvg-convert --format=pdf` con `spawn` (sin shell), en su propio grupo de procesos, 20 s como máximo (`SVG_TIMEOUT_MS`; **504** si se agota), de una en una y aparte de la cola de compilación. El SVG entra por stdin (sin URL base: rsvg no puede abrir archivos relativos) y el PDF sale a un temporal en `/tmp` que se borra. Antes se rechaza (**400**) un SVG con `DOCTYPE`/`ENTITY`, `<?xml-stylesheet`, `href`/`xlink:href`/`src` que no sean `#…` o `data:`, `url(…)` externas, `@import` o escapes CSS; **415** sin `Content-Type: image/svg+xml`; **413** si pasa de 5 MB.
- **Fuente.** Source Sans 3 (OFL-1.1) de `@fontsource/source-sans-3` **5.3.0** (versión fija en `web/package.json` y en `worker/Dockerfile`, que descarga ese paquete npm con su sha256). La web carga sus `.woff` (latin y latin-ext) con `FontFace` y espera a `document.fonts.load` antes de dibujar; el worker instala los mismos `.woff` pasados a `.ttf` (Pango no abre `.woff`; las tablas no cambian) y una regla de fontconfig descarta la Source Sans 3 de TeX Live para que no se use otra versión. Si se cambia la versión, hay que cambiarla en los dos sitios.
- **Lienzo editable.** Edición visual para flujo, secuencia, estados, clases y entidad-relación; el resto de tipos (pastel, Gantt, mapas mentales…) se ven en el lienzo pero se editan solo con código. Visimer hace cambios mínimos sobre el texto: conserva comentarios, `%%{init}%%`, `classDef`, el orden y la sangría; lo que añade lo pone donde corresponde (p. ej. un nodo nuevo, tras la última línea). El lienzo se dibuja con la misma configuración que la exportación (aspecto de impresión, texto SVG puro, Source Sans 3), pero la figura exportada se genera aparte, como antes. El historial de deshacer es el del editor de código, que sigue montado aunque esté oculto. Con un error de sintaxis el lienzo queda en solo lectura (con el último dibujo correcto, atenuado) hasta corregirlo; el aviso lleva al código. Se carga en diferido (`DiagramCanvas`, ~150 kB). Limitaciones: la barra flotante de Visimer (colores, estilo de flecha, duplicar…) está oculta y sustituida por la propia; los textos por defecto que crea con sus propios menús (p. ej. «message» en el «+» de una línea de vida) están en inglés; el resto de la interfaz está en español.
- **Aspecto de impresión.** Tema `neutral`, `htmlLabels: false`, `deterministicIds` (mismo SVG para la misma fuente), sin filtros ni sombras (además meterían transparencias en el PDF) y fondo opaco en las etiquetas de las flechas. Al preparar el SVG: `width`/`height` en px del `viewBox` (rsvg: 1 px = 0,75 pt), `xml:space="preserve"` en cada `<text>` (Mermaid pone el espacio entre palabras al principio de cada `<tspan>` y rsvg lo descartaría) y, en los diagramas de estados, la etiqueta centrada en su caja. Las notas siguen dibujándose con el tema de la app (cada dibujo fija su configuración en una cola: `web/src/lib/mermaid.ts`).
- **Insertar.** El ancho por defecto se calcula con las proporciones del diagrama: como mucho 80 %, sin agrandar el texto por encima de su tamaño natural y sin pasar de media página de alto (mínimo 30 %); 100 % se escribe `width=\textwidth`. En el cursor: tras la línea del cursor del editor abierto, como una edición más (queda sin guardar y se deshace con ⌘Z). Si no está abierto: al final del apartado (antes del siguiente apartado que no es hijo suyo si está en el mismo archivo; si no, al final del archivo o antes de `\end{document}`), con `PUT /api/file` y su `baseRev`. Se deja una línea en blanco alrededor del bloque.
- **Compilación.** Los PDF de cairo llevan grupo de transparencia de página; si dos caen en la misma página pdfTeX avisa «multiple pdfs with page group included in a single page». Es inofensivo y el worker lo omite de los diagnósticos.


## Ajustes multiplataforma (v0.9)

- Las respuestas de ajustes (`GET`, `PUT`, reset e init-memoria) y el evento SSE `settings` añaden `pathSep: "/" | "\\"`, el separador del **servidor**. El selector y los campos de Ajustes aceptan rutas POSIX, unidades de Windows y recursos UNC; con Docker/WSL se usan las rutas del servidor aunque el navegador esté en Windows.
- `~`, `~/…` y `~\\…` expanden el home del servidor, también en `npm run init`. Las subcarpetas de recursos siguen siendo relativas, con `/`.
- `POST /api/settings/init-memoria` comprueba `git --version` antes de copiar. Sin Git crea y selecciona la memoria igualmente (HTTP 200), sin repositorio nuevo, y añade `warning: "La memoria se ha creado sin control de versiones: instala Git para tener historial y actualizaciones de plantilla"`. Con Git conserva el repositorio y commit inicial; `warning` se omite. `npm run init` usa la misma lógica y muestra el aviso. Ajustes conserva el aviso visible tras crearla; la actualización de plantilla sin repositorio sigue devolviendo `commit: null`.
- Las comprobaciones de raíces usan rutas canónicas nativas. `instanceId` mantiene SHA-256 truncado a 12 caracteres de `notesDir|memoriaDir`, con ambas rutas canónicas (ancestro existente más sufijo si aún no existen). En las rutas actuales de macOS el identificador se conserva; los alias de una misma carpeta comparten identificador. Al sustituir una configuración histórica con alias que daban otro hash, los borradores se mantienen en sus claves anteriores de `localStorage`; se pueden recuperar volviendo a esa configuración con la versión previa y guardándolos antes de actualizar.

## Vigilancia de archivos en Docker y unidades de red (v0.10)

- `WATCH_POLLING=auto|on|off`, por defecto `auto`. `auto` usa sondeo si existe `/.dockerenv` o alguna raíz vigilada es UNC (`\\servidor\recurso` o `//servidor/recurso`) o `/mnt/<letra>/…`. `on` lo fuerza y `off` usa eventos nativos. El sondeo comprueba archivos cada 1000 ms y espera 150 ms de estabilidad antes de notificar; se recalcula al cambiar carpetas.
- `GET /api/status` añade `watcher: "ok" | "error"` y, con error, `watcherMessage` en español con el detalle resumido. Los errores se registran en el servidor y permanecen hasta reiniciar la vigilancia (al cambiar Ajustes o reiniciar el servidor). Sin carpetas configuradas, el estado es `ok`.
- El evento SSE `watcher` lleva esos mismos campos cuando cambia el estado o termina un reinicio. La interfaz relee el estado y muestra «Cambios en disco sin vigilar» con el detalle en el tooltip, sin interrumpir la edición.

### Git en la app Docker

- La imagen de la app configura `safe.directory=*` a nivel de sistema **solo dentro del contenedor**, para poder crear commits en memorias montadas desde el host; no cambia la configuración Git del host.
- Al actualizar plantilla, una memoria sin `.git` sigue devolviendo `commit: null`. Si existe `.git` y falla la comprobación o el commit, `revisar` incluye una entrada para `.git` con las primeras tres líneas útiles de `stderr` (máximo 500 caracteres), visible en Datos del trabajo. Los archivos aplicados y su registro para deshacer se conservan.
- Si Git falla al deshacer una actualización con commit, la API devuelve 502 con ese detalle resumido antes de restaurar los archivos, para que se pueda corregir y reintentar.

### Carpetas y acceso en Docker

- El perfil `app` monta `HOST_HOME` en `/data/home`; por defecto usa `Documents` bajo `HOME` o `USERPROFILE` del host. Las raíces elegibles son `/data/home`, `/data/notes` y `/data/memoria`; los datos internos de compilación e historial quedan fuera del selector.
- Ajustes usa esas rutas POSIX del contenedor. Se puede elegir otro vault o crear una memoria bajo `/data/home` sin cambiar `.env`; la selección persiste en `data/settings.json`. App y worker comparten los artefactos del host `data/builds`.
- Si la carpeta inicial del selector está fuera de las raíces permitidas (por ejemplo, el padre `/data` de `/data/memoria` al crear una memoria), empieza directamente en la lista de raíces.
- El acceso a Ajustes mantiene la regla de loopback o `AUTH_TOKEN`: una conexión desde el navegador a un puerto publicado de Docker puede llegar con la IP del puente. El modo Docker se configura con un token propio y el navegador lo pide al entrar. Los puertos publicados siguen ligados a `127.0.0.1`.

## Operaciones de archivo multiplataforma (v0.11)

- En Windows, las escrituras y movimientos reintentan `rename`/`unlink` ante `EPERM`, `EACCES` o `EBUSY`, con espera creciente de hasta unos 2 s. Si el bloqueo persiste, responden **423** `{ error: "El archivo está en uso por otro programa; ciérralo y vuelve a intentarlo" }`. En POSIX no se reintenta. Un guardado fallido conserva el original y su historial; el cliente conserva la edición y muestra el error.
- Si un movimiento de archivo coloca el destino pero no puede quitar el origen, retira el destino recién creado antes de devolver el error. Si tampoco puede retirarlo (o ha sido sustituido), devuelve **423** con un aviso explícito de que el origen se conserva y la copia no se pudo retirar. Los eventos `move` solo se emiten tras completar el movimiento. Al renombrar una carpeta, `EPERM` con un destino existente se traduce a **409**.
- Si el sistema de archivos no admite enlaces duros, crear archivos, adjuntos y copias de historial usa una copia exclusiva (`open` con `wx`, escritura y `fsync`); nunca sobrescribe un destino existente. Los movimientos de archivos usan la misma alternativa y retiran la copia si falla borrar el origen. Esta creación alternativa es exclusiva pero no atómica: un lector externo puede ver el archivo mientras se escribe. Los guardados siguen usando temporal + `rename`. La capacidad de enlace se recuerda durante la sesión por pareja de volúmenes, para que un `EXDEV` entre ellos no desactive los enlaces dentro de un mismo volumen.
- Crear archivos/carpetas y mover o renombrar valida el nombre de destino y las carpetas intermedias nuevas en todos los sistemas. Rechaza `:`, `<>"|?*`, `/` y `\\` dentro de un nombre, caracteres de control (incluido DEL), punto o espacio final y nombres reservados de Windows (sin distinguir mayúsculas, con o sin extensión: `CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, también `COM¹–³`/`LPT¹–³`). Devuelve **400** `{ error: <motivo en español>, field: "path" | "to" }` antes de crear carpetas o mover el origen. Las lecturas y guardados de nombres antiguos se conservan; también se puede crear dentro de una carpeta antigua o sacar de ella un archivo.
- La captura sanea títulos y adjuntos, elimina los puntos finales de la extensión y añade ` (recurso)` al nombre reservado antes de su primera extensión (`CON` → `CON (recurso)`, `aux.txt` → `aux (recurso).txt`). El título mostrado y el frontmatter mantienen el texto original.

## Compatibilidad de documentos y rutas (v0.12)

- El editor conserva el separador LF o CRLF detectado al cargar o recargar el documento. Deshacer hasta el contenido guardado vuelve a dejarlo limpio. Los comandos añadidos a `datos.tex` y las ediciones puntuales de la actualización de plantilla conservan ese separador.
- Los hashes de manifiesto normalizan CRLF a LF en textos de plantilla (`tex`, `cls`, `sty`, `bib`, `md`, `txt`, `json`, `.gitignore` y `.gitattributes`); los binarios mantienen sus bytes. Se conservan los hashes históricos. Las revisiones `baseRev` y el registro para deshacer siguen comprobando los bytes exactos. Un cambio solo de saltos de línea no provoca una actualización de plantilla. Las memorias nuevas incluyen `.gitattributes` con LF para Git.
- El árbol, la búsqueda, la vigilancia y las fuentes de compilación omiten los archivos `desktop.ini`, `Thumbs.db` y `*.tmp` sin distinguir mayúsculas. Crear una memoria permite esos residuos en una carpeta vacía; una carpeta con esos nombres sigue contando como contenido. En Windows, el selector omite las carpetas de sistema conocidas y las que no puede leer por permisos; las raíces permitidas explícitas se mantienen.
- Los wikilinks y los enlaces reescritos al mover comparan los nombres en NFC, conservando la ruta real del disco. En Windows, los temporales de guardado usan `0644` para no heredar el atributo de solo lectura; los bloqueos del destino siguen devolviendo 423. Las llamadas Git habilitan `core.longpaths` solo para esa ejecución.

## Atajos y apertura al lado (v0.13)

- **Capturar**: `⌘⇧C` en Mac; `Ctrl+Mayús+F8` en Windows/Linux. **Ver en PDF** desde el editor: `⌘⇧J` en Mac; `Ctrl+Mayús+F9` en Windows/Linux. Los botones y la lista de Inicio muestran los mismos atajos. Las alternativas no utilizan Alt ni AltGr.
- Se conservan `⌘/Ctrl+K` (abrir/buscar), `⌘/Ctrl+E` (leer/editar nota), `⌘/Ctrl+B` (panel lateral fuera de campos de texto) y `⌘/Ctrl+S` (guardar). Los eventos ya atendidos, la composición de texto, AltGr y combinaciones con modificadores extra no disparan estas acciones.
- Los archivos, apartados, resultados de búsqueda, enlaces internos de Markdown, recursos, diagramas y enlaces entrantes aceptan **Alt+clic, Ctrl+Mayús+clic y clic central** para abrir al lado. Su menú contextual incluye «Abrir al lado»; los enlaces externos conservan el comportamiento del navegador. En Abrir/buscar también se acepta `Ctrl+Mayús+Intro`, además de `Alt+Intro`.
- En una página del PDF, esos gestos abren el código al lado mediante SyncTeX; `⌘/Ctrl+clic` sigue abriéndolo en el grupo activo. El menú contextual ofrece «Ir al código» y «Abrir al lado» en el punto elegido.

## Precisiones de portabilidad y contenido personal (v0.14)

- Una carpeta del repositorio cuyo nombre empieza por dos puntos, como `..datos`, sigue estando dentro del repositorio y se rechaza para notas o memoria. Solo `..` como segmento de salida representa una carpeta externa.
- La excepción `workspace/` respeta la comparación de mayúsculas de cada sistema: `WORKSPACE` también se admite en Windows; en POSIX se mantiene la distinción. Se comprueban tanto la ruta escrita como su ruta canónica.
- En Windows, las comprobaciones de pertenencia equiparan una ruta de unidad o UNC con su variante extendida `\\?\` antes de calcular la relativa, manteniendo los límites de carpeta y de unidad.
- El lanzador de desarrollo y el comprobador de plantilla reconocen su punto de entrada comparando las dos rutas canónicas, también cuando Windows utiliza un alias corto o cambia la capitalización.
- Si Git rechaza un commit durante la actualización de plantilla, los avisos de conversión LF/CRLF se omiten del resumen cuando hay otras líneas de error, para conservar el motivo del rechazo. Si solo hay avisos, se mantienen.


## Integridad de recursos (v0.15)

- `PATCH /api/resources` exige `baseRev`: sha256 de los bytes actuales, truncado a 16 caracteres hexadecimales. Ausente o inválido: **400**, sin escritura ni historial. Obsoleto: **409** `{ error:"conflict", content, rev }`; válido: conserva el resto del archivo, crea historial y escribe atómicamente bajo el bloqueo de la nota.
- La interfaz conserva el estado o las etiquetas pendientes en un diálogo de conflicto. «Recargar versión actual» muestra el archivo actual; «Reaplicar mi cambio» envía explícitamente la edición con esa revisión. Un nuevo conflicto vuelve a exigir revisión. «Descartar mi cambio» es explícito. Las acciones no restauran instantáneas antiguas de la lista ni reintentan sobrescrituras automáticamente.

## Capturas recuperables (v0.16)

- `GET /api/status` añade `libraryId`: hash de 32 caracteres de la ruta canónica del vault y su carpeta de recursos. Es estable entre reinicios y cambios de memoria. Cambiar vault o carpeta de recursos cambia el destino; trasladar el vault requiere revisar los pendientes.
- `POST /api/capture` acepta `operationId` (8–100 caracteres alfanuméricos o `-`) y `libraryId`; este último es obligatorio cuando se envía ID. Destino distinto: **409**, código `capture_destination_changed`. Un mismo ID y contenido normalizado devuelve siempre `{ path, title }`, incluso tras reinicio y sin reescribir una ficha editada posteriormente. Contenido diferente (incluidos nombre/bytes del adjunto): **409**, código `capture_id_conflict`. Las peticiones antiguas sin ID siguen admitidas y reciben un ID interno; para reintentos idempotentes, el cliente debe enviar el suyo.
- Toda captura usa una instantánea de configuración desde el inicio de la petición, antes de consumir el multipart. El registro durable vive en `BUILD_DIR/../captures/<libraryId>/<operationId>/operation.json`, con huella completa, nombres reservados, texto y estado `prepared`/`done`. El adjunto se guarda en `attachment` antes de publicarlo. Los nombres no sobrescriben archivos y las operaciones se serializan por biblioteca dentro del servidor. Se admite un único proceso servidor escribiendo en cada biblioteca/registro.
- En el arranque se completan las operaciones `prepared` del destino configurado. Si falta el adjunto de staging, el mismo reenvío lo repone. Archivos existentes con bytes distintos generan conflicto y se conserva el registro para recuperación; nunca se sobrescriben. El registro `done` conserva resultado/huella, sin texto duplicado; el staging se retira. No hay caducidad automática de recibos ni de operaciones pendientes: borrarlos rompe la garantía de reintento. Se incluyen en las copias de seguridad junto con la biblioteca.
- `GET /api/capture/operation?operationId=…&libraryId=…` devuelve `{ state:"unknown" | "prepared" | "done" }`; exige autorización normal y destino actual. La cola permite corregir texto solo si el servidor aún no registró esa operación. Si ya la recibió, primero se recupera el resultado y después se edita el recurso con `baseRev`.
- La cola del navegador usa IndexedDB `et:captures` (texto y Blob de adjunto, hasta 50 MB por archivo), con commit previo a cualquier envío y publicación en memoria solo tras persistir. Web Locks serializa acciones entre pestañas cuando está disponible. La cola se vuelve a leer antes de cada acción; en navegadores sin Web Locks la serialización se limita a una pestaña. Una respuesta perdida conserva el mismo ID; si falla retirar el pendiente local tras éxito remoto, se conserva y recupera el mismo recibo.
- **401**, **409** y validaciones conservan el contenido y bloquean reintentos automáticos. Errores de red/5xx/408/429 pueden reintentarse al volver la conexión o cada 60 s. «Pendientes» muestra destino, texto, adjunto y error; ofrece reintentar, editar y descartar con confirmación explícita. Descartar elimina la copia local; no elimina un recurso ya guardado en el servidor.
- La antigua clave `et:capture-queue` se migra con texto y adjuntos base64 en una sola transacción. Solo se retira tras confirmar el commit y el marcador de migración. Un fallo o colisión conserva el original. Las entradas migradas carecen de destino fiable: requieren «Asignar al vault actual» y después «Reintentar». Nunca se asignan ni se envían automáticamente. Fallos de cuota o almacenamiento aparecen en el formulario/cola; una captura que no se pudo persistir no se envía ni se anuncia como guardada.


## Recursos movibles y adjuntos (v0.17)

- `GET /api/resources` recorre los `.md` de `RESOURCES_SUBDIR` y sus subcarpetas, con las exclusiones habituales, sin salir de esa raíz al seguir enlaces ni repetir ciclos. Devuelve `{ items, warnings: { path, message }[] }`; un error parcial de lectura avisa en el listado sin ocultar los demás recursos.
- `GET /api/resources/file?path=…` lee una ficha Markdown de notas y devuelve `{ root, path, content, rev, mtime, attachmentPath: string | null, attachmentWarning? }`. La ruta del adjunto se resuelve en el servidor: primero desde la carpeta de la ficha, después desde la raíz del vault (formato histórico) y finalmente desde la carpeta de recursos original (compatibilidad con fichas trasladadas externamente). No se permiten rutas absolutas, URLs ni enlaces que escapen del vault. Si hay varias coincidencias se usa ese orden y se avisa de la ambigüedad; si el candidato prioritario es inseguro/inaccesible, se avisa sin sustituirlo silenciosamente.
- Lectura y reescritura de `attachment:` usan el mismo orden. Mover desde la app conserva las pestañas y recalcula enlaces con historial. Los cambios externos refrescan lista y ficha; una ficha trasladada fuera de la app se abre desde la nueva ruta del listado, sin inferir un movimiento a partir de archivos potencialmente distintos. La app no reescribe enlaces de terceros automáticamente. Los adjuntos ausentes/inaccesibles generan aviso y el cuerpo de la ficha sigue disponible.


## Diálogos accesibles (v0.18)

- El componente compartido usa `<dialog>.showModal()`: el fondo queda inactivo y los diálogos superpuestos respetan la capa activa del navegador. Tab y Mayús+Tab ciclan por los controles visibles/habilitados de la capa activa; los controles añadidos o deshabilitados se recalculan al pulsar.
- Al abrir se enfoca un control del diálogo; los formularios priorizan su campo inicial. El título siempre proporciona un nombre accesible, incluidos los diálogos genéricos. Las etiquetas de los campos de los prompts están asociadas a su entrada y los errores mantienen su anuncio accesible.
- Escape, cerrar y clic en el fondo solicitan `onClose` sin saltarse las restricciones de una operación en curso. Los atajos globales no actúan sobre el fondo desde un modal. Al cerrar se restaura el invocador si sigue disponible; en diálogos superpuestos se vuelve al padre y, si el invocador desapareció, a un control válido.


## Metadatos web protegidos (v0.19)

- Las consultas externas de metadatos usan `server/src/metadataHttp.ts`, también para futuros importadores web/DOI. Solo HTTP/HTTPS, URLs de hasta 8192 caracteres y sin credenciales embebidas. Se rechazan IPs privadas, loopback, link-local, compartidas, multicast y reservadas. IPv6 se limita al unicast global `2000::/3`, excluyendo rangos especiales/documentación y transición; direcciones IPv4 mapeadas/NAT64/6to4 no se consultan. Política conservadora basada en [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) e [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/).
- Se validan **todas** las direcciones DNS: una respuesta mixta pública/privada se rechaza. La conexión nueva se fija a una IP validada y mantiene Host y comprobación TLS del nombre original; no hay segunda resolución ni reutilización de sockets. Cada redirección vuelve a validar URL y DNS, incluso al mismo host. No se envían Authorization, Cookie ni Referer; cada salto usa solo cabeceras propias de metadatos.
- Máximo 3 redirecciones, 1 MB de respuesta, 8 KiB de cabeceras, 4 segundos totales (incluido DNS) y 4 consultas simultáneas; sin cola ilimitada. Se solicita contenido sin compresión y se rechazan respuestas comprimidas o tipos ajenos a metadatos de texto. Una resolución del sistema que no pueda cancelarse retiene su plaza hasta terminar y no conecta después del timeout. No se descargan ni se publican adjuntos automáticamente.
- `POST /api/capture` puede devolver `warning` en español junto a `{ path, title }`. Una URL bloqueada, timeout, error remoto, respuesta excesiva o ausencia de título conserva la referencia y la nota como recurso manual; el aviso se muestra al guardar y queda en el recibo idempotente. Un título explícito evita la consulta de metadatos.
- Resolver y transporte se inyectan desde código en tests deterministas, pasando por la misma validación. No hay variable de entorno, ajuste ni parámetro HTTP que permita destinos privados. Los puertos públicos no estándar se admiten; la política limita direcciones, sin sustituir los controles de salida de red del sistema.

## Compilación con configuración controlada (v0.20)

- La imagen TeX y el binario Node se fijan por digest multi-arquitectura. El inventario real de herramientas se registra al construir, al arrancar el worker y en `latexmk.txt` de cada compilación ejecutada, sin cambiar la respuesta HTTP ni los diagnósticos LaTeX. La referencia y su actualización mediante PR figuran en [worker/README.md](../worker/README.md).
- El worker conserva su API de compilación por tar y SyncTeX. Desactiva los rc implícitos con `latexmk -norc`; solo configura biber con una asignación constante para usar `--noconf`. pdfLaTeX mantiene `-no-shell-escape`. No se admiten opciones ni configuraciones desde la petición.
- Cada trabajo separa fuentes y runtime en un temporal propio, con entorno mínimo sin secretos ni configuración heredada. Usa `openout_any=p` para restringir escrituras de Kpathsea; no promete limitar lecturas con `openin_any` en TeX Live 2026 ni confinar todos los auxiliares. El contenedor no monta memoria/notas; los originales nunca se modifican.
- Una compilación a la vez, máximo cuatro trabajos admitidos (incluyendo subida/extracción/cola); el exceso responde **503** `{ error: "El worker está ocupado; vuelve a intentarlo" }`. Timeout de proceso de 120 s por defecto, cancelación de descendientes y limpieza antes de devolver el resultado. Los límites de memoria/procesos/tmpfs dependen del despliegue.
- El worker compartido requiere fuentes de confianza; Docker aísla el host pero no separa trabajos del mismo uid ni bloquea por sí solo toda salida de red. El futuro motor nativo E2 no será un sandbox. Política, entorno, riesgos y comprobaciones vinculantes: [SEGURIDAD-COMPILACION.md](SEGURIDAD-COMPILACION.md).

## Modelo de Biblioteca y recuperación (v0.21)

- Las fichas Markdown incorporan `biblioteca: { version:1, id:UUID, kind, urls, attachments, collections, provenance, bibliography? }`; título/etiquetas/estado/fecha y cuerpo siguen en sus campos habituales. Las notas del cuerpo pueden tener varias secciones/enlaces. Formato y autoridad bibliográfica: [BIBLIOTECA.md](BIBLIOTECA.md). La lectura antigua no escribe ni exige migrar. Los campos antiguos/ajenos permanecen al convertir; el namespace nuevo es la autoridad para URLs/adjuntos.
- `GET /api/resources` añade ID, esquema, tipo, URLs, adjuntos, colecciones, bibliografía, notas/procedencia y miniatura local validada cuando procede. IDs duplicados/formatos desconocidos generan avisos sin reparaciones silenciosas. `GET /api/resources/file` añade `item` y `attachments: {name,value,path:null|string,warning?}[]`; los campos del primer adjunto siguen por compatibilidad. Los adjuntos nuevos son relativos a la ficha; no se buscan variantes antiguas. Mover desde la app reescribe todas esas rutas y conserva UUID.
- `PATCH /api/resources` mantiene `baseRev` obligatorio y 409 con contenido/revisión actuales; añade título, nota, tipo, URLs, colecciones, adjuntos y vínculo bibliográfico, preservando campos no editados. Tipos/versiones/rutas inseguros y autoridades divergentes se rechazan. La bibliografía manual se edita en su `.bib`, no en una copia de campos de la ficha.
- `POST /api/capture` admite `libraryVersion:1`, tipo/colecciones opcionales y varios archivos por ficha (20, 50 MiB por archivo, 200 MiB total). Un recibo preparado conserva intención, ID y todos los adjuntos antes de publicar la ficha. Reintentos mantienen ID y resultados; recibos nuevos encuentran fichas trasladadas por UUID. El formato anterior y sus fingerprints/recibos siguen admitidos.
- `.biblioteca.json` persiste el ID anterior del destino al añadir o preparar Biblioteca. Copiado con fichas y registros, no cambia al trasladar el vault; los pendientes R2 mantienen destino. Las lecturas sin identidad persistida conservan el hash antiguo. Una identidad corrupta bloquea escrituras; `/api/status` devuelve `libraryError` sin inventar un ID y la lectura sigue disponible.
- `GET /api/library/migration` ofrece vista previa (máximo 100 fichas), revisiones, IDs propuestos, cambios/avisos y registros de operaciones. `POST /api/library/migration {operationId:UUID,libraryId,items:[{path,baseRev,id,proposalRev}]}` conserva originales y progreso en `data/library/<id>/migrations/`, con límite de 10 MiB por operación. Repetir la misma selección/ID es idempotente. Una selección vacía prepara solo la identidad del destino.
- `POST /api/library/migration/:id/retry` continúa lo pendiente; `POST /api/library/migration/:id/undo` registra la intención y restaura bytes originales sin tocar adjuntos. Escrituras usan bloqueos compartidos, revisión, historial y temporal/rename. Cambios externos/rutas desaparecidas se detienen con conflicto recuperable. Reiniciar intenta terminar operaciones preparadas/deshacer, sin sobrescribir cambios posteriores.
- Papelera/borrado siguen las operaciones actuales: no se eliminan adjuntos compartidos automáticamente ni se resucita una ficha borrada al reintentar un recibo terminado. Respaldo/restauración incluye identidad, fichas, adjuntos y registros `captures`/`library`. La importación bibliográfica y el uso en la memoria quedan para L3/L4.

## Vista Biblioteca y alta recuperable (v0.22)

- Biblioteca ocupa el área central como vista propia; conserva el espacio de trabajo al abrir/cerrar. Sustituye el listado lateral de Recursos y ofrece todos los recursos por defecto, búsqueda en títulos/notas/URLs, filtros por tipo/etiqueta/colección/revisión, ordenación y lista/cuadrícula. Miniaturas locales se resuelven en el servidor y se cargan en diferido.
- Capturar se presenta como **Añadir**, conservando el atajo. Acepta URL, ficha manual con título y archivos individuales/múltiples, separados por elemento o agrupados en una ficha. El navegador persiste todos los elementos del lote en una transacción IndexedDB antes del primer envío; muestra progreso y resultados por elemento. Errores conservan texto y todos los adjuntos, también tras recargar. Reintentar no repite los éxitos.
- La ficha muestra varios adjuntos, URLs, procedencia, colecciones, datos bibliográficos y notas. El formulario edita solo los campos cambiados y mantiene su revisión/destino iniciales; un refresco externo no desmonta la edición. 409 conserva los cambios en el diálogo compartido y exige recargar/revisar antes de reaplicar. La edición bibliográfica combina solo los campos enviados con los actuales; la autoridad manual sigue siendo el .bib.
- Las solicitudes de migración incluyen la identidad del destino y `proposalRev`; rechazan un cambio de biblioteca o de resolución de adjuntos desde la vista previa. Las ediciones desde la interfaz envían `libraryId` además de `baseRev`, para evitar escribir en otro destino con bytes coincidentes.
- La vista previa de conversión ofrece selección, detalle propuesto, progreso, reintento y deshacer. Sin selección prepara solo la identidad del destino. No se añaden controles de citar/insertar figuras hasta implementar L4.

## Visor PDF compartido en Biblioteca (v0.23)

- Los PDF adjuntos se muestran con el mismo visor PDF.js de la memoria, cargado en diferido: páginas, zoom, búsqueda de texto y páginas oscuras. El enlace del archivo permite abrirlo en otra pestaña.
- Los visores de Biblioteca mantienen su página y búsqueda independientes. No usan SyncTeX, no reciben saltos desde el código ni alteran la posición de lectura/índice de la memoria. Las preferencias de zoom y páginas oscuras siguen siendo compartidas.

## Importación bibliográfica revisable (v0.24)

- `POST /api/library/import/preview {format:"bibtex"|"ris",text}` o `{format:"doi",doi}` devuelve `{libraryId,source:{format,text},items:[{index,title,key,entryType,fields,error?,candidates}],warning?}`. No escribe fichas. Los candidatos aportan identidad, título, revisión y motivo (original idéntico, DOI o título); son sugerencias sin combinación automática. Propone claves libres entre Biblioteca y bibliografía de la memoria.
- DOI consulta solo el endpoint documentado de Crossref mediante HTTP R5. Devuelve únicamente metadatos presentes; un fallo/proveedor ajeno conserva el DOI para completarlo manualmente. No importa enlaces privados ni descarga adjuntos.
- `POST /api/library/import {operationId:UUID,libraryId,source,items:[{index,action,title,key,entryType,fields,targetId?,baseRev?}]}` aplica decisiones `create`, `associate`, `merge`, `skip`, con resultados por índice (`done`, `error`, `skipped`). Asociar/combinar exige UUID único de destino y `baseRev`; no sobrescribe bibliografía manual, notas ni adjuntos. Combinar conserva la clave existente y campos no sustituidos. Reusar operación con otra selección responde 409; repetir el original/entrada encuentra la ficha ya importada, sin duplicarla.
- Los originales UTF-8 quedan intactos en `RESOURCES_SUBDIR/originales/<sha256>.bib|ris|json`. La referencia gestionada añade `source:{format,hash,index}` y `sources` para los originales anteriores al combinar. No son otra autoridad editable. El formulario ofrece título/tipo/clave y campos revisables, advertencias de duplicados y resultados individuales; el enlace del original aparece en la ficha.
- Antes de publicar se registra intención, formulario, texto anterior/propuesto y progreso en `data/library/<id>/imports/`. `GET /api/library/import/operations` permite recuperar lotes tras recargar. El borrador del navegador utiliza `et:library-import:<id>`; un fallo de persistencia impide aplicar. Una respuesta perdida mantiene ID, destino y decisiones; errores no descartan contenido ni repiten éxitos. Cambiar decisiones inicia otra operación y conserva registros previos.
- Máximo 1 MiB de fuente, 100 referencias, 100 campos por entrada, 64 KiB por campo y 20 MiB de registro. Una entrada inválida informa error sin impedir aplicar las demás; debe corregirse o excluirse explícitamente. Los `.bib` manuales nunca se reescriben ni se sincronizan con gestores externos.
- La ordenación de Biblioteca compara fechas cronológicas: las altas bibliográficas UTC y las capturas con huso local se intercalan correctamente.

## Citas, figuras y copias portables (v0.25)

- `POST /api/library/integration/preview` exige `operationId`, `libraryId`, `instanceId`, `resourceId`, `baseRev` y `kind:"reference"|"figure"`. Figura añade `attachmentPath`, `caption`, `credit`, `label`, `width` y, para actualizar una copia, `replaceCopy`. Referencia admite `mainDraft:{content,baseRev}`. Devuelve archivos propuestos/revisiones, advertencias y el bloque LaTeX; conserva intención/staging en `data/library/<id>/integrations/<operationId>/`, sin modificar la memoria.
- `POST /api/library/integration/apply` exige ID, destino y `revisions:[{path,baseRev}]` de todos los archivos de la vista previa. Publica bajo bloqueos con preflight, historial y escrituras atómicas/exclusivas. Un conflicto externo conserva la operación sin pisar datos. Repetir reconoce los bytes ya publicados; `GET /api/library/integration/:id` recupera la vista previa tras reiniciar. Metadatos/registros limitados a 20 MiB; imagen a 50 MiB. Cambiar de memoria/vault impide aplicar una operación anterior.
- Bibliografía gestionada: `biblioteca/referencias.bib` y registro `biblioteca/estado.json` dentro de la memoria. Conserva claves utilizadas, campos/expresiones originales y comentarios; las macros de cada original se aíslan con nombres deterministas y las referencias auxiliares (`crossref`, `xdata`…) se copian con claves privadas. Los `.bib` manuales se vinculan y nunca se reescriben. Una salida ajena sin registro no se sobrescribe; una salida gestionada modificada externamente exige revisar su diferencia. Las referencias ya copiadas permanecen al borrar una ficha.
- La incorporación al preámbulo usa `\addbibresource`. Con el principal abierto/preparado en el cliente, el servidor devuelve `mainEdit` en vez de escribirlo: se aplica al borrador comprobado, preservando su revisión. Insertar en el destino usa una transacción aislada de CodeMirror en el cursor, sin sustituir texto seleccionado, y se puede deshacer sin perder la edición previa. Compilar guarda los borradores con los controles existentes.
- Figuras: solo PNG, JPG y PDF (primera página), con alternativa explícita de convertir SVG/WebP/GIF/EPS. Se copian a `figuras/biblioteca/`, con nombre ASCII, pie, etiqueta y atribución; el registro conserva identidad/procedencia/huella. Actualizar una copia exige el mismo formato y sus revisiones. No se cambia una memoria silenciosamente ni se eliminan sus copias al llevar una ficha a la papelera.
- `GET /api/library/uses?id=…` o `?path=…` consulta usos guardados de la memoria actual, claves copiadas, metadatos desactualizados y figuras. Los usos llevan a archivo/línea; el escáner omite comentarios y entornos literales comunes, sin expandir macros TeX. Los borradores se reflejan al guardarlos. Sin carpeta de memoria devuelve `available:false`, manteniendo la Biblioteca operativa. Antes de borrar desde la interfaz se muestran usos/copias y se explica que estas se conservan.
- `node server/node_modules/tsx/dist/cli.mjs scripts/library-compile.mts --worker-url http://127.0.0.1:<puerto> --output-dir <out-temporal>` verifica ambos perfiles, cita/figura, `.bib` manual intacto y memoria trasladada sin biblioteca. El output debe ser temporal y coincidir con `/out` del worker. La CI lo ejecuta con datos ficticios; los recorridos E2E automatizados corresponden a L5.

## Precisiones de Biblioteca tras la auditoría (v0.26)

- Al exportar una ficha combinada, cada asociación (`crossref`, `xref`, `xdata`, `entryset`, `related`) se resuelve desde el original que aportó su valor; los originales históricos se consultan del más reciente al más antiguo. Se conservan macros y referencias auxiliares de ese documento, sin elegir padres homónimos de otro original. Si una asociación editada no coincide con un campo original, solo se exporta cuando un único documento puede resolver todas sus claves; una selección ambigua/inválida responde 400 antes de publicar.
- La coincidencia exacta de importación compara huella e índice con `source` y `sources`: vista previa, aplicación y recuperación usan el mismo criterio. Reimportar un original histórico con `create` devuelve la ficha existente sin cambiar UUID, clave, metadatos, notas ni adjuntos; los índices diferentes siguen siendo entradas distintas.
- Figura con `replaceCopy`: actualiza solo los bytes de la copia y su huella/ruta de procedencia, preservando ID, ruta, título, crédito y etiqueta del registro existente. Devuelve `result.snippet:""`; no inserta ni modifica LaTeX. Los campos de inserción siguen siendo admitidos y validados por compatibilidad, pero no sustituyen los metadatos registrados. La interfaz oculta pie, crédito, etiqueta, ancho y destino de inserción al actualizar; explica que se conservan y separa el borrador local por ruta de copia. Los borradores de figuras usan claves versionadas: insertar y actualizar no recuperan las vistas antiguas que compartían una clave; se prepara una vista nueva, conservando los recibos del servidor. Revisiones, formato, historial y conflictos externos mantienen sus controles.

## Interfaz de motores de compilación (v0.27)

- El servidor utiliza un motor con `health()`, `compile(fuentes, principal)` y `svg2pdf(svg)`. La implementación Docker conserva el tar validado, HTTP del worker, artefactos compartidos, límites, diagnósticos, cola y SyncTeX existentes. La persistencia de resultados y la conservación del último PDF válido permanecen en el servidor.
- `/api/status` añade `motor:{tipo:"docker"|"local",estado:"up"|"down",version:null|string,capacidades:{compile:boolean,svg2pdf:boolean}}`. `worker` sigue disponible por compatibilidad. Un worker anterior sin versión sigue admitido; no se atribuye una versión inventada.

## TeX del sistema y selección de motor (v0.28)

- `compileEngine` se añade a Ajustes con valores `docker`, `local`, `auto`; `.env` usa `COMPILE_ENGINE`, por defecto `docker` para conservar instalaciones existentes. Mantiene precedencia ajustes > entorno > defecto, validación, administración loopback/AUTH_TOKEN, persistencia atómica, restablecimiento y evento `settings`. Cambiar solo el motor conserva documentos/borradores y el último PDF válido.
- `auto` comprueba Docker y lo prefiere si responde; en caso contrario selecciona local. La selección y la configuración se fijan para cada operación. Un error al compilar no provoca otra compilación con diferente motor. `/api/status.motor` añade `seleccion`; `tipo` describe el motor elegido y `worker` sigue describiendo exclusivamente Docker. Header/Inicio utilizan `motor`, con compatibilidad para estados antiguos.
- `GET /api/engines` requiere administración y devuelve `{docker,local}`: cada motor aporta `ok`, `version`, `capabilities:{compile,svg2pdf}`. Local añade `tools:{latexmk,biber,pdflatex,rsvg}:{path:null|string,version:null|string}`, `warnings` y `message?`. Detecta ejecutables en PATH absoluto fuera de memoria/notas (incluidos enlaces); conserva el nombre `pdflatex` cuando apunta a `pdftex`. La consulta fuerza detección; otras solicitudes reutilizan una comprobación hasta 30 s. Las versiones diferentes a R8 generan avisos de herramientas, no avisos LaTeX ni bloqueo.
- Local necesita latexmk, pdfLaTeX y biber; rsvg-convert habilita la conversión de diagramas de forma independiente. Ajustes muestra versiones/faltantes y el selector. Local/Automático muestran un aviso global antes de compilar: las herramientas tienen permisos del usuario y las fuentes deben ser de confianza. El motor local **no es un sandbox**.
- El adaptador extrae el mismo tar validado en un temporal propio y llama al núcleo compartido: entorno mínimo, binarios explícitos, rc/biber.conf ignorados, shell-escape desactivado, diagnósticos y SyncTeX relativos. Borra fuentes/runtime tras éxito, error, timeout o cancelación. Al cerrar la API cancela el trabajo, espera la limpieza y rechaza la solicitud pendiente sin iniciarla. POSIX termina el grupo; Windows usa taskkill /T /F. Conserva 10 builds; tiempo por defecto 120 s (`COMPILE_TIMEOUT_MS`, entero 1–180000). La API coalesce una ejecución y una solicitud pendiente. No impone límites nativos duros de memoria/disco ni aislamiento de red/lecturas.
- El worker HTTP conserva sus respuestas de compilación/SVG y amplía `/health` con `version` y `capacidades`. La imagen de la app incluye los cuatro módulos compartidos necesarios; el worker continúa sin dependencias npm.
- CI verifica API/motores en Linux/macOS/Windows y compilaciones Docker/nativas con TeX Live 2026 real. El caso local ejecuta directamente la API en la imagen de pruebas sin worker HTTP ni red; se verifica seguridad y ambos perfiles/citas/figuras trasladadas. E3 añade validación nativa macOS con TeX Live 2026 ligero y requisitos en README/Ajustes (pdfLaTeX, latexmk, biber/biblatex compatibles; Perl y paquetes previos en MiKTeX). Los instaladores MacTeX/MiKTeX físicos siguen sin comprobar; Tectonic se evalúa en E4 y la conversión sin rsvg corresponde a F1.

## Diagramas sin conversor instalado (v0.29)

- Local anuncia `capabilities.svg2pdf:true` independientemente de las herramientas TeX: exportar no exige poder compilar. Si detecta rsvg-convert operativo, continúa convirtiendo el SVG con ese ejecutable; Docker conserva su recorrido existente. No cambia el selector de motor ni hay fallback tras un fallo de rsvg/Docker.
- `POST /api/diagramas/exportar` conserva `{path,svg,rev}` y admite `pdf?` (base64, hasta 10 MB). Local sin rsvg valida el SVG y responde **422** `{error,code:"PDF_BROWSER_REQUIRED"}` si falta el PDF, sin escribir figuras. La app carga el conversor en diferido y repite la misma operación/revisión con el PDF generado. Solo local sin rsvg utiliza ese adjunto; los otros caminos convierten el SVG.
- El servidor valida tamaño, formato base64, cabecera `%PDF-` y final `%%EOF` del adjunto; no demuestra que sus gráficos correspondan al SVG ni lo ejecuta. Mantiene los rechazos de SVG del worker, la validación de rutas, las dos comprobaciones de revisión (**409**), bloqueos, copia en historial y PDF primero/SVG con metadatos al final. Fallar la conversión no modifica la figura anterior.
- El navegador convierte exclusivamente el SVG de impresión generado por la app mediante jsPDF/svg2pdf.js (MIT), sin rasterizar. Usa Source Sans 3 5.3.0, pesos 400/700 normal/cursiva y subconjuntos latin/latin-ext, con TTF derivadas de las mismas WOFF mediante `worker/woff2sfnt.mjs` al construir la web. Texto extraíble, fuentes incrustadas `/BaseFont /SourceSans3…`, tamaño **1 px = 0,75 pt** y una página; si excede 14400 pt o la fuente no cubre un carácter, se explica el error sin omitir texto ni recortar el dibujo.
- Se resuelve el CSS con el navegador para conservar colores, pesos, espacios y trazos; los degradados de **borde** de Mermaid se aproximan por su gris medio porque svg2pdf no admite degradados de trazo. Los rellenos siguen siendo vectoriales. No se cargan imágenes ni hojas de estilo externas durante la conversión. La fuente `.mmd`, SVG, PDF, estado desactualizado y acción «Insertar en la memoria» conservan v0.8; editar no regenera automáticamente la figura.

## Rutas del servidor fuera del checkout (v0.30)

- `DATA_DIR` fija los datos internos: ajustes, historial, papelera y operaciones recuperables de capturas/biblioteca. `BUILD_DIR` puede separar las compilaciones. Sin `DATA_DIR`, se conserva la carpeta padre de `BUILD_DIR` (o `data/` por defecto), sin trasladar archivos existentes automáticamente.
- `TEMPLATES_DIR` selecciona base, perfiles y manifiestos en creación y actualización de memorias; `WEB_DIST` selecciona la interfaz estática. Son configuración del arranque, no ajustes editables desde la API; las rutas relativas siguen tomando la raíz de la aplicación como base. Sin ellas se conservan los valores del checkout.
- La guardia de contenido personal se mantiene cuando la raíz del código contiene `.git` (directorio o archivo de worktree); fuera de un checkout se omite esa guardia específica. Las comprobaciones de `ALLOWED_ROOTS`, rutas, revisiones y autenticación se mantienen. La entrada CLI solo carga `.env` en un checkout y permite su ausencia; la entrada reutilizable `startServer(env)` no lo lee ni instala señales y devuelve el servidor, contexto y URL para cerrarlos desde el propietario.
- `userDataDir()` ofrece las rutas de escritorio sin crear carpetas: `~/Library/Application Support/Estudio TFG`, `%APPDATA%\\Estudio TFG` (con fallback a `AppData/Roaming`) y `$XDG_DATA_HOME/estudio-tfg` (con fallback a `~/.local/share/estudio-tfg`). Electron las utilizará en G3; el servidor desde checkout conserva sus valores previos.

## Base de escritorio (v0.31)

- Electron arranca `startServer(env)` del bundle JavaScript en `127.0.0.1`, puerto libre y token aleatorio nuevo por ejecución. Usa datos por sistema (o `DATA_DIR` explícito), notas/memoria configurables y sus ajustes persistidos. La web y las plantillas provienen de los recursos de la aplicación; no lee `.env`.
- La sesión persistente utiliza `http://estudio-tfg.localhost` como origen estable, atendido exclusivamente dentro de Electron por un proxy al HTTP loopback. Conserva localStorage/IndexedDB aunque cambie el puerto, sin rutas `file://` ni token en URL. Cookie `et_token` HttpOnly/SameSite Strict; el proxy reenvía esa cookie solo al servidor propio y rechaza orígenes externos. Chromium guarda sus datos en `DATA_DIR/browser`, separado de ajustes/historial/operaciones.
- Renderer sin Node ni preload, contexto aislado, sandbox y seguridad web activos. CSP confina scripts/conexiones al origen de la app; se bloquean peticiones de red externas, webviews y navegación externa. Solo los enlaces HTTP/HTTPS válidos pueden abrirse en el navegador del sistema. El único permiso web permitido es escritura saneada del portapapeles desde la app. Los enlaces internos pueden abrir ventanas con la misma protección y sesión.
- Los enlaces de PDF en otra ventana reutilizan el visor PDF.js de la app: `/?pdf=<ruta-local>` admite exclusivamente `/api/pdf/…` o `/api/raw`, del mismo origen. Las fuentes/documentos se siguen validando y autenticando en la API; no habilita URLs remotas ni un renderer privilegiado para el PDF.
- Una segunda instancia no inicia otro servidor: notifica a la primera, restaura su ventana y solicita su foco. Cerrar respeta `beforeunload` y la confirmación de conservación de borradores; después aborta las conexiones del proxy y espera `app.close()` (incluida cancelación del compilador) antes de salir.
- `TEX_BIN_DIR` opcional, absoluto y de configuración de arranque, fija el directorio de herramientas de E2. Se valida cada ejecutable fuera de notas/memoria; una herramienta privada ausente no se sustituye por otra del PATH. La caché incluye esta ruta. No modifica PATH global ni instala herramientas. Sin ella se conserva E2. Escritorio parte de `local`; Ajustes sigue teniendo precedencia. El TeX privado autosuficiente y los instaladores offline/online se preparan en G4/G5.

## Primer arranque y TeX privado (v0.32)

- Electron ofrece un asistente de tres pasos: elegir/crear notas y memoria desde un perfil, preparar TeX y compilar el primer PDF. Puede posponerse y repetirse desde Ajustes. Docker y TeX externo permanecen en opciones avanzadas; no se instala Tectonic. Las carpetas personales se eligen fuera de los datos internos de Electron y sus ancestros.
- `POST /api/settings/init-notes {dir}` crea una carpeta nueva, prepara la subcarpeta de recursos y la selecciona. Exige administración, ruta absoluta bajo `ALLOWED_ROOTS` y fuera del checkout; una carpeta existente responde 409 sin modificarla. Memorias existentes/nuevas reutilizan v0.2.
- Solo Electron registra `GET /api/desktop/setup`, que devuelve `{needsSetup,engine:{phase,available,installed,current,received,total,message,version,variant}}`. `phase` es `idle`, `copying`, `downloading`, `extracting`, `publishing`, `ready`, `cancelled` o `error`; `variant` es `offline` u `online`. La web self-hosted no ofrece estas rutas ni abre el asistente de escritorio.
- `POST /api/desktop/engine/prepare` inicia una única preparación en segundo plano, según el manifiesto incluido en la app; no admite URL, hash ni rutas del cliente. Offline lee el archivo incluido; online descarga por HTTPS el mismo paquete fijado. Ambos comprueban tamaño/SHA-256 antes de extraer, límites de espacio/tamaño/entradas, rutas confinadas y herramientas completas. El constructor materializa enlaces internos; el extractor no admite ningún enlace ni dispositivo. Las escrituras se limitan a staging privado y publican por `rename` solo al terminar.
- `POST /api/desktop/engine/cancel` cancela/espera la operación y limpia staging. Interrupción, hash incorrecto o falta de espacio dejan un error recuperable; no reemplazan el motor previo ni modifican documentos/ajustes. El siguiente arranque limpia staging abandonado. El motor anterior publicado sigue utilizable durante la preparación de otra release. TeX/Perl se localizan dentro del paquete, sin modificar PATH global ni actualizar otras instalaciones. El motor conserva las restricciones E2/R6 y no constituye un sandbox.
- `POST /api/desktop/setup/complete` exige administración, carpetas configuradas, motor fijado preparado si se distribuye un paquete y un PDF correcto cuya revisión coincide con las fuentes actuales; en otro caso devuelve 409. Persiste la finalización atómicamente en los datos internos. Preparar/cancelar también exige administración. El cierre de la app cancela la preparación antes de salir.

## Distribución offline/online (v0.33)

- Las variantes de una release comparten el paquete TeX Live, revisiones y hash de su plataforma. Offline lleva el archivo verificado en los recursos; online usa el asset de esa misma release. No instala paquetes a demanda, cambia el PATH global ni requiere TeX/Docker/Perl externos. Windows utiliza el Perl fijado de TeX Live; Unix incluye un Perl reubicable propio. Los avisos/licencias e inventario acompañan al motor.
- La exportación local comprueba primero si existe `rsvg-convert` en las rutas permitidas. Si está ausente, solicita/acepta el PDF del navegador conforme a F1 sin arrancar auxiliares TeX ajenos a la conversión; mantiene la validación SVG y las restricciones de rutas.
- El workflow de tags construye DMG/ZIP de macOS arm64/x64, NSIS/portable de Windows x64 y AppImage de Linux x64. Publica únicamente una release borrador después de verificar las variantes y perfiles; añade manifiesto, hashes, tamaños y evidencia. La preparación conserva motores previos ante fallos, conforme a v0.32.
- «Buscar actualizaciones…» consulta explícitamente el canal de la variante mediante `electron-updater`; no hay consultas/descargas al arrancar una sesión offline. Descargar/salir para instalar requieren confirmación del usuario y mantienen el cierre con borradores. La portable Windows usa descarga manual; macOS sin firma ofrece las descargas y difiere actualización automática hasta G6.

## Acerca de y licencias (v0.34)

- El menú de escritorio «Acerca de Estudio TFG…» muestra versión, GNU AGPL-3.0, origen ARCO/GPL-2.0+ de la plantilla y enlace al código de la release. «Ver código fuente» abre ese enlace en el navegador; «Licencias y componentes» abre una ventana interna protegida con el inventario y los avisos originales.
- Los builds incluyen la AGPL, aviso y GPL de la plantilla, versiones/licencias/avisos de dependencias realmente instaladas del servidor/interfaz/Electron, créditos de fuentes, textos TeX Live/Perl e inventario de revisiones/SHA-512 del motor. Las licencias se reproducen sin traducir; los controles y explicaciones están en español. No se exponen rutas arbitrarias del sistema para consultar avisos.

## Publicaciones de aplicación y auxiliares (v0.35)

- A partir de los nuevos builds, `vX.Y.Z` conserva 10 instaladores/portables y `manifest.json`; las notas y enlaces de descarga van en la descripción. TeX, manifiestos del motor, ZIP y auxiliares del actualizador se alojan en `distribucion-vX.Y.Z`, dentro del mismo repositorio GitHub. Ambas publicaciones se crean como borradores tras las verificaciones de G5. El motor online fija la URL y hash de su distribución técnica; offline conserva el mismo motor incluido. Precisa la ubicación de los assets de v0.33.
- Publicar manualmente la release principal activa un workflow que valida sus seis feeds y habilita su distribución técnica como prerelease, nunca como última estable. Si la principal es la última estable, copia sus feeds a la publicación técnica `actualizaciones`; candidatas y estables anteriores conservan el canal vigente. Los feeds enlazan archivos verificados por URL absoluta. Se mantienen las confirmaciones, variantes y restricciones de actualización de v0.33.
- Las releases anteriores conservan archivos y URLs; sus borradores de prueba se reemplazan manualmente para adoptar el nuevo canal. No se eliminan motores ni archivos que una versión distribuida pueda necesitar. La descarga online requiere que haya terminado la habilitación de su publicación técnica.

## Arranque de la interfaz y formularios abiertos (v0.36)

- El botón «Ajustes» del panel de secciones se habilita cuando el área de trabajo puede abrir pestañas. Durante el arranque permanece deshabilitado, evitando perder una pulsación anterior a la inicialización de Dockview.
- El selector de carpetas conserva el nombre escrito y la navegación cuando se recargan ajustes con la misma carpeta inicial, nombre predeterminado y raíces permitidas. Cerrar y volver a abrir, o cambiar esos valores, reinicia el selector. La selección y las escrituras mantienen la validación de rutas del servidor.

## Entregas estables desde main (v0.37)

- `develop` integra funcionalidades y correcciones; sus ramas y PR ejecutan CI sin publicar. Las integraciones en `main` se ponen en cola, pasan CI y reutilizan las cuatro construcciones nativas de G5. Solo después de verificar ambas variantes, perfiles y manifiestos se publica la app estable y se habilitan sus auxiliares y seis feeds mediante el proceso de v0.35. Un fallo previo no publica la app ni cambia el canal estable.
- La versión base de `desktop/package.json` y los tags estables reservados determinan el siguiente parche. Elevar manualmente la base permite un salto minor/major. Cada tag queda fijado al SHA comprobado; reintentar ese commit reutiliza su reserva. No hay commits de incremento automático en `main`, ni se mueven tags fallidos para otra entrega.
- Las subidas parciales se reintentan sobre borradores, conservando los archivos ya publicados. Una entrega antigua no desplaza Latest ni los canales de una posterior. Los tags manuales mantienen los borradores y su publicación manual; las candidatas no alteran el canal estable. La publicación automática activa directamente los auxiliares porque los eventos creados con `GITHUB_TOKEN` no encadenan el workflow `release`.
- Se conserva la ausencia de firma/notarización mientras G6 esté aplazada, la separación app/auxiliares y las confirmaciones de actualización de v0.33. Los builds locales y manuales de prueba no publican estables por sí solos.

## Desarrollo local de la app (v0.38)

- `npm run desktop:dev` construye web/servidor y abre Electron sin generar instaladores. Vigila el código: los cambios web reconstruyen y solicitan recarga; servidor, Electron y helpers reinician la app. Conserva las confirmaciones de borradores y el cierre del servidor. Una reconstrucción fallida se reintenta al guardar código sin cerrar la ventana existente.
- Separa el perfil en `workspace/desktop-dev/`: datos/Chromium/TeX en `data/`, notas y memoria ficticias iniciales en carpetas hermanas y web reconstruida en `web/`. No sobrescribe documentos existentes al arrancar. Ignora `.env` y sustituye las rutas/motor heredados. Ajustes permite elegir notas y memoria externas; sus documentos se leen y modifican en la ubicación seleccionada, mientras ajustes/borradores/TeX siguen en el perfil de desarrollo. Las versiones empaquetadas ignoran el control de recarga/reinicio de desarrollo.
- Escritorio, también en desarrollo, permite por defecto `/` en macOS/Linux y las unidades disponibles al arrancar en Windows. Un `ALLOWED_ROOTS` explícito prevalece; la web self-hosted conserva sus límites previos. Se mantienen administración por token/loopback, permisos del sistema, guardias de datos internos/checkout y confinamiento de cada operación a las raíces de notas/memoria seleccionadas; ampliar el selector no permite escapar de ellas mediante rutas o enlaces.
- El primer arranque fija en caché el manifiesto TeX de la última estable pública para la plataforma, comprobando SHA-256 y tamaño contra su manifiesto de distribución. El asistente utiliza la preparación verificada de v0.32 en el perfil aislado; siguientes arranques y cambios de código reutilizan ese motor sin descargarlo ni consultar nuevas versiones. No instala TeX/Perl globalmente ni publica releases.

## Icono de escritorio (v0.39)

- `logo.png` en la raíz conserva el original. Los iconos derivados viven en `desktop/icons/`: macOS usa `macos.png`, con fondo blanco redondeado y margen exterior transparente; Windows y Linux usan `windows.png`, con las letras sin fondo. El empaquetado genera sus formatos nativos y conserva ambos PNG en los recursos para las ventanas. Electron usa la variante de su plataforma también en desarrollo, incluido el Dock de macOS; sustituir estos PNG con `desktop:dev` activo solicita reiniciar la app respetando los borradores.

## Asistente de escritorio con ChatGPT (v0.40)

- Solo Electron registra `/api/assistant/*`, bajo el token de la app y administración local. El renderer conserva sandbox/CSP y solo consulta el origen protegido. OAuth usa navegador del sistema, callback temporal `127.0.0.1/auth/callback`, PKCE/state/nonce de un uso y validación OIDC. Credenciales cifradas en `DATA_DIR/chatgpt`, sesión volátil si no hay almacén seguro; nunca se reutilizan sesiones de otros clientes ni se cambia a una clave API automáticamente. La app sigue funcionando si el asistente no está disponible.
- `GET /api/assistant/account` devuelve cuentas `{id,label,connected,enabled}`, cuenta `active`, `pending`, `error` y `persistent`, sin tokens. `POST /account/connect {id?}` inicia conexión/renovación explícita; `/account/select {id}` cambia de cuenta, `/account/disconnect {id}` revoca y borra sus tokens locales y `/account/cancel {}` cancela OAuth. `GET /models` obtiene `{models:[{id,name}]}` de la cuenta activa. Los errores de sesión o cuota no provocan reintentos de facturación alternativos.
- `POST /threads {model,scope:{memoria,library,notes:string[]}}` crea una conversación ligada a cuenta, instancia y biblioteca. Las rutas de `notes` son relativas al vault; `""` autoriza todas las notas salvo Biblioteca, que exige su permiso propio. Los permisos empiezan desmarcados, se conceden por conversación e incluyen el envío a OpenAI de las fuentes consultadas. No se amplían mediante herramientas ni documentos. Cambiar cuenta o configuración detiene el turno; otra identidad/proyecto no puede acceder a su historial.
- `GET /threads` lista conversaciones; `GET /threads/:id` devuelve mensajes, fuentes, propuestas y estado `idle|running|error|cancelled`. El historial remoto opaco y adjuntos inline permanecen en disco privado, fuera de la respuesta del renderer. `POST /threads/:id/turns {text,context?:[{root,path,text?}],dirty:string[]}` inicia un turno, donde `dirty` contiene las claves de documentos con borradores, conflicto o guardado pendiente. La interfaz consulta el avance; `POST /threads/:id/cancel {}` aborta la petición. Solo un turno activo por instancia. Las peticiones a Responses usan `store:false`, `stream:true` e historial explícito y requieren `response.completed`.
- Herramientas locales agrupadas en `estudio_tfg`: `buscar_fuentes`, `leer_texto`, `consultar_adjunto` y `proponer_cambios`. Buscan/leen dentro del alcance usando las validaciones de rutas y destino real de enlaces; los PDF e imágenes se envían inline, sin Files API. Fuentes con identificadores estables y enlaces verificables. No hay shell, navegación web, embeddings ni herramientas alojadas. Máximo 100.000 caracteres y 20 MiB de adjuntos acumulados por conversación, ocho rondas y veinticuatro herramientas por turno; se informa al alcanzar el límite, sin truncar silenciosamente.
- Las propuestas contienen versiones anteriores/posteriores y revisiones de textos existentes: `.tex`/`.bib` manual de memoria y `.md` de notas. Se excluyen archivos ocultos, `estilo/`, `figuras/`, `biblioteca/` y fichas gestionadas. Se exige guardar explícitamente los borradores afectados antes de preparar/aplicar. Las claves bibliográficas nuevas no verificadas se rechazan. `POST /threads/:id/proposals/:proposal/apply {selected:string[],dirty:string[]}` aplica el subconjunto revisado; `/undo {dirty:string[]}` lo revierte. Ambas comprueban identidad, alcance y revisiones, usan bloqueos ordenados, historial y escrituras atómicas por archivo. Un 409 previo no escribe; un fallo intermedio conserva el registro y permite completar/revertir explícitamente, sin pisar ediciones posteriores. No se promete atomicidad simultánea del lote.
- `DELETE /threads/:id` borra mensajes/contexto y propuestas no aplicadas. Un lote interrumpido impide el borrado hasta recuperarlo; si hay cambios aplicados se conserva exclusivamente su registro como conversación archivada, consultable para deshacer y sin nuevas consultas al modelo. El historial vive en `DATA_DIR/assistant/`, separado de cuenta/proyecto, con escritura atómica y permisos privados. Borrar chats no elimina fuentes originales. Uso y recuperación: [ASISTENTE.md](ASISTENTE.md).

## Ventana flotante del asistente (v0.41)

- En Electron, Asistente se abre superpuesto a la app como ventana no modal de 380 × 520 px, limitada al espacio visible. No divide Dockview ni cambia la vista activa: Inicio, Biblioteca y editores siguen utilizables. Los layouts antiguos con una pestaña del asistente se migran a esta presentación.
- Se mueve desde la cabecera con puntero o mediante las flechas del botón «Mover asistente»; Mayús aumenta el paso. La posición se valida y conserva en `et:assistant:position` con los helpers de almacenamiento y se ajusta al redimensionar o reabrir para mantener los controles accesibles.
- «Minimizar» reduce la ventana a la cabecera y «Cerrar» la oculta. Se conservan conversación, borrador, contexto y opciones durante la sesión; las consultas continúan hasta terminar o pulsar «Detener». Abrir desde la barra/editor restaura la ventana. Cuenta, permisos/modelo, historial y actividad son desplegables; la revisión de cambios mantiene los diálogos y comprobaciones de v0.40.

## Más diagramas y formularios accesibles (v0.42)

- «Nuevo diagrama» ofrece quince plantillas: las seis de v0.8 y Gantt, cronología, mapa mental, arquitectura C4, Kanban, requisitos, sectores, cuadrantes y Sankey. La selección usa radios nativos, con etiqueta y descripción, accesibles mediante Tab y flechas.
- Los nueve tipos añadidos admiten código Mermaid y un formulario plegable con campos etiquetados: textos, fechas y duración, cantidades, coordenadas, riesgo/verificación y extremos de relaciones. Se añaden elementos mediante botones; mapas y Kanban permiten añadir hijos y eliminar hojas sin borrar ramas ni dejar relaciones colgantes. La sintaxis avanzada no reconocida sigue disponible en Código y se conserva literalmente.
- «Aplicar cambios» o Intro valida el diagrama antes de incorporar todos los campos pendientes al `.mmd` abierto. Un error conserva la fuente anterior y los campos para corregirlos. Las altas/bajas requieren aplicar o descartar antes los campos pendientes. Ocultar el formulario no descarta esos campos. Guardar, borradores, conflictos, historial y Deshacer/Rehacer del documento mantienen el flujo existente; aplicar no guarda ni exporta automáticamente.
- El código y el formulario se sincronizan desde la fuente. Los campos pendientes bloquean temporalmente la edición de código y las operaciones sobre el documento; si cambia la fuente externamente, se conservan para copiar/revisar y se exige descartarlos antes de recargar el formulario. En paneles estrechos el formulario y la vista previa se apilan. Los tipos sin formulario ni edición por bloques conservan el código siempre visible.
- Exportación PDF vectorial con texto extraíble y Source Sans 3 para las quince plantillas, manteniendo revisiones y validaciones de v0.8/v0.29. Sin nuevas dependencias ni cambios de API. Limitación del analizador Sankey de Mermaid: etiquetas ASCII, sin tildes ni eñes; se informa en el formulario y se rechazan cambios incompatibles antes de aplicarlos. CSV entrecomillado, formas especiales y opciones avanzadas se editan en código.

## Selector de diagramas con ejemplo (v0.43)

- «Nuevo diagrama» sustituye la cuadrícula por un selector de un tipo cada vez: nombre, descripción, posición entre las quince plantillas y ejemplo Mermaid dibujado. Los ejemplos grandes se resumen para mantenerlos legibles; crear conserva la plantilla completa. «Tipo anterior» y «Tipo siguiente» recorren la lista circularmente.
- Con el foco en el selector o sus flechas, ←/→ cambian de tipo e Inicio/Fin seleccionan el primero/último; no intercepta las flechas del campo Nombre. La selección se anuncia a lectores de pantalla. El ejemplo respeta el tema claro/oscuro al dibujarse, carga Mermaid en diferido y descarta los resultados de selecciones anteriores.
- «Crear» usa la última plantilla seleccionada aunque su ejemplo siga cargando. Un fallo del ejemplo se comunica sin impedir crear. Reabrir el diálogo vuelve al primer tipo; copiar un diagrama desde una nota conserva su flujo sin selector.

## Edición de diagramas sin código y recuperación de campos (v0.44)

- Los campos pendientes cuentan como cambios sin guardar, bloquean también el guardado global y se incluyen en el borrador local del documento, aislado por instancia. Al cerrar o recargar se ofrecen con «Restaurar borrador»; restaurar no aplica ni guarda los campos. Ocultar el formulario conserva el borrador. Si cambia la fuente, los campos antiguos se mantienen para revisarlos o copiarlos antes de descartarlos.
- Sectores genera etiquetas nuevas únicas y rechaza duplicados antes de aplicar, para evitar que Mermaid omita cantidades. Los participantes nuevos de secuencia usan identificadores internos seguros independientes del nombre visible; renombrarlos conserva los extremos de los mensajes. Las operaciones visuales se validan antes de publicar la fuente; un error conserva la última fuente válida y se comunica en español.
- Cerrar una pestaña confirma antes el campo enfocado. Si el cierre o la recarga coincide con la validación visual, se conserva el candidato como borrador recuperable para revisión explícita, sin escribirlo en el archivo. Cada acción aplicada tiene su propio paso de Deshacer/Rehacer; sus propiedades se actualizan también al recorrer el historial.
- El panel de propiedades permite seleccionar bloques y conexiones con listas accesibles. ER admite editar/borrar atributos, tipo, nombre, claves y comentario, y elegir cardinalidades y relación identificadora. Clases admite editar/borrar atributos y métodos, visibilidad, parámetros, modificador, cardinalidades y tipo de relación. El `.mmd` sigue siendo la fuente de verdad y las ediciones participan en Deshacer/Rehacer.
- Flujo incorpora trazo, puntas y colores, y movimiento entre grupos existentes. Los colores reflejan el SVG actual, también al deshacer. Estados permite crear compuestos y mover estados simples entre ellos; mover un compuesto completo sigue fuera de estos controles. Secuencia permite cambiar tipo y orden de mensajes, numerarlos, envolver un mensaje en un fragmento y activar/desactivar su destino durante ese mensaje. Las condiciones y ramas arbitrarias de los fragmentos se editan en Código.
- C4 y requisitos permiten eliminar nodos junto con sus relaciones. Kanban permite mover tarjetas entre columnas y reordenarlas; los mapas mentales permiten mover ramas con su subárbol y reordenarlas, protegiendo la raíz y rechazando ciclos. Se conservan los metadatos y fragmentos ajenos a la operación.
- Gantt expone dependencias, estado, tarea crítica e hito; rechaza dependencias inexistentes, ciclos y fechas finales anteriores al inicio. Gantt y cronología permiten mover elementos entre secciones y reordenar elementos o secciones; una sección con contenido se vacía antes de eliminarse. Sankey informa de que necesita al menos un flujo antes de eliminar el último. La sintaxis avanzada no reconocida permanece disponible en Código y se conserva sin regenerar el documento.

## Escritorio con navegación visible (v0.45)

- Las secciones Inicio, Memoria, Biblioteca, Notas, Diagramas y Buscar se presentan en una barra superior con icono y nombre. Ajustes y, en escritorio, Asistente conservan sus acciones. La navegación se desplaza horizontalmente cuando falta ancho; los estados de conexión, guardado y conflictos permanecen visibles debajo.
- El espacio de trabajo ofrece acciones con texto: mostrar/ocultar el lateral, Guardar todo, Actualizar PDF, Ver PDF, Consultar biblioteca y Abrir notas. Reutilizan el guardado, la compilación y las vistas existentes, con sus validaciones y errores. Actualizar PDF guarda los borradores de la memoria antes de solicitar la compilación. Consultar Biblioteca conserva los editores ocultos hasta volver.
- Memoria abre Archivos por defecto cuando no hay una preferencia guardada. «Apartados» conserva el esquema del documento y la clave de preferencia anterior; no se cambia una selección ya guardada. El lateral mantiene filtro, operaciones sobre archivos y ancho ajustable.
- Dockview conserva los grupos de pestañas, sus documentos y el layout guardado por instancia. El diseño inicial sigue siendo código y PDF en grupos separados; esta presentación no restablece ni migra los layouts existentes. El asistente mantiene la ventana superpuesta de v0.41.
- Tipografía Source Sans 3 y logotipo local; estilos basados en los tokens claros y oscuros existentes. Sin nuevas dependencias, cambios de API ni funciones simuladas del prototipo dentro de la app.

## Ajustes en ventana propia (v0.46)

- Ajustes se abre en un diálogo independiente del área de pestañas, tanto en web como en escritorio. Conserva detrás la vista activa (documento, Inicio o Biblioteca), los grupos de Dockview y los borradores. Cerrar con la X, Escape o el fondo devuelve el foco al control que lo abrió.
- Los campos sin guardar se mantienen al cerrar y reabrir durante la sesión. Cerrar no los guarda ni los descarta. Guardar/Restablecer mantienen sus comprobaciones y Descartar recupera los valores guardados; los asistentes de creación y preparación conservan sus acciones existentes. Recargar la app no conserva los campos pendientes de Ajustes.
- La ventana se ajusta al tamaño disponible y desplaza su contenido sin ocultar las acciones de guardar y cerrar. Los selectores de carpetas y el asistente inicial conservan sus diálogos y el orden de foco.
- Un layout anterior con la pestaña `settings` la retira y abre la ventana de Ajustes. Guarda el layout adaptado, manteniendo el resto de documentos y grupos; el siguiente arranque ya no restaura esa pestaña.

## Cabecera en una sola fila (v0.47)

- La navegación, el acceso rápido «Abrir o buscar», los estados globales y «Añadir» comparten la fila superior. Se elimina la fila exclusiva de búsqueda y estados; las acciones del espacio de trabajo conservan su barra propia.
- «Abrir o buscar» se presenta como botón de lupa con nombre accesible y ayuda con el atajo ⌘K/Ctrl+K. Conserva el diálogo y su búsqueda existentes. El menú Buscar mantiene la búsqueda persistente de contenido.
- En ventanas estrechas, los estados de guardado y disponibilidad usan iconos con texto accesible y ayuda al pasar el cursor. Los cambios sin guardar y los conflictos conservan sus contadores visibles. Las secciones siguen disponibles mediante desplazamiento horizontal.

## Buscar unificado con el acceso rápido (v0.48)

- «Buscar» en la navegación abre el mismo diálogo «Abrir o buscar» que ⌘K/Ctrl+K, sin cambiar la vista activa, el panel lateral ni los grupos de documentos. Se retira la lupa duplicada de la cabecera.
- Se elimina la búsqueda lateral. Una preferencia antigua con la sección `search` recupera Memoria al arrancar, conservando si el lateral estaba abierto o cerrado. Los resultados persistentes y los filtros de ámbito siguen disponibles mediante «Buscar … en todo (abrir panel)» en el diálogo.

## Orden de la navegación y acceso mediante el logo (v0.49)

- El logo y el nombre de la app forman el botón Inicio, con ese nombre accesible y ayuda al pasar el cursor. Sustituyen el botón separado con la casa y conservan la navegación existente entre Inicio y el espacio de trabajo.
- Las secciones se ordenan Memoria, Notas, Diagramas y Biblioteca. Buscar se sitúa en el extremo derecho de la navegación, antes de Asistente en escritorio y de Ajustes en web, conservando el diálogo de v0.48.

## Apartados independientes y Multivista con presets (v0.50)

- Memoria, Notas, Diagramas y Biblioteca tienen espacios de pestañas propios. Cambiar de apartado conserva los documentos abiertos, los borradores y la distribución interna; Memoria mantiene su división de código y PDF. Abrir un archivo dirige al apartado propietario: fuentes de memoria, notas, diagramas o fichas de Biblioteca, evitando editores duplicados para el mismo documento.
- Multivista es un apartado de la navegación. Combina dos apartados distintos mediante selectores independientes; elegir el que ya ocupa el otro lado intercambia ambos. El menú izquierdo queda en el extremo izquierdo y el derecho en el extremo derecho. Cada menú permite ocultarse y ajustar su ancho independientemente, también con teclado; el separador central permite un reparto del 25–75 %, flechas y doble clic para volver al 50 %.
- Los espacios se reutilizan entre la vista individual y Multivista. El foco determina sobre qué apartado actúan los controles globales. Inicio, Buscar, Ajustes y el asistente conservan sus presentaciones anteriores; Multivista no crea ventanas del sistema operativo.
- «Guardar vista» conserva un preset con nombre: los dos apartados, sus pestañas y distribuciones, la proporción central, el ancho y visibilidad de sus menús y la vista de Biblioteca. Seleccionarlo o restaurarlo recupera esa organización, sin guardar ni sustituir el contenido de los documentos. Los apartados ajenos al preset conservan su estado. Sustituir un nombre existente y eliminar un preset requieren confirmación.
- Los presets y la configuración de Multivista son preferencias locales, aisladas por `instanceId` bajo `et:spaces:v1:`; no se envían al servidor. Se valida lo recuperado de almacenamiento. Un error al aplicar una distribución conserva la anterior. Los borradores se mantienen en el store compartido y siguen ofreciendo recuperación explícita después de recargar.
- Los layouts anteriores se distribuyen entre los apartados conservando el orden y los grupos de cada uno. Las operaciones de renombrar, mover, eliminar y cambiar carpetas recorren todos los espacios; no se omiten documentos por estar ocultos. Se mantienen las revisiones `baseRev`, conflictos e historial existentes.

## Cabecera sin barra de acciones y aviso de TeX cerrable (v0.51)

- Se retira la barra global de acciones bajo la navegación. Guardar, compilar y consultar el PDF siguen disponibles en los editores, el visor, Inicio y los menús correspondientes; el estado global de cambios pendientes conserva Guardar todo. En vistas individuales se oculta el lateral desde su cabecera y se recupera mediante el botón del borde izquierdo; Multivista mantiene sus controles por lado.
- El aviso sobre TeX del sistema ofrece «Cerrar aviso de TeX». El cierre se recuerda localmente por instancia y selección de motor, también tras recargar. Una selección distinta tiene su propio aviso. La explicación de seguridad sigue disponible en Ajustes y no cambian los motores, sus permisos ni la compilación.

## Cambio de modo visible en Notas (v0.52)

- Las notas Markdown presentan «Vista previa» y «Editar» como botones con texto e icono, con el modo activo resaltado y `aria-pressed`. Conservan el atajo ⌘E/Ctrl+E y la conservación de cambios al alternar. La cabecera permite que los controles pasen a otra línea en espacios estrechos sin ocultar sus etiquetas.
- Se retira el acceso al asistente de la cabecera de Notas. El acceso general de escritorio permanece en la navegación superior.

## Motivo del motor PDF no disponible (v0.53)

- `GET /api/status` incluye `motor.mensaje` cuando el motor seleccionado no está disponible. TeX local identifica las herramientas ausentes o que no responden; Docker distingue fallo de conexión, tiempo de espera, error HTTP, respuesta no válida y servicio no listo. En modo automático se incluyen los fallos de Docker y TeX local si ninguno funciona, sin exponer URL internas ni errores crudos. `/api/engines` conserva el mismo diagnóstico en `docker.message` y `local.message`.
- El indicador «Motor PDF no disponible» permite abrir un diálogo con el motivo, el motor seleccionado, orientación para resolverlo y «Abrir Ajustes». En web se aclara que el motor se ejecuta en el servidor, no en el navegador. Inicio y la detección de motores en Ajustes muestran también el diagnóstico. No cambian la selección del motor ni el proceso de compilación.

## Tamaño ajustable del código y editor de diagramas (v0.54)

- Al mostrar Código, un separador permite ajustar su ancho frente al editor visual arrastrando o con las flechas izquierda/derecha (pasos del 5 %). Se limita al 20–80 % para mantener ambas zonas accesibles; Inicio/Fin alcanzan esos límites y el doble clic restaura el reparto 50/50.
- La proporción se recuerda en este navegador con `et:diagram:code-ratio`. Ocultar y volver a mostrar Código conserva el ancho elegido, el contenido y el historial de deshacer; el editor visual ocupa todo el espacio cuando el código está oculto.

## Permisos del asistente en Ajustes y controles compactos (v0.55)

- En escritorio, Ajustes ofrece las pestañas General y Asistente, accesibles con teclado. La rueda «Ajustes del asistente» de la ventana flotante abre directamente la segunda; los accesos generales abren General. Cambiar de pestaña o cerrar conserva los campos generales pendientes sin guardarlos.
- La pestaña Asistente reúne la cuenta y los permisos para conversaciones nuevas: memoria, Biblioteca y todas las notas o carpetas relativas al vault. La selección se aplica al elegirla, sin Guardar, y permanece solo durante la sesión, aislada por cuenta/proyecto y desmarcada inicialmente. No amplía el alcance de una conversación existente ni altera la revisión de propuestas; su resumen muestra los permisos originales y explica cómo iniciar otra conversación.
- El selector de modelo se sitúa junto a Enviar y conserva la preferencia por cuenta. Una conversación existente mantiene su modelo y requiere iniciar otra para cambiarlo. La cuenta deja de ocupar un bloque en el chat: el icono «Cuenta del asistente» abre su diálogo de conexión y gestión de uso, conservando el aviso inicial del plan. La ventana mantiene su posición y el mensaje pendiente al abrir estos ajustes.

## Acceso visible a conectar la cuenta en el asistente (v0.56)

- Cuando no hay una cuenta conectada, el asistente muestra «Conectar cuenta» junto al mensaje explicativo, con el mismo icono de usuario que la cabecera. Abre el mismo diálogo de cuenta para continuar la conexión. Si falta autorizar el plan o hay un error de cuenta, ofrece «Autorizar cuenta» o «Revisar cuenta». No inicia OAuth automáticamente ni descarta el mensaje pendiente.

## Edición visual conservadora de LaTeX (v0.57)

- Los `.tex` de Memoria ofrecen «Visual / Código». Ambos modos utilizan la misma instancia y documento de CodeMirror: alternar no transforma ni escribe el archivo, y conserva selección, historial de deshacer/rehacer, borradores y guardado con `baseRev` y resolución de 409. Otros tipos de archivo mantienen su editor actual.
- Visual y Código se agrupan en una caja con borde y fondo común; el botón del modo activo queda resaltado y ambos exponen su estado pulsado a las tecnologías de asistencia.
- La barra del editor no repite la ruta del archivo: la pestaña muestra el nombre y ofrece la ruta completa al pasar el cursor. El selector de modo queda a la izquierda y las acciones de guardado/compilación a la derecha.
- El subconjunto visual comprende párrafos, `chapter/section/subsection/subsubsection` (también con asterisco), `textbf/textit/emph` anidados en una línea, listas `itemize/enumerate` y citas simples `cite/parencite/textcite`. La barra permite dar formato a una selección equilibrada, convertir un párrafo/título, crear listas e insertar claves bibliográficas existentes. Los caracteres especiales escritos o pegados en texto visual se escapan como texto literal. El portapapeles visual intercambia texto sin formato; para pegar fuentes LaTeX se usa Código. Enter crea un párrafo o continúa la lista. Las ediciones parciales que desequilibrarían comandos ocultos se impiden; estos comandos se cambian desde Código.
- Las decoraciones se aplican sobre rangos de la fuente original; no existe serialización HTML → LaTeX ni normalización global. Comentarios, comandos, argumentos multilínea, fórmulas y entornos no soportados siguen visibles como código editable, sin ejecutar ni eliminar su contenido. Un rango no reconocido rechaza las acciones de formato con una explicación y permite continuar en Código. El modo visual no pretende reproducir la paginación, tablas, figuras o macros arbitrarias: el PDF compilado sigue mostrando la composición final con el motor existente.
- Los cambios visuales son ediciones locales sin guardar hasta la acción habitual de guardar/compilar. No cambian rutas, permisos, API, plantillas ya creadas ni requisitos de TeX. No se añaden dependencias.
- La copia visual se calcula desde la fuente completa y el rango seleccionado, también al cruzar delimitadores de negrita/cursiva o arrastrar texto; los fragmentos desconocidos conservan su contenido literal. Cortar, reemplazar o introducir saltos que desequilibrarían un formato muestra un aviso visible y accesible para continuar en Código, sin modificar el documento. Los extremos de citas y caracteres escapados visibles admiten escribir antes/después. Las etiquetas `\label{…}` finales de capítulos, anexos y párrafos se conservan literalmente al editar, vaciar, cambiar tipo o continuar tras el título.

## Permisos explícitos y retirada de acceso del asistente (v0.58)

- El `scope` de `POST /api/assistant/threads` conserva `{memoria,library,notes}` y añade `diagrams`, `attachments`, `prepareChanges` y `documents:[{root,path}]`. Los booleanos nuevos omitidos equivalen a `false`; documentos omitidos, a `[]`. Tipos incorrectos y capacidades desconocidas se rechazan. Las conversaciones antiguas no reciben permisos nuevos automáticamente. `permissionsOutdated:true` identifica los chats sin el catálogo completo: sus nuevos turnos/aplicaciones se rechazan con 403 para no reenviar contexto histórico bajo permisos incompletos. Su historial y las propuestas ya aplicadas conservan consulta y recuperación local con revisión y comprobación de revisiones.
- Memoria autoriza sus fuentes de texto excepto `.mmd`, que requieren Diagramas o un documento concreto. Biblioteca autoriza fichas y metadatos. PDF/imágenes requieren tanto acceso a su fuente como `attachments:true`; esa casilla sola no concede acceso a ningún archivo. `prepareChanges:true` permite preparar/aplicar propuestas solo sobre los textos existentes admitidos por v0.40 dentro del alcance de lectura. No habilita edición Mermaid ni escritura gestionada en Biblioteca. La lista de herramientas ofrecida al modelo y las comprobaciones del servidor respetan estas restricciones, incluso ante llamadas forzadas.
- `documents` concede hasta 30 archivos concretos relativos a memoria/notas, existentes, de formatos consultables y sin segmentos ocultos ni alias simbólicos. No concede sus carpetas ni archivos vecinos. Lectura/búsqueda vuelven a comprobar el destino real de enlaces. Los ámbitos amplios se unen a estos permisos; no hay exclusiones implícitas por elegir archivos.
- Ajustes → Asistente separa fuentes de operaciones, permite elegir documentos abiertos en la app y muestra el alcance efectivo del chat. Todas las casillas empiezan desmarcadas; las preferencias de sesión siguen aisladas por cuenta/proyecto y solo se utilizan al crear conversaciones nuevas. La conexión no concede acceso. Se informa antes de elegir de que consultar envía las fuentes a OpenAI.
- `POST /api/assistant/threads/:id/revoke {}` retira definitivamente el acceso de ese chat, con la autorización administrativa e identidad originales. Persiste `revoked:true`, aborta el turno y bloquea nuevos turnos y aplicaciones con **403**; no existe ampliación/reactivación del chat. Se descartan deltas/herramientas tardíos y se comprueba la retirada antes de enviar contexto y antes de iniciar cada escritura. Una escritura atómica ya iniciada puede terminar; no se deshace automáticamente. Historial y fuentes ya enviadas permanecen; la retirada no los elimina de OpenAI.
- El usuario puede revisar y deshacer localmente propuestas aplicadas o interrumpidas, también tras retirar acceso; esta recuperación no consulta al modelo ni concede herramientas nuevas. Mantiene identidad, rutas, bloqueos, `baseRev`, copias e historial. Las escrituras del registro del chat se serializan para conservar una retirada concurrente. Crear, mover/renombrar, enviar a papelera y adaptar plantillas siguen pendientes; este bloque no concede esas operaciones.

## Recomendación de permisos después de conectar (v0.59)

- Tras conectar una cuenta y autorizar el uso del plan, el aviso inicial y el diálogo de cuenta recomiendan revisar las fuentes y la preparación de cambios. «Configurar permisos» cierra los avisos/cuenta y abre directamente Ajustes → Asistente; no activa permisos, crea conversaciones ni envía mensajes. «Entendido» sigue permitiendo continuar sin conceder acceso a documentos. Reabrir la cuenta conserva la recomendación; en la propia pestaña de Ajustes remite a los controles de debajo.
- El acceso a Ajustes conserva la posición y el borrador del asistente y los campos generales pendientes. Una cuenta desconectada, una conexión pendiente o un plan sin autorizar no se presentan como listos para configurar. Se mantienen el consentimiento y los permisos por cuenta/proyecto y conversación de v0.58.

## Conservación de salidas completas del streaming (v0.60)

- El cliente de ChatGPT conserva los elementos finalizados de `response.output_item.done`, por índice, y los combina con `response.completed.output`. Un evento final con `output:[]` no descarta los mensajes, llamadas ni razonamiento cifrado que ya llegaron completos. Los elementos terminados prevalecen sobre versiones parciales y no se duplican llamadas. Se sigue exigiendo `response.completed` antes de devolver herramientas al servidor.
- Un resultado vacío, índices incorrectos o huecos en la salida generan un error visible; no se presentan como consulta completada sin respuesta. Los elementos acumulados mantienen un límite de 32 MiB. No cambian permisos, revisión de propuestas, presupuestos ni requisitos de cuenta. Referencia del protocolo: [eventos de streaming de Responses](https://developers.openai.com/api/reference/resources/responses/streaming-events).

## Consultas y herramientas accesibles desde el contexto (v0.61)

- Adjuntar no concede acceso. Antes de crear un chat o enviar un mensaje, la interfaz detecta los adjuntos sin permiso y ofrece «Autorizar documentos adjuntos». Enumera los archivos, avisa del envío a OpenAI y ofrece preparación de propuestas como casilla independiente, desmarcada. Cancelar conserva mensaje, adjuntos y chat. Aceptar prepara una conversación nueva con acceso exclusivamente a esos archivos; no hereda ámbitos amplios ni modifica el chat previo o las preferencias generales. No envía nada: el usuario aún debe pulsar Enviar. PDF/imágenes de la lista requieren su permiso binario; una selección sigue necesitando autorización del archivo completo, que se explica expresamente. El servidor mantiene las validaciones de v0.58.
- Las acciones sugeridas usan el documento adjunto o el activo en Memoria, Notas, Diagramas o Biblioteca. Explicar, resumir y revisar/redactar preparan un mensaje editable y adjuntan su contexto; no lo envían ni escriben archivos. Conservar un borrador tiene prioridad: la instrucción se añade al mensaje existente. Diagramas y fichas conservan sus restricciones de escritura; estas acciones no incorporan las operaciones pendientes de PA3–PA5 ni un permiso de solo selección.
- Las respuestas admiten Markdown seguro y Copiar. Las referencias conocidas se presentan como botones con el nombre de la fuente que abren su archivo; no se muestran UUID de propuestas en la actividad habitual. HTML e imágenes remotas del modelo no se ejecutan ni cargan; los enlaces externos admitidos usan HTTP(S). Los errores mantienen su alerta y relegan el código a detalles. Un estado accesible anuncia la consulta y su finalización sin leer cada delta.
- Revisar muestra el bloque cambiado entre el prefijo y sufijo comunes, con rótulos y signos que no dependen solo del color, y permite desplegar los archivos completos. Los cambios dispersos pueden quedar agrupados. Al deshacer, el resultado previsto es el contenido anterior. Se conservan selección de archivos, revisión explícita, revisiones, conflictos y recuperación local.
- Ajustes → Asistente separa «Esta conversación» de «Próximas conversaciones». El selector de carpetas permite añadir carpetas de notas sin escribir rutas y conserva la entrada manual como opción. Biblioteca sigue siendo independiente. No se amplía el chat actual al cambiar estos controles.
- La ventana flotante permite cambiar tamaño arrastrando su esquina o mediante flechas sobre «Cambiar tamaño del asistente» (20 px; Mayús, 40 px; Inicio, tamaño original). La preferencia local `et:assistant:size` se valida, se limita al espacio disponible y se conserva al minimizar/restaurar. El texto de conversación y permisos se hace más legible y «Nueva conversación» presenta una etiqueta visible.

## Menú contextual por contenido y elemento (v0.62)

- La aplicación reutiliza un menú contextual común con título del contexto, acciones deshabilitadas cuando no proceden, desplazamiento y ajuste a los bordes de la ventana. Flechas, Inicio/Fin y Escape permiten recorrerlo y cerrarlo; al cancelar o ejecutar una acción devuelve el foco al origen antes de abrir su destino. Clic fuera, Tab y pérdida de foco lo cierran. No propaga los atajos al editor mientras se navega por sus opciones.
- Los editores de texto, incluidos código Mermaid y LaTeX visual, ofrecen copiar/cortar/pegar, selección completa, deshacer/rehacer y las acciones disponibles de guardar/ver en PDF. El portapapeles pasa por los manejadores y filtros existentes de CodeMirror: no se evita la protección del modo visual ni su historial. Si cambian texto o selección mientras se abre el menú o se lee el portapapeles, no se aplica una operación sobre un destino distinto; se pide reabrirlo. No se guarda automáticamente.
- La vista previa de Notas y las notas de una ficha de Biblioteca ofrecen copiar/seleccionar contenido y pasar al editor correspondiente. Los campos de formulario, enlaces y botones mantienen sus menús propios. Los editores, las zonas de lectura enfocables y el lienzo abren las acciones con clic derecho, tecla de menú o Mayús+F10.
- En los lienzos editables de flujo, estados, clases, entidades y secuencia se distingue el bloque pulsado, una conexión o el fondo. Se reutilizan propiedades, texto/etiqueta, conexiones, adición, borrado de elementos y deshacer/rehacer; el borrado de elementos es una edición recuperable del borrador, no una operación sobre archivos. Las acciones se vinculan al elemento del menú, aunque hubiera otro seleccionado, y se rechazan si cambió la fuente antes de ejecutarlas. Los demás tipos conservan sus formularios/código y acciones generales.
- En escritorio, el menú permite preparar explicaciones y resúmenes de una selección/documento o del bloque/conexión identificado; los textos compatibles ofrecen mejorar redacción. Se conserva cualquier mensaje pendiente. Abrir una acción no consulta al modelo, concede permisos ni aplica propuestas: el usuario revisa contexto y autorización y pulsa Enviar. Mermaid y Biblioteca mantienen sus restricciones de escritura; el menú no implementa PA3. La selección sigue requiriendo permiso del archivo completo conforme a v0.61; no completa el permiso mínimo ni las propuestas sobre borradores de PA2.

## PDF fijo en la vista individual de Memoria (v0.63)

- Memoria en vista individual reserva el lado derecho para el PDF compilado, sin pestaña ni botón de cierre. Abrir o cerrar documentos afecta solo al área de edición. Se conserva el visor existente, sus diagnósticos, compilación y navegación código ↔ PDF; «Ver PDF» dirige al visor fijo.
- Un separador permite ajustar editor/PDF mediante arrastre, flechas izquierda/derecha (5 %), Inicio/Fin y doble clic para volver a mitades iguales. Ambas zonas mantienen un mínimo del 20 %. La proporción se recuerda por proyecto con `et:memoria:pdf-ratio:<instanceId>` y no cambia los anchos de Multivista.
- En Multivista se mantiene el PDF como pestaña de Memoria, con su distribución y cierre habituales; no se añade un segundo visor fijo. Alternar los modos conserva los documentos abiertos, borradores e historial de edición. Los layouts antiguos que mezclaban PDF y documentos separan el visor sin cerrar los editores.

## Contexto del TFG y propuestas de diagramas (v0.65)

Solo escritorio. `GET/POST /api/assistant/context` lee/edita ficha, selección y concesiones. POST exige `baseRev`, `project` y, al cambiar concesiones, `account`; 409 conserva el formulario. Ficha: tema, objetivos, alcance, metodología, terminología, decisiones y dudas; el título sigue en Datos del trabajo. Modos off/all/partial; ámbitos notes/memoria/library/diagrams, folders/files/excluded con raíz y ruta relativa. Las exclusiones prevalecen; todo incluye documentos nuevos. Desactivar conserva selección, fragmentos e historial. El checkbox de notas modifica este registro, nunca Markdown/frontmatter. Desmarcar desde Todo pasa a Parcial con exclusión explícita. Una exclusión de carpeta se revisa en Ajustes antes de incluir una nota de esa carpeta.

Concesiones independientes por cuenta/proyecto: prepareContext, useContext, prepareDiagrams y search (reservado a la búsqueda). Inicialmente cerradas; no amplían permisos de originales, adjuntos ni edición del chat. La identidad de proyecto incluye raíces e identidad de Biblioteca. Retirar permisos o cambiar cuenta/raíces detiene las peticiones afectadas. Se comprueba cuenta, proyecto y concesión antes de cada petición.

`POST /context/prepare` exige revisión, modelo y dirty vacío; prepara hasta tres fragmentos de 20.000 caracteres de texto guardado (.md/.tex/.bib/.txt/.mmd, máximo 2 MiB por archivo, sin enlaces). Una propuesta es asíncrona y recuperable; GET muestra estado, fragmentos, procedencia root/path/rev/offset/length y pendientes. `/context/cancel`, `/context/proposals/:id/accept|reject` y `/context/undo` permiten detener, corregir/aceptar, rechazar y deshacer. Las decisiones duraderas exigen revisión. Aceptar revalida fuentes; nunca convierte una inferencia en decisión confirmada sin revisión. La app cerrada deja propuestas incompletas recuperables como error, sin reintentarlas automáticamente.

El watcher no consulta IA: invalida localmente los derivados y avisa desde el primer cambio respecto a las fuentes aceptadas; el aviso destacado llega a aproximadamente 500 palabras o tres archivos. Se compara la versión completa con su base para no contar dos veces el mismo cambio. No se leen excluidos para calcular avisos. Un fragmento modificado, eliminado o excluido sale del contexto efectivo; los demás conservan su procedencia independiente.

Cada acción muestra la versión/texto efectivo y ofrece incluirlo, inicialmente desmarcado. Enviar `contextVersion` exige coincidencia con esa vista previa. Las conversaciones conservan las versiones utilizadas; antes de continuar se revalidan también los contextos históricos para impedir reenviar derivados retirados. Si sus fuentes ya no son válidas se pide una conversación nueva, conservando el historial local.

`GET/POST /diagram-generations` lista/prepara propuestas por cuenta; POST exige revisión/proyecto, permiso propio, modelo disponible, nombre, tipo de los quince existentes, descripción y contexto opcional. `/diagram-generations/cancel` detiene. Generar no crea archivos; la interfaz permite corregir Mermaid, renderiza con el renderer seguro existente y deshabilita Crear diagrama hasta tener un render correcto. Crear reutiliza la operación exclusiva actual: un nombre ocupado nunca se sobrescribe. Exportar/insertar son posteriores. El proveedor separa propósitos chat/context/diagram/search/review; contexto, diagramas y revisión no reciben navegación ni herramientas del chat.

Persistencia privada: `DATA_DIR/project-context/<project>/state.json`, atómica con copia previa en `history/notes/.asistente/<project>/context.json/`. Incluye ficha, selección, fragmentos, bases, propuestas, historial, generaciones y concesiones; nunca localStorage como única copia. SSE `project-context` comunica invalidación sin contenido privado. Sin cambios de plantilla, BD ni embeddings.

El contexto efectivo de una acción tiene un límite de 60.000 caracteres: el servidor pide reducir selección o resúmenes antes de enviarlo si se supera. No trunca ni cambia el modelo silenciosamente.

## Búsqueda asistida y bandeja de revisión (v0.66)

Solo escritorio: `GET/POST /api/assistant/searches`, `GET /searches/:id`, `POST /searches/:id/cancel|retry`. Crear exige cuenta/proyecto actuales, modelo disponible y permiso `search` de esa cuenta/proyecto. Filtros: need, kinds, language (vacío/es/en), fromYear/toYear opcionales; mode quick inicial o extended; provider web o crossref. GET devuelve consultas recientes y preferredModel de la preferencia explícita o de la última ejecución de esa cuenta/proyecto. Cambiar cuenta/proyecto descarta respuestas tardías en la interfaz. No se sustituye el modelo si desaparece o falla.

Rápida utiliza un agente web; Ampliada, dos especialistas en paralelo coordinados por la app. Crossref consulta metadatos en paralelo mediante la política HTTP existente, ahora cancelable sin relajar DNS/IP pública, redirecciones, tamaño ni plazo. Descubrimiento recibe únicamente filtros visibles; el contexto autorizado, opcional y previsualizado mediante contextVersion, se utiliza después en una petición de valoración sin herramientas ni navegación. El chat conserva sus herramientas y no gana búsqueda web. No se usa multi_agent hospedado, conforme a las [limitaciones oficiales del acceso con ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

La búsqueda web solicita fuentes y conserva URLs de web_search_call.action.sources y anotaciones url_citation; una propuesta sin URL efectivamente devuelta no se incorpora a candidatos. Se distingue página abierta por la herramienta de un resultado de descubrimiento. Las citas se muestran como enlaces; no se descargan adjuntos ni imágenes remotas. Crossref valida metadatos bibliográficos, nunca calidad científica; utiliza [query y filtros de publicación](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/). Se excluyen tipos, idiomas y fechas conocidos incompatibles; los campos ausentes permanecen visibles como pendientes de comprobar, sin inventarlos.

Cada consulta permite máximo dos agentes simultáneos, cinco intentos de petición de modelo y veinte candidatos. Se persiste el presupuesto antes de cada petición y se revalidan modelo, cuenta, proyecto y permisos. Al llegar al límite se muestran parciales; ampliar requiere crear otra ejecución. Estado por parte (Crossref, especialista(s), valoración), cancelación y errores quedan conservados. Retry solo repite descubrimiento fallido y la valoración dependiente; no vuelve a consultar Crossref si ya acabó correctamente. Web no disponible/error nunca activa otra fuente automáticamente: mantiene parciales y ofrece Continuar solo con Crossref como nueva acción explícita.

Los candidatos están fuera de Biblioteca y tienen estado pending/discarded/saving/saved, datos disponibles, fuentes y explicación de utilidad, aportación, posible uso y límites. La valoración se identifica como inferencia del asistente. `POST /searches/:id/candidates/:candidate/decision` cambia pending/discarded con baseRev/project; GET .../review prepara el formulario y posibles duplicados. DOI, URL e identificación estable se deduplican durante descubrimiento; el guardado revisa de nuevo DOI/URL/título, incluidos .bib manuales. Coincidir por título siempre requiere una decisión humana.

`POST .../save` exige baseRev/project y formulario de título, tipo, descripción, aportación editable, etiquetas y colecciones; posibles duplicados requieren elección explícita. Usar una ficha existente enlaza sin modificarla. Crear otra conserva la existente. Una ficha nueva conserva el resumen y un apartado separado «Aportación del asistente» con fuentes. Los recursos académicos con metadatos Crossref reutilizan importación bibliográfica, original inmutable y su recibo; los demás, captura recuperable sin consultas/descargas adicionales. La importación acepta note/tags/collections/kind opcionales para nuevas fichas, con validación y sin alterar las decisiones anteriores.

El intento y su operación idempotente se registran antes de publicar. Un fallo posterior se recupera con ese recibo, sin duplicar. El formulario iniciado queda conservado; cambiarlo durante recuperación o competir con datos distintos devuelve 409. Todos los conflictos conservan el formulario. Terminar una búsqueda, cerrar la bandeja o reiniciar nunca incorpora recursos automáticamente.

Registros privados en `DATA_DIR/discovery/<project>/<account-hash>/<id>.json`, con escrituras atómicas y copia anterior en history/notes/.asistente/<project>/discovery/. Conservan consultas, candidatos, decisiones, fuentes, explicación, versiones del contexto e intentos de guardado. Tras cierre inesperado se recuperan parciales sin reintentar proveedores. Retirar acceso cancela tareas y bloquea nuevos envíos; la revisión local y el historial permanecen. No se utiliza localStorage como copia única ni se añaden BD, embeddings o framework de agentes.

La integración conserva las bases de contexto una sola vez por revisión en `project-context/<project>/baselines/`, con huella y permisos privados; estado e historial referencian esas bases. Evita duplicar textos grandes en cada lote. Los veinte conjuntos anteriores siguen disponibles para deshacer. Los documentos que ya estaban seleccionados al aceptar el primer lote no producen falsos avisos por seguir pendientes. Los formatos anteriores se conservan y su conversión no toca originales.

`POST /searches/model` conserva la elección incluso antes de ejecutar una consulta: exige revisión, cuenta/proyecto y modelo disponible, escribe `discovery/<project>/<account-hash>/model.json` con historial y devuelve su revisión. GET /searches incluye modelPreference para revisar conflictos; nunca sustituye un modelo desaparecido.
