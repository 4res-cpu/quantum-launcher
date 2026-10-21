'use strict';
// Cuentas: premium (Microsoft → Xbox Live → XSTS → Minecraft Services) y no premium (offline).
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('./http');

const DEFAULT_AUTH = {
  authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xbl: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLogin: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
};
const SCOPE = 'XboxLive.signin offline_access';

// ---------- No premium ----------
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
function validarNombre(nombre) {
  if (!nombre) return 'Escribe un nombre de usuario.';
  if (nombre.length < 3) return 'El nombre debe tener al menos 3 caracteres.';
  if (nombre.length > 16) return 'El nombre puede tener como máximo 16 caracteres.';
  if (!NAME_RE.test(nombre)) return 'Solo se permiten letras, números y guion bajo (_), sin espacios ni tildes.';
  return null;
}

/** UUID offline estándar: UUID v3 de "OfflinePlayer:<nombre>" (igual que Java UUID.nameUUIDFromBytes). */
function offlineUUID(nombre) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${nombre}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function crearOffline(nombre) {
  const err = validarNombre(nombre);
  if (err) throw new Error(err);
  return { id: `offline:${nombre.toLowerCase()}`, tipo: 'offline', nombre, uuid: offlineUUID(nombre) };
}

// ---------- Premium (Microsoft) ----------
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, state: crypto.randomBytes(12).toString('hex') };
}

function authorizeUrl({ clientId, redirectUri, challenge, state, endpoints = {} }) {
  const ep = { ...DEFAULT_AUTH, ...endpoints };
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE,
    prompt: 'select_account', code_challenge: challenge, code_challenge_method: 'S256', state,
  });
  return `${ep.authorize}?${q}`;
}

const XSTS_ERRORES = {
  2148916227: 'Esta cuenta tiene un bloqueo de Xbox.',
  2148916233: 'Esta cuenta de Microsoft no tiene perfil de Xbox. Entra una vez en minecraft.net o xbox.com para crearlo y vuelve a intentarlo.',
  2148916235: 'Xbox Live no está disponible en el país de esta cuenta.',
  2148916236: 'La cuenta necesita verificación de edad en xbox.com.',
  2148916237: 'La cuenta necesita verificación de edad en xbox.com.',
  2148916238: 'Es una cuenta de menor de edad: un adulto debe añadirla a un grupo familiar de Microsoft (account.microsoft.com/family).',
};

function explicar(e, paso) {
  if (e instanceof http.HttpError) {
    const b = e.body || {};
    if (paso === 'xsts' && b.XErr) return new Error(XSTS_ERRORES[b.XErr] || `Xbox rechazó el inicio de sesión (código ${b.XErr}).`);
    if (paso === 'mc' && e.status === 403) return new Error('Minecraft rechazó la aplicación del launcher (403). Falta que Microsoft apruebe el Client ID para la API de Minecraft: mira la guía AZURE.md.');
    if (paso === 'perfil' && e.status === 404) return new Error('Esta cuenta de Microsoft no tiene Minecraft Java comprado (o nunca abrió el launcher oficial para crear el perfil). Usa el modo no premium.');
    if (paso === 'token' && b.error === 'invalid_grant') return Object.assign(new Error('La sesión de Microsoft caducó. Vuelve a iniciar sesión.'), { reLogin: true });
    if (paso === 'token' && b.error) return new Error(`Microsoft respondió: ${b.error_description || b.error}`);
    if (e.status === 429) return new Error('Demasiados intentos. Espera un minuto y vuelve a probar.');
  }
  return e;
}

async function step(paso, fn) { try { return await fn(); } catch (e) { throw explicar(e, paso); } }

