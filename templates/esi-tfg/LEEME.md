# Memoria de TFG — Escuela Superior de Informática (UCLM)

Plantilla para escribir la memoria del Trabajo Fin de Grado con el formato de la ESI.
No hace falta saber LaTeX: escribe texto normal dentro de los archivos `.tex` y compila.

## Qué hay en cada sitio

| Archivo o carpeta | Para qué sirve | ¿Lo editas? |
|---|---|---|
| `datos.tex` | Título, autor, tutor, fecha, idioma, formato… | **Sí, lo primero** |
| `0-inicio/` | Resumen, abstract, agradecimientos y acrónimos | Sí |
| `1-capitulos/` | Un archivo por capítulo (01 a 06). Cada uno empieza con una guía en comentarios (`%`) de lo que debe contener | Sí |
| `2-anexos/` | Un archivo por anexo | Sí |
| `bibliografia.bib` | Tus referencias | Sí |
| `figuras/` | Imágenes (PDF, PNG o JPG) | Sí, añade las tuyas |
| `tfg.tex` | Orden de los apartados | Solo para añadir o quitar apartados |
| `estilo/` | Clase con el formato oficial y el logo | **No** |

Las líneas que empiezan por `%` son comentarios: no salen en el PDF.

## Datos y opciones (`datos.tex`)

- `\idioma{espanol}` o `\idioma{ingles}`: idioma de títulos automáticos («Capítulo», «Índice»…). Las portadas siempre van en español.
- `\formato{impresion}` (doble cara, enlaces en negro) o `\formato{pantalla}` (una cara, sin páginas en blanco, enlaces en color).
- `\estiloBibliografia{ieeetr}`: estilo de las referencias (`ieeetr`, `plain`, `alpha`, `apalike`…).
- Los campos marcados *(opcional)* pueden quedar vacíos (`\cotutor{}`) o borrarse.

`datos.tex` se lee después de `\documentclass`; la clase aplica `\idioma` y `\formato` justo antes de `\begin{document}`, así que basta con cambiarlos ahí.

## Tareas habituales

**Quitar un apartado:** en `tfg.tex`, pon `%` al principio de su línea.

**Añadir un capítulo:** crea `1-capitulos/07-nombre.tex` empezando por
`\chapter{Título}\label{cap:nombre}` y añade `\include{1-capitulos/07-nombre}` en `tfg.tex`, en el lugar que le toque. Un anexo igual, en `2-anexos/` y después de `\appendix`.

**Citar:** pega la entrada BibTeX en `bibliografia.bib` (Google Scholar → «Citar» → «BibTeX») y escribe `\cite{clave}` en el texto. Solo salen las referencias citadas.

**Añadir una figura:** copia la imagen a `figuras/` y usa:

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\textwidth]{mi-imagen}
  \caption{Qué muestra la figura.}
  \label{fig:mi-imagen}
\end{figure}
```

y refiérete a ella con `figura~\ref{fig:mi-imagen}`. En `1-capitulos/04-metodologia.tex` tienes ejemplos comentados de figura, tabla, cita, listado de código y acrónimo.

**Acrónimos:** defínelos en `0-inicio/acronimos.tex` y úsalos con `\ac{SIGLA}`.

**Notas pendientes:** `\todo{revisar esto}` aparece en rojo en el PDF.

## Compilar

Con pdflatex y bibtex: `latexmk -pdf tfg.tex` (Estudio TFG lo hace por ti). La plantilla compila sin avisos; si aparece alguno, viene de tu texto.

## Licencia y atribución

`estilo/esi-tfg.cls` deriva de la clase [esi-tfg](https://github.com/UCLM-ESI/esi-tfg) © 2013-2023 David Villa Alises (grupo ARCO, UCLM), con licencia GPL v2 o posterior; conserva su cabecera, que detalla las modificaciones. La clase añade al final del PDF una nota de atribución a la clase original. Los textos guía de los capítulos son de redacción propia. Tu memoria (el contenido que escribes) es tuya.
