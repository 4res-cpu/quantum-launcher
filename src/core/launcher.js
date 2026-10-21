'use strict';
// Orquestador: manifiesto remoto → Java → Minecraft + Fabric → modpack → opciones → lanzar.
// No depende de Electron: el proceso principal lo usa y las pruebas también.
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const http = require('./http');
const { ensureJava } = require('./java');
const { MinecraftInstaller, buildLaunchArgs, toArgFile } = require('./minecraft');
const { syncPack } = require('./modpack');
const { ensureServer } = require('./servers-dat');
const hardware = require('./hardware');

function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function javaLen(prep) { return String(prep.java.path).length + 3; }

function cleanEnv() {
  // Variables de Java del sistema que pueden romper el juego (p. ej. _JAVA_OPTIONS con poca memoria)
  const env = { ...process.env };
  for (const k of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH']) delete env[k];
  return env;
}

/** Lista resourcePacks del options.txt que trae el .mrpack (paquetes que el evento necesita). */
function texturasDelPack(overrides) {
  const e = overrides?.get('options.txt');
  if (!e) return [];
  const l = e.getData().toString('utf8').split(/\r?\n/).find((x) => x.startsWith('resourcePacks:'));
  try { const v = JSON.parse(l.slice('resourcePacks:'.length)); return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p.startsWith('file/')) : []; } catch { return []; }
}

class QuantumCore {
  /**
   * @param {object} cfg  evento.config.json
   * @param {string} dataDir carpeta de datos del launcher (fuera de .minecraft)
   */
  constructor(cfg, dataDir, { onProgress = () => {}, onLog = () => {}, launcherVersion = '1.0.0' } = {}) {
    this.cfg = cfg;
    this.launcherVersion = launcherVersion;
    this.dirs = {
      data: dataDir,
      shared: path.join(dataDir, 'compartido'),
      runtime: path.join(dataDir, 'compartido', 'runtime'),
      game: path.join(dataDir, 'instancias', cfg.instancia),
      cache: path.join(dataDir, 'cache'),
    };
    this.onProgress = onProgress;
    this.logLines = [];
    this.onLog = onLog;
    this.child = null;
  }

  log(line) {
    const l = `[${new Date().toLocaleTimeString('es-CO', { hour12: false })}] ${line}`;
    this.logLines.push(l);
    if (this.logLines.length > 4000) this.logLines.splice(0, 1000);
    this.onLog(l);
  }

