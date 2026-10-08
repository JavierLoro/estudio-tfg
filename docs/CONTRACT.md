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
