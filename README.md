# Estudio TFG

Entorno self-hosted para escribir la memoria del TFG en LaTeX con el PDF al lado, consultar tus notas de Obsidian y capturar recursos sin perderlos. Es una herramienta local: los archivos en disco son la fuente de verdad, no hay base de datos, y tu trabajo vive fuera de este repositorio.

Se desarrolla y prueba en macOS. El soporte para Windows se está analizando: qué habría que cambiar y cómo usarlo hoy en [docs/PLATAFORMAS.md](docs/PLATAFORMAS.md).

Especificación: [docs/CONTRACT.md](docs/CONTRACT.md) · Worker y requisitos de la plantilla: [worker/README.md](worker/README.md) · Guía para agentes de código: [AGENTS.md](AGENTS.md)

## Requisitos

- Node ≥ 24 y npm.
- Docker (el worker compila LaTeX con TeX Live en un contenedor; la imagen es grande).
- git (la memoria se crea con su propio repositorio).

## Arrancar

```bash
npm run init
```

Crea `.env` y tu memoria a partir de la plantilla, fuera de git. Para elegir la institución: `npm run init -- --perfil generico` (por defecto `esi-uclm`).

```bash
npm run install:all
```

```bash
npm run worker
```

TeX Live en Docker, en 127.0.0.1:8090.

```bash
npm run dev
```

API en :8787 y web en http://localhost:5173.

Producción (imagen con API y web servidas juntas):

```bash
docker compose --profile app up -d --build
```

Queda en http://127.0.0.1:8787.

## Primeros pasos

1. **Carpetas.** Define `NOTES_DIR` (tu vault de Obsidian) y `MEMORIA_DIR` en `.env` (hay un ejemplo en `.env.example`) o desde **Ajustes** en la interfaz, que las aplica en caliente.
2. **Memoria.** Si `MEMORIA_DIR` está vacío, `npm run init` o Ajustes → «Crear memoria desde plantilla» la crean eligiendo perfil. Nunca sobrescriben nada.
3. **Datos del trabajo.** Abre el panel «Datos del trabajo» y rellena título, autor, tutores, etc.
4. **Compila.** Abre `tfg.tex` y pulsa ⌘↵: guarda y compila; el PDF aparece al lado.

## Qué puedes hacer

### Memoria y PDF

- Editor LaTeX (CodeMirror 6) con diagnósticos de LaTeX y biblatex/biber en línea; la compilación (`latexmk`, `-no-shell-escape`) se hace en el worker.
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

### Recursos y captura

- Captura rápida (⌘⇧C) de recursos a la carpeta de recursos de tu vault.
- Panel de recursos y lista de recientes en el Inicio.

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

En Windows y Linux, ⌘ es Ctrl.

| Atajo | Acción |
| --- | --- |
| ⌘K | Abrir / buscar |
| ⌘⇧C | Capturar |
| ⌘B | Mostrar u ocultar la barra lateral (fuera del editor) |
| ⌘S | Guardar |
| ⌘↵ | Guardar y compilar (editor LaTeX y diagramas) |
| ⌘⇧J | Ver la línea actual en el PDF |
| ⌘clic en el PDF | Ir al código |
| ⌘E | Alternar lectura / edición de una nota Markdown |
| ⌘F | Buscar dentro del PDF |
| ⌘+ · ⌘- · ⌘0 | Zoom del PDF: acercar, alejar, ajustar al ancho |
| ⌘rueda | Zoom del PDF alrededor del puntero |
| ⌘Z · ⌘⇧Z | Deshacer / rehacer en el lienzo de diagramas |
| ⌥clic | Abrir al lado (en listas, resultados y enlaces) |

## Qué va al repo y qué no

Este repositorio es **solo la herramienta**: código, la plantilla de la memoria (`templates/`) y datos de prueba ficticios. Tu trabajo nunca entra aquí:

| Contenido | Dónde vive | Versionado |
| --- | --- | --- |
| Memoria del TFG | `MEMORIA_DIR` (p. ej. `~/Documents/tfg-memoria`) | Su propio git, independiente |
| Notas y recursos | `NOTES_DIR` (tu vault de Obsidian) | El del vault |
| Compilaciones, historial y ajustes locales | `data/` | Ignorado |
| Configuración local | `.env` | Ignorado |

- `npm run init` copia la plantilla a `MEMORIA_DIR` solo si está vacío y le crea su propio git. Nunca sobrescribe.
- El servidor **se niega a arrancar** si `NOTES_DIR` o `MEMORIA_DIR` apuntan a una carpeta versionada del repo; dentro del repo solo se permite `workspace/`, que está ignorada.
- Las mejoras a la plantilla se hacen en `templates/base/` (clase `estilo/memoria.cls` y archivos comunes) o en el perfil que toque. No se propagan solas a una memoria ya creada: para eso está «Actualizar plantilla».

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
npm run template:manifest
```

Regenera el manifiesto de la plantilla (`templates/manifiestos/`) tras cambiarla; un test falla si no está al día. La plantilla debe compilar con 0 avisos en todos los perfiles: compruébalo con el worker.

Antes de dar un cambio por terminado: tests en verde, `tsc` del servidor y de la web sin errores y `vite build` correcto. Si tocas la interfaz, pruébala en el navegador con `npm run dev`. Todo texto visible va en español.

## Licencia

Estudio TFG se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Puedes usarlo, estudiarlo y modificarlo; si distribuyes una versión modificada o la ofreces como servicio en red, debes publicar su código bajo la misma licencia.

La clase de la plantilla (`templates/base/estilo/memoria.cls`) deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) del grupo ARCO (UCLM-ESI), distribuida bajo GPL-2.0 o posterior; se mantiene su aviso de copyright y licencia en la clase. El logotipo de la ESI pertenece a la Universidad de Castilla-La Mancha.

Componentes de terceros: la fuente Source Sans 3 (SIL OFL 1.1, vía `@fontsource/source-sans-3`) se usa en los diagramas y se instala en la imagen del worker; Visimer (MIT) da la edición visual de diagramas; además se usan PDF.js (Apache-2.0), Mermaid (MIT), CodeMirror, Dockview, Fastify y TeX Live, cada uno con su propia licencia.
