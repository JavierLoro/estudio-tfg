# Worker LaTeX — Estudio TFG

Servicio HTTP mínimo (Node 24, sin dependencias npm) sobre `texlive/texlive:latest-full`.
Contrato: `docs/CONTRACT.md` → «Worker».

| Archivo | Qué es |
| --- | --- |
| `server.mjs` | HTTP en `:8090`: `GET /health`, `POST /compile {main}` |
| `parse-log.mjs` | Parser de `.log` (LaTeX) y `.blg` (BibTeX/Biber) → `Diagnostic[]` |
| `parse-log.test.mjs` | Tests `node:test` (snippets + logs reales en `test-logs/`) |
| `Dockerfile` | TeX Live full + binario `node` copiado de `node:24-slim`, usuario uid 1000 |

## Uso

```sh
# desde la raíz del repo (lee MEMORIA_DIR de .env)
docker compose up -d --build worker      # o: npm run worker
curl -s localhost:8090/health
curl -s -XPOST localhost:8090/compile -H 'content-type: application/json' -d '{"main":"main.tex"}'
docker compose logs -f worker

# tests del parser (no necesitan Docker)
node --test worker/parse-log.test.mjs
```

Sin Compose (equivalente):

```sh
docker build -t estudio-tfg-worker worker
docker run -d --init -p 127.0.0.1:8090:8090 \
  -v "$PWD/test/fixtures/memoria:/src:ro" -v "$PWD/data/builds:/out" \
  --read-only --tmpfs /tmp:rw,exec,size=1g --cap-drop ALL \
  --security-opt no-new-privileges --memory 2g estudio-tfg-worker
```

Variables: `PORT` (8090), `SRC_DIR` (/src), `OUT_DIR` (/out), `COMPILE_TIMEOUT_MS` (120000), `KEEP_BUILDS` (10).

## Qué hace `POST /compile`

1. Valida `main`: relativa, termina en `.tex`, sin `..`, sin `/` inicial, sin segmentos que empiecen por `-` (evita que se cuele como opción de latexmk) → si no, **400**.
2. Cola: una compilación a la vez; las peticiones concurrentes esperan su turno.
3. Copia `/src` a `/tmp/build-XXXX` omitiendo dotfiles, `*.sync-conflict-*`, `*.lock`, `build/`, `node_modules/`, `_minted*` y auxiliares (`aux log out toc lof lot lol bbl blg fls fdb_latexmk synctex.gz acn acr alg bcf run.xml xdv nav snm vrb idx ilg ind glo gls glg`). Symlinks solo si apuntan dentro de `/src`.
4. `latexmk -pdf -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape <main>` en su propio grupo de procesos; al pasar el timeout se mata el grupo (SIGTERM, y SIGKILL a los 2 s). Con `max_print_line=10000` para que el log no se corte a 79 columnas.
5. Escribe en `/out/<buildId>/` (`buildId` = `AAAAMMDD-HHMMSS-xxxxxx`, UTC):
   - `main.log` (siempre), `main.pdf` y `main.synctex.gz` (solo si `ok`), `latexmk.txt` (salida de latexmk; extra para depurar).
   - Los nombres son fijos aunque `main` se llame distinto. En el synctex se reescriben las rutas del temporal a rutas relativas al proyecto (`Input:1:main.tex`).
6. Borra el temporal y deja solo los 10 últimos `buildId` en `/out` (no toca otras carpetas).
7. Respuesta: `{ ok, buildId, durationMs, pdf: "<id>/main.pdf"|null, log: "<id>/main.log", diagnostics }`. `ok` = latexmk salió con 0, hay PDF y no hay errores.

### Diagnósticos

`{ severity, file, line, message }`, errores primero, deduplicados. `file` relativo al proyecto (`cap/intro.tex`); si el aviso viene de un paquete de TeX Live se deja la ruta absoluta (`/usr/local/texlive/...`).

- **Errores**: `./archivo.tex:12: mensaje` (file-line-error), `! Mensaje` + `l.N` (archivo por la pila de paréntesis del log), `*** (job aborted, no legal \end found)`, errores del `.blg` (`---line N of file x.bib`, Biber `ERROR -`). Si latexmk falla/agota tiempo sin error reconocible, se añade uno genérico.
- **Avisos**: `LaTeX Warning`, `Package X Warning` (con líneas de continuación `(X)`), `Class X Warning`, `pdfTeX warning`, `Warning--` de BibTeX, `WARN -` de Biber. `… on input line N` → `line`.
- **Se ignoran**: `Overfull/Underfull/Loose/Tight \hbox|\vbox` (y su contenido), `LaTeX Font Warning`, `Warning--I didn't find a database entry` (ya sale como `Citation … undefined`).
- **Ruido de compilación abortada**: latexmk se detiene en el primer `pdflatex` con error y, como se compila desde cero, todas las citas/referencias salen indefinidas. Si hay errores, se ocultan `Citation/Reference … undefined`, `There were undefined references`, `Label(s) may have changed`, `rerunfilecheck`, `Acronym X is not defined`. En compilaciones sin errores sí se muestran.
- El parser también tolera logs cortados a 79 columnas (por bytes), por si se usa fuera del worker.

