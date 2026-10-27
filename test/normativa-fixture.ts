export function normativaFixture() {
  return {
    ajustes: [
      { ambito: 'institucion', campo: 'universidad', nombre: 'Universidad', valor: 'Universidad ficticia', pagina: 1, cita: 'Universidad ficticia' },
      { ambito: 'institucion', campo: 'margenInterior', nombre: 'Margen interior', valor: '35mm', pagina: 1, cita: 'Margen interior de 35 mm.' },
      { ambito: 'institucion', campo: 'fuenteTexto', nombre: 'Fuente del texto', valor: 'latinmodern', pagina: 1, cita: 'Se utilizará Latin Modern.' },
      { ambito: 'institucion', campo: 'margenExterior', nombre: 'Margen exterior', valor: '20mm', pagina: 1, cita: 'Margen exterior: 20 o 25 mm, a elegir.' },
    ],
    capitulos: [
      { titulo: 'Introducción', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
      { titulo: 'Evaluación', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
      { titulo: 'Conclusiones', pagina: 2, cita: 'Introducción, evaluación y conclusiones.' },
    ],
    portadas: null,
    supuestos: ['Se ha elegido un margen exterior de 20 mm porque la guía permite 20 o 25 mm.'],
    limitaciones: ['El logotipo del centro debe añadirse después de crear la memoria.'],
  };
}
