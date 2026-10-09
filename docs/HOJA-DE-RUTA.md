# Hoja de ruta: fiabilidad, biblioteca de recursos y app de escritorio

> Objetivo de producto: reunir fuentes en una **Biblioteca** y utilizarlas al escribir la memoria: añadir, organizar, consultar, citar e insertar figuras. Primero se corrigen los riesgos de pérdida de datos detectados en la auditoría del 09-10-2026; después se construye la biblioteca y se retoman los motores de compilación y la distribución como **app instalable y portable para Windows y Mac** (Electron), sin obligar a instalar Docker.
>
> Cada tarea está escrita para que **un agente pueda hacerla leyendo solo su sección** (más AGENTS.md y lo que la sección enlace). Cada tarea tiene su issue en GitHub con la etiqueta `hoja-de-ruta` y la de su fase (`fase-A`…`fase-G`, `fase-R` y `fase-L`).
>
> Fuentes: [PLATAFORMAS.md](PLATAFORMAS.md) (50 hallazgos de portabilidad; los IDs como `S1`, `P2`, `F4` se refieren a él), [CONTRACT.md](CONTRACT.md) y la auditoría del 09-10-2026, cuyas evidencias y acciones se describen en R1–R8 y L1–L5.
>
> **Estado al 09-10-2026:** A–D completadas y fusionadas. **Siguiente bloque: `r-integridad` (R1 + R2)**, sujeto a comprobar reservas y PR abiertos. Orden de continuación: **R → L → E → F → G**. R y L se insertan aquí sin renumerar las tareas anteriores; sus letras no determinan la prioridad.

## Índice

