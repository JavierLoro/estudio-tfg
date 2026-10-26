import { crc32, deflateRawSync } from 'node:zlib';

/** ZIP mínimo ficticio; permite construir también entradas dañadas para probar rechazos. */
export function zipFixture(entries: { name: string; text?: string; mode?: number; size?: number; crc?: number; compressed?: boolean }[]): Buffer {
  const files: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const bytes = Buffer.from(entry.text ?? '');
    const data = entry.compressed ? deflateRawSync(bytes) : bytes;
    const crc = entry.crc ?? crc32(bytes), size = entry.size ?? bytes.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.compressed ? 8 : 0, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(3 * 256 + 20, 4); header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8); header.writeUInt16LE(entry.compressed ? 8 : 0, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28); header.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
    files.push(local, name, data); central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, index, end]);
}
