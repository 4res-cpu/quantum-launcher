'use strict';
// Servidor simulado de Mojang, Fabric, Modrinth, Adoptium, Microsoft/Xbox y del manifiesto,
// más un servidor de Minecraft falso que responde al ping de estado.
// Sirve para probar el launcher completo sin internet.
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { makeZip } = require('./util-zip');
const { readZipBuffer } = require('../src/core/zip');
const { varint, readVarint, packet, mcString } = require('../src/core/status');

const sha = (algo, b) => crypto.createHash(algo).update(b).digest('hex');

class Mock {
  constructor(workDir, realMrpack) {
    this.dir = workDir; this.realMrpack = realMrpack;
    this.routes = new Map(); // ruta -> { body, type } | función
    this.requests = [];
    this.fail = {}; // ruta -> número de respuestas dañadas a enviar
    this.ms = { xerr: null, mc403: false, noProfile: false, tokens: 0 };
  }

  url(p) { return `${this.base}${p}`; }
  put(p, body, type = 'application/octet-stream') { this.routes.set(p, { body: Buffer.isBuffer(body) ? body : Buffer.from(body), type }); return body; }
  putJson(p, obj) { return this.put(p, JSON.stringify(obj), 'application/json'); }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${this.server.address().port}`;
    this.build();
    return this;
  }

  stop() { this.server?.close(); this.mc?.close(); }

  handle(req, res) {
    const u = new URL(req.url, this.base);
    this.requests.push(u.pathname);
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (u.pathname.startsWith('/ms/') || u.pathname.startsWith('/xbox/') || u.pathname.startsWith('/mcs/')) return this.auth(u, req, body, res);
      if (u.pathname.startsWith('/adoptium/v3/assets/latest/')) return this.json(res, 200, this.adoptiumAssets);
      const r = this.routes.get(u.pathname);
      if (!r) { res.writeHead(404); return res.end('no encontrado'); }
      if (this.fail[u.pathname] > 0) { this.fail[u.pathname]--; res.writeHead(200); return res.end(Buffer.from('datos dañados')); }
      res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.body.length });
      res.end(r.body);
    });
  }

  json(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  auth(u, req, body, res) {
    const p = u.pathname;
    if (p === '/ms/token') {
      const f = new URLSearchParams(body);
      if (f.get('client_id') !== 'test-client-id') return this.json(res, 400, { error: 'unauthorized_client' });
      if (f.get('grant_type') === 'authorization_code') {
        if (f.get('code') !== 'codigo-bueno') return this.json(res, 400, { error: 'invalid_grant', error_description: 'bad code' });
        const ch = crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
        if (ch !== this.lastChallenge) return this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
      } else if (f.get('grant_type') === 'refresh_token') {
        if (!String(f.get('refresh_token')).startsWith('refresh-')) return this.json(res, 400, { error: 'invalid_grant' });
      }
      this.ms.tokens++;
      return this.json(res, 200, { access_token: `ms-access-${this.ms.tokens}`, refresh_token: `refresh-${this.ms.tokens}`, expires_in: 3600 });
    }
    const j = body ? JSON.parse(body) : {};
    if (p === '/xbox/user') {
      if (!String(j.Properties?.RpsTicket).startsWith('d=ms-access-')) return this.json(res, 401, {});
      return this.json(res, 200, { Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'uhs123' }] } });
    }
    if (p === '/xbox/xsts') {
      if (this.ms.xerr) return this.json(res, 401, { XErr: this.ms.xerr, Message: '', Redirect: 'https://start.ui.xboxlive.com/' });
      if (j.RelyingParty !== 'rp://api.minecraftservices.com/' || j.Properties.UserTokens[0] !== 'xbl-token') return this.json(res, 400, {});
      return this.json(res, 200, { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'uhs123', xid: '2535400000000' }] } });
    }
    if (p === '/mcs/login') {
      if (this.ms.mc403) return this.json(res, 403, { error: 'Invalid app registration' });
      if (j.identityToken !== 'XBL3.0 x=uhs123;xsts-token') return this.json(res, 401, {});
      return this.json(res, 200, { access_token: `mc-token-${this.ms.tokens}`, expires_in: 86400 });
    }
    if (p === '/mcs/profile') {
      if (this.ms.noProfile) return this.json(res, 404, { error: 'NOT_FOUND' });
      if (!String(req.headers.authorization).startsWith('Bearer mc-token-')) return this.json(res, 401, {});
      return this.json(res, 200, { id: '069a79f444e94726a5befca90e38aaf5', name: 'JugadorPremium' });
    }
    return this.json(res, 404, {});
  }

  /** Genera todos los archivos simulados. */
  build() {
    const D = this.dir; fs.mkdirSync(D, { recursive: true });
    // --- "Minecraft": FakeMain compilado dentro del jar de fabric-loader
    const classes = path.join(D, 'classes');
    fs.mkdirSync(classes, { recursive: true });
    execFileSync('javac', ['-d', classes, path.join(__dirname, 'fake', 'FakeMain.java')], { env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
    const loaderJar = path.join(D, 'fabric-loader.jar');
    execFileSync('jar', ['cf', loaderJar, '-C', classes, '.'], { env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
    const loaderBuf = fs.readFileSync(loaderJar);
    this.put('/maven/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar', loaderBuf);
    const intermediary = makeZip([{ name: 'mappings/mappings.tiny', data: 'tiny\t2\t0\tintermediary\tnamed\n' }]);
    this.put('/maven/net/fabricmc/intermediary/1.21.8/intermediary-1.21.8.jar', intermediary);

    const client = makeZip([{ name: 'net/minecraft/client/main/Main.class', data: 'no es una clase real' }, { name: 'version.json', data: '{"id":"1.21.8"}' }]);
    this.put('/mojang/client.jar', client);

    const lib = (name, content, rules) => {
      const parts = name.split(':');
      const rel = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}${parts[3] ? `-${parts[3]}` : ''}.jar`;
      const buf = Buffer.isBuffer(content) ? content : makeZip([{ name: `${parts[1]}.txt`, data: content }]);
      this.put(`/libs/${rel}`, buf);
      return { downloads: { artifact: { path: rel, sha1: sha('sha1', buf), size: buf.length, url: this.url(`/libs/${rel}`) } }, name, ...(rules ? { rules } : {}) };
    };
    const nat = (os, file, arch = 'x64') => makeZip([{ name: 'META-INF/MANIFEST.MF', data: 'x' }, { name: `${os}/${arch}/org/lwjgl/${file}`, data: `binario nativo ${arch} ${file}` },
      ...(arch === 'x64' ? [{ name: `${os}/x86/org/lwjgl/${file}`, data: `binario nativo x86 ${file}` }] : [])]);
    const libraries = [
      lib('com.mojang:brigadier:1.3.10', 'brigadier'),
      lib('org.lwjgl:lwjgl:3.3.3', 'lwjgl'),
      lib('org.lwjgl:lwjgl:3.3.3:natives-linux', nat('linux', 'liblwjgl.so'), [{ action: 'allow', os: { name: 'linux' } }]),
      lib('org.lwjgl:lwjgl:3.3.3:natives-linux-arm64', nat('linux', 'liblwjgl.so', 'arm64'), [{ action: 'allow', os: { name: 'linux' } }]),
      lib('org.lwjgl:lwjgl:3.3.3:natives-windows', nat('windows', 'lwjgl.dll'), [{ action: 'allow', os: { name: 'windows' } }]),
      lib('org.lwjgl:lwjgl:3.3.3:natives-windows-x86', nat('windows', 'lwjgl.dll', 'x86'), [{ action: 'allow', os: { name: 'windows' } }]),
      lib('org.lwjgl:lwjgl:3.3.3:natives-macos', nat('macos', 'liblwjgl.dylib'), [{ action: 'allow', os: { name: 'osx' } }]),
      lib('ca.weblite:java-objc-bridge:1.1', 'objc', [{ action: 'allow', os: { name: 'osx' } }]),
    ];
    const objects = {};
    for (const n of ['minecraft/lang/es_es.json', 'minecraft/sounds/ambient/cave1.ogg', 'icons/icon_16x16.png', 'minecraft/sounds/dup.ogg']) {
      const data = Buffer.from(n.endsWith('dup.ogg') ? 'minecraft/sounds/ambient/cave1.ogg' : n); // dup.ogg comparte hash
      const h = sha('sha1', data);
      this.put(`/assets/${h.slice(0, 2)}/${h}`, data);
      objects[n] = { hash: h, size: data.length };
    }
    const index = JSON.stringify({ objects });
    this.put('/mojang/indexes/26.json', index, 'application/json');
    const logCfg = '<Configuration/>';
    this.put('/mojang/client-1.21.2.xml', logCfg);
    const version = {
      id: '1.21.8', type: 'release', mainClass: 'net.minecraft.client.main.Main',
      assetIndex: { id: '26', sha1: sha('sha1', index), size: index.length, totalSize: 999, url: this.url('/mojang/indexes/26.json') },
      assets: '26', javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
      downloads: { client: { sha1: sha('sha1', client), size: client.length, url: this.url('/mojang/client.jar') } },
      libraries,
      logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: 'client-1.21.2.xml', sha1: sha('sha1', logCfg), size: logCfg.length, url: this.url('/mojang/client-1.21.2.xml') }, type: 'log4j2-xml' } },
      arguments: {
        game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--clientId', '${clientid}', '--xuid', '${auth_xuid}', '--userType', '${user_type}', '--versionType', '${version_type}',
          { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
          { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
          { rules: [{ action: 'allow', features: { has_quick_plays_support: true } }], value: ['--quickPlayPath', '${quickPlayPath}'] },
          { rules: [{ action: 'allow', features: { is_quick_play_singleplayer: true } }], value: ['--quickPlaySingleplayer', '${quickPlaySingleplayer}'] },
          { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] },
          { rules: [{ action: 'allow', features: { is_quick_play_realms: true } }], value: ['--quickPlayRealms', '${quickPlayRealms}'] }],
        jvm: [{ rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] },
          { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump' },
          { rules: [{ action: 'allow', os: { arch: 'x86' } }], value: '-Xss1M' },
          '-Djava.library.path=${natives_directory}', '-Djna.tmpdir=${natives_directory}', '-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}',
          '-Dio.netty.native.workdir=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-Dminecraft.launcher.version=${launcher_version}', '-cp', '${classpath}'],
      },
    };
    const vjson = JSON.stringify(version);
    this.put('/mojang/v/1.21.8.json', vjson, 'application/json');
    this.putJson('/mojang/version_manifest_v2.json', { latest: { release: '1.21.8' }, versions: [{ id: '1.21.8', type: 'release', url: this.url('/mojang/v/1.21.8.json'), sha1: sha('sha1', vjson) }] });
    this.putJson('/fabric/v2/versions/loader/1.21.8/0.19.5/profile/json', {
      id: 'fabric-loader-0.19.5-1.21.8', inheritsFrom: '1.21.8', type: 'release',
      mainClass: 'quantum.test.FakeMain', // en el real: net.fabricmc.loader.impl.launch.knot.KnotClient
      arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main ', '-Dfabric.test.prop=ok'] },
      libraries: [
        { name: 'net.fabricmc:intermediary:1.21.8', url: this.url('/maven/') },
        { name: 'net.fabricmc:fabric-loader:0.19.5', url: this.url('/maven/'), sha1: sha('sha1', loaderBuf), size: loaderBuf.length },
      ],
    });

    // --- "Java 21" de Adoptium: un tar.gz cuyo bin/java llama al Java real del sistema
    const jre = path.join(D, 'jre'); const root = path.join(jre, 'jdk-21.0.9+10-jre', 'bin');
    fs.mkdirSync(root, { recursive: true });
    const realJava = execFileSync('bash', ['-lc', 'readlink -f "$(command -v java)"']).toString().trim();
    fs.writeFileSync(path.join(root, 'java'), `#!/bin/sh\nexec "${realJava}" "$@"\n`, { mode: 0o755 });
    const tgz = path.join(D, 'OpenJDK21U-jre_x64_linux_hotspot_21.0.9_10.tar.gz');
    execFileSync('tar', ['-czf', tgz, '-C', jre, '.']);
    const tbuf = fs.readFileSync(tgz);
    this.put('/adoptium/jre.tar.gz', tbuf);
    this.adoptiumAssets = [{ binary: { package: { link: this.url('/adoptium/jre.tar.gz'), checksum: sha('sha256', tbuf), name: path.basename(tgz), size: tbuf.length } }, version: { semver: '21.0.9+10' } }];

    // --- Modpacks 3.4.7 (real, con descargas redirigidas aquí) y 3.4.8 (cambios)
    const real = readZipBuffer(fs.readFileSync(this.realMrpack));
    const realIndex = JSON.parse(real.find((e) => e.name === 'modrinth.index.json').getData());
    const overrides = real.filter((e) => !e.isDir && e.name.startsWith('overrides/')).map((e) => ({ name: e.name, data: e.getData() }));
    const fakeFile = (p, salt = '') => {
      const data = makeZip([{ name: 'fabric.mod.json', data: JSON.stringify({ id: path.basename(p), salt }) }]);
      this.put(`/modrinth/${encodeURIComponent(path.basename(p))}${salt}`, data);
      return { data, url: this.url(`/modrinth/${encodeURIComponent(path.basename(p))}${salt}`) };
    };
    const mkIndex = (files, versionId) => ({ ...realIndex, versionId, files });
    const fileEntry = (orig, salt = '') => {
      const { data, url } = fakeFile(orig.path, salt);
      return { ...orig, hashes: { sha1: sha('sha1', data), sha512: sha('sha512', data) }, downloads: [url], fileSize: data.length };
    };
    this.files347 = realIndex.files.map((f) => fileEntry(f));
    const pack347 = makeZip([{ name: 'modrinth.index.json', data: JSON.stringify(mkIndex(this.files347, '3.4.7')) }, ...overrides]);
    this.put('/releases/Eventos_Quantum_3.4.7.mrpack', pack347);
    fs.writeFileSync(path.join(D, 'Eventos_Quantum_3.4.7.mrpack'), pack347);

    // 3.4.8: quitamos fallingleaves, añadimos un mod nuevo, cambiamos un config y un mod de overrides
    const files348 = this.files347.filter((f) => !f.path.includes('fallingleaves'))
      .concat([fileEntry({ path: 'mods/nuevo-mod-evento-1.0.jar', env: { client: 'required', server: 'required' } })]);
    const ov348 = overrides.map((o) => {
      if (o.name === 'overrides/config/beautify.json') return { name: o.name, data: Buffer.from('{"organizador":"cambiado en 3.4.8"}') };
      if (o.name === 'overrides/mods/mazerunner-1.3.0.jar') return { name: 'overrides/mods/mazerunner-1.3.1.jar', data: makeZip([{ name: 'fabric.mod.json', data: '{"id":"mazerunner","version":"1.3.1"}' }]) };
      return o;
    });
    const pack348 = makeZip([{ name: 'modrinth.index.json', data: JSON.stringify(mkIndex(files348, '3.4.8')) }, ...ov348]);
    this.put('/releases/Eventos_Quantum_3.4.8.mrpack', pack348);
    fs.writeFileSync(path.join(D, 'Eventos_Quantum_3.4.8.mrpack'), pack348);
    this.packs = { '3.4.7': pack347, '3.4.8': pack348 };
    this.publish('3.4.7');
    this.putJson('/remote/noticias.json', { noticias: [{ titulo: 'Prueba', fecha: '2026-10-20', texto: 'Hola' }] });
  }

  publish(version, launcherVersion = '1.0.0') {
    const b = this.packs[version];
    this.putJson('/remote/manifest.json', {
      modpack: { version, url: this.url(`/releases/Eventos_Quantum_${version}.mrpack`), size: b.length, sha1: sha('sha1', b), sha512: sha('sha512', b) },
      launcher: { version: launcherVersion, descarga: 'https://example.invalid/descarga' },
    });
  }

  /** Servidor de Minecraft falso que contesta al ping de estado. */
  async startMinecraftServer({ online = 12, max = 100 } = {}) {
    this.mc = net.createServer((sock) => {
      let buf = Buffer.alloc(0); let n = 0;
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const len = readVarint(buf, 0);
          if (!len || buf.length < len.size + len.value) return;
          const body = buf.subarray(len.size, len.size + len.value);
          buf = buf.subarray(len.size + len.value);
          n++;
          const id = readVarint(body, 0).value;
          if (n === 2 && id === 0) {
            const status = { version: { name: 'Velocity 1.21.8', protocol: 772 }, players: { online, max }, description: { text: '', extra: [{ text: '§6QUANTUM ' }, { text: 'Lobby de eventos' }] } };
            sock.write(packet(0x00, mcString(JSON.stringify(status))));
          } else if (id === 1) {
            sock.write(packet(0x01, body.subarray(1)));
          }
        }
      });
      sock.on('error', () => {});
    });
    await new Promise((r) => this.mc.listen(0, '127.0.0.1', r));
    return this.mc.address().port;
  }
}

module.exports = { Mock, varint };
