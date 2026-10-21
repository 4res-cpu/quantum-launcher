'use strict';
// Descargas con reintentos, verificación de hash y cola con concurrencia.
// Sin dependencias: usa fetch (Node 18+/Electron). Electron puede inyectar net.fetch
// con setFetch() para respetar el proxy del sistema.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

let fetchImpl = (...a) => globalThis.fetch(...a);
let userAgent = 'QuantumLauncher/1.0';

function setFetch(fn) { fetchImpl = fn; }
function setUserAgent(ua) { userAgent = ua; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method, body, signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, ...headers },
    });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tiempo de espera agotado: ${url}`);
    throw new Error(`Sin conexión con ${hostOf(url)} (${e.cause?.code || e.message})`);
  } finally { clearTimeout(timer); }
}

function hostOf(url) { try { return new URL(url).host; } catch { return url; } }

async function fetchJson(url, opts = {}) {
  const { retries = 2, ...rest } = opts;
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await request(url, rest);
      const text = await res.text();
      if (!res.ok) throw new HttpError(`HTTP ${res.status} en ${url}`, res.status, text);
      try { return JSON.parse(text); } catch { throw new Error(`Respuesta no válida (no es JSON) de ${url}`); }
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      if (i < retries) await sleep(600 * (i + 1));
    }
  }
  throw last;
}

async function postJson(url, data, headers = {}) {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* cuerpo no JSON */ }
  if (!res.ok) throw new HttpError(`HTTP ${res.status} en ${url}`, res.status, json ?? text);
  return json;
}

async function postForm(url, form) {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new HttpError(`HTTP ${res.status} en ${url}`, res.status, json ?? text);
  return json;
}

async function fileHash(file, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

/** ¿El archivo existe y coincide con el hash/tamaño esperado? */
async function isValid(file, expect = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  if (expect.size != null && st.size !== expect.size) return false;
  for (const algo of ['sha1', 'sha256', 'sha512']) {
    if (expect[algo]) return (await fileHash(file, algo)) === expect[algo].toLowerCase();
  }
  return expect.size != null || st.size > 0;
}

/**
 * Descarga a `dest` verificando hashes. `urls` puede ser una URL o una lista de
 * alternativas. Escribe en .part y renombra al final (nunca deja archivos a medias).
 */
async function download(urls, dest, expect = {}, onBytes = () => {}, retries = 3) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!list.length) throw new Error(`No hay URL de descarga para ${path.basename(dest)}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.part`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = list[attempt % list.length];
    let received = 0;
    // Si la conexión se queda parada 30 s sin recibir datos, se corta y se reintenta.
    const ctrl = new AbortController();
    let idle = setTimeout(() => ctrl.abort(), 30000);
    const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), 30000); };
    let out = null;
    try {
      let res;
      try {
        res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': userAgent } });
      } catch (e) { throw new Error(`Sin conexión con ${hostOf(url)} (${e.cause?.code || e.message})`); }
      if (!res.ok || !res.body) throw new HttpError(`HTTP ${res.status} al descargar ${url}`, res.status);
      const hashes = {};
      for (const algo of ['sha1', 'sha256', 'sha512']) if (expect[algo]) hashes[algo] = crypto.createHash(algo);
      out = fs.createWriteStream(tmp);
      const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
      for await (const chunk of res.body) {
        kick();
        const buf = Buffer.from(chunk);
        received += buf.length;
        for (const h of Object.values(hashes)) h.update(buf);
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        onBytes(buf.length);
      }
      out.end();
      await done;
      if (expect.size != null && received !== expect.size) {
        throw new Error(`Tamaño incorrecto en ${path.basename(dest)} (${received} de ${expect.size} bytes)`);
      }
      for (const [algo, h] of Object.entries(hashes)) {
        const got = h.digest('hex');
        if (got !== expect[algo].toLowerCase()) throw new Error(`El archivo ${path.basename(dest)} llegó dañado (${algo} no coincide)`);
      }
      await fsp.rename(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = ctrl.signal.aborted ? new Error(`La descarga de ${path.basename(dest)} se quedó parada (conexión lenta o cortada)`) : e;
      onBytes(-received);
      if (out && !out.closed) await new Promise((r) => { out.once('close', r); out.destroy(); });
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (e instanceof HttpError && e.status === 404 && list.length === 1) break;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    } finally { clearTimeout(idle); }
  }
  throw lastErr;
}

/** Ejecuta tareas async con un límite de concurrencia. Lanza el primer error. */
async function pool(items, limit, worker) {
  let i = 0; let failed = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); } catch (e) { failed = failed || e; }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
}

module.exports = { setFetch, setUserAgent, request, fetchJson, postJson, postForm, download, pool, fileHash, isValid, exists, HttpError, sleep };
