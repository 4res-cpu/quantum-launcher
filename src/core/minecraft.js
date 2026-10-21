'use strict';
// Instala Minecraft (servidores oficiales de Mojang) + Fabric Loader y construye la línea de comandos.
// Nada de Minecraft se incluye en el launcher: todo se descarga desde Mojang en el PC del jugador.
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('./http');
const zip = require('./zip');

const DEFAULT_ENDPOINTS = {
  versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  fabricMeta: 'https://meta.fabricmc.net',
  assets: 'https://resources.download.minecraft.net',
  libraries: 'https://libraries.minecraft.net/',
};

function osName() { return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'; }

function ruleMatches(rule, ctx) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== ctx.os) return false;
    if (rule.os.arch) {
      const a = rule.os.arch;
      if (a === 'x86' && ctx.arch !== 'ia32') return false;
      if (a === 'arm64' && ctx.arch !== 'arm64') return false;
      if (a === 'x86_64' && ctx.arch !== 'x64') return false;
    }
    if (rule.os.version) { try { if (!new RegExp(rule.os.version).test(ctx.osVersion)) return false; } catch { /* */ } }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (!!ctx.features[k] !== v) return false;
  }
  return true;
}

function allowed(rules, ctx) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) if (ruleMatches(r, ctx)) ok = r.action === 'allow';
  return ok;
}

/** "grupo:artefacto:versión[:clasificador][@ext]" → ruta maven */
function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [group, artifact, version, classifier] = n.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

function libKey(name) {
  const [g, a, , c] = name.split('@')[0].split(':');
  return `${g}:${a}${c ? `:${c}` : ''}`;
}

function makeCtx(features = {}) {
  return { os: osName(), arch: process.arch, osVersion: os.release(), features };
}

/** Une el perfil de Fabric (inheritsFrom) con la versión de Mojang. */
function mergeProfiles(vanilla, fabric) {
  if (!fabric) return vanilla;
  const seen = new Set();
  const libraries = [];
  for (const l of [...(fabric.libraries || []), ...(vanilla.libraries || [])]) {
    const k = libKey(l.name);
    if (seen.has(k)) continue;
    seen.add(k); libraries.push(l);
  }
  return {
    ...vanilla,
    id: fabric.id,
    mainClass: fabric.mainClass || vanilla.mainClass,
    libraries,
    arguments: {
      game: [...(vanilla.arguments?.game || []), ...(fabric.arguments?.game || [])],
      jvm: [...(vanilla.arguments?.jvm || []), ...(fabric.arguments?.jvm || [])],
    },
  };
}

/** Lista de librerías a descargar para este sistema. */
function resolveLibraries(profile, librariesDir, ctx, endpoints) {
  const out = [];
  for (const lib of profile.libraries) {
    if (!allowed(lib.rules, ctx)) continue;
    const parts = lib.name.split('@')[0].split(':');
    const classifier = parts[3] || '';
    if (lib.downloads?.artifact) {
      const a = lib.downloads.artifact;
      const rel = a.path || mavenPath(lib.name);
      out.push({ name: lib.name, file: path.join(librariesDir, rel), url: a.url, sha1: a.sha1, size: a.size, natives: classifier.startsWith('natives-'), classpath: true });
    } else if (!lib.downloads && !lib.natives) {
      const rel = mavenPath(lib.name);
      const base = (lib.url || endpoints.libraries).replace(/\/?$/, '/');
      out.push({ name: lib.name, file: path.join(librariesDir, rel), url: base + rel, sha1: lib.sha1, size: lib.size, natives: classifier.startsWith('natives-'), classpath: true });
    }
    // Formato antiguo de nativos (<1.19)
    if (lib.natives && lib.natives[ctx.os]) {
      const cls = lib.natives[ctx.os].replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const a = lib.downloads?.classifiers?.[cls];
      if (a) out.push({ name: `${lib.name}:${cls}`, file: path.join(librariesDir, a.path), url: a.url, sha1: a.sha1, size: a.size, natives: true, classpath: false, exclude: lib.extract?.exclude || [] });
    }
  }
  return out;
}

class MinecraftInstaller {
  constructor({ sharedDir, endpoints = {}, onProgress = () => {}, log = () => {}, concurrency = 16 }) {
    this.dirs = {
      versions: path.join(sharedDir, 'versions'),
      libraries: path.join(sharedDir, 'libraries'),
      assets: path.join(sharedDir, 'assets'),
    };
    this.ep = { ...DEFAULT_ENDPOINTS, ...endpoints };
    this.onProgress = onProgress;
    this.log = log;
    this.concurrency = concurrency;
  }

