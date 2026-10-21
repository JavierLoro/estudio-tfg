# Recorridos de Biblioteca (L5)

Pruebas con Playwright/Chromium, API real y fixtures ficticios. Cada test crea una carpeta temporal, un puerto asignado por el sistema y un contexto de navegador nuevo. Se usa `buildApp` con configuración explícita: no se leen `.env` ni ajustes del usuario. Los metadatos web están simulados; no se consultan webs públicas. La API se detiene y los temporales se borran incluso al fallar.

Desde la raíz del repositorio, con Node ≥ 24:

```sh
npm run install:all
npm ci --prefix test/e2e
npm run browsers --prefix test/e2e
npm run build --prefix web
npm run test:e2e
npm run test:e2e -- --grep "@smoke"
```

En Linux, instalar también las bibliotecas del navegador: desde `test/e2e`, `npx playwright install --with-deps chromium`. Se prueba la web construida, servida por la propia API; reconstruirla tras cambiar la interfaz.

## Compilación real

El recorrido `@worker` exige `E2E_WORKER_URL` y `E2E_WORKER_OUT` (loopback y carpeta temporal montada en `/out`). **Usar un worker dedicado**, sin compartir datos ni puerto con una instancia personal. Sin esas variables, solo ese recorrido se marca omitido. No se simula un PDF ni se da por comprobada la compilación.

Ejemplo macOS/Linux; el contenedor tiene un puerto libre y se elimina al salir:

```sh
(
  set -e
  scratch=$(mktemp -d)
  worker="estudio-tfg-e2e-$(basename "$scratch")"
  trap 'docker rm --force "$worker" >/dev/null 2>&1; rm -rf "$scratch"' EXIT
  mkdir "$scratch/out"
  docker build --tag estudio-tfg-worker:e2e worker
  docker run --detach --init --name "$worker" --user "$(id -u):$(id -g)" --publish 127.0.0.1::8090 \
    --volume "$scratch/out:/out" --env COMPILE_TIMEOUT_MS=30000 \
    --read-only --tmpfs /tmp:rw,exec,nosuid,size=1g,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges --memory 2g --pids-limit 256 \
    estudio-tfg-worker:e2e
  puerto=$(docker port "$worker" 8090 | sed 's/.*://')
  E2E_WORKER_URL="http://127.0.0.1:$puerto" E2E_WORKER_OUT="$scratch/out" npm run test:e2e
)
```

## Cobertura y evidencias

- `@smoke`: añadir/buscar/consultar, adjuntos, metadatos ficticios, foco/Escape y conflicto externo que exige revisar antes de reaplicar. CI: Chromium en Linux, macOS y Windows.
- Suite completa: lote parcialmente enviado, respuesta perdida y recibo idempotente, IndexedDB tras recarga, 401 real y reautenticación, cambio de vault, fichas movidas con adjuntos, bibliografía original y duplicados, migrar/deshacer y respaldo/restauración en otra ubicación con manifiestos. CI: Chromium/Linux.
- `@worker`: importar bibliografía revisada, insertar cita y figura, deshacer/rehacer, guardar y compilar; comprobar el texto del PDF en el visor y recompilar una memoria trasladada sin Biblioteca. La CI reutiliza su worker aislado y mantiene la comprobación L4 de ambos perfiles sin avisos.

Sin reintentos automáticos que oculten inestabilidad. Al fallar se conservan trazas, pantallas y logs de la API en `test/e2e/test-results/`, además del informe HTML en `playwright-report/`; la CI los publica durante siete días. Son evidencias de fixtures, nunca contenido personal. Abrir una traza desde `test/e2e` con `npx playwright show-trace <ruta/trace.zip>`.

Límites: no Firefox/WebKit; Electron se ejecuta por separado con `E2E_DESKTOP=1`; la suite completa y TeX real no se ejecutan en Windows/macOS en CI. No cubre interrupciones físicas de disco ni políticas de permisos de cada sincronizador. Las fallas de escritura/renombrado y recuperación de staging siguen cubiertas por tests de servidor; el E2E verifica su efecto visible. Los casos de regresión se corresponden con R1 (revisión), R2 (cola/destino/duplicación), R3 (adjuntos y traslado) y R4 (foco).

## Biblioteca por tipos, contexto y descubrimiento

`library.spec.mjs` verifica ficha plegable, foco de teclado, presentación por tipos y ancho estrecho. `project-context.spec.mjs` verifica selección sin tocar Markdown, revisión/corrección, invalidación, propuestas de los quince tipos y creación exclusiva tras render válido. `discovery.spec.mjs` verifica Rápida/Ampliada, reapertura, preferencia de modelo y guardado elegido sin adjuntos. La marca `@contexto` activa únicamente en el servidor de pruebas un proveedor ficticio; nunca consulta una cuenta real ni se empaqueta ese proveedor.

```sh
npm run build --prefix web
npm run bundle --prefix server
npm test --prefix test/e2e -- project-context.spec.mjs discovery.spec.mjs
E2E_DESKTOP=1 npm test --prefix test/e2e -- assistant.spec.mjs
```

No ejecutes dos procesos Playwright sobre la misma carpeta de resultados: borrarían mutuamente sus trazas. Los recorridos nativos utilizan un perfil temporal, notas y memoria ficticias. El ensayo final con una cuenta real en otro perfil aislado sigue siendo una comprobación explícita independiente; los tests no reutilizan credenciales de la app personal.