| Fase | Qué consigue | Tareas | Issues | Depende de |
|---|---|---|---|---|
| [A](#fase-a) | Arrancar en Windows nativo (lo mínimo) | A1–A7 | #3–#9 | — |
| [B](#fase-b) | Modo Docker para usarlo en cualquier sistema y como servidor | B1–B4 | #10–#13 | A1 |
| [C](#fase-c) | Robustez en Windows (archivos en uso, nombres, saltos de línea…) | C1–C7 | #14–#20 | A |
| [D](#fase-d) | CI en Linux, macOS y Windows | D1–D2 | #21–#22 | A |
| [R](#fase-r) | Fiabilidad, seguridad y recuperación | R1–R8 | #45–#52 | D |
| [L](#fase-l) | Biblioteca, bibliografía e integración con la memoria | L1–L5 | #53–#57 | R (dependencias por tarea) |
| [E](#fase-e) | Motores de compilación intercambiables (Docker / TeX del sistema / Tectonic) | E1–E4 | #23–#26 | A, L5; E2 también R6 y R8 |
| [F](#fase-f) | Exportar diagramas sin Docker | F1 | #27 | E1 |
| [G](#fase-g) | App de escritorio con Electron | G1–G7 | #28–#34 | B1, C, D1, E1–E2, F1 |

```text
A–D (completadas)
  → r-integridad → r-recursos → r-compilacion → r-recuperacion
  → l-biblioteca → l-referencias → l-validacion
  → e-motores → e-validacion → f-diagramas → g-base → g-entrega → g-firma
```

Este esquema indica **prioridad de entrega**, no todas las dependencias técnicas. Las dependencias vinculantes figuran en cada tarea. E1 incorpora L5 como puerta de entrega para completar la biblioteca antes de retomar motores.

Las issues siguen siendo la unidad de seguimiento; la unidad de trabajo y revisión es un **bloque de tareas relacionadas**, con una rama y un PR para el bloque y un commit por tarea. Dos bloques pueden trabajarse en paralelo si no comparten archivos (ver «Archivos» de cada tarea). Ver [Cómo seguir la hoja de ruta](#cómo-seguir-la-hoja-de-ruta).

## Cómo seguir la hoja de ruta

Un agente puede recibir una tarea concreta («haz la issue #4»), un bloque («haz el bloque de configuración») o simplemente **«sigue la hoja de ruta»**. Una tarea concreta mantiene ese alcance; el encargo general autoriza a completar **un bloque**, siguiendo estos pasos:

1. **Elige el siguiente bloque disponible** de la tabla de abajo: el primero **en el orden explícito de filas de «Bloques de entrega»**, no por letra de fase ni por número de issue, que cumpla estas condiciones:
   - sus tareas pendientes tienen la issue abierta, **sin** `en-curso` y sin un PR abierto que ya las cubra;
   - todas las dependencias **externas al bloque** («Depende de») tienen la issue **cerrada** por un PR fusionado en `main`;
   - la unión de los archivos de sus tareas pendientes («Archivos») no se solapa con los de tareas abiertas `en-curso` ajenas al bloque.

   Las tareas ya cerradas se omiten. Si una tarea pendiente del bloque tiene reserva o PR abierto, ese bloque aún no está disponible. Las dependencias **internas** se implementan y verifican en orden dentro de la misma rama; sus issues se cierran juntas al fusionar el PR. No hace falta un PR intermedio para cada dependencia interna.

   Para comprobarlo:

   ```bash
   gh issue list --repo JavierLoro/estudio-tfg --label hoja-de-ruta --state all --limit 100 --json number,title,state,labels
   gh pr list --repo JavierLoro/estudio-tfg --state open --json number,title,headRefName,body
   ```

2. **Reserva todas las issues pendientes del bloque**: comprueba de nuevo que siguen libres, añade `en-curso` a cada una (`gh issue edit <n> --add-label en-curso`) y comenta «Empiezo con esta tarea dentro del bloque <id>; se entregará en un PR conjunto». Si aparece una reserva o un PR antes de completar la reserva, libera solo las reservas que acabas de hacer, explica el motivo y elige otro bloque.
3. **Implementa el bloque** en `hoja/<id-del-bloque>` (p. ej. `hoja/a-configuracion`), creada desde `main` actualizado. Haz **un commit por tarea**, en orden de dependencias, con un mensaje español que incluya su ID (p. ej. «A4: Rutas de Windows en Ajustes»). Verifica cada tarea con sus pruebas específicas y ejecuta las comprobaciones comunes sobre el conjunto antes de entregarlo.
4. **Abre un único PR** con el resultado del bloque, las tareas incluidas y un `Closes #<n>` por cada issue completada. Una tarea incompleta no lleva `Closes`. El informe final va como comentario del PR: criterios de aceptación y pendientes separados por tarea, archivos tocados y resultados de las pruebas del conjunto.
5. **Al terminar, para**: un bloque por encargo; no encadenes otro sin que te lo pidan. Conserva `en-curso` mientras el PR esté abierto. Si abandonas tareas sin PR, libera esas issues y explica por qué. Tras la fusión, las issues completadas se cierran por `Closes` y se les quita `en-curso`; fusionar sigue siendo decisión del usuario. Para conservar la separación por tarea, la fusión debe mantener los commits del bloque (merge o rebase).

Si ningún bloque está disponible porque sus dependencias, reservas o PR siguen pendientes, dilo y para.

### Bloques de entrega

Agrupación prevista de 2–4 tareas relacionadas; una tarea autónoma o con una dependencia que exige otra entrega puede tener su propio bloque. Las filas fijan la prioridad de selección; las dependencias vinculantes son las de cada tarea. Las filas completadas se omiten.

| Bloque / rama `hoja/…` | Resultado que se revisa | Tareas | Issues |
|---|---|---|---|
| `a-arranque` | Arranque multiplataforma y configuración de raíces permitidas | A1, A2, A3 | #3, #4, #5 |
| `a-configuracion` | Ajustes con rutas de Windows y creación de memoria | A4, A5, A7 | #6, #7, #9 |
| `a-atajos` | Textos de atajos según plataforma | A6 | #8 |
| `b-docker` | Uso completo con la app y el worker en Docker | B1, B2, B3, B4 | #10–#13 |
| `c-archivos` | Escrituras, movimientos y nombres seguros | C1, C2, C3 | #14, #15, #16 |
| `c-compatibilidad` | CRLF, archivos de sistema y detalles de portabilidad | C4, C5, C7 | #17, #18, #20 |
| `c-atajos` | Atajos y apertura al lado en distintos navegadores | C6 | #19 |
| `d-ci` | CI y pruebas de Windows desde otros sistemas | D1, D2 | #21, #22 |
| `r-integridad` | Actualizaciones sin pérdida y cola recuperable | R1, R2 | #45, #46 |
| `r-recursos` | Recursos movibles, diálogos accesibles e importación web protegida | R3, R4, R5 | #47, #48, #49 |
| `r-compilacion` | Política de confianza y distribución TeX fijada | R6, R8 | #50, #52 |
| `r-recuperacion` | Copia independiente y restauración comprobada | R7 | #51 |
| `l-biblioteca` | Modelo compatible, migración reversible y vista Biblioteca | L1, L2 | #53, #54 |
| `l-referencias` | Importar bibliografía y usar citas/figuras en la memoria | L3, L4 | #55, #56 |
| `l-validacion` | Recorridos de navegador y recuperación verificados en CI | L5 | #57 |
| `e-motores` | Interfaz de motores y compilación con TeX del sistema | E1, E2 | #23, #24 |
| `e-validacion` | Requisitos de TeX y evaluación de Tectonic | E3, E4 | #25, #26 |
| `f-diagramas` | Exportación de diagramas sin Docker | F1 | #27 |
| `g-base` | Servidor empaquetable y app Electron funcional | G1, G2, G3 | #28, #29, #30 |
| `g-entrega` | Primer arranque, instaladores, licencia y guía | G4, G5, G7 | #31, #32, #34 |
| `g-firma` | Firma y notarización de los instaladores | G6 | #33 |

**Replanificación del 09-10-2026:** A–D permanecen cerradas. Se añaden R y L antes de E; E1/E2 se actualizan con las nuevas puertas de entrega y seguridad. Crear estas issues no las reserva ni inicia su implementación. No se publica ninguna funcionalidad por este cambio de planificación.

**Mensaje para lanzar un agente**:

```text
Sigue la hoja de ruta de JavierLoro/estudio-tfg (docs/HOJA-DE-RUTA.md, sección «Cómo seguir la hoja de ruta»): elige el siguiente bloque disponible, reserva sus issues, hazlo en una rama con un commit por tarea, abre un único PR y termina con el informe final por tarea.
```

## Reglas comunes para el agente

1. **Lee primero** [AGENTS.md](../AGENTS.md), la sección de la tarea y lo que enlace (hallazgos de PLATAFORMAS.md, secciones del contrato). Si algo de la tarea ya no coincide con el código (líneas movidas, algo ya hecho), adáptalo y dilo en el informe.
2. **Nunca escribas en la memoria ni en el vault reales del usuario** (las carpetas configuradas en `.env`/`data/settings.json`). Para probar en el navegador, levanta **otra instancia** con copias en el scratchpad:
   - copia una memoria de plantilla con `copyTemplate` de `scripts/memoria-template.mjs` y las notas de `test/fixtures/notes`;
   - API en otro puerto: `cd server && PORT=<p> NOTES_DIR=… MEMORIA_DIR=… BUILD_DIR=<scratch>/data/builds ALLOWED_ROOTS=<scratch> npx tsx src/index.ts`;
   - `data/settings.json` (que manda sobre `.env`) vive junto a `BUILD_DIR`, así que con `BUILD_DIR` en el scratchpad la instancia no lee los ajustes reales;
   - no uses los puertos 8787/5173: suele haber un servidor del usuario abierto en ellos;
   - web en otro puerto: `cd web && VITE_API_TARGET=http://localhost:<p> npx vite --port <q> --strictPort`;
   - al terminar, para tus servidores y cierra las pestañas que abriste (muchas pestañas abiertas agotan las conexiones SSE).
3. **Git**: nada de `git stash`, `git checkout -- …` ni `git reset` (puede haber otros agentes con cambios sin commit). **Encargarte trabajo de esta hoja de ruta autoriza a crear una rama `hoja/<id>`: el ID del bloque en un encargo general (p. ej. `hoja/a-configuracion`) o el de la tarea si se pide una issue concreta (p. ej. `hoja/a2`). También autoriza sus commits, subir la rama y abrir un único PR que cierre las issues completadas (`Closes #<n>`, uno por issue)**. Nunca hagas commit ni push directamente en `main` ni fusiones el PR: eso lo decide el usuario.
4. **Antes de dar el bloque por terminado** (o la tarea, si se encargó sola): `npm test`, `npm run typecheck --prefix server`, `npm run build --prefix web` y `node --test worker/*.test.mjs` en verde sobre todos sus cambios. Además, cumple las verificaciones específicas de cada tarea. Si tocas la plantilla: compila todos los perfiles con el worker con **0 avisos**. Si tocas la interfaz: pruébala en el navegador (en tu instancia aparte).
5. **Contrato**: si cambia la API, los eventos o un comportamiento visible, actualiza `docs/CONTRACT.md` en una sección versionada (la siguiente libre) o en «Precisiones».
6. **No implementes Windows a ciegas**: lo que solo se puede comprobar en Windows, cúbrelo con tests (`path.win32` inyectable, errores simulados con `vi.spyOn`) y márcalo «a verificar en Windows» en el informe.
7. **Informe final**: resultado del bloque; por cada tarea, criterios de aceptación uno a uno (cumplido / no y por qué) y qué quedó sin verificar; archivos tocados y resultados de los tests del conjunto.

**Modelo recomendado** en cada tarea: **Opus** cuando hay riesgo de perder datos del usuario o razonamiento delicado (sistema de archivos, procesos, motores); **Sonnet** cuando la tarea está bien acotada; **Haiku** para cambios mecánicos.

---

<a id="fase-a"></a>
## Fase A — Mínimo para arrancar en Windows nativo

Resultado: en Windows con Node 24, Git para Windows y Docker Desktop (worker), `npm run dev` arranca, se configuran carpetas en Ajustes, se crea la memoria y se edita, compila y navega como en macOS. Esfuerzo total ≈ 1 día.

<a id="a1"></a>
### A1 · Saltos de línea, script de arranque de producción y README para Windows

**Issue**: [#3](https://github.com/JavierLoro/estudio-tfg/issues/3)

- **Objetivo**: que un clon en Windows no convierta los archivos a CRLF, que `npm start` no use sintaxis de shell y que el README diga cómo usarlo hoy en Windows.
- **Contexto**: PLATAFORMAS.md E1 (versión mínima), S2, D1, L2 y su sección 1 «qué puede hacer hoy un usuario de Windows». `server/package.json` (`start`), `README.md`.
- **Alcance**:
  - Crear `.gitattributes` en la raíz: `* text=auto eol=lf` y marcar binarios (`*.pdf *.png *.jpg *.woff *.woff2 *.ttf *.otf *.gz binary`).
  - Comprobar que `git add --renormalize .` no cambia nada en macOS (si cambia algo, explicarlo).
  - Quitar `NODE_ENV=production` del script `start` de `server/package.json` (el código no lo usa: confírmalo con `grep`).
  - README: sección «Windows (hoy)» con los pasos de PLATAFORMAS.md §1 (requisitos, clonar, carpetas fuera de OneDrive, dos terminales mientras no exista A2) y requisitos de Docker Desktop (WSL2, ~10 GB).
  - No hace: normalizar hashes del manifiesto (eso es C4).
- **Criterios de aceptación**: `.gitattributes` existe y `git ls-files --eol` muestra `i/lf` en los textos; `npm start` funciona en macOS; el README tiene la sección y enlaza a PLATAFORMAS.md.
- **Verificación**: `git ls-files --eol | grep -v 'i/lf' | grep -v -- '-text'` vacío o explicado; `npm start` arranca y responde `/api/status`.
- **Archivos**: `.gitattributes`, `server/package.json`, `README.md`.
- **Contrato**: no. **Depende de**: —. **Modelo**: Haiku/Sonnet. **Esfuerzo**: S.

<a id="a2"></a>
### A2 · `npm run dev` multiplataforma

**Issue**: [#4](https://github.com/JavierLoro/estudio-tfg/issues/4)

- **Objetivo**: que `npm run dev` arranque API y web en Windows (hoy usa `&`, que en `cmd.exe` las ejecuta una tras otra y la web nunca arranca).
- **Contexto**: PLATAFORMAS.md S1, S4. `package.json` (raíz, script `dev`), `server/package.json` (`dev`: `tsx watch src/index.ts`), `web/package.json` (`dev`: `vite`), `.claude/launch.json`.
- **Alcance**:
  - `scripts/dev.mjs` sin dependencias: lanza `server` y `web` con `process.execPath` + el binario JS de cada herramienta (`node_modules/tsx/dist/cli.mjs`, `node_modules/vite/bin/vite.js`), sin `shell: true`; prefija cada línea con `[api]`/`[web]`; si uno termina, cierra el otro (en win32 `taskkill /pid <pid> /T /F`; en POSIX, señal al grupo); comprueba antes que existen `server/node_modules` y `web/node_modules` y si no, dice qué ejecutar.
  - Hereda el entorno (`PORT`, `VITE_API_TARGET`, `NOTES_DIR`…) y reenvía a Vite los argumentos tras `--` (`npm run dev -- --port 5180`), para poder probarlo en otros puertos con carpetas de prueba.
  - `stdin` de los hijos en `'ignore'` (en POSIX, con `detached`, un hijo que lee la terminal se queda parado); `FORCE_COLOR=1` para conservar colores.
  - Ctrl+C (SIGINT/SIGTERM) cierra ambos y sale con código 0. Si un hijo termina solo (no por Ctrl+C), cierra el otro y sale con su código (o 1).
  - Un fallo del servidor dentro de `tsx watch` **no** cuenta como «terminar»: `tsx watch` sigue esperando cambios, que es lo esperado en desarrollo.
  - `"dev": "node scripts/dev.mjs"` en `package.json`; en `.claude/launch.json`, sustituir las dos entradas que usan `npm` por una sola `dev` con `runtimeExecutable: "node"`, `runtimeArgs: ["scripts/dev.mjs"]` y `port: 5173`.
- **Criterios de aceptación** (en macOS, en puertos y carpetas de prueba: `PORT=8790 VITE_API_TARGET=http://localhost:8790 NOTES_DIR=… MEMORIA_DIR=… BUILD_DIR=<scratch>/data/builds npm run dev -- --port 5180`): arranca los dos con prefijos `[api]`/`[web]`; Ctrl+C cierra ambos sin procesos huérfanos (`lsof -i :8790 -i :5180` y `pgrep -fl 'tsx|vite'` sin restos) y sale con 0; si Vite falla (puerto ocupado) o se mata el proceso de `tsx`, el otro se cierra y el código de salida es distinto de 0; si faltan dependencias, mensaje en español y código 1.
- **Verificación**: lo anterior en macOS; revisar el código de win32 contra la documentación de Node (`child_process`, `taskkill`). Marcar «a verificar en Windows».
- **Archivos**: `scripts/dev.mjs`, `package.json`, `.claude/launch.json`.
- **Contrato**: no. **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a3"></a>
### A3 · `ALLOWED_ROOTS` con el separador de cada sistema

**Issue**: [#5](https://github.com/JavierLoro/estudio-tfg/issues/5)

- **Objetivo**: que `ALLOWED_ROOTS=C:\Users\x;D:\TFG` funcione (hoy se separa por `:` y rompe las letras de unidad).
- **Contexto**: PLATAFORMAS.md P1, T1. `parseAllowedRoots` en `server/src/config.ts` (~línea 91), `.env.example`, `server/test/helpers.ts` (pasa `ALLOWED_ROOTS: dir`), `docs/CONTRACT.md` (sección «Configuración desde la interfaz (v0.2)», donde se describe `ALLOWED_ROOTS`).
- **Alcance**: separar con `path.delimiter` (`;` en Windows, `:` en POSIX); que la función acepte el módulo `path` como parámetro opcional para poder probar con `path.win32`; actualizar comentario, `.env.example` y contrato.
- **Criterios de aceptación**: tests nuevos con `path.win32` (`C:\a;D:\b` → dos raíces) y `path.posix` (`/a:/b`); el comportamiento en macOS no cambia.
- **Verificación**: `npm test`.
- **Archivos**: `server/src/config.ts`, `.env.example`, `docs/CONTRACT.md`, test nuevo en `server/test/config.test.ts`.
- **Contrato**: sí (precisión en v0.2). **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a4"></a>
### A4 · Rutas absolutas de Windows en Ajustes

**Issue**: [#6](https://github.com/JavierLoro/estudio-tfg/issues/6)

- **Objetivo**: que el panel Ajustes y el selector de carpetas funcionen con `C:\…`, `\\servidor\recurso` y `~\`.
- **Contexto**: PLATAFORMAS.md P2, P6. `web/src/panels/SettingsPanel.tsx` (`isAbs`, `joinAbs`, `relToNotes`), `web/src/components/DirPicker.tsx` (migas de pan), `server/src/routes/settings.ts` (`GET /api/settings`, `/api/fs/dirs`), `expandPath` en `server/src/config.ts` y `server/src/settings.ts`, `scripts/init.mjs`.
- **Alcance**:
  - `web/src/lib/abspath.ts`: `isAbsPath` (`/^(\/|~|[A-Za-z]:[\\/]|\\\\)/`), `splitAbs` (separa por `[\\/]` conservando `C:\` o `\\srv\share\` como raíz), `joinAbs(dir, name, sep)`, `relUnder(base, p)` que devuelve siempre `/`. Usarlos en `SettingsPanel` y `DirPicker`.
  - `GET /api/settings` devuelve `pathSep: '\\' | '/'` (el del servidor, no el del navegador: con WSL o Docker el navegador está en Windows pero las rutas son POSIX).
  - `expandPath` acepta `~/` y `~\`.
- **Criterios de aceptación**: tests de `abspath.ts` con rutas POSIX, `C:\`, `c:/`, UNC y mixtas; en macOS el panel funciona igual que antes (probado en el navegador en una instancia aparte: elegir vault, subcarpeta de recursos y memoria con el selector).
- **Verificación**: tests (pueden ir en `server/test/` importando de `web/src/lib/`, como `diagramEdit.test.ts`), `npm run build --prefix web`, navegador.
- **Archivos**: `web/src/lib/abspath.ts`, `web/src/panels/SettingsPanel.tsx`, `web/src/components/DirPicker.tsx`, `web/src/api.ts`, `server/src/routes/settings.ts`, `server/src/config.ts`, `server/src/settings.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (`pathSep` en `GET /api/settings`). **Depende de**: A3 (comparten `config.ts`; hacer después). **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="a5"></a>
### A5 · Crear la memoria sin git instalado

**Issue**: [#7](https://github.com/JavierLoro/estudio-tfg/issues/7)

- **Objetivo**: que crear la memoria no deje una carpeta a medias con error 500 cuando `git` no está en el PATH.
- **Contexto**: PLATAFORMAS.md G1. `createMemoriaFromTemplate` en `scripts/memoria-template.mjs` (copia y luego `git init` con `execFileSync`), `POST /api/settings/init-memoria` en `server/src/routes/settings.ts` y `server/src/settings.ts`, `scripts/init.mjs`, aviso en `web/src/panels/SettingsPanel.tsx`.
- **Alcance**: comprobar `git --version` antes de copiar; si no hay git, crear la memoria sin repositorio y devolver un aviso («La memoria se ha creado sin control de versiones: instala Git para tener historial y actualizaciones de plantilla»); `npm run init` igual. Las funciones que usan git (`server/src/plantilla.ts`) deben seguir funcionando sin repo (ya contemplan `commit: null`: confirmarlo).
- **Criterios de aceptación**: test que simula git ausente (PATH vacío o inyectando la comprobación) → memoria creada, sin `.git`, respuesta con aviso; con git, igual que ahora.
- **Verificación**: `npm test`; navegador (instancia aparte) mostrando el aviso.
- **Archivos**: `scripts/memoria-template.mjs` (+ `.d.mts`), `scripts/init.mjs`, `server/src/settings.ts`, `server/src/routes/settings.ts`, `web/src/panels/SettingsPanel.tsx`, `web/src/api.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (campo de aviso en la respuesta de `init-memoria`). **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a6"></a>
### A6 · Atajos de teclado con el texto correcto en cada sistema

**Issue**: [#8](https://github.com/JavierLoro/estudio-tfg/issues/8)

- **Objetivo**: que los atajos se muestren como «⌘⇧C» en Mac y «Ctrl+Mayús+C» en Windows/Linux (hoy hay `⌘ ⌥ ⇧ ↵` escritos a mano y `MOD` produce «Ctrl+⇧C»).
- **Contexto**: PLATAFORMAS.md U1. `MOD` y `ALT` en `web/src/components/ui.tsx`; textos fijos en `SearchView.tsx`, `Markdown.tsx`, `HomePanel.tsx`, `SettingsPanel.tsx`, `CaptureModal.tsx`, `PdfViewer.tsx`, `DiagramPanel.tsx`/`DiagramCanvas.tsx` y otros (busca `⌘`, `⌥`, `⇧`, `↵`, `MOD}` con `grep -rn`).
- **Alcance**: helper `kbd('Mod-Shift-C')` (sintaxis de CodeMirror: `Mod`, `Alt`, `Shift`, `Enter`, `Backspace`…) en `web/src/lib/kbd.ts`; sustituir todos los textos de atajos visibles (tooltips, menús, ayuda de Inicio). No cambia qué teclas hacen qué (eso es C6).
- **Criterios de aceptación**: `grep -rn "[⌘⌥⇧]" web/src` solo encuentra el propio helper; tests del helper para Mac y no Mac.
- **Verificación**: tests; navegador en macOS (los textos siguen igual).
- **Archivos**: `web/src/lib/kbd.ts` y los componentes con atajos.
- **Contrato**: no. **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a7"></a>
### A7 · Rutas canónicas: `realpath` nativo e identificador de instancia

**Issue**: [#9](https://github.com/JavierLoro/estudio-tfg/issues/9)

- **Objetivo**: que las comprobaciones «esta carpeta está dentro de esta otra» y el identificador de instancia no fallen por mayúsculas de unidad (`c:` vs `C:`), unidades `subst` o mapeadas.
- **Contexto**: PLATAFORMAS.md P5, P7. `realpathSync`/`realpathLoose` en `server/src/config.ts`, comparaciones con `includes` en `server/src/routes/settings.ts`, `isInside`/`resolveSafe` en `server/src/paths.ts`, `instanceId` en `server/src/settings.ts`.
- **Alcance**: usar `fs.realpathSync.native` / `fs.promises.realpath` en todas partes; comparar raíces con `isInside` en ambos sentidos en vez de `includes`; `instanceId` como hash de la ruta canónica.
- **Criterios de aceptación**: tests con `path.win32` donde `isInside('C:\\a','c:\\A\\b')` es verdadero y `isInside('C:\\a','D:\\a')` falso; en macOS los tests siguen en verde y el `instanceId` no cambia para las rutas actuales (si cambiara, los borradores locales se perderían: compruébalo y, si cambia, documenta la migración).
- **Verificación**: `npm test`.
- **Archivos**: `server/src/config.ts`, `server/src/paths.ts`, `server/src/settings.ts`, `server/src/routes/settings.ts`.
- **Contrato**: no. **Depende de**: A3, A4 (mismos archivos). **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-b"></a>
## Fase B — Modo Docker para usarlo en cualquier sistema

Resultado: con solo Docker instalado, `docker compose --profile app up -d` deja la app en `http://localhost:8787` funcionando en Windows, Mac y Linux, apta también para desplegar en un servidor (Proxmox). Esfuerzo total ≈ ½–1 día.

<a id="b1"></a>
### B1 · Carpeta de compilaciones compartida entre la app y el worker

**Issue**: [#10](https://github.com/JavierLoro/estudio-tfg/issues/10)

- **Objetivo**: arreglar el perfil `app`: hoy la app busca los PDF en `/data/app/builds` (host `./data/app/builds`) y el worker los escribe en `./data/builds`, así que nunca los encuentra.
- **Contexto**: `docker-compose.yml` (servicios `worker` y `app`), `Dockerfile` (app), `server/src/compile.ts` (`pdfExists`, `buildFile`: el server lee los artefactos de `cfg.buildDir/<id>/`), `worker/Dockerfile` (uid 1000). PLATAFORMAS.md D3.
- **Alcance**: que `BUILD_DIR` de la app y `/out` del worker sean el mismo volumen de host (p. ej. `./data/builds` montado en ambos, y el resto de `data/` de la app en otro punto); asegurar que `data/builds` existe antes de levantar (documentado o creado por `npm run init`/script) y documentar el uid en Linux.
- **Criterios de aceptación**: con `docker compose --profile app up -d --build` y una memoria de prueba: compilar da PDF, SyncTeX funciona en ambos sentidos, exportar un diagrama funciona; reiniciar los contenedores conserva la última compilación y los ajustes.
- **Verificación**: lo anterior en macOS con Docker Desktop (memoria y notas de prueba en el scratchpad montadas por `.env`, no las reales).
- **Archivos**: `docker-compose.yml`, `Dockerfile`, `README.md`, quizá `scripts/init.mjs`.
- **Contrato**: no. **Depende de**: A1. **Modelo**: Opus. **Esfuerzo**: S.

<a id="b2"></a>
### B2 · Vigilar archivos por sondeo cuando hace falta

**Issue**: [#11](https://github.com/JavierLoro/estudio-tfg/issues/11)

- **Objetivo**: que en Docker con carpetas de Windows montadas (y en WSL `/mnt/c`, unidades de red) se vean en vivo los cambios hechos con Obsidian.
- **Contexto**: PLATAFORMAS.md F4, F5, D2. `WatchManager` y chokidar en `server/src/events.ts` (el `on('error', () => {})` silencia errores), `GET /api/status` en `server/src/routes/status.ts`, tipo `Status` en `web/src/api.ts`.
- **Alcance**: variable `WATCH_POLLING=auto|on|off` (por defecto `auto`: activa `usePolling` con `interval` ~1000 ms si existe `/.dockerenv`, la raíz es UNC o empieza por `/mnt/<letra>`); registrar errores del watcher y exponer `watcher: 'ok' | 'error'` (y el mensaje) en `/api/status`; mostrar un aviso discreto en la interfaz si hay error.
- **Criterios de aceptación**: tests de la decisión `auto` (función pura con entradas simuladas); con `WATCH_POLLING=on` en macOS un cambio externo llega por SSE en < 2 s; el estado del watcher aparece en `/api/status`.
- **Verificación**: `npm test`; prueba manual con `WATCH_POLLING=on` en una instancia aparte; prueba en el perfil `app` editando un archivo montado desde el host.
- **Archivos**: `server/src/events.ts`, `server/src/config.ts`, `server/src/routes/status.ts`, `web/src/api.ts`, aviso en la UI, `.env.example`, `docker-compose.yml`, `docs/CONTRACT.md`.
- **Contrato**: sí (`watcher` en `/api/status`, `WATCH_POLLING`). **Depende de**: B1. **Modelo**: Opus. **Esfuerzo**: M.

<a id="b3"></a>
### B3 · git dentro del contenedor de la app

**Issue**: [#12](https://github.com/JavierLoro/estudio-tfg/issues/12)

- **Objetivo**: que «Actualizar plantilla» y la creación de memorias hagan commit cuando la memoria está montada desde el host (git la rechaza por «dubious ownership»).
- **Contexto**: PLATAFORMAS.md G2. `Dockerfile` (instala git), `isGitRepo` y commits en `server/src/plantilla.ts`, avisos en `web/src/panels/DatosPanel.tsx`.
- **Alcance**: `git config --system --add safe.directory '*'` en la imagen de la app (el contenedor solo ve esa memoria); cuando git falle, incluir su `stderr` resumido en el aviso al usuario en vez de tratarlo como «no es un repositorio».
- **Criterios de aceptación**: en el perfil `app`, con la memoria de prueba montada y con repo, «Actualizar plantilla» hace commit; un fallo de git muestra su mensaje.
- **Verificación**: perfil `app` en macOS; `npm test`.
- **Archivos**: `Dockerfile`, `server/src/plantilla.ts`.
- **Contrato**: no. **Depende de**: B1. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="b4"></a>
### B4 · Elegir carpetas desde Ajustes en Docker y documentar los dos modos

**Issue**: [#13](https://github.com/JavierLoro/estudio-tfg/issues/13)

- **Objetivo**: que en Docker se pueda elegir el vault y la memoria desde Ajustes sin editar `.env`, y que el README explique las dos formas de levantar el entorno.
- **Contexto**: servicio `app` de `docker-compose.yml` (`ALLOWED_ROOTS=/data`, montajes `NOTES_DIR`/`MEMORIA_DIR`), Ajustes (`server/src/routes/settings.ts`, `/api/fs/dirs`), `README.md`.
- **Alcance**: montar una carpeta padre configurable (`HOST_HOME`, por defecto la de documentos del usuario) en `/data/home` e incluirla en `ALLOWED_ROOTS`; README con «Usarlo con Docker (Windows, Mac, Linux)» (requisitos, `.env`, un comando, abrir `localhost:8787`, actualizar) y «Desarrollar (server y web nativos)».
- **Criterios de aceptación**: en el perfil `app`, Ajustes lista `/data/home` y permite elegir el vault y crear la memoria ahí; el README tiene ambas secciones y cada comando existe.
- **Verificación**: perfil `app` en macOS con carpetas de prueba.
- **Archivos**: `docker-compose.yml`, `.env.example`, `README.md`.
- **Contrato**: no. **Depende de**: B1, A4. **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-c"></a>
## Fase C — Robustez en Windows

Resultado: en Windows no se pierden ni duplican archivos aunque Obsidian, OneDrive o el antivirus los tengan abiertos; no se crean nombres inválidos; los saltos de línea CRLF no rompen nada. Esfuerzo total ≈ 2–3 días. Depende de la fase A.

<a id="c1"></a>
### C1 · Archivos en uso: reintentos y movimientos seguros

**Issue**: [#14](https://github.com/JavierLoro/estudio-tfg/issues/14)

- **Objetivo**: que guardar y mover no fallen ni dupliquen archivos cuando otro programa los tiene abiertos.
- **Contexto**: PLATAFORMAS.md F1, F2, F9. `atomicWrite` en `server/src/fsutil.ts` (temporal + `rename`), `moveEntry` en `server/src/fileops.ts` (`link` + `unlink`; si falla el `unlink` queda duplicado), errores en `server/src/errors.ts`.
- **Alcance**: en win32, reintentos con espera exponencial (~2 s en total) ante `EPERM`/`EACCES`/`EBUSY` en `rename`/`unlink`; en `moveEntry`, si el `unlink` del origen falla tras reintentar, borrar el destino recién enlazado y devolver error; nuevo error 423 «El archivo está en uso por otro programa; ciérralo y vuelve a intentarlo»; `EPERM` con destino existente al renombrar carpetas → 409. La interfaz muestra ese mensaje.
- **Criterios de aceptación**: tests con `vi.spyOn(fs, 'rename' | 'unlink')` que fallan N veces y luego funcionan (reintento OK) o siempre (423, sin duplicado, origen intacto); en POSIX no hay reintentos.
- **Verificación**: `npm test`. Marcar «a verificar en Windows» (PLATAFORMAS.md §5 tiene la receta con PowerShell para mantener un archivo abierto).
- **Archivos**: `server/src/fsutil.ts`, `server/src/fileops.ts`, `server/src/errors.ts`, cliente `web/src/state/files.ts`/`docs.ts` si hace falta el mensaje, `docs/CONTRACT.md`.
- **Contrato**: sí (423 en escrituras y movimientos). **Depende de**: A. **Modelo**: Opus. **Esfuerzo**: M.

<a id="c2"></a>
### C2 · Sistemas de archivos sin enlaces duros

**Issue**: [#15](https://github.com/JavierLoro/estudio-tfg/issues/15)

- **Objetivo**: que crear archivos, capturar, crear apartados y copias de historial funcionen en exFAT, FAT, unidades de red y Google Drive.
- **Contexto**: PLATAFORMAS.md F3. `createExclusive`/`linkExclusive` en `server/src/fsutil.ts`, `NO_LINK` en `server/src/fileops.ts`.
- **Alcance**: alternativa `open(abs, 'wx')` + escribir + `fsync` cuando `link` falla con `EPERM`/`EXDEV`/`ENOTSUP`/`EISDIR`/`EINVAL`; ampliar `NO_LINK`; detectar una vez por raíz y recordarlo.
- **Criterios de aceptación**: tests simulando cada código de error; en macOS se puede probar de verdad con una imagen exFAT (`hdiutil create -fs ExFAT -size 100m x.dmg`, montarla y usarla como vault en una instancia aparte): crear, capturar, mover y borrar funcionan.
- **Verificación**: `npm test` y la prueba con exFAT.
- **Archivos**: `server/src/fsutil.ts`, `server/src/fileops.ts`.
- **Contrato**: no. **Depende de**: C1 (mismos archivos). **Modelo**: Opus. **Esfuerzo**: M.

<a id="c3"></a>
### C3 · Nombres de archivo válidos en todos los sistemas

**Issue**: [#16](https://github.com/JavierLoro/estudio-tfg/issues/16)

- **Objetivo**: no crear nombres que Windows, el Explorador, git u Obsidian no pueden manejar.
- **Contexto**: PLATAFORMAS.md P3, P4. `normalizeRel` en `server/src/paths.ts`, creación y movimiento en `server/src/fileops.ts` y `server/src/routes/files.ts`, `sanitizeTitle` en `server/src/capture.ts`, `sanitizeDiagramName` en `web/src/state/diagramas.ts`.
- **Alcance**: `validSegment()` aplicado a nombres **nuevos** (crear, renombrar, mover, capturar) en todos los sistemas: rechazar `:`, `<>"|?*`, caracteres de control, punto o espacio final y nombres reservados (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, con o sin extensión: `aux.tex`, `con.md`), con mensaje en español (400 con `field`); `sanitizeTitle` añade un sufijo a los reservados. Los nombres existentes se siguen leyendo.
- **Criterios de aceptación**: tests de `validSegment` con todos los casos; crear `aux.md` o `nota:x.md` desde la API da 400 con el motivo; capturar con título «CON» crea `CON (recurso).md` o similar.
- **Verificación**: `npm test`; navegador (instancia aparte) intentando renombrar a un nombre inválido.
- **Archivos**: `server/src/paths.ts`, `server/src/fileops.ts`, `server/src/routes/files.ts`, `server/src/capture.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (validación de nombres). **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c4"></a>
### C4 · Saltos de línea CRLF

**Issue**: [#17](https://github.com/JavierLoro/estudio-tfg/issues/17)

- **Objetivo**: que los archivos con CRLF (editados en Windows) no se conviertan enteros al guardar, no parezcan «modificados» para la plantilla y no rompan los analizadores.
- **Contexto**: PLATAFORMAS.md E1 (versión robusta), E2, E3. Hash de manifiestos en `scripts/memoria-template.mjs` y `server/src/plantilla.ts`; `templates/manifiestos/*.json`; CodeMirror en `web/src/components/CodeEditor.tsx`; `server/src/datos.ts`; `eolOf` existente en `server/src/sections.ts`.
- **Alcance**: hashear los archivos de texto de la plantilla normalizando CRLF→LF (y regenerar manifiestos con `npm run template:manifest` si cambia el algoritmo, manteniendo compatibilidad con memorias existentes); CodeMirror con `EditorState.lineSeparator` igual al del documento (detectado al cargar) para que guardar conserve CRLF y deshacer vuelva a «limpio»; usar `eolOf` en `datos.ts` y `plantilla.ts` al añadir líneas; `.gitattributes` en `templates/base/` para las memorias nuevas.
- **Criterios de aceptación**: tests con variantes CRLF de los fixtures (outline, datos, refs, frontmatter, manifiesto); abrir y guardar sin cambios un archivo CRLF lo deja idéntico byte a byte; la plantilla sigue compilando con 0 avisos.
- **Verificación**: `npm test`, `node scripts/template-manifest.mjs --check`, compilación de perfiles con el worker, navegador (instancia aparte) con un `.tex` CRLF.
- **Archivos**: `scripts/memoria-template.mjs`, `scripts/template-manifest.mjs`, `server/src/plantilla.ts`, `server/src/datos.ts`, `web/src/components/CodeEditor.tsx`, `templates/base/.gitattributes`, `templates/manifiestos/`.
- **Contrato**: no (salvo precisión sobre el hash en v0.6). **Depende de**: A1. **Modelo**: Opus. **Esfuerzo**: M.

<a id="c5"></a>
### C5 · Carpetas y archivos de sistema de Windows

**Issue**: [#18](https://github.com/JavierLoro/estudio-tfg/issues/18)

- **Objetivo**: que el selector de carpetas no muestre `AppData`, `$Recycle.Bin`, etc., y que `desktop.ini`/`Thumbs.db` no aparezcan en el árbol, la búsqueda ni la compilación.
- **Contexto**: PLATAFORMAS.md L1, F7. `/api/fs/dirs` en `server/src/routes/settings.ts`, `server/src/ignore.ts`, `isEmptyDir` en `scripts/memoria-template.mjs`, `templates/base/.gitignore`.
- **Alcance**: lista de exclusión en win32 para el listado de carpetas y saltar las que dan `EPERM`; ignorar `desktop.ini`, `Thumbs.db`, `*.tmp` en `ignore.ts` e `isEmptyDir`; añadirlos al `.gitignore` de la plantilla (regenerar manifiesto).
- **Criterios de aceptación**: tests de `ignore.ts` y del listado con nombres de sistema simulados; plantilla con 0 avisos y manifiesto al día.
- **Verificación**: `npm test`, `template-manifest --check`.
- **Archivos**: `server/src/routes/settings.ts`, `server/src/ignore.ts`, `scripts/memoria-template.mjs`, `templates/base/.gitignore`, `templates/manifiestos/`.
- **Contrato**: no. **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c6"></a>
### C6 · Atajos que chocan con el navegador fuera de Mac

**Issue**: [#19](https://github.com/JavierLoro/estudio-tfg/issues/19)

- **Objetivo**: que en Windows y Linux los atajos no abran las herramientas de desarrollo ni la barra de búsqueda del navegador, y que «abrir al lado» no dependa de Alt+clic.
- **Contexto**: PLATAFORMAS.md U2, U3. `Mod-Shift-j` en `web/src/components/CodeEditor.tsx`, atajos globales en `web/src/App.tsx` (Ctrl+K, Ctrl+Shift+C, Ctrl+B), `web/src/panels/NotePanel.tsx` (Ctrl+E), usos de `e.altKey` en `FileTree`, `SearchView`, `Markdown`, `OutlineTree`, `QuickOpen`, `PdfViewer`. Helper de A6.
- **Alcance**: comprobar con `preventDefault` cuáles gana la página en Chrome, Edge y Firefox (documentar en la tarea o en «a verificar»); para los que no se puedan capturar, atajo alternativo fuera de Mac (p. ej. Ctrl+Alt+J), evitando combinaciones de AltGr; además de Alt+clic, aceptar Ctrl+Mayús+clic y clic central, y que «Abrir al lado» esté en el menú contextual. Actualizar textos con `kbd()`.
- **Criterios de aceptación**: tabla en el informe atajo × navegador; en macOS todo sigue igual; los atajos alternativos funcionan en un Chrome con user agent de Windows (o marcados «a verificar»).
- **Verificación**: navegador (instancia aparte).
- **Archivos**: los citados en Contexto.
- **Contrato**: no. **Depende de**: A6. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c7"></a>
### C7 · Detalles menores de portabilidad

**Issue**: [#20](https://github.com/JavierLoro/estudio-tfg/issues/20)

- **Objetivo**: cerrar los hallazgos menores de PLATAFORMAS.md.
- **Contexto**: P8 (normalizar Unicode a NFC al comparar nombres: `notes.ts`, `links.ts`, `search.ts`, `QuickOpen.tsx`), P10 (`path.posix` en `server/src/outline.ts` para rutas del worker), F6 (no propagar modo de solo lectura en win32: `fsutil.ts`), F8 (`fs.stat` con `bigint` en `fileops.ts`), G3/P9 (`-c core.longpaths=true` en llamadas a git en win32: `plantilla.ts`, `memoria-template.mjs`), T2 (`canSymlink()` y `it.skipIf` en tests con enlaces simbólicos), T4 (`fs.rm` con `maxRetries` en `server/test/helpers.ts`).
- **Alcance**: exactamente esos puntos; cada uno con su test cuando sea posible.
- **Criterios de aceptación**: cada ID resuelto o justificado en el informe; tests en verde.
- **Verificación**: `npm test`.
- **Archivos**: los citados.
- **Contrato**: no. **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-d"></a>
## Fase D — CI en Linux, macOS y Windows

<a id="d1"></a>
### D1 · Integración continua con GitHub Actions

**Issue**: [#21](https://github.com/JavierLoro/estudio-tfg/issues/21)

- **Objetivo**: que cada push y PR se pruebe en Linux, macOS y Windows, y que la plantilla se compile con 0 avisos.
- **Contexto**: PLATAFORMAS.md T6 y §4 fase 3. No existe `.github/`. Tests: `npm test` (vitest, usa `WORKER_URL=http://127.0.0.1:1` y un worker falso en `server/test/compile.test.ts`), `node --test worker/*.test.mjs`, `node scripts/template-manifest.mjs --check`.
- **Alcance**: `.github/workflows/ci.yml` con matriz `[ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false`, Node 24: `npm ci` en server y web, typecheck, tests del server, build web, tests del worker, comprobación del manifiesto. Windows con `continue-on-error: true` hasta cerrar la fase C. Job aparte solo en ubuntu: construir la imagen del worker y compilar cada perfil (`esi-uclm`, `generico`) comprobando 0 avisos (script reutilizable, p. ej. `scripts/compile-template.mjs`).
- **Criterios de aceptación**: el workflow se ejecuta en un PR y los jobs de ubuntu y macOS pasan; el de Windows ejecuta y su resultado está documentado en el informe; badge en el README.
- **Verificación**: ejecutar en una rama y enlazar la ejecución.
- **Archivos**: `.github/workflows/ci.yml`, `scripts/compile-template.mjs`, `README.md`.
- **Contrato**: no. **Depende de**: A (y A1 para CRLF). **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="d2"></a>
### D2 · Tests de Windows sin Windows

**Issue**: [#22](https://github.com/JavierLoro/estudio-tfg/issues/22)

- **Objetivo**: cubrir con tests lo que no podemos probar a mano en Windows.
- **Contexto**: PLATAFORMAS.md §5 «Sin máquina Windows».
- **Alcance**: hacer que las funciones de rutas acepten el módulo `path` (`isInside`, `normalizeRel`, `parseAllowedRoots`, `expandPath`, `toPosix`, el guardia del repo, `abspath.ts`) y probarlas con `path.win32` (`C:\`, `c:\`, `D:\`, UNC, `\\?\`, mixtas, `~\`, reservados); fixtures CRLF; simulación de `EPERM`/`EBUSY`/`EISDIR`/`ENOTSUP` con `vi.spyOn`.
- **Criterios de aceptación**: nuevos tests en verde en macOS y en el CI de Windows.
- **Verificación**: `npm test`; CI.
- **Archivos**: `server/src/paths.ts`, `server/src/config.ts`, tests nuevos.
- **Contrato**: no. **Depende de**: D1; se amplía a la vez que C. **Modelo**: Sonnet. **Esfuerzo**: M.

---

<a id="fase-r"></a>
## Fase R — Fiabilidad, seguridad y recuperación

Resultado: corregir los fallos reproducidos y preparar importaciones y compilación sin pérdida de datos. La auditoría se hizo con fixtures sobre el árbol fusionado en el PR #44; no fue una certificación exhaustiva de seguridad. Se distingue en cada contexto lo reproducido de lo observado en código. Las compilaciones siguen usando Docker hasta E2.

<a id="r1"></a>
### R1 · Exigir revisión en los cambios de recursos

**Issue**: [#45](https://github.com/JavierLoro/estudio-tfg/issues/45)

- **Objetivo**: Exigir revisión en los cambios de recursos.
- **Contexto**: La auditoría del 09-10-2026 reprodujo PATCH /api/resources sin baseRev: HTTP 200 y cambio de estado. AGENTS.md exige revisión en toda actualización, mientras CONTRACT.md permite baseRev opcional en este endpoint.
- **Alcance**: Exigir baseRev al actualizar estado o etiquetas; adaptar todos los clientes y reconciliar el contrato. Mantener bloqueo, historial y escritura atómica. Ante conflicto, conservar la intención del usuario y ofrecer recarga/reaplicación explícita, sin sobrescribir automáticamente.
- **Criterios de aceptación**:
  - Sin baseRev: 400 y ningún cambio en disco; revisión obsoleta: 409 con revisión/contenido actual; revisión correcta: actualización e historial.
  - Dos clientes que editan el mismo recurso no pierden cambios; la interfaz conserva el cambio pendiente y permite resolver el conflicto.
- **Verificación**: Tests API de revisión ausente/obsoleta/válida, concurrencia e historial; navegador con dos vistas y datos ficticios.
- **Archivos orientativos**: server/src/routes/resources.ts, server/test/resources.test.ts, web/src/state/resources.ts, web/src/panels/ResourcePanel.tsx, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: D (completada).
- **Bloque / rama**: `hoja/r-integridad`.

<a id="r2"></a>
### R2 · Cola recuperable, reintentos idempotentes y destino estable

**Issue**: [#46](https://github.com/JavierLoro/estudio-tfg/issues/46)

- **Objetivo**: Cola recuperable, reintentos idempotentes y destino estable.
- **Contexto**: captureQueue.ts elimina pendientes ante 401 y otros 4xx salvo 408/429, usa una clave global por origen y cambia el estado en memoria antes de comprobar la persistencia. Reenviar el mismo POST crea dos fichas; se reprodujo en una instancia aislada.
- **Alcance**: Asignar un identificador persistente de operación enviado al servidor y vincular cada pendiente a la identidad estable de su biblioteca/vault de destino. Un reintento con el mismo ID y contenido devuelve el mismo resultado, incluso tras reiniciar; con contenido distinto se rechaza. Mantener fallidos recuperables y una vista de pendientes con reintentar, editar y descartar explícitamente. Migrar la cola antigua sin pérdida; si se desconoce el destino, pedir que se asigne antes de enviar. Tratar 401 como necesidad de autenticarse. Persistir antes de anunciar guardado; elegir almacenamiento apto para adjuntos sin abandonar archivos como autoridad del servidor. Recuperar fallos entre guardar adjunto, ficha y registro de operación.
- **Criterios de aceptación**:
  - Respuesta perdida y reenvío, solicitudes concurrentes y reinicio del servidor producen una sola ficha y sus adjuntos.
  - 401, 409 y validaciones conservan el contenido recuperable; cambio de vault no redirige pendientes.
  - Cuota agotada o fallo de persistencia no anuncia éxito ni deja una operación susceptible de envío oculto; migración conserva texto y adjuntos.
  - Fallo parcial no deja pérdidas, duplicados ni adjuntos huérfanos sin recuperación; el registro y su política de retención están documentados.
- **Verificación**: Tests con respuesta perdida, reinicio, concurrencia, autenticación, cambio de destino, almacenamiento lleno y fallos de escritura; prueba de recuperación en navegador.
- **Archivos orientativos**: web/src/state/captureQueue.ts, web/src/lib/storage.ts, componentes de pendientes, server/src/capture.ts, server/src/routes/resources.ts, tests, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: R1 (#45).
- **Bloque / rama**: `hoja/r-integridad`.

<a id="r3"></a>
### R3 · Conservar recursos al moverlos y resolver adjuntos correctamente

**Issue**: [#47](https://github.com/JavierLoro/estudio-tfg/issues/47)

- **Objetivo**: Conservar recursos al moverlos y resolver adjuntos correctamente.
- **Contexto**: listResources solo enumera .md directos. Mover una ficha a Recursos/subcarpeta la hace desaparecer del listado (reproducido). attachmentPath resuelve respecto a RESOURCES_SUBDIR, aunque las fichas pueden guardar adjuntos relativos a su propia carpeta.
- **Alcance**: Enumeración recursiva segura bajo la raíz configurada, coherente con las reglas de enlaces y exclusiones. Resolver adjuntos relativos a la ficha y admitir el formato histórico relativo al vault sin ambigüedad documentada. Hacer visibles errores parciales de lectura. Mantener coherencia tras movimientos externos y operaciones de la app. No introducir todavía el nuevo modelo de L1.
- **Criterios de aceptación**:
  - Una ficha movida a una subcarpeta sigue listada y abre sus adjuntos; los recursos actuales siguen funcionando.
  - No se siguen enlaces que escapen de la raíz ni ciclos; un archivo ilegible produce aviso y no oculta los demás.
  - Mover o renombrar desde la app y desde disco refresca listado, ficha y enlaces sin pérdida.
- **Verificación**: Tests de carpetas anidadas, rutas históricas, ciclos/enlaces, permisos y eventos; navegador con traslado y apertura de un adjunto ficticio.
- **Archivos orientativos**: server/src/resources.ts, server/src/routes/resources.ts, web/src/state/resources.ts, web/src/panels/ResourcePanel.tsx, tests, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: R1 (#45).
- **Bloque / rama**: `hoja/r-recursos`.

<a id="r4"></a>
### R4 · Contener el foco y restaurarlo en los diálogos

**Issue**: [#48](https://github.com/JavierLoro/estudio-tfg/issues/48)

- **Objetivo**: Contener el foco y restaurarlo en los diálogos.
- **Contexto**: En Chrome/macOS, Tab desde Cancelar del formulario vacío sale del modal; el siguiente Tab enfoca Abrir o buscar de la aplicación subyacente. Modal declara aria-modal, pero no contiene el foco.
- **Alcance**: Corregir el componente compartido: foco inicial, ciclo Tab/Mayús+Tab, fondo no interactivo mientras hay modal, cierre con Escape cuando proceda y restauración al invocador. Cubrir contenido dinámico, controles deshabilitados y diálogos superpuestos si se admiten. Reutilizar patrones/dependencias existentes cuando basten.
- **Criterios de aceptación**:
  - Tab y Mayús+Tab nunca alcanzan controles del fondo con el modal abierto; Escape y botones mantienen sus restricciones de operación en curso.
  - Al cerrar se restaura un foco válido; título, etiquetas y errores son accesibles.
- **Verificación**: Prueba de navegador de captura, ajustes y otro diálogo compartido; teclado en ambos sentidos y comprobación del elemento enfocado. Automatizar con la infraestructura de L5 cuando exista.
- **Archivos orientativos**: web/src/components/ui.tsx, web/src/components/CaptureModal.tsx, componentes afectados y tests, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: D (completada).
- **Bloque / rama**: `hoja/r-recursos`.

<a id="r5"></a>
### R5 · Proteger la importación de metadatos desde URLs

**Issue**: [#49](https://github.com/JavierLoro/estudio-tfg/issues/49)

- **Objetivo**: Proteger la importación de metadatos desde URLs.
- **Contexto**: fetchTitle acepta HTTP/HTTPS y sigue redirecciones sin política de destinos. La auditoría obtuvo un título de un servidor ficticio de loopback. Al ampliar importadores, las peticiones del servidor no deben alcanzar servicios privados por una URL externa.
- **Alcance**: Centralizar las peticiones externas para metadatos. Validar protocolos, credenciales, DNS e IPs IPv4/IPv6; bloquear destinos privados, loopback y link-local, también después de redirecciones y ante cambios DNS. Limitar redirecciones, bytes, duración y concurrencia; no reenviar credenciales a otros hosts. Permitir guardar una URL bloqueada como referencia manual sin consultarla. Documentar la política y usar transporte/resolución inyectables para tests sin abrir una excepción de producción.
- **Criterios de aceptación**:
  - URLs públicas válidas permiten extraer metadatos; destinos internos, redirecciones a ellos y cambios DNS se rechazan antes de la conexión protegida.
  - Contenido excesivo, timeout y error remoto dejan un recurso manual utilizable con aviso en español; nunca se requieren servicios privados reales para probar.
  - Los futuros importadores DOI y web usan la misma política y no descargan adjuntos automáticamente.
- **Verificación**: Tests deterministas con DNS/transporte simulados: IPv4/IPv6, direcciones mixtas, redirecciones, límites y rebinding; smoke de URL pública con datos ficticios.
- **Archivos orientativos**: server/src/capture.ts, módulo HTTP seguro nuevo, server/test/capture.test.ts, web/src/components/CaptureModal.tsx, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: D (completada).
- **Bloque / rama**: `hoja/r-recursos`.

<a id="r6"></a>
### R6 · Definir y aplicar la seguridad de la compilación

**Issue**: [#50](https://github.com/JavierLoro/estudio-tfg/issues/50)

- **Objetivo**: Definir y aplicar la seguridad de la compilación.
- **Contexto**: worker/server.mjs ejecuta latexmk sin -norc y hereda process.env. -no-shell-escape no impide ejecutar configuraciones rc de latexmk (Perl). Al pasar a TeX del sistema se pierde el aislamiento del contenedor. Referencia: https://www.cantab.net/users/johncollins/latexmk/latexmk-487.pdf.
- **Alcance**: Documentar el modelo de confianza para fuentes propias/importadas y Docker/local; impedir ejecución implícita de configuraciones del proyecto o del usuario no permitidas (evaluar -norc y configuración propia explícita). Mantener -no-shell-escape; controlar entorno heredado, directorio temporal, lectura/escritura fuera del trabajo y límites de recursos/procesos. Aplicar las medidas al worker actual y dejar requisitos verificables para E2. Distinguir mitigaciones de aislamiento real: el motor nativo no debe anunciarse como sandbox.
- **Criterios de aceptación**:
  - Fixtures con latexmkrc/.latexmkrc no ejecutan su marcador inocuo; ambos perfiles compilan con cero avisos y SyncTeX se conserva.
  - Se documentan entorno permitido, límites de acceso y riesgo residual; los tests no leen ni escriben datos del usuario.
  - E2 dispone de criterios explícitos sobre temporales, configuración, entorno, timeout y confianza que deberá implementar y comprobar.
- **Verificación**: Tests worker y compilaciones en contenedor aislado con fixtures inocuos; revisar la política con el manual del motor; aplicar comprobaciones nativas al implementar E2.
- **Archivos orientativos**: worker/server.mjs, worker/Dockerfile, worker/*.test.mjs, worker/README.md, docs/SEGURIDAD-COMPILACION.md (nuevo), docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: D (completada).
- **Bloque / rama**: `hoja/r-compilacion`.

<a id="r7"></a>
### R7 · Documentar copias de seguridad y probar una restauración

**Issue**: [#51](https://github.com/JavierLoro/estudio-tfg/issues/51)

- **Objetivo**: Documentar copias de seguridad y probar una restauración.
- **Contexto**: fsutil.ts conserva 20 versiones por archivo. Historial, papelera y Git no equivalen a una copia independiente de notas, adjuntos y memoria; la futura biblioteca debe poder recuperarse completa.
- **Alcance**: Definir qué respaldar, dónde vive cada dato y cómo obtener una copia consistente (por ejemplo, cerrar la app y detener escrituras externas durante la copia). Documentar restauración en otra ubicación, ajuste de raíces y comprobación de integridad. Distinguir contenido duradero de builds/cachés regenerables y tratamiento privado de configuración/credenciales. Añadir prueba reproducible con fixtures e interrupción simulada; no añadir servicio cloud ni copias automáticas del contenido real.
- **Criterios de aceptación**:
  - Una copia de fixtures se restaura en otra ubicación y permite abrir notas, adjuntos y memoria conservando sus bytes y enlaces.
  - La guía cubre fallos de disco, borrado accidental, límites del historial y traslado; ninguna restauración de prueba sobrescribe el origen.
  - Existe inventario/manifiesto verificable y procedimiento de recuperación ante copia incompleta; L1/L5 ampliarán la prueba al formato de biblioteca.
- **Verificación**: Script o test de copia/restauración aislada, comparación de hashes y apertura en instancia aparte.
- **Archivos orientativos**: docs/RESPALDO.md (nuevo), README.md, scripts/ o server/test/ para restauración.
- **Contrato**: no; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: R1 (#45), R2 (#46), R3 (#47).
- **Bloque / rama**: `hoja/r-recuperacion`.

<a id="r8"></a>
### R8 · Fijar la versión de TeX y controlar sus actualizaciones

**Issue**: [#52](https://github.com/JavierLoro/estudio-tfg/issues/52)

- **Objetivo**: Fijar la versión de TeX y controlar sus actualizaciones.
- **Contexto**: worker/Dockerfile usa texlive/texlive:latest-full. La CI comprueba ambos perfiles, pero el mismo commit puede compilar con una distribución distinta en el futuro.
- **Alcance**: Fijar una imagen verificable por versión/digest compatible con las arquitecturas soportadas; registrar versiones de TeX, latexmk y biber en diagnóstico de build o logs. Documentar actualización explícita mediante PR y comprobación de perfiles. Mantener CI de compilación; no publicar imágenes ni añadir CD en esta tarea.
- **Criterios de aceptación**:
  - La imagen base queda fijada sin latest mutable; se documentan arquitecturas y versiones utilizadas.
  - Ambos perfiles compilan sin avisos; procedimiento de actualización y vuelta a la versión anterior reproducible.
  - Los logs permiten identificar el motor/distribución de una compilación; no se promete identidad binaria de PDFs si hay fechas u otros datos variables.
- **Verificación**: Construcción limpia del worker, comprobación de digest/plataformas, CI y compilación de todos los perfiles.
- **Archivos orientativos**: worker/Dockerfile, worker/README.md, .github/workflows/ci.yml, scripts/compile-template.mjs.
- **Contrato**: solo si cambia la API; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: R6 (#50).
- **Bloque / rama**: `hoja/r-compilacion`.

---

<a id="fase-l"></a>
## Fase L — Biblioteca de recursos y bibliografía

Resultado: sustituir el concepto principal de «captura» por **Biblioteca**, con el recorrido **Añadir → Organizar → Consultar → Usar en la memoria**. Referencias, páginas web, imágenes y documentos pueden compartir ficha, adjuntos y notas. Captura rápida queda como acceso a Añadir y «Sin revisar» como filtro opcional.

Se mantienen archivos abiertos, compatibilidad con Obsidian, contenido personal fuera del repo, tokens visuales y cargas diferidas. La implementación de L1 fija el contrato y la autoridad bibliográfica antes de crear importadores; este plan no cambia todavía el contrato vigente. Fuera de esta fase: sincronización bidireccional con Zotero, extensión de navegador, descarga automática masiva de PDFs y almacenamiento cloud.

<a id="l1"></a>
### L1 · Modelo de biblioteca y migración reversible de recursos

**Issue**: [#53](https://github.com/JavierLoro/estudio-tfg/issues/53)

- **Objetivo**: Modelo de biblioteca y migración reversible de recursos.
- **Contexto**: Los recursos actuales son notas Markdown con URL, estado, etiquetas y un adjunto; las citas viven por separado en los .bib de la memoria. El usuario quiere una biblioteca de referencias, imágenes, webs y documentos, fácil de alimentar y usar al escribir.
- **Alcance**: Definir primero contrato y decisión de almacenamiento en docs/BIBLIOTECA.md: ID estable independiente de ruta, versión de esquema, tipo, colecciones/etiquetas, procedencia, varias URLs/adjuntos/notas y vínculo bibliográfico. Archivos abiertos como fuente de verdad, sin base de datos autoritativa; índices regenerables. Elegir explícitamente una única autoridad para campos bibliográficos y política para .bib manuales/generados; evitar copias editables divergentes. Implementar lectura compatible del formato antiguo y migración con vista previa, copia, comprobaciones de revisión y deshacer sin pisar cambios posteriores. Importación de lote recuperable; fichas y adjuntos no deben quedar a medias tras fallos.
- **Criterios de aceptación**:
  - Renombrar/mover conserva identidad y asociaciones; un artículo puede tener PDF, URL, referencia y notas en una sola ficha.
  - Los recursos antiguos se leen sin migración forzada; migrar y deshacer preserva contenidos, campos desconocidos y adjuntos.
  - Repetir o interrumpir una migración no duplica ni pierde datos; conflicto externo detiene la operación con información recuperable.
  - Contrato define fuente de verdad, rutas relativas, varios adjuntos, versiones, transacciones recuperables, borrado/papelera y adaptación de la cola R2.
- **Verificación**: Tests de ida/vuelta antiguo/nuevo, fallo parcial, cambio externo, IDs y mudanza de biblioteca; ampliar restauración de R7.
- **Archivos orientativos**: docs/BIBLIOTECA.md (nuevo), docs/CONTRACT.md, server/src/resources.ts, server/src/capture.ts, rutas y tests de biblioteca, web/src/api.ts.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: R2 (#46), R3 (#47), R5 (#49), R7 (#51).
- **Bloque / rama**: `hoja/l-biblioteca`.

<a id="l2"></a>
### L2 · Vista Biblioteca y alta sencilla de enlaces y archivos

**Issue**: [#54](https://github.com/JavierLoro/estudio-tfg/issues/54)

- **Objetivo**: Vista Biblioteca y alta sencilla de enlaces y archivos.
- **Contexto**: La interfaz actual confina Recursos a la barra lateral y prioriza Bandeja/Revisado/Descartado. Capturar recurso pide URL, nota y un archivo; no ofrece una vista amplia de exploración.
- **Alcance**: Crear Biblioteca como vista principal siguiendo tokens y patrones existentes. Sustituir Capturar por Añadir conservando el atajo y adaptando accesos en Inicio/búsqueda. Entrada por pegar URL, arrastrar/seleccionar varios archivos o ficha manual; inferir tipo con corrección manual. Lista general, filtros por tipo/etiqueta/colección, búsqueda, ordenación, cuadrícula para imágenes y ficha con varios adjuntos, metadatos, notas y procedencia. Sin revisar es filtro opcional. Integrar pendientes/fallidos R2 y progreso por elemento. Los controles de citas/figuras se incorporan cuando L4 los haga funcionales.
- **Criterios de aceptación**:
  - Añadir una web, un PDF y varias imágenes funciona por los caminos soportados y deja claro qué se guardó y qué falló.
  - Se puede encontrar, consultar, editar y organizar una ficha sin manejar rutas ni YAML; no se exige clasificar antes de guardar.
  - Archivos, enlaces, cambios externos, estados vacíos, errores y navegación por teclado funcionan; carga pesada diferida y textos en español.
  - Biblioteca y captura antigua convergen en los mismos datos; no quedan dos interfaces de creación desconectadas.
- **Verificación**: Navegador en instancia aparte: alta individual/lote, búsqueda, filtros, imagen/PDF, pendientes, errores y teclado; tests de componentes/lógica relevantes.
- **Archivos orientativos**: web/src/panels/BibliotecaPanel.tsx (nuevo), web/src/components/CaptureModal.tsx, Sidebar/Inicio/navegación, ResourcePanel.tsx, estado/API, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: L1 (#53), R4 (#48).
- **Bloque / rama**: `hoja/l-biblioteca`.

<a id="l3"></a>
### L3 · Importar y revisar bibliografía: BibTeX, DOI y RIS

**Issue**: [#55](https://github.com/JavierLoro/estudio-tfg/issues/55)

- **Objetivo**: Importar y revisar bibliografía: BibTeX, DOI y RIS.
- **Contexto**: refs.ts es un lector aproximado para autocompletado, no un serializador sin pérdida. Se necesita importar bibliografía existente y asociarla a los PDFs y webs de la biblioteca.
- **Alcance**: Implementar primero BibTeX/BibLaTeX desde archivo o texto pegado, después DOI y RIS con servicios documentados y política HTTP R5. Vista previa editable de entradas con autores, título, año, tipo e identificadores; conservar originales/campos desconocidos y no inventar metadatos ausentes. Detectar duplicados por DOI normalizado, identidad de archivo y coincidencias bibliográficas como sugerencia; decidir explícitamente conservar, asociar o combinar. Resolver colisiones de claves sin romper citas existentes. Respetar autoridad definida por L1 y .bib manuales; no añadir sincronización bidireccional con gestores externos ni descargar PDFs automáticamente.
- **Criterios de aceptación**:
  - Fixtures BibTeX/BibLaTeX y RIS, pegado y DOI producen fichas revisables; fallo de red o dato incompleto admite corrección manual.
  - Reimportación idéntica no duplica; combinación conserva adjuntos y notas, y una coincidencia ambigua nunca se fusiona sin decisión.
  - Claves, macros, caracteres LaTeX, comentarios y campos desconocidos se preservan donde se reescribe/exporta; los .bib ajenos no se reformatean.
  - Importar un lote con entradas inválidas informa resultados por elemento y permite recuperar/reintentar sin repetir éxitos.
- **Verificación**: Tests de importación/exportación sin pérdida, DOI simulado, colisiones y duplicados; navegador con revisión de lote; sin datos bibliográficos personales.
- **Archivos orientativos**: server/src/refs.ts y módulos bibliográficos nuevos, rutas/tests, componentes de importación y ficha, docs/BIBLIOTECA.md, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: L1 (#53), L2 (#54), R5 (#49).
- **Bloque / rama**: `hoja/l-referencias`.

<a id="l4"></a>
### L4 · Usar la biblioteca en la memoria: citas, figuras y usos

**Issue**: [#56](https://github.com/JavierLoro/estudio-tfg/issues/56)

- **Objetivo**: Usar la biblioteca en la memoria: citas, figuras y usos.
- **Contexto**: La ficha actual permite revisar/descartar/editar nota, pero no insertar una cita o figura. Ya existen autocompletado bibliográfico e inserción de figuras desde diagramas que pueden reutilizarse.
- **Alcance**: Insertar cita en el editor conservando su borrador y deshacer, con clave estable y bibliografía resoluble. Definir salida .bib gestionada según L1 y su incorporación explícita al proyecto sin sobrescribir bibliografía manual; actualizarla con revisión/vista previa cuando cambien metadatos. Insertar imagen como copia dentro de la memoria, con nombre seguro, pie, etiqueta y procedencia/atribución; comprobar formatos LaTeX soportados y dar alternativa clara para los demás. Registrar/ver usos de citas y figuras; antes de borrar mostrar referencias y conservar copias ya incorporadas. Actualizar fuentes utilizadas de forma explícita, sin cambiar una memoria silenciosamente.
- **Criterios de aceptación**:
  - Una referencia importada se cita y compila con biber; una imagen se inserta y compila sin avisos nuevos en ambos perfiles.
  - La memoria copiada a otra ubicación compila sin acceder a la biblioteca original; sus .bib manuales siguen intactos.
  - Inserción con editor sucio se puede deshacer sin perder edición; revisión obsoleta no sobrescribe archivos.
  - Ver usos lleva al apartado correcto; borrar/actualizar el recurso no rompe silenciosamente citas o figuras ya incluidas.
- **Verificación**: Tests de bibliografía/figuras y conflictos; navegador desde importar hasta insertar; compilación real de ambos perfiles y memoria trasladada.
- **Archivos orientativos**: server/src/refs.ts, servicios/rutas de biblioteca y memoria, web/src/panels/LatexPanel.tsx y Biblioteca/ResourcePanel, helpers de inserción, tests, docs/CONTRACT.md.
- **Contrato**: sí; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: L3 (#55).
- **Bloque / rama**: `hoja/l-referencias`.

<a id="l5"></a>
### L5 · Automatizar recorridos de biblioteca y recuperación en CI

**Issue**: [#57](https://github.com/JavierLoro/estudio-tfg/issues/57)

- **Objetivo**: Automatizar recorridos de biblioteca y recuperación en CI.
- **Contexto**: La CI actual cubre tests, tipos, build y plantillas, pero no recorridos de navegador. La auditoría detectó fallos funcionales que las comprobaciones existentes no cubrían.
- **Alcance**: Añadir una suite E2E pequeña con navegador automatizado, API y datos temporales propios. Cubrir añadir/buscar/consultar, lote parcial, duplicados/reintento, 401 y recuperación, cambio de vault, conflicto externo, teclado del modal, citas/figuras y migración/restauración. CI inicialmente Chromium/Linux, smoke multiplataforma cuando sea viable y límites de cobertura explícitos. Usar metadatos externos simulados y compilación real del worker donde corresponda; publicar trazas/logs al fallar con fixtures, nunca contenido real. Documentar comando local.
- **Criterios de aceptación**:
  - La suite reproduce las regresiones R1–R4 relevantes antes del arreglo y pasa con el comportamiento nuevo; fixtures aislados y limpieza de procesos.
  - Recorrido biblioteca → cita/figura → PDF y restauración en otra ubicación quedan verificados, combinando navegador y compilación real.
  - Un fallo produce evidencias depurables; workflow y comando local están documentados, sin depender de webs públicas ni puertos del usuario.
- **Verificación**: Ejecutar suite local y en PR; enlazar ejecución CI, especificar navegador/SO y verificaciones manuales pendientes.
- **Archivos orientativos**: test/e2e/ (nuevo), configuración y scripts de navegador, .github/workflows/ci.yml, package.json, docs/RESPALDO.md, README.md.
- **Contrato**: no; cuando corresponda, usar la siguiente versión libre.
- **Depende de**: L2 (#54), L3 (#55), L4 (#56), R7 (#51).
- **Bloque / rama**: `hoja/l-validacion`.

---

<a id="fase-e"></a>
## Fase E — Motores de compilación intercambiables

Resultado: el servidor compila con el motor que elija el usuario: **Docker** (el worker actual), **TeX del sistema** (MacTeX, TeX Live, MiKTeX) o, si se valida, **Tectonic**. Imprescindible para la app de escritorio sin Docker. Esfuerzo ≈ 2–3 días.

<a id="e1"></a>
### E1 · Contrato e interfaz de motor de compilación

**Issue**: [#23](https://github.com/JavierLoro/estudio-tfg/issues/23)

- **Objetivo**: que el servidor no dependa de «un worker HTTP» sino de una interfaz de motor, con el worker actual como primera implementación.
- **Contexto**: hoy todo pasa por `cfg.workerUrl`: `fetch(.../compile)` en `server/src/compile.ts` (tar de fuentes + cabecera `x-main`; respuesta `{ ok, buildId, durationMs, pdf, log, diagnostics }`; artefactos en `buildDir/<id>/main.{pdf,log,synctex.gz}` porque el worker escribe en la carpeta compartida), `fetch(.../svg2pdf)` en `server/src/diagramas.ts`, `/health` en `server/src/routes/status.ts`. Worker: `worker/server.mjs`. Worker falso de tests en `server/test/compile.test.ts`.
- **Alcance**:
  - Contrato (siguiente versión libre) «Motores»: `health() → { ok, version, capacidades }`, `compile(fuentes, main) → resultado` con artefactos en `buildDir/<id>/`, `svg2pdf(svg) → pdf`.
  - `server/src/engine/` con el tipo `Engine` y la implementación `docker` (HTTP al worker, exactamente lo que se hace hoy); `compile.ts`, `diagramas.ts` y `status.ts` pasan a usarla.
  - `/api/status` añade `motor: { tipo, estado, version }` (manteniendo `worker` por compatibilidad hasta que la interfaz lo use).
  - No hace: el motor local (E2).
- **Criterios de aceptación**: comportamiento idéntico (todos los tests existentes en verde sin tocarlos, salvo imports); tests nuevos de la interfaz con el worker falso; compilar y exportar diagramas funcionan en el navegador (instancia aparte).
- **Verificación**: `npm test`, typecheck, navegador.
- **Archivos**: `server/src/engine/*`, `server/src/compile.ts`, `server/src/diagramas.ts`, `server/src/routes/status.ts`, `server/src/config.ts`, `web/src/api.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (siguiente versión libre). **Depende de**: A y L5 (#57, puerta de entrega de producto; completar la biblioteca antes de retomar motores). **Modelo**: Opus. **Esfuerzo**: M.

<a id="e2"></a>
### E2 · Motor «TeX del sistema»

**Issue**: [#24](https://github.com/JavierLoro/estudio-tfg/issues/24)

- **Objetivo**: compilar con el `latexmk` instalado en el equipo, sin Docker.
- **Contexto**: `worker/server.mjs` (función `compile`: `latexmk -pdf -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape`, variables `max_print_line` etc., `copySynctex`, `parse-log.mjs`, cola de una compilación; `run()` mata el grupo de procesos con `process.kill(-pid)`, que no existe en Windows), `worker/untar.mjs`, `worker/svg.mjs` (`rsvg-convert`). Interfaz de E1.
- **Alcance**:
  - Extraer de `worker/server.mjs` un módulo importable (p. ej. `worker/engine.mjs`: `compile({ main, workDir, outDir })`, `svgToPdf`) que usen tanto el servidor HTTP del worker (sin cambiar su comportamiento en Docker) como el motor `local` del servidor.
  - Matar procesos de forma portable (grupo en POSIX, `taskkill /pid <pid> /T /F` en win32).
  - Motor `local` en `server/src/engine/`: escribe directamente en `buildDir/<id>/`; detecta `latexmk`, `biber` y `rsvg-convert` en el PATH y su versión.
  - Ajustes: selector de motor (Automático / Docker / TeX del sistema) con el resultado de la detección; «Automático» prefiere Docker si responde y si no TeX del sistema.
  - Aplicar la política de R6 (#50): fuentes temporales aisladas del original, configuración explícita, entorno controlado y límites de procesos/acceso. `-no-shell-escape` siempre; el motor local no se presenta como sandbox. La extracción del motor conserva las protecciones del worker.
  - Registrar distribución/versiones detectadas y contrastarlas con la referencia fijada por R8 (#52); diagnosticar diferencias sin exigir que el TeX instalado sea idéntico a Docker.
- **Criterios de aceptación**: con TeX Live/MacTeX instalado, la plantilla compila con el motor local con los mismos diagnósticos que en Docker; SyncTeX funciona; el worker Docker sigue pasando sus tests y compilando; si falta `latexmk`, Ajustes lo dice con un mensaje claro; pruebas de R6 adaptadas al motor local verifican configuraciones no permitidas, entorno, temporales y cancelación.
- **Verificación**: `npm test`, `node --test worker/*.test.mjs`, compilación real con ambos motores (si el equipo no tiene TeX instalado, usar el worker como referencia y marcar el local «a verificar»).
- **Archivos**: `worker/server.mjs`, `worker/engine.mjs` (nuevo), `server/src/engine/local.ts`, Ajustes (server y web), `docs/CONTRACT.md`.
- **Contrato**: sí. **Depende de**: E1, R6 (#50) y R8 (#52); en Windows también C1. **Modelo**: Opus. **Esfuerzo**: L.

<a id="e3"></a>
### E3 · Validar la plantilla con TeX del sistema

**Issue**: [#25](https://github.com/JavierLoro/estudio-tfg/issues/25)

- **Objetivo**: garantizar que la plantilla compila con 0 avisos con las distribuciones habituales, y documentar qué instalar.
- **Contexto**: plantilla en `templates/base/` y `templates/perfiles/`; necesita pdfLaTeX, biber y los paquetes de `templates/base/estilo/memoria.cls`. Motor local de E2.
- **Alcance**: compilar ambos perfiles con MacTeX/TeX Live (y MiKTeX si hay acceso: instalación de paquetes al vuelo) con el motor local; corregir lo que dependa de TeX Live completo; documentar requisitos (distribución mínima, paquetes) en el README y en la ayuda de Ajustes.
- **Criterios de aceptación**: tabla distribución × perfil con avisos = 0 (o justificados); requisitos documentados.
- **Verificación**: compilaciones reales; `template-manifest --check` si cambia la plantilla.
- **Archivos**: `templates/` (solo si hace falta), `README.md`, textos de Ajustes.
- **Contrato**: no. **Depende de**: E2. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="e4"></a>
### E4 · Exploración: Tectonic como motor autocontenido

**Issue**: [#26](https://github.com/JavierLoro/estudio-tfg/issues/26)

- **Objetivo**: decidir si Tectonic (motor XeTeX de ~30 MB que descarga paquetes según los necesita) puede ser el motor por defecto de la app de escritorio.
- **Contexto**: la clase `templates/base/estilo/memoria.cls` está pensada para pdfLaTeX (`fontenc` T1, newtx, microtype, biber). Tectonic usa XeTeX y gestiona biber aparte.
- **Alcance**: **solo informe**, sin cambios en la plantilla principal: compilar una copia de la plantilla con Tectonic, listar qué cambios necesitaría la clase (fuentes con `fontspec`, microtype, biber), tamaño de descarga y caché, licencia y soporte en Windows/macOS; recomendación sí/no y coste estimado.
- **Criterios de aceptación**: informe en `docs/MOTORES.md` con resultados reproducibles (comandos).
- **Verificación**: los comandos del informe.
- **Archivos**: `docs/MOTORES.md`.
- **Contrato**: no. **Depende de**: E1. **Modelo**: Opus. **Esfuerzo**: M.

---

<a id="fase-f"></a>
## Fase F — Diagramas sin Docker

<a id="f1"></a>
### F1 · Exportar diagramas a PDF sin `rsvg-convert`

**Issue**: [#27](https://github.com/JavierLoro/estudio-tfg/issues/27)

- **Objetivo**: que exportar un diagrama a PDF vectorial funcione con el motor local (sin el worker de Docker).
- **Contexto**: hoy el navegador dibuja el SVG (`web/src/lib/diagram.ts`, fuente Source Sans 3 cargada para medir) y el worker lo convierte con `rsvg-convert` (`worker/svg.mjs`, `fontconfig-diagramas.conf`); `server/src/diagramas.ts` guarda PDF y SVG. Precisiones v0.8 en `docs/CONTRACT.md` (`xml:space="preserve"`, sin sombras, etiquetas opacas).
- **Alcance**: implementar `svg2pdf` del motor local con una conversión en JavaScript (evaluar primero `svg2pdf.js` + jsPDF, MIT, en el navegador o en el servidor) incrustando Source Sans 3; si el motor tiene `rsvg-convert`, seguir usándolo.
- **Criterios de aceptación**: las 6 plantillas de diagrama exportadas con el nuevo camino se ven igual que con rsvg (comparar a 200 dpi), texto como texto y fuente incrustada (`/BaseFont SourceSans3`), y una memoria con esas figuras compila con 0 avisos.
- **Verificación**: exportar en una instancia aparte con el motor local; rasterizar y comparar; compilar.
- **Archivos**: `server/src/engine/local.ts` o `web/src/lib/diagram.ts`, `server/src/diagramas.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí si cambia el flujo de exportación. **Depende de**: E1 (E2 para probar con el motor local). **Modelo**: Opus. **Esfuerzo**: M.

---

<a id="fase-g"></a>
## Fase G — App de escritorio con Electron

Resultado: instaladores y versión portable para Windows y Mac (y AppImage para Linux), publicados en GitHub Releases. Se elige **Electron** porque el servidor es Node y corre dentro de la app sin reescribirlo, y `electron-builder` genera .dmg, instalador NSIS y .exe portable desde los runners de GitHub Actions. Esfuerzo ≈ 1–2 semanas. Depende de B1, C, D1, E1–E2 y F1.

<a id="g1"></a>
### G1 · Desacoplar el servidor del checkout del repo

**Issue**: [#28](https://github.com/JavierLoro/estudio-tfg/issues/28)

- **Objetivo**: que el servidor pueda arrancar desde una app empaquetada, sin `.env` ni carpetas del repo.
- **Contexto**: `REPO_ROOT` en `server/src/config.ts` (de él salen `.env`, rutas relativas, `webDist = web/dist`, `data/`), `assertOutsideRepo`/`repoGuardError`, `server/src/index.ts` (carga `.env` de la raíz), `scripts/memoria-template.mjs` (`TEMPLATES_DIR`), carpeta de datos (`data/builds`, `data/history`, `data/settings.json`, `data/trash`).
- **Alcance**: variables `DATA_DIR`, `TEMPLATES_DIR`, `WEB_DIST` (por defecto, lo de hoy); `.env` opcional; guardia del repo solo si se ejecuta desde un checkout; función que da la carpeta de datos por sistema (`~/Library/Application Support/Estudio TFG`, `%APPDATA%\Estudio TFG`, `~/.local/share/estudio-tfg`) para usarla desde la app.
- **Criterios de aceptación**: con esas variables apuntando fuera del repo, el servidor arranca, sirve la web y crea memorias; sin ellas, todo igual que hoy; tests.
- **Verificación**: `npm test`; arrancar con `DATA_DIR`, `TEMPLATES_DIR` y `WEB_DIST` en el scratchpad.
- **Archivos**: `server/src/config.ts`, `server/src/index.ts`, `scripts/memoria-template.mjs`, `docs/CONTRACT.md` si cambia `/api/status`.
- **Contrato**: solo si cambia la API. **Depende de**: A. **Modelo**: Opus. **Esfuerzo**: M.

<a id="g2"></a>
### G2 · Servidor compilado a JavaScript

**Issue**: [#29](https://github.com/JavierLoro/estudio-tfg/issues/29)

- **Objetivo**: no depender de `tsx` en ejecución dentro de la app empaquetada.
- **Contexto**: `server/package.json` (`start`: `tsx src/index.ts`), `Dockerfile` (usa `tsx`), imports de `scripts/*.mjs` desde el servidor.
- **Alcance**: script `npm run bundle --prefix server` con esbuild que genera `server/dist/server.mjs` (dependencias nativas o con archivos externos marcadas como externas); `npm start` y la imagen Docker pueden seguir con `tsx` o pasar al bundle (decidir y justificar); el modo desarrollo no cambia.
- **Criterios de aceptación**: `node server/dist/server.mjs` arranca con las variables de G1 y pasa una prueba de humo (status, abrir archivo, compilar con el worker).
- **Verificación**: prueba de humo; `npm test`.
- **Archivos**: `server/package.json`, configuración de esbuild, quizá `Dockerfile`.
- **Contrato**: no. **Depende de**: G1. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g3"></a>
### G3 · Esqueleto de la app Electron

**Issue**: [#30](https://github.com/JavierLoro/estudio-tfg/issues/30)

- **Objetivo**: una app que arranca el servidor y muestra la interfaz en su ventana.
- **Contexto**: la web usa URLs relativas `/api/...`, `EventSource('/api/events')` y la cookie `et_token` (`web/src/api.ts`, `web/src/state/events.ts`, `server/src/auth.ts`), así que debe cargarse desde el servidor HTTP, **no** con `file://`. Servidor de G1/G2.
- **Alcance**: carpeta `desktop/` con `package.json` propio; el proceso principal arranca el servidor (en el mismo proceso o con `utilityProcess`) en `127.0.0.1` con puerto libre y `AUTH_TOKEN` aleatorio, fija la cookie `et_token` en la sesión y abre la ventana en esa URL; una sola instancia; cierre limpio del servidor; carpeta de datos por sistema (G1).
- **Criterios de aceptación**: `npm start --prefix desktop` en macOS abre la app, que funciona como en el navegador (abrir, editar, compilar con el motor elegido); cerrar la ventana para el servidor; una segunda instancia enfoca la primera.
- **Verificación**: manual en macOS; «a verificar en Windows» hasta G5.
- **Archivos**: `desktop/*`.
- **Contrato**: no. **Depende de**: G1, G2. **Modelo**: Opus. **Esfuerzo**: M.

<a id="g4"></a>
### G4 · Asistente de primer arranque

**Issue**: [#31](https://github.com/JavierLoro/estudio-tfg/issues/31)

- **Objetivo**: que alguien sin conocimientos técnicos deje la app lista en pocos pasos.
- **Contexto**: Ajustes (carpetas, crear memoria desde perfil: `web/src/panels/SettingsPanel.tsx`), detección de motor (E2), perfiles (`GET /api/templates/perfiles`).
- **Alcance**: asistente en la interfaz cuando la app no está configurada: elegir vault de Obsidian (o crear carpeta de notas), crear la memoria desde un perfil, detectar motor TeX (si no hay, explicar las opciones: instalar MacTeX/MiKTeX con enlace, usar Docker o Tectonic si E4 lo valida) y compilar una primera vez.
- **Criterios de aceptación**: con datos vacíos, el asistente lleva hasta un PDF compilado; se puede repetir desde Ajustes.
- **Verificación**: navegador y app (instancia aparte / datos limpios).
- **Archivos**: componentes nuevos en `web/src/`, quizá endpoints de detección.
- **Contrato**: sí si hay endpoints nuevos. **Depende de**: E2, G3. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g5"></a>
### G5 · Empaquetado y publicación

**Issue**: [#32](https://github.com/JavierLoro/estudio-tfg/issues/32)

- **Objetivo**: generar instaladores y versión portable automáticamente al publicar una versión.
- **Contexto**: app de G3.
- **Alcance**: `electron-builder` con: macOS `.dmg` (arm64 y x64), Windows instalador NSIS y `.exe` portable (x64), Linux AppImage; incluir `templates/`, `scripts/` necesarios, `web/dist` y el servidor de G2; workflow `.github/workflows/release.yml` que, al crear un tag `v*`, construye en `macos-latest` y `windows-latest` (y ubuntu) y sube a GitHub Releases; actualización automática con `electron-updater` desde Releases; **sin firmar** al principio, con instrucciones en el README para abrirla (macOS: clic derecho → Abrir; Windows: «Más información → Ejecutar de todas formas»).
- **Criterios de aceptación**: un tag de prueba genera los artefactos en una release borrador; el .dmg se instala y abre en macOS; el .exe se marca «a verificar en Windows» si no hay equipo.
- **Verificación**: ejecución del workflow enlazada; prueba del .dmg.
- **Archivos**: `desktop/electron-builder.yml` (o en `package.json`), `.github/workflows/release.yml`, `README.md`.
- **Contrato**: no. **Depende de**: G3. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g6"></a>
### G6 · Firma y notarización

**Issue**: [#33](https://github.com/JavierLoro/estudio-tfg/issues/33)

- **Objetivo**: que macOS y Windows no avisen de «app no verificada».
- **Contexto**: requiere una cuenta de Apple Developer (99 $/año) y un certificado de firma de código para Windows. **Las credenciales y el pago los gestiona el usuario**; nunca se guardan en el repo.
- **Alcance**: el agente prepara el workflow de G5 para firmar y notarizar usando secretos de GitHub (`APPLE_ID`, `APPLE_TEAM_ID`, certificado en base64, contraseña…) y documenta qué secretos crear y cómo; si los secretos no existen, el build sigue sin firmar.
- **Criterios de aceptación**: workflow que firma cuando hay secretos y no falla cuando no; guía paso a paso para el usuario.
- **Verificación**: ejecución sin secretos (sin firmar) y revisión de la configuración.
- **Archivos**: `.github/workflows/release.yml`, configuración de electron-builder, `docs/` (guía).
- **Contrato**: no. **Depende de**: G5. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="g7"></a>
### G7 · «Acerca de», licencia y guía de instalación

**Issue**: [#34](https://github.com/JavierLoro/estudio-tfg/issues/34)

- **Objetivo**: cumplir la AGPL al distribuir binarios y explicar la instalación.
- **Contexto**: licencia en `LICENSE` y README (AGPL-3.0, plantilla derivada de ARCO GPL-2.0+, fuentes y componentes de terceros).
- **Alcance**: ventana o panel «Acerca de» con versión, licencia, enlace al código fuente y créditos de terceros; guía de instalación en el README (descargar, abrir sin firmar, primer arranque).
- **Criterios de aceptación**: el enlace al código y la licencia son visibles en la app; la guía cubre macOS y Windows.
- **Verificación**: revisión en la app.
- **Archivos**: componente en `web/src/` o menú de `desktop/`, `README.md`.
- **Contrato**: no. **Depende de**: G3. **Modelo**: Haiku. **Esfuerzo**: S.
