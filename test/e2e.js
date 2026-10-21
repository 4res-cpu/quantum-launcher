'use strict';
// Prueba de punta a punta del núcleo del launcher contra servicios simulados.
// Uso: node test/e2e.js [ruta a un .mrpack del evento]  (por defecto test/fixtures/Eventos_Quantum_3.4.7.mrpack)
const assert = require('assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { Mock } = require('./mock-server');
const { QuantumCore } = require('../src/core/launcher');
const accounts = require('../src/core/accounts');
const { ping } = require('../src/core/status');
const { readServers, ensureServer } = require('../src/core/servers-dat');
const nbt = require('../src/core/nbt');
const hardware = require('../src/core/hardware');
const http = require('../src/core/http');

const realMrpack = process.argv[2] || path.join(__dirname, 'fixtures', 'Eventos_Quantum_3.4.7.mrpack');

const results = [];
async function prueba(nombre, fn) {
  const t = Date.now();
  try { await fn(); results.push([true, nombre]); console.log(`  ✔ ${nombre} (${Date.now() - t} ms)`); } catch (e) { results.push([false, nombre, e]); console.log(`  ✘ ${nombre}\n    ${e.stack}`); }
}
const exists = (p) => fs.existsSync(p);

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'quantum-e2e-'));
  const fakeHome = path.join(work, 'home'); // un "PC limpio": sin .minecraft
  fs.mkdirSync(fakeHome, { recursive: true });
  const mock = await new Mock(path.join(work, 'mock'), realMrpack).start();
  const mcPort = await mock.startMinecraftServer({ online: 12, max: 100 });
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evento.config.json'), 'utf8'));
  const cfg = {
    ...base,
    usarJavaDelSistema: false, // forzar descarga de Java como en un PC sin Java
    urls: { manifiesto: mock.url('/remote/manifest.json'), noticias: mock.url('/remote/noticias.json') },
    microsoft: { ...base.microsoft, clientId: 'test-client-id' },
    endpoints: {
      versionManifest: mock.url('/mojang/version_manifest_v2.json'),
      fabricMeta: mock.url('/fabric'), assets: mock.url('/assets'), adoptium: mock.url('/adoptium'),
      auth: { token: mock.url('/ms/token'), xbl: mock.url('/xbox/user'), xsts: mock.url('/xbox/xsts'), mcLogin: mock.url('/mcs/login'), mcProfile: mock.url('/mcs/profile') },
    },
  };
  const dataDir = path.join(fakeHome, 'AppData', 'Roaming', 'QuantumLauncher');
  const etapas = new Set();
  const core = new QuantumCore(cfg, dataDir, { onProgress: (p) => etapas.add(p.etapa), onLog: () => {} });
  const game = core.dirs.game;
  const informe = () => JSON.parse(fs.readFileSync(path.join(game, 'informe-prueba.json'), 'utf8'));
  const argVal = (args, flag) => args[args.indexOf(flag) + 1];
  let prep;

  console.log('\nUnidades');
  await prueba('UUID offline idéntico al de Java (OfflinePlayer:<nombre>)', async () => {
    const out = execFileSync('jshell', ['-q', '-'], { input: 'System.out.println(java.util.UUID.nameUUIDFromBytes("OfflinePlayer:Jonas_Quantum".getBytes("UTF-8")));\n/exit\n', env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();
    assert.match(out, new RegExp(accounts.offlineUUID('Jonas_Quantum')));
    assert.equal(accounts.offlineUUID('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  });
  await prueba('Validación de nombre no premium (3-16, letras/números/_)', async () => {
    for (const ok of ['abc', 'Jugador_123', 'A'.repeat(16)]) assert.equal(accounts.validarNombre(ok), null);
    for (const bad of ['ab', 'A'.repeat(17), 'con espacio', 'Ñandú', 'guion-medio', '']) assert.ok(accounts.validarNombre(bad));
  });
  await prueba('servers.dat del modpack se lee; el lobby queda primero y se conservan los del jugador', async () => {
    const f = path.join(work, 'servers.dat');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'servers.dat'), f); // el servers.dat que trae el .mrpack 3.4.7
    const antes = await readServers(f);
    assert.equal(antes[0].ip, 'pruebasquantum.joinsrv.xyz');
    // el jugador añade el suyo
    const root = nbt.read(fs.readFileSync(f));
    root.tag.value.get('servers').value.value.push({ type: 10, value: new Map([['name', { type: 8, value: 'Server de mi primo' }], ['ip', { type: 8, value: 'mc.primo.net' }]]) });
    fs.writeFileSync(f, nbt.write(root));
    await ensureServer(f, { nombre: 'Lobby', ip: '37.187.159.20:9175' }, ['pruebasquantum.joinsrv.xyz']);
    const d = await readServers(f);
    assert.deepEqual(d.map((s) => s.ip), ['37.187.159.20:9175', 'mc.primo.net']);
    assert.equal(d[0].tag.value.get('acceptTextures').value, 1);
  });
  await prueba('Límites de RAM: mínimo 3 GB, defecto 4 GB, máximo según el PC', async () => {
    assert.deepEqual(hardware.limitesRam(8192), { min: 3072, max: 6144, recomendado: 4096, poca: false });
    assert.equal(hardware.limitesRam(4096).max, 3072);
    assert.equal(hardware.limitesRam(4096).poca, true);
    assert.equal(hardware.limitesRam(32768).recomendado, 6144);
    assert.equal(hardware.perfilAuto({ ramMB: 4000, nucleos: 4, gpu: 'Intel(R) UHD Graphics 620', gpuIntegrada: true }), 'bajo');
    assert.equal(hardware.perfilAuto({ ramMB: 16000, nucleos: 12, gpu: 'NVIDIA GeForce RTX 3060', gpuIntegrada: false }), 'ultra');
  });

  console.log('\nInstalación limpia (PC sin Java ni Minecraft) + jugar como NO PREMIUM');
  await prueba('Primera instalación completa con un solo "preparar"', async () => {
    mock.fail[`/modrinth/${encodeURIComponent('lithium-fabric-0.18.1+mc1.21.8.jar')}`] = 1; // 1 descarga dañada: debe reintentar
    prep = await core.preparar({ hw: { ramMB: 8192, nucleos: 8, gpu: 'NVIDIA GeForce GTX 1650', gpuIntegrada: false } });
    assert.equal(prep.java.origen, 'descargado');
    assert.equal(prep.java.major, 21);
    assert.equal(prep.mcVersion, '1.21.8'); assert.equal(prep.loaderVersion, '0.19.5');
    for (const e of ['manifiesto', 'java', 'minecraft', 'modpack', 'listo']) assert.ok(etapas.has(e), `falta etapa ${e}`);
    const mods = fs.readdirSync(path.join(game, 'mods'));
    const esperados = mock.files347.filter((f) => f.path.startsWith('mods/') && f.env?.client !== 'unsupported').length + 7; // + 7 mods de overrides
    assert.equal(mods.filter((m) => m.endsWith('.jar')).length, esperados);
    assert.ok(exists(path.join(game, 'resourcepacks', 'Quantum_Menu.zip')));
    assert.ok(exists(path.join(game, 'resourcepacks', 'FreshAnimations_v1.10.4.zip')));
    assert.ok(exists(path.join(game, 'config', 'fancymenu', 'assets', 'clan_quantum.png')) || exists(path.join(game, 'config', 'easy_npc')));
    const srv = await readServers(path.join(game, 'servers.dat'));
    assert.deepEqual(srv.map((s) => s.ip), ['37.187.159.20:9175']);
    const opt = fs.readFileSync(path.join(game, 'options.txt'), 'utf8');
    assert.match(opt, /lang:es_es/); assert.match(opt, /file\/Quantum_Menu\.zip/);
    assert.ok(!exists(path.join(fakeHome, '.minecraft')), 'no debe crear .minecraft');
    assert.ok(game.startsWith(dataDir));
    // la descarga dañada se repitió y quedó bien
    assert.equal(mock.requests.filter((r) => r.includes('lithium')).length, 2);
  });
  await prueba('Lanza el juego y entra directo al lobby (no premium)', async () => {
    const cuenta = accounts.crearOffline('Jonas_Quantum');
    const r = await core.lanzar(prep, cuenta, { ramMB: 4096, ancho: 1280, alto: 720 });
    assert.equal(r.code, 0, r.log); assert.equal(r.fallo, false);
    const inf = informe();
    assert.equal(argVal(inf.args, '--username'), 'Jonas_Quantum');
    assert.equal(argVal(inf.args, '--uuid'), accounts.offlineUUID('Jonas_Quantum').replace(/-/g, ''));
    assert.equal(argVal(inf.args, '--quickPlayMultiplayer'), '37.187.159.20:9175');
    assert.equal(argVal(inf.args, '--userType'), 'legacy');
    assert.equal(argVal(inf.args, '--gameDir'), game);
    assert.equal(argVal(inf.args, '--width'), '1280');
    assert.equal(argVal(inf.args, '--assetIndex'), '26');
    assert.ok(!inf.args.includes('--demo'));
    assert.ok(inf.maxMemoryMB > 3500 && inf.maxMemoryMB <= 4096, `RAM ${inf.maxMemoryMB}`);
    assert.equal(inf.fabricProp, 'ok');
    assert.equal(inf.cwd, game);
    assert.ok(inf.classpath.includes(path.join('versions', '1.21.8', '1.21.8.jar')));
    assert.ok(inf.classpath.includes('fabric-loader-0.19.5.jar'));
    assert.ok(inf.classpath.includes('natives-linux'));
    assert.ok(!inf.classpath.includes('natives-windows') && !inf.classpath.includes('java-objc-bridge'));
    assert.equal(fs.readFileSync(path.join(inf.libraryPath, 'liblwjgl.so'), 'utf8'), 'binario nativo x64 liblwjgl.so', 'solo nativos de la arquitectura del PC');
    assert.ok(!exists(path.join(game, '.quantum', 'args.txt')), 'el archivo de argumentos se borra al cerrar');
  });
  await prueba('Modo archivo de argumentos (para líneas de comandos muy largas)', async () => {
    process.env.QUANTUM_ARGFILE = '1';
    const r = await core.lanzar(prep, accounts.crearOffline('Jose_N'), { ramMB: 3072 });
    delete process.env.QUANTUM_ARGFILE;
    assert.equal(r.code, 0, r.log);
    assert.equal(argVal(informe().args, '--username'), 'Jose_N');
  });
  await prueba('Pantalla completa sustituye a la resolución', async () => {
    await core.lanzar(prep, accounts.crearOffline('Otro_1'), { ramMB: 3072, pantallaCompleta: true, ancho: 1280, alto: 720 });
    const inf = informe();
    assert.ok(inf.args.includes('--fullscreen')); assert.ok(!inf.args.includes('--width'));
  });

  console.log('\nCuenta PREMIUM (Microsoft → Xbox → XSTS → Minecraft)');
  const store = new accounts.AccountStore(path.join(dataDir, 'cuentas.json'), { encrypt: (s) => `cifrado:${Buffer.from(s).toString('base64')}`, decrypt: (s) => Buffer.from(s.slice(8), 'base64').toString() });
  await store.load();
  let premium;
  await prueba('Inicio de sesión con código OAuth + PKCE', async () => {
    const { verifier, challenge, state } = accounts.pkce();
    mock.lastChallenge = challenge;
    const url = accounts.authorizeUrl({ clientId: 'test-client-id', redirectUri: cfg.microsoft.redirectUri, challenge, state });
    assert.match(url, /scope=XboxLive\.signin\+offline_access/); assert.match(url, /code_challenge_method=S256/);
    premium = await accounts.canjearCodigo({ code: 'codigo-bueno', verifier, clientId: 'test-client-id', redirectUri: cfg.microsoft.redirectUri, endpoints: cfg.endpoints.auth });
    assert.equal(premium.nombre, 'JugadorPremium');
    assert.equal(premium.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    assert.equal(premium.xuid, '2535400000000');
    await store.upsert(premium);
    await store.upsert(accounts.crearOffline('Jonas_Quantum'), false);
    const raw = fs.readFileSync(store.file, 'utf8');
    assert.ok(!raw.includes(premium.refreshToken) && !raw.includes(premium.accessToken), 'los tokens se guardan cifrados');
    assert.equal(store.list().length, 2);
    assert.equal(store.active().refreshToken, premium.refreshToken);
  });
  await prueba('Renueva el token solo (refresh token) y recuerda la sesión', async () => {
    const store2 = await new accounts.AccountStore(store.file, store.cipher).load(); // reinicio del launcher
    const c = store2.active();
    const caducada = { ...c, expira: Date.now() - 1000 };
    const r = await accounts.renovarSiHaceFalta(caducada, { clientId: 'test-client-id', endpoints: cfg.endpoints.auth });
    assert.notEqual(r.accessToken, c.accessToken); assert.notEqual(r.refreshToken, c.refreshToken);
    const igual = await accounts.renovarSiHaceFalta(r, { clientId: 'test-client-id', endpoints: cfg.endpoints.auth });
    assert.equal(igual.accessToken, r.accessToken, 'no renueva si el token sigue vigente');
    premium = r;
  });
  await prueba('Lanza como premium con token y userType msa (el token no sale en el registro)', async () => {
    const lines = [];
    const core2 = new QuantumCore(cfg, dataDir, { onLog: (l) => lines.push(l) });
    const r = await core2.lanzar(prep, premium, { ramMB: 4096 });
    assert.equal(r.code, 0);
    const inf = informe();
    assert.equal(argVal(inf.args, '--accessToken'), premium.accessToken);
    assert.equal(argVal(inf.args, '--userType'), 'msa');
    assert.equal(argVal(inf.args, '--uuid'), '069a79f444e94726a5befca90e38aaf5');
    assert.equal(argVal(inf.args, '--clientId'), 'test-client-id');
    assert.ok(!lines.join('\n').includes(premium.accessToken));
  });
  await prueba('Errores de Microsoft explicados en español', async () => {
    const run = () => accounts.renovarSiHaceFalta({ ...premium, expira: 0 }, { clientId: 'test-client-id', endpoints: cfg.endpoints.auth });
    mock.ms.xerr = 2148916233;
    await assert.rejects(run, /no tiene perfil de Xbox/);
    mock.ms.xerr = 2148916238;
    await assert.rejects(run, /menor de edad/);
    mock.ms.xerr = null; mock.ms.mc403 = true;
    await assert.rejects(run, /AZURE\.md/);
    mock.ms.mc403 = false; mock.ms.noProfile = true;
    await assert.rejects(run, /no tiene Minecraft Java/);
    mock.ms.noProfile = false;
    await assert.rejects(() => accounts.renovarSiHaceFalta({ ...premium, expira: 0, refreshToken: 'caducado' }, { clientId: 'test-client-id', endpoints: cfg.endpoints.auth }), (e) => e.reLogin === true);
  });

  console.log('\nActualización del modpack 3.4.7 → 3.4.8');
  await prueba('Detecta la versión nueva, descarga solo lo cambiado y respeta lo del jugador', async () => {
    // Cosas del jugador
    fs.appendFileSync(path.join(game, 'options.txt'), 'fov:0.75\nkey_key.jump:key.keyboard.space\n');
    const opcionesAntes = fs.readFileSync(path.join(game, 'options.txt'), 'utf8');
    const sd = path.join(game, 'servers.dat');
    const root = nbt.read(fs.readFileSync(sd));
    root.tag.value.get('servers').value.value.push({ type: 10, value: new Map([['name', { type: 8, value: 'Mi survival' }], ['ip', { type: 8, value: 'play.misurvival.com' }]]) });
    fs.writeFileSync(sd, nbt.write(root));
    fs.mkdirSync(path.join(game, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(game, 'screenshots', '2026-10-30_21.00.00.png'), 'foto');
    fs.writeFileSync(path.join(game, 'config', 'dynamic_fps.json'), '{"jugador":"mi ajuste"}'); // el organizador no lo cambia
    fs.writeFileSync(path.join(game, 'config', 'beautify.json'), '{"jugador":"mi ajuste"}'); // el organizador SÍ lo cambia
    fs.writeFileSync(path.join(game, 'mods', 'xray-hack.jar'), 'trampa');
    mock.publish('3.4.8', '1.1.0');
    const upd = await core.comprobarActualizacion();
    assert.equal(upd.hayNueva, true); assert.equal(upd.instalada, '3.4.7'); assert.equal(upd.disponible, '3.4.8');
    assert.equal(upd.launcherNuevo, true);
    const antes = mock.requests.length;
    const p2 = await core.preparar({ ajustes: { modoLigero: false } });
    const nuevas = mock.requests.slice(antes).filter((r) => r.startsWith('/modrinth/') || r.startsWith('/libs/') || r.startsWith('/assets/') || r.startsWith('/adoptium/'));
    assert.deepEqual(nuevas, ['/modrinth/nuevo-mod-evento-1.0.jar'], `descargas inesperadas: ${nuevas}`);
    assert.equal(p2.packVersion, '3.4.8');
    const mods = fs.readdirSync(path.join(game, 'mods'));
    assert.ok(!mods.some((m) => m.includes('fallingleaves')), 'mod retirado borrado');
    assert.ok(mods.includes('nuevo-mod-evento-1.0.jar'));
    assert.ok(mods.includes('mazerunner-1.3.1.jar') && !mods.includes('mazerunner-1.3.0.jar'));
    assert.ok(!mods.includes('xray-hack.jar'), 'mod ajeno borrado');
    assert.equal(fs.readFileSync(path.join(game, 'options.txt'), 'utf8'), opcionesAntes);
    assert.deepEqual((await readServers(sd)).map((s) => s.ip), ['37.187.159.20:9175', 'play.misurvival.com']);
    assert.ok(exists(path.join(game, 'screenshots', '2026-10-30_21.00.00.png')));
    assert.equal(fs.readFileSync(path.join(game, 'config', 'dynamic_fps.json'), 'utf8'), '{"jugador":"mi ajuste"}');
    assert.equal(fs.readFileSync(path.join(game, 'config', 'beautify.json'), 'utf8'), '{"organizador":"cambiado en 3.4.8"}');
    assert.ok(!fs.readdirSync(path.join(dataDir, 'modpacks')).some((f) => f.includes('3.4.7')), 'el .mrpack viejo se borra');
    prep = p2;
  });
  await prueba('Sin cambios: abrir de nuevo no descarga nada', async () => {
    const antes = mock.requests.length;
    await core.preparar({ ajustes: { modoLigero: false } });
    const d = mock.requests.slice(antes).filter((r) => !r.startsWith('/remote/'));
    assert.deepEqual(d, []);
  });

  console.log('\nOptimización, reparación, errores y estado del servidor');
  await prueba('Modo PC de bajos recursos desactiva mods visuales sin volver a descargarlos', async () => {
    const antes = mock.requests.length;
    await core.preparar({ ajustes: { modoLigero: true } });
    const mods = fs.readdirSync(path.join(game, 'mods'));
    assert.ok(mods.some((m) => /^AmbientSounds.*\.jar\.disabled$/.test(m)));
    assert.ok(!mods.some((m) => /^AmbientSounds.*\.jar$/.test(m)));
    await core.preparar({ ajustes: { modoLigero: false } });
    assert.ok(fs.readdirSync(path.join(game, 'mods')).some((m) => /^AmbientSounds.*\.jar$/.test(m)));
    assert.deepEqual(mock.requests.slice(antes).filter((r) => !r.startsWith('/remote/')), []);
  });
  await prueba('"Optimizar para mi PC" cambia solo los ajustes gráficos de options.txt', async () => {
    await core.aplicarPerfil('bajo');
    const o = fs.readFileSync(path.join(game, 'options.txt'), 'utf8');
    assert.match(o, /renderDistance:6/); assert.match(o, /fov:0\.75/);
  });
  await prueba('Reparar instalación: recupera mods, librerías y assets dañados o borrados', async () => {
    const mod = path.join(game, 'mods', 'sodium-fabric-0.7.3+mc1.21.8.jar');
    fs.writeFileSync(mod, 'dañado');
    const lib = path.join(core.dirs.shared, 'libraries', 'com', 'mojang', 'brigadier', '1.3.10', 'brigadier-1.3.10.jar');
    fs.writeFileSync(lib, 'x'.repeat(fs.statSync(lib).size)); // mismo tamaño, contenido malo: solo lo detecta Reparar
    const objs = path.join(core.dirs.shared, 'assets', 'objects');
    const sub = fs.readdirSync(objs)[0];
    fs.rmSync(path.join(objs, sub), { recursive: true });
    const r = await core.preparar({ reparar: true, ajustes: { modoLigero: false } });
    assert.equal(await http.fileHash(mod), mock.files347.find((f) => f.path.endsWith('sodium-fabric-0.7.3+mc1.21.8.jar')).hashes.sha1);
    assert.ok(exists(path.join(objs, sub)));
    assert.notEqual(fs.readFileSync(lib, 'utf8'), 'x'.repeat(fs.statSync(lib).size));
    assert.equal(r.java.origen, 'launcher');
  });
  await prueba('Si el juego se cierra con error, devuelve el registro y el crash report', async () => {
    fs.writeFileSync(path.join(game, 'provocar-crash'), '1');
    const r = await core.lanzar(prep, accounts.crearOffline('Jonas_Quantum'), { ramMB: 4096 });
    fs.rmSync(path.join(game, 'provocar-crash'));
    assert.equal(r.fallo, true); assert.notEqual(r.code, 0);
    assert.match(r.crash.texto, /OutOfMemoryError/);
    assert.match(r.log, /OutOfMemoryError/);
    assert.ok(exists(r.logFile));
  });
  await prueba('Sin internet tras instalar: se puede seguir jugando', async () => {
    const real = cfg.urls.manifiesto;
    core.cfg.urls = { ...core.cfg.urls, manifiesto: 'http://127.0.0.1:1/no-hay-red.json' };
    const p = await core.preparar({ ajustes: { modoLigero: false } });
    assert.equal(p.packVersion, '3.4.8');
    core.cfg.urls.manifiesto = real;
  });
  await prueba('Ping de estado al lobby: en línea, jugadores y motd', async () => {
    const s = await ping('127.0.0.1', mcPort);
    assert.equal(s.online, true); assert.equal(s.jugadores, 12); assert.equal(s.max, 100);
    assert.equal(s.motd, 'QUANTUM Lobby de eventos');
    const off = await ping('127.0.0.1', 1, { timeoutMs: 1500 });
    assert.equal(off.online, false);
  });
  await prueba('Noticias desde JSON remoto', async () => {
    const n = await core.leerNoticias();
    assert.equal(n.noticias[0].titulo, 'Prueba');
  });
  await prueba('Herramienta publicar-modpack genera un manifiesto válido', async () => {
    const out = path.join(work, 'manifest.json');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'publicar-modpack.js'), path.join(mock.dir, 'Eventos_Quantum_3.4.8.mrpack'), '--version', '3.4.8', '--url', 'https://example.com/p.mrpack', '--manifest', out]);
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(m.modpack.version, '3.4.8'); assert.equal(m.modpack.sha1, await http.fileHash(path.join(mock.dir, 'Eventos_Quantum_3.4.8.mrpack')));
  });

  mock.stop();
  const ok = results.filter((r) => r[0]).length;
  console.log(`\n${ok}/${results.length} pruebas superadas`);
  const tam = execFileSync('du', ['-sh', dataDir]).toString().split('\t')[0];
  console.log(`Datos del launcher en el PC de prueba: ${tam} en ${dataDir}`);
  if (!process.env.CONSERVAR) await fsp.rm(work, { recursive: true, force: true });
  process.exit(ok === results.length ? 0 : 1);
})();
