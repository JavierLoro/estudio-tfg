export function aboutOptions(version, releaseTag) {
  const source = 'https://github.com/JavierLoro/estudio-tfg' + (releaseTag ? `/tree/${releaseTag}` : '');
  return { type: 'info', title: 'Acerca de Estudio TFG', message: `Estudio TFG ${version}`,
    detail: `Editor LaTeX, notas y biblioteca de recursos.\n\nLicencia: GNU AGPL-3.0.\nCódigo fuente: ${source}\n\nLa plantilla deriva de ARCO (GPL-2.0+). Electron, React, PDF.js, Mermaid, CodeMirror, Dockview, Fastify, fuentes y herramientas TeX conservan sus licencias. Consulta el inventario y los avisos incluidos.`,
    buttons: ['Ver código fuente', 'Licencias y componentes', 'Cerrar'], cancelId: 2, source };
}
