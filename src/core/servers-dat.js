'use strict';
// Mantiene el servidor del evento en la lista de Multijugador sin borrar los que añadió el jugador.
const fsp = require('fs/promises');
const nbt = require('./nbt');
const { T } = nbt;

function entry({ nombre, ip, aceptarTexturas = true }) {
  const m = new Map();
  m.set('name', { type: T.STRING, value: nombre });
  m.set('ip', { type: T.STRING, value: ip });
  if (aceptarTexturas) m.set('acceptTextures', { type: T.BYTE, value: 1 });
  m.set('hidden', { type: T.BYTE, value: 0 });
  return { type: T.COMPOUND, value: m };
}

async function readServers(file) {
  let buf;
  try { buf = await fsp.readFile(file); } catch { return []; }
  try {
    const root = nbt.read(buf);
    const list = root.tag.value.get('servers');
    if (!list) return [];
    return list.value.value.map((t) => ({
      nombre: t.value.get('name')?.value ?? '',
      ip: t.value.get('ip')?.value ?? '',
      tag: t,
    }));
  } catch { return null; } // archivo dañado
}

/**
 * Asegura que `servidor` esté el primero de la lista. Conserva los demás, salvo
 * los de `quitar` (IPs antiguas del evento).
 */
async function ensureServer(file, servidor, quitar = []) {
  const prev = await readServers(file);
  const norm = (s) => s.trim().toLowerCase();
  const quitarSet = new Set(quitar.map(norm));
  const keep = (prev || []).filter((s) => norm(s.ip) !== norm(servidor.ip) && !quitarSet.has(norm(s.ip)) && !quitarSet.has(norm(s.ip.split(':')[0])));
  const existing = (prev || []).find((s) => norm(s.ip) === norm(servidor.ip));
  const first = existing ? existing.tag : entry(servidor);
  if (existing) {
    first.value.set('name', { type: T.STRING, value: servidor.nombre });
    if (servidor.aceptarTexturas !== false) first.value.set('acceptTextures', { type: T.BYTE, value: 1 });
  }
  const tags = [first, ...keep.map((s) => s.tag)];
  const root = new Map([['servers', { type: T.LIST, value: { elem: T.COMPOUND, value: tags } }]]);
  await fsp.writeFile(file, nbt.write({ name: '', tag: { type: T.COMPOUND, value: root } }));
  return tags.length;
}

module.exports = { ensureServer, readServers };
