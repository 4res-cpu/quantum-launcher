'use strict';
// NBT (big-endian, sin comprimir) para leer/escribir servers.dat.
// Representación: { type, value } ; compuesto => value es un Map nombre -> tag ; lista => { type: 9, elem, value: [tags] }
const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

function read(buf) {
  let p = 0;
  const u8 = () => buf.readUInt8(p++);
  const str = () => { const n = buf.readUInt16BE(p); p += 2; const s = buf.toString('utf8', p, p + n); p += n; return s; };
  function payload(type) {
    switch (type) {
      case T.BYTE: { const v = buf.readInt8(p); p += 1; return v; }
      case T.SHORT: { const v = buf.readInt16BE(p); p += 2; return v; }
      case T.INT: { const v = buf.readInt32BE(p); p += 4; return v; }
      case T.LONG: { const v = buf.readBigInt64BE(p); p += 8; return v; }
      case T.FLOAT: { const v = buf.readFloatBE(p); p += 4; return v; }
      case T.DOUBLE: { const v = buf.readDoubleBE(p); p += 8; return v; }
      case T.BYTE_ARRAY: { const n = buf.readInt32BE(p); p += 4; const v = Buffer.from(buf.subarray(p, p + n)); p += n; return v; }
      case T.STRING: return str();
      case T.LIST: {
        const elem = u8(); const n = buf.readInt32BE(p); p += 4;
        const value = []; for (let i = 0; i < n; i++) value.push({ type: elem, value: payload(elem) });
        return { elem, value };
      }
      case T.COMPOUND: {
        const m = new Map();
        for (;;) { const t = u8(); if (t === T.END) break; const name = str(); m.set(name, { type: t, value: payload(t) }); }
        return m;
      }
      case T.INT_ARRAY: { const n = buf.readInt32BE(p); p += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readInt32BE(p)); p += 4; } return v; }
      case T.LONG_ARRAY: { const n = buf.readInt32BE(p); p += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readBigInt64BE(p)); p += 8; } return v; }
      default: throw new Error(`Tipo NBT desconocido ${type}`);
    }
  }
  const type = u8();
  if (type !== T.COMPOUND) throw new Error('servers.dat no válido');
  const name = str();
  const value = payload(type);
  return { name, tag: { type, value } };
}

function write({ name = '', tag }) {
  const parts = [];
  const push = (b) => parts.push(b);
  const u8 = (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); push(b); };
  const str = (s) => { const d = Buffer.from(s, 'utf8'); const b = Buffer.alloc(2); b.writeUInt16BE(d.length); push(b); push(d); };
  function payload(type, v) {
    let b;
    switch (type) {
      case T.BYTE: b = Buffer.alloc(1); b.writeInt8(v); return push(b);
      case T.SHORT: b = Buffer.alloc(2); b.writeInt16BE(v); return push(b);
      case T.INT: b = Buffer.alloc(4); b.writeInt32BE(v); return push(b);
      case T.LONG: b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); return push(b);
      case T.FLOAT: b = Buffer.alloc(4); b.writeFloatBE(v); return push(b);
      case T.DOUBLE: b = Buffer.alloc(8); b.writeDoubleBE(v); return push(b);
      case T.BYTE_ARRAY: b = Buffer.alloc(4); b.writeInt32BE(v.length); push(b); return push(Buffer.from(v));
      case T.STRING: return str(v);
      case T.LIST: {
        const elem = v.value.length ? v.elem : (v.elem || T.END);
        u8(elem); b = Buffer.alloc(4); b.writeInt32BE(v.value.length); push(b);
        for (const t of v.value) payload(elem, t.value);
        return undefined;
      }
      case T.COMPOUND:
        for (const [k, t] of v) { u8(t.type); str(k); payload(t.type, t.value); }
        return u8(T.END);
      case T.INT_ARRAY: b = Buffer.alloc(4 + 4 * v.length); b.writeInt32BE(v.length); v.forEach((x, i) => b.writeInt32BE(x, 4 + 4 * i)); return push(b);
      case T.LONG_ARRAY: b = Buffer.alloc(4 + 8 * v.length); b.writeInt32BE(v.length); v.forEach((x, i) => b.writeBigInt64BE(BigInt(x), 4 + 8 * i)); return push(b);
      default: throw new Error(`Tipo NBT desconocido ${type}`);
    }
  }
  u8(tag.type); str(name); payload(tag.type, tag.value);
  return Buffer.concat(parts);
}

module.exports = { T, read, write };
