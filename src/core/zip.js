'use strict';
// Lector ZIP mínimo (stored + deflate) para .mrpack y el Java de Windows. Sin dependencias.
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

async function openZip(file) {
  const buf = await fsp.readFile(file);
  return readZipBuffer(buf);
}

function readZipBuffer(buf) {
  // Buscar el "End of central directory" (firma 0x06054b50) en los últimos 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // ZIP64
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 no soportado');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central del ZIP dañado');
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Campo extra ZIP64
    let e = p + 46 + nameLen; const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e); const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); }
      }
      e += 4 + len;
    }
    const unixMode = (extAttr >>> 16) & 0xffff;
    entries.push({
      name, method, compSize, size, localOffset,
      isDir: name.endsWith('/'),
      executable: (unixMode & 0o111) !== 0,
      isSymlink: (unixMode & 0o170000) === 0o120000,
      getData() {
        const lh = localOffset;
        if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`Entrada ZIP dañada: ${name}`);
        const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return zlib.inflateRawSync(raw);
        throw new Error(`Compresión ZIP no soportada (${method}) en ${name}`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Une `rel` a `base` impidiendo rutas absolutas o con "..". */
function safeJoin(base, rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) {
    throw new Error(`Ruta no permitida dentro del paquete: ${rel}`);
  }
  const out = path.resolve(base, norm);
  const root = path.resolve(base);
  if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`Ruta no permitida: ${rel}`);
  return out;
}

async function extractAll(file, dest, { strip = '' } = {}) {
  const entries = await openZip(file);
  for (const en of entries) {
    if (strip && !en.name.startsWith(strip)) continue;
    const rel = en.name.slice(strip.length);
    if (!rel || en.isSymlink) continue;
    const out = safeJoin(dest, rel);
    if (en.isDir) { await fsp.mkdir(out, { recursive: true }); continue; }
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, en.getData());
    if (en.executable && process.platform !== 'win32') await fsp.chmod(out, 0o755);
  }
}

module.exports = { openZip, readZipBuffer, extractAll, safeJoin };
