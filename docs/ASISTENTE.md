# Asistente con ChatGPT

NF1 funciona en Electron, incluido el arranque desde código. La versión web
self-hosted no registra sus rutas. La edición y compilación habituales siguen
disponibles sin conectar una cuenta y sin conexión a Internet.

## Conectar y consultar

1. Abre **Asistente** en la navegación superior. Aparece como una ventana flotante
   compacta, sin reducir el editor ni el PDF. También puedes conectar la cuenta
   desde su icono **Cuenta del asistente** o **Ajustes → Asistente**.
2. Pulsa **Continuar con ChatGPT** y autoriza la app en el navegador del sistema.
   Si aún no hay cuenta, el botón **Conectar cuenta** del chat abre ese diálogo.
   Necesitas una cuenta elegible y permiso para usar su plan. No introduzcas una
   clave API ni copies las credenciales de Codex u otras aplicaciones.
   Tras conectar y autorizar el plan, la ventana recomienda revisar los permisos.
   **Configurar permisos** abre directamente **Ajustes → Asistente** y cierra el
   diálogo de cuenta. Puedes continuar sin autorizar documentos; ninguna casilla
   se activa por conectar. La recomendación también aparece al volver a abrir la cuenta.
3. La rueda **Ajustes del asistente** abre **Ajustes → Asistente**. Allí puedes
   autorizar memoria, diagramas, fichas de Biblioteca y carpetas de notas relativas al
   vault para conversaciones nuevas. También puedes elegir archivos concretos entre
   los documentos abiertos en la app. PDF/imágenes y **Preparar cambios** tienen
   casillas independientes: consultar una fuente no permite modificarla. Todas
   empiezan desmarcadas; una lista vacía
   permite conversar sin documentos. Se aplican al seleccionarlas y se conservan
   durante la sesión, aisladas por cuenta y proyecto; no cambian los permisos de
   conversaciones existentes. Elige el modelo en el selector junto a **Enviar**.
4. Puedes escribir libremente o elegir una acción del documento activo: explicar,
   resumir o revisar. La acción prepara un mensaje editable y adjunta el contexto;
   no lo envía. Si falta acceso, **Autorizar documentos adjuntos** permite concederlo
   solo a esos archivos y, opcionalmente, preparar propuestas. Mantiene el borrador
   y prepara un chat nuevo sin ampliar el anterior ni tus permisos generales.
   Autorizar no consulta nada: pulsa **Enviar** cuando quieras enviarlo a OpenAI.
   Una selección necesita permiso para consultar el archivo completo; el diálogo lo indica.
5. El agente puede buscar y consultar dentro de ese alcance. Las respuestas tienen
   formato, **Copiar** y fuentes pulsables con el nombre del archivo. Puedes abrir
   su actividad o detenerlo. Las imágenes remotas y HTML de una respuesta no se cargan.

Arrastra la cabecera para situar la ventana; el botón **Mover asistente** también
admite flechas (Mayús para pasos mayores). La posición se recuerda y se ajusta al
reducir la ventana de la app. **Minimizar** deja solo la cabecera; **Cerrar** oculta
el asistente. Ambos conservan la conversación y el mensaje pendiente durante esa
sesión y permiten seguir trabajando en Inicio, Biblioteca o el editor. Para parar
una consulta usa **Detener**. Al reabrir desde la barra o el editor se restaura la
ventana. La cuenta se abre desde su icono de la cabecera; los permisos están en
Ajustes. Historial y actividad conservan sus desplegables.

La esquina **Cambiar tamaño del asistente** permite ajustar ancho y alto arrastrando
o con flechas al enfocarla; Mayús aumenta el paso e Inicio restaura el tamaño original.
El tamaño se recuerda y se limita al espacio disponible.

## Menú contextual

Haz clic derecho sobre el texto o usa **Mayús+F10** en el editor o una zona de lectura
enfocada. El menú cambia si hay selección y si estás en Notas, Memoria o código Mermaid.
Incluye edición habitual y, en escritorio, explicar, resumir o mejorar redacción.
Las acciones del asistente preparan el mensaje y adjuntan su contexto; conserva tu
borrador anterior y no consulta nada hasta que pulses **Enviar**. La selección aún
requiere autorizar el archivo completo, tal como indica el diálogo de permisos.

En diagramas, el clic derecho sobre un bloque ofrece sus propiedades, texto,
conexión y borrado recuperable; una conexión ofrece etiqueta y borrado, y el fondo
permite añadir elementos. Usa Mayús+F10 con un elemento seleccionado para el mismo
menú. Las acciones del asistente indican qué bloque o conexión quieres consultar
y adjuntan el Mermaid del diagrama; todavía no permiten modificarlo mediante IA.

