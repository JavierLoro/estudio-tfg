/** SFNT mínimo ficticio para validar tablas y metadatos; no se usa para compilar. */
export function fontFixture(nombre = 'Familia ficticia', estilo = 'Regular') {
  const names = [nombre, estilo, 'Licencia ficticia de prueba'].map(s => { const b = Buffer.from(s, 'utf16le'); return b.swap16(); });
  const name = Buffer.alloc(6 + 36 + names.reduce((n,b) => n+b.length,0)); name.writeUInt16BE(3,2); name.writeUInt16BE(42,4); let offset=0;
  names.forEach((data,i) => { const p=6+i*12; name.writeUInt16BE(3,p); name.writeUInt16BE(1,p+2); name.writeUInt16BE(0x409,p+4); name.writeUInt16BE([1,2,13][i],p+6); name.writeUInt16BE(data.length,p+8); name.writeUInt16BE(offset,p+10); data.copy(name,42+offset); offset+=data.length; });
  const tables = [['head',Buffer.alloc(54)],['cmap',Buffer.alloc(4)],['glyf',Buffer.alloc(4)],['name',name]] as const;
  const buf = Buffer.alloc(12+tables.length*16+tables.reduce((n,[,b]) => n+b.length,0)); buf.writeUInt32BE(0x00010000); buf.writeUInt16BE(tables.length,4); offset=12+tables.length*16;
  tables.forEach(([tag,data],i) => { const p=12+i*16; buf.write(tag,p); buf.writeUInt32BE(offset,p+8); buf.writeUInt32BE(data.length,p+12); data.copy(buf,offset); offset+=data.length; }); return buf;
}
