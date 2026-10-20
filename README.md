# Estudio TFG

**Tu TFG, de las primeras notas al PDF final.**

Escribe la memoria, consulta tus apuntes, reúne bibliografía y crea diagramas en un mismo espacio. Estudio TFG conecta el material que investigas con el documento que estás escribiendo, con tus archivos guardados en tu equipo.

[![CI](https://github.com/JavierLoro/estudio-tfg/actions/workflows/ci.yml/badge.svg)](https://github.com/JavierLoro/estudio-tfg/actions/workflows/ci.yml)

**[Descargar la app](https://github.com/JavierLoro/estudio-tfg/releases)** · [Guía técnica](docs/README.md) · [Hoja de ruta](docs/HOJA-DE-RUTA.md)

## Un espacio para avanzar con tu trabajo

De una idea en tus notas a una cita en la memoria. De un esquema a una figura lista para el PDF. Ten a mano lo que necesitas mientras redactas.

| Lo que necesitas | Cómo te ayuda Estudio TFG |
| --- | --- |
| **Escribir y ver el resultado** | Memoria en LaTeX con modos Visual y Código. PDF fijo a la derecha, con ancho ajustable, búsqueda y navegación entre el texto y su página. |
| **Aprovechar tus apuntes** | Abre tus notas de Obsidian, sigue enlaces y alterna lectura y edición sin salir de la app. |
| **Encontrar y citar tus fuentes** | Biblioteca de referencias, PDF, imágenes y webs. Importa BibTeX, RIS o DOI y lleva citas y figuras al documento. |
| **Explicar una idea con un diagrama** | Crea flujos, secuencias, mapas mentales, cronologías y más. Usa controles visuales, formularios o código, y exporta figuras en PDF vectorial. |
| **Consultar mientras escribes** | Multivista combina dos apartados, permite ajustar sus tamaños y guarda tus distribuciones favoritas. |
| **Pedir ayuda sobre tu contenido** | Asistente flotante con tu cuenta de ChatGPT: prepara consultas desde una selección y revisa propuestas antes de guardarlas. Tú eliges a qué documentos puede acceder. |

El modo Visual facilita la redacción básica; fórmulas, macros y estructuras avanzadas siguen disponibles en Código. El asistente es opcional y su disponibilidad depende de tu cuenta y plan. [Conoce su funcionamiento](docs/ASISTENTE.md).

## Tus archivos, tu forma de trabajar

Tu memoria y tus notas viven en las carpetas que eliges. LaTeX, Markdown, BibTeX y Mermaid permiten seguir utilizando tus documentos con otras herramientas.

La compilación del PDF se realiza localmente y puede funcionar sin conexión una vez preparado el motor. Si conectas el asistente, las consultas y fuentes que autorices se envían a OpenAI.

Historial de guardados, borradores recuperables y detección de conflictos te ayudan a retomar el trabajo. Para proteger el conjunto, consulta la [guía de copias de seguridad](docs/RESPALDO.md).

## Instalar la app de escritorio

Disponible para **macOS, Windows y Linux**, con dos variantes: **completa / offline** y **ligera / online**. La app instalada prepara su motor de compilación; no necesitas instalar Node, Docker ni TeX por separado.

<details>
<summary><strong>Ver cómo descargarla e instalarla</strong></summary>

1. Abre [GitHub Releases](https://github.com/JavierLoro/estudio-tfg/releases) y elige el paquete de tu sistema y arquitectura.
2. Elige **completa / offline** para preparar TeX sin conexión, o **ligera / online** para descargarlo la primera vez. Después, ambas compilan localmente sin red.
3. En macOS, abre el `.dmg` y arrastra la app a Aplicaciones. En Windows, utiliza el instalador `.exe` o la variante portable. En Linux, abre la `.AppImage` con permiso de ejecución.
4. Sigue el asistente inicial para elegir tus carpetas, crear la memoria y preparar el primer PDF.

Las versiones actuales se distribuyen sin firma digital ni notarización y pueden mostrar avisos del sistema. Consulta los [pasos de instalación, compatibilidad y avisos por plataforma](docs/README.md#instalar-la-app-de-escritorio).

</details>

## Empieza con tu memoria

<details>
<summary><strong>De un proyecto nuevo a tu primer PDF</strong></summary>

1. **Elige tus carpetas.** Usa un vault de Obsidian existente o crea notas nuevas. Selecciona también dónde guardar la memoria.
2. **Prepara el documento.** Crea una memoria desde una plantilla y completa título, autor y tutor en **Datos del trabajo**.
3. **Redacta.** Abre un capítulo y elige Visual o Código. Guarda y pulsa **Compilar** para actualizar el PDF de la derecha.
4. **Añade tus fuentes.** En **Biblioteca**, incorpora documentos, imágenes, webs o referencias. Revisa sus datos e inserta citas y figuras en la memoria.

Las carpetas y el motor se pueden cambiar desde **Ajustes**. [Consulta la guía de uso completa](docs/README.md#qué-puedes-hacer).

</details>

<details>
<summary><strong>Organiza tu espacio y trabaja con el asistente</strong></summary>

- Abre **Multivista**, elige un apartado a cada lado y ajusta el separador. **Guardar vista** permite recuperar esa distribución después.
- Usa **Buscar** o `⌘K` / `Ctrl+K` para localizar archivos, recursos y texto.
- Abre el **Asistente**, conecta una cuenta elegible y revisa los permisos en Ajustes. Puedes empezar una consulta desde el menú contextual de una selección o documento.
- Revisa las propuestas de edición antes de aplicarlas. Conectar la cuenta no concede acceso automático a tus archivos.

[Funciones y atajos](docs/README.md#qué-puedes-hacer) · [Asistente y permisos](docs/ASISTENTE.md)

</details>

## Ejecutarlo desde el código

<details>
<summary><strong>Probar la app de escritorio en desarrollo</strong></summary>

Necesitas **Node 24 o posterior** y npm. Desde una terminal:

```bash
git clone https://github.com/JavierLoro/estudio-tfg.git
cd estudio-tfg
npm run install:all
npm install --prefix desktop
npm run desktop:dev
```

Al guardar cambios en el código, el entorno reconstruye la app y solicita su recarga o reinicio. Conserva un perfil separado en `workspace/desktop-dev/`, con documentos de prueba iniciales. Si seleccionas otras carpetas, los archivos se editan en su ubicación real.

La primera preparación del motor requiere conexión; después se reutiliza. Este comando abre la app de desarrollo sin generar instaladores. [Detalles del entorno de escritorio](desktop/README.md).

</details>

<details>
<summary><strong>Levantar la versión web con Docker o Node</strong></summary>

Puedes alojar Estudio TFG en tu propio equipo o servidor y acceder desde el navegador.

- **Con Docker:** sigue la [configuración de carpetas y el arranque con Compose](docs/README.md#usarlo-con-docker-windows-mac-linux).
- **Con Node:** sigue el [arranque nativo de servidor y web](docs/README.md#desarrollar-server-y-web-nativos), con Docker o TeX como motor de compilación.

La conexión con tu cuenta de ChatGPT está disponible en la app de escritorio. [Consulta las diferencias y requisitos por plataforma](docs/PLATAFORMAS.md).

</details>

## Un proyecto abierto, en evolución

Consulta las notas de cada release para conocer su alcance y la [hoja de ruta](docs/HOJA-DE-RUTA.md) para ver lo que viene después.

¿Quieres contribuir? Empieza por la [guía técnica](docs/README.md#contribuir), las [reglas del repositorio](AGENTS.md) y la [especificación del producto](docs/CONTRACT.md).

Estudio TFG se distribuye bajo [AGPL-3.0](LICENSE). La plantilla conserva la licencia y atribución de su base ARCO; los [créditos y componentes de terceros](docs/README.md#licencia) están en la guía técnica.
