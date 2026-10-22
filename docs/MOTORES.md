# Motores: evaluación de Tectonic (E4)

**Decisión del 13-10-2026: no usar Tectonic como motor predeterminado de la primera
app de escritorio.** Distribuir **TeX Live reducido privado de la app**, con una
versión completa offline y otra ligera online. Docker y TeX instalado por el
usuario siguen como alternativas. TeX Live 2026 ya compila ambos perfiles sin
avisos; sus requisitos y validación nativa macOS/Linux están en
[guía técnica](README.md#instalar-tex-para-la-plantilla).

Tectonic puede revisarse como motor opcional más adelante. Esta evaluación no
añade un adaptador, cambia ajustes ni modifica `templates/`. Los experimentos
usan copias ficticias: un PDF generado no implica bibliografía correcta.

## Distribución elegida para Electron

- **Completa / offline:** incluye el motor, biber, fuentes y paquetes de la
  plantilla. Crear y compilar la primera memoria no requiere red ni instalar
  MacTeX, MiKTeX, Perl o Docker por separado.
- **Ligera / online:** descarga el mismo paquete TeX de la release al primer
  arranque, verifica su integridad y lo prepara en la carpeta privada de la app.
  Después compila localmente y también funciona sin conexión. No envía las fuentes
  de la memoria a un servidor; «online» describe la descarga, no la compilación.
- Ambas variantes utilizan **las mismas versiones y paquetes fijados**. Se
  incluyen los auxiliares necesarios por plataforma, sin modificar el PATH
  global ni una instalación TeX existente. La versión TeX se actualiza mediante
  releases probadas, no ejecutando `tlmgr update` sobre el motor privado al arrancar.
- Medición de la instalación E3 en macOS: **135,6 MB comprimida con XZ o 164,9 MB
  con gzip; unos 346 MB en disco** (MB decimales). Presupuesto orientativo del
  motor: +170 MB de descarga y +350 MB instalado, **además de Electron y la app**.
  No son tamaños medidos de instaladores finales ni de Windows.
- Implementación pendiente en [G3–G5](HOJA-DE-RUTA.md#g3): este apartado fija la
  decisión y su planificación; todavía no existen instaladores ni descarga automática.

## Detección local y arranque frío

Biber del motor privado puede extraer su runtime PAR al primer uso. Su detección
admite hasta **120 segundos**; latexmk, pdfLaTeX y rsvg privados conservan 30 s.
Las herramientas de TeX del sistema conservan 10 s. Imprimir la versión antes de
agotar el tiempo no basta: el proceso debe terminar correctamente. La versión de
Biber se extrae de `biber version: …`, sin confundir avisos de Perl con su identidad.

Las consultas con la misma configuración comparten una detección en curso,
incluso al refrescar desde Ajustes. La caché dura 30 s desde que termina y separa
las rutas TeX/Perl, el PATH y las raíces de memoria/notas. Un refresco tras terminar
inicia otra detección; no amplía el tiempo de compilación.

El verificador de distribución espera hasta 270 s por el primer PDF, mantiene
los límites de cada proceso y guarda `/api/engines` en `engines-error.json` si
falla. El workflow recoge esta evidencia junto a capturas y logs para distinguir
herramientas ausentes, rutas y versiones.

## Entorno y versiones

- macOS arm64, Node 24.21.0; binario oficial **Tectonic 0.17.0** para
  `aarch64-apple-darwin`, descargado y ejecutado en una carpeta temporal.
- Formato 33; el [bundle predeterminado](https://relay.fullyjustified.net/default_bundle_v33.tar)
  redirigió a `https://data1b.fullyjustified.net/tlextras-2022.0r0.tar`.
  Identidad de caché: `6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c`.
  Contiene **LaTeX 2021-11-15 y biblatex 3.17**.
- biber externo probado: **2.22**, de la instalación temporal TeX Live 2026.
  Su biblatex 3.22a funciona con el motor local; no es el biblatex del bundle.
- Fuentes de repositorio: plantilla v0.5, clase `memoria` v3.0, perfiles
  `esi-uclm` y `generico`, sin contenido personal.

## Resultados

| Caso | Resultado observado |
| --- | --- |
| Plantilla original, ambos perfiles | Salida 1, sin PDF: `\tl_set:Ne` no existe en el LaTeX del bundle. También avisa de la versión mínima 2022/06/01 de la clase. |
| Copia ESI con variantes expl3 adaptadas | Llega a bibliografía; salida 1 si no encuentra `biber` en PATH. |
| Esa copia con biber 2.22 en PATH | Salida 1: el `.bcf` tiene versión 3.8 y biber espera 3.11. Confirma la incompatibilidad biblatex 3.17 / biber 2.22. |
| Copia con backend BibTeX interno | Salida 0 y PDF, pero **1 error y 4 avisos** del parser compartido. BibTeX interpreta el `@online` de un comentario `%` en `bibliografia.bib`; además quedan referencias pendientes y el aviso de backend reducido. Hay sustituciones de Bera Mono en el log. |
| Copia con comentarios `.bib` retirados y fuentes OpenType explícitas | Salida 0 y PDF, pero **4 avisos** del parser, incluidas referencias y petición de repetir BibTeX. El log aún sustituye una variante de negrita monoespaciada. No cumple cero avisos. |
| Control `article` + fontspec + `texgyretermes-regular.otf` | PDF válido, log sin diagnósticos y SyncTeX. Repetición con `--only-cached`: correcta, sin descargar recursos nuevos. |
| Bundle comunitario TeX Live 2025 | El servidor indicado en la discusión del proyecto no respondió (timeout de 20 s). Sin resultado de compatibilidad; no se extrapola el fallo del bundle 2022 a todos los bundles posibles. |

Los conteos reutilizan `parseLog`, `parseBlg` y `finalize` de
`worker/parse-log.mjs`. Este parser omite avisos de fuentes y cajas: las
sustituciones tipográficas se revisaron además en los logs crudos. No se considera
éxito un prototipo solo porque el proceso termine con 0 o exista un PDF.

## Qué exigiría adoptarlo

1. **Bundle reciente y fijado:** el predeterminado no cumple las macros actuales.
   La alternativa es construir/alojar un bundle controlado, fijar su identidad y
   comprobar los dos perfiles. Adaptar `:Ne`/`:Nne` y variantes regex al LaTeX de
   2021 sirvió para explorar; no se propone rebajar la plantilla principal.
2. **Bibliografía:** distribuir un biber compatible con el biblatex de ese bundle,
   con versión fija por plataforma y `--noconf`. V2 prefiere `tectonic-biber` si
   existe. Cambiar a BibTeX reduce funciones y afecta nuestros `.bib`; el prototipo
   no demuestra una sustitución válida de la Biblioteca ni de biber.
3. **Fuentes y maquetación:** newtxtext del bundle ya carga fontspec bajo XeTeX;
   no hace falta reemplazarlo automáticamente. Sí deben fijarse fuentes Sans/Mono
   OpenType con variantes completas: Bera Mono/T1 no conserva su comportamiento
   bajo TU. Comprobar saltos de página, matemáticas y tablas. [microtype](https://ctan.org/pkg/microtype) no ofrece
   la misma expansión tipográfica en XeTeX que en pdfTeX.
4. **Integración:** adaptador `Engine`, diagnósticos completos (incluido biber),
   temporales/entorno, cancelación del árbol de procesos y avisos de confianza.
   `--untrusted` y `TECTONIC_UNTRUSTED_MODE` bloquean funciones conocidas como
   shell-escape; **no son un sandbox** ni sustituyen R6. Revisar qué herramientas
   externas permite lanzar y cómo se configuran.
5. **SyncTeX y entrega:** el control genera rutas absolutas y entradas `Input:`
   vacías. Adaptar/verificar la normalización, navegación en ambos sentidos,
   caché propia de la app, descargas interrumpidas y primer arranque sin red.

## Descarga, caché y plataformas

Medidas de esta evaluación, no tamaños garantizados de un instalador:

| Elemento | Tamaño |
| --- | --- |
| Archivo oficial macOS arm64 `.tar.gz` | 21 704 674 bytes (20,7 MiB) |
| Ejecutable macOS arm64 descomprimido | 53 998 928 bytes (51,5 MiB) |
| Caché del bundle, unión de los experimentos y control | Aproximadamente 47 MiB en disco |
| Bundle remoto completo (cabecera Content-Length) | 2 881 562 112 bytes (2,68 GiB); **no se descargó entero** |
| biber 2.22 universal-darwin, como referencia de coste adicional | 84 582 416 bytes (80,7 MiB); no es compatible con el bundle evaluado |

Tectonic obtiene archivos del bundle a demanda, no instala todo TeX Live. La
caché aumenta con documentos/paquetes nuevos; el primer formato también necesita
descargas. No basta con repartir el ejecutable de «unos 30 MB» para garantizar
arranque offline, bibliografía ni un tamaño final de app.

La [release oficial 0.17.0](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0)
publica macOS arm64 e Intel, Windows x86_64 (MSVC/GNU) y Linux, incluidas variantes
musl. Solo se ejecutó macOS arm64. No se validaron Windows, Intel/Rosetta ni
Windows ARM; publicar un binario no acredita el flujo completo con biber.

Tectonic tiene [licencia MIT](https://github.com/tectonic-typesetting/tectonic/blob/tectonic%400.17.0/LICENSE),
pero sus componentes derivados, fuentes y archivos TeX conservan otras licencias.
[biber 2.22](https://github.com/plk/biber/blob/v2.22/LICENSE) usa Artistic-2.0. Una entrega necesita inventario y avisos de los
componentes realmente distribuidos; MIT no licencia todo el bundle.

## Reproducir con copias temporales

Desde la raíz del repositorio, con las dependencias de la API instaladas. El
ejemplo descarga el binario probado para macOS arm64; selecciona otro asset
oficial para otra plataforma. No usa `.env`, memoria ni notas personales.

```sh
ET_MOTORES_TMP=$(mktemp -d)
export ET_MOTORES_TMP
curl -fL 'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-aarch64-apple-darwin.tar.gz' \
  -o "$ET_MOTORES_TMP/tectonic.tar.gz"
tar -xzf "$ET_MOTORES_TMP/tectonic.tar.gz" -C "$ET_MOTORES_TMP"
node --input-type=module <<'JS'
import { copyTemplate } from './scripts/memoria-template.mjs';
for (const perfil of ['esi-uclm', 'generico'])
  copyTemplate(`${process.env.ET_MOTORES_TMP}/original/${perfil}`, { perfil });
JS
export TECTONIC_CACHE_DIR="$ET_MOTORES_TMP/cache"
export TECTONIC_UNTRUSTED_MODE=1
(cd "$ET_MOTORES_TMP/original/esi-uclm" && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --keep-logs \
  --keep-intermediates --synctex tfg.tex)
# Se espera salida 1 por tl_set:Ne. Repetir con original/generico.
```

Para llegar a bibliografía, aplica **solo a otra copia** estos cambios:

```sh
python3 <<'PY'
import os, shutil
from pathlib import Path
root = Path(os.environ['ET_MOTORES_TMP'])
shutil.copytree(root / 'original', root / 'compat')
for p in (root / 'compat').glob('*/estilo/memoria.cls'):
    text = p.read_text()
    for old, new in [
        (r'\tl_set:Ne', r'\tl_set:Nx'),
        (r'\tl_set_rescan:Nne', r'\tl_set_rescan:Nnx'),
        (r'\clist_set:Ne', r'\clist_set:Nx'),
        (r'\regex_match:nVF', r'\exp_args:NnV \regex_match:nnF'),
        (r'\regex_match:nVTF', r'\exp_args:NnV \regex_match:nnTF'),
    ]:
        text = text.replace(old, new)
    p.write_text(text)
PY
(cd "$ET_MOTORES_TMP/compat/esi-uclm" && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --keep-logs \
  --keep-intermediates --synctex tfg.tex)
# Sin biber: herramienta ausente. Con biber 2.22 en PATH: incompatibilidad BCF.
```

Experimentos posteriores, **solo en copias**, que mantienen los problemas de la
tabla. Ejecuta los pasos en este orden para conservar el mismo estado de auxiliares:

```sh
python3 <<'PY'
import os, shutil
from pathlib import Path
root = Path(os.environ['ET_MOTORES_TMP'])
shutil.copytree(root / 'compat', root / 'bibtex')
for p in (root / 'bibtex').glob('*/estilo/memoria.cls'):
    p.write_text(p.read_text().replace('backend=biber', 'backend=bibtex'))
PY
(cd "$ET_MOTORES_TMP/bibtex/esi-uclm" && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --keep-logs \
  --keep-intermediates --synctex tfg.tex)
python3 <<'PY'
import os, shutil
from pathlib import Path
root = Path(os.environ['ET_MOTORES_TMP'])
shutil.copytree(root / 'bibtex', root / 'fonts')
for p in (root / 'fonts').glob('*/estilo/memoria.cls'):
    text = p.read_text().replace(r'\RequirePackage[T1]{fontenc}', '')
    text = text.replace(r'\renewcommand{\sfdefault}{lmss}', r'\setsansfont{lmsans10-regular.otf}')
    text = text.replace(r'\RequirePackage[scaled=.82]{beramono}', r'\setmonofont{lmmono10-regular.otf}')
    p.write_text(text)
for p in (root / 'fonts').glob('*/bibliografia.bib'):
    p.write_text('\n'.join(line for line in p.read_text().splitlines()
                           if not line.lstrip().startswith('%')) + '\n')
PY
(cd "$ET_MOTORES_TMP/fonts/esi-uclm" && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --keep-logs \
  --keep-intermediates --synctex tfg.tex)
```

Control positivo, seguido de prueba con caché:

```sh
mkdir "$ET_MOTORES_TMP/control"
cat > "$ET_MOTORES_TMP/control/main.tex" <<'TEX'
\documentclass{article}
\usepackage{fontspec}
\setmainfont{texgyretermes-regular.otf}
\begin{document}Control ficticio con texto Unicode: áéíóú.\end{document}
TEX
(cd "$ET_MOTORES_TMP/control" && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --keep-logs --synctex main.tex && \
  "$ET_MOTORES_TMP/tectonic" -X compile --untrusted --only-cached --keep-logs --synctex main.tex)
```

Para contar diagnósticos de un prototipo desde la raíz del repo:

```sh
ET_MOTORES_CASE=bibtex  # carpeta de la copia preparada
export ET_MOTORES_CASE
node --input-type=module <<'JS'
import fs from 'node:fs';
import { parseLog, parseBlg, finalize } from './worker/parse-log.mjs';
const dir = `${process.env.ET_MOTORES_TMP}/${process.env.ET_MOTORES_CASE}/esi-uclm`;
const opts = { mainFile: 'tfg.tex', rootDir: dir };
console.log(finalize([
  ...parseLog(fs.readFileSync(`${dir}/tfg.log`, 'utf8'), opts),
  ...parseBlg(fs.readFileSync(`${dir}/tfg.blg`, 'utf8'), opts),
]));
JS
```

Conserva los logs para comparar y elimina únicamente tu temporal al terminar.
No apliques estas sustituciones a la clase o bibliografía de una memoria existente.

## Coste y puerta para reconsiderar

Estimación de ingeniería, no resultado medido: **5–8 días de trabajo** para un
prototipo con bundle/biber fijados, fuentes y adaptador; **2–4 días adicionales**
para validar/empaquetar macOS y Windows. El tiempo de alojamiento/actualización
del bundle y de firma de binarios no está incluido.

Reconsiderar Tectonic cuando ambos perfiles, citas/figuras de Biblioteca y copias
trasladadas den cero diagnósticos, se comprueben logs/fuentes, cancelación y
SyncTeX, y la instalación funcione offline en ambas plataformas. Hasta entonces,
añadirlo por defecto ampliaría el mantenimiento sin resolver la entrega actual.

Referencias primarias: [instalación](https://tectonic-typesetting.github.io/book/latest/installation/),
[compile, caché, SyncTeX y seguridad](https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html),
[biber externo en V2](https://tectonic-typesetting.github.io/book/latest/ref/v2cli.html),
[construcción de bundles](https://github.com/tectonic-typesetting/tectonic/tree/tectonic%400.17.0/bundles),
[discusión de bundles recientes](https://github.com/tectonic-typesetting/tectonic/issues/1269).
