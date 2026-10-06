% -*- coding: utf-8 -*-

% memoria.cls (antes esi-tfg.cls)
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
%  - Vive en estilo/ y se carga con \documentclass{estilo/memoria}.
%  - Paquetes con \RequirePackage; eliminados los obsoletos o innecesarios
%    (epsfig, atbeginend, lettrine, tipa, inputenc, hyphenat, xifthen,
%    ifmtarg, pifont, relsize) y la licencia GFDL por defecto.
%  - babel (español, o inglés con \idioma{ingles}) se carga en la clase.
%  - Datos del trabajo con comandos en español (\titulo, \autor, \tutor…);
%    los opcionales pueden quedar vacíos u omitirse.
%  - \formato{impresion|pantalla}: doble cara y enlaces negros, o una cara,
%    márgenes simétricos y enlaces en color.
%  - Fuentes: newtx (Times) en lugar de ptm; Latin Modern Sans; Bera Mono.
%  - Portadas con el aspecto de la original (logo, universidad, escuela,
%    titulación, título, autor, tutor y fecha); separador de anexos
%    integrado en \appendix; corregido el cotutor (no se mostraba).
%  - Eliminados comandos de ejemplo no usados (\drop, \FIXME, \acx…).
%  - (v3) Clase genérica «memoria»: lo propio de cada institución (universidad,
%    escuela, logo, tipo de trabajo, titulación, tamaño de letra, márgenes e
%    interlineado) se lee de estilo/institucion.tex antes de cargar «book»;
%    estilo/portada.tex, si existe, sustituye a la portada generada.
%    Portadas en español o en inglés (\idiomaPortadas).
%  - (v3) Bibliografía con biblatex + biber (estilos ieee, apa, numeric,
%    authoryear y alphabetic; los nombres BibTeX antiguos se aceptan) y
%    csquotes; \bibliography{…} sigue funcionando.
%  - (v3) \keywords para el Abstract; \mostrarPalabrasClave según el idioma
%    activo. \indices omite los índices de figuras, tablas o listados vacíos.
%  - (v3) \modo{borrador|final} (marca «BORRADOR» y \todo; en final un \todo
%    es un error), \licencia{…} en los créditos y \atribucion{si|no}.
%  - (v3) Fechas «junio de 2026»; microtype; hyperref al final; cabecera de
%    \formato{pantalla} con capítulo y sección; sin \parskip; más caracteres
%    acentuados en los listados de código.
%
% Los comandos públicos están documentados en LEEME.md.
% ----------------------------------------------------------------------------

\NeedsTeXFormat{LaTeX2e}[2022/06/01]
\ProvidesClass{estilo/memoria}[2026/10/06 v3.0 Memoria de TFG/TFM (derivada de esi-tfg de ARCO)]
\RequirePackage{etoolbox}