  async cachedJson(url, file, expectSha1, { offlineOk = true } = {}) {
    if (await http.isValid(file, expectSha1 ? { sha1: expectSha1 } : {})) {
      try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* volver a bajar */ }
    }
    try {
      await http.download(url, file, expectSha1 ? { sha1: expectSha1 } : {});
    } catch (e) {
      if (offlineOk && await http.exists(file)) { this.log(`Usando copia local de ${path.basename(file)} (${e.message})`); } else throw e;
    }
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  }

  async loadVanilla(mcVersion) {
    const vFile = path.join(this.dirs.versions, mcVersion, `${mcVersion}.json`);
    if (await http.exists(vFile)) {
      try { const j = JSON.parse(await fsp.readFile(vFile, 'utf8')); if (j.id === mcVersion && j.downloads) return j; } catch { /* */ }
    }
    const manifest = await http.fetchJson(this.ep.versionManifest);
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Mojang no tiene la versión ${mcVersion}`);
    return this.cachedJson(entry.url, vFile, entry.sha1);
  }

  async loadFabric(mcVersion, loaderVersion) {
    const id = `fabric-loader-${loaderVersion}-${mcVersion}`;
    const file = path.join(this.dirs.versions, id, `${id}.json`);
    const url = `${this.ep.fabricMeta}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    if (await http.exists(file)) {
      try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* */ }
    }
    return this.cachedJson(url, file);
  }

  /**
   * Instala todo lo necesario y devuelve el "perfil" combinado listo para lanzar.
   * `verify`: comprueba hashes de lo ya descargado (Reparar).
   */
  async install({ mcVersion, loaderVersion, verify = false }) {
    this.onProgress({ etapa: 'minecraft', texto: `Preparando Minecraft ${mcVersion}…` });
    const vanilla = await this.loadVanilla(mcVersion);
    const fabric = loaderVersion ? await this.loadFabric(mcVersion, loaderVersion) : null;
    const profile = mergeProfiles(vanilla, fabric);
    const ctx = makeCtx();
    const libs = resolveLibraries(profile, this.dirs.libraries, ctx, this.ep);
    const clientJar = path.join(this.dirs.versions, mcVersion, `${mcVersion}.jar`);
    const client = vanilla.downloads.client;

    // Índice de assets
    const ai = vanilla.assetIndex;
    const indexFile = path.join(this.dirs.assets, 'indexes', `${ai.id}.json`);
    const index = await this.cachedJson(ai.url, indexFile, ai.sha1, { offlineOk: false });

    const jobs = [];
    jobs.push({ file: clientJar, url: client.url, sha1: client.sha1, size: client.size });
    for (const l of libs) jobs.push(l);
    if (vanilla.logging?.client?.file) {
      const lf = vanilla.logging.client.file;
      jobs.push({ file: path.join(this.dirs.assets, 'log_configs', lf.id), url: lf.url, sha1: lf.sha1, size: lf.size });
    }
    const seenHash = new Set();
    for (const { hash, size } of Object.values(index.objects)) {
      if (seenHash.has(hash)) continue; seenHash.add(hash);
      const rel = `${hash.slice(0, 2)}/${hash}`;
      jobs.push({ file: path.join(this.dirs.assets, 'objects', rel), url: `${this.ep.assets}/${rel}`, sha1: hash, size, asset: true });
    }
    await this.fetchAll(jobs, verify, 'minecraft', 'Descargando Minecraft');
    return { profile, vanilla, libs, clientJar, assetIndex: ai.id };
  }

  async fetchAll(jobs, verify, etapa, texto) {
    // Primero averiguamos qué falta (rápido: solo tamaño, salvo en modo Reparar).
    const missing = [];
    let checked = 0;
    await http.pool(jobs, 32, async (j) => {
      const ok = verify ? await http.isValid(j.file, { sha1: j.sha1, size: j.size }) : await http.isValid(j.file, { size: j.size ?? undefined });
      if (!ok) missing.push(j);
      checked++;
      if (checked % 200 === 0) this.onProgress({ etapa, texto: 'Comprobando archivos…', actual: checked, total: jobs.length });
    });
    if (!missing.length) return 0;
    const total = missing.reduce((s, j) => s + (j.size || 0), 0);
    let got = 0; let lastEmit = 0;
    await http.pool(missing, this.concurrency, async (j) => {
      if (!j.url) throw new Error(`No se puede descargar ${path.basename(j.file)}`);
      await http.download(j.url, j.file, { sha1: j.sha1, size: j.size }, (n) => {
        got += n;
        const now = Date.now();
        if (now - lastEmit > 120) { lastEmit = now; this.onProgress({ etapa, texto, actual: got, total, bytes: true }); }
      });
    });
    this.onProgress({ etapa, texto, actual: total, total, bytes: true });
    this.log(`${etapa}: ${missing.length} archivos descargados`);
    return missing.length;
  }

  /** Extrae los nativos (.dll/.so/.dylib) de las librerías natives-*. */
  async extractNatives(libs, nativesDir) {
    await fsp.rm(nativesDir, { recursive: true, force: true });
    await fsp.mkdir(nativesDir, { recursive: true });
    // Los jars de LWJGL traen carpetas por arquitectura (windows/x64, windows/x86, windows/arm64) con
    // archivos del mismo nombre: solo se extrae la de este PC para no mezclar DLL de 32 y 64 bits.
    const ARCHS = { x64: ['x64', 'x86_64', 'amd64'], ia32: ['x86', 'i386'], arm64: ['arm64', 'aarch64'] };
    const mine = new Set(ARCHS[process.arch] || []);
    const otras = new Set(Object.values(ARCHS).flat().filter((a) => !mine.has(a)));
    for (const l of libs.filter((x) => x.natives)) {
      const cls = l.name.split(':')[3] || '';
      const clsArch = cls.split('-').slice(2).join('-'); // natives-windows-arm64 → arm64
      if (clsArch && otras.has(clsArch)) continue;
      const entries = await zip.openZip(l.file);
      for (const e of entries) {
        if (e.isDir || e.name.startsWith('META-INF/')) continue;
        if (e.name.split('/').some((seg) => otras.has(seg))) continue;
        if ((l.exclude || []).some((x) => e.name.startsWith(x))) continue;
        if (!/\.(dll|so|dylib|jnilib)$/i.test(e.name)) continue;
        await fsp.writeFile(path.join(nativesDir, path.basename(e.name)), e.getData());
      }
    }
  }
}

