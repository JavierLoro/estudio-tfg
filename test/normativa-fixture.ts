export function normativaFixture(duda = false) {
  return {
    ajustes: [
      { ambito: 'institucion', campo: 'universidad', nombre: 'Universidad', valor: 'Universidad ficticia', pagina: 1, cita: 'Universidad ficticia' },
      { ambito: 'institucion', campo: 'margenInterior', nombre: 'Margen interior', valor: '35mm', pagina: 1, cita: 'Margen interior de 35 mm.' },
      { ambito: 'institucion', campo: 'fuenteTexto', nombre: 'Fuente del texto', valor: 'latinmodern', pagina: 1, cita: 'Se utilizará Latin Modern.' },
      ...(!duda ? [{ ambito: 'institucion', campo: 'margenExterior', nombre: 'Margen exterior', valor: '20mm', pagina: 1, cita: 'Margen exterior: 20 o 25 mm, a elegir.' }] : []),
    ],
    capitulos: [
      { titulo: 'Introducción', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
      { titulo: 'Evaluación', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
      { titulo: 'Conclusiones', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
    ],
    portadas: null,
    dudas: duda ? [{ id: 'margen', pregunta: '¿Qué margen exterior quieres utilizar?', opciones: ['20 mm', '25 mm'], pagina: 1, cita: 'Margen exterior: 20 o 25 mm, a elegir.' }] : [],
    limitaciones: ['El logotipo del centro debe añadirse después de crear la memoria.'],
  };
}
