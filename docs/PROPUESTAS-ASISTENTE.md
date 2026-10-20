# Propuestas del asistente y decisiones de permisos

Recopilación y decisiones del 19-10-2026. **Diseño y seguimiento: estas decisiones no conceden acceso por sí solas.** PA1 (fuentes y operaciones separadas, documentos concretos y retirada de acceso) está implementado localmente; las demás propuestas siguen pendientes. Las casillas de cada cuenta/proyecto son la autorización efectiva. El editor visual LaTeX se ha corregido tras la revisión e integrado localmente en la rama de trabajo. La entrega del editor visual es independiente de las nuevas acciones de IA.

## Decisiones acordadas

1. **Creación: sí**, con propuesta revisable y destino elegido. Incluye notas, capítulos, diagramas y entradas de Biblioteca; un destino existente no se sobrescribe.
2. **Organización: sí**, con permisos separados para mover/renombrar y enviar a papelera. Mover y renombrar requieren revisión. Borrar exige **dos confirmaciones**: primero revisar archivos, usos y consecuencias; después confirmar expresamente el envío a papelera de la lista definitiva. Cancelar cualquiera conserva los archivos. Cambiar la lista o detectar revisiones obsoletas invalida la confirmación anterior. No incluye borrado permanente ni vaciar la papelera.
3. **Plantillas: por importación**, sobre una copia de trabajo del proyecto LaTeX elegido. El permiso termina al completar o cancelar esa adaptación; otra importación necesita su propia autorización.

Cada capacidad seguirá necesitando una concesión explícita del usuario para las fuentes y destinos correspondientes. Conectar la cuenta no la concede automáticamente.

## Funciones propuestas

| Apartado | Funciones | Resultado esperado |
| --- | --- | --- |
| Notas | Resumir, ordenar ideas, mejorar redacción, sugerir títulos y extraer preguntas pendientes. | Respuesta o propuesta sobre una selección/nota, con revisión. |
| Biblioteca | Resumir una fuente, destacar aportaciones, metodología y limitaciones; explicar imágenes o fragmentos de PDF compatibles. | Síntesis vinculada al documento consultado, diferenciando sus afirmaciones de las inferencias del asistente. |
| Bibliografía | Proponer etiquetas, explicar campos incompletos y sugerir correcciones de metadatos respaldadas por las fuentes. | Campos revisables mediante las operaciones de Biblioteca; referencias nuevas con procedencia verificable. |
| Diagramas | Explicar el dibujo/código, detectar ambigüedades, proponer mejoras y, en una fase posterior, generar o modificar Mermaid. | `.mmd` validado antes de aplicar; vista previa, deshacer y exportación existentes. |
| Memoria | Mejorar claridad y tono académico, resumir o ampliar una selección, explicar fórmulas/LaTeX y señalar afirmaciones que podrían necesitar citas. | Texto propuesto que conserve significado, comandos y referencias; ninguna cita inventada. |
| Plantilla | Explicar opciones y proponer estructura de capítulos y configuración del trabajo. | Propuesta de estructura/campos que se aplica mediante formularios y operaciones existentes. |
| Compilación | Explicar un diagnóstico y proponer una corrección en el fragmento relacionado. | Explicación basada en el error real; compilación y revisión explícitas. |
| Entre apartados | Buscar notas y recursos relacionados con lo que se está escribiendo, explicando el motivo de cada sugerencia. | Candidatos existentes con enlaces y fragmentos, para abrir, citar o insertar. Corresponde a NF2. |

### Buscar contenido para Biblioteca — siguiente bloque

Solicitud del 20-10-2026; pendiente de implementar después de integrar las mejoras actuales.

