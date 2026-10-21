'use strict';
// Proceso principal de Electron: ventana, IPC y conexión con el núcleo del launcher.
const { app, BrowserWindow, ipcMain, shell, net, safeStorage, dialog } = require('electron');
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
  const def = { ramMB: lim.recomendado, ancho: 1280, alto: 720, pantallaCompleta: false, perfil: 'auto', modoLigero: null, conectarDirecto: true, cerrarAlJugar: false };
  try { return { ...def, ...JSON.parse(fs.readFileSync(ajustesFile, 'utf8')) }; } catch { return def; }
}
function guardarAjustes(a) {
  const lim = hardware.limitesRam(hw.ramMB, cfg.ram);
  const limpio = { ...leerAjustes(), ...a };
  limpio.ramMB = Math.max(lim.min, Math.min(lim.max, Math.round(Number(limpio.ramMB) / 256) * 256 || lim.recomendado));
  limpio.ancho = Math.max(640, Math.min(7680, Number(limpio.ancho) || 1280));
  limpio.alto = Math.max(480, Math.min(4320, Number(limpio.alto) || 720));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ajustesFile, JSON.stringify(limpio, null, 1));
  return limpio;
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
    title: `${cfg.nombre}: ${cfg.evento}`,
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
function loginMicrosoft() {
  const { clientId, redirectUri } = cfg.microsoft;
  if (!clientId || clientId.startsWith('PEGA_AQUI')) {
    return Promise.reject(new Error('El inicio de sesión premium todavía no está configurado (falta el Client ID de Azure). Usa el modo no premium.'));
  }
  const { verifier, challenge, state } = accounts.pkce();
  const authEp = cfg.endpoints?.auth || {};
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      parent: win, modal: true, width: 520, height: 680, autoHideMenuBar: true,
      title: 'Iniciar sesión con Microsoft', backgroundColor: '#ffffff',
      webPreferences: { partition: `msauth-${Date.now()}`, sandbox: true, contextIsolation: true },
    });
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

// ---------- IPC ----------
function manejar(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, datos: await fn(...args) }; } catch (e) { core?.log(`Error (${canal}): ${e.message}`); return { ok: false, error: e.message, reLogin: !!e.reLogin }; }
  });
}

function registrarIpc() {
  manejar('init', async () => ({
    evento: { nombre: cfg.nombre, evento: cfg.evento, organiza: cfg.organiza, discord: cfg.discord, fechaEvento: cfg.fechaEvento, servidor: cfg.servidor.nombreVisible, ip: `${cfg.servidor.host}:${cfg.servidor.puerto}` },
    version: VERSION, portable: PORTABLE,
    hw, ram: hardware.limitesRam(hw.ramMB, cfg.ram), perfilAuto: hardware.perfilAuto(hw),
    ajustes: leerAjustes(), cuentas: store.list(), instalado: (await core.estadoInstalacion())?.packVersion || null,
  }));
  manejar('noticias', () => core.leerNoticias());
  manejar('servidor:estado', () => ping(cfg.servidor.host, cfg.servidor.puerto));
  manejar('actualizacion', () => core.comprobarActualizacion().then((r) => ({ instalada: r.instalada, disponible: r.disponible, hayNueva: r.hayNueva, launcherNuevo: r.launcherNuevo && PORTABLE, launcherVersion: r.manifiesto?.launcher?.version, launcherDescarga: r.manifiesto?.launcher?.descarga, nota: r.manifiesto?.modpack?.nota || '' })));

  manejar('cuentas:offline', async (nombre) => { const c = accounts.crearOffline(String(nombre || '').trim()); await store.upsert(c); return store.list(); });
  manejar('cuentas:microsoft', async () => { const c = await loginMicrosoft(); await store.upsert(c); return store.list(); });
  manejar('cuentas:seleccionar', async (id) => { await store.select(id); return store.list(); });
  manejar('cuentas:eliminar', async (id) => { await store.remove(id); return store.list(); });

  manejar('ajustes:guardar', (a) => guardarAjustes(a));
  manejar('perfil:aplicar', async (id) => { const p = id === 'auto' ? hardware.perfilAuto(hw) : id; await core.aplicarPerfil(p); return p; });
  manejar('carpeta:abrir', async () => { fs.mkdirSync(core.dirs.game, { recursive: true }); await shell.openPath(core.dirs.game); });
  manejar('enlace:abrir', async (url) => abrirExterno(url));
  manejar('registro', async () => core.logLines.join('\n'));
  manejar('registro:guardar', async (texto) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('desktop'), 'quantum-registro.txt') });
    if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, texto);
  });
  manejar('launcher:instalarActualizacion', async () => { autoUpdater?.quitAndInstall(true, true); });

  manejar('jugar', async ({ reparar = false } = {}) => {
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
      const prep = await core.preparar({ reparar, ajustes, hw });
      send('progreso', { etapa: 'juego', texto: 'Abriendo Minecraft…' });
      const r = await core.lanzar(prep, cuenta, ajustes, {
        onStarted: () => {
          send('juego', { estado: 'abierto' });
          setTimeout(() => { if (jugando && win) { if (ajustes.cerrarAlJugar) win.hide(); else win.minimize(); } }, 4000);
        },
      });
      if (win) { win.show(); win.restore(); }
      send('juego', { estado: 'cerrado', ...r });
      return { packVersion: prep.packVersion, reporte: prep.reporte };
    } finally { jugando = false; }
  });

  ipcMain.on('ventana', (_e, accion) => {
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
    onLog: (l) => send('log', l),
  });
  core.log(`Quantum Launcher ${VERSION}${PORTABLE ? ' (portable)' : ''} en ${hw.sistema}, ${hw.cpu}, ${hw.nucleos} hilos, ${Math.round(hw.ramMB / 1024)} GB RAM, GPU ${hw.gpu}`);
  store = await new accounts.AccountStore(path.join(dataDir, 'cuentas.json'), cipher).load();
  registrarIpc();
  crearVentana();
  iniciarAutoUpdate();
});

app.on('second-instance', () => { if (win) { win.show(); win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!jugando) app.quit(); });
