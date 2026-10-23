# Memoria de TFG / TFM

Plantilla para escribir la memoria de tu trabajo (Trabajo Fin de Grado, Fin de Máster o tesis) en LaTeX.
No hace falta saber LaTeX: escribe texto normal dentro de los archivos `.tex` y compila.

La plantilla es la misma para cualquier universidad; lo propio de tu centro (nombre, logo, titulación, márgenes…) está en `estilo/institucion.tex`, que viene rellenado según el **perfil** con el que creaste la memoria (por ejemplo, el de la ESI de la UCLM o el genérico).

## Qué hay en cada sitio

| Archivo o carpeta | Para qué sirve | ¿Lo editas? |
|---|---|---|
| `datos.tex` | Título, autor, tutor, fecha, palabras clave, idioma, formato… | **Sí, lo primero** |
| `estilo/institucion.tex` | Universidad, escuela, logo, tipo de trabajo, titulación, márgenes, tamaño de letra e interlineado | Solo si tu centro no es el del perfil o pide otro formato |
| `0-inicio/` | Resumen, abstract, agradecimientos y acrónimos | Sí |
| `1-capitulos/` | Un archivo por capítulo. Cada uno empieza con una guía en comentarios (`%`) de lo que debe contener | Sí |
| `2-anexos/` | Un archivo por anexo | Sí |
| `bibliografia.bib` | Tus referencias | Sí |
| `figuras/` | Imágenes (PDF, PNG o JPG) | Sí, añade las tuyas |
| `tfg.tex` | Orden de los apartados | Solo para añadir o quitar apartados |
| `estilo/memoria.cls` | La clase con el formato | **No** |

Las líneas que empiezan por `%` son comentarios: no salen en el PDF.

Si usas **Estudio TFG**, el panel **«Datos del trabajo»** (vista Documento → «Datos del trabajo») edita `datos.tex` e `institucion.tex` con un formulario, sin tocar el resto de las líneas ni tus comentarios. Puedes seguir editándolos a mano cuando quieras.

## Datos y opciones (`datos.tex`)

Escribe entre las llaves. Los campos *(opcional)* pueden quedar vacíos (`\cotutor{}`) o borrarse.

- `\titulo`, `\autor`, `\email`, `\tutor`, `\cotutor`, `\departamento` (sale como «Departamento de …»), `\intensificacion` (tecnología específica, mención o itinerario), `\ciudad`.
- `\fecha{junio}{2026}`: mes y año de entrega; en las portadas sale «junio de 2026» (o «June 2026» si las portadas van en inglés). Si falta, se usa la fecha de compilación.
- `\palabrasClave{…}` y `\keywords{…}`: palabras clave en español (salen al final del Resumen) y en inglés (al final del Abstract).
- `\idioma{espanol}` o `\idioma{ingles}`: idioma de los títulos automáticos («Capítulo», «Índice», «Referencias»…) y de la separación en sílabas.
- `\formato{impresion}` (doble cara, enlaces en negro) o `\formato{pantalla}` (una cara, sin páginas en blanco, márgenes iguales, enlaces en color).
- `\modo{borrador}` o `\modo{final}`. En borrador, cada página lleva al pie una marca discreta «BORRADOR · fecha» y las notas `\todo{…}` salen en rojo. En final desaparece la marca y cualquier `\todo` que quede **impide compilar** (así no se cuela ninguno en la versión que entregas).
- `\estiloBibliografia{…}`: estilo de las referencias: `numeric` (numérico, en orden alfabético; predeterminado del perfil ESI), `ieee` (numérico, en orden de cita; predeterminado del genérico), `apa` (autor y año), `authoryear` o `alphabetic`. También valen los nombres antiguos de BibTeX (`ieeetr`, `plain`, `alpha`, `apalike`). Cámbialo en `datos.tex` (no en otro sitio): la clase lo lee de ahí al empezar.
- `\licencia{reservados}`: texto de la página de créditos: `reservados` («Todos los derechos reservados»), `cc-by`, `cc-by-sa`, `cc-by-nc-sa` (licencias Creative Commons 4.0) o `ninguna`.
- `\atribucion{si}`: `si` añade al final una página que cita la clase original de ARCO; `no` la quita.

## Datos de la institución (`estilo/institucion.tex`)

Un comando por línea; todos son opcionales y, si uno queda vacío, no sale en las portadas.