- Abrir la búsqueda desde el panel de **Biblioteca**, dentro de **Añadir**, en una pestaña propia.
- Escribir el tema o la necesidad y lanzar expresamente la consulta al asistente. Conectar la cuenta o abrir la pestaña no inicia búsquedas.
- Mostrar el **contenido propuesto por la búsqueda** antes de importarlo: título, tipo, URL/DOI u otra procedencia verificable y motivo de la sugerencia. Distinguir resultados comprobados de propuestas sin verificar; no inventar referencias.
- Permitir seleccionar qué resultados añadir y revisar sus datos con los flujos existentes de Biblioteca. Buscar y añadir son acciones separadas; no se crean fichas ni se descargan adjuntos automáticamente.
- Indicar qué consulta y contexto se envían, usar solo las fuentes autorizadas y respetar los límites de la cuenta. La búsqueda externa necesita concretar herramientas/proveedor y permisos; la conexión actual no ofrece navegación por Internet.
- Conservar consulta y resultados ante errores recuperables y revisar duplicados antes de incorporar recursos.

Se diferencia de NF2: esta entrada descubre contenido para añadir; NF2 recomienda notas y recursos que ya existen en la biblioteca/vault según el apartado activo. No amplía los permisos ni las herramientas del bloque que se entrega ahora.

### Menú al seleccionar texto

- Botón contextual «Asistente» al seleccionar, con acceso equivalente por clic derecho y teclado. Acciones ajustadas al contenido: mejorar, resumir, ampliar, cambiar tono, explicar, revisar LaTeX/Mermaid y buscar fuentes.
- Trabaja inicialmente con la selección. Consultar el documento completo u otras fuentes exige el alcance correspondiente; seleccionar texto no autoriza todas sus carpetas.
- Presenta original y propuesta: reemplazar selección, insertar debajo o copiar. Reemplazar/insertar incorpora un cambio al borrador con deshacer; guardar conserva las revisiones y conflictos habituales. Si cambió el fragmento, se exige revisarlo de nuevo.
- En documentos de consulta, como PDF, ofrece explicación/resumen/copia y enlaces; editar su contenido original requiere otro flujo.

### Importar y adaptar proyectos LaTeX

**Formato inicial elegido por el usuario: `.tex` o proyecto `.zip`.** Word y PDF como documentos editables quedan fuera de esta primera propuesta; los PDF siguen disponibles como fuentes de consulta.

1. Importar a una copia de trabajo y analizar documento principal, clase, paquetes, capítulos, bibliografía, imágenes y dependencias. La extracción valida rutas, enlaces, colisiones y límites antes de escribir.
2. Elegir entre conservar/configurar la plantilla del usuario o trasladar su contenido a uno de nuestros perfiles.
3. Proponer la correspondencia de portada, datos, capítulos, anexos, citas y figuras. Mostrar dudas y fragmentos desconocidos para revisión; conservar literalmente lo que no se transforme.
4. Mostrar cambios por archivo, comprobar compilación y presentar incidencias y PDF antes de aceptar el resultado. Una importación que ya falle debe conservar ese diagnóstico inicial.

Adaptar `.cls`, `.sty` o `estilo/` necesita un permiso propio limitado al proyecto importado. No modifica las plantillas distribuidas por la aplicación ni sobrescribe el proyecto original.

## Permisos actuales: punto de partida

Hoy el alcance de cada conversación distingue memoria, Biblioteca y carpetas de notas. Esos permisos habilitan consulta y, donde se admite, propuestas sobre textos existentes: `.tex` y `.bib` manuales de memoria, y `.md` de notas fuera de Biblioteca. PA1 separa lectura y preparación de cambios: esta última requiere su propia casilla. También separa diagramas de memoria y adjuntos de fichas, y permite elegir documentos concretos sin conceder su carpeta.

Los `.mmd` se pueden consultar pero no editar mediante el asistente. Biblioteca gestionada, `estilo/`, `figuras/` y `biblioteca/` no admiten escritura por esa herramienta. No hay herramientas para crear, borrar o renombrar archivos, ejecutar comandos o navegar por Internet. Preparar una propuesta no escribe: aplicar requiere revisión, comprobación de revisiones e historial.

