'use strict';
// Busca Java 21 de 64 bits; si no hay, descarga Temurin (Adoptium) en la carpeta del launcher.
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const http = require('./http');
const zip = require('./zip');

function platformInfo() {
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch };
}

function javaBinName(gui = false) {
  if (process.platform === 'win32') return gui ? 'javaw.exe' : 'java.exe';
  return 'java';
}

/** Ejecuta `java -XshowSettings:properties -version` y devuelve { major, bits } o null. */
function probe(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-XshowSettings:properties', '-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr) return resolve(null);
      const out = `${stdout}\n${stderr}`;
      const ver = /java\.version = (\S+)/.exec(out)?.[1] || /version "([^"]+)"/.exec(out)?.[1];
      if (!ver) return resolve(null);
      const major = ver.startsWith('1.') ? Number(ver.split('.')[1]) : Number(ver.split(/[.+-]/)[0]);
      const bits = Number(/sun\.arch\.data\.model = (\d+)/.exec(out)?.[1] || 64);
      resolve({ major, bits, version: ver });
    });
  });
}

async function findBin(dir) {
  const candidates = [path.join(dir, 'bin', javaBinName()), path.join(dir, 'Contents', 'Home', 'bin', 'java')];
  for (const c of candidates) if (await http.exists(c)) return c;
  let subs = [];
  try { subs = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const s of subs) {
    if (!s.isDirectory()) continue;
    for (const c of [path.join(dir, s.name, 'bin', javaBinName()), path.join(dir, s.name, 'Contents', 'Home', 'bin', 'java')]) {
      if (await http.exists(c)) return c;
    }
  }
  return null;
}

function guiVariant(javaPath) {
  if (process.platform !== 'win32') return javaPath;
  return javaPath.replace(/java\.exe$/i, 'javaw.exe');
}

/**
 * Devuelve la ruta de Java a usar. Orden: Java propio del launcher → Java del sistema
 * (JAVA_HOME / PATH) si es 21 y 64 bits → descarga de Adoptium.
 */
async function ensureJava({ runtimeDir, major = 21, adoptiumApi = 'https://api.adoptium.net', onProgress = () => {}, allowSystem = true, log = () => {} }) {
  const own = path.join(runtimeDir, `java-${major}`);
  const ownBin = await findBin(own);
  if (ownBin) {
    const info = await probe(ownBin);
    if (info && info.major === major) return { path: guiVariant(ownBin), console: ownBin, origen: 'launcher', ...info };
    log(`El Java del launcher no responde, se volverá a instalar (${ownBin})`);
  }
  if (allowSystem) {
    const sys = [];
    if (process.env.JAVA_HOME) sys.push(path.join(process.env.JAVA_HOME, 'bin', javaBinName()));
    sys.push(javaBinName());
    for (const c of sys) {
      const info = await probe(c);
      if (info && info.major === major && info.bits === 64) return { path: guiVariant(c), console: c, origen: 'sistema', ...info };
    }
  }
  return installJava({ own, major, adoptiumApi, onProgress, log });
}

async function installJava({ own, major, adoptiumApi, onProgress, log }) {
  const { osName, arch } = platformInfo();
  onProgress({ etapa: 'java', texto: `Buscando Java ${major}…` });
  const q = `${adoptiumApi}/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${osName}&vendor=eclipse`;
  let assets = await http.fetchJson(q);
  if (!Array.isArray(assets) || !assets.length) {
    // Algunas plataformas no tienen JRE: probamos con JDK.
    assets = await http.fetchJson(q.replace('image_type=jre', 'image_type=jdk'));
  }
  const pkg = assets?.[0]?.binary?.package;
  if (!pkg?.link) throw new Error(`Adoptium no tiene Java ${major} para ${osName}/${arch}`);
  const tmpDir = path.join(path.dirname(own), '.descargas');
  const file = path.join(tmpDir, pkg.name || `java-${major}.${osName === 'windows' ? 'zip' : 'tar.gz'}`);
  let got = 0; const total = pkg.size || 0;
  await http.download(pkg.link, file, { sha256: pkg.checksum, size: pkg.size }, (n) => {
    got += n; onProgress({ etapa: 'java', texto: `Descargando Java ${major}`, actual: got, total, bytes: true });
  });
  onProgress({ etapa: 'java', texto: `Instalando Java ${major}…` });
  const staging = `${own}.nuevo`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  if (file.endsWith('.zip')) {
    await zip.extractAll(file, staging);
  } else {
    await new Promise((resolve, reject) => execFile('tar', ['-xzf', file, '-C', staging], (e) => (e ? reject(e) : resolve())));
  }
  await fsp.rm(own, { recursive: true, force: true });
  await fsp.rename(staging, own);
  await fsp.rm(file, { force: true });
  const bin = await findBin(own);
  if (!bin) throw new Error('Java se descargó pero no se encontró el ejecutable');
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755).catch(() => {});
  const info = await probe(bin);
  if (!info) throw new Error('Java se instaló pero no arranca. Revisa tu antivirus.');
  log(`Java ${info.version} instalado en ${own}`);
  return { path: guiVariant(bin), console: bin, origen: 'descargado', ...info };
}

module.exports = { ensureJava, probe, platformInfo, findBin };
