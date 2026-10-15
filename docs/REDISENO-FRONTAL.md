# Rediseño del frontal

Especificación del nuevo frontal de Estudio TFG. Se trabaja en la rama `rediseno/frontal` (sale de `develop`) y se itera con revisiones visuales del usuario; al terminar, PR a `develop`.

Propuesta completa con capturas, mediciones y maquetas: <https://claude.ai/artifact/31fC97AmUj8gZ7LhqiLxjj> (evaluación de la v0.2.0, 15-10-2026).

## Objetivo

Que cualquier estudiante, sin saber LaTeX ni programación, entienda la app y escriba su TFG en ella; que sea agradable de usar y **accesible visualmente** (WCAG 2.2 AA).

Hoy (medido sobre `develop` 93e0b0d): abre en el código de `tfg.tex`; más de 15 conceptos técnicos visibles; primer arranque web con errores en rojo; base de 13 px y el 86,5 % de los tamaños ≤ 12 px en `px` (no escalan); texto «faint» a 2,4–2,6:1 (92 usos); bordes de campos a 1,3:1; botones de 24 px; `outline-none` en 24 campos; estados solo con color; sin tema ni tamaño de texto; 56 botones y 24 estilos de campo ad hoc; la Biblioteca con un estilo distinto al resto.

## Decisiones (provisionales; el usuario puede cambiarlas al revisar)

1. **Espacios de navegación**: Mi TFG · Escribir · Fuentes · Figuras · Ajustes.
2. **Modo avanzado oculto por defecto**: árbol de archivos, código LaTeX, motores y registros aparecen solo si se activa en Ajustes («Opciones avanzadas»).
3. **Densidad por defecto «Cómoda»** (controles de 40 px, texto base 16 px); «Compacta» opcional (32 px, 15 px).
4. **Alcance**: rediseño completo, por pasos revisables: U1–U2 (base y componentes) → U3–U5 (lenguaje, navegación, Mi TFG) → U6 (primer arranque) → U7 (escribir sin LaTeX, con prototipo previo).

## Principios

- **Escribir primero**: la app abre en «Mi TFG», nunca en un archivo. Lo técnico existe, pero en modo avanzado.
- **Hablar como el estudiante**: nombres de lo que la persona reconoce; cada estado dice qué pasa y qué hacer.
- **Accesible por defecto**: AA en todo; texto en `rem`; foco visible; estados con icono + texto; respetar `prefers-reduced-motion`.

## Sistema visual

### Tipografía
- Interfaz: **Atkinson Hyperlegible Next** (diseñada para baja visión). Lectura (texto de la memoria y notas en modo lectura, títulos de página): **Literata**. Código: la monoespaciada del sistema o JetBrains Mono.
- Fuentes **empaquetadas con la app** (paquetes `@fontsource/*`, licencia OFL), cargadas con `font-display: swap`; nada de CDN (la app de escritorio funciona sin conexión). Si un paquete no existe, documentar la alternativa elegida.
- Escala en `rem` (base del documento = ajuste «Tamaño de texto»): 0,75 · 0,875 · 1 · 1,25 · 1,625 rem. **Nada por debajo de 0,75 rem (12 px)**, y ese tamaño solo para metadatos.
- Interlineado 1,5 en UI y 1,65–1,7 en lectura.

### Color
- Neutros cálidos (no gris azulado), un acento azul y colores de estado (ok, aviso, error, info) separados del acento.
- **Todo texto ≥ 4,5:1** sobre el fondo donde aparece, en claro y oscuro; bordes de controles y anillos de foco ≥ 3:1. «faint» deja de ser color de texto.
- Tokens en `web/src/index.css` con variantes clara y oscura y **selector de tema** (Claro / Oscuro / Sistema) que fija `data-theme` en la raíz.
- Test automático que calcula los contrastes de los pares de tokens definidos (texto/fondo, borde/fondo, acento/selección…) y falla si no cumplen.

### Componentes (en `web/src/components/ui.tsx` o `components/ui/`)
- `Button` (variantes primaria, secundaria, sutil, peligro; tamaños por densidad: 40/32 px), `IconButton` (siempre con `aria-label`, área ≥ 32 px), `Input`, `Select`, `Textarea`, `Field` (etiqueta + ayuda + error), `Banner`, `Badge`/`StatusPill` (icono + texto), `EmptyState` (icono, frase, acción), `Card`, `Tabs`.
- Sustituir los botones y campos ad hoc por estos componentes.
- Foco: anillo visible de 2–3 px con separación, en todo control; nada de `outline-none` sin alternativa equivalente.
- Acciones que hoy aparecen solo al pasar el ratón: visibles también con foco del teclado.