/** De un token de Microsoft hasta la cuenta de Minecraft. */
async function minecraftDesdeMicrosoft(msToken, endpoints = {}) {
  const ep = { ...DEFAULT_AUTH, ...endpoints };
  const xbl = await step('xbl', () => http.postJson(ep.xbl, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }));
  const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;
  const xsts = await step('xsts', () => http.postJson(ep.xsts, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  }));
  const mc = await step('mc', () => http.postJson(ep.mcLogin, { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }));
  const perfil = await step('perfil', async () => {
    const res = await http.request(ep.mcProfile, { headers: { Authorization: `Bearer ${mc.access_token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new http.HttpError(`HTTP ${res.status}`, res.status, body);
    return body;
  });
  const id = perfil.id;
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  return {
    nombre: perfil.name, uuid, xuid: xsts.DisplayClaims?.xui?.[0]?.xid || '',
    accessToken: mc.access_token, expira: Date.now() + (mc.expires_in || 86400) * 1000,
  };
}

async function canjearCodigo({ code, verifier, clientId, redirectUri, endpoints = {} }) {
  const ep = { ...DEFAULT_AUTH, ...endpoints };
  const t = await step('token', () => http.postForm(ep.token, {
    client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE,
  }));
  const mc = await minecraftDesdeMicrosoft(t.access_token, endpoints);
  return { id: `ms:${mc.uuid}`, tipo: 'microsoft', ...mc, refreshToken: t.refresh_token };
}

/** Renueva la sesión si al token de Minecraft le quedan menos de 10 minutos. */
async function renovarSiHaceFalta(cuenta, { clientId, endpoints = {} }, force = false) {
  if (cuenta.tipo !== 'microsoft') return cuenta;
  if (!force && cuenta.accessToken && cuenta.expira - Date.now() > 10 * 60 * 1000) return cuenta;
  if (!cuenta.refreshToken) throw Object.assign(new Error('Vuelve a iniciar sesión con Microsoft.'), { reLogin: true });
  const ep = { ...DEFAULT_AUTH, ...endpoints };
  const t = await step('token', () => http.postForm(ep.token, {
    client_id: clientId, grant_type: 'refresh_token', refresh_token: cuenta.refreshToken, scope: SCOPE,
  }));
  const mc = await minecraftDesdeMicrosoft(t.access_token, endpoints);
  return { ...cuenta, ...mc, refreshToken: t.refresh_token || cuenta.refreshToken };
}

// ---------- Almacén de cuentas ----------
// Los tokens se guardan cifrados con `cipher` (Electron safeStorage → DPAPI en Windows, Llavero en macOS).
class AccountStore {
  constructor(file, cipher = { encrypt: (s) => s, decrypt: (s) => s }) {
    this.file = file; this.cipher = cipher; this.data = { activa: null, cuentas: [] };
  }

  async load() {
    try { this.data = JSON.parse(await fsp.readFile(this.file, 'utf8')); } catch { /* primera vez */ }
    this.data.cuentas ||= [];
    return this;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(`${this.file}.tmp`, JSON.stringify(this.data, null, 1));
    await fsp.rename(`${this.file}.tmp`, this.file);
  }

  /** Lista sin secretos, para la interfaz. */
  list() {
    return this.data.cuentas.map(({ id, tipo, nombre, uuid }) => ({ id, tipo, nombre, uuid, activa: id === this.data.activa }));
  }

  get(id) {
    const c = this.data.cuentas.find((x) => x.id === id);
    if (!c) return null;
    const out = { ...c };
    for (const k of ['accessToken', 'refreshToken']) if (out[k]) { try { out[k] = this.cipher.decrypt(out[k]); } catch { delete out[k]; } }
    return out;
  }

  active() { return this.data.activa ? this.get(this.data.activa) : null; }

  async upsert(cuenta, activar = true) {
    const stored = { ...cuenta };
    for (const k of ['accessToken', 'refreshToken']) if (stored[k]) stored[k] = this.cipher.encrypt(stored[k]);
    const i = this.data.cuentas.findIndex((x) => x.id === cuenta.id);
    if (i >= 0) this.data.cuentas[i] = stored; else this.data.cuentas.push(stored);
    if (activar) this.data.activa = cuenta.id;
    await this.save();
  }

  async remove(id) {
    this.data.cuentas = this.data.cuentas.filter((x) => x.id !== id);
    if (this.data.activa === id) this.data.activa = this.data.cuentas[0]?.id || null;
    await this.save();
  }

  async select(id) { if (this.data.cuentas.some((x) => x.id === id)) { this.data.activa = id; await this.save(); } }
}

module.exports = { validarNombre, offlineUUID, crearOffline, pkce, authorizeUrl, canjearCodigo, renovarSiHaceFalta, minecraftDesdeMicrosoft, AccountStore, DEFAULT_AUTH };