- `\universidad{…}`, `\escuela{…}` (escuela o facultad) y `\titulacion{…}` («Grado en …»).
- `\logo{archivo.pdf}`: un archivo dentro de `estilo/` (PDF, PNG o JPG); vacío = sin logo.
- `\tipoTrabajo{tfg}`: `tfg`, `tfm`, `tesis` u `otro`; da «Trabajo Fin de Grado», «Trabajo Fin de Máster» o «Tesis Doctoral». `\nombreTrabajo{…}` lo sustituye por el texto que quieras.
- `\etiquetaEspecialidad{Tecnología específica}`: con `\intensificacion` de `datos.tex` forma «TECNOLOGÍA ESPECÍFICA DE …» en la portada interior; vacío = no se muestra. Si la etiqueta ya acaba en «de» o «en» («Mención en»), no se añade otro «de».
- `\idiomaPortadas{…}`: `espanol`, `ingles` o `documento` (el mismo de `\idioma`). Afecta a portadas, créditos y hoja del tribunal.
- `\tamanoLetra{12pt}` (`10pt`, `11pt` o `12pt`), `\margenes{interior}{exterior}{superior}{inferior}` (p. ej. `{35mm}{20mm}{25mm}{25mm}`; el interior es el de la encuadernación) e `\interlineado{1.5}` (`1`, `1.15`, `1.25`, `1.5` o `2`, en el cuerpo y los preliminares; portadas, créditos y atribución tienen ajustes de interlineado propios).

Si `institucion.tex` no existe, la clase usa los valores del perfil genérico (sin universidad ni logo, 12 pt, márgenes de 30/25/25/25 mm, interlineado 1,5).

## Fuente del texto y estilo de títulos

En **Datos del trabajo → Texto y títulos**, o al crear una memoria desde cero, puedes elegir la familia del texto, la de los títulos, el tamaño del cuerpo y el interlineado. Se incluyen Times/NewTX, Latin Modern Roman, Palatino/NewPX y TeX Gyre Heros, con muestras para comparar su aspecto.

Abre **Personalizar títulos** si tu normativa pide ajustes distintos para capítulos, secciones o subsecciones. Cada nivel permite elegir fuente, tamaño entre 8 y 36 puntos (también medios puntos), negrita y mayúsculas. «Como lo escribas» respeta el título original. Los niveles con una fuente propia mantienen esa elección al cambiar la fuente general.

Los cambios de estilo conservan el texto, las etiquetas y el orden. Las muestras ayudan a elegir; comprueba el resultado final en el PDF. Una familia de estilo Times o Palatino no equivale necesariamente a una fuente comercial concreta exigida por tu centro.

Para editarlo en código, añade los comandos correspondientes en `estilo/institucion.tex`:

```latex
\fuenteTexto{times}         % times | latinmodern | palatino | heros
\fuenteTitulos{sans}        % sans | texto | times | latinmodern | palatino | heros
\fuenteCapitulo{heredar}    % heredar o una de las fuentes de títulos
\tamanoCapitulo{22}         % puntos, con punto decimal en código (p. ej. 22.5)
\negritaCapitulo{si}        % si | no
\mayusculasCapitulo{si}     % si | no
```

Usa los mismos prefijos con `Seccion` o `Subseccion` para los otros niveles. Sin comandos nuevos, los perfiles conservan su aspecto actual.

**Portada propia.** Si tu centro exige una portada muy distinta, crea `estilo/portada.tex` con su contenido: se usará en lugar de la portada exterior generada. Dentro puedes usar los datos con `\dato{titulo}`, `\dato{autor}`, `\dato{tutor}`, `\dato{universidad}`, `\dato{escuela}`, `\dato{titulacion}`, `\dato{fecha}` o `\dato{tiponombre}`.

## Índices y numeración de apartados

Al crear desde cero, el paso **Apartados** permite elegir el índice general y las listas de figuras, tablas y código. Después encontrarás las mismas casillas en **Datos del trabajo → Índices y numeración de apartados**. Las listas vacías se omiten automáticamente, aunque estén seleccionadas.

En **Más opciones de índices y numeración** puedes decidir por separado hasta qué nivel numerar los títulos y hasta cuál mostrar los apartados en el índice general. Por defecto se incluyen capítulos, secciones y subsecciones en ambos casos. Por ejemplo, puedes dejar las subsecciones sin número y seguir mostrándolas en el índice.

Desactivar un índice conserva sus opciones. Las memorias nuevas mantienen su bloque de índices aunque desactives todas las casillas, de modo que podrás reactivarlas después. En documentos anteriores donde se haya eliminado ese bloque, restaura `\indices` en el lugar deseado del principal. Actualizar la plantilla conserva ese archivo.

