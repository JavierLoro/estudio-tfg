# Distribución de escritorio

La receta produce macOS arm64/x64, Windows x64 y Linux x64. Cada plataforma tiene
variante **offline** y **online**, con el mismo archivo TeX y hash. Offline incluye
ese archivo; online lo descarga al preparar el motor. Ambas compilan localmente.

## Construcción

El constructor necesita Node 24, dependencias de `server`, `web`, `desktop` y
`test/e2e`, curl y herramientas de compilación de la plataforma. Unix construye
Perl con C/make; Windows usa el Perl incluido por TeX Live. Son requisitos del
constructor, no del usuario de la app. La extracción de prueba de NSIS utiliza
7-Zip, disponible en el runner Windows.

```sh
npm run build --prefix web
npm run bundle --prefix server
npm run desktop:tex -- /ruta/temporal/tex-assets v0.2.0-rc.4
npm run desktop:build -- /ruta/temporal/tex-assets v0.2.0-rc.4 offline
npm run desktop:verify -- desktop/dist/darwin-arm64/offline /ruta/temporal/tex-assets
```

Repetir build/verificación con `online`. Los artefactos viven en `desktop/dist/`,
ignorada por Git. Las plataformas se comprueban en sus runners nativos; no se
instala TeX globalmente.

El biber arm64 de este snapshot exige macOS 26; el instalador Apple Silicon declara
ese mínimo y se comprueba en `macos-26`. Intel declara macOS 13 (mínimo de Electron),
compatible con el biber x64 de la misma distribución. No se ofrece el paquete ARM
como compatible con macOS anteriores.
La compilación de Perl fija `MACOSX_DEPLOYMENT_TARGET` por arquitectura y comprueba
`LC_BUILD_VERSION` con `otool`; la caché distingue ese mínimo y la receta completa.

