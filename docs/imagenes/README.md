# Imágenes del README

Las capturas de la interfaz se tomaron el 22 de octubre de 2026 en Chromium, a 1600 × 1000 píxeles. Se guardan en PNG, sin retoques de la interfaz, y se pueden ampliar desde el README principal. La comparación de motores se preparó el 26 de octubre, también a 1600 × 1000 píxeles.

El proyecto «Una red ciclista para el campus» es completamente ficticio. Se preparó en carpetas temporales separadas de la memoria, las notas y los ajustes personales. Los nombres, referencias, textos y resultados no son fuentes académicas reales.

| Archivo | Qué muestra |
| --- | --- |
| `memoria-visual.png` | Redacción visual de LaTeX y visor con un PDF de muestra. |
| `multivista-notas.png` | Memoria y nota Markdown en paralelo, con tema oscuro. |
| `biblioteca.png` | Cinco recursos de distintos tipos y una ficha de consulta. |
| `diagramas.png` | Editor Mermaid del proyecto; captura anterior conservada. |
| `comparacion-diagramas.png` | El mismo flujo con Mermaid a la izquierda y Excalidraw a la derecha. |
| `busqueda-asistida.png` | Bandeja con candidatos y explicaciones de un proveedor ficticio. |

Se reutilizaron el servidor y el proveedor de pruebas de `test/e2e`, con textos específicos para esta demostración. El PDF de muestra se generó por separado; su respuesta y el estado del motor se simularon en el navegador. No se ejecutó una compilación TeX ni se llamó a ChatGPT o a Crossref. La búsqueda no añadió fichas a Biblioteca.

La comparación combina renderizados SVG reales de la plantilla **Flujo**: Mermaid mediante `renderDiagram` de `web/src/lib/diagram.ts` y Excalidraw mediante `exportToSvg`, a partir de `web/src/assets/excalidraw/flujo.excalidraw`. Se compusieron en HTML con los dos nombres y un separador, y se capturaron en Chromium. Las fuentes son las incluidas en la app; no hubo peticiones externas ni se utilizó contenido personal. Es una comparación de las salidas de los motores, no una captura de sus interfaces.

El logo del encabezado reutiliza `desktop/icons/macos.png`, sin modificar el archivo original. Estas capturas documentan el producto; no sustituyen las pruebas de compilación ni las comprobaciones con una cuenta real.
