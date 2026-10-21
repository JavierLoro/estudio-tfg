# Copias de seguridad y restauración

Historial, papelera, Git y sincronización ayudan a deshacer cambios, pero pueden desaparecer con el disco o propagar un borrado. Conserva **copias fechadas independientes**, en otro soporte y con alguna copia fuera del equipo. No sustituyas la última copia verificada hasta comprobar la siguiente. Todo el contenido y los manifiestos son privados; nunca van al repositorio de la herramienta.

## Inventario: qué conservar

Comprueba las rutas efectivas en **Ajustes**: `data/settings.json` prevalece sobre `.env`. Si cambias `BUILD_DIR`, la carpeta de datos está en su **padre**, no necesariamente en `<repo>/data`.

| Contenido | Ubicación efectiva | Tratamiento |
| --- | --- | --- |
| Notas, fichas, adjuntos, imágenes y PDFs importados | `NOTES_DIR`, incluyendo `RESOURCES_SUBDIR` | Duradero: copiar el vault completo, incluidos `.obsidian`, `.trash`, ocultos y conflictos de sincronización. |
| Memoria, bibliografía, figuras, diagramas y personalizaciones | `MEMORIA_DIR` | Duradero: copiar completa, incluidos `.git` y `.estudio-template.json`. Las figuras exportadas dentro de la memoria son parte del documento. |
| Recibos y capturas interrumpidas | `<padre de BUILD_DIR>/captures/` | Duradero: todos los destinos y operaciones, `operation.json` y los archivos `attachment` que queden. Los recibos no caducan. |
| Historial y papelera de memoria | `<padre de BUILD_DIR>/history/` y `trash/` | Conservar para recuperar versiones/borrados; el historial mantiene solo **20 versiones por archivo**. La papelera de notas está dentro del vault. |
| Ajustes y credenciales | `<padre de BUILD_DIR>/settings.json`, `.env` | Copia privada; contienen rutas y posiblemente tokens. También `.git/config` y ajustes de plugins pueden contener credenciales. |
| Compilaciones y cachés | `BUILD_DIR`, temporales del worker, `node_modules`, `web/dist` | Regenerables. El ejemplo copia toda la carpeta de datos por sencillez, incluidos builds; estos últimos no sustituyen las fuentes. |
| Borradores y capturas aún no enviados | Navegador: `localStorage` `et:draft:*` e IndexedDB `et:captures` | **No están en data ni en el vault**. Guarda los borradores y resuelve pendientes antes del traslado; conserva el perfil del navegador si siguen pendientes. No se ofrece todavía una exportación portable de esa cola. |

Si notas/memoria se solapan, elige raíces de copia que cubran ambas sin omitir datos; una copia duplicada cuesta espacio pero no cambia bytes. La guía conserva enlaces **relativos**. Enlaces absolutos, dependencias externas, repositorios Git con `.git` como archivo/alternates y archivos «solo en la nube» necesitan revisar e incluir sus destinos por separado. El manifiesto rechaza symlinks/junctions y archivos especiales: no los sigue ni los omite silenciosamente.

## Obtener una copia consistente

1. Guarda editores y revisa **Pendientes**. Detén app/API/worker, Obsidian, editores externos y sincronizadores. En Docker: `docker compose --profile app down`. No ejecutes la copia mientras haya escrituras ni dejes dos servidores sobre la misma biblioteca.
2. Crea una carpeta nueva en el soporte de respaldo; restringe sus permisos y cifra el soporte si contiene credenciales. No uses una carpeta que el sincronizador pueda borrar junto con el origen.
3. **Genera el manifiesto del origen antes de copiar**, fuera de él. Copia cada raíz completa y verifica el destino contra ese manifiesto. El script requiere Node ≥ 24, usa SHA-256 por archivo y enumera también ocultos/carpetas vacías. Nunca copia/restaura por sí mismo ni sobrescribe manifiestos existentes.
4. Solo tras verificar todas las partes marca la copia como completa. Conserva versiones anteriores y prueba periódicamente una restauración en otra ubicación.

Desde la raíz del repo, ejemplos con rutas ficticias. macOS/Linux:

