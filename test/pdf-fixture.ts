/** PDF ficticio de dos páginas, sin herramientas ni fuentes externas. */
export function pdfFixture(): Buffer {
  const stream = (lines: string[]) => {
    const commands = 'BT /F1 12 Tf 45 760 Td ' + lines.map((line, i) => (i ? '0 -24 Td ' : '') + '(' + line.replace(/[\\()]/g, '\\$&') + ') Tj').join('\n') + ' ET\n';
    return `<< /Length ${Buffer.byteLength(commands, 'latin1')} >>\nstream\n${commands}endstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    stream(['Universidad ficticia', 'Margen interior de 35 mm.', 'Margen exterior: 20 o 25 mm, a elegir.', 'Se utilizará Latin Modern.', 'Se incluirá el logotipo del centro.']),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    stream(['Apartados obligatorios', 'Introducción, evaluación y conclusiones.']),
  ];
  let text = '%PDF-1.4\n', offset = text.length;
  const offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(offset);
    const object = `${i + 1} 0 obj\n${value}\nendobj\n`;
    text += object; offset += Buffer.byteLength(object, 'latin1');
  });
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}
