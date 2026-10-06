% -*- coding: utf-8 -*-

% esi-tfg.cls
%
% Copyright © 2013-2023 David Villa Alises
%
% This program is free software; you can redistribute it and/or modify
% it under the terms of the GNU General Public License as published by
% the Free Software Foundation; either version 2 of the License, or
% (at your option) any later version.
%
% This program is distributed in the hope that it will be useful,
% but WITHOUT ANY WARRANTY; without even the implied warranty of
% MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
% GNU General Public License for more details.
%
% You should have received a copy of the GNU General Public License
% along with this program; if not, write to the Free Software
% Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

% ----------------------------------------------------------------------------
% ORIGEN Y MODIFICACIONES
%
% Esta clase deriva de «esi-tfg» del grupo ARCO (UCLM-ESI):
%   https://github.com/UCLM-ESI/esi-tfg
% Se distribuye bajo la misma licencia GPL (versión 2 o posterior).
%
% Modificaciones (2026, Estudio TFG) respecto al original:
%  - Vive en estilo/ y se carga con \documentclass{estilo/esi-tfg}.
%  - Paquetes con \RequirePackage; eliminados los obsoletos o innecesarios
%    (epsfig, atbeginend, lettrine, tipa, inputenc, hyphenat, xifthen,
%    ifmtarg, pifont, relsize) y la licencia GFDL por defecto.
%  - babel (español, o inglés con \idioma{ingles}) se carga en la clase.
%  - Datos del trabajo con comandos en español (\titulo, \autor, \tutor…);
%    los opcionales pueden quedar vacíos u omitirse.
%  - \formato{impresion|pantalla}: doble cara y enlaces negros, o una cara,
%    márgenes simétricos y enlaces en color.
%  - Estilo de bibliografía configurable con \estiloBibliografia{…}.
%  - Fuentes: newtx (Times) en lugar de ptm; Latin Modern Sans; Bera Mono.
%  - Portadas en español con el aspecto de la original (logo, universidad,
%    escuela, grado, título, autor, tutor y fecha); separador de anexos
%    integrado en \appendix; corregido el cotutor (no se mostraba).
%  - Eliminados comandos de ejemplo no usados (\drop, \FIXME, \acx…).
%
% Los comandos públicos están documentados en LEEME.md.
% ----------------------------------------------------------------------------

\NeedsTeXFormat{LaTeX2e}[2021/11/15]
\ProvidesClass{estilo/esi-tfg}[2026/10/06 v2.0 TFG de la ESI-UCLM (derivada de esi-tfg de ARCO)]
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{book}}
\ProcessOptions\relax
% Doble cara por defecto; \formato{pantalla} lo cambia al final del preámbulo.
\LoadClass[a4paper, 12pt, twoside, openright]{book}

%% -- DATOS DEL TRABAJO (se rellenan en datos.tex) ----------------------------
\RequirePackage{etoolbox}

\newcommand*{\esi@titulo}{}
\newcommand*{\esi@autor}{}
\newcommand*{\esi@email}{}
\newcommand*{\esi@tutor}{}
\newcommand*{\esi@cotutor}{}
\newcommand*{\esi@departamento}{}
\newcommand*{\esi@intensificacion}{}
\newcommand*{\esi@ciudad}{Ciudad Real}
\newcommand*{\esi@palabras}{}
\newcommand*{\esi@bibestilo}{ieeetr}
% Fecha por defecto: mes y año de la compilación.
\newcommand*{\esi@mes}{\ifcase\month\or Enero\or Febrero\or Marzo\or Abril\or
  Mayo\or Junio\or Julio\or Agosto\or Septiembre\or Octubre\or Noviembre\or
  Diciembre\fi}
\newcommand*{\esi@anio}{\the\year}