## Modelo de permisos propuesto

Separar **qué fuentes** puede usar de **qué operaciones** puede preparar. Las comprobaciones se aplican en el servidor, también a destinos reales de enlaces y a cada archivo de un lote.

### Fuentes autorizadas

| Alcance | Contenido concedido |
| --- | --- |
| Solo selección | El fragmento elegido y sus identificadores mínimos. Contexto adicional solo tras ampliar el alcance. |
| Documento actual | El archivo concreto elegido, identificado y visible al usuario. |
| Memoria | Fuentes de escritura del proyecto o documentos/carpetas concretos; los diagramas tienen su casilla propia. |
| Notas | Carpetas elegidas; «Todas las notas» sigue siendo una opción explícita. Biblioteca se concede aparte. |
| Diagramas | Fuentes `.mmd` del proyecto; lectura y propuestas independientes. |
| Biblioteca/bibliografía | Fichas y metadatos. Consultar adjuntos PDF/imágenes se concede aparte. |
| Diagnósticos | Diagnósticos y fragmentos pertinentes; ningún acceso general a registros del sistema. |
| Proyecto importado/plantilla | Copia concreta elegida en el asistente de importación; excluye archivos ocultos, credenciales y rutas exteriores. |

Consultar una fuente puede enviar su contenido a OpenAI. La interfaz debe mostrar esta consecuencia antes de conceder el acceso, junto a los archivos o carpetas afectados.

### Operaciones y estado de su diseño

| Permiso | Qué habilita | Estado de diseño |
| --- | --- | --- |
| Consultar | Buscar/leer las fuentes autorizadas y responder. | PA1: ámbitos/documentos concretos, diagramas y PDF/imágenes separados; desmarcados inicialmente. |
| Preparar cambios | Propuestas sobre documentos existentes o campos de Biblioteca autorizados. | PA1: permiso separado para textos actuales; Mermaid y campos gestionados de Biblioteca quedan para PA3. Aplicar requiere revisión. |
| Crear contenido | Preparar nuevos archivos/capítulos/diagramas o entradas de Biblioteca en destinos elegidos. | Acordado: revisión y destino elegido, sin sobrescritura. |
| Mover o renombrar | Proponer operaciones con actualización de enlaces mediante los servicios existentes. | Acordado: permiso propio y revisión antes de aplicar. |
| Enviar a papelera | Proponer retirada con referencias/usos visibles y recuperación. | Acordado: permiso propio y dos confirmaciones sobre la misma lista de archivos. |
| Adaptar plantilla | Propuestas sobre clase, estilo y estructura de una copia importada concreta. | Acordado: autorización por importación y revisión por archivo. |

«Preparar cambios» permite generar una propuesta estructurada; **no autoriza aplicarla sin revisar**. Las respuestas de texto se pueden copiar incluso cuando no se haya concedido ese permiso. Shell, borrado permanente, acceso libre al PC, cambios de credenciales y autoaplicación quedan fuera de esta propuesta.

### Duración y uso

- Propuesta inicial: selección/documento como alcance mínimo; carpetas y ámbitos completos se añaden expresamente. Preferencias de sesión aisladas por cuenta/proyecto, con alcance fijado en cada conversación.
- Cambiar preferencias no amplía una conversación existente. Una acción contextual muestra el alcance efectivo; una nueva conversación usa la configuración elegida. Retirar acceso debe bloquear consultas/aplicaciones futuras y ofrecer terminar o crear una conversación nueva; no puede retirar contenido ya enviado o incluido en su historial.
- Conectar una cuenta no concede acceso a documentos. Cada acción se ejecuta al pulsarla, con contexto y salida acotados; la aplicación habitual funciona sin cuenta. Se conservan controles de sesión, disponibilidad de modelos y errores/cuota existentes.
- NF2 puede comenzar con búsqueda local y selección de candidatos. Embeddings locales/remotos se evalúan aparte; esta propuesta no presupone que conectar ChatGPT habilite una API de embeddings.