## Fase 0: plantilla esi-tfg (`test/fixtures/memoria`)

Medido el 2026-10-06 en el Mac (Docker Desktop 29.8.1), imagen `texlive/texlive:latest-full` = **TeX Live 2026**, pdfTeX 1.40.29, latexmk 4.88. Imagen del worker: 9.2 GB.

**Requisitos de la plantilla**

- Motor: **pdflatex** (`inputenc utf8` + `fontenc T1`, `babel spanish`, `beramono`, `listings`, `acronym`, `hyperref`, `titlesec`, `lettrine`, `tipa`…).
- Bibliografía: **BibTeX** (no Biber). La clase fija `\bibliographystyle{ieeetr}`; `es-alpha.bst` del repo no se usa salvo que se cambie.
- `arco-authors` (mencionado en el `Makefile`/README) **no hace falta**: el `Makefile` no se usa, latexmk basta.
- Paquetes que faltan: **ninguno** con TeX Live full.
- No necesita shell-escape (epstopdf avisa de que está desactivado; las figuras son PDF).

**Tiempos** (`durationMs` del worker, incluye copia + latexmk + parseo; compilación siempre desde cero)

| Caso | Resultado | Tiempo |
| --- | --- | --- |
| Plantilla limpia (48 págs.): pdflatex ×3 + bibtex ×2 | `ok: true` | 1.56–1.68 s (5 medidas) |
| Error en `.tex` (latexmk para tras el 1.er pdflatex) | `ok: false` | ~0.55 s |
| Paquete inexistente (`\usepackage{paquetequenoexiste}`) | `ok: false` | ~0.3 s |
| Bucle infinito (`\def\bucle{\bucle}\bucle`) | cancelado por timeout | = timeout |

**Avisos de la plantilla limpia** (12, todos de la propia plantilla):
`hyphenat` (opción `htt`), `epstopdf: Shell escape feature is not enabled`, `blindtext: spanish not defined` (intro.tex:47, 53; anexo1.tex:7), `pdfTeX: destination with the same identifier (name{page.N})` ×6 (numeración de páginas repetida entre frontmatter y mainmatter con hyperref), `pdfTeX: name{chap:GFDL} has been referenced but does not exist` (main.tex, la GFDL está comentada).

**Errores inyectados en una copia** (nunca en `test/fixtures`), diagnóstico obtenido:

| Inyección | Diagnóstico |
| --- | --- |
| `\comandoinexistente` en intro.tex:12 | error `intro.tex:12 Undefined control sequence.` |
| `\cite{noexiste}` y `\ref{sec:nada}` en objetivos.tex:65 | `ok: true`, avisos `objetivos.tex:65 Citation `noexiste' … undefined.` y `Reference `sec:nada' … undefined.` |
| `\usepackage{paquetequenoexiste}` en custom.sty:5 | error `custom.sty:6 LaTeX Error: File `paquetequenoexiste.sty' not found.` (TeX informa la línea siguiente porque `\usepackage` mira si sigue `[fecha]`) |
| descomentar `\input{metodo.tex}` (no existe) en main.tex:33 | error `main.tex:33 LaTeX Error: File `metodo.tex' not found.` |
| quitar `}` en main.bib:4 | error `main.bib:9 BibTeX: I was expecting a `,' or a `}'` (BibTeX lo detecta al empezar la siguiente entrada) |
| borrar `\end{document}` | error `main.tex Falta \end{document}` |
| `\begin{itemize}` sin cerrar en intro.tex:3 | error `main.tex:48 LaTeX Error: \begin{itemize} on input line 3 ended by \end{document}.` |
| `main` = `../etc/passwd.tex`, `/etc/x.tex`, `-shell-escape.tex`, `a/../main.tex`, `main.sty` | 400 |
| `main` = `sub/otro.tex` | compila; salida igualmente en `<id>/main.pdf` |

Seguridad verificada en Compose: uid 1000, `CapEff: 0`, raíz de solo lectura (escritura solo en `/tmp` tmpfs y `/out`), `-no-shell-escape`, `init: true` (sin procesos zombi tras matar latexmk por timeout).

## Notas

- **Red**: `latex` no es `internal: true` porque Docker no publica puertos de contenedores que solo están en redes internas (comprobado), y en desarrollo el server nativo usa `127.0.0.1:8090`. El worker no hace peticiones salientes.
- `tmpfs /tmp` (1 GB) cuenta contra `mem_limit: 2g`. Para memorias con muchas figuras grandes puede hacer falta subirlo.
- **Mejora posible** si la memoria real crece y la compilación se vuelve lenta: conservar `.aux/.bbl/.toc/.fdb_latexmk` entre compilaciones en una caché en `/tmp` (latexmk solo repetiría lo necesario, y las compilaciones con error darían referencias reales). Hoy no compensa: 1.6 s desde cero.
- Si `ok` es `false` no se escribe `main.pdf`; el server sirve el último PDF correcto.