En `estilo/institucion.tex`:

```latex
\indiceGeneral{si}       % si | no
\indiceFiguras{si}
\indiceTablas{si}
\indiceCodigo{si}
\numerarHasta{subsecciones} % capitulos | secciones | subsecciones
\indiceHasta{subsecciones}  % independiente de numerarHasta
```

La vista Documento conserva todos los apartados y refleja los números elegidos. Su organización no se limita a los apartados visibles en el índice del PDF. Los títulos con asterisco escritos en LaTeX siguen sin numerarse; aparecer en el índice depende de cómo los hayas incluido.

## Numeración, cabeceras y pies

Al crear desde cero, abre **Numeración, cabeceras y pies** dentro del paso **Texto y títulos**. Después puedes cambiarlo en la sección del mismo nombre de **Datos del trabajo**.

Puedes usar preliminares en romanos y comenzar el cuerpo en 1, o mantener números arábigos desde el principio sin reiniciar al llegar al cuerpo. Las portadas y hojas de cortesía cuentan, pero no muestran número. Los anexos continúan la cuenta del cuerpo.

El diseño inicial conserva las cabeceras y pies de la plantilla. Con **Personalizar las posiciones**, elige el contenido de la izquierda, el centro y la derecha, tanto arriba como abajo: vacío, capítulo, sección, página o texto propio. En doble cara puedes reflejar izquierda y derecha en las páginas pares. El pie se aplica también a la primera página de cada capítulo; su cabecera se oculta salvo que elijas mostrarla. Las portadas y páginas de cortesía no llevan ninguno de estos elementos.

Usa textos breves: cada zona ocupa como máximo un tercio del ancho y los textos que lo superan se reducen para evitar solapamientos. La vista previa muestra la distribución; comprueba las medidas definitivas en el PDF. Volver al diseño de la plantilla conserva tu configuración personalizada para reutilizarla.

En `estilo/institucion.tex`:

```latex
\numeracionPaginas{romanos} % romanos | continua
\estiloPagina{personalizado} % actual | personalizado
\reflejarCabeceras{si}      % si | no; solo afecta a doble cara
\cabeceraInicioCapitulo{no} % si | no
\cabeceraIzquierda{texto}   % vacio | capitulo | seccion | pagina | texto
\cabeceraIzquierdaTexto{Mi titulación}
\cabeceraCentro{vacio}
\cabeceraDerecha{seccion}
\pieIzquierda{vacio}
\pieCentro{pagina}
\pieDerecha{vacio}
```

Las seis posiciones admiten su comando de texto terminado en `Texto`. Al editar los textos desde la app se escapan los caracteres especiales de LaTeX.

## Escribir la memoria en inglés

En `datos.tex`, cambia a `\idioma{ingles}`. Ambos perfiles traen `\idiomaPortadas{documento}` en `estilo/institucion.tex`: las etiquetas de portadas, créditos y tribunal seguirán ese idioma. Una elección explícita de `espanol` o `ingles` para las portadas tiene prioridad.

El bloque `\iflanguage{english}{…}{…}` de `tfg.tex` coloca primero Abstract y después Resumen en una memoria en inglés; en español usa el orden inverso. La vista Documento sigue el mismo orden. Conserva el Resumen en español y el Abstract en inglés, cada uno en su archivo. `\palabrasClave` contiene los términos en español y `\keywords`, en inglés, con independencia del idioma principal.

El contenido que escribes no se traduce automáticamente. Adapta los títulos y textos de capítulos, agradecimientos, acrónimos y anexos, así como los pies y el texto de figuras, tablas y listados. Traduce también los campos de portada que correspondan: título del trabajo, titulación, departamento, especialidad y su etiqueta. Por ejemplo, para el modelo inglés de la ESI: `\titulacion{Bachelor in Computing Engineering}`, `\etiquetaEspecialidad{Specialization}` y `\intensificacion{Software Engineering}`. Los nombres propios de la universidad, el centro y las personas se conservan según su denominación oficial.

En memorias creadas con versiones anteriores, comprueba también `\idiomaPortadas` y el orden de las inclusiones de los resúmenes en `tfg.tex`: actualizar la clase conserva esos archivos y tus elecciones.

## Tareas habituales

