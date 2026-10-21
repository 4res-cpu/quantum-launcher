'use strict';
// Ping de estado de Minecraft (Server List Ping) para mostrar si el lobby está en línea y cuántos jugadores hay.
const net = require('net');

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}

function readVarint(buf, off) {
  let n = 0; let shift = 0; let p = off;
  for (;;) {
    if (p >= buf.length) return null;
    const b = buf[p++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: n >>> 0, size: p - off };
    shift += 7;
    if (shift > 35) throw new Error('VarInt demasiado largo');
  }
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }

/** Texto plano de un componente de chat (motd). */
function plain(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  let s = (c.text || '') + (c.translate || '');
  if (Array.isArray(c.extra)) s += c.extra.map(plain).join('');
  return s.replace(/§./g, '');
}

function ping(host, port = 25565, { timeoutMs = 5000, protocol = 772 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0); let done = false; let status = null; let sentPingAt = 0;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(r); };
    const timer = setTimeout(() => finish(status ? { ...status } : { online: false, error: 'Sin respuesta' }), timeoutMs);
    sock.on('connect', () => {
      const pb = Buffer.alloc(2); pb.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varint(protocol), mcString(host), pb, varint(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const body = buf.subarray(len.size, len.size + len.value);
        buf = buf.subarray(len.size + len.value);
        const id = readVarint(body, 0);
        if (id.value === 0x00 && !status) {
          const sl = readVarint(body, id.size);
          const json = JSON.parse(body.subarray(id.size + sl.size, id.size + sl.size + sl.value).toString('utf8'));
          status = {
            online: true,
            jugadores: json.players?.online ?? 0,
            max: json.players?.max ?? 0,
            version: json.version?.name || '',
            motd: plain(json.description).trim(),
            latencia: Date.now() - start,
          };
          const t = Buffer.alloc(8); t.writeBigInt64BE(BigInt(Date.now()));
          sentPingAt = Date.now();
          sock.write(packet(0x01, t));
        } else if (id.value === 0x01 && status) {
          status.latencia = Date.now() - sentPingAt;
          finish(status);
        }
      }
    });
    sock.on('error', (e) => finish(status || { online: false, error: e.code || e.message }));
    sock.on('close', () => finish(status || { online: false, error: 'Conexión cerrada' }));
  });
}

module.exports = { ping, varint, readVarint, packet, mcString };
