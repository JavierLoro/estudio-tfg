# Biblioteca: almacenamiento y recuperación

## Decisión de producto y autoridad

Biblioteca personal reutilizable en el vault actual. La bibliografía parte de cero; se añaden webs, documentos, imágenes y fichas manuales sin clasificación obligatoria. Los archivos son la fuente de verdad; no hay base de datos del servidor. Los listados/índices se pueden reconstruir. La importación bibliográfica y las citas/figuras en la memoria están disponibles (L3/L4), con recorridos de navegador en CI (L5).

Las fichas siguen siendo Markdown en `NOTES_DIR/RESOURCES_SUBDIR`, con subcarpetas. Título, etiquetas, estado y fecha conservan sus claves habituales; el cuerpo Markdown contiene las notas (puede tener varias secciones y enlaces a otras notas). Los campos nuevos viven bajo `biblioteca`, para no sustituir campos personalizados del formato anterior:

```yaml
---
title: Artículo de ejemplo
captured: 2026-10-11T10:00:00+02:00
status: inbox
tags: [ejemplo]
biblioteca:
  version: 1
  id: 6c61e25d-82db-4f41-bcba-fc801bf4fdf3
  kind: article
  urls: [https://example.org/articulo]
  attachments: [../adjuntos/articulo.pdf, ../adjuntos/figura.png]
  collections: [Estado del arte]
  provenance: {method: manual}
  bibliography:
    authority: library
    entryType: article
    fields: {author: Autor ficticio, year: "2026", doi: ""}
---
## Lectura
Primera nota.
## Ideas
Segunda nota; [[Otra nota]] amplía el tema.
```

`id` es UUID y permanece al renombrar/mover. Tipos: `article`, `book`, `document`, `image`, `web`, `note`, `other`; se infieren al añadir y pueden corregirse. URLs HTTP/HTTPS; adjuntos relativos a **la ficha**, nunca absolutos ni fuera del vault. La app reescribe todos los adjuntos al mover fichas/archivos; movimientos externos no se adivinan y muestran errores de resolución. IDs duplicados/esquemas desconocidos se avisan y no se reparan asignando identidades nuevas silenciosamente.

**Una autoridad bibliográfica:** para `authority: library`, título = `title` de la ficha y los demás campos están en `bibliography.fields` (no se duplica `title`). El `.bib` gestionado es una salida regenerable, nunca otra copia editable. Para `authority: manual`, solo se guarda el vínculo `{path, key}` al `.bib` de la memoria: los campos se editan en ese archivo; no se copian al YAML. Los `.bib` manuales no se reformatean ni sobrescriben. Campos desconocidos se conservan al editar campos conocidos.

## Identidad del destino y cola R2

`<Recursos>/.biblioteca.json` conserva `{version:1,id:<32 hex>}`. Se crea exclusivamente al añadir o preparar/migrar la biblioteca, usando el ID anterior derivado de la ruta: pendientes y recibos existentes siguen teniendo el mismo destino. Tras copiar/mover **biblioteca y registros**, ese ID persiste aunque cambie la ruta. Las lecturas antiguas sin ese archivo siguen siendo compatibles; antes de trasladarlas hay que prepararlas explícitamente. Una identidad corrupta bloquea escrituras, no se sustituye por otra.

Un único servidor escribe por biblioteca. Dos clones con el mismo ID representan el mismo destino: no deben usarse simultáneamente para nuevas capturas; elegir uno y conservar el otro como respaldo. `data/captures/<id>` y `data/library/<id>` deben acompañar a las fichas en respaldo/restauración. El navegador conserva IndexedDB `et:captures`: texto y **todos** los adjuntos antes de enviar, IDs idempotentes por elemento y destino fijo. Un lote se persiste completo antes del primer envío; éxitos no se repiten y fallos se revisan/reintentan individualmente.

## Compatibilidad y migración reversible

Los `.md` antiguos se leen sin escribir ni migrar obligatoriamente. No tienen todavía UUID persistido; su identidad permanente se asigna al migrar. `url`/`attachment` antiguos se muestran mediante el adaptador; en la ficha migrada esos campos se conservan como contenido histórico y `biblioteca.urls/attachments` son la autoridad. El cuerpo, campos desconocidos, comentarios y separadores de línea permanecen intactos. Los archivos adjuntos no se mueven ni recodifican durante la migración.

La vista previa presenta ruta, revisión, campos propuestos y avisos. Aplicar requiere ID de operación, revisión `baseRev` de cada ficha e IDs propuestos únicos. Antes de escribir se guarda intención y copias exactas en `data/library/<id>/migrations/`; cada cambio utiliza bloqueo de archivo, comprobación de revisión, historial y escritura atómica. Una operación completada no se repite. Un fallo intermedio conserva estado por archivo; el reinicio/reintento reconoce bytes ya publicados y continúa sin duplicar. Si hay cambios externos se detiene y muestra qué revisar.

Deshacer comprueba las revisiones de todas las fichas afectadas antes de restaurar sus bytes originales. Cambios posteriores, rutas desaparecidas o renombradas producen conflicto; no se pisa la edición ni se deshacen adjuntos ajenos. Una interrupción del deshacer también queda registrada y es recuperable. La identidad de biblioteca se conserva: deshacer una conversión de fichas no invalida capturas posteriores.

