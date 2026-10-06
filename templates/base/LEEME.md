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
- `\estiloBibliografia{ieee}`: estilo de las referencias: `ieee` (numérico, en orden de cita), `apa` (autor y año), `numeric`, `authoryear` o `alphabetic`. También valen los nombres antiguos de BibTeX (`ieeetr`, `plain`, `alpha`, `apalike`). Cámbialo en `datos.tex` (no en otro sitio): la clase lo lee de ahí al empezar.
- `\licencia{reservados}`: texto de la página de créditos: `reservados` («Todos los derechos reservados»), `cc-by`, `cc-by-sa`, `cc-by-nc-sa` (licencias Creative Commons 4.0) o `ninguna`.
- `\atribucion{si}`: `si` añade al final una página que cita la clase original de ARCO; `no` la quita.

## Datos de la institución (`estilo/institucion.tex`)

Un comando por línea; todos son opcionales y, si uno queda vacío, no sale en las portadas.

- `\universidad{…}`, `\escuela{…}` (escuela o facultad) y `\titulacion{…}` («Grado en …»).
- `\logo{archivo.pdf}`: un archivo dentro de `estilo/` (PDF, PNG o JPG); vacío = sin logo.
- `\tipoTrabajo{tfg}`: `tfg`, `tfm`, `tesis` u `otro`; da «Trabajo Fin de Grado», «Trabajo Fin de Máster» o «Tesis Doctoral». `\nombreTrabajo{…}` lo sustituye por el texto que quieras.
- `\etiquetaEspecialidad{Tecnología específica}`: con `\intensificacion` de `datos.tex` forma «TECNOLOGÍA ESPECÍFICA DE …» en la portada interior; vacío = no se muestra. Si la etiqueta ya acaba en «de» o «en» («Mención en»), no se añade otro «de».
- `\idiomaPortadas{…}`: `espanol`, `ingles` o `documento` (el mismo de `\idioma`). Afecta a portadas, créditos y hoja del tribunal.
- `\tamanoLetra{12pt}` (`10pt`, `11pt` o `12pt`), `\margenes{interior}{exterior}{superior}{inferior}` (p. ej. `{35mm}{20mm}{25mm}{25mm}`; el interior es el de la encuadernación) e `\interlineado{1.5}` (`1`, `1.15`, `1.25`, `1.5` o `2`, en el cuerpo del trabajo).

Si `institucion.tex` no existe, la clase usa los valores del perfil genérico (sin universidad ni logo, 12 pt, márgenes de 30/25/25/25 mm, interlineado 1,5).

**Portada propia.** Si tu centro exige una portada muy distinta, crea `estilo/portada.tex` con su contenido: se usará en lugar de la portada exterior generada. Dentro puedes usar los datos con `\dato{titulo}`, `\dato{autor}`, `\dato{tutor}`, `\dato{universidad}`, `\dato{escuela}`, `\dato{titulacion}`, `\dato{fecha}` o `\dato{tiponombre}`.

## Tareas habituales

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

**Acrónimos:** defínelos en `0-inicio/acronimos.tex` y úsalos con `\ac{SIGLA}`.

**Notas pendientes:** `\todo{revisar esto}` aparece en rojo en el PDF mientras estés en `\modo{borrador}`.

## Compilar

Con pdflatex y biber: `latexmk -pdf tfg.tex` (Estudio TFG lo hace por ti). La plantilla compila sin avisos; si aparece alguno, viene de tu texto.

## Licencia y atribución

`estilo/memoria.cls` deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) © 2013-2023 David Villa Alises (grupo ARCO, UCLM), con licencia GPL v2 o posterior; conserva su cabecera, que detalla las modificaciones. Salvo que pongas `\atribucion{no}`, la clase añade al final del PDF una nota de atribución a la clase original. Los textos guía de los capítulos son de redacción propia. Los logotipos pertenecen a sus instituciones. Tu memoria (el contenido que escribes) es tuya.