El botón del editor envía la selección o el documento actual, incluido su borrador;
el de Biblioteca añade la ficha. El documento debe pertenecer al alcance de la
conversación. Si no lo está, la autorización contextual conserva mensaje y adjuntos.
Para cambiar de modelo, inicia otra conversación. En Ajustes, **Esta conversación**
muestra el alcance efectivo y **Próximas conversaciones** conserva las preferencias
generales; puedes elegir carpetas sin escribir rutas o introducirlas manualmente.

En **Ajustes → Asistente → Esta conversación**, **Retirar acceso de esta
conversación** detiene la consulta y bloquea nuevos mensajes y aplicación de
propuestas. No elimina el historial local ni retira contenido ya enviado a OpenAI.
La retirada es definitiva para ese chat; inicia otro con los permisos que elijas.
Los cambios guardados pueden seguir revisándose y deshaciéndose localmente.

La búsqueda usa nombres, texto y metadatos existentes; no indexa semánticamente
todos los PDF. El agente puede consultar los PDF e imágenes que encuentre en las
fuentes autorizadas solo con el permiso independiente de adjuntos. Admite PDF,
PNG, JPEG y WebP con un modelo compatible. No sigue
enlaces web ni ejecuta comandos. Los documentos se tratan como datos, no como
instrucciones que puedan ampliar los permisos.

## Revisar y guardar cambios

Con **Preparar cambios** concedido, el agente prepara propuestas de archivos existentes: `.tex` de la memoria,
notas `.md` fuera de Biblioteca y `.bib` manuales. Excluye `estilo/`, `figuras/`,
`biblioteca/`, configuración y archivos ocultos. Las referencias nuevas se añaden
por Biblioteca; no se inventan claves ni se modifica su bibliografía generada.

Las conversaciones anteriores a esta separación quedan disponibles para consultar
el historial y deshacer cambios guardados. Para enviar otro mensaje o preparar/
aplicar propuestas, inicia una conversación nueva y elige los permisos actuales.
Así no se reenvían adjuntos del historial con permisos incompletos; las copias
locales y la recuperación de lo ya aplicado se conservan.

Guarda expresamente los borradores afectados antes de preparar el lote. **Revisar
cambios** destaca el fragmento sustituido y permite desplegar los archivos completos.
Los cambios dispersos pueden agruparse en un bloque. Elige los archivos y confirma
**Aplicar y guardar**. Preparar una propuesta no modifica documentos. Si alguno
cambió desde la consulta, se conserva la propuesta y se informa del conflicto sin
pisar la versión nueva.

Cada escritura es atómica y conserva historial. El conjunto tiene un registro de
progreso: si se interrumpe, vuelve a abrir la conversación y elige **Revisar y
completar** o **Revisar y deshacer**. Deshacer también comprueba las revisiones y
rechaza sobrescribir ediciones posteriores. No hay atomicidad simultánea entre
archivos; una interrupción puede dejar un conjunto parcialmente aplicado hasta
su recuperación explícita. No borres `DATA_DIR/assistant/` para desbloquearlo.

## Cuentas, datos y límites

- Cada registro de cuenta conserva su identidad y cliente propios. Cambiar cuenta
  o proyecto detiene las consultas y evita mezclar conversaciones o propuestas.
- Los tokens se cifran con el almacén seguro del sistema bajo
  `DATA_DIR/chatgpt/`; no llegan al renderer, localStorage, logs ni documentos.
  Sin un almacén seguro, se mantienen solo durante la sesión. La app nunca cambia
  automáticamente a facturación mediante API.
- Conversaciones, contexto enviado y propuestas viven en `DATA_DIR/assistant/`,
  con permisos privados y sin base de datos. Incluyen copias de los adjuntos
  enviados para poder continuar sin sustituirlos por versiones posteriores.
  **Borrar** elimina el chat y sus adjuntos; si hay cambios aplicados conserva un
  registro identificado como «Cambios archivados» para poder deshacerlos. Las
  operaciones interrumpidas deben recuperarse antes de borrar su conversación.
- **Desconectar** intenta revocar la sesión y elimina los tokens locales. Si falla
  la red, revisa el acceso desde los ajustes de ChatGPT. No copies credenciales
  cifradas a otro equipo ni las incluyas en diagnósticos o copias compartidas.
- Cada conversación admite 100.000 caracteres de contexto y 20 MiB de adjuntos
  acumulados. Cada turno admite ocho rondas y veinticuatro llamadas a herramientas;
  solo hay un turno activo por instancia. Al alcanzar el presupuesto, crea otra
  conversación: el historial anterior permanece localmente.
- El uso depende del plan, cuenta, modelo y permisos de OpenAI. **Gestionar uso**
  abre los ajustes de ChatGPT. PDF e imágenes también consumen contexto y uso.
  Una respuesta parcial o interrumpida no se presenta como consulta completada.