`desktop/tex/lock.json` fija el snapshot del **13-10-2026**, hashes del índice e
instaladores y Perl **5.42.2** en Unix. El índice fija revisiones/SHA-512 de todos
los paquetes transitivos; Windows utiliza `tlperl.windows` del mismo snapshot (Perl 5.42.0). Sus textos
originales [GPL](https://github.com/Perl/perl5/blob/v5.42.0/Copying) y
[Artistic](https://github.com/Perl/perl5/blob/v5.42.0/Artistic) se conservan en
`desktop/licenses/` y se incluyen en el motor y la ventana de licencias.
El compilador crea un perfil temporal Windows con `AppData/Roaming` y
`AppData/Local`, para que la inclusión PDF funcione sin reutilizar el perfil del
usuario. Se verifica cada descarga antes de instalar desde un repositorio local. No se
resuelve `latest` ni se actualiza TeX al arrancar la app.

El runtime conserva servidor JavaScript, recursos, plantillas y helpers, con
dependencias fijadas en `desktop/runtime-package-lock.json`. Se distribuye fuera
de ASAR para conservar sus rutas de archivos.

## Verificación y release

[`release.yml`](../.github/workflows/release.yml) construye ambas variantes en los
cuatro runners. Monta/copia el DMG, extrae el payload NSIS o AppImage y ejecuta la
app con fixtures, PATH sin TeX/Perl externos y red limitada. Comprueba primer
arranque, ambos perfiles, cero diagnósticos, SyncTeX, seis diagramas PDF y
citas/figuras en memorias originales y trasladadas.

Online utiliza en las pruebas un proxy local del mismo archivo/hash, porque una
release borrador no permite descargas públicas anónimas. La URL de producción
sigue fijada al asset de su distribución técnica; los reinicios/recompilaciones bloquean la
red externa. Las evidencias indican el artefacto ejecutado y las descargas.

Una entrega de `main` o un tag manual `v*` crea **dos borradores** después de pasar
los cuatro runners:

- `vX.Y.Z`: 10 instaladores/portables (4 DMG, 4 EXE y 2 AppImage) y `manifest.json`.
  La descripción ofrece enlaces de descarga y tamaños; `NOTAS.md` no se adjunta.
- `distribucion-vX.Y.Z`: TeX, manifiestos del motor, ZIP de actualización macOS,
  blockmaps, feeds y el mismo manifiesto de verificación. NSIS se conserva también
  aquí porque el actualizador busca el blockmap junto al EXE; AppImage utiliza
  directamente el archivo de la release principal. Los blockmaps de DMG se omiten.

Todo permanece en GitHub Releases, sin otro repositorio ni secretos adicionales.
Conservar ambos tags y sus archivos: las apps fijan esas URLs y hashes. GitHub
añade además sus dos enlaces automáticos al código fuente; no son instaladores.

En una entrega de `main`, el mismo workflow publica la app estable y ejecuta la
habilitación de auxiliares y canales. Usa directamente `desktop-publish.mjs`:
las publicaciones hechas con `GITHUB_TOKEN` no disparan otro workflow `release`.
No necesita tokens personales ni secretos nuevos.

Los tags manuales mantienen la revisión previa: el mantenedor publica **solo el
borrador principal**.
[`publish-updates.yml`](../.github/workflows/publish-updates.yml), presente en la rama
por defecto, comprueba los feeds y habilita automáticamente su distribución técnica,
siempre como prerelease y sin marcarla como última estable. Hasta que termina ese
workflow, el motor online puede no estar disponible; si falla se reejecuta el job.
Publicar una candidata (`-rc.*`) habilita su motor sin tocar el canal estable.
Las publicaciones se serializan y una estable antigua no desplaza a la última.

Las releases anteriores, incluida `v0.2.0-rc.3`, conservan sus archivos y URLs.
Los builds nuevos cambian el destino del actualizador; los antiguos borradores
de prueba deben reemplazarse manualmente para utilizar el nuevo canal.

## Ramas y entregas automáticas

- Las nuevas features/correcciones parten de `develop`, con PR hacia `develop`.
  Un PR de `develop` a `main` agrupa la entrega. No se desarrolla directamente en
  `main`; el mantenedor decide cuándo fusionar. Tras una entrega, sincronizar
  `develop` con `main` antes del siguiente bloque.
- Cada push de integración a `main` ejecuta CI; solo si sus cuatro jobs pasan
  llama al workflow reutilizable de distribución. El checkout y los manifiestos
  conservan el SHA de esa integración, aunque `main` avance mientras se construye.
  PR y pushes de otras ramas solo ejecutan CI, sin reservar tags ni publicar.
- `desktop/package.json` fija la versión base. Se reserva el siguiente parche
  sobre los tags estables existentes; una base superior permite saltar a otra
  minor/major. `0.2.0` con `v0.2.0` existente produce `v0.2.1`; una base `0.3.0`
  produce `v0.3.0`. Candidatas y tags técnicos no cuentan. No se modifica el
  código de `main` para incrementar versiones.
- El tag se reserva en el SHA comprobado antes de construir. CI de `main` y las
  entregas se ponen en cola (`queue: max`), sin cancelar integraciones anteriores.
  El `GITHUB_TOKEN` crea el tag sin iniciar una segunda construcción por ese tag.
- Si falla una plataforma, no se publica la estable ni se cambian sus feeds.
  Reejecutar los jobs fallidos desde Actions conserva el tag. Una reserva fallida
  puede dejar un salto entre versiones; nunca se mueve ni reutiliza para otro
  commit. Reejecutar todos los jobs del mismo commit también conserva la reserva.
- Las subidas incompletas pueden reintentarse sobre los borradores. Los archivos
  de una app ya publicada no se reemplazan. Una entrega antigua reintentada no
  desplaza Latest ni los canales de una versión posterior.
- Para un build puntual sin publicación, ejecutar manualmente «App instalable
  offline y online», indicando un tag de versión como `v0.3.0-rc.1`. Los tags
  manuales conservan el flujo de borradores; las candidatas nunca activan el canal
  estable.

La versión de `desktop/package.json` es una base para las entregas, no un contador
que el bot escriba tras cada parche. Para elevarla, usar
`npm version 0.3.0 --prefix desktop --no-git-tag-version` y revisar ambos archivos.

## Actualizaciones

«Buscar actualizaciones…» es explícito: no abre conexiones al iniciar una sesión
offline. Cada variante mantiene su canal; los feeds macOS reúnen ambas arquitecturas.
El motor nuevo se prepara como conjunto, conservando el anterior si falla.
La publicación técnica `actualizaciones` contiene únicamente los seis feeds de la
última release estable, con URLs absolutas a sus archivos verificados. Se crea o
actualiza después de habilitar los auxiliares de esa estable. No se usa
`releases/latest/download`, por lo que las publicaciones técnicas no interfieren
con las descargas de la app. Las candidatas no actualizan esos feeds.

G5 entrega paquetes sin firma. macOS necesita firma para actualizar automáticamente
([Electron](https://www.electron.build/v26/docs/features/auto-update/)); se habilita
en G6. La portable Windows se reemplaza mediante una descarga. NSIS/Linux incorporan
`electron-updater`; descargar/salir para instalar requieren decisión del usuario y
respetan los borradores. Firmas y credenciales quedan fuera de este bloque.
