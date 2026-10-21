# Verificación del frontal A

18 de octubre de 2026. Alcance: incorporar la **idea de Familiar** a la app existente, conservando los editores, el visor y sus estados reales.

## Referencia y evidencias

- Referencia seleccionada: `workspace/propuestas-frontal/diseno-a-familiar.jpg`.
- Aplicación real: `http://127.0.0.1:5191/`, API aislada y documentos ficticios temporales.
- Captura final: `workspace/frontal-a-verificacion/app-a-entrega.jpg`.
- Tamaño mínimo comprobado: `workspace/frontal-a-verificacion/app-a-900.jpg`.
- Referencia y captura final: 1470 × 802 píxeles; viewport CSS 1470 × 802. El navegador informa DPR 2; la API de captura entrega imágenes normalizadas a píxeles CSS. No se reescalaron las evidencias.

Las dos capturas completas se abrieron juntas para comparar estructura, jerarquía y densidad. No hizo falta un recorte adicional: los nombres y controles son legibles en las capturas a resolución original y se contrastaron con el árbol de accesibilidad. El viewport de 900 × 650 se restableció al terminar.

## Adaptaciones intencionadas

La referencia es clara; la app conserva el tema automático del sistema y se verificó en oscuro. La solicitud selecciona la idea de A, no una reproducción píxel a píxel. Se mantienen los tokens de ambos temas y los estados reales de guardado y compilación.

El lateral conserva sus 260 px y su ancho guardado, frente a los 190 px del ejemplo simplificado. El editor conserva números de línea, resaltado y acciones existentes. Se elimina el marco de comparación del prototipo y se mantienen búsqueda, conflictos y avisos reales. El asistente está sin conectar en el perfil de prueba; no se reutiliza ninguna cuenta personal. El PDF ficticio está precargado para probar el visor, no se presenta como una compilación TeX ejecutada.

## Superficies revisadas

- **Tipografía:** Source Sans 3 local para la interfaz y fuente monoespaciada del editor. Nombres visibles, truncado de rutas y controles legibles en el tamaño mínimo de escritorio.
- **Composición:** navegación horizontal, barra de estado, acciones con texto, explorador lateral y dos grupos Dockview. Sin desbordamiento horizontal del viewport. Los controles principales permanecen visibles a 900 × 650.
- **Colores:** tokens semánticos existentes, selección azul, guardado verde y advertencias diferenciadas. El PDF sigue siendo una página clara, con la opción de inversión ya existente.
- **Activos:** logotipo PNG local proporcionado e iconos Lucide instalados. Sin iconos dibujados como sustitutos ni nuevas dependencias.
- **Texto:** interfaz en español; «Actualizar PDF» describe la acción y su título explica que guarda y compila. «Apartados» conserva el esquema anterior. Los mensajes de conexión y permisos del asistente son reales.

## Hallazgos y correcciones

1. **P2, primera captura:** el encabezado «Archivos de la memoria» se partía junto a los botones del explorador. Se acortó a «Memoria». La captura final y la comprobación a 900 px muestran el título en una línea.
2. **P2, primera revisión:** «LaTeX» no explicaba el fallo del motor. Se sustituyó por «Motor PDF no disponible», conservando el detalle técnico en el título. Se comprobó que cabe con el estado de guardado y Añadir.

Tras esas correcciones se volvió a capturar la app y se repitió la comparación con A. No quedan diferencias P0/P1/P2 dentro del alcance de adaptación descrito.

## Interacciones y validación

- Borrador real conservado al abrir Biblioteca y volver; ambos grupos siguen presentes y el asistente continúa superpuesto. Aserciones sobre el DOM comprobadas.
- Guardar todo desde la barra escribe el archivo ficticio en disco y restablece «Todo guardado».
- Abrir notas, ocultar/mostrar lateral y selección Archivos/Apartados comprobados. Apartados y los dos grupos se recuperan tras recargar.
- Asistente: arrastre real, flechas, minimizar/restaurar y ajuste al tamaño mínimo sin salir de la ventana.
- 42 tests de scripts y 851 tests del servidor correctos. TypeScript de servidor y web y build Vite correctos; `git diff --check` limpio.
- Consola del navegador sin errores en la verificación final.

Pendientes: renderizado en tema claro, lectores de pantalla y comprobación nativa en Windows/Linux. No se repitió la suite E2E completa ni una compilación TeX real; no se modificaron esos motores. No se han generado instaladores.

final result: passed