### Apariencia (Ajustes)
- Tema: Claro / Oscuro / Sistema. Tamaño de texto: Normal (16 px) / Grande (18 px) / Muy grande (20 px). Densidad: Cómoda / Compacta. Guardado en `localStorage` con prefijo `et:`.

## Navegación y pantallas

| Espacio | Contenido | Sustituye |
|---|---|---|
| Mi TFG | Saludo, «Seguir donde lo dejaste», estado del PDF en lenguaje llano, progreso por capítulos (palabras y avisos del esquema), fuentes por revisar, lo que necesita atención | Inicio |
| Escribir | Apartados de la memoria + editor + PDF al lado; Datos del trabajo | Memoria (Documento), Datos del trabajo |
| Fuentes | Biblioteca, bibliografía y notas de Obsidian con un buscador común | Biblioteca, Notas, Buscar |
| Figuras | Diagramas (y en el futuro imágenes) | Diagramas |
| Ajustes | Tu universidad, carpetas, Apariencia, Opciones avanzadas | Ajustes |

- Barra lateral con **nombre visible** de cada espacio; plegable a iconos.
- «Añadir» (captura) en un único sitio.
- Modo avanzado: añade «Archivos» (árbol actual), «Ver código», el registro técnico y los motores.

## Lenguaje (glosario)

| Hoy | Nuevo |
|---|---|
| Compilar / Compilación correcta / 0 errores · 0 avisos | Actualizar PDF / PDF al día / Todo bien · «N cosas que revisar» |
| Log / diagnósticos | Detalles técnicos / Avisos del PDF |
| Worker, motor de compilación, Docker, TeX del sistema | Generador de PDF (solo en Opciones avanzadas) |
| Carpeta de notas (vault), `.env`, raíz | Carpeta de tus notas (Obsidian), (oculto), carpeta principal |
| N conflicto(s) Syncthing | «Hay dos versiones de “X”» + «Elegir versión» |
| Abrir tfg.tex / Documento · Archivos | Estructura de la memoria / Apartados · Archivos (avanzado) |
| Perfil de institución | Tu universidad |
| recurso(s) pendiente(s) | Plurales correctos («1 recurso», «3 recursos») |

Los mensajes de error explican qué pasó y qué hacer; el texto técnico del servidor va en «Detalles».

## Pasos

| Paso | Contenido | Estado |
|---|---|---|
| R1 | U1 base accesible (tokens, tipografía, rem, tema/tamaño/densidad, foco, movimiento reducido, test de contraste) + U2 componentes y migración de botones y campos | pendiente |
| R2 | U3 lenguaje + U4 navegación y modo avanzado + U5 Mi TFG | pendiente |
| R3 | U6 primer arranque común (web y escritorio) + Ajustes reorganizado | pendiente |
| R4 | U7 prototipo de «Escribir sin LaTeX» y decisión de alcance | pendiente |

## Reglas para quien trabaje en esta rama

- Trabajar en el worktree de la rama `rediseno/frontal`; commits en esta rama (uno por subtarea, en español). No fusionar ni tocar `develop`/`main`.
- No cambiar la API ni el servidor salvo que el paso lo pida (y entonces, contrato versionado). La funcionalidad existente debe seguir funcionando: tests del servidor, `npm run build --prefix web`, tests del worker y pruebas de navegador (`test/e2e`) en verde; actualizar los selectores de las pruebas si cambian los textos, sin perder lo que comprueban.
- Probar en la **vista previa con datos de ejemplo** (nunca con la memoria o el vault reales). Ver «Vista previa» abajo.
- Al terminar cada paso: capturas de las pantallas principales en claro y oscuro y en tamaño de texto Grande, y una lista de lo que cambió y lo que queda.

### Vista previa

Datos de ejemplo y arranque en el scratchpad de la sesión que coordina el rediseño (API en `:8821` con `tsx watch`, web en `:5201`, worker propio en `:8092`). Si no está disponible, levantar una instancia propia según las reglas de `docs/HOJA-DE-RUTA.md` (otra memoria de plantilla y notas de `test/fixtures/notes`, otros puertos).
