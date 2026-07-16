import zlib from 'node:zlib';

export const DEFAULT_SHEET_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SalesAudit/2.0; +https://sales-audit-2-0.onrender.com)',
  Accept: '*/*',
};

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const mimeForPath = (filePath) => {
  const ext = String(filePath || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  return MIME_BY_EXT[ext] || 'image/jpeg';
};

/**
 * Extract embedded bill images from a Google Sheets XLSX export buffer.
 * Images are stored under xl/media/ inside the zip package.
 */
export const extractMediaFromXlsxBuffer = (buffer) => {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 22) return [];

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const images = [];
  let offset = cdOffset;

  for (let e = 0; e < totalEntries; e++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break;

    const compression = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString('utf8', offset + 46, offset + 46 + fileNameLen);

    offset += 46 + fileNameLen + extraLen + commentLen;

    if (!fileName.startsWith('xl/media/')) continue;
    if (localHeaderOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) continue;

    const compressed = buf.subarray(dataStart, dataEnd);
    let data;
    try {
      if (compression === 0) data = Buffer.from(compressed);
      else if (compression === 8) data = zlib.inflateRawSync(compressed);
      else continue;
    } catch {
      continue;
    }

    if (data.length < 50) continue;
    images.push({
      name: fileName,
      mime: mimeForPath(fileName),
      data,
    });
  }

  images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return images;
};