%% -- UTILIDADES (expl3) ------------------------------------------------------
\ExplSyntaxOn
% \mem@validar{\comando}{valor}{lista}: error si el valor no está en la lista.
\cs_new_protected:Npn \mem@validar #1#2#3
  {
    \bool_set_false:N \l_tmpa_bool
    \clist_map_inline:nn {#3} { \str_if_eq:nnT {##1} {#2} { \bool_set_true:N \l_tmpa_bool } }
    \bool_if:NF \l_tmpa_bool
      {
        \ClassError {memoria}
          { Valor~no~válido~en~\token_to_str:N #1:~«#2» }
          { Valores~posibles:~#3. }
      }
  }
% \mem@guardar{macro}{\comando}{valor}{lista}: quita espacios, valida y guarda.
% Un valor vacío deja el valor por defecto.
\cs_new_protected:Npn \mem@guardar #1#2#3#4
  {
    \tl_set:Ne \l_tmpa_tl {#3}
    \tl_trim_spaces:N \l_tmpa_tl
    \tl_if_empty:NF \l_tmpa_tl
      {
        \exp_args:NNV \mem@validar #2 \l_tmpa_tl {#4}
        \tl_set_eq:cN { mem@#1 } \l_tmpa_tl
      }
  }
% \mem@leerdato{archivo}{comando}{\macro}: argumento de la primera línea no
% comentada del archivo que empieza por \comando{…} (vacío si no hay). Sirve
% para conocer, al cargar la clase, datos que datos.tex fija más tarde.
\ior_new:N \g__mem_ior
\cs_new_protected:Npn \mem@leerdato #1#2#3
  {
    \tl_clear:N #3
    \file_if_exist:nT {#1}
      {
        \ior_open:Nn \g__mem_ior {#1}
        \ior_str_map_inline:Nn \g__mem_ior
          {
            \regex_extract_once:nnNT { \A \s* \\ #2 \s* \{ \s* ([^\}]*?) \s* \} } {##1} \l_tmpa_seq
              {
                \tl_set_rescan:Nne #3 { } { \seq_item:Nn \l_tmpa_seq {2} }
                \ior_map_break:
              }
          }
        \ior_close:N \g__mem_ior
      }
  }
% Archivos .bib de las líneas \bibliography{…} no comentadas del archivo #1.
\seq_new:N \g_mem_bibs_seq
\cs_new_protected:Npn \mem@buscarbibs #1
  {
    \file_if_exist:nT {#1}
      {
        \ior_open:Nn \g__mem_ior {#1}
        \ior_str_map_inline:Nn \g__mem_ior
          {
            \regex_extract_once:nnNT { \A [^\%]*? \\bibliography \s* \{ ([^\}]*) \} } {##1} \l_tmpa_seq
              {
                \clist_set:Ne \l_tmpa_clist { \seq_item:Nn \l_tmpa_seq {2} }
                \clist_map_inline:Nn \l_tmpa_clist
                  {
                    \tl_set:Ne \l_tmpb_tl { ####1 }
                    \regex_match:nVF { \.bib \Z } \l_tmpb_tl { \tl_put_right:Nn \l_tmpb_tl { .bib } }
                    \seq_if_in:NVF \g_mem_bibs_seq \l_tmpb_tl
                      { \seq_gput_right:NV \g_mem_bibs_seq \l_tmpb_tl }
                  }
              }
          }
        \ior_close:N \g__mem_ior
      }
  }
% \mem@mes{texto}: reconoce el mes (en español o inglés, sin importar
% mayúsculas) y guarda su número en \mem@mesnum; si no, el texto tal cual.
\cs_new_protected:Npn \mem@mes #1
  {
    \tl_set:Ne \l_tmpa_tl { \text_lowercase:n { \tl_trim_spaces:n {#1} } }
    \tl_set:Ne \mem@mesnum
      {
        \str_case_e:nnF { \l_tmpa_tl }
          {
            {enero}{1} {febrero}{2} {marzo}{3} {abril}{4} {mayo}{5} {junio}{6}
            {julio}{7} {agosto}{8} {septiembre}{9} {setiembre}{9} {octubre}{10}
            {noviembre}{11} {diciembre}{12}
            {january}{1} {february}{2} {march}{3} {april}{4} {may}{5} {june}{6}
            {july}{7} {august}{8} {september}{9} {october}{10} {november}{11}
            {december}{12}
          }
          { }
      }
    \tl_set:Nn \mem@mestexto {#1}
  }
% ¿La etiqueta de especialidad (macro #1) ya acaba en «de», «en», «del» o «:»?
\cs_new_protected:Npn \mem@siacabaenconector #1#2#3
  { \regex_match:nVTF { (?i) (\s(de|en|del)|\:) \Z } #1 {#2} {#3} }
% \mem@recortar\macro{texto}: guarda el texto sin espacios alrededor.
\cs_new_protected:Npn \mem@recortar #1#2 { \tl_set:Nn #1 {#2} \tl_trim_spaces:N #1 }
% Nombres de estilos de BibTeX traducidos a los de biblatex.
\cs_new:Npn \mem@estilobib #1
  { \str_case_e:nnF {#1} { {ieeetr}{ieee} {plain}{numeric} {alpha}{alphabetic} {apalike}{apa} } {#1} }
\ExplSyntaxOff

% Ejecuta #2 solo si la macro #1 no está vacía (ni solo con espacios).
\newcommand{\mem@si}[2]{\expandafter\ifblank\expandafter{#1}{}{#2}}

%% -- DATOS DE LA INSTITUCIÓN (estilo/institucion.tex) ------------------------
% Se leen antes de cargar «book» para poder fijar el tamaño de letra. Valores
% por defecto: los del perfil genérico.
\newcommand*{\mem@universidad}{}
\newcommand*{\mem@escuela}{}
\newcommand*{\mem@logo}{}
\newcommand*{\mem@tipo}{tfg}
\newcommand*{\mem@nombretrabajo}{}
\newcommand*{\mem@titulacion}{}
\newcommand*{\mem@etiquetaesp}{}
\newcommand*{\mem@idiomaportadas}{documento}
\newcommand*{\mem@tamano}{12pt}
\newcommand*{\mem@margenint}{30mm}
\newcommand*{\mem@margenext}{25mm}
\newcommand*{\mem@margensup}{25mm}
\newcommand*{\mem@margeninf}{25mm}
\newcommand*{\mem@interlineado}{1.5}

\newcommand{\universidad}[1]{\renewcommand*{\mem@universidad}{#1}}
\newcommand{\escuela}[1]{\renewcommand*{\mem@escuela}{#1}}
\newcommand{\logo}[1]{\mem@recortar\mem@logo{#1}}
\newcommand{\tipoTrabajo}[1]{\mem@guardar{tipo}{\tipoTrabajo}{#1}{tfg,tfm,tesis,otro}}
\newcommand{\nombreTrabajo}[1]{\renewcommand*{\mem@nombretrabajo}{#1}}
\newcommand{\titulacion}[1]{\renewcommand*{\mem@titulacion}{#1}}
\newcommand{\etiquetaEspecialidad}[1]{\renewcommand*{\mem@etiquetaesp}{#1}}
\newcommand{\idiomaPortadas}[1]{%
  \mem@guardar{idiomaportadas}{\idiomaPortadas}{#1}{espanol,ingles,documento}}
\newcommand{\tamanoLetra}[1]{\mem@guardar{tamano}{\tamanoLetra}{#1}{10pt,11pt,12pt}}
\newcommand{\margenes}[4]{%
  \ifblank{#1}{}{\renewcommand*{\mem@margenint}{#1}}%
  \ifblank{#2}{}{\renewcommand*{\mem@margenext}{#2}}%
  \ifblank{#3}{}{\renewcommand*{\mem@margensup}{#3}}%
  \ifblank{#4}{}{\renewcommand*{\mem@margeninf}{#4}}}
\newcommand{\interlineado}[1]{%
  \mem@guardar{interlineado}{\interlineado}{#1}{1,1.15,1.25,1.5,2}}

\InputIfFileExists{estilo/institucion.tex}{}{}

%% -- CLASE BASE --------------------------------------------------------------
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{book}}
\ProcessOptions\relax
% Doble cara por defecto; \formato{pantalla} lo cambia al final del preámbulo.
\edef\mem@cargar{\noexpand\LoadClass[a4paper, \mem@tamano, twoside, openright]{book}}
\mem@cargar

%% -- DATOS DEL TRABAJO (se rellenan en datos.tex) ----------------------------
\newcommand*{\mem@titulo}{}
\newcommand*{\mem@autor}{}
\newcommand*{\mem@email}{}
\newcommand*{\mem@tutor}{}
\newcommand*{\mem@cotutor}{}
\newcommand*{\mem@departamento}{}
\newcommand*{\mem@intensificacion}{}
\newcommand*{\mem@ciudad}{}
\newcommand*{\mem@palabras}{}
\newcommand*{\mem@keywords}{}
\newcommand*{\mem@idioma}{espanol}
\newcommand*{\mem@formato}{impresion}
\newcommand*{\mem@modo}{borrador}
\newcommand*{\mem@licencia}{reservados}
\newcommand*{\mem@atribucion}{si}
\newcommand*{\mem@bibestilo}{ieee}
% Fecha por defecto: mes y año de la compilación.
\edef\mem@mesnum{\the\month}
\newcommand*{\mem@mestexto}{}
\edef\mem@anio{\the\year}

\newcommand{\titulo}[1]{\renewcommand*{\mem@titulo}{#1}}
\newcommand{\autor}[1]{\renewcommand*{\mem@autor}{#1}}
\newcommand{\email}[1]{\renewcommand*{\mem@email}{#1}}
\newcommand{\tutor}[1]{\renewcommand*{\mem@tutor}{#1}}
\newcommand{\cotutor}[1]{\renewcommand*{\mem@cotutor}{#1}}
\newcommand{\departamento}[1]{\renewcommand*{\mem@departamento}{#1}}
\newcommand{\intensificacion}[1]{\renewcommand*{\mem@intensificacion}{#1}}
\newcommand{\ciudad}[1]{\renewcommand*{\mem@ciudad}{#1}}
\newcommand{\palabrasClave}[1]{\renewcommand*{\mem@palabras}{#1}}
\newcommand{\keywords}[1]{\renewcommand*{\mem@keywords}{#1}}
\newcommand{\fecha}[2]{%
  \ifblank{#1}{}{\mem@mes{#1}}%
  \ifblank{#2}{}{\mem@recortar\mem@anio{#2}}}
\newcommand{\idioma}[1]{\mem@guardar{idioma}{\idioma}{#1}{espanol,ingles}}
\newcommand{\formato}[1]{\mem@guardar{formato}{\formato}{#1}{impresion,pantalla}}
\newcommand{\modo}[1]{\mem@guardar{modo}{\modo}{#1}{borrador,final}}
\newcommand{\licencia}[1]{%
  \mem@guardar{licencia}{\licencia}{#1}{reservados,cc-by,cc-by-sa,cc-by-nc-sa,ninguna}}
\newcommand{\atribucion}[1]{\mem@guardar{atribucion}{\atribucion}{#1}{si,no}}
\newcommand{\estiloBibliografia}[1]{%
  \mem@guardar{bibpedido}{\estiloBibliografia}{#1}%
    {ieee,apa,numeric,authoryear,alphabetic,ieeetr,plain,alpha,apalike}%
  \edef\mem@bibestilo{\mem@estilobib{\mem@bibpedido}}}
\newcommand*{\mem@bibpedido}{ieee}

% Acceso a los datos desde estilo/portada.tex: \dato{titulo}, \dato{autor},
% \dato{universidad}, \dato{fecha}…
\newcommand{\dato}[1]{\csuse{mem@#1}}

% El idioma y el estilo de bibliografía hacen falta al cargar babel y
% biblatex, antes de que tfg.tex lea datos.tex: se adelantan leyéndolos de ahí.
\mem@leerdato{datos.tex}{idioma}\mem@tmp
\ifdefempty\mem@tmp{}{\idioma{\mem@tmp}}
\mem@leerdato{datos.tex}{estiloBibliografia}\mem@tmp
\ifdefempty\mem@tmp{}{\estiloBibliografia{\mem@tmp}}
\let\mem@bibcargado\mem@bibestilo

\newif\ifmem@ingles
\newif\ifmem@pantalla
\newif\ifmem@final
\newif\ifmem@portadasingles
\newcommand{\mem@aplicarbanderas}{%
  \ifdefstring{\mem@idioma}{ingles}{\mem@inglestrue}{\mem@inglesfalse}%
  \ifdefstring{\mem@formato}{pantalla}{\mem@pantallatrue}{\mem@pantallafalse}%
  \ifdefstring{\mem@modo}{final}{\mem@finaltrue}{\mem@finalfalse}%
  \ifdefstring{\mem@idiomaportadas}{ingles}{\mem@portadasinglestrue}{%
    \ifdefstring{\mem@idiomaportadas}{espanol}{\mem@portadasinglesfalse}{%
      \ifmem@ingles\mem@portadasinglestrue\else\mem@portadasinglesfalse\fi}}}
\mem@aplicarbanderas

%% -- IDIOMA Y FUENTES --------------------------------------------------------
\RequirePackage[T1]{fontenc}
\ifmem@ingles\PassOptionsToPackage{main=english}{babel}\fi
\RequirePackage[english, spanish, es-noshorthands, es-tabla, es-nodecimaldot]{babel}

\RequirePackage{newtxtext}             % Times
\RequirePackage{newtxmath}
\renewcommand{\sfdefault}{lmss}        % Latin Modern Sans
\RequirePackage[scaled=.82]{beramono}  % Bera Mono para código
\RequirePackage{microtype}

\newcommand*{\mem@anexosname}{ANEXOS}
\addto\captionsspanish{%
  \renewcommand{\appendixname}{Anexo}%
  \renewcommand{\lstlistingname}{Listado}%
  \renewcommand{\lstlistlistingname}{Índice de listados}%
  \renewcommand{\mem@anexosname}{ANEXOS}}
\addto\captionsenglish{%
  \renewcommand{\appendixname}{Appendix}%
  \renewcommand{\lstlistingname}{Listing}%
  \renewcommand{\lstlistlistingname}{List of Listings}%
  \renewcommand{\mem@anexosname}{APPENDICES}}

% Las normas tipográficas que aparecen en los comentarios corresponden al libro:
% J. Martínez de Sousa. Ortografía y ortotipografía del español actual. Trea, 2008.

%% -- MEDIDAS Y DISTANCIAS ----------------------------------------------------
\RequirePackage{geometry}
\geometry{left=\mem@margenint, right=\mem@margenext,
          top=\mem@margensup, bottom=\mem@margeninf}
\RequirePackage{setspace}
\raggedbottom

% Interlineado del cuerpo (\interlineado): 1, 1.5 y 2 son los de setspace;
% 1.15 y 1.25 se interpolan entre sencillo y 1,5.
\newcommand{\mem@aplicarinterlineado}{%
  \ifdefstring{\mem@interlineado}{1}{\singlespacing}{%
  \ifdefstring{\mem@interlineado}{2}{\doublespacing}{%
  \onehalfspacing
  \ifdefstring{\mem@interlineado}{1.5}{}{%
    \edef\mem@tmp{\fpeval{1 + (\baselinestretch - 1) * (\mem@interlineado - 1) / 0.5}}%
    \setstretch{\mem@tmp}}}}}

%% Párrafos
% La indentación que precede al párrafo normal debe ser de un
% cuadratín (1em) (-> 13.4.1.1)
\setlength{\parindent}{1em}

% El espacio en blanco al final de una línea corta debe ser mayor que
% la indentación del párrafo. (-> 13.4.1.1)
\setlength{\parfillskip}{1.5em plus 1fil}

\RequirePackage[inline]{enumitem}
\setlist{topsep=3pt, itemsep=1pt}

%% -- GRÁFICOS Y COLORES ------------------------------------------------------
% Las figuras deben ser PDF, PNG o JPG. Sin shell escape (Estudio TFG compila
% con -no-shell-escape) epstopdf no puede convertir EPS y solo emitiría un aviso,
% así que se marca como ya cargado.
\expandafter\def\csname ver@epstopdf-base.sty\endcsname{2099/01/01 desactivado por memoria}
\RequirePackage{graphicx}
\graphicspath{{figuras/}{estilo/}}

\RequirePackage[table]{xcolor}
\definecolor{gray45}{gray}{0.45}
\definecolor{memenlace}{rgb}{0.05, 0.25, 0.55}  % enlaces en \formato{pantalla}

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
  literate           =
    {á}{{\'a}}1 {é}{{\'e}}1 {í}{{\'\i}}1 {ó}{{\'o}}1 {ú}{{\'u}}1
    {Á}{{\'A}}1 {É}{{\'E}}1 {Í}{{\'I}}1 {Ó}{{\'O}}1 {Ú}{{\'U}}1
    {à}{{\`a}}1 {è}{{\`e}}1 {ì}{{\`\i}}1 {ò}{{\`o}}1 {ù}{{\`u}}1
    {À}{{\`A}}1 {È}{{\`E}}1 {Ì}{{\`I}}1 {Ò}{{\`O}}1 {Ù}{{\`U}}1
    {â}{{\^a}}1 {ê}{{\^e}}1 {î}{{\^\i}}1 {ô}{{\^o}}1 {û}{{\^u}}1
    {ä}{{\"a}}1 {ë}{{\"e}}1 {ï}{{\"\i}}1 {ö}{{\"o}}1 {ü}{{\"u}}1
    {Ä}{{\"A}}1 {Ë}{{\"E}}1 {Ï}{{\"I}}1 {Ö}{{\"O}}1 {Ü}{{\"U}}1
    {ã}{{\~a}}1 {õ}{{\~o}}1 {ñ}{{\~n}}1 {Ñ}{{\~N}}1
    {ç}{{\c{c}}}1 {Ç}{{\c{C}}}1
    {¿}{{\textquestiondown}}1 {¡}{{\textexclamdown}}1
    {«}{{\guillemotleft}}1 {»}{{\guillemotright}}1
    {º}{{\textordmasculine}}1 {ª}{{\textordfeminine}}1 {°}{{\textdegree}}1
    {€}{{\texteuro}}1 {·}{{\textperiodcentered}}1
    {–}{{\textendash}}1 {—}{{\textemdash}}1
    {‘}{{\textquoteleft}}1 {’}{{\textquoteright}}1
    {“}{{\textquotedblleft}}1 {”}{{\textquotedblright}}1,
}

%% -- ACRÓNIMOS ---------------------------------------------------------------
% Solo se listan los acrónimos que se usan en el texto con \ac{…}.
\RequirePackage[printonlyused]{acronym}

%% -- ÍNDICES -----------------------------------------------------------------
% Añade figuras, cuadros y listados al índice general (la bibliografía la
% añade biblatex).
\RequirePackage[nottoc, notbib]{tocbibind}
% de tocbibind, para que el índice de listados aparezca en la ToC
\renewcommand{\lstlistoflistings}{%
  \begingroup
  \tocfile{\lstlistlistingname}{lol}%
  \endgroup}

% \indices: índice general y, solo si tienen alguna entrada, los de figuras,
% tablas y listados. Al leer el .aux de la compilación anterior se cuentan
% las líneas \contentsline de cada lista (latexmk repite las pasadas que
% hagan falta); en la primera compilación, sin .aux, se muestran todos.
\newif\ifmem@hayaux
\newcommand{\mem@contar}[1]{%
  \ifcsundef{mem@n@#1}{\csgdef{mem@n@#1}{1}}%
    {\csxdef{mem@n@#1}{\the\numexpr\csuse{mem@n@#1}+1\relax}}}
\def\mem@contarlinea#1#2#3\mem@fin{\ifx\contentsline#2\mem@contar{#1}\fi}
% LaTeX lee el .aux con \@writefile desactivado; la primera línea que escribe
% la clase en el .aux (\mem@contaraux) lo sustituye por uno que cuenta.
\newcommand{\mem@contaraux}{%
  \global\mem@hayauxtrue
  \let\mem@writefile\@writefile
  \def\@writefile##1##2{\mem@contarlinea{##1}##2\relax\mem@fin\mem@writefile{##1}{##2}}}
\AtBeginDocument{%
  \if@filesw
    \immediate\write\@mainaux{\string\providecommand\string\mem@contaraux{}\string\mem@contaraux}%
  \fi}
\newcommand{\mem@silista}[2]{%
  \ifmem@hayaux\ifcsundef{mem@n@#1}{}{#2}\else#2\fi}
\newcommand{\indices}{%
  \tableofcontents
  \mem@silista{lof}{\listoffigures}%
  \mem@silista{lot}{\listoftables}%
  \mem@silista{lol}{\lstlistoflistings}}

%% -- BIBLIOGRAFÍA (biblatex + biber) -----------------------------------------
\RequirePackage[autostyle=true]{csquotes}
\RequirePackage[backend=biber, style=\mem@bibcargado, urldate=long,
  dateabbrev=false]{biblatex}
% Textos en español: «consultado el 1 de junio de 2026», «Disponible en: …».
\DefineBibliographyStrings{spanish}{%
  bibliography = {Referencias},
  references   = {Referencias},
  urlseen      = {consultado el},
  url          = {Disponible en},
}
\ifdefstring{\mem@bibcargado}{apa}{%
  \DefineBibliographyStrings{spanish}{%
    retrieved = {Consultado el},
    from      = {en},
  }}{}
\DefineBibliographyStrings{english}{%
  bibliography = {References},
  references   = {References},
}
% Archivos .bib: los de \bibliography{…} en el documento principal o, si no
% hay ninguno, bibliografia.bib. No hace falta \addbibresource.
\ExplSyntaxOn
\mem@buscarbibs { \c_sys_jobname_str .tex }
\seq_if_empty:NT \g_mem_bibs_seq
  { \file_if_exist:nT { bibliografia.bib } { \seq_gput_right:Nn \g_mem_bibs_seq { bibliografia.bib } } }
\seq_map_inline:Nn \g_mem_bibs_seq { \file_if_exist:nT {#1} { \addbibresource {#1} } }
\ExplSyntaxOff

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
  \mem@aplicarinterlineado
  \pagestyle{mainstyle}%
  \mainchapterformat
}

% espaciado entre secciones, subseciones, etc.
% doc: \titlespacing*{ command }{ left }{ beforesep }{ aftersep }[ right ]
\titlespacing{\section}{0pt}{5mm}{0mm}
\titlespacing{\subsection}{0pt}{4mm}{-1mm}
\titlespacing{\subsubsection}{0pt}{4mm}{-1mm}

%% -- ESTILO DE PÁGINA, ENCABEZADOS Y PIES ------------------------------------
% Doble cara: capítulo en las páginas pares y sección en las impares. Con
% \formato{pantalla} (una cara) se redefine para mostrar los dos.
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

%% -- HIPER-ENLACES PARA PDF --------------------------------------------------
% hyperref se carga después del resto de paquetes.
\RequirePackage[
  bookmarks,
  hyperfootnotes = false,
  colorlinks,
  linkcolor      = black,
  citecolor      = black,
  urlcolor       = black,
  ]{hyperref}
\pdfstringdefDisableCommands{\def\\{ }\def\newline{ }}

%% -- TEXTOS DE LAS PORTADAS --------------------------------------------------
% \mem@cad{español}{inglés}, según el idioma de las portadas;
% \mem@defcad\macro{español}{inglés} guarda el que toque en \macro.
\newcommand{\mem@cad}[2]{\ifmem@portadasingles#2\else#1\fi}
\newcommand{\mem@defcad}[3]{\ifmem@portadasingles\def#1{#3}\else\def#1{#2}\fi}

\newcommand{\mem@mes@es}[1]{\ifcase#1\or enero\or febrero\or marzo\or abril\or
  mayo\or junio\or julio\or agosto\or septiembre\or octubre\or noviembre\or
  diciembre\fi}
\newcommand{\mem@mes@en}[1]{\ifcase#1\or January\or February\or March\or April\or
  May\or June\or July\or August\or September\or October\or November\or
  December\fi}

% Se calculan al empezar el documento, con datos.tex ya leído.
\newcommand{\mem@calculartextos}{%
  % Fecha: «junio de 2026» o «June 2026».
  \ifdefempty{\mem@mesnum}%
    {\protected@edef\mem@fecha{\mem@mestexto\mem@cad{ de }{ }\mem@anio}}%
    {\protected@edef\mem@fecha{\mem@cad{\mem@mes@es{\mem@mesnum} de }%
                                       {\mem@mes@en{\mem@mesnum}\space}\mem@anio}}%
  % Nombre del tipo de trabajo.
  \let\mem@tiponombre\mem@nombretrabajo
  \ifdefempty{\mem@nombretrabajo}{%
    \ifdefstring{\mem@tipo}{tfg}{\mem@defcad\mem@tiponombre{Trabajo Fin de Grado}{Bachelor's Thesis}}{}%
    \ifdefstring{\mem@tipo}{tfm}{\mem@defcad\mem@tiponombre{Trabajo Fin de Máster}{Master's Thesis}}{}%
    \ifdefstring{\mem@tipo}{tesis}{\mem@defcad\mem@tiponombre{Tesis Doctoral}{Doctoral Thesis}}{}%
  }{}%
  % Especialidad: «TECNOLOGÍA ESPECÍFICA DE» + intensificación.
  \let\mem@esptexto\mem@etiquetaesp
  \ifmem@portadasingles\else
    \mem@siacabaenconector\mem@etiquetaesp{}%
      {\protected@edef\mem@esptexto{\mem@etiquetaesp\space de}}%
  \fi
  \ifdefstring{\mem@tipo}{tesis}%
    {\mem@defcad\mem@tutortexto{Director}{Supervisor}%
     \mem@defcad\mem@cotutortexto{Codirector}{Co-supervisor}}%
    {\mem@defcad\mem@tutortexto{Tutor académico}{Supervisor}%
     \mem@defcad\mem@cotutortexto{Cotutor académico}{Co-supervisor}}%
}
% \dato{fecha} y \dato{tipo} dan los textos calculados.
\newcommand*{\mem@fecha}{}
\newcommand*{\mem@tiponombre}{}

% Logo de la institución (si existe el archivo).
\newcommand{\mem@silogo}[1]{%
  \mem@si{\mem@logo}{%
    \IfFileExists{estilo/\mem@logo}{#1}{%
      \ClassWarning{memoria}{No se encuentra el logo estilo/\mem@logo}}}}
\newcommand{\mem@logoimagen}{%
  \includegraphics[width=4.1cm, height=3.5cm, keepaspectratio]{estilo/\mem@logo}}

%% -- PÁGINAS ESPECIALES ------------------------------------------------------
% Portada exterior. Si existe estilo/portada.tex, se usa en su lugar.
\newcommand{\portada}{%
  \IfFileExists{estilo/portada.tex}{\input{estilo/portada.tex}}{\mem@portada}}
\newcommand{\mem@portada}{%
  \thispagestyle{empty}%
  \begin{center}
    \Large \bfseries
    \setstretch{1.3}

    \vspace*{\stretch{6}}
    \mem@silogo{\mem@logoimagen\par\vspace*{\stretch{6}}}%
    \mem@si{\mem@universidad}{\MakeUppercase{\mem@universidad}\par\vspace*{\stretch{1}}}%
    \mem@si{\mem@escuela}{\MakeUppercase{\mem@escuela}\par\vspace*{\stretch{2}}}%
    \mem@si{\mem@titulacion}{\MakeUppercase{\mem@titulacion}\par\vspace*{\stretch{2}}}%
    \mem@si{\mem@tiponombre}{{\large \MakeUppercase{\mem@tiponombre}\par}\vspace*{\stretch{4}}}%
    {\LARGE \mem@titulo\par}

    \vspace*{\stretch{2}}
    {\large \mem@autor\par}

    \vspace*{\stretch{4}}
  \end{center}

  \vfill
  \hfill
  {\large \textbf{\mem@fecha}}
  \vspace{\stretch{1}}
  \cleardoublepage
}

% Portada interior: añade departamento, especialidad y tutores.
\newcommand{\portadainterior}{%
  \thispagestyle{empty}%
  \begin{center}
    \Large \bfseries
    \setstretch{1.3}

    \vspace*{2cm}
    \mem@silogo{\mem@logoimagen\par\vspace{1.2cm}}%
    \mem@si{\mem@universidad}{\MakeUppercase{\mem@universidad}\par}%
    \mem@si{\mem@escuela}{\MakeUppercase{\mem@escuela}\par}%
    \mem@si{\mem@departamento}{%
      \vspace{0.4cm}
      {\large \mem@cad{Departamento de}{Department of} \mem@departamento\par}}

    \vspace*{\stretch{6}}

    \mem@si{\mem@titulacion}{\MakeUppercase{\mem@titulacion}\par}%
    \mem@si{\mem@etiquetaesp}{\mem@si{\mem@intensificacion}{%
      {\normalsize \MakeUppercase{\mem@esptexto}\\
        \MakeUppercase{\mem@intensificacion}\par}}}%

    \vspace*{\stretch{2}}
    \mem@si{\mem@tiponombre}{{\large \MakeUppercase{\mem@tiponombre}\par}}%

    \vspace*{\stretch{4}}
    {\LARGE \mem@titulo\par}
  \end{center}

  \vspace*{\stretch{7}}

  {\large \bfseries
    \mem@si{\mem@autor}{\mem@cad{Autor}{Author}: \mem@autor\par}
    \mem@si{\mem@tutor}{\mem@tutortexto: \mem@tutor\par}
    \mem@si{\mem@cotutor}{\mem@cotutortexto: \mem@cotutor\par}
  }

  \vspace*{\stretch{4}}

  \vfill
  \hfill
  {\large \mem@fecha}
  \clearpage  % los créditos van al dorso
}

% Texto de la licencia (\licencia) para la página de créditos.
\newcommand{\mem@cc}[3]{% #1 nombre es, #2 nombre en, #3 código (by, by-sa…)
  \mem@cad{Esta obra se distribuye con una licencia Creative Commons #1.}%
          {This work is licensed under a Creative Commons #2 licence.}%
  \par\smallskip\noindent
  \edef\mem@tmp{https://creativecommons.org/licenses/#3/4.0/\mem@cad{deed.es}{}}%
  \expandafter\url\expandafter{\mem@tmp}}
\newcommand{\mem@textolicencia}{%
  \ifdefstring{\mem@licencia}{ninguna}{}{%
    \par\bigskip\noindent
    \copyright\ \mem@anio\ \ \mem@autor
    \ifdefstring{\mem@licencia}{reservados}%
      {. \mem@cad{Todos los derechos reservados.}{All rights reserved.}\par}{%
      \par\smallskip\noindent
      \ifdefstring{\mem@licencia}{cc-by}%
        {\mem@cc{Atribución 4.0 Internacional (CC~BY~4.0)}%
                {Attribution 4.0 International (CC~BY~4.0)}{by}}{}%
      \ifdefstring{\mem@licencia}{cc-by-sa}%
        {\mem@cc{Atribución-CompartirIgual 4.0 Internacional (CC~BY-SA~4.0)}%
                {Attribution-ShareAlike 4.0 International (CC~BY-SA~4.0)}{by-sa}}{}%
      \ifdefstring{\mem@licencia}{cc-by-nc-sa}%
        {\mem@cc{Atribución-NoComercial-CompartirIgual 4.0 Internacional (CC~BY-NC-SA~4.0)}%
                {Attribution-NonCommercial-ShareAlike 4.0 International (CC~BY-NC-SA~4.0)}{by-nc-sa}}{}%
      \par}}}

% Página de créditos (reverso de la portada interior).
\newcommand{\paginaderechos}{%
  \thispagestyle{empty}
  \begin{singlespace}
    \raggedright
    \null \vfill \noindent
    \textbf{\mem@autor} \par
    \mem@si{\mem@ciudad}{\smallskip\noindent \mem@ciudad\par}%
    \mem@si{\mem@email}{\smallskip\noindent
      \emph{E-mail:} \href{mailto:\mem@email}{\nolinkurl{\mem@email}}\par}%
    \mem@textolicencia
  \end{singlespace}
  \cleardoublepage
}

% Página del tribunal (la rellena el tribunal el día de la defensa).
\newcommand{\tribunal}{%
  \cleardoublepage
  \thispagestyle{empty}
  \vspace*{2cm}
  \noindent\underline{\textbf{{\Large \mem@cad{TRIBUNAL}{EXAMINATION BOARD}:}}}
  \vspace{1.3cm}
  \par
  \textbf{{\large \mem@cad{Presidente}{Chair}:}} \par
  \vspace{.5cm}
  \textbf{{\large \mem@cad{Vocal}{Member}:}}      \par
  \vspace{.5cm}
  \textbf{{\large \mem@cad{Secretario}{Secretary}:}} \par
  \vspace{2.5cm}
  \noindent\underline{\textbf{{\Large \mem@cad{FECHA DE DEFENSA}{DEFENCE DATE}:}}} \par
  \vspace{2.2cm}
  \noindent\underline{\textbf{{\Large \mem@cad{CALIFICACIÓN}{GRADE}:}}} \par
  \vspace{3.6cm}
  \noindent\textbf{\mem@cad{PRESIDENTE}{CHAIR} \hfil\hspace{0.5cm}
    \mem@cad{VOCAL}{MEMBER} \hfil\hspace{1.2cm} \mem@cad{SECRETARIO}{SECRETARY}} \par
  \vspace{3.1cm}
  \noindent \mem@cad{Fdo.}{Signed}: \hfil \mem@cad{Fdo.}{Signed}: \hfil \mem@cad{Fdo.}{Signed}: \par
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

% Línea «Palabras clave: …» (o «Keywords: …» si el idioma activo es el
% inglés, p. ej. dentro del Abstract). No imprime nada si está vacía.
\newcommand{\mem@lineaclave}[2]{%
  \mem@si{#2}{\par\medskip\noindent\textbf{#1:} #2\par}}
\newcommand{\mostrarPalabrasClave}{%
  \iflanguage{english}%
    {\mem@lineaclave{Keywords}{\mem@keywords}}%
    {\mem@lineaclave{Palabras clave}{\mem@palabras}}}

% \appendix añade la página separadora «ANEXOS».
\let\mem@appendix\appendix
\renewcommand{\appendix}{%
  \cleardoublepage
  \mem@appendix
  \thispagestyle{backstyle}%
  \vspace*{5cm}%
  \begin{center}%
    \sffamily\Large\scalebox{3}{\mem@anexosname}%
  \end{center}%
  \cleardoublepage
}

% Atribución a la clase original (al final del documento; \atribucion{no} la quita).
\newcommand{\paginaatribucion}{%
  \cleardoublepage
  \thispagestyle{empty}%
  \null\vfill
  \begin{singlespace}
  \begin{center}
    \small
    \ifmem@ingles
      This document was typeset with \LaTeX{} using a class\\
      derived from \textbf{esi-tfg} (ARCO group, UCLM), available at:\\
    \else
      Este documento fue editado y tipografiado con \LaTeX{} empleando\\
      una clase derivada de \textbf{esi-tfg} (grupo ARCO, UCLM), disponible en:\\
    \fi
    \url{https://github.com/UCLM-ESI/esi-tfg}
  \end{center}
  \end{singlespace}
}
\AtEndDocument{\ifdefstring{\mem@atribucion}{no}{}{\paginaatribucion}}

%% -- MODO BORRADOR / FINAL ---------------------------------------------------
% \todo{texto}: en borrador, nota en rojo; en \modo{final}, un error que
% impide dar la memoria por terminada.
\newcommand{\todo}[1]{%
  \ifmem@final
    \ClassError{memoria}{Queda una nota \string\todo\space en modo final:
      \detokenize{#1}}{Resuelve la nota y borra el \string\todo, o vuelve a
      \string\modo{borrador} en datos.tex.}%
  \else
    {\color{red}\textbf{[TODO:} #1\textbf{]}}%
  \fi}

% Marca discreta al pie de cada página en modo borrador.
\newcommand{\mem@marcaborrador}{%
  \put(\paperwidth/2, -\paperheight + 8mm){%
    \makebox(0,0){\fontsize{7}{8}\selectfont\sffamily\color{gray}%
      \ifmem@ingles DRAFT\else BORRADOR\fi\ \textperiodcentered\ \today}}}

%% -- APLICAR \idioma, \formato Y LOS DATOS -----------------------------------
% datos.tex se lee después de \documentclass, así que estos ajustes se
% aplican al final del preámbulo (justo antes de \begin{document}).
\AddToHook{begindocument/before}{%
  \mem@aplicarbanderas
  \ifdefequal{\mem@bibestilo}{\mem@bibcargado}{}{%
    \ClassWarning{memoria}{\string\estiloBibliografia\space solo tiene efecto
      en datos.tex; se usa el estilo \mem@bibcargado}}%
  \ifmem@pantalla
    % Una cara, márgenes simétricos, sin páginas en blanco, enlaces en color.
    \geometry{twoside=false,
      left=\dimexpr(\mem@margenint+\mem@margenext)/2\relax,
      right=\dimexpr(\mem@margenint+\mem@margenext)/2\relax}%
    \@twosidefalse\@mparswitchfalse\@openrightfalse
    \hypersetup{linkcolor=memenlace, citecolor=memenlace, urlcolor=memenlace}%
    \renewpagestyle{mainstyle}[\small]{%
      \sethead{\ifthechapter{\thechapter.\ }{}\textsc{\chaptertitle}}{}%
              {\textsc{\sectiontitle}}%
      \setfoot{}{\thepage{}}{}}%
  \fi
  \mem@calculartextos
  \hypersetup{
    pdftitle    = {\mem@titulo},
    pdfauthor   = {\mem@autor},
    pdfsubject  = {\mem@tiponombre},
    pdfkeywords = {\mem@palabras},
    pdflang     = {\ifmem@ingles en\else es\fi},
  }%
  \ifmem@final\else\AddToHook{shipout/foreground}{\mem@marcaborrador}\fi
}
\AddToHook{begindocument/end}{%
  \ifmem@ingles\selectlanguage{english}\else\selectlanguage{spanish}\fi
  % \bibliography{…} en el cuerpo imprime las referencias (biblatex ya
  % cargó los archivos .bib en el preámbulo).
  \renewcommand{\bibliography}[1]{\printbibliography[heading=bibintoc]}%
}

\endinput