\newcommand{\titulo}[1]{\renewcommand*{\esi@titulo}{#1}}
\newcommand{\autor}[1]{\renewcommand*{\esi@autor}{#1}}
\newcommand{\email}[1]{\renewcommand*{\esi@email}{#1}}
\newcommand{\tutor}[1]{\renewcommand*{\esi@tutor}{#1}}
\newcommand{\cotutor}[1]{\renewcommand*{\esi@cotutor}{#1}}
\newcommand{\departamento}[1]{\renewcommand*{\esi@departamento}{#1}}
\newcommand{\intensificacion}[1]{\renewcommand*{\esi@intensificacion}{#1}}
\newcommand{\ciudad}[1]{\renewcommand*{\esi@ciudad}{#1}}
\newcommand{\palabrasClave}[1]{\renewcommand*{\esi@palabras}{#1}}
\newcommand{\fecha}[2]{%
  \ifblank{#1}{}{\renewcommand*{\esi@mes}{#1}}%
  \ifblank{#2}{}{\renewcommand*{\esi@anio}{#2}}}
\newcommand{\estiloBibliografia}[1]{%
  \ifblank{#1}{}{\renewcommand*{\esi@bibestilo}{#1}}}

\newif\ifesi@ingles
\newif\ifesi@pantalla
\newcommand{\idioma}[1]{%
  \ifstrequal{#1}{ingles}{\esi@inglestrue}{%
    \ifstrequal{#1}{espanol}{\esi@inglesfalse}{%
      \ClassError{esi-tfg}{\string\idioma{#1} no reconocido}%
        {Usa \string\idioma{espanol} o \string\idioma{ingles}.}}}}
\newcommand{\formato}[1]{%
  \ifstrequal{#1}{pantalla}{\esi@pantallatrue}{%
    \ifstrequal{#1}{impresion}{\esi@pantallafalse}{%
      \ClassError{esi-tfg}{\string\formato{#1} no reconocido}%
        {Usa \string\formato{impresion} o \string\formato{pantalla}.}}}}

% Ejecuta #2 solo si la macro #1 no está vacía (ni solo con espacios).
\newcommand{\esi@si}[2]{\expandafter\ifblank\expandafter{#1}{}{#2}}

%% -- IDIOMA Y FUENTES --------------------------------------------------------
\RequirePackage[T1]{fontenc}
% El idioma principal es español; con \idioma{ingles} se cambia a inglés al
% empezar el documento (ver «APLICAR \idioma Y \formato» al final).
\RequirePackage[english, spanish, es-noshorthands, es-tabla, es-nodecimaldot]{babel}

\RequirePackage{newtxtext}             % Times
\RequirePackage{newtxmath}
\renewcommand{\sfdefault}{lmss}        % Latin Modern Sans
\RequirePackage[scaled=.82]{beramono}  % Bera Mono para código

\addto\captionsspanish{%
  \renewcommand{\appendixname}{Anexo}%
  \renewcommand{\bibname}{Referencias}%
  \renewcommand{\lstlistingname}{Listado}%
  \renewcommand{\lstlistlistingname}{Índice de listados}%
  \renewcommand{\esi@anexosname}{ANEXOS}}
\addto\captionsenglish{%
  \renewcommand{\appendixname}{Appendix}%
  \renewcommand{\bibname}{References}%
  \renewcommand{\lstlistingname}{Listing}%
  \renewcommand{\lstlistlistingname}{List of Listings}%
  \renewcommand{\esi@anexosname}{APPENDICES}}
\newcommand*{\esi@anexosname}{ANEXOS}

% Las normas tipográficas que aparecen en los comentarios corresponden al libro:
% J. Martínez de Sousa. Ortografía y ortotipografía del español actual. Trea, 2008.

%% -- MEDIDAS Y DISTANCIAS ----------------------------------------------------
\RequirePackage[left=35mm, right=20mm, top=25mm, bottom=25mm]{geometry}
\RequirePackage{setspace}
\setlength{\parskip}{2mm plus 0.2mm minus 0.2mm}
\raggedbottom

%% Párrafos
% La indentación que precede al párrafo normal debe ser de un
% cuadratín (1em) (-> 13.4.1.1)
\setlength{\parindent}{1em}

% El espacio en blanco al final de una línea corta debe ser mayor que
% la indentación del párrafo. (-> 13.4.1.1)
\setlength{\parfillskip}{1.5em plus 1fil}

\RequirePackage[inline]{enumitem}
\setlist{topsep=0pt, itemsep=0pt}

%% -- GRÁFICOS Y COLORES ------------------------------------------------------
% Las figuras deben ser PDF, PNG o JPG. Sin shell escape (Estudio TFG compila
% con -no-shell-escape) epstopdf no puede convertir EPS y solo emitiría un aviso,
% así que se marca como ya cargado.
\expandafter\def\csname ver@epstopdf-base.sty\endcsname{2099/01/01 desactivado por esi-tfg}
\RequirePackage{graphicx}
\graphicspath{{figuras/}{estilo/}}

\RequirePackage[table]{xcolor}
\definecolor{gray45}{gray}{0.45}
\definecolor{esienlace}{rgb}{0.05, 0.25, 0.55}  % enlaces en \formato{pantalla}

%% -- EPÍGRAFES Y CUADROS ----------------------------------------------------
\RequirePackage[font=small, labelfont=bf, skip=6pt]{caption}
\captionsetup[table]{position=top}  % el epígrafe de las tablas va encima
\RequirePackage{booktabs}
\AtBeginDocument{\setlength{\extrarowheight}{1pt}}

%% -- LISTADOS DE CÓDIGO ------------------------------------------------------
\RequirePackage{listings}
\lstset{%
  aboveskip          = 2mm,
  belowskip          = 2mm,
  frame              = Ltb,
  framerule          = 0pt,
  framextopmargin    = 3pt,
  framexbottommargin = 3pt,
  framexleftmargin   = 0.4cm,
  framesep           = 0pt,
  rulesep            = .4pt,
  captionpos         = b,
  floatplacement     = htbp,
  basicstyle         = \footnotesize\ttfamily,
  showstringspaces   = false,
  commentstyle       = \color{gray45},
  keywordstyle       = \bfseries,
  numbers            = none,
  breaklines         = true,
  columns            = fullflexible,
  keepspaces         = true,
  extendedchars      = true,
  literate           = {á}{{\'a}}1 {é}{{\'e}}1 {í}{{\'i}}1 {ó}{{\'o}}1
                       {ú}{{\'u}}1 {ñ}{{\~n}}1 {Á}{{\'A}}1 {É}{{\'E}}1
                       {Í}{{\'I}}1 {Ó}{{\'O}}1 {Ú}{{\'U}}1 {Ñ}{{\~N}}1
                       {ü}{{\"u}}1 {¿}{{?`}}1 {¡}{{!`}}1,
}

%% -- ACRÓNIMOS ---------------------------------------------------------------
% Solo se listan los acrónimos que se usan en el texto con \ac{…}.
\RequirePackage[printonlyused]{acronym}

%% -- ÍNDICES Y BIBLIOGRAFÍA --------------------------------------------------
% Añade figuras, cuadros, listados y bibliografía al índice general.
\RequirePackage[nottoc]{tocbibind}
% de tocbibind, para que el índice de listados aparezca en la ToC
\renewcommand{\lstlistoflistings}{%
  \begingroup
  \tocfile{\lstlistlistingname}{lol}%
  \endgroup}

%% -- HIPER-ENLACES PARA PDF --------------------------------------------------
\RequirePackage[
  bookmarks,
  hyperfootnotes = false,
  colorlinks,
  linkcolor      = black,
  citecolor      = black,
  urlcolor       = black,
  ]{hyperref}
\pdfstringdefDisableCommands{\def\\{ }\def\newline{ }}

%% -- FORMATO DE CAPÍTULOS Y SECCIONES ----------------------------------------
\RequirePackage[rigidchapters, clearempty, pagestyles]{titlesec}
% - rigidchapters: Todos los títulos de capítulo tienen la misma altura
% - clearempty: Elimina encabezados y pies de páginas (izquierdas) vacías.

\newcommand{\chapterformat}[1]{%
  \fontsize{22}{26}\selectfont\sffamily #1%
}

% doc: \titleformat{ command }[ shape ]{ format }{ label }{ sep }{ before }[ after ]
\titleformat{\section}
  {\normalfont\fontsize{15.0pt}{18pt}\selectfont\bfseries}{\thesection}{.7em}{}
\titleformat{\subsection}
  {\normalfont\fontsize{13.5pt}{16pt}\selectfont\bfseries}{\thesubsection}{1em}{}

\newcommand{\frontchapterformat}{%
  \titleformat{\chapter}[display]%
    {}%
    {}%
    {0mm}%
    {\chapterformat}%
  \titlespacing{\chapter}{0cm}{2cm}{2cm}%
}

\let\frontmatterorig\frontmatter
\renewcommand{\frontmatter}{%
  \frontmatterorig
  \singlespacing
  \pagestyle{mainstyle}%
  \frontchapterformat
}

\newcommand{\mainchapterformat}{%
  \titleformat{\chapter}[display]%
    {\normalfont\large\sffamily}%
    {\chaptertitlename\ \thechapter}%
    {0mm}%
    {\chapterformat}%
  \titlespacing{\chapter}{0cm}{1cm}{3.8cm}%
}

\let\mainmatterorig\mainmatter
\renewcommand{\mainmatter}{%
  \cleardoublepage
  \mainmatterorig
  \onehalfspacing
  \pagestyle{mainstyle}%
  \mainchapterformat
}

% espaciado entre secciones, subseciones, etc.
% doc: \titlespacing*{ command }{ left }{ beforesep }{ aftersep }[ right ]
\titlespacing{\section}{0pt}{5mm}{0mm}
\titlespacing{\subsection}{0pt}{4mm}{-1mm}
\titlespacing{\subsubsection}{0pt}{4mm}{-1mm}

%% -- ESTILO DE PÁGINA, ENCABEZADOS Y PIES ------------------------------------
\newpagestyle{mainstyle}[\small]{%
  \sethead[\ifthechapter{\thechapter.\ }{}\textsc{\chaptertitle}][][]%
          {}{}{\textsc{\sectiontitle}}%
  \setfoot{}{\thepage{}}{}%
}

\newpagestyle{backstyle}{%
  \sethead{}{}{}%
  \setfoot{}{\thepage{}}{}%
}

\addtolength{\footskip}{8pt}

%% -- PÁGINAS ESPECIALES ------------------------------------------------------
% Las portadas se escriben siempre en español (nombres oficiales).

% Portada exterior.
\newcommand{\portada}{%
  \thispagestyle{empty}%
  \begin{center}
    \Large \bfseries
    \setstretch{1.3}

    \vspace*{\stretch{6}}
    \includegraphics[width=4.1cm]{esi_logo.pdf}

    \vspace*{\stretch{6}}

    UNIVERSIDAD DE CASTILLA-LA MANCHA
    \vspace*{\stretch{1}}

    ESCUELA SUPERIOR DE INFORMÁTICA

    \vspace*{\stretch{2}}
    GRADO EN INGENIERÍA INFORMÁTICA

    \vspace*{\stretch{2}}
    {\large TRABAJO FIN DE GRADO}

    \vspace*{\stretch{4}}
    {\LARGE \esi@titulo\par}

    \vspace*{\stretch{2}}
    {\large \esi@autor\par}

    \vspace*{\stretch{4}}
  \end{center}

  \vfill
  \hfill
  {\large \textbf{\esi@mes, \esi@anio}}
  \vspace{\stretch{1}}
  \cleardoublepage
}

% Portada interior: añade departamento, tecnología específica y tutores.
\newcommand{\portadainterior}{%
  \thispagestyle{empty}%
  \begin{center}
    \Large \bfseries
    \setstretch{1.3}

    \vspace*{2cm}
    \includegraphics[width=4.1cm]{esi_logo.pdf}

    \vspace{1.2cm}

    UNIVERSIDAD DE CASTILLA-LA MANCHA\\
    ESCUELA SUPERIOR DE INFORMÁTICA

    \esi@si{\esi@departamento}{%
      \vspace{0.4cm}
      {\large Departamento de \esi@departamento\par}}

    \vspace*{\stretch{6}}

    GRADO EN INGENIERÍA INFORMÁTICA

    \esi@si{\esi@intensificacion}{%
      {\normalsize TECNOLOGÍA ESPECÍFICA DE\\
        \MakeUppercase{\esi@intensificacion}\par}}

    \vspace*{\stretch{2}}
    {\large TRABAJO FIN DE GRADO}

    \vspace*{\stretch{4}}
    {\LARGE \esi@titulo\par}
  \end{center}

  \vspace*{\stretch{7}}

  {\large \bfseries
    \esi@si{\esi@autor}{Autor: \esi@autor\par}
    \esi@si{\esi@tutor}{Tutor académico: \esi@tutor\par}
    \esi@si{\esi@cotutor}{Cotutor académico: \esi@cotutor\par}
  }

  \vspace*{\stretch{4}}

  \vfill
  \hfill
  {\large \esi@mes, \esi@anio}
  \clearpage  % los créditos van al dorso
}

% Página de créditos (reverso de la portada interior).
\newcommand{\paginaderechos}{%
  \thispagestyle{empty}
  \begin{singlespace}
    \null \vfill \noindent
    \textbf{\esi@autor} \par
    \smallskip \noindent
    \esi@si{\esi@ciudad}{\esi@ciudad\ -- }España
    \esi@si{\esi@email}{\par\smallskip\noindent
      \emph{E-mail:} \href{mailto:\esi@email}{\nolinkurl{\esi@email}}}
    \par\bigskip\noindent
    \copyright\ \esi@anio\ \ \esi@autor \par
  \end{singlespace}
  \cleardoublepage
}

% Página del tribunal (la rellena el tribunal el día de la defensa).
\newcommand{\tribunal}{%
  \cleardoublepage
  \thispagestyle{empty}
  \vspace*{2cm}
  \noindent\underline{\textbf{{\Large TRIBUNAL:}}}
  \vspace{1.3cm}
  \par
  \textbf{{\large Presidente:}} \par
  \vspace{.5cm}
  \textbf{{\large Vocal:}}      \par
  \vspace{.5cm}
  \textbf{{\large Secretario:}} \par
  \vspace{2.5cm}
  \noindent\underline{\textbf{{\Large FECHA DE DEFENSA:}}} \par
  \vspace{2.2cm}
  \noindent\underline{\textbf{{\Large CALIFICACIÓN:}}} \par
  \vspace{3.6cm}
  \noindent\textbf{PRESIDENTE \hfil\hspace{0.5cm} VOCAL \hfil\hspace{1.2cm} SECRETARIO} \par
  \vspace{3.1cm}
  \noindent Fdo.: \hfil Fdo.: \hfil Fdo.: \par
  \cleardoublepage
}

% Dedicatoria opcional: \dedicatoria{A mi familia}
\newcommand{\dedicatoria}[1]{%
  \cleardoublepage
  \thispagestyle{empty}
  \null\vspace{\stretch{1}}
  \begin{flushright}
    \textit{#1}
  \end{flushright}
  \vspace{\stretch{2}}\null
  \cleardoublepage
}

% Línea «Palabras clave: …» para el resumen (no imprime nada si está vacía).
\newcommand{\mostrarPalabrasClave}{%
  \esi@si{\esi@palabras}{\par\medskip\noindent
    \textbf{\ifesi@ingles Keywords\else Palabras clave\fi:} \esi@palabras\par}}

% \appendix añade la página separadora «ANEXOS».
\let\esi@appendix\appendix
\renewcommand{\appendix}{%
  \cleardoublepage
  \esi@appendix
  \thispagestyle{backstyle}%
  \vspace*{5cm}%
  \begin{center}%
    \sffamily\Large\scalebox{3}{\esi@anexosname}%
  \end{center}%
  \cleardoublepage
}

% Atribución a la clase original (se añade al final del documento).
\newcommand{\paginaatribucion}{%
  \cleardoublepage
  \thispagestyle{empty}%
  \null\vfill
  \begin{singlespace}
  \begin{center}
    \small
    Este documento fue editado y tipografiado con \LaTeX{} empleando\\
    una clase derivada de \textbf{esi-tfg} (grupo ARCO, UCLM), disponible en:\\
    \url{https://github.com/UCLM-ESI/esi-tfg}
  \end{center}
  \end{singlespace}
}
\AtEndDocument{\paginaatribucion}

%% -- Comandos útiles ---------------------------------------------------------
% \todo{texto}: nota pendiente, visible en rojo en el PDF.
\providecommand{\todo}[1]{{\color{red}\textbf{[TODO:} #1\textbf{]}}}

%% -- APLICAR \idioma, \formato Y LOS DATOS -----------------------------------
% datos.tex se lee después de \documentclass, así que estos ajustes se
% aplican al final del preámbulo (justo antes de \begin{document}).
\AddToHook{begindocument/before}{%
  \ifesi@pantalla
    % Una cara, márgenes simétricos, sin páginas en blanco, enlaces en color.
    \geometry{twoside=false, left=25mm, right=25mm}%
    \@twosidefalse\@mparswitchfalse\@openrightfalse
    \hypersetup{linkcolor=esienlace, citecolor=esienlace, urlcolor=esienlace}%
  \fi
  \hypersetup{
    pdftitle    = {\esi@titulo},
    pdfauthor   = {\esi@autor},
    pdfsubject  = {Trabajo Fin de Grado},
    pdfkeywords = {\esi@palabras},
  }%
}
\AddToHook{begindocument/end}{%
  \ifesi@ingles\selectlanguage{english}\fi
  \bibliographystyle{\esi@bibestilo}%
}

\endinput
