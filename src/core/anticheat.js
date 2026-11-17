'use strict';
// Anti-trampas del launcher: revisa los mods y paquetes de texturas que añade el jugador
// antes de dejarlos entrar al juego. No sustituye al anti-xray del servidor: lo complementa.
const zlib = require('zlib');
const { readZipBuffer } = require('./zip');

// Clientes de hacks y mods que dan ventaja (id del mod o paquete Java).
const IDS_PROHIBIDOS = [
  'meteor-client', 'meteor', 'wurst', 'aristois', 'impact', 'liquidbounce', 'bleachhack', 'future', 'rusherhack', 'inertia',
  'thunderhack', 'kami', 'lambda', 'salhack', 'gamesense', 'konas', 'phobos', 'prestige', 'boze', 'coffee', 'atlas',
  'xray', 'x-ray', 'advanced-xray', 'advancedxray', 'xraymod', 'xray-ultimate', 'freecam', 'killaura', 'autoclicker',
  'baritone', 'nofall', 'seedcracker', 'seedcrackerx', 'seedmapper', 'chestesp', 'esp', 'tracers', 'tweakeroo',
  'inventorywalk', 'autototem', 'elytrafly', 'nuker', 'jesus', 'speedhack', 'reach', 'hitboxes', 'fullbright-hack',
  'cheatutils', 'clientcommands', 'entityradar', 'mobradar', 'pokeradar', 'shinyradar', 'legendaryradar',
];
const PAQUETES_PROHIBIDOS = [
  'meteordevelopment/meteorclient', 'net/wurstclient', 'com/aristois', 'net/ccbluex', 'org/rusherhack', 'me/zeroeightsix',
  'baritone/', 'dev/boze', 'me/x150', 'com/mojang/xray', 'kambing/xray', 'xray/', 'net/futureclient', 'me/alpha432',
];
const PALABRAS = /\b(x-?ray|hack(ed)?\s*client|kill\s*aura|auto\s*clicker|esp\b|freecam|baritone|radar\s+de\s+pok[eé]mon|pok[eé]mon\s+radar|shiny\s*(finder|radar))/i;

// Bloques que un paquete X-Ray suele volver invisibles.
const BLOQUES_XRAY = ['stone', 'deepslate', 'dirt', 'grass_block_side', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'gravel', 'sand', 'end_stone', 'calcite'];

function leerJson(buf) {
  try { return JSON.parse(buf.toString('utf8').replace(/[\u0000-\u001f]+/g, ' ')); } catch { return null; }
}

/** Decodifica un PNG (RGBA o paleta con transparencia) y devuelve la proporción de píxeles casi transparentes. */
function transparenciaPng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return 0;
  let p = 8; let w = 0, h = 0, bits = 8, tipo = 0; const idat = []; let trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const t = buf.toString('ascii', p + 4, p + 8); const d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bits = d[8]; tipo = d[9]; }
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'tRNS') trns = d;
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (!w || !h || bits !== 8 || w * h > 4096 * 4096) return 0;
  const canales = { 6: 4, 2: 3, 3: 1, 4: 2, 0: 1 }[tipo];
  if (!canales || (tipo !== 6 && tipo !== 4 && !(tipo === 3 && trns))) return 0;
  let raw; try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return 0; }
  const fila = w * canales; const prev = Buffer.alloc(fila); const cur = Buffer.alloc(fila);
  let transparentes = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (fila + 1)]; const src = raw.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
    for (let i = 0; i < fila; i++) {
      const a = i >= canales ? cur[i - canales] : 0, b = prev[i], c = i >= canales ? prev[i - canales] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const alfa = tipo === 6 ? cur[x * 4 + 3] : tipo === 4 ? cur[x * 2 + 1] : (cur[x] < trns.length ? trns[cur[x]] : 255);
      if (alfa < 64) transparentes++;
    }
    cur.copy(prev);
  }
  return transparentes / (w * h);
}

