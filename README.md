# Estudio TFG

[![CI](https://github.com/JavierLoro/estudio-tfg/actions/workflows/ci.yml/badge.svg)](https://github.com/JavierLoro/estudio-tfg/actions/workflows/ci.yml)

Entorno self-hosted para escribir la memoria del TFG en LaTeX con el PDF al lado, consultar tus notas de Obsidian y capturar recursos sin perderlos. Es una herramienta local: los archivos en disco son la fuente de verdad, no hay base de datos, y tu trabajo vive fuera de este repositorio.

Se desarrolla y prueba en macOS. El modo Docker y el arranque nativo están preparados para Windows, Mac y Linux; las verificaciones pendientes por plataforma se recogen en [docs/PLATAFORMAS.md](docs/PLATAFORMAS.md) y [docs/HOJA-DE-RUTA.md](docs/HOJA-DE-RUTA.md).

Especificación: [docs/CONTRACT.md](docs/CONTRACT.md) · Worker y requisitos de la plantilla: [worker/README.md](worker/README.md) · Guía para agentes de código: [AGENTS.md](AGENTS.md)

Cada push y PR ejecuta tests, typecheck y build en Linux, macOS y Windows con
Node 24, incluidos recorridos básicos de Biblioteca en Chromium. Otro job construye
el worker, compila todos los perfiles con cero avisos y ejecuta la suite completa
de Biblioteca y recuperación con PDF real en Chromium/Linux.
Para repetir esa comprobación: `node scripts/compile-template.mjs --output-dir <carpeta>`;
la carpeta debe coincidir con el volumen `/out` del worker. Se usan copias temporales
de la plantilla y no se lee `.env`. Los logs de CI se conservan durante 7 días.

## Usarlo con Docker (Windows, Mac, Linux)

Necesitas Docker con Compose v2 o posterior. En Windows y Mac, instala y arranca
**Docker Desktop**; en Windows habilita la virtualización y el backend **WSL2**.
Reserva unos **10 GB libres** para TeX Live. No necesitas Node ni LaTeX en el host.
Descarga el repositorio o clónalo si tienes Git:

```bash
git clone https://github.com/JavierLoro/estudio-tfg.git
cd estudio-tfg
```

1. Copia `.env.example` a `.env` (`cp .env.example .env` en macOS/Linux;
   `Copy-Item .env.example .env` en PowerShell). Edita estas dos entradas:

   ```dotenv
   HOST_HOME=/ruta/absoluta/a/tu/carpeta-TFG
   AUTH_TOKEN=elige-un-token-largo-y-propio
   ```

   `HOST_HOME` debe existir y contener tu vault y la carpeta donde crearás la
   memoria. En Windows usa, por ejemplo, `C:/Users/Ana/Documents/TFG`, con `/`,
   sin `~` ni variables de shell. Si lo omites, se monta `Documents` bajo `HOME`
   (Mac/Linux) o `USERPROFILE` (Windows): comprueba que exista y no esté redirigida
   a OneDrive. El token permite cambiar Ajustes desde el navegador aunque Docker
   presente la conexión como procedente del puente de red.
2. Crea las carpetas locales **antes del primer arranque**, para que Docker no
   las cree como root. En macOS/Linux:

   ```bash
   mkdir -p data/builds workspace/notes workspace/memoria
   ```

   En PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force data/builds, workspace/notes, workspace/memoria
   ```

   Si defines `NOTES_DIR` o `MEMORIA_DIR`, crea también esas carpetas antes de
   arrancar. Dentro del repo solo pueden estar bajo `workspace/` (ignorada).
3. Levanta app y worker con un comando:

   ```bash
   docker compose --profile app up -d --build
   ```

4. Abre http://localhost:8787 e introduce tu token. En **Ajustes**, abre el
   selector de carpetas: `/data/home` es tu `HOST_HOME`. Elige el vault y crea la
   memoria bajo esa raíz. No hace falta volver a editar `.env`; las selecciones
   se guardan en `data/settings.json`. Las rutas de la interfaz son las del
   contenedor (POSIX), también cuando el navegador está en Windows.

App y worker comparten `data/builds`; ajustes e historial persisten en `data/`.
El sondeo de cambios está activado automáticamente en Docker; puedes forzarlo
con `WATCH_POLLING=on` o desactivarlo con `off`. Si la vigilancia falla, la
cabecera muestra el aviso y su detalle.

En **Linux**, ambos contenedores escriben con uid/gid **1000:1000**. Comprueba los
permisos de las carpetas montadas: ese uid debe poder recorrerlas y escribir en
las notas y memoria. Para los datos de la herramienta:
`sudo chown -R 1000:1000 data workspace`. Si tu usuario tiene otro uid, dale
acceso también al uid 1000 en las carpetas externas mediante permisos o ACL;
conserva la propiedad de tus documentos. Docker Desktop gestiona los permisos
compartidos en Mac y Windows.

Para actualizar un clon: `git pull` y vuelve a ejecutar el comando de arranque.
Si descargaste un ZIP, sustituye las fuentes conservando `.env`, `data/` y
`workspace/`. Para parar: `docker compose --profile app down`; las carpetas
montadas permanecen en el host. Puedes consultar los logs con
`docker compose --profile app logs -f app worker`.

## Desarrollar (server y web nativos)

Necesitas **Node ≥ 24**, npm y un motor de compilación: Docker o TeX instalado en el equipo. Git es recomendable para
el historial y las actualizaciones de plantilla; sin él se crea la memoria con
un aviso. Clona el repositorio, entra en él y ejecuta:

```bash
npm run init
npm run install:all
```

`init` crea `.env` y tu memoria, sin sobrescribir archivos. Puedes elegir
institución con `npm run init -- --perfil generico` (por defecto `esi-uclm`).
Antes de levantar el worker, crea `data/builds`: `mkdir -p data/builds` en
macOS/Linux o `New-Item -ItemType Directory -Force data/builds` en PowerShell;
en Linux revisa los permisos del uid 1000 indicados arriba.

```bash
npm run worker
npm run dev
```

API en :8787, web en http://localhost:5173 y worker en 127.0.0.1:8090. Un solo
`npm run dev` levanta API y web también en Windows; Ctrl+C cierra ambas.
`npm start --prefix server` arranca solo la API (sirve la web si existe
`web/dist`, que genera `npm run build --prefix web`).

Elige las carpetas en Ajustes o `.env`. En Windows se admiten unidades y UNC;
`ALLOWED_ROOTS` separa varias raíces con `;` (con `:` en Mac/Linux). Mantén vault
y memoria fuera de OneDrive, Dropbox o Google Drive; si usas OneDrive, marca
«Mantener siempre en este dispositivo». Los atajos usan Ctrl en Windows/Linux;
si chocan con el navegador, usa los botones. Más detalles en
[docs/PLATAFORMAS.md](docs/PLATAFORMAS.md).

### Elegir motor de compilación

En **Ajustes → Motor de compilación**, elige Docker, TeX del sistema o Automático.
Docker se mantiene por defecto para instalaciones anteriores. Automático prefiere
el worker disponible; si no responde, usa TeX local. Un fallo de compilación no
repite el proyecto con otro motor.

Para trabajar sin Docker, instala una distribución TeX y comprueba que `latexmk`,
`pdflatex` y `biber` estén en el PATH del proceso que arranca la API. Elige **TeX del
sistema** en Ajustes o define `COMPILE_ENGINE=local` en `.env`, y ejecuta `npm run dev`
sin levantar el worker. Ajustes muestra herramientas, versiones, diferencias con
la referencia Docker y lo que falta. `rsvg-convert` es opcional para compilar;
se necesita para exportar diagramas a PDF con el motor local hasta F1.
MiKTeX necesita [Perl para ejecutar latexmk](https://miktex.org/kb/fix-script-engine-not-found);
su ruta también debe estar en PATH. El entorno controlado conserva esa dependencia.

El motor local ejecuta con los permisos del usuario: compila solo fuentes de
confianza. El aviso permanece visible con Local/Automático. Usa copias temporales,
ignora rc/configuración del proyecto y conserva shell-escape desactivado, pero
**no es un sandbox**. Detalles y comprobaciones: [SEGURIDAD-COMPILACION.md](docs/SEGURIDAD-COMPILACION.md).
Si la API está dentro de Docker, «TeX del sistema» se refiere al interior de ese
contenedor, no al TeX del host.

### Instalar TeX para la plantilla

La base comprobada es **TeX Live 2026**, con pdfLaTeX 1.40.29, latexmk 4.88 y
biber 2.22. Mantén **biblatex y biber de la misma distribución**, actualizados
juntos; BibTeX no sustituye a biber en esta plantilla. Versiones anteriores no
están certificadas por estas pruebas.

- **macOS:** [MacTeX 2026](https://www.tug.org/mactex/) completo incluye TeX Live.
  Añade `/Library/TeX/texbin` al PATH del proceso que inicia la API y reinícialo
  después de instalar. La prueba nativa usó TeX Live en un temporal, sin instalar
  el paquete MacTeX ni sus aplicaciones.
- **Linux/Windows:** [TeX Live 2026](https://www.tug.org/texlive/quickinstall.html)
  completo es la opción con menos preparación. Añade su carpeta `bin/<plataforma>`
  al PATH. En Linux, los paquetes de la distribución pueden tener otros nombres;
  comprueba versiones antes de mezclar repositorios.
- **MiKTeX (Windows):** instala también Perl y añade ambas carpetas de binarios al
  PATH. Instala previamente los paquetes de abajo desde MiKTeX Console y actualiza
  biber/biblatex juntos. La compilación desatendida no puede responder a diálogos
  de instalación automática. **MiKTeX no se ha validado físicamente todavía**.

Una alternativa ligera comprobada en macOS es `scheme-basic` de TeX Live 2026,
sin documentación ni código fuente de los paquetes, más este conjunto (nombres de
`tlmgr`; incluye dependencias de la clase y las fuentes):

```sh
tlmgr install latexmk biber babel-spanish hyphen-spanish hyphen-german \
  newtx tex-gyre bera lm microtype geometry setspace enumitem xcolor caption \
  booktabs listings acronym tocbibind csquotes biblatex biblatex-ieee titlesec \
  hyperref xpatch xstring xkeyval fontaxes mweights textcase anyfontsize ly1 bigfoot
```

Usa permisos de administrador solo si tu instalación TeX es del sistema.
El conjunto probado ocupa aproximadamente **330 MiB**, sin herramientas para
exportar SVG. `hyphen-german` resolvió un formato pdfLaTeX incompleto del instalador
`scheme-basic` del 13-10-2026; no es un requisito del idioma de la memoria.
No se garantiza ese tamaño para otras fechas o plataformas.

**Validación del 13-10-2026**, con el adaptador local de la API: ambos perfiles
incluyen una cita y figura importadas; también se recompila una copia trasladada
sin Biblioteca. «0» cuenta los diagnósticos finales de LaTeX/biber.

| Distribución y entorno | `esi-uclm` | `generico` |
| --- | --- | --- |
| TeX Live 2026 ligero, macOS arm64 nativo | 0 avisos, original y copia | 0 avisos, original y copia |
| TeX Live 2026 full, Linux arm64, API directa sin worker HTTP | 0 avisos, original y copia | 0 avisos, original y copia |
| Instalador MacTeX / MiKTeX en Windows | Sin comprobar | Sin comprobar |

Para repetir la verificación sobre **fixtures temporales**, desde la raíz
en una shell POSIX (macOS/Linux o Git Bash):

```sh
ET_TEX_OUT=$(mktemp -d)
node server/node_modules/tsx/dist/cli.mjs scripts/library-compile.mts \
  --engine local --output-dir "$ET_TEX_OUT"
```

El script exige PDF válido, cero diagnósticos y bibliografía manual intacta.
No lee `.env` ni utiliza la memoria o notas personales. Si cambias la clase o sus
paquetes, repite la prueba para todos los perfiles. La CI conserva además la
referencia Docker y verifica TeX Live nativo en Linux.

### Distribución de escritorio prevista

La futura app Electron tendrá dos descargas: **completa / offline**, con TeX Live
reducido incluido, y **ligera / online**, que descarga y prepara el mismo motor al
primer arranque. Ambas compilarán localmente y sin conexión una vez preparadas,
sin exigir instalaciones manuales de TeX ni Docker. El motor tendrá versiones
fijadas y vivirá en una carpeta privada de la app, sin cambiar el PATH del sistema.
Esta distribución **aún no está implementada**: los pasos de instalación actuales
de arriba siguen aplicándose al ejecutar desde el repositorio. Decisión y medidas:
[Motores](docs/MOTORES.md#distribución-elegida-para-electron).

## Primeros pasos

1. **Carpetas.** Define `NOTES_DIR` (tu vault de Obsidian) y `MEMORIA_DIR` en `.env` (hay un ejemplo en `.env.example`) o desde **Ajustes** en la interfaz, que las aplica en caliente.
2. **Memoria.** Si `MEMORIA_DIR` está vacío, `npm run init` o Ajustes → «Crear memoria desde plantilla» la crean eligiendo perfil. Nunca sobrescriben nada.
3. **Datos del trabajo.** Abre el panel «Datos del trabajo» y rellena título, autor, tutores, etc.
4. **Compila.** Abre `tfg.tex` y pulsa ⌘↵: guarda y compila; el PDF aparece al lado.

## Qué puedes hacer

### Memoria y PDF

- Editor LaTeX (CodeMirror 6) con diagnósticos de LaTeX y biblatex/biber en línea; la compilación (`latexmk`, `-no-shell-escape`) se hace con el motor elegido (Docker o TeX del sistema).
- Visor PDF propio (PDF.js) con zoom, búsqueda y modo oscuro.
- **SyncTeX** en los dos sentidos: ⌘⇧J lleva del código al PDF y ⌘clic en el PDF lleva al código.
- Vista **Documento**: el esquema de la memoria en el orden del PDF; resalta el apartado que estás viendo, permite crear apartados nuevos y «Ver en PDF» salta a la página correcta.
- **Autocompletado** en el editor de `\cite` (claves de la bibliografía), `\ref` (etiquetas) y `\ac` (siglas), con sus variantes habituales.
- Historial de guardados y detección de conflictos: si el archivo cambió en disco, se te ofrece resolverlo en vez de pisarlo.

### Plantilla y datos del trabajo

- Plantilla genérica con **perfiles** de institución (`esi-uclm`, `generico`) sobre una base común, que compila sin avisos de LaTeX ni de biber.
- Panel **Datos del trabajo**: edita `datos.tex` e `institucion.tex`, el logo, el modo borrador/final y otras opciones sin tocar archivos.
- **Actualizar plantilla**: lleva una memoria ya creada a la versión actual de la plantilla. Muestra una vista previa, solo sustituye lo que sigue como lo dejó la plantilla, hace un commit con esos archivos y se puede deshacer.

### Notas y archivos

- Árbol de archivos de las notas y de la memoria: crear carpetas y notas, renombrar en línea, arrastrar y soltar, «Mover a…» y eliminar con Deshacer. Menú ⋯ en cada elemento, igual que el clic derecho.
- Renombrar y mover **mantienen los enlaces** (wikilinks, enlaces Markdown y referencias LaTeX). Lo eliminado va a una papelera recuperable.
- Notas Markdown con modo lectura y edición, wikilinks, enlaces entrantes (backlinks) y vista previa de Mermaid.

### Biblioteca

- Vista principal para referencias, documentos, imágenes, webs y notas: búsqueda, filtros por tipo/etiqueta/colección/revisión, ordenación, lista y cuadrícula con imágenes.
- **Añadir** (mismo atajo de captura): URL, ficha manual o varios archivos; un recurso por archivo o agrupados en una ficha. La clasificación es opcional.
- Fichas con varias URLs/adjuntos, datos bibliográficos y notas editables sin YAML. Los cambios externos conservan la edición y exigen revisión antes de reaplicar un conflicto.
- Compatibilidad con recursos antiguos y conversión con vista previa, copias y deshacer. La identidad del destino se conserva al trasladar fichas y registros juntos.
- Los lotes se guardan en la cola local antes del primer envío; resultados y reintentos por elemento.
- **Importar bibliografía:** archivos/texto BibTeX o RIS y consultas DOI a Crossref, con revisión de campos, decisiones sobre duplicados y originales conservados. Los lotes fallidos se recuperan sin repetir éxitos.
- **Insertar cita / figura:** revisa las copias propuestas y añádelas al cursor del editor, conservando su borrador y deshacer. Bibliografía e imágenes quedan dentro de la memoria; los .bib manuales no se sobrescriben. La ficha muestra usos guardados y permite actualizar sus copias explícitamente.

Modelo y decisiones: [docs/BIBLIOTECA.md](docs/BIBLIOTECA.md).

### Recuperar capturas pendientes

Antes de enviar un recurso, el navegador conserva texto y adjunto en IndexedDB. Si falla el envío, pulsa **Pendientes** en la cabecera para revisar el error, corregir los datos o reintentar. Un error de acceso conserva la captura; autentícate al reintentar. El destino queda fijado: vuelve al vault original si has cambiado de carpeta. Las capturas de la cola antigua requieren asignar el destino explícitamente.

No borres los datos del navegador mientras haya pendientes. El botón **Descartar** pide confirmación y solo elimina la copia local. Si se perdió la respuesta de un envío, el reintento recupera el recurso original sin duplicarlo; si el servidor ya lo recibió, recupera su resultado antes de editarlo.

El servidor conserva recibos y operaciones interrumpidas en `data/captures/` (junto a `BUILD_DIR`, si lo cambias). Incluye esa carpeta en tus copias de seguridad: los recibos no caducan automáticamente. Usa un único proceso servidor por biblioteca. Al reiniciar se completan las operaciones interrumpidas del destino actual. Si aparece un conflicto de recuperación, detén la app, copia la biblioteca y el registro completo, aparta el archivo que ocupa el destino reservado y reinicia; conserva el archivo apartado y comprueba ambos contenidos antes de decidir qué mantener. Si falta `attachment` en el registro, reenvía el mismo pendiente desde el navegador. No elimines `operation.json` para «desbloquear» una captura: perderías su identidad y podrías duplicarla.

### Diagramas

- Sección **Diagramas** en la barra lateral: lista con su estado y dónde se usan, crear, abrir, renombrar (actualiza las figuras que los usan) y eliminar.
- Diagramas **Mermaid** como `.mmd` en la memoria, con vista previa y **código plegable**.
- **Editor visual** sobre el propio dibujo (con [Visimer](https://www.npmjs.com/package/@visimer/react)), sin tocar código:
  - paleta de **bloques** a la izquierda según el tipo de diagrama (flujo, secuencia, estados, clases, ER), que se arrastran al lienzo o sobre otro bloque para conectarlos;
  - barra flotante en el bloque seleccionado: cambiar texto, cambiar forma, conectar, añadir bloque después y borrar;
  - panel **Bloque seleccionado** a la derecha: texto, forma, conexiones con su etiqueta, «Conectar con…» y dirección (↓ / →);
  - barra inferior con el tipo y el número de bloques y conexiones.
- Todo se guarda en el `.mmd`, sincronizado con el código, que se puede mostrar u ocultar.
- **Exportar a PDF vectorial** (lo genera el worker) e **insertar en la memoria** como figura.

### Búsqueda

- ⌘K abre el buscador rápido: recientes, archivos de notas y memoria, recursos y coincidencias en el texto; también crea notas («Carpeta/Nombre») y diagramas («diagrama nombre»).
- Búsqueda de texto en todo, agrupada por archivo o por apartado de la memoria.

### Atajos

En Windows y Linux, ⌘ es Ctrl, salvo Capturar y Ver en PDF: usan los atajos
alternativos indicados para evitar las herramientas del navegador y AltGr.

| Atajo | Acción |
| --- | --- |
| ⌘K | Abrir / buscar |
| ⌘⇧C (Mac) · Ctrl+Mayús+F8 (Windows/Linux) | Capturar |
| ⌘B | Mostrar u ocultar la barra lateral (fuera del editor) |
| ⌘S | Guardar |
| ⌘↵ | Guardar y compilar (editor LaTeX y diagramas) |
| ⌘⇧J (Mac) · Ctrl+Mayús+F9 (Windows/Linux) | Ver la línea actual en el PDF |
| ⌘clic en el PDF | Ir al código |
| ⌘E | Alternar lectura / edición de una nota Markdown |
| ⌘F | Buscar dentro del PDF |
| ⌘+ · ⌘- · ⌘0 | Zoom del PDF: acercar, alejar, ajustar al ancho |
| ⌘rueda | Zoom del PDF alrededor del puntero |
| ⌘Z · ⌘⇧Z | Deshacer / rehacer en el lienzo de diagramas |
| Alt+clic · Ctrl+Mayús+clic · clic central | Abrir al lado (listas, resultados, enlaces internos y PDF; también desde el menú contextual) |
| Alt+Intro · Ctrl+Mayús+Intro | Abrir al lado desde Abrir / buscar |

## Qué va al repo y qué no

Este repositorio es **solo la herramienta**: código, la plantilla de la memoria (`templates/`) y datos de prueba ficticios. Tu trabajo nunca entra aquí:

| Contenido | Dónde vive | Versionado |
| --- | --- | --- |
| Memoria del TFG | `MEMORIA_DIR` (p. ej. `~/Documents/tfg-memoria`) | Su propio git, independiente |
| Notas y recursos | `NOTES_DIR` (tu vault de Obsidian) | El del vault |
| Compilaciones, historial, recibos de capturas y ajustes locales | `data/` | Ignorado |
| Configuración local | `.env` | Ignorado |

- `npm run init` copia la plantilla a `MEMORIA_DIR` solo si está vacío y le crea su propio git. Nunca sobrescribe.
- El servidor **se niega a arrancar** si `NOTES_DIR` o `MEMORIA_DIR` apuntan a una carpeta versionada del repo; dentro del repo solo se permite `workspace/`, que está ignorada.
- Las mejoras a la plantilla se hacen en `templates/base/` (clase `estilo/memoria.cls` y archivos comunes) o en el perfil que toque. No se propagan solas a una memoria ya creada: para eso está «Actualizar plantilla».

## Copias de seguridad

Consulta [docs/RESPALDO.md](docs/RESPALDO.md) para respaldar notas, adjuntos, memoria y datos duraderos, verificar sus manifiestos SHA-256 y restaurarlos en otra ubicación. El historial, Git y la papelera no sustituyen una copia independiente. Los borradores y capturas pendientes del navegador necesitan atención aparte.

## Contribuir

Lee antes [AGENTS.md](AGENTS.md) (reglas del proyecto) y [docs/CONTRACT.md](docs/CONTRACT.md) (especificación vinculante: cualquier cambio de API, eventos o comportamiento visible se refleja ahí, en una sección versionada).

| Carpeta | Qué hay |
| --- | --- |
| `server/` | API: Node, TypeScript con `tsx`, Fastify 5, chokidar. Tests con vitest. |
| `web/` | Interfaz: React 19, Vite, Tailwind 4, Dockview, CodeMirror 6, zustand. |
| `worker/` | Compilación LaTeX en Docker (latexmk, biber) y conversión SVG → PDF. Sin dependencias npm. |
| `templates/` | `base/` (común) y `perfiles/<id>/` (institución, logo, capítulos). |
| `scripts/` | `npm run init`, creación de la memoria y manifiesto de la plantilla. |
| `test/fixtures/` | Datos de prueba ficticios. |

Comandos:

```bash
npm test
```

Tests del servidor (vitest).

```bash
npm run typecheck --prefix server
```

```bash
npm run build --prefix web
```

`tsc --noEmit` y `vite build` de la web.

```bash
node --test worker/*.test.mjs
```

Tests del worker (no necesitan Docker).

```bash
npm ci --prefix test/e2e
npm run browsers --prefix test/e2e
npm run test:e2e
```

Recorridos de navegador con fixtures temporales y la web construida. El caso de
compilación exige un worker dedicado; instrucciones, evidencias y límites en
[test/e2e/README.md](test/e2e/README.md).

```bash
npm run template:manifest
```

Regenera el manifiesto de la plantilla (`templates/manifiestos/`) tras cambiarla; un test falla si no está al día. La plantilla debe compilar con 0 avisos en todos los perfiles: compruébalo con el worker.

Antes de dar un cambio por terminado: tests en verde, `tsc` del servidor y de la web sin errores y `vite build` correcto. Si tocas la interfaz, pruébala en el navegador con `npm run dev`. Todo texto visible va en español.

## Licencia

Estudio TFG se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Puedes usarlo, estudiarlo y modificarlo; si distribuyes una versión modificada o la ofreces como servicio en red, debes publicar su código bajo la misma licencia.

La clase de la plantilla (`templates/base/estilo/memoria.cls`) deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) del grupo ARCO (UCLM-ESI), distribuida bajo GPL-2.0 o posterior; se mantiene su aviso de copyright y licencia en la clase. El logotipo de la ESI pertenece a la Universidad de Castilla-La Mancha.

Componentes de terceros: la fuente Source Sans 3 (SIL OFL 1.1, vía `@fontsource/source-sans-3`) se usa en los diagramas y se instala en la imagen del worker; Visimer (MIT) da la edición visual de diagramas; además se usan PDF.js (Apache-2.0), Mermaid (MIT), CodeMirror, Dockview, Fastify y TeX Live, cada uno con su propia licencia.