## Detalles pendientes y orden sugerido

Las tres decisiones principales ya están acordadas. PA1 concreta la presentación de lectura/propuestas y la retirada definitiva del acceso de un chat. Mantiene el historial y la recuperación local revisable de cambios aplicados; no puede retirar lo ya enviado a OpenAI. No añade permisos a conversaciones antiguas: quedan disponibles para consultar su historial y deshacer cambios; continuar requiere un chat nuevo, evitando reenviar adjuntos del contexto anterior. Las dos confirmaciones de papelera se implementarán en PA4, respetando la lista/revisiones revisadas.

1. **PA1 — implementado localmente:** catálogo de permisos y comprobaciones, documentos concretos, adjuntos y propuestas separados, retirada durante consultas/aplicaciones y recuperación local. Pendiente de integración por Git.
2. **PA2 — en implementación local:** menú contextual para texto seleccionado, Notas/Memoria y bloques/conexiones de diagramas, con preparación de consultas sin envío automático. Pendientes: alcance de solo selección, propuestas sobre borradores y explicación de diagnósticos. Todavía se exige acceso al archivo completo para adjuntar una selección.
3. **PA3 — pendiente:** propuestas Mermaid y metadatos bibliográficos mediante operaciones validadas.
4. **PA4 — pendiente:** recomendaciones NF2, creación de contenido y organización con los permisos acordados.
5. **PA5 — pendiente:** importación/adaptación LaTeX con permiso específico y copia de trabajo.

PA1 se verifica con fuentes/modelo ficticios: validación de permisos, archivos exactos y rutas/enlaces, llamadas forzadas denegadas, ningún envío fuera del alcance, retirada durante una respuesta/aplicación y recuperación local. Las pruebas de interfaz comprueban valores iniciales, aislamiento entre cuentas, no ampliación de chats y retirada.

Verificación nativa del 19-10-2026 con una cuenta real y documentos ficticios aislados: conexión y respuesta, recomendación de configurar permisos, propuesta limitada a un `.tex`, revisión, guardado, deshacer con restauración exacta y bloqueo de nuevos envíos tras retirar acceso. Se corrigió la pérdida de llamadas a herramientas cuando el evento final de ChatGPT omite los elementos ya recibidos por streaming. La compilación TeX queda fuera de esta prueba.

Mejoras de uso del 20-10-2026: autorización contextual limitada a los adjuntos antes de enviar, acciones sugeridas en el chat, respuestas con formato/copia/fuentes pulsables, revisión del bloque cambiado, selector de carpetas, separación de permisos actuales/futuros y ventana ajustable. No completan PA2: siguen pendientes el permiso mínimo de selección y las propuestas en borradores y diagnósticos.

El menú contextual por contenido se incorpora en v0.62: edición habitual, acciones de lectura de Notas/Biblioteca y operaciones existentes del lienzo, además de consultas preparadas para el asistente. No concede permisos nuevos ni implementa edición Mermaid mediante IA. La validación manual con VoiceOver queda como mejora futura en [#81](https://github.com/JavierLoro/estudio-tfg/issues/81), aplazada por decisión del usuario.

Pruebas de los bloques siguientes: aislamiento de cuentas/proyectos y rutas; denegación de cada operación no concedida; ningún envío fuera del alcance; revisión obsoleta sin sobrescritura; revocación durante una acción; conservación de borradores/deshacer; validación Mermaid y de referencias; cancelación en cualquiera de las dos confirmaciones de papelera sin retirar archivos; cambio de lista/revisiones que invalida la confirmación; recuperación desde papelera; importación recuperable sin alterar originales y permiso de adaptación que termina al completar/cancelar. CI usa fuentes y respuestas ficticias.
