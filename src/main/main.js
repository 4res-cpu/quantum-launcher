'use strict';
// Proceso principal de Electron: ventana, IPC y conexión con el núcleo del launcher.
const { app, BrowserWindow, ipcMain, shell, net, safeStorage, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('../core/http');
const { QuantumCore } = require('../core/launcher');
const accounts = require('../core/accounts');
const hardware = require('../core/hardware');
const { ping } = require('../core/status');

// QUANTUM_CONFIG permite probar otro evento sin recompilar (p. ej. un servidor de pruebas)
const cfg = JSON.parse(fs.readFileSync(process.env.QUANTUM_CONFIG || path.join(__dirname, '..', '..', 'evento.config.json'), 'utf8'));
const VERSION = app.getVersion();
const PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;

// Carpeta de datos: %APPDATA%\QuantumLauncher (nunca .minecraft). En la versión portable, junto al .exe.
const dataDir = PORTABLE
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'QuantumLauncher-datos')
  : path.join(app.getPath('appData'), 'QuantumLauncher');
app.setPath('userData', path.join(dataDir, 'electron'));

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
let core = null;
let store = null;
let hw = null;
let jugando = false;
const ajustesFile = path.join(dataDir, 'ajustes.json');

function send(canal, datos) { if (win && !win.isDestroyed()) win.webContents.send(canal, datos); }

function leerAjustes() {
  const lim = hardware.limitesRam(hw.ramMB, cfg.ram);
  const def = { ramMB: lim.recomendado, ancho: 1280, alto: 720, pantallaCompleta: false, perfil: 'auto', modoLigero: null, modoSeguro: false, conectarDirecto: true, cerrarAlJugar: false,
    idioma: 'es', tema: 'tinta', acento: 'quantum', sonidos: true, volumen: 60, animaciones: true, intro: true, ilustracion: 'rotar', ilusAnimada: true, consola: false, javaArgs: '', idiomaJuego: 'es_es' };
  try { return { ...def, ...JSON.parse(fs.readFileSync(ajustesFile, 'utf8')) }; } catch { return def; }
}
function guardarAjustes(a) {
  const lim = hardware.limitesRam(hw.ramMB, cfg.ram);
  const limpio = { ...leerAjustes(), ...a };
  limpio.ramMB = Math.max(lim.min, Math.min(lim.max, Math.round(Number(limpio.ramMB) / 256) * 256 || lim.recomendado));
  limpio.ancho = Math.max(640, Math.min(7680, Number(limpio.ancho) || 1280));
  limpio.alto = Math.max(480, Math.min(4320, Number(limpio.alto) || 720));
  const de = (v, lista, d) => (lista.includes(v) ? v : d);
  limpio.idioma = de(limpio.idioma, ['es', 'en', 'pt'], 'es');
  limpio.tema = de(limpio.tema, ['tinta', 'papel'], 'tinta');
  limpio.acento = de(limpio.acento === 'jade' ? 'quantum' : limpio.acento, ['quantum', 'oro', 'carmesi', 'violeta'], 'quantum');
  limpio.ilustracion = 'rotar';
  limpio.idiomaJuego = de(limpio.idiomaJuego, ['es_es', 'es_mx', 'en_us', 'pt_br'], 'es_es');
  limpio.volumen = Math.max(0, Math.min(100, Number(limpio.volumen) || 0));
  for (const k of ['sonidos', 'animaciones', 'intro', 'pantallaCompleta', 'cerrarAlJugar', 'conectarDirecto', 'modoSeguro', 'ilusAnimada', 'consola']) limpio[k] = !!limpio[k];
  limpio.javaArgs = String(limpio.javaArgs || '').slice(0, 1000);
  limpio.modsOff = Array.isArray(limpio.modsOff) ? limpio.modsOff.filter((x) => typeof x === 'string').map((x) => path.basename(x)).slice(0, 300) : [];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ajustesFile, JSON.stringify(limpio, null, 1));
  return limpio;
}

