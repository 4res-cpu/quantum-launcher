'use strict';
// Instala/actualiza el modpack (.mrpack de Modrinth) dentro de la instancia del evento.
//
// Reglas de actualización:
//  - mods/, resourcepacks/, shaderpacks/: siempre iguales al modpack (hash verificado).
//    Los .jar de mods/ que no estén en el modpack se borran.
//  - config/ y demás overrides: se copian la primera vez. Después solo se sobrescriben
//    si el organizador cambió ese archivo en la versión nueva (respeta lo que toque el jugador).
//  - options.txt y servers.dat NUNCA se copian del paquete (los gestiona el launcher aparte).
//  - Nunca se tocan saves/, screenshots/, logs/, crash-reports/.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('./http');
const zip = require('./zip');

const ENFORCED = ['mods/', 'resourcepacks/', 'shaderpacks/'];
const NEVER_COPY = new Set(['options.txt', 'servers.dat', 'servers.dat_old']);
const NEVER_TOUCH = ['saves/', 'screenshots/', 'logs/', 'crash-reports/', '.quantum/'];

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const enforced = (rel) => ENFORCED.some((p) => rel.startsWith(p));

async function readState(gameDir) {
  try { return JSON.parse(await fsp.readFile(path.join(gameDir, '.quantum', 'estado.json'), 'utf8')); } catch { return { files: {} }; }
}
async function writeState(gameDir, state) {
  const f = path.join(gameDir, '.quantum', 'estado.json');
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(`${f}.tmp`, JSON.stringify(state, null, 1));
  await fsp.rename(`${f}.tmp`, f);
}

/** Lee el índice y los overrides de un .mrpack. */
async function readPack(mrpackFile) {
  const entries = await zip.openZip(mrpackFile);
  const idxEntry = entries.find((e) => e.name === 'modrinth.index.json');
  if (!idxEntry) throw new Error('El .mrpack no tiene modrinth.index.json');
  const index = JSON.parse(idxEntry.getData().toString('utf8'));
  if (index.game !== 'minecraft') throw new Error('El .mrpack no es de Minecraft');
  const overrides = new Map();
  // client-overrides tiene prioridad sobre overrides
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const e of entries) {
      if (e.isDir || !e.name.startsWith(prefix)) continue;
      const rel = e.name.slice(prefix.length);
      if (!rel) continue;
      zip.safeJoin('/x', rel); // valida la ruta
      overrides.set(rel, e);
    }
  }
  return { index, overrides };
}

async function cachedSha1(file, size, mtimeMs, cache) {
  const c = cache[file];
  if (c && c.size === size && c.mtimeMs === mtimeMs) return c.sha1;
  const h = await http.fileHash(file, 'sha1');
  cache[file] = { size, mtimeMs, sha1: h };
  return h;
}

/**
 * Sincroniza la instancia con el .mrpack.
 * opts: { gameDir, mrpackFile, packVersion, repair, ligeros: Set<rel> (mods a desactivar), onProgress, log, concurrency }
 */
