# Seguridad de la compilación

## Confianza y aislamiento

LaTeX y la bibliografía son fuentes activas. Revisa los `.tex`, clases, paquetes y bibliografía de un proyecto importado antes de compilarlo; no aceptes instrucciones para habilitar shell-escape o configuraciones externas. Para material desconocido utiliza un contenedor desechable sin datos personales, sin volúmenes de otras compilaciones y con salida de red bloqueada por el despliegue.

El worker Docker recibe un tar y **no monta la memoria ni las notas**. Su frontera es el contenedor, no cada trabajo. El motor nativo de E2 ejecutará con los permisos del usuario: **no será un sandbox** y solo admitirá fuentes de confianza. Estas mitigaciones no sustituyen el aislamiento del sistema operativo ni protegen frente a vulnerabilidades de las herramientas.

## Política del worker

- `latexmk -norc` desactiva los rc automáticos del sistema, usuario y proyecto (`latexmkrc` y `.latexmkrc`). Solo se aplica una asignación constante del código: `$biber = "biber --noconf %O %B";`. Tampoco se carga `biber.conf`. La petición no puede proporcionar opciones ni configuraciones.
- pdfLaTeX siempre recibe `-no-shell-escape`, `-synctex=1`, `-interaction=nonstopmode` y `-file-line-error`. Node usa `spawn` sin shell; latexmk gestiona sus herramientas auxiliares.
- Se valida y extrae cada tar en `/tmp/build-XXXX/sources`: solo archivos regulares/directorios, sin rutas absolutas, `..`, enlaces ni dispositivos. Se borra el trabajo al terminar, también tras errores y timeout; nunca se escribe el original.
- El entorno se construye desde cero: `PATH=/usr/local/bin:/usr/bin:/bin`, `LANG`/`LC_ALL=C.UTF-8`; `HOME`, `TMPDIR`, `TEXMFHOME`, `TEXMFVAR`, `TEXMFCONFIG` y `TEXMFCACHE` apuntan a carpetas nuevas en `/tmp/build-XXXX/runtime`, separadas de las fuentes. No se heredan secretos, carga de Perl/bibliotecas, `LATEXMKRCSYS`, `TEXMFCNF` ni rutas de búsqueda. `shell_escape=0`, `openout_any=p` y los tamaños de línea del log son constantes.
- `openout_any=p` restringe las escrituras de Kpathsea (rutas absolutas y escapes con `..`); **no confina todos los auxiliares**. En TeX Live 2026, `openin_any` es un no-op: TeX puede leer archivos accesibles al uid del contenedor, incluidos artefactos anteriores en `/out`. No montes secretos ni otros datos del host allí.

## Límites y riesgo residual

Compose y CI usan usuario sin privilegios, raíz de solo lectura, capacidades eliminadas, `no-new-privileges`, `init`, 2 GiB de memoria, 256 procesos y `/tmp` tmpfs de 1 GiB. Solo `/tmp` y `/out` son escribibles. El endpoint se publica en loopback; no es un servicio público autenticado.

Se admiten cuatro trabajos entre subida, extracción, cola y ejecución; el exceso responde **503** para reintentar. Se ejecuta una compilación cada vez. Máximo por tar: 200 MiB y 50 000 entradas. Tiempo de proceso: 120 s (`COMPILE_TIMEOUT_MS`); se mata el grupo con SIGTERM, SIGKILL a los 2 s y limpieza de descendientes al terminar. Los límites del despliegue los controla el operador, no la petición. `/tmp` incluye fuentes, auxiliares y cachés; `/out` conserva diez builds y requiere espacio/limpieza del host.

El worker habitual tiene red para recibir HTTP. `-no-shell-escape` y `--noconf` **no son un cortafuegos**: una bibliografía puede solicitar fuentes remotas. No se garantiza aislamiento de red ni separación entre trabajos del mismo uid. No compiles material no confiable en el worker compartido.

## Requisitos verificables de E2

1. Copiar fuentes validadas a un temporal nuevo; separar runtime y limpiar ambos incluso al cancelar. No modificar originales.
2. Mantener `-norc`, la configuración constante de biber y `-no-shell-escape`. No reutilizar rc del usuario/proyecto ni aceptar argumentos arbitrarios.
3. Construir un entorno mínimo con binarios de confianza en rutas absolutas. Adaptar HOME/USERPROFILE, temporales y cachés a cada plataforma sin propagar credenciales, carga de Perl/bibliotecas o configuración de búsqueda. Registrar distribución/versiones.
4. Limitar trabajos y tiempo; matar descendientes en POSIX y mediante `taskkill /T /F` en Windows. Documentar los límites de memoria, disco y procesos realmente impuestos; el timeout no es un sandbox.
5. Repetir fixtures de rc, biber, shell-escape, escritura externa, timeout, limpieza y SyncTeX; ambos perfiles sin avisos. Advertir antes de ejecutar fuentes importadas: el motor local puede acceder a los archivos del usuario.

## Verificación

`node --test worker/*.test.mjs` comprueba entorno, argumentos, admisión, cancelación y limpieza sin TeX. Contra un worker **de pruebas** con `/out` ficticio:

```sh
WORKER_SECURITY_URL=http://127.0.0.1:8097 WORKER_SECURITY_OUT=/tmp/salida-ficticia \
  node --test worker/security.integration.test.mjs
node scripts/compile-template.mjs --worker-url http://127.0.0.1:8097 --output-dir /tmp/salida-ficticia
```

La integración comprueba marcadores inocuos y SyncTeX relativo; no lee ni escribe la memoria/vault del usuario. Referencias: [manual de latexmk, rc y `-norc`](https://www.cantab.net/users/johncollins/latexmk/latexmk-487.pdf), `biber --help` (`--noconf`) y `texmf-dist/web2c/texmf.cnf` de la imagen fijada (comentario de `openin_any` en TeX Live 2026). Versiones y actualizaciones: [worker/README.md](../worker/README.md).