**Organizar desde Estudio TFG:** en la vista Documento, abre las acciones del apartado (botón de la fila o menú contextual). Puedes crear capítulos, secciones, subsecciones y anexos; cambiar títulos; subir o bajar apartados y activar/desactivarlos conservando su contenido. Una subsección puede pasar a sección y una sección sin hijas puede pasar a subsección de la anterior. Guarda primero los cambios pendientes. Las etiquetas se conservan; LaTeX recalcula los números al compilar. Las estructuras especiales y los movimientos entre archivos se editan en el código.

**Quitar un apartado:** en `tfg.tex`, pon `%` al principio de su línea.

**Añadir un capítulo:** crea `1-capitulos/07-nombre.tex` empezando por
`\chapter{Título}\label{cap:nombre}` y añade `\include{1-capitulos/07-nombre}` en `tfg.tex`, en el lugar que le toque. Un anexo igual, en `2-anexos/` y después de `\appendix`.

**Citar:** pega la entrada BibTeX en `bibliografia.bib` (Google Scholar → «Citar» → «BibTeX») y escribe `\cite{clave}` en el texto. Solo salen las referencias citadas. Para una página web usa `@online` con `url` y `urldate = {AAAA-MM-DD}` (la fecha en que la consultaste); en la memoria sale «consultado el 1 de junio de 2026».

**Añadir una figura:** copia la imagen a `figuras/` y usa:

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\textwidth]{mi-imagen}
  \caption{Qué muestra la figura.}
  \label{fig:mi-imagen}
\end{figure}
```

y refiérete a ella con `figura~\ref{fig:mi-imagen}`. En el capítulo de metodología o desarrollo (`1-capitulos/04-…`) tienes ejemplos comentados de figura, tabla, cita, listado de código y acrónimo.

**Índices:** `\indices` en `tfg.tex` pone el índice general y, solo si la memoria tiene alguna figura, tabla o listado de código, sus índices correspondientes.
Resumen, Abstract y Agradecimientos usan `\chapter*{…}` para quedar fuera del índice general. Los títulos de capítulos y secciones se muestran en mayúsculas y negrita; los de subsecciones conservan las mayúsculas y minúsculas que escribas.

**Acrónimos:** defínelos en `0-inicio/acronimos.tex` y úsalos con `\ac{SIGLA}`.

**Notas pendientes:** `\todo{revisar esto}` aparece en rojo en el PDF mientras estés en `\modo{borrador}`.


## Crear una memoria desde cero

En **Ajustes → Crear desde cero** puedes elegir idioma, datos, formato de página y apartados sin editar código. Selecciona capítulos sugeridos o añade otros con tus propios nombres; ordénalos y revisa todo antes de elegir una carpeta y crear la memoria.

Los valores iniciales son editables y no corresponden necesariamente a la normativa de tu centro. A una cara se usan márgenes izquierdo y derecho; a dos caras se alternan interior (lomo) y exterior. Los márgenes de creación se introducen en milímetros y ya incluyen el espacio junto al lomo.

**Portadas:** puedes seleccionar ambas, una o ninguna. En **Componer portadas** eliges los elementos y los colocas en las zonas superior, central o inferior, por arrastre o con los controles de cada bloque. También puedes añadir texto propio. Los datos vacíos no se muestran en el PDF. La composición es una guía; comprueba el resultado final al compilar.

Después puedes cambiar estos ajustes y las portadas desde **Datos del trabajo**, y añadir o reorganizar capítulos desde **Documento**. La composición se guarda en `estilo/portadas.tex`; si la modificas directamente en código, el editor visual lo detectará y conservará tus cambios.

La clase admite `\papel{a4|carta}`, `\caras{automatico|una|dos}` y `\mostrarPortada{si|no}`, `\mostrarPortadaInterior{si|no}`, `\mostrarDerechos{si|no}`, `\mostrarTribunal{si|no}`. Las opciones se guardan en `estilo/institucion.tex`. `automatico` mantiene el comportamiento anterior según `\formato`; una elección explícita conserva los márgenes indicados.

## Compilar

Con pdflatex y biber: `latexmk -pdf tfg.tex` (Estudio TFG lo hace por ti). La plantilla compila sin avisos; si aparece alguno, viene de tu texto.

## Licencia y atribución

`estilo/memoria.cls` deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) © 2013-2023 David Villa Alises (grupo ARCO, UCLM), con licencia GPL v2 o posterior; conserva su cabecera, que detalla las modificaciones. Salvo que pongas `\atribucion{no}`, la clase añade al final del PDF una nota de atribución a la clase original. Los textos guía de los capítulos son de redacción propia. Los logotipos pertenecen a sus instituciones. Tu memoria (el contenido que escribes) es tuya.