## Verificación

Las pruebas usan OAuth, modelos y fuentes ficticios; CI no necesita una cuenta ni
hace llamadas de pago. El recorrido nativo comprueba búsqueda, revisión de dos
archivos, guardado, deshacer y reapertura. La conexión y respuesta reales con una
cuenta elegible se comprobaron el 15-10-2026, en una ventana separada con documentos
ficticios y confirmación del usuario. No se enviaron sus fuentes personales.

La integración directa sigue el [registro OAuth de OpenAI](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
la [gestión de sesiones](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
y las [limitaciones de la preview](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
La disponibilidad futura y los límites no están garantizados por la app.

## Contexto del TFG

En Ajustes → Asistente, rellena la ficha y guarda su selección. El título sigue en Datos del trabajo. Desactivado conserva las elecciones sin elaborar ni enviar contexto. Todo incluye también nuevos documentos compatibles de las raíces configuradas; Parcial permite ámbitos completos, carpetas y archivos. Las exclusiones prevalecen. El checkbox de una nota edita esta misma selección, sin tocar Obsidian; desmarcar desde Todo pasa a Parcial y lo indica.

Autoriza por separado elaborar propuestas, usar el contexto y preparar diagramas nuevos. Cada cuenta/proyecto comienza con esas casillas cerradas. Los permisos del chat sobre originales, adjuntos y modificaciones siguen siendo independientes. Los cambios locales solo producen avisos: nunca se consulta IA al editar. Los derivados de archivos modificados, eliminados o excluidos quedan fuera de los próximos envíos.

Guarda los borradores y elige un modelo para **Actualizar contexto**. Cada propuesta procesa tres fragmentos de hasta 20.000 caracteres; muestra procedencia, revisión, cambios y pendientes. Corrige los resúmenes antes de aceptar, o rechaza la propuesta; **Deshacer última actualización** recupera el conjunto anterior sin reactivar fuentes retiradas. Continúa los documentos grandes pulsando Actualizar otra vez. El límite por archivo compatible es 2 MiB; los no consultables aparecen con aviso.

Antes de enviar un chat o generar un diagrama, revisa el **Contexto efectivo antes de enviar** y marca expresamente Usar contexto del TFG. Su versión se conserva en el historial; si una fuente de un chat previo cambia o se retira, inicia una conversación nueva para que el contenido retirado no vuelva a enviarse. El historial local permanece.

## Diagramas con asistente

En Nuevo diagrama elige **Con asistente**, nombre, uno de los quince tipos y descripción. Concede su permiso propio en Ajustes y elige un modelo disponible. **Generar propuesta** conserva código, explicación y supuestos, sin crear archivos. Puedes recuperar propuestas, detener la generación, corregir el código o pedir otra expresamente. **Crear diagrama** solo se habilita cuando la propuesta se dibuja correctamente con el renderer existente. Nunca sobrescribe un nombre ocupado. La exportación y la inserción en Memoria se realizan después; no se ofrece edición asistida de diagramas existentes.

## Descubrir fuentes públicas

Biblioteca → Añadir → Buscar con asistente mantiene un permiso propio por cuenta/proyecto. No concede navegación al chat. Rápida usa un agente; Ampliada coordina dos especialistas desde la app. El modelo auxiliar se conserva por cuenta/proyecto en una preferencia duradera con revisión, incluso antes de ejecutar; elige otro expresamente si deja de estar disponible. No se presupone ahorro de cuota ni soporte web en todos los modelos.

Solo la necesidad y filtros visibles llegan a los buscadores; nunca los documentos privados ni el resumen completo del TFG. Si marcas el contexto, una valoración posterior sin navegación utiliza su versión autorizada. Retirar acceso corta tareas y bloquea nuevos envíos, incluso de derivados del contexto, conservando el historial local. Las explicaciones se vinculan a fuentes efectivamente devueltas y se identifican como inferencias, no como evaluación de calidad científica.

La bandeja es independiente de Biblioteca. Permite detener, retomar consultas y reintentar partes fallidas; no incorpora ni descarga al cerrar. Guarda solo después de revisar datos y duplicados. Consulta los límites y la recuperación en la guía de Biblioteca.

Validación automatizada de estos bloques: OAuth/proveedores ficticios, privacidad de contexto, límites, conflictos, persistencia, parciales, recibos y recorridos de navegador/Electron. La búsqueda web real depende de la cuenta/modelo: **queda pendiente el ensayo final con una cuenta conectada en un perfil aislado** (Rápida, Ampliada, contexto seleccionado y un diagrama). No se han copiado credenciales de la app personal ni consumido su suscripción para estos tests.