/** Sustituye ${variables} en un argumento. */
function fill(arg, vars) {
  return arg.replace(/\$\{([a-zA-Z_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function collectArgs(list, ctx, vars) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(fill(a, vars)); continue; }
    if (!allowed(a.rules, ctx)) continue;
    const v = Array.isArray(a.value) ? a.value : [a.value];
    for (const s of v) out.push(fill(s, vars));
  }
  return out;
}

/**
 * Construye argumentos JVM + juego. Devuelve { jvm, mainClass, game }.
 * opts: { account, gameDir, nativesDir, ramMB, width, height, fullscreen, quickPlay, jvmExtra }
 */
function buildLaunchArgs(install, dirs, opts) {
  const { profile, libs, clientJar, assetIndex } = install;
  const sep = process.platform === 'win32' ? ';' : ':';
  const cp = [...libs.filter((l) => l.classpath).map((l) => l.file), clientJar];
  const features = {
    is_demo_user: false,
    has_custom_resolution: !!(opts.width && opts.height) && !opts.fullscreen,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: !!opts.quickPlay,
    is_quick_play_realms: false,
  };
  const ctx = makeCtx(features);
  const acc = opts.account;
  const vars = {
    auth_player_name: acc.nombre,
    version_name: profile.id,
    game_directory: opts.gameDir,
    assets_root: dirs.assets,
    game_assets: dirs.assets,
    assets_index_name: assetIndex,
    auth_uuid: acc.uuid.replace(/-/g, ''),
    auth_access_token: acc.accessToken || '0',
    auth_session: acc.accessToken || '0',
    clientid: acc.clientId || '',
    auth_xuid: acc.xuid || '',
    user_type: acc.tipo === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: 'release',
    resolution_width: opts.width || 1280,
    resolution_height: opts.height || 720,
    quickPlayMultiplayer: opts.quickPlay || '',
    quickPlayPath: '',
    natives_directory: opts.nativesDir,
    launcher_name: 'QuantumLauncher',
    launcher_version: opts.launcherVersion || '1.0.0',
    classpath: cp.join(sep),
    classpath_separator: sep,
    library_directory: dirs.libraries,
  };
  const jvm = [
    `-Xms${Math.min(1024, opts.ramMB)}M`,
    `-Xmx${opts.ramMB}M`,
    // Ajustes de recolector de basura probados para Minecraft moderno (G1GC)
    '-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M', '-XX:+DisableExplicitGC',
    '-XX:+ParallelRefProcEnabled',
    '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
    ...(opts.jvmExtra || []),
  ];
  if (profile.arguments?.jvm?.length) {
    jvm.push(...collectArgs(profile.arguments.jvm, ctx, vars));
  } else {
    jvm.push(`-Djava.library.path=${opts.nativesDir}`, '-cp', vars.classpath);
  }
  if (install.vanilla.logging?.client?.argument) {
    const lf = install.vanilla.logging.client.file;
    jvm.push(install.vanilla.logging.client.argument.replace('${path}', path.join(dirs.assets, 'log_configs', lf.id)));
  }
  let game;
  if (profile.arguments?.game) game = collectArgs(profile.arguments.game, ctx, vars);
  else game = fill(profile.minecraftArguments || '', vars).split(' ').filter(Boolean);
  if (opts.quickPlay && !game.includes('--quickPlayMultiplayer')) game.push('--quickPlayMultiplayer', opts.quickPlay);
  if (opts.fullscreen && !game.includes('--fullscreen')) game.push('--fullscreen');
  return { jvm, mainClass: profile.mainClass, game };
}

/** Archivo de argumentos de Java (@archivo): evita el límite de longitud de la línea de comandos de Windows. */
function toArgFile(args) {
  return args.map((a) => `"${String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n');
}

module.exports = { MinecraftInstaller, buildLaunchArgs, toArgFile, mergeProfiles, resolveLibraries, allowed, mavenPath, makeCtx, DEFAULT_ENDPOINTS };
