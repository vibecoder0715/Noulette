import zlib from 'node:zlib';

export interface ZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dataOffset: number;
  isEncrypted: boolean;
  crc32: number;
  getData: () => Buffer;
}

/**
 * Robust pure-TypeScript safe ZIP parser that reads entries and verifies metadata before extraction.
 */
export function parseZipBuffer(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  // Find End of Central Directory Record (EOCD signature 0x06054b50) from the back
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.length, 65536 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    let curCd = cdOffset;

    for (let i = 0; i < totalEntries && curCd < eocdOffset; i++) {
      if (buffer.readUInt32LE(curCd) !== 0x02014b50) break;

      const flag = buffer.readUInt16LE(curCd + 8);
      const isEncrypted = (flag & 1) !== 0;
      const compressionMethod = buffer.readUInt16LE(curCd + 10);
      const crc32 = buffer.readUInt32LE(curCd + 16);
      const compressedSize = buffer.readUInt32LE(curCd + 20);
      const uncompressedSize = buffer.readUInt32LE(curCd + 24);
      const fileNameLen = buffer.readUInt16LE(curCd + 28);
      const extraLen = buffer.readUInt16LE(curCd + 30);
      const commentLen = buffer.readUInt16LE(curCd + 32);
      const localHeaderOffset = buffer.readUInt32LE(curCd + 42);

      const fileName = buffer.toString('utf8', curCd + 46, curCd + 46 + fileNameLen);

      // Local header check
      const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      entries.push({
        fileName,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        dataOffset,
        isEncrypted,
        crc32,
        getData: () => {
          if (isEncrypted) {
            throw new Error('Encrypted zip entry (ARC-004)');
          }
          const rawSlice = buffer.subarray(dataOffset, dataOffset + compressedSize);
          if (compressionMethod === 0) {
            return rawSlice;
          } else if (compressionMethod === 8) {
            return zlib.inflateRawSync(rawSlice);
          } else {
            throw new Error(`Unsupported compression method: ${compressionMethod}`);
          }
        }
      });

      curCd += 46 + fileNameLen + extraLen + commentLen;
    }

    return entries;
  }

  // Fallback: parse local file headers sequentially
  while (offset < buffer.length - 30) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const flag = buffer.readUInt16LE(offset + 6);
    const isEncrypted = (flag & 1) !== 0;
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const crc32 = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);

    const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
    const dataOffset = offset + 30 + fileNameLen + extraLen;

    entries.push({
      fileName,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      dataOffset,
      isEncrypted,
      crc32,
      getData: () => {
        if (isEncrypted) {
          throw new Error('Encrypted zip entry (ARC-004)');
        }
        const rawSlice = buffer.subarray(dataOffset, dataOffset + compressedSize);
        if (compressionMethod === 0) {
          return rawSlice;
        } else if (compressionMethod === 8) {
          return zlib.inflateRawSync(rawSlice);
        } else {
          throw new Error(`Unsupported compression method: ${compressionMethod}`);
        }
      }
    });

    offset = dataOffset + compressedSize;
  }

  return entries;
}

/**
 * Creates an in-memory zip Buffer with custom entries (useful for testing and canaries).
 */
export function createZipBuffer(entries: { name: string; content: Buffer | string; isRawDeflate?: boolean; isEncrypted?: boolean }[]): Buffer {
  const fileRecords: {
    nameBuf: Buffer;
    compressedData: Buffer;
    uncompressedSize: number;
    compressedSize: number;
    crc32: number;
    localHeaderOffset: number;
    isEncrypted: boolean;
  }[] = [];

  const localParts: Buffer[] = [];
  let curOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const contentBuf = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const uncompressedSize = contentBuf.length;

    // Use deflate compression
    let compressedData = contentBuf.length > 0 ? zlib.deflateRawSync(contentBuf) : Buffer.alloc(0);
    let compressionMethod = 8;
    if (contentBuf.length === 0) {
      compressedData = Buffer.alloc(0);
      compressionMethod = 0;
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(entry.isEncrypted ? 1 : 0, 6); // flag
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc32
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    fileRecords.push({
      nameBuf,
      compressedData,
      uncompressedSize,
      compressedSize: compressedData.length,
      crc32: 0,
      localHeaderOffset: curOffset,
      isEncrypted: !!entry.isEncrypted
    });

    localParts.push(localHeader, nameBuf, compressedData);
    curOffset += localHeader.length + nameBuf.length + compressedData.length;
  }

  const centralParts: Buffer[] = [];
  const cdOffset = curOffset;
  let cdSize = 0;

  for (const rec of fileRecords) {
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(rec.isEncrypted ? 1 : 0, 8); // flag
    cdHeader.writeUInt16LE(rec.compressedSize === 0 ? 0 : 8, 10); // method
    cdHeader.writeUInt16LE(0, 12); // time
    cdHeader.writeUInt16LE(0, 14); // date
    cdHeader.writeUInt32LE(rec.crc32, 16);
    cdHeader.writeUInt32LE(rec.compressedSize, 20);
    cdHeader.writeUInt32LE(rec.uncompressedSize, 24);
    cdHeader.writeUInt16LE(rec.nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30); // extra len
    cdHeader.writeUInt16LE(0, 32); // comment len
    cdHeader.writeUInt16LE(0, 34); // disk num
    cdHeader.writeUInt16LE(0, 36); // internal attr
    cdHeader.writeUInt32LE(0, 38); // external attr
    cdHeader.writeUInt32LE(rec.localHeaderOffset, 42);

    centralParts.push(cdHeader, rec.nameBuf);
    cdSize += cdHeader.length + rec.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk num
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(fileRecords.length, 8); // entries on disk
  eocd.writeUInt16LE(fileRecords.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
