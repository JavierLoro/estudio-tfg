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
npm run desktop:tex -- /ruta/temporal/tex-assets v0.2.0-rc.3
npm run desktop:build -- /ruta/temporal/tex-assets v0.2.0-rc.3 offline
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
sigue fijada al asset de esa release; los reinicios/recompilaciones bloquean la
red externa. Las evidencias indican el artefacto ejecutado y las descargas.

Un tag `v*` solo crea una **release borrador** después de pasar los cuatro runners.
Reúne instaladores, portables, motores, hashes, tamaños y resultados por plataforma,
variante y perfil. No publica automáticamente. Conservar el tag/código asociado.

## Actualizaciones

«Buscar actualizaciones…» es explícito: no abre conexiones al iniciar una sesión
offline. Cada variante mantiene su canal; los feeds macOS reúnen ambas arquitecturas.
El motor nuevo se prepara como conjunto, conservando el anterior si falla.

G5 entrega paquetes sin firma. macOS necesita firma para actualizar automáticamente
([Electron](https://www.electron.build/v26/docs/features/auto-update/)); se habilita
en G6. La portable Windows se reemplaza mediante una descarga. NSIS/Linux incorporan
`electron-updater`; descargar/salir para instalar requieren decisión del usuario y
respetan los borradores. Firmas y credenciales quedan fuera de este bloque.