async function syncPack(opts) {
  const { gameDir, mrpackFile, packVersion, repair = false, ligeros = new Set(), onProgress = () => {}, log = () => {}, concurrency = 8 } = opts;
  const { index, overrides } = await readPack(mrpackFile);
  const prev = await readState(gameDir);
  const hashCache = repair ? {} : (prev.hashCache || {});
  const next = { packVersion, packName: index.name, dependencies: index.dependencies, files: {}, hashCache: {} };
  const report = { descargados: 0, copiados: 0, borrados: 0, respetados: 0, desactivados: 0 };

  const fileOk = async (abs, expectSha1) => {
    let st; try { st = await fsp.stat(abs); } catch { return false; }
    if (!st.isFile()) return false;
    const h = await cachedSha1(abs, st.size, st.mtimeMs, hashCache);
    next.hashCache[abs] = hashCache[abs];
    return h === expectSha1;
  };

  // 1) Archivos del índice (descargados de Modrinth)
  const toDownload = [];
  const wanted = new Map();
  for (const f of index.files) {
    if (f.env && f.env.client === 'unsupported') continue;
    const rel = f.path.replace(/\\/g, '/');
    const abs = zip.safeJoin(gameDir, rel);
    wanted.set(rel, { sha1: f.hashes.sha1, origen: 'indice' });
    const off = ligeros.has(rel);
    const target = off ? `${abs}.disabled` : abs;
    const other = off ? abs : `${abs}.disabled`;
    if (await fileOk(target, f.hashes.sha1)) { await fsp.rm(other, { force: true }); continue; }
    if (await fileOk(other, f.hashes.sha1)) { // solo cambiar activado/desactivado
      await fsp.rename(other, target); delete next.hashCache[other]; report.desactivados++; continue;
    }
    toDownload.push({ f, rel, target, other });
  }
  const totalBytes = toDownload.reduce((s, x) => s + (x.f.fileSize || 0), 0);
  let got = 0; let last = 0;
  await http.pool(toDownload, concurrency, async ({ f, rel, target, other }) => {
    await http.download(f.downloads, target, { sha1: f.hashes.sha1, sha512: f.hashes.sha512, size: f.fileSize }, (n) => {
      got += n;
      if (Date.now() - last > 120) { last = Date.now(); onProgress({ etapa: 'modpack', texto: 'Descargando mods', actual: got, total: totalBytes, bytes: true }); }
    });
    await fsp.rm(other, { force: true });
    report.descargados++;
    log(`mod descargado: ${rel}`);
  });

  // 2) Overrides
  onProgress({ etapa: 'modpack', texto: 'Copiando configuración del evento…' });
  for (const [rel, entry] of overrides) {
    if (NEVER_COPY.has(rel) || NEVER_TOUCH.some((p) => rel.startsWith(p))) continue;
    const data = entry.getData();
    const h = sha1(data);
    wanted.set(rel, { sha1: h, origen: 'override' });
    const abs = zip.safeJoin(gameDir, rel);
    const isEnforced = enforced(rel);
    const off = ligeros.has(rel);
    const target = off ? `${abs}.disabled` : abs;
    if (await fileOk(target, h)) continue;
    if (!isEnforced && !repair && await http.exists(abs)) {
      const before = prev.files?.[rel];
      if (before && before.sha1 === h) { report.respetados++; continue; } // el organizador no lo cambió: respetar al jugador
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    if (off) await fsp.rm(abs, { force: true }); else await fsp.rm(`${abs}.disabled`, { force: true });
    report.copiados++;
  }

  // 3) Borrar lo que ya no está en el modpack
  for (const rel of Object.keys(prev.files || {})) {
    if (wanted.has(rel)) continue;
    if (NEVER_TOUCH.some((p) => rel.startsWith(p))) continue;
    const abs = zip.safeJoin(gameDir, rel);
    for (const f of [abs, `${abs}.disabled`]) {
      if (await http.exists(f)) { await fsp.rm(f, { force: true }); report.borrados++; log(`borrado (ya no está en el modpack): ${rel}`); }
    }
  }
  // Cualquier .jar en mods/ que no sea del modpack (evita mods no permitidos en el evento)
  const modsDir = path.join(gameDir, 'mods');
  let modFiles = [];
  try { modFiles = await fsp.readdir(modsDir, { withFileTypes: true }); } catch { /* */ }
  for (const d of modFiles) {
    if (!d.isFile()) continue;
    const rel = `mods/${d.name}`;
    const base = rel.replace(/\.disabled$/, '');
    if (!/\.jar(\.disabled)?$/i.test(d.name)) continue;
    if (wanted.has(base)) continue;
    await fsp.rm(path.join(modsDir, d.name), { force: true });
    report.borrados++; log(`borrado mod ajeno al evento: ${d.name}`);
  }

  for (const [rel, v] of wanted) next.files[rel] = v;
  await writeState(gameDir, next);
  return { ...report, index };
}

module.exports = { syncPack, readPack, readState };
