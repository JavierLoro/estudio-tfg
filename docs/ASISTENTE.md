# Asistente con ChatGPT

NF1 funciona en Electron, incluido el arranque desde código. La versión web
self-hosted no registra sus rutas. La edición y compilación habituales siguen
disponibles sin conectar una cuenta y sin conexión a Internet.

## Conectar y consultar

1. Abre **Asistente** en la barra lateral, o la sección ChatGPT de Ajustes.
2. Pulsa **Continuar con ChatGPT** y autoriza la app en el navegador del sistema.
   Necesitas una cuenta elegible y permiso para usar su plan. No introduzcas una
   clave API ni copies las credenciales de Codex u otras aplicaciones.
3. En una conversación nueva, elige el modelo y autoriza las fuentes: memoria,
   biblioteca con adjuntos y carpetas de notas relativas al vault. Todas empiezan
   desmarcadas; una lista vacía permite conversar sin documentos.
4. Envía tu petición. El agente puede buscar y consultar dentro de ese alcance;
   su actividad y los enlaces a las fuentes aparecen en el panel. Puedes detenerlo.

El botón del editor envía la selección o el documento actual, incluido su borrador;
el de Biblioteca añade la ficha. El documento debe pertenecer al alcance de la
conversación. Para ampliar permisos o cambiar de modelo, inicia otra conversación.

La búsqueda usa nombres, texto y metadatos existentes; no indexa semánticamente
todos los PDF. El agente puede consultar los PDF e imágenes que encuentre en las
fuentes autorizadas. Admite PDF, PNG, JPEG y WebP con un modelo compatible. No sigue
enlaces web ni ejecuta comandos. Los documentos se tratan como datos, no como
instrucciones que puedan ampliar los permisos.

## Revisar y guardar cambios

El agente prepara propuestas de archivos existentes: `.tex` de la memoria,
notas `.md` fuera de Biblioteca y `.bib` manuales. Excluye `estilo/`, `figuras/`,
`biblioteca/`, configuración y archivos ocultos. Las referencias nuevas se añaden
por Biblioteca; no se inventan claves ni se modifica su bibliografía generada.

Guarda expresamente los borradores afectados antes de preparar el lote. **Revisar
cambios** muestra cada versión anterior y propuesta; elige los archivos y confirma
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
