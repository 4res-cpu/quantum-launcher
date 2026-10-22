'use strict';
// Arranca src/main/main.js con un "electron" simulado y ejecuta los mismos pasos que haría la
// interfaz (init, añadir cuenta, guardar ajustes, Jugar) contra los servicios simulados.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Mock } = require('./mock-server');

const handlers = new Map(); const eventos = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quantum-smoke-'));
class Win {
  constructor() { this.webContents = { send: (c, d) => eventos.push([c, d]), setWindowOpenHandler() {}, on() {}, isDestroyed: () => false }; }
  loadFile() {} once(e, f) { if (e === 'ready-to-show') f(); } isDestroyed() { return false; }
  show() {} minimize() {} restore() {} hide() {} focus() {}
}
const electron = {
  app: {
    getVersion: () => '1.0.0', isPackaged: false, getPath: (n) => path.join(tmp, n), setPath() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on() {}, quit() {}, getGPUInfo: async () => ({ auxAttributes: { glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)' } }),
  },
  BrowserWindow: Win,
  ipcMain: { handle: (c, f) => handlers.set(c, f), on: (c, f) => handlers.set(`on:${c}`, f) },
  shell: { openExternal() {}, openPath: async () => '' },
  net: { fetch: (...a) => fetch(...a) },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`X${s}`), decryptString: (b) => b.toString().slice(1) },
  dialog: {},
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? electron : orig.call(this, req, ...rest); };

(async () => {
  const mock = await new Mock(path.join(tmp, 'mock'), path.join(__dirname, 'fixtures', 'Eventos_Quantum_3.4.7.mrpack')).start();
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evento.config.json'), 'utf8'));
  const cfgFile = path.join(tmp, 'evento.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...base, usarJavaDelSistema: false,
    urls: { manifiesto: mock.url('/remote/manifest.json'), noticias: mock.url('/remote/noticias.json') },
    servidor: { ...base.servidor, host: '127.0.0.1', puerto: await mock.startMinecraftServer({ online: 7, max: 50 }) },
    microsoft: { ...base.microsoft, clientId: 'test-client-id' },
    endpoints: { auth: { token: mock.url('/ms/token'), devicecode: mock.url('/ms/devicecode'), xbl: mock.url('/xbox/user'), xsts: mock.url('/xbox/xsts'), mcLogin: mock.url('/mcs/login'), mcProfile: mock.url('/mcs/profile') },
      versionManifest: mock.url('/mojang/version_manifest_v2.json'), fabricMeta: mock.url('/fabric'), assets: mock.url('/assets'), adoptium: mock.url('/adoptium') } }));
  process.env.QUANTUM_CONFIG = cfgFile;
  process.env.APPDATA = tmp;
  require('../src/main/main.js');
  await new Promise((r) => setTimeout(r, 300));
  const call = async (c, ...a) => { const r = await handlers.get(c)({}, ...a); if (!r.ok) throw new Error(`${c}: ${r.error}`); return r.datos; };

  const init = await call('init');
  assert.equal(init.hw.gpu, 'NVIDIA GeForce GTX 1650');
  console.log('  init:', init.evento.servidor, '| GPU detectada:', init.hw.gpu, '| RAM', init.ram, '| perfil', init.perfilAuto);
  const r1 = await handlers.get('cuentas:offline')({}, 'ab');
  assert.equal(r1.ok, false); console.log('  nombre corto rechazado:', r1.error);
  const r2 = await handlers.get('cuentas:microsoft')({});
  assert.equal(r2.ok, true, r2.error);
  const cod = eventos.find(([c, d]) => c === 'cuentas:codigo' && d);
  assert.ok(cod && cod[1].codigo === 'ABCD-EFGH', 'la interfaz recibe el código');
  assert.ok(eventos.some(([c, d]) => c === 'cuentas:codigo' && d === null), 'y luego se oculta');
  console.log('  premium con código microsoft.com/link:', cod[1].codigo, '→', r2.datos.find((c) => c.tipo === 'microsoft')?.nombre);
  await call('cuentas:offline', 'Prueba_Quantum');
  const aj = await call('ajustes:guardar', { ramMB: 99999, ancho: 1600, alto: 900 });
  assert.equal(aj.ramMB, init.ram.max); console.log('  RAM limitada al máximo del PC:', aj.ramMB);
  const st = await call('servidor:estado'); assert.equal(st.jugadores, 7); console.log('  estado lobby:', st);
  const n = await call('noticias'); assert.ok(n.noticias.length);
  const j = await call('jugar', {});
  console.log('  jugar →', j.packVersion, j.reporte.descargados, 'mods descargados');
  const juego = eventos.filter(([c]) => c === 'juego').map(([, d]) => d.estado);
  assert.deepEqual(juego, ['abierto', 'cerrado']);
  const etapas = [...new Set(eventos.filter(([c]) => c === 'progreso').map(([, d]) => d.etapa))];
  console.log('  etapas de progreso enviadas a la interfaz:', etapas.join(' → '));
  const inf = JSON.parse(fs.readFileSync(path.join(tmp, 'appData', 'QuantumLauncher', 'instancias', base.instancia, 'informe-prueba.json'), 'utf8'));
  assert.ok(inf.args.includes('--width') && inf.args.includes('1600'));
  const cuentas = fs.readFileSync(path.join(tmp, 'appData', 'QuantumLauncher', 'cuentas.json'), 'utf8');
  console.log('  datos en', path.join(tmp, 'appData', 'QuantumLauncher'), '(sin .minecraft:', !fs.existsSync(path.join(tmp, '.minecraft')), ')');
  assert.ok(cuentas.includes('Prueba_Quantum'));
  console.log('\nPrueba del proceso principal superada');
  mock.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