  // ---------- Manifiesto remoto ----------
  async leerManifiesto() {
    const cacheFile = path.join(this.dirs.cache, 'manifest.json');
    try {
      const m = await http.fetchJson(`${this.cfg.urls.manifiesto}${this.cfg.urls.manifiesto.includes('?') ? '&' : '?'}t=${Date.now()}`, { retries: 1, timeoutMs: 15000 });
      if (!m?.modpack?.url || !m?.modpack?.version) throw new Error('El manifiesto no tiene modpack.version/modpack.url');
      await fsp.mkdir(this.dirs.cache, { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify(m, null, 1));
      return { ...m, desdeCache: false };
    } catch (e) {
      this.log(`No se pudo leer el manifiesto (${e.message}). Se usa la última copia guardada.`);
      try { return { ...JSON.parse(await fsp.readFile(cacheFile, 'utf8')), desdeCache: true }; } catch { return null; }
    }
  }

  async leerNoticias() {
    const cacheFile = path.join(this.dirs.cache, 'noticias.json');
    try {
      const n = await http.fetchJson(`${this.cfg.urls.noticias}${this.cfg.urls.noticias.includes('?') ? '&' : '?'}t=${Date.now()}`, { retries: 1, timeoutMs: 10000 });
      await fsp.mkdir(this.dirs.cache, { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify(n));
      return n;
    } catch {
      try { return JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch { return { noticias: [] }; }
    }
  }

  async estadoInstalacion() {
    try { return JSON.parse(await fsp.readFile(path.join(this.dirs.game, '.quantum', 'estado.json'), 'utf8')); } catch { return null; }
  }

  /** ¿Hay versión nueva del modpack? */
  async comprobarActualizacion() {
    const m = await this.leerManifiesto();
    const est = await this.estadoInstalacion();
    return {
      manifiesto: m,
      instalada: est?.packVersion || null,
      disponible: m?.modpack?.version || null,
      hayNueva: !!(m && (!est || est.packVersion !== m.modpack.version)),
      launcherNuevo: !!(m?.launcher?.version && cmpVersion(m.launcher.version, this.launcherVersion) > 0),
    };
  }

  // ---------- Instalación ----------
  async descargarPack(m) {
    const p = m.modpack;
    const file = path.join(this.dirs.data, 'modpacks', `${this.cfg.instancia}-${p.version}.mrpack`);
    const expect = { sha1: p.sha1, sha512: p.sha512, size: p.size };
    if (await http.isValid(file, p.sha1 || p.sha512 ? expect : {})) return file;
    let got = 0;
    this.log(`Descargando modpack ${p.version}`);
    await http.download(p.url, file, expect, (n) => { got += n; this.onProgress({ etapa: 'modpack', texto: `Descargando modpack ${p.version}`, actual: got, total: p.size || 0, bytes: true }); });
    // Borrar .mrpack antiguos
    const dir = path.dirname(file);
    for (const f of await fsp.readdir(dir)) if (f !== path.basename(file) && f.startsWith(`${this.cfg.instancia}-`)) await fsp.rm(path.join(dir, f), { force: true });
    return file;
  }

  /**
   * Deja todo listo para jugar. ajustes: { modoLigero, perfil, ramMB, ... }
   */
  async preparar({ reparar = false, ajustes = {}, hw = null, sinTexturas = false } = {}) {
    const t0 = Date.now();
    this.log(`Preparando instalación${reparar ? ' (reparación completa)' : ''}`);
    await fsp.mkdir(this.dirs.game, { recursive: true });

    // 1) Manifiesto y modpack
    this.onProgress({ etapa: 'manifiesto', texto: 'Buscando actualizaciones…' });
    const m = await this.leerManifiesto();
    const est = await this.estadoInstalacion();
    let mrpack;
    let packVersion;
    if (m) {
      mrpack = await this.descargarPack(m);
      packVersion = m.modpack.version;
    } else if (est) {
      // Sin internet pero ya instalado: se puede jugar con lo que hay
      const f = path.join(this.dirs.data, 'modpacks', `${this.cfg.instancia}-${est.packVersion}.mrpack`);
      if (!(await http.exists(f))) throw new Error('No hay conexión y falta el modpack. Conéctate a internet.');
      mrpack = f; packVersion = est.packVersion;
    } else {
      throw new Error('No hay conexión a internet para la primera instalación. Revisa tu conexión y vuelve a intentarlo.');
    }

    const { readPack } = require('./modpack');
    const { index, overrides } = await readPack(mrpack);
    const mcVersion = index.dependencies.minecraft || this.cfg.minecraft;
    const loaderVersion = index.dependencies['fabric-loader'] || this.cfg.fabricLoader;

    // 2) Java
    this.onProgress({ etapa: 'java', texto: 'Comprobando Java…' });
    const java = await ensureJava({
      runtimeDir: this.dirs.runtime, major: this.cfg.java || 21,
      adoptiumApi: this.cfg.endpoints?.adoptium, onProgress: this.onProgress, log: (l) => this.log(l),
      allowSystem: this.cfg.usarJavaDelSistema !== false && !reparar,
    });
    this.log(`Java ${java.version} (${java.origen}): ${java.path}`);

    // 3) Minecraft + Fabric
    const mc = new MinecraftInstaller({ sharedDir: this.dirs.shared, endpoints: this.cfg.endpoints, onProgress: this.onProgress, log: (l) => this.log(l) });
    const install = await mc.install({ mcVersion, loaderVersion, verify: reparar });

    // 4) Modpack
    const ligeros = new Set();
    const modoLigero = ajustes.modoLigero ?? (hw ? hardware.PERFILES[hardware.perfilAuto(hw)].ligero : false);
    if (modoLigero) {
      for (const f of index.files) {
        const name = path.basename(f.path);
        if ((this.cfg.modsLigeros || []).some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) ligeros.add(f.path);
      }
    }
    const rep = await syncPack({ gameDir: this.dirs.game, mrpackFile: mrpack, packVersion, repair: reparar, ligeros, onProgress: this.onProgress, log: (l) => this.log(l) });
    this.log(`Modpack ${packVersion}: ${rep.descargados} descargados, ${rep.copiados} copiados, ${rep.borrados} borrados, ${rep.respetados} ajustes del jugador respetados`);

    // 5) servers.dat y options.txt
    const s = this.cfg.servidor;
    await ensureServer(path.join(this.dirs.game, 'servers.dat'), { nombre: s.nombre, ip: `${s.host}:${s.puerto}`, aceptarTexturas: true }, this.cfg.servidoresAntiguos || []);
    const optFile = path.join(this.dirs.game, 'options.txt');
    if (!(await http.exists(optFile))) {
      const perfil = ajustes.perfil && ajustes.perfil !== 'auto' ? ajustes.perfil : hardware.perfilAuto(hw || hardware.detectar());
      await fsp.writeFile(optFile, hardware.optionsTxt(perfil, this.cfg.opcionesIniciales || {}));
      this.log(`options.txt creado con el perfil gráfico "${perfil}"`);
    }
    await this.texturas(sinTexturas, texturasDelPack(overrides));
    this.onProgress({ etapa: 'listo', texto: 'Todo listo' });
    this.log(`Instalación verificada en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { java, install, packVersion, mcVersion, loaderVersion, reporte: rep };
  }

  /** Aplica un perfil gráfico al options.txt existente (botón "Optimizar para mi PC"). */
  async aplicarPerfil(perfilId) {
    const optFile = path.join(this.dirs.game, 'options.txt');
    const p = hardware.PERFILES[perfilId];
    if (!p) throw new Error('Perfil desconocido');
    let txt = '';
    try { txt = await fsp.readFile(optFile, 'utf8'); } catch { /* */ }
    const map = new Map(txt.split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i), l.slice(i + 1)]; }));
    if (!map.size) { await fsp.mkdir(this.dirs.game, { recursive: true }); await fsp.writeFile(optFile, hardware.optionsTxt(perfilId, this.cfg.opcionesIniciales || {})); return; }
    for (const k of ['renderDistance', 'simulationDistance', 'graphicsMode', 'particles', 'entityShadows', 'biomeBlendRadius', 'maxFps']) map.set(k, String(p[k]));
    await fsp.writeFile(optFile, `${[...map].map(([k, v]) => `${k}:${v}`).join('\n')}\n`);
  }

  /**
   * Paquetes de texturas del evento.
   * - Modo seguro: abre el juego sin paquetes y guarda la lista que tenía el jugador.
   * - Inicio normal: restaura esa lista (si el jugador no activó nada a mano) y deja los paquetes
   *   obligatorios del modpack activados y encima de los demás, en el orden del options.txt del .mrpack.
   */
  async texturas(sinTexturas, obligatorias = []) {
    const optFile = path.join(this.dirs.game, 'options.txt');
    const guardadas = path.join(this.dirs.game, '.quantum', 'texturas.json');
    const base = ['vanilla', 'fabric'];
    let txt = '';
    try { txt = await fsp.readFile(optFile, 'utf8'); } catch { return; }
    const lineas = txt.split(/\r?\n/).filter(Boolean);
    const i = lineas.findIndex((l) => l.startsWith('resourcePacks:'));
    let actual = [];
    try { actual = i >= 0 ? JSON.parse(lineas[i].slice('resourcePacks:'.length)) : []; } catch { actual = []; }
    if (!Array.isArray(actual)) actual = [];
    const soloBase = actual.every((p) => base.includes(p));
    const escribir = async (lista) => {
      const l = `resourcePacks:${JSON.stringify(lista)}`;
      if (i >= 0) lineas[i] = l; else lineas.push(l);
      const j = lineas.findIndex((x) => x.startsWith('incompatibleResourcePacks:'));
      if (j >= 0) lineas[j] = 'incompatibleResourcePacks:[]';
      await fsp.writeFile(optFile, `${lineas.join('\n')}\n`);
    };
    if (sinTexturas) {
      if (!soloBase) {
        await fsp.mkdir(path.dirname(guardadas), { recursive: true });
        if (!(await http.exists(guardadas))) await fsp.writeFile(guardadas, JSON.stringify(actual));
        await escribir(base);
      }
      this.log('Modo seguro: inicio sin paquetes de texturas');
      return;
    }
    let lista = actual;
    if (await http.exists(guardadas)) {
      try {
        const g = JSON.parse(await fsp.readFile(guardadas, 'utf8'));
        if (soloBase && Array.isArray(g) && g.length) { lista = g; this.log('Paquetes de texturas restaurados'); }
      } catch { /* archivo dañado: se ignora */ }
      await fsp.rm(guardadas, { force: true });
    }
    // Obligatorios: solo los que existen en resourcepacks/, siempre al final (prioridad más alta)
    const presentes = [];
    for (const p of obligatorias) {
      if (!p.startsWith('file/')) continue;
      if (await http.exists(path.join(this.dirs.game, 'resourcepacks', p.slice(5)))) presentes.push(p);
    }
    const final = [...lista.filter((p) => !presentes.includes(p)), ...presentes];
    for (const b of [...base].reverse()) if (!final.includes(b)) final.unshift(b);
    if (JSON.stringify(final) !== JSON.stringify(actual)) await escribir(final);
  }

  // ---------- Lanzar ----------
  /**
   * cuenta: { tipo, nombre, uuid, accessToken?, xuid? }
   * Devuelve una promesa que se resuelve cuando el juego se cierra: { code, crash, log }
   */
  async lanzar(prep, cuenta, ajustes = {}, { onStarted = () => {} } = {}) {
    const g = this.dirs.game;
    const natives = path.join(g, '.quantum', 'natives');
    const mc = new MinecraftInstaller({ sharedDir: this.dirs.shared, endpoints: this.cfg.endpoints, log: (l) => this.log(l) });
    await mc.extractNatives(prep.install.libs, natives);
    const s = this.cfg.servidor;
    const args = buildLaunchArgs(prep.install, mc.dirs, {
      account: { ...cuenta, clientId: this.cfg.microsoft?.clientId },
      gameDir: g, nativesDir: natives,
      ramMB: ajustes.ramMB || this.cfg.ram?.defectoMB || 4096,
      width: ajustes.ancho, height: ajustes.alto, fullscreen: !!ajustes.pantallaCompleta,
      quickPlay: ajustes.conectarDirecto === false ? '' : `${s.host}:${s.puerto}`,
      launcherVersion: this.launcherVersion,
      jvmExtra: this.cfg.jvmExtra || [],
    });
    // En Windows, Java lee los argumentos con la página de códigos del sistema: pasarlos directamente
    // funciona con rutas con tildes o ñ (C:\Users\José). Solo si la línea es demasiado larga
    // (límite de Windows: 32 767 caracteres) se usa un archivo de argumentos.
    const all = [...args.jvm, args.mainClass, ...args.game];
    const argFile = path.join(g, '.quantum', 'args.txt');
    const largo = all.reduce((n, a) => n + String(a).length + 3, javaLen(prep));
    const usarArchivo = largo > 30000 || process.env.QUANTUM_ARGFILE === '1';
    if (usarArchivo) await fsp.writeFile(argFile, toArgFile(all));
    const javaBin = ajustes.consolaJava ? prep.java.console : prep.java.path;
    const seguro = (t) => (cuenta.accessToken ? t.split(cuenta.accessToken).join('••••') : t);
    this.log(`Iniciando Minecraft ${prep.mcVersion} (Fabric ${prep.loaderVersion}) como ${cuenta.nombre} [${cuenta.tipo === 'microsoft' ? 'premium' : 'no premium'}], RAM ${ajustes.ramMB || 4096} MB`);
    const gameLog = [];
    const startedAt = Date.now();
    const crashDir = path.join(g, 'crash-reports');
    const crashBefore = new Set(await fsp.readdir(crashDir).catch(() => []));
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(javaBin, usarArchivo ? [`@${argFile}`] : all, { cwd: g, windowsHide: false, env: cleanEnv() });
      } catch (e) { reject(e); return; }
      this.child = child;
      const take = (d) => {
        for (const line of seguro(d.toString('utf8')).split(/\r?\n/)) {
          if (!line) continue;
          gameLog.push(line); if (gameLog.length > 3000) gameLog.shift();
          this.onLog(line);
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', (e) => { this.child = null; reject(new Error(`No se pudo iniciar Java: ${e.message}`)); });
      child.on('spawn', () => onStarted(child.pid));
      child.on('close', async (code) => {
        this.child = null;
        // Borrar el archivo de argumentos: contiene el token de sesión
        await fsp.rm(argFile, { force: true }).catch(() => {});
        const after = await fsp.readdir(crashDir).catch(() => []);
        const nuevo = after.filter((f) => !crashBefore.has(f)).sort().pop();
        let crash = null;
        if (nuevo) crash = { archivo: path.join(crashDir, nuevo), texto: await fsp.readFile(path.join(crashDir, nuevo), 'utf8').catch(() => '') };
        const minutos = ((Date.now() - startedAt) / 60000).toFixed(1);
        this.log(`Minecraft se cerró (código ${code}) tras ${minutos} min`);
        const fallo = code !== 0 || !!crash;
        let logFile = null;
        if (fallo) {
          logFile = path.join(g, 'logs', `quantum-error-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
          await fsp.mkdir(path.dirname(logFile), { recursive: true });
          await fsp.writeFile(logFile, [...this.logLines, '----- Salida del juego -----', ...gameLog].join('\n')).catch(() => {});
        }
        resolve({ code, fallo, crash, log: gameLog.slice(-400).join('\n'), logFile });
      });
    });
  }

  detener() { if (this.child) this.child.kill(); }
}

module.exports = { QuantumCore, cmpVersion, texturasDelPack };