// ---------- Tiempo de juego ----------
const statsFile = path.join(dataDir, 'estadisticas.json');
function leerStats() {
  try { return { totalMs: 0, sesiones: 0, ultima: null, ...JSON.parse(fs.readFileSync(statsFile, 'utf8')) }; } catch { return { totalMs: 0, sesiones: 0, ultima: null }; }
}
function sumarSesion(ms) {
  if (!(ms > 15000)) return;
  const s = leerStats();
  s.totalMs += ms; s.sesiones += 1; s.ultima = new Date().toISOString(); s.ultimaMs = ms;
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(statsFile, JSON.stringify(s)); } catch { /* */ }
}

// ---------- Capturas, mods y carpetas ----------
const CARPETAS = { juego: '', capturas: 'screenshots', mods: 'mods', texturas: 'resourcepacks', registros: 'logs' };
function carpeta(id) {
  if (id === 'datos') return dataDir;
  return path.join(core.dirs.game, CARPETAS[id] ?? '');
}
function capturaSegura(nombre) {
  const base = path.basename(String(nombre || ''));
  if (!/\.(png|jpe?g)$/i.test(base)) throw new Error('Archivo no válido');
  return path.join(carpeta('capturas'), base);
}
function listarCapturas() {
  const dir = carpeta('capturas');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)); } catch { return []; }
  return files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 48).map(({ f, t }) => {
    let miniatura = '';
    try { miniatura = nativeImage.createFromPath(path.join(dir, f)).resize({ width: 360, quality: 'good' }).toDataURL(); } catch { /* */ }
    return { nombre: f, fecha: new Date(t).toISOString(), miniatura };
  });
}
const dirJugador = () => path.join(dataDir, 'mods-jugador');
function estadoJugador() { try { return JSON.parse(fs.readFileSync(path.join(dirJugador(), 'estado.json'), 'utf8')); } catch { return {}; } }
function guardarEstadoJugador(e) { fs.mkdirSync(dirJugador(), { recursive: true }); fs.writeFileSync(path.join(dirJugador(), 'estado.json'), JSON.stringify(e, null, 1)); }
function listarMods() {
  const kb = (f) => { try { return Math.round(fs.statSync(f).size / 1024); } catch { return 0; } };
  let estado = { files: {} }; try { estado = JSON.parse(fs.readFileSync(path.join(carpeta('juego'), '.quantum', 'estado.json'), 'utf8')); } catch { /* */ }
  const off = new Set(leerAjustes().modsOff || []);
  const pack = Object.entries(estado.files || {}).filter(([rel]) => /^mods\/.+\.jar$/i.test(rel)).map(([rel, v]) => {
    const archivo = rel.slice(5);
    return { archivo, activo: !off.has(archivo), obligatorio: v.servidor !== 'unsupported' && v.servidor !== 'optional', kb: kb(path.join(carpeta('mods'), archivo)) || kb(path.join(carpeta('mods'), `${archivo}.disabled`)) };
  });
  const ej = estadoJugador();
  let jug = []; try { jug = fs.readdirSync(dirJugador()).filter((f) => /\.jar$/i.test(f)); } catch { /* */ }
  const jugador = jug.map((f) => ({ archivo: f, activo: (ej[f] || {}).activo !== false, ok: (ej[f] || {}).ok !== false, motivo: (ej[f] || {}).motivo || '', kb: kb(path.join(dirJugador(), f)) }));
  let bloqueados = []; try { bloqueados = fs.readdirSync(path.join(carpeta('juego'), '.quantum', 'bloqueados')); } catch { /* */ }
  const leer = (id, filtro) => { try { return fs.readdirSync(carpeta(id)).filter(filtro).map((f) => ({ nombre: f, kb: kb(path.join(carpeta(id), f)) })); } catch { return []; } };
  return { pack, jugador, bloqueados, texturas: leer('texturas', (f) => /\.zip$/i.test(f) || !f.includes('.')) };
}
async function anadirMods() {
  const { analizarMod } = require('../core/anticheat');
  const r = await dialog.showOpenDialog(win, { title: 'Añadir mods', filters: [{ name: 'Mods de Fabric', extensions: ['jar'] }], properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return { lista: listarMods(), resultado: [] };
  fs.mkdirSync(dirJugador(), { recursive: true });
  const ej = estadoJugador(); const resultado = [];
  for (const f of r.filePaths) {
    const nombre = path.basename(f).replace(/[^\w.+\-() ]/g, '_');
    const a = analizarMod(fs.readFileSync(f), nombre);
    resultado.push({ archivo: nombre, ok: a.ok, motivo: a.motivo });
    if (!a.ok) { core?.log(`Anti-trampas: rechazado ${nombre}: ${a.motivo}`); continue; }
    fs.copyFileSync(f, path.join(dirJugador(), nombre));
    ej[nombre] = { activo: true, ok: true, motivo: '', nombre: a.nombre };
  }
  guardarEstadoJugador(ej);
  return { lista: listarMods(), resultado };
}

const cipher = {
  encrypt: (s) => (safeStorage.isEncryptionAvailable() ? `e:${safeStorage.encryptString(s).toString('base64')}` : `p:${s}`),
  decrypt: (s) => (s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : s.slice(2)),
};

async function detectarHardware() {
  let gpu = '';
  try {
    const info = await app.getGPUInfo('complete');
    // Ej.: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)"
    const raw = info?.auxAttributes?.glRenderer || '';
    const m = /^ANGLE \([^,]*,\s*([^,]+)/.exec(raw);
    gpu = (m ? m[1] : raw).replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+(Direct3D|OpenGL|Vulkan|Metal).*$/i, '').trim();
  } catch { /* sin información de GPU */ }
  return hardware.detectar({ nombre: gpu });
}

function crearVentana() {
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 1000, minHeight: 640,
    frame: false, backgroundColor: '#090c09', show: false,
    title: cfg.nombre === cfg.evento ? cfg.nombre : `${cfg.nombre}: ${cfg.evento}`,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Los enlaces externos se abren en el navegador, nunca dentro del launcher
  win.webContents.setWindowOpenHandler(({ url }) => { abrirExterno(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function abrirExterno(url) {
  try { const u = new URL(url); if (u.protocol === 'https:') shell.openExternal(url); } catch { /* */ }
}

// ---------- Inicio de sesión de Microsoft ----------
// 1.1.4: primero con CÓDIGO (se entra en el navegador normal del PC, en microsoft.com/link: es lo que usan los
// launchers grandes y no depende de la ventana interna). Si Microsoft no da código, se usa la ventana interna.
let loginActivo = null;   // { cancelado }
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

async function loginMicrosoft() {
  const { clientId } = cfg.microsoft;
  if (!clientId || clientId.startsWith('PEGA_AQUI')) {
    throw new Error('El inicio de sesión premium no está disponible por ahora. Puedes jugar con el modo no premium.');
  }
  const authEp = cfg.endpoints?.auth || {};
  // 1.1.5: con NUESTRA aplicación de Azure el inicio con código (microsoft.com/link) da el error de Microsoft
  // "aplicación de primera parte ... preautorización" (Xbox Live no acepta ese flujo para apps nuevas).
  // La ventana de inicio de sesión sí funciona (es la que se usaba hasta la 1.1.3), así que va primero.
  // Para volver a probar el código: "microsoft": { "usarCodigo": true } en evento.config.json.
  if (!cfg.microsoft.usarCodigo) return loginVentana();
  let dc = null;
  try { dc = await accounts.pedirCodigoDispositivo({ clientId, endpoints: authEp }); }
  catch (e) { core?.log(`Inicio de sesión con código no disponible (${e.body?.error || e.message}); se usa la ventana.`); }
  if (!dc) return loginVentana();
  const estadoLogin = { cancelado: false };
  loginActivo = estadoLogin;
  send('cuentas:codigo', { codigo: dc.codigo, url: dc.url, expira: dc.expira });
  abrirExterno(`https://www.microsoft.com/link?otc=${encodeURIComponent(dc.codigo)}`);
  try {
    return await accounts.esperarCodigoDispositivo(dc, { clientId, endpoints: authEp, cancelado: () => estadoLogin.cancelado });
  } finally { if (loginActivo === estadoLogin) loginActivo = null; send('cuentas:codigo', null); }
}

function loginVentana() {
  const { clientId, redirectUri } = cfg.microsoft;
  const { verifier, challenge, state } = accounts.pkce();
  const authEp = cfg.endpoints?.auth || {};
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      parent: win, modal: true, width: 520, height: 680, autoHideMenuBar: true,
      title: 'Iniciar sesión con Microsoft', backgroundColor: '#ffffff',
      webPreferences: { partition: 'persist:msauth', sandbox: true, contextIsolation: true },
    });
    // Microsoft enseña una página en blanco a navegadores que no reconoce: se presenta como Chrome normal.
    w.webContents.setUserAgent(UA_CHROME);
    w.webContents.setWindowOpenHandler(({ url }) => { w.loadURL(url); return { action: 'deny' }; });
    let terminado = false;
    const fin = (err, val) => { if (terminado) return; terminado = true; if (!w.isDestroyed()) w.close(); if (err) reject(err); else resolve(val); };
    const revisar = (e, url) => {
      if (!url.startsWith(redirectUri)) return;
      if (e?.preventDefault) e.preventDefault();
      const u = new URL(url);
      if (u.searchParams.get('state') !== state) return fin(new Error('Respuesta de inicio de sesión no válida. Inténtalo otra vez.'));
      const error = u.searchParams.get('error');
      if (error) return fin(new Error(error === 'access_denied' ? 'Cancelaste el inicio de sesión.' : `Microsoft: ${u.searchParams.get('error_description') || error}`));
      const code = u.searchParams.get('code');
      accounts.canjearCodigo({ code, verifier, clientId, redirectUri, endpoints: authEp }).then((c) => fin(null, c), (er) => fin(er));
      if (!w.isDestroyed()) w.hide();
    };
    w.webContents.on('will-redirect', revisar);
    w.webContents.on('will-navigate', revisar);
    w.webContents.on('did-navigate', (e, url) => revisar(null, url));
    w.webContents.on('did-fail-load', (_e, code, desc, url, principal) => {
      if (!principal || code === -3 || url.startsWith(redirectUri)) return;   // -3 = cancelada (la redirección final)
      core?.log(`Inicio de sesión: no cargó ${url} (${desc})`);
      fin(new Error('No se pudo abrir la página de Microsoft. Revisa tu internet o el antivirus y vuelve a intentarlo.'));
    });
    w.on('closed', () => fin(new Error('Cancelaste el inicio de sesión.')));
    w.loadURL(accounts.authorizeUrl({ clientId, redirectUri, challenge, state, endpoints: authEp }));
  });
}

// ---------- Actualización del propio launcher ----------
let autoUpdater = null;
function iniciarAutoUpdate() {
  if (!app.isPackaged || PORTABLE) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (i) => send('launcher:update', { estado: 'descargando', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => send('launcher:update', { estado: 'listo', version: i.version }));
  autoUpdater.on('error', (e) => core?.log(`Actualizador del launcher: ${e.message}`));
  autoUpdater.checkForUpdates().catch(() => {});
}


// ---------- Skin y capas ----------
const MC_PERFIL = 'https://api.minecraftservices.com/minecraft/profile';
async function aDataUrl(url) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
}
async function cuentaPremium() {
  let c = store.active();
  if (!c || c.tipo !== 'microsoft') throw new Error('Necesitas una cuenta premium.');
  c = await accounts.renovarSiHaceFalta(c, { clientId: cfg.microsoft.clientId, endpoints: cfg.endpoints?.auth });
  await store.upsert(c);
  return c;
}
async function apiPerfil(c, metodo = 'GET', ruta = '', cuerpo) {
  const opts = { method: metodo, headers: { Authorization: `Bearer ${c.accessToken}` } };
  if (cuerpo instanceof FormData) opts.body = cuerpo;
  else if (cuerpo) { opts.body = JSON.stringify(cuerpo); opts.headers['Content-Type'] = 'application/json'; }
  const r = await net.fetch(MC_PERFIL + ruta, opts);
  if (!r.ok) throw new Error(r.status === 429 ? 'Demasiados cambios seguidos. Espera un minuto.' : `Minecraft respondió ${r.status}`);
  return r.json().catch(() => ({}));
}
async function perfilSkin(c) {
  const p = await apiPerfil(c);
  const skin = (p.skins || []).find((x) => x.state === 'ACTIVE');
  const capas = await Promise.all((p.capes || []).map(async (x) => ({ id: x.id, nombre: x.alias || 'Capa', activa: x.state === 'ACTIVE', img: await aDataUrl(x.url).catch(() => null) })));
  return { premium: true, skin: skin ? await aDataUrl(skin.url) : null, modelo: skin?.variant === 'SLIM' ? 'slim' : 'default', capas };
}
async function datosSkin() {
  const c = store.active();
  if (!c) return null;
  if (c.tipo === 'microsoft') {
    try { return await perfilSkin(await cuentaPremium()); } catch (e) { core?.log(`Skin: ${e.message}`); }
  }
  const skin = await aDataUrl(`https://mc-heads.net/skin/${encodeURIComponent(c.tipo === 'microsoft' ? c.uuid : c.nombre)}`).catch(() => null);
  return { premium: c.tipo === 'microsoft', skin, modelo: 'auto', capas: [] };
}
async function subirSkin(modelo) {
  const c = await cuentaPremium();
  const r = await dialog.showOpenDialog(win, { title: 'Elige tu skin', filters: [{ name: 'Skin PNG', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const img = nativeImage.createFromPath(r.filePaths[0]);
  const { width, height } = img.getSize();
  if (width !== 64 || (height !== 64 && height !== 32)) throw new Error('La skin debe ser un PNG de 64×64 (o 64×32).');
  const fd = new FormData();
  fd.append('variant', modelo === 'slim' ? 'slim' : 'classic');
  fd.append('file', new Blob([fs.readFileSync(r.filePaths[0])], { type: 'image/png' }), 'skin.png');
  await apiPerfil(c, 'POST', '/skins', fd);
  return perfilSkin(c);
}
async function ponerCapa(id) {
  const c = await cuentaPremium();
  if (id) await apiPerfil(c, 'PUT', '/capes/active', { capeId: id }); else await apiPerfil(c, 'DELETE', '/capes/active');
  return perfilSkin(c);
}

// ---------- Consola del juego ----------
let consola = null;
function abrirConsola() {
  if (consola && !consola.isDestroyed()) { consola.show(); consola.focus(); return; }
  consola = new BrowserWindow({
    width: 980, height: 600, minWidth: 560, minHeight: 320, frame: false, backgroundColor: '#05091a', show: false,
    title: 'Consola · Quantum Network', icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  consola.loadFile(path.join(__dirname, '..', 'renderer', 'consola.html'));
  consola.once('ready-to-show', () => consola.show());
  consola.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  consola.webContents.on('will-navigate', (e) => e.preventDefault());
  consola.on('closed', () => { consola = null; });
}
function enviarLog(l) {
  send('log', l);
  if (consola && !consola.isDestroyed()) consola.webContents.send('log', l);
}

// ---------- IPC ----------
function manejar(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, datos: await fn(...args) }; } catch (e) { core?.log(`Error (${canal}): ${e.message}`); return { ok: false, error: e.message, reLogin: !!e.reLogin }; }
  });
}

function registrarIpc() {
  manejar('init', async () => ({
    evento: { nombre: cfg.nombre, evento: cfg.evento, organiza: cfg.organiza, discord: cfg.discord, servidor: cfg.servidor.nombreVisible, ip: `${cfg.servidor.host}:${cfg.servidor.puerto}`,
      textos: cfg.textos || {}, logo: cfg.logo || null, gifs: cfg.gifs ?? null, modos: cfg.modos || [], modulos: (cfg.modulos || []).map((m) => ({ id: m.id, nombre: m.nombre, desc: m.desc, defecto: m.defecto !== false, icono: m.icono || '', grupo: m.grupo || 'extras', efecto: m.efecto || '', requiere: m.requiere || null })) },
    version: VERSION, portable: PORTABLE,
    hw, ram: hardware.limitesRam(hw.ramMB, cfg.ram), perfilAuto: hardware.perfilAuto(hw),
    ajustes: leerAjustes(), cuentas: store.list(), instalado: (await core.estadoInstalacion())?.packVersion || null,
    stats: leerStats(), rutas: { datos: dataDir, juego: core.dirs.game }, plataforma: process.platform,
    enlaces: cfg.enlaces || {}, ilustraciones: cfg.ilustraciones || [], legal: cfg.legal || null,
  }));
  manejar('contenido', () => core.leerRemoto('contenido', cfg.urls?.contenido));
  manejar('stats', () => leerStats());
  manejar('capturas:listar', () => listarCapturas());
  manejar('capturas:ver', (nombre) => nativeImage.createFromPath(capturaSegura(nombre)).resize({ width: 1600, quality: 'good' }).toDataURL());
  manejar('capturas:abrir', async (nombre) => { await shell.openPath(capturaSegura(nombre)); });
  manejar('mods:listar', () => listarMods());
  manejar('mods:anadir', () => anadirMods());
  manejar('mods:alternar', ({ archivo, activo, origen }) => {
    archivo = path.basename(String(archivo));
    if (origen === 'jugador') { const e = estadoJugador(); e[archivo] = { ...(e[archivo] || {}), activo: !!activo }; guardarEstadoJugador(e); }
    else { const off = new Set(leerAjustes().modsOff || []); if (activo) off.delete(archivo); else off.add(archivo); guardarAjustes({ modsOff: [...off] }); }
    return listarMods();
  });
  manejar('mods:quitar', (archivo) => { archivo = path.basename(String(archivo)); fs.rmSync(path.join(dirJugador(), archivo), { force: true }); const e = estadoJugador(); delete e[archivo]; guardarEstadoJugador(e); return listarMods(); });
  manejar('skin:datos', () => datosSkin());
  manejar('skin:subir', (modelo) => subirSkin(modelo));
  manejar('skin:capa', (id) => ponerCapa(id || null));
  manejar('consola:abrir', () => abrirConsola());
  manejar('consola:historial', () => [...core.logLines.slice(-1500), ...(core.gameLog || []).slice(-3000)]);
  manejar('creditos', () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'creditos.json'), 'utf8')); } catch { return null; } });
  manejar('noticias', () => core.leerNoticias());
  manejar('servidor:estado', () => ping(cfg.servidor.host, cfg.servidor.puerto));
  manejar('actualizacion', () => core.comprobarActualizacion().then((r) => ({ instalada: r.instalada, disponible: r.disponible, hayNueva: r.hayNueva, launcherNuevo: r.launcherNuevo && PORTABLE, launcherVersion: r.manifiesto?.launcher?.version, launcherDescarga: r.manifiesto?.launcher?.descarga, nota: r.manifiesto?.modpack?.nota || '' })));

  manejar('cuentas:offline', async (nombre) => { const c = accounts.crearOffline(String(nombre || '').trim()); await store.upsert(c); return store.list(); });
  manejar('cuentas:microsoft', async () => { const c = await loginMicrosoft(); await store.upsert(c); return store.list(); });
  manejar('cuentas:cancelarMicrosoft', async () => { if (loginActivo) loginActivo.cancelado = true; return true; });
  manejar('cuentas:seleccionar', async (id) => { await store.select(id); return store.list(); });
  manejar('cuentas:eliminar', async (id) => { await store.remove(id); return store.list(); });

  manejar('ajustes:guardar', (a) => guardarAjustes(a));
  manejar('perfil:aplicar', async (id) => { const p = id === 'auto' ? hardware.perfilAuto(hw) : id; await core.aplicarPerfil(p); return p; });
  manejar('carpeta:abrir', async (id = 'juego') => { if (id === 'jugador') { fs.mkdirSync(dirJugador(), { recursive: true }); await shell.openPath(dirJugador()); return; } const d = carpeta(id); fs.mkdirSync(d, { recursive: true }); await shell.openPath(d); });
  manejar('enlace:abrir', async (url) => abrirExterno(url));
  manejar('registro', async () => core.logLines.join('\n'));
  manejar('registro:guardar', async (texto) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('desktop'), 'quantum-registro.txt') });
    if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, texto);
  });
  manejar('launcher:instalarActualizacion', async () => { autoUpdater?.quitAndInstall(true, true); });

  manejar('jugar', async ({ reparar = false, sinTexturas = false } = {}) => {
    if (jugando) throw new Error('El juego ya está abierto.');
    let cuenta = store.active();
    if (!cuenta) throw new Error('Elige o añade una cuenta antes de jugar.');
    jugando = true;
    try {
      const ajustes = leerAjustes();
      if (cuenta.tipo === 'microsoft') {
        send('progreso', { etapa: 'cuenta', texto: 'Comprobando tu sesión de Microsoft…' });
        cuenta = await accounts.renovarSiHaceFalta(cuenta, { clientId: cfg.microsoft.clientId, endpoints: cfg.endpoints?.auth });
        await store.upsert(cuenta);
      }
      if (ajustes.consola) abrirConsola();
      const prep = await core.preparar({ reparar, ajustes, hw, sinTexturas: !!sinTexturas });
      send('progreso', { etapa: 'juego', texto: 'Abriendo Minecraft…' });
      let inicio = 0;
      const r = await core.lanzar(prep, cuenta, ajustes, {
        onStarted: () => {
          inicio = Date.now();
          send('juego', { estado: 'abierto' });
          setTimeout(() => { if (jugando && win) { if (ajustes.cerrarAlJugar) win.hide(); else win.minimize(); } }, 4000);
        },
      });
      if (inicio) sumarSesion(Date.now() - inicio);
      if (win) { win.show(); win.restore(); }
      send('juego', { estado: 'cerrado', ...r, stats: leerStats() });
      return { packVersion: prep.packVersion, reporte: prep.reporte };
    } finally { jugando = false; }
  });

  ipcMain.on('ventana', (e, accion) => {
    if (consola && !consola.isDestroyed() && e.sender === consola.webContents) {
      if (accion === 'minimizar') consola.minimize();
      if (accion === 'maximizar') { if (consola.isMaximized()) consola.unmaximize(); else consola.maximize(); }
      if (accion === 'cerrar') consola.close();
      return;
    }
    if (!win) return;
    if (accion === 'minimizar') win.minimize();
    if (accion === 'maximizar') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    if (accion === 'cerrar') { if (jugando) win.hide(); else app.quit(); }
  });
}

app.whenReady().then(async () => {
  http.setFetch((url, opts) => net.fetch(url, opts)); // usa el proxy y certificados del sistema
  http.setUserAgent(`QuantumLauncher/${VERSION} (+${cfg.discord})`);
  hw = await detectarHardware();
  core = new QuantumCore(cfg, dataDir, {
    launcherVersion: VERSION,
    onProgress: (p) => send('progreso', p),
    onLog: (l) => enviarLog(l),
  });
  core.log(`Quantum Launcher ${VERSION}${PORTABLE ? ' (portable)' : ''} en ${hw.sistema}, ${hw.cpu}, ${hw.nucleos} hilos, ${Math.round(hw.ramMB / 1024)} GB RAM, GPU ${hw.gpu}`);
  store = await new accounts.AccountStore(path.join(dataDir, 'cuentas.json'), cipher).load();
  registrarIpc();
  crearVentana();
  iniciarAutoUpdate();
});

app.on('second-instance', () => { if (win) { win.show(); win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!jugando) app.quit(); });