## Creación, edición y borrado

Añadir reutiliza `/api/capture`: los clientes nuevos indican esquema de biblioteca y pueden incluir varios archivos en una ficha; el formato anterior sigue admitido. Recibo preparado y adjuntos temporales se guardan antes de publicar la ficha. La ficha solo se publica cuando todos sus adjuntos están disponibles; cualquier fallo deja material recuperable. Máximo 20 archivos, 50 MiB por archivo y 200 MiB por petición; metadatos externos utilizan la política R5.

Editar exige `baseRev`; 409 conserva el formulario y permite revisar/reaplicar explícitamente. Papelera y movimientos reutilizan las operaciones actuales. Eliminar una ficha no borra adjuntos compartidos ni invalida recibos: no se resucita un recurso al reintentar un recibo terminado. Antes de borrar se conserva la copia en papelera; la interfaz avisa de los usos en la memoria antes de borrar. No se modifica silenciosamente una memoria ni sus figuras/bibliografía.

## Respaldo y verificaciones

El inventario de R7 incluye el archivo de identidad (oculto), fichas, adjuntos y registros duraderos `captures`/`library`. Se amplía la restauración para verificar identidad, varios adjuntos y recuperación de operaciones, además de origen/respaldo intactos. Tests: lectura antigua/nueva, campos desconocidos, movimiento, IDs duplicados, baseRev obsoleto, reintento/fallo parcial, deshacer y traslado. L5 añadirá los recorridos automatizados completos en navegador.

## Importación y uso en la memoria (L3/L4)

Las entradas BibTeX/BibLaTeX, RIS y DOI se revisan antes de escribir. Los originales UTF-8 se conservan sin reformatear en `originales/<sha256>.bib|ris|json`, dentro de Biblioteca; el vínculo bibliográfico guarda formato, huella e índice del original. Son evidencia inmutable, no una segunda autoridad editable. Combinar conserva las referencias a originales anteriores y todos los campos no sustituidos, además de notas y adjuntos. Reimportar el mismo original/entrada encuentra la ficha existente, también si está entre los originales históricos tras combinar. Coincidencias por DOI o título son sugerencias: asociar/combinar exige una elección y `baseRev`; nunca se fusionan automáticamente. Una clave ocupada se sustituye por una propuesta distinta, manteniendo claves ya usadas y los `.bib` manuales intactos.

Los DOI se consultan mediante [Crossref REST, `/works/{doi}`](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), usando la política HTTP R5. Solo se usan datos presentes; un proveedor no compatible o fallo de red deja el DOI para completarlo manualmente. RIS conserva etiquetas desconocidas en el original; las etiquetas TY/ER y los autores repetidos siguen la [documentación de EndNote](https://support.clarivate.com/Endnote/s/article/EndNote-Directions-for-implementing-EndNote-Direct-Export?language=en_US). No se descargan PDF ni se sincronizan gestores externos.

La importación registra decisiones, textos anteriores/propuestos y progreso por elemento en `data/library/<id>/imports/` antes de publicar. El original y los formularios fallidos se conservan; reintentar reconoce los bytes ya publicados y no repite éxitos. Las fichas modificadas externamente producen conflicto. Límites: 1 MiB de fuente, 100 entradas y 20 MiB de registro por lote.

La integración genera `biblioteca/referencias.bib` y copias en `figuras/biblioteca/`, con registro portable en `biblioteca/estado.json`. Son salidas, no otra autoridad editable. La vista previa permite revisar los cambios; todas las escrituras llevan revisiones y dejan historial. Los vínculos `.bib` manuales siguen intactos y las claves ya copiadas no cambian. Macros de originales distintos se aíslan sin perder expresiones, y cada campo asociado se resuelve desde su original, sin confundir padres homónimos de otras fuentes. Se incorporan referencias auxiliares para que la memoria compile sin acceder al vault. Un original dañado o una expresión sin resolver impide exportar silenciosamente datos incompletos.

Insertar conserva el borrador y el texto seleccionado, con deshacer aislado en CodeMirror. Si el principal tiene cambios sin guardar, su conexión bibliográfica se añade al borrador comprobado. Las copias se conservan al eliminar una ficha; actualizar metadatos/imágenes requiere revisar y aplicar otra vista previa. PNG, JPG y PDF son formatos admitidos; para otros se pide conversión explícita. Pie, etiqueta y atribución se incluyen al insertar. Actualizar una copia sustituye solo el archivo y su huella/procedencia: conserva los datos registrados y no edita el LaTeX; el pie/ancho/etiqueta se cambian en el editor. El registro conserva identidad, origen y huella.

Los usos se reconstruyen de los `.tex` guardados y los registros/copias del proyecto actual; llevan a archivo/línea y se muestran antes de borrar. El escáner no expande macros TeX ni observa borradores de otro cliente: estos aparecen al guardar. Las operaciones se recuperan desde `data/library/<id>/integrations/`; una memoria cambiada o una revisión obsoleta detiene la aplicación sin borrar su staging. Respalda tanto estos registros como el proyecto completo.

La CI verifica citas/figuras en ambos perfiles y otra compilación después de copiar cada memoria y retirar su biblioteca original. El comando reproducible está en contrato v0.25; siempre utiliza fixtures y un worker/output temporales propios.