```sh
(
  set -e
  copia='/ruta/disco/respaldo-AAAAMMDD'
  mkdir "$copia"                 # debe ser nueva; el padre ya debe existir
  chmod 700 "$copia"
  respaldar() {
    nombre="$1"; origen="$2"
    node scripts/respaldo-manifest.mjs crear "$origen" "$copia/$nombre.manifest.json"
    cp -R "$origen" "$copia/$nombre"
    node scripts/respaldo-manifest.mjs verificar "$copia/$nombre" "$copia/$nombre.manifest.json"
  }
  respaldar notas '/ruta/Vault'
  respaldar memoria '/ruta/Memoria'
  respaldar datos '/ruta/estudio-tfg/data'
  if test -f .env; then respaldar entorno .env; fi
  printf 'Todas las partes verificadas\n' > "$copia/COPIA-VERIFICADA.txt"
)
```

PowerShell (elige un destino con permisos privados; cambia las rutas):

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $copia = 'E:/Respaldos/TFG-AAAAMMDD'
  New-Item -ItemType Directory -Path $copia | Out-Null
  function Respaldar($nombre, $origen) {
    node scripts/respaldo-manifest.mjs crear $origen "$copia/$nombre.manifest.json"
    if ($LASTEXITCODE -ne 0) { throw 'No se creó el manifiesto' }
    Copy-Item -LiteralPath $origen -Destination "$copia/$nombre" -Recurse -Force
    node scripts/respaldo-manifest.mjs verificar "$copia/$nombre" "$copia/$nombre.manifest.json"
    if ($LASTEXITCODE -ne 0) { throw 'La copia no está verificada' }
  }
  Respaldar notas 'C:/TFG/Vault'
  Respaldar memoria 'C:/TFG/Memoria'
  Respaldar datos 'C:/Herramientas/estudio-tfg/data'
  if (Test-Path -LiteralPath .env) { Respaldar entorno .env }
  Set-Content -LiteralPath "$copia/COPIA-VERIFICADA.txt" -Value 'Todas las partes verificadas'
}
```

La marca es orientativa: vuelve a ejecutar `verificar` antes de restaurar. El manifiesto comprueba rutas, tipos, tamaños y bytes; no certifica autoría, ACL/permisos, fechas ni la consistencia de archivos que estaban cambiando. No lo edites para hacer pasar una copia dañada. Mantén originales y manifiestos en reposo durante la operación.

## Interrupción o copia incompleta

Sin verificación exitosa, la copia no se usa para reemplazar datos. Un manifiesto truncado, un archivo faltante/sobrante, un cambio de bytes o un error de lectura hace fallar la comprobación con código 1. Conserva la última copia íntegra; aparta la parcial y repite en **otra carpeta nueva** con fuentes detenidas. Si las fuentes cambiaron, genera nuevos manifiestos: no mezcles generaciones. Si el disco de origen falló, restaura la copia verificada anterior; conserva la parcial como material de recuperación separado, sin fusionarla automáticamente.

## Restaurar sin sobrescribir

1. Verifica todas las partes del respaldo. Cópialas a una ubicación **nueva y vacía**, diferente del origen y del propio respaldo, incluyendo ocultos. Vuelve a verificar cada raíz restaurada con los manifiestos originales. No arranques todavía la app.
2. En la **restauración**, adapta `settings.json`: `notesDir`, `memoriaDir`, `resourcesSubdir` y `memoriaMain`. Adapta también `NOTES_DIR`, `MEMORIA_DIR`, `BUILD_DIR`, `ALLOWED_ROOTS` y los volúmenes/HOST_HOME si usas Docker. `ALLOWED_ROOTS` separa rutas con `;` en Windows y `:` en POSIX. Dentro del contenedor se usan rutas `/data/…`, no las del host. Cambiar solo `.env` puede dejar activos los ajustes antiguos.
3. Conserva la configuración original intacta en el respaldo. Usa credenciales propias para la instancia restaurada y revisa permisos del usuario/uid que escribirá. Las modificaciones de configuración harán que esa parte ya no coincida con su manifiesto: por eso se verificó **antes** y no se modifica la copia de seguridad.
4. Arranca una instancia aparte (por ejemplo API :8811, web :5211; no uses los puertos de la instancia original). Abre una nota y sus wikilinks, una ficha y su adjunto, `tfg.tex`, bibliografía y figuras; revisa Ajustes, historial y papeleras. Compila desde las fuentes cuando el worker esté disponible; los builds antiguos son opcionales. Mantén detenida la instancia original mientras decides cuál usar.

### Identidad de capturas al trasladar

La Biblioteca preparada conserva su identidad en `<Recursos>/.biblioteca.json`. Incluye ese archivo oculto, las fichas/adjuntos y los registros `data/captures` y `data/library` al trasladar o restaurar. Copiados juntos, el destino conserva su identidad aunque cambie la ruta: se pueden recuperar operaciones interrumpidas y reintentar la misma cola sin duplicar éxitos. Usa un único destino activo; dos clones del mismo respaldo no son bibliotecas independientes.

Los vaults antiguos **sin archivo de identidad** siguen usando el hash de su ruta canónica. Antes de trasladarlos, prepara la Biblioteca desde su vista previa (también sin convertir fichas); no cambia el ID anterior. Si el origen ya no existe y falta el archivo de identidad, el cambio de ruta crea otro destino y la cola no se reasigna automáticamente: conserva perfil/registros para recuperación explícita y revisada. No renombres recibos para saltarte esa protección. Los conflictos siguen el procedimiento de [capturas pendientes](README.md#recuperar-capturas-pendientes) y [BIBLIOTECA.md](BIBLIOTECA.md).

## Elegir la recuperación

- **Borrado accidental:** comprueba la papelera correspondiente o la versión del historial; recupera primero a una ubicación aparte y compara antes de reemplazar.
- **Fallo de disco:** usa el respaldo independiente, fuentes y datos duraderos juntos; Git dentro del mismo disco no protege frente a ese fallo.
- **Traslado:** verifica antes/después, adapta las raíces de la copia y revisa enlaces absolutos, permisos e identidad de capturas.

## Prueba reproducible

```sh
node --test scripts/respaldo-manifest.test.mjs
npm test --prefix server -- --run test/respaldo.test.ts
```

Los tests crean fixtures en temporales: copia completa, interrupción simulada, restauración en otra ruta, hashes, archivos ocultos, notas/enlaces, adjuntos, memoria, bibliografía, historial, papeleras y recibos con adjunto pendiente. Abren una API nueva con raíces de la restauración y comprueban que origen y respaldo permanecen intactos. L1 verifica identidad y migración; L4 compila citas/figuras en ambos perfiles después de trasladar la memoria y retirar la Biblioteca. Los [recorridos E2E de L5](../test/e2e/README.md) verifican también migración/deshacer, una copia incompleta rechazada y la apertura de fichas/adjuntos en una restauración desde Chromium. No hay servicio cloud ni copias automáticas del contenido real.

La memoria incorporada incluye `biblioteca/estado.json`, `biblioteca/referencias.bib` y `figuras/biblioteca/`; respáldala completa para conservar claves, procedencia y compilación portable. Los originales bibliográficos viven en `<Recursos>/originales/`; las importaciones e integraciones recuperables, en `data/library/<id>/imports/` e `integrations/`. Antes de trasladar la configuración, termina las integraciones o conserva su staging: las operaciones de memoria se vinculan también a la instancia/rutas originales y no se aplican automáticamente en otro proyecto. Los borradores de revisión `et:library-import:*` y `et:library-use:*` siguen en el navegador.

Incluye `DATA_DIR/project-context/` en la copia privada de datos: conserva ficha y selección del TFG, fragmentos y sus bases, propuestas/historial, generaciones de diagramas y concesiones por cuenta/proyecto. Sus copias previas están en `history/notes/.asistente/`. No son cachés regenerables. Copiar las raíces a otra ubicación crea un proyecto con permisos cerrados; no renombres estos registros para reutilizar accesos silenciosamente. Las propuestas interrumpidas se muestran como error y solo vuelven a ejecutarse por una acción explícita. El título continúa en `datos.tex` y los diagramas creados en Memoria; respalda ambas raíces completas.
