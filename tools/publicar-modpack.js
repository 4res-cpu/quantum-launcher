#!/usr/bin/env node
'use strict';
// Prepara quantum-datos/manifest.json para publicar una versión nueva del modpack.
// Uso:
//   node tools/publicar-modpack.js "Eventos Quantum 3.4.8.mrpack" --version 3.4.8 \
//        --url https://github.com/TU_USUARIO/quantum-datos/releases/download/modpack-3.4.8/Eventos_Quantum_3.4.8.mrpack
// Opcional: --manifest ruta/al/manifest.json  --nota "Texto que verán los jugadores"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readPack } = require('../src/core/modpack');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.log('Uso: node tools/publicar-modpack.js <archivo.mrpack> --version X.Y.Z --url <URL pública del .mrpack>');
    process.exit(1);
  }
  const buf = fs.readFileSync(file);
  const { index, overrides } = await readPack(file);
  const version = arg('version', index.versionId);
  const url = arg('url');
  if (!url) { console.error('Falta --url (la dirección donde subiste el .mrpack)'); process.exit(1); }
  const manifestFile = arg('manifest', path.join(__dirname, '..', 'quantum-datos', 'manifest.json'));

  // Comprobaciones útiles para el organizador
  const avisos = [];
  for (const f of index.files) {
    if (!f.hashes?.sha1) avisos.push(`Sin sha1: ${f.path}`);
    if (!f.downloads?.length) avisos.push(`Sin URL de descarga: ${f.path}`);
  }
  if (overrides.has('options.txt')) avisos.push('El paquete trae options.txt: el launcher solo usa su lista resourcePacks (paquetes que activa siempre); el resto de opciones del jugador no se toca.');
  if (overrides.has('servers.dat')) avisos.push('El paquete trae servers.dat: el launcher lo ignora y añade el lobby desde evento.config.json.');

  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* nuevo */ }
  manifest.modpack = {
    version,
    nombre: index.name,
    minecraft: index.dependencies.minecraft,
    fabricLoader: index.dependencies['fabric-loader'],
    url,
    size: buf.length,
    sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    sha512: crypto.createHash('sha512').update(buf).digest('hex'),
    publicado: new Date().toISOString(),
    nota: arg('nota', manifest.modpack?.nota || ''),
  };
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifiesto actualizado: ${manifestFile}`);
  console.log(`  Modpack ${index.name} → versión ${version} (${(buf.length / 1048576).toFixed(1)} MB, ${index.files.length} archivos de Modrinth, ${overrides.size} overrides)`);
  for (const a of avisos) console.log(`  Aviso: ${a}`);
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