/** Revisa un .jar de mod. Devuelve { ok, motivo, id, nombre }. */
function analizarMod(buf, archivo = '') {
  let zip; try { zip = readZipBuffer(buf); } catch { return { ok: false, motivo: 'El archivo no es un mod válido.' }; }
  const nombres = zip.map((e) => e.name);
  const fmj = zip.find((e) => e.name === 'fabric.mod.json');
  if (!fmj) return { ok: false, motivo: 'No es un mod de Fabric (le falta fabric.mod.json).' };
  const j = leerJson(fmj.getData());
  if (!j || !j.id) return { ok: false, motivo: 'El mod tiene un fabric.mod.json dañado.' };
  const id = String(j.id).toLowerCase(), nombre = String(j.name || j.id);
  const res = (motivo) => ({ ok: false, motivo, id, nombre });
  if (IDS_PROHIBIDOS.includes(id) || IDS_PROHIBIDOS.some((x) => id === x.replace(/-/g, '_'))) return res(`«${nombre}» está prohibido en Quantum Network.`);
  const paquete = PAQUETES_PROHIBIDOS.find((pkg) => nombres.some((n) => n.toLowerCase().startsWith(pkg)));
  if (paquete) return res(`«${nombre}» contiene código de un cliente de trampas.`);
  const texto = `${nombre} ${j.description || ''} ${archivo}`;
  if (PALABRAS.test(texto)) return res(`«${nombre}» parece dar ventaja (X-Ray, radar, cámara libre o similar).`);
  const env = j.environment || '*';
  if (env === 'server') return res(`«${nombre}» es un mod de servidor; no hace falta en tu juego.`);
  // Mods anidados (JiJ): se revisan también
  for (const n of j.jars || []) {
    const e = zip.find((x) => x.name === n.file);
    if (!e) continue;
    const r = analizarMod(e.getData(), n.file);
    if (!r.ok && !/servidor/.test(r.motivo)) return res(`«${nombre}» incluye otro mod no permitido: ${r.motivo}`);
  }
  return { ok: true, motivo: '', id, nombre };
}

/** Revisa un paquete de texturas (.zip). Devuelve { ok, motivo }. */
function analizarTexturas(buf, archivo = '') {
  if (/x-?ray|xray|ore\s*finder|ore\s*vision/i.test(archivo)) return { ok: false, motivo: 'Los paquetes X-Ray están prohibidos.' };
  let zip; try { zip = readZipBuffer(buf); } catch { return { ok: false, motivo: 'El paquete está dañado.' }; }
  const meta = zip.find((e) => e.name === 'pack.mcmeta');
  if (meta) {
    const m = leerJson(meta.getData());
    if (m && PALABRAS.test(JSON.stringify(m.pack?.description || ''))) return { ok: false, motivo: 'Los paquetes X-Ray están prohibidos.' };
  }
  let invisibles = 0;
  for (const b of BLOQUES_XRAY) {
    const tex = zip.find((e) => e.name === `assets/minecraft/textures/block/${b}.png`);
    if (tex && transparenciaPng(tex.getData()) > 0.6) invisibles++;
    const mod = zip.find((e) => e.name === `assets/minecraft/models/block/${b}.json`);
    if (mod) {
      const j = leerJson(mod.getData());
      if (j && Array.isArray(j.elements) && j.elements.length === 0) invisibles++;
    }
  }
  if (invisibles >= 2) return { ok: false, motivo: 'Este paquete vuelve invisibles la piedra o la tierra (X-Ray).' };
  // Minerales con brillo exagerado (emissive) en bloques de mena
  const brillo = zip.filter((e) => /assets\/minecraft\/(optifine\/emissive|textures\/block\/.*ore.*_e)\b/.test(e.name)).length;
  if (brillo > 6 && invisibles >= 1) return { ok: false, motivo: 'Este paquete resalta los minerales a través de los bloques.' };
  return { ok: true, motivo: '' };
}

module.exports = { analizarMod, analizarTexturas, transparenciaPng };
