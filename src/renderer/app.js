'use strict';
/* global quantum, I18N */
// Interfaz del launcher. Todo lo que llega de internet se pinta con textContent (nunca innerHTML).
const $ = (id) => document.getElementById(id);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const estado = { init: null, cuentas: [], ajustes: null, jugando: false, logBuffer: [], contenido: null, noticias: [], mods: null, segMods: 'mods' };

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat()) if (h != null) n.append(h.nodeType ? h : String(h));
  return n;
}
async function llamar(fn, ...args) {
  const r = await fn(...args);
  if (!r.ok) { const e = new Error(r.error); e.reLogin = r.reLogin; throw e; }
  return r.datos;
}

// ---------- Idioma ----------
let LANG = 'es';
const LOCALE = { es: 'es', en: 'en', pt: 'pt-BR' };
function t(k, vars = {}) {
  const v = (I18N[LANG] && I18N[LANG][k]) ?? I18N.es[k] ?? k;
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, n) => (vars[n] ?? '')) : v;
}
function traducir() {
  document.documentElement.lang = LANG;
  for (const n of $$('[data-t]')) n.textContent = t(n.dataset.t);
  for (const n of $$('[data-t-ph]')) n.placeholder = t(n.dataset.tPh);
  for (const n of $$('[data-t-aria]')) n.setAttribute('aria-label', t(n.dataset.tAria));
  for (const n of $$('[data-t-title]')) n.title = t(n.dataset.tTitle);
}
// Texto remoto con traducción opcional: { titulo, titulo_en, titulo_pt }
const campo = (x, k) => (x && (x[`${k}_${LANG}`] || x[k])) || '';

// ---------- Iconos ----------
const ICON = {
  inicio: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
  noticias: '<path d="M5 5h11v14H7a2 2 0 0 1-2-2zM16 9h3v8a2 2 0 0 1-2 2h-1M8 9h5M8 12.5h5M8 16h3"/>',
  calendario: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  pase: '<path d="M5 4h14v16l-7-4-7 4z"/><path d="m12 7.5 1.1 2.3 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z"/>',
  camara: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><circle cx="12" cy="13" r="3.5"/>',
  mods: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  normas: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  globo: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.8 3.5 5.6 3.5 8.5s-1 5.7-3.5 8.5c-2.5-2.8-3.5-5.6-3.5-8.5s1-5.7 3.5-8.5z"/>',
  soporte: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  copiar: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  izq: '<path d="m14.5 6-6 6 6 6"/>', der: '<path d="m9.5 6 6 6-6 6"/>',
  discord: '<path d="M8.5 7.5c2.3-.7 4.7-.7 7 0M7.5 16.5c2.9 1.2 6.1 1.2 9 0M8 5.5 6 5c-1.7 2.6-2.6 5.6-2.5 9 1.2 1.5 2.7 2.5 4.5 3l1-1.8M16 5.5l2-.5c1.7 2.6 2.6 5.6 2.5 9-1.2 1.5-2.7 2.5-4.5 3l-1-1.8"/><circle cx="9.5" cy="12" r="1.2"/><circle cx="14.5" cy="12" r="1.2"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.8 3.5 5.6 3.5 8.5s-1 5.7-3.5 8.5c-2.5-2.8-3.5-5.6-3.5-8.5s1-5.7 3.5-8.5z"/>',
  tienda: '<path d="M5 9h14l-1 11H6zM9 9V7a3 3 0 0 1 6 0v2"/>',
  youtube: '<rect x="3.5" y="6" width="17" height="12" rx="3.5"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  tiktok: '<path d="M13.5 4v10.5a3 3 0 1 1-3-3M13.5 4c.4 2.3 1.8 3.7 4 4"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.2h.01"/>',
  x: '<path d="M5 5l14 14M19 5 5 19"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
function pintarIconos(raiz = document) {
  for (const n of $$('[data-icon]', raiz)) {
    // Los iconos son SVG fijos de este archivo (no vienen de internet)
    const tmp = document.createElement('template'); tmp.innerHTML = svg(n.dataset.icon);
    n.prepend(tmp.content.firstChild);
  }
}

// ---------- Sonidos (sintetizados, sin archivos) ----------
let ctxAudio = null;
function sonar(tipo) {
  const a = estado.ajustes;
  if (!a || !a.sonidos || !a.volumen) return;
  try {
    ctxAudio ||= new AudioContext();
    const c = ctxAudio, ahora = c.currentTime, vol = (a.volumen / 100) * 0.16;
    const nota = (f, ini, dur, forma = 'sine', g = 1) => {
      const o = c.createOscillator(), v = c.createGain();
      o.type = forma; o.frequency.value = f;
      v.gain.setValueAtTime(0, ahora + ini); v.gain.linearRampToValueAtTime(vol * g, ahora + ini + 0.01); v.gain.exponentialRampToValueAtTime(0.0001, ahora + ini + dur);
      o.connect(v).connect(c.destination); o.start(ahora + ini); o.stop(ahora + ini + dur + 0.05);
    };
    if (tipo === 'clic') nota(880, 0, 0.07, 'triangle', 0.6);
    if (tipo === 'pagina') { nota(523, 0, 0.12, 'sine', 0.5); nota(784, 0.04, 0.16, 'sine', 0.35); }
    if (tipo === 'jugar') { [523, 659, 784, 1047].forEach((f, i) => nota(f, i * 0.07, 0.5, 'sine', 0.7)); nota(2093, 0.3, 0.6, 'triangle', 0.15); }
    if (tipo === 'ok') { nota(660, 0, 0.12, 'sine', 0.6); nota(990, 0.08, 0.18, 'sine', 0.5); }
    if (tipo === 'error') { nota(220, 0, 0.22, 'triangle', 0.7); nota(185, 0.12, 0.3, 'triangle', 0.6); }
  } catch { /* sin audio */ }
}

// ---------- Avisos ----------
function aviso(texto, boton) {
  const a = $('aviso');
  a.replaceChildren(el('span', {}, texto));
  if (boton) a.append(el('button', { type: 'button', onclick: () => { a.classList.add('oculto'); boton.accion(); } }, boton.texto));
  a.append(el('button', { type: 'button', 'aria-label': t('cerrar'), onclick: () => a.classList.add('oculto') }, '✕'));
  a.classList.remove('oculto');
  clearTimeout(aviso.tm);
  if (!boton) aviso.tm = setTimeout(() => a.classList.add('oculto'), 6000);
}

const mb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} GB` : `${n} MB`);
const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
function duracion(ms) {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? t('horas', { h, m: m % 60 }) : t('min', { m });
}
function faltaPara(ms) {
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const fechaCorta = (d, op = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(LOCALE[LANG], op).format(d);

// ---------- Navegación ----------
function irA(pagina) {
  for (const b of $$('.riel-btn[data-pagina]')) b.classList.toggle('activo', b.dataset.pagina === pagina);
  for (const s of $$('.pagina')) s.classList.toggle('activa', s.dataset.pagina === pagina);
  $('barra-titulo').textContent = pagina === 'inicio' ? '' : t(pagina);
  sonar('pagina');
  if (pagina === 'noticias') $('punto-noticias').classList.add('oculto');
  if (pagina === 'capturas') cargarCapturas();
  if (pagina === 'mods') cargarMods();
}

// ---------- Apariencia ----------
function aplicarApariencia() {
  const a = estado.ajustes, r = document.documentElement;
  r.dataset.tema = a.tema; r.dataset.acento = a.acento; r.dataset.ilustracion = a.ilustracion;
  r.dataset.anim = a.animaciones ? 'si' : 'no';
}
async function guardar(cambios) {
  estado.ajustes = await llamar(quantum.guardarAjustes, cambios);
  aplicarApariencia();
  return estado.ajustes;
}

// ---------- Ilustración ----------
function ponerIlustracion() {
  const lista = estado.init.ilustraciones || [];
  const il = lista[0];
  if (!il) { document.documentElement.dataset.ilustracion = 'oculta'; return; }
  const url = `../../assets/ilustraciones/${il.archivo}`;
  $('ilustracion').src = url; $('ilustracion').alt = il.titulo || '';
  $('fondo-ilustracion').style.backgroundImage = `url("${url}")`;
  $('ilustracion-pie').textContent = il.autor ? `${il.titulo || ''} · ${il.autor}` : (il.titulo || '');
  $('creditos').textContent = t('creditos', { t: il.titulo || '', a: il.autor || '' });
}

// ---------- Cuentas ----------
function cara(c, nodo) {
  nodo.style.backgroundImage = '';
  if (!c) { nodo.textContent = '+'; return; }
  nodo.textContent = c.nombre.charAt(0).toUpperCase();
  const url = `https://mc-heads.net/avatar/${encodeURIComponent(c.tipo === 'microsoft' ? c.uuid : c.nombre)}/96`;
  const img = new Image();
  img.onload = () => { nodo.textContent = ''; nodo.style.backgroundImage = `url("${url}")`; };
  img.src = url;
}
function pintarCuentas() {
  const activa = estado.cuentas.find((c) => c.activa);
  $('cuenta-nombre').textContent = activa ? activa.nombre : t('anadirCuenta');
  $('cuenta-tipo').textContent = activa ? (activa.tipo === 'microsoft' ? t('premium') : t('noPremium')) : t('premiumONo');
  cara(activa, $('cara'));
  if (activa) {
    $('skin-cuerpo').src = `https://mc-heads.net/body/${encodeURIComponent(activa.tipo === 'microsoft' ? activa.uuid : activa.nombre)}/220`;
    $('skin-nota').textContent = activa.tipo === 'microsoft' ? t('skinPremium') : t('skinNoPremium');
    $('btn-skin').hidden = activa.tipo !== 'microsoft';
  } else { $('skin-cuerpo').removeAttribute('src'); $('skin-nota').textContent = ''; $('btn-skin').hidden = true; }
  const ul = $('lista-cuentas');
  ul.replaceChildren();
  if (!estado.cuentas.length) ul.append(el('li', { class: 'vacio' }, t('anadeCuenta')));
  for (const c of estado.cuentas) {
    const caraNodo = el('span', { class: 'cara', 'aria-hidden': 'true' });
    cara(c, caraNodo);
    ul.append(el('li', { class: c.activa ? 'activa' : '' }, caraNodo,
      el('span', { class: 'datos' }, el('b', {}, c.nombre), el('span', {}, c.tipo === 'microsoft' ? t('premium') : t('noPremium'))),
      el('button', { type: 'button', disabled: c.activa, onclick: () => usarCuenta(c.id) }, c.activa ? t('enUso') : t('usar')),
      el('button', { type: 'button', onclick: () => quitarCuenta(c) }, t('quitar'))));
  }
}
async function usarCuenta(id) { estado.cuentas = await llamar(quantum.seleccionarCuenta, id); pintarCuentas(); sonar('ok'); }
async function quitarCuenta(c) {
  if (!confirm(t('quitarConfirma', { n: c.nombre }))) return;
  estado.cuentas = await llamar(quantum.eliminarCuenta, c.id); pintarCuentas();
}
function configurarCuentas() {
  $('cuenta').addEventListener('click', () => { sonar('clic'); $('dlg-cuentas').showModal(); });
  $('btn-skin').addEventListener('click', () => llamar(quantum.abrirEnlace, 'https://www.minecraft.net/msaccount/profile'));
  $('btn-ms').addEventListener('click', async () => {
    const b = $('btn-ms'); b.disabled = true; $('offline-error').textContent = '';
    try { estado.cuentas = await llamar(quantum.cuentaMicrosoft); pintarCuentas(); $('dlg-cuentas').close(); sonar('ok'); }
    catch (e) { $('offline-error').textContent = e.message; } finally { b.disabled = false; $('ms-codigo').hidden = true; }
  });
  let codigoMs = null;
  quantum.on('cuentas:codigo', (d) => {
    codigoMs = d; $('ms-codigo').hidden = !d;
    if (d) { $('ms-num').textContent = d.codigo; $('ms-estado').textContent = t('esperando'); }
  });
  $('ms-abrir').addEventListener('click', () => { if (codigoMs) quantum.abrirEnlace(`https://www.microsoft.com/link?otc=${encodeURIComponent(codigoMs.codigo)}`); });
  $('ms-copiar').addEventListener('click', async () => { if (!codigoMs) return; try { await navigator.clipboard.writeText(codigoMs.codigo); $('ms-estado').textContent = t('codigoCopiado'); } catch { /* */ } });
  $('ms-cancelar').addEventListener('click', () => quantum.cancelarMicrosoft());
  const input = $('nombre-offline');
  input.addEventListener('input', () => { input.value = input.value.replace(/[^A-Za-z0-9_]/g, ''); $('offline-error').textContent = ''; });
  $('form-offline').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { estado.cuentas = await llamar(quantum.cuentaOffline, input.value); input.value = ''; pintarCuentas(); $('dlg-cuentas').close(); sonar('ok'); }
    catch (e) { $('offline-error').textContent = e.message; sonar('error'); }
  });
}

// ---------- Ajustes ----------
function chips(id, valor, alCambiar) {
  const caja = $(id);
  const marcar = (v) => { for (const b of $$('button', caja)) b.setAttribute('aria-pressed', String(b.dataset.v === v)); };
  marcar(valor);
  caja.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    marcar(b.dataset.v); sonar('clic'); alCambiar(b.dataset.v);
  });
}
function interruptor(id, valor, alCambiar) {
  const i = $(id); i.checked = !!valor;
  i.addEventListener('change', () => { sonar('clic'); alCambiar(i.checked); });
}
function configurarAjustes() {
  const { ram, hw, perfilAuto } = estado.init;
  const a = estado.ajustes;
  // Personalizar
  chips('op-idioma', a.idioma, async (v) => { await guardar({ idioma: v }); LANG = v; traducir(); repintarTodo(); });
  chips('op-tema', a.tema, (v) => guardar({ tema: v }));
  chips('op-acento', a.acento, (v) => guardar({ acento: v }));
  chips('op-ilustracion', a.ilustracion, (v) => guardar({ ilustracion: v }));
  interruptor('op-animaciones', a.animaciones, (v) => guardar({ animaciones: v }));
  interruptor('op-intro', a.intro, (v) => guardar({ intro: v }));
  interruptor('op-sonidos', a.sonidos, (v) => guardar({ sonidos: v }).then(() => sonar('ok')));
  const vol = $('op-volumen'); vol.value = a.volumen; $('op-volumen-v').textContent = `${a.volumen}%`;
  vol.addEventListener('input', () => { $('op-volumen-v').textContent = `${vol.value}%`; });
  vol.addEventListener('change', () => guardar({ volumen: Number(vol.value) }).then(() => sonar('clic')));
  // Juego
  const res = $('op-res'), an = $('op-ancho'), al = $('op-alto');
  an.value = a.ancho; al.value = a.alto;
  const marcarRes = () => { const k = `${an.value}x${al.value}`; res.value = [...res.options].some((o) => o.value === k) ? k : 'x'; };
  marcarRes();
  res.addEventListener('change', () => { if (res.value !== 'x') { const [w, h] = res.value.split('x'); an.value = w; al.value = h; guardar({ ancho: Number(w), alto: Number(h) }); } });
  for (const i of [an, al]) i.addEventListener('change', () => { marcarRes(); guardar({ ancho: Number(an.value), alto: Number(al.value) }); });
  interruptor('op-completa', a.pantallaCompleta, (v) => guardar({ pantallaCompleta: v }));
  interruptor('op-ocultar', a.cerrarAlJugar, (v) => guardar({ cerrarAlJugar: v }));
  interruptor('op-directo', a.conectarDirecto !== false, (v) => guardar({ conectarDirecto: v }));
  $('op-idioma-juego').value = a.idiomaJuego || 'es_es';
  $('op-idioma-juego').addEventListener('change', () => guardar({ idiomaJuego: $('op-idioma-juego').value }));
  // Memoria
  const r = $('op-ram'); r.min = ram.min; r.max = ram.max; r.value = a.ramMB;
  const pintarRam = () => {
    $('op-ram-v').textContent = mb(Number(r.value));
    $('ram-ayuda').textContent = t('ramAyuda', { r: mb(ram.recomendado), t: mb(hw.ramMB) }) + (ram.poca ? t('ramPoca') : '');
    r.style.background = `linear-gradient(90deg, var(--acento) ${((r.value - ram.min) / (ram.max - ram.min || 1)) * 100}%, var(--linea-2) 0)`;
  };
  $('ram-escala').replaceChildren(el('span', {}, mb(ram.min)), el('span', {}, mb(ram.max)));
  pintarRam(); r.addEventListener('input', pintarRam); r.addEventListener('change', () => guardar({ ramMB: Number(r.value) }));
  // Rendimiento
  $('pc-info').textContent = `${hw.cpu} · ${hw.gpu} · ${mb(hw.ramMB)}`;
  $('perfil-auto').textContent = t(perfilAuto);
  chips('op-perfil', a.perfil || 'auto', (v) => guardar({ perfil: v }));
  $('btn-optimizar').addEventListener('click', async () => {
    try { await llamar(quantum.aplicarPerfil, estado.ajustes.perfil || 'auto'); aviso(t('calidadAplicada')); sonar('ok'); } catch (e) { aviso(e.message); }
  });
  interruptor('op-ligero', a.modoLigero ?? perfilAuto === 'bajo', (v) => guardar({ modoLigero: v }));
  interruptor('op-seguro', a.modoSeguro, (v) => guardar({ modoSeguro: v }));
  // Módulos
  const lista = estado.init.evento.modulos || [];
  const cont = $('modulos');
  const contar = () => { $('mod-cuenta').textContent = lista.length ? t('activos', { a: $$('input:checked', cont).length, n: lista.length }) : ''; };
  for (const m of lista) {
    const inp = el('input', { type: 'checkbox' }); inp.dataset.mod = m.id;
    inp.checked = (a.modulos || {})[m.id] ?? m.defecto;
    inp.addEventListener('change', () => {
      sonar('clic'); contar();
      const o = {}; for (const i of $$('input[data-mod]', cont)) o[i.dataset.mod] = i.checked;
      guardar({ modulos: o });
    });
    cont.append(el('label', { class: 'interruptor' }, inp, el('span', { class: 'sw' }), el('span', {}, el('b', {}, m.nombre), el('small', {}, m.desc || ''))));
  }
  contar();
  // Java
  $('op-java').value = a.javaArgs || '';
  $('op-java').addEventListener('change', () => guardar({ javaArgs: $('op-java').value.trim() }));
  // Instalación
  $('ruta-datos').textContent = estado.init.rutas.datos;
  $('ruta-juego').textContent = estado.init.rutas.juego;
  $('btn-carpeta-datos').addEventListener('click', () => llamar(quantum.abrirCarpeta, 'datos'));
  $('btn-carpeta-juego').addEventListener('click', () => llamar(quantum.abrirCarpeta, 'juego'));
  $('btn-reparar').addEventListener('click', () => { irA('inicio'); jugar(true); });
  // Pestañas
  const tabs = $$('.ajustes-tabs [data-tab]');
  for (const b of tabs) {
    b.addEventListener('click', () => {
      sonar('clic');
      for (const o of tabs) o.setAttribute('aria-selected', String(o === b));
      for (const s of $$('.ajustes-cuerpo [data-panel]')) s.hidden = s.dataset.panel !== b.dataset.tab;
    });
  }
  $('btn-modulos').addEventListener('click', () => { irA('ajustes'); $$('.ajustes-tabs [data-tab="modulos"]')[0].click(); });
}
function abrirAjustes(tab) { irA('ajustes'); const b = $$(`.ajustes-tabs [data-tab="${tab}"]`)[0]; if (b) b.click(); }

// ---------- Acerca, legal y comunidad ----------
const REDES = ['discord', 'web', 'tienda', 'youtube', 'tiktok', 'instagram', 'x'];
function redesConfiguradas() {
  const e = { ...(estado.init.enlaces || {}), ...((estado.contenido && estado.contenido.enlaces) || {}) };
  if (!e.discord) e.discord = estado.init.evento.discord;
  return REDES.filter((k) => typeof e[k] === 'string' && /^https:\/\//.test(e[k])).map((k) => ({ k, url: e[k] }));
}
const nombreRed = (k) => ({ discord: 'Discord', web: t('web'), tienda: t('tienda'), youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X' }[k]);
function pintarComunidad() {
  const redes = redesConfiguradas();
  const boton = (r) => { const b = el('button', { type: 'button', class: 'btn', onclick: () => llamar(quantum.abrirEnlace, r.url) }, nombreRed(r.k)); b.dataset.icon = r.k; return b; };
  const pop = $('pop-comunidad');
  pop.replaceChildren(...redes.map((r) => { const b = el('button', { type: 'button', role: 'menuitem', onclick: () => { pop.classList.add('oculto'); llamar(quantum.abrirEnlace, r.url); } }, nombreRed(r.k)); b.dataset.icon = r.k; return b; }));
  if (redes.length < 2) pop.append(el('p', {}, t('sinRedes')));
  $('redes-acerca').replaceChildren(...redes.map(boton));
  pintarIconos(pop); pintarIconos($('redes-acerca'));
}
function pintarAcerca(pack) {
  const i = estado.init;
  $('acerca-version').textContent = `${t('lanzador', { v: i.version })}${i.portable ? ' (portable)' : ''} · ${t('pack', { v: pack || '-' })} · Minecraft 1.21.1`;
  $('legal').textContent = campo(i.legal, 'aviso');
}

// ---------- Registro ----------
function abrirRegistro(resumen) {
  const res = $('error-resumen');
  if (resumen) { res.textContent = resumen; res.classList.remove('oculto'); } else res.classList.add('oculto');
  $('registro').textContent = estado.logBuffer.join('\n');
  $('dlg-registro').showModal();
  $('registro').scrollTop = $('registro').scrollHeight;
}
function configurarRegistro() {
  $('btn-registro').addEventListener('click', () => abrirRegistro());
  $('btn-copiar').addEventListener('click', () => navigator.clipboard.writeText($('registro').textContent));
  $('btn-guardar-reg').addEventListener('click', () => llamar(quantum.guardarRegistro, $('registro').textContent));
  quantum.on('log', (l) => { estado.logBuffer.push(l); if (estado.logBuffer.length > 3000) estado.logBuffer.splice(0, 500); });
}

// ---------- Soporte ----------
function configurarSoporte() {
  $('btn-soporte').addEventListener('click', () => { sonar('clic'); $('dlg-soporte').showModal(); });
  $('sop-informe').addEventListener('click', async () => {
    const texto = (await llamar(quantum.registro).catch(() => '')) || estado.logBuffer.join('\n');
    llamar(quantum.guardarRegistro, texto);
  });
  $('sop-discord').addEventListener('click', () => llamar(quantum.abrirEnlace, estado.init.evento.discord));
  $('btn-comunidad').addEventListener('click', (e) => { e.stopPropagation(); sonar('clic'); $('pop-comunidad').classList.toggle('oculto'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#pop-comunidad')) $('pop-comunidad').classList.add('oculto'); });
}

// ---------- Progreso y jugar ----------
function progreso(p) {
  const etapas = { cuenta: t('cuenta'), manifiesto: t('actualizaciones'), java: 'Java', minecraft: t('minecraft'), modpack: t('modpack'), juego: t('jugar'), listo: t('listo') };
  $('prog-etapa').textContent = p.texto || etapas[p.etapa] || '';
  const rel = $('jugar-relleno');
  if (p.total) {
    rel.classList.remove('indet');
    rel.style.width = `${Math.min(100, (p.actual / p.total) * 100).toFixed(1)}%`;
    $('prog-detalle').textContent = p.bytes ? `${bytes(p.actual)} / ${bytes(p.total)}` : `${p.actual} / ${p.total}`;
  } else { rel.classList.add('indet'); rel.style.width = ''; $('prog-detalle').textContent = ''; }
}
function finProgreso(texto) {
  const rel = $('jugar-relleno'); rel.classList.remove('indet'); rel.style.width = '0';
  $('prog-etapa').textContent = texto; $('prog-detalle').textContent = '';
}
function botonJugar(texto, ocupado) {
  const b = $('jugar'); $('jugar-txt').textContent = texto; b.disabled = ocupado; b.classList.toggle('ocupado', ocupado);
  document.body.classList.toggle('ocupado', ocupado);
}
function elegirTexturas() {
  return new Promise((resolve) => {
    const d = $('dlg-seguro');
    const fin = (v) => { d.removeEventListener('close', cerrar); $('seguro-sin').onclick = null; $('seguro-normal').onclick = null; if (d.open) d.close(); resolve(v); };
    const cerrar = () => fin(null);
    $('seguro-sin').onclick = () => fin(true); $('seguro-normal').onclick = () => fin(false);
    d.addEventListener('close', cerrar); d.showModal();
  });
}
async function jugar(reparar = false) {
  if (estado.jugando) return;
  if (!estado.cuentas.some((c) => c.activa)) { $('dlg-cuentas').showModal(); return; }
  let sinTexturas = false;
  if (estado.ajustes?.modoSeguro) { sinTexturas = await elegirTexturas(); if (sinTexturas === null) return; }
  estado.jugando = true; sonar('jugar');
  botonJugar(reparar ? t('reparando') : t('preparando'), true);
  try {
    const r = await llamar(quantum.jugar, { reparar, sinTexturas });
    pintarAcerca(r.packVersion);
  } catch (e) {
    finProgreso(t('noSePudo')); sonar('error');
    if (e.reLogin) aviso(e.message, { texto: t('iniciarSesion'), accion: () => $('dlg-cuentas').showModal() }); else abrirRegistro(e.message);
  } finally { estado.jugando = false; botonJugar(t('jugar'), false); }
}
quantum.on('progreso', progreso);
quantum.on('juego', (j) => {
  if (j.estado === 'abierto') { botonJugar(t('enJuego'), true); finProgreso(t('suerte')); }
  if (j.estado === 'cerrado') {
    finProgreso(t('listo'));
    if (j.stats) pintarTiempo(j.stats);
    if (j.fallo) {
      let resumen = t('cerroInesperado');
      if (/OutOfMemoryError/.test(j.log + (j.crash?.texto || ''))) resumen += t('faltaRam');
      else if (/GLFW error|OpenGL|Pixel format not accelerated/i.test(j.log)) resumen += t('drivers');
      else resumen += t('enviaInforme');
      if (j.crash?.texto) estado.logBuffer.push('----- Minecraft crash report -----', j.crash.texto);
      abrirRegistro(resumen);
      if (!estado.ajustes?.modoSeguro) aviso(t('probarSeguro'), { texto: t('activar'), accion: async () => { await guardar({ modoSeguro: true }); $('op-seguro').checked = true; aviso(t('seguroActivado')); } });
    }
  }
});
quantum.on('launcher:update', (u) => {
  if (u.estado === 'descargando') aviso(t('descargandoAct', { v: u.version }));
  if (u.estado === 'listo') aviso(t('actLista', { v: u.version }), { texto: t('reiniciar'), accion: () => llamar(quantum.instalarActualizacion) });
});

// ---------- Inicio: servidor, tiempo, evento y noticia ----------
async function estadoServidor() {
  try {
    const s = await llamar(quantum.estadoServidor);
    $('led').className = `led ${s.online ? 'on' : 'off'}`;
    $('srv-num').textContent = s.online ? s.jugadores : 'OFF';
    $('srv-max').textContent = s.online ? ` / ${s.max}` : '';
    $('srv-txt').textContent = s.online ? `${t('enLinea')} · ${t('ping', { ms: s.latencia })}` : t('fuera');
  } catch { $('led').className = 'led off'; $('srv-num').textContent = '--'; $('srv-max').textContent = ''; $('srv-txt').textContent = t('noComprobar'); }
}
function pintarTiempo(s) {
  $('tiempo-total').textContent = duracion(s.totalMs || 0);
  $('tiempo-sesiones').textContent = s.sesiones === 1 ? t('sesion1') : s.sesiones ? t('sesiones', { n: s.sesiones }) : '';
}
function eventos() {
  const l = (estado.contenido && Array.isArray(estado.contenido.eventos)) ? estado.contenido.eventos : [];
  return l.map((e) => ({ ...e, ini: new Date(e.inicio), fin: e.fin ? new Date(e.fin) : null })).filter((e) => !Number.isNaN(+e.ini)).sort((a, b) => a.ini - b.ini);
}
function pintarFichaEvento() {
  const ahora = Date.now();
  const e = eventos().find((x) => (x.fin ? x.fin : new Date(+x.ini + 3600000)) > ahora);
  if (!e) { $('evento-titulo').textContent = t('sinEventos'); $('evento-cuando').textContent = ''; return; }
  $('evento-titulo').textContent = campo(e, 'titulo');
  $('evento-cuando').textContent = e.ini <= ahora ? t('ahora') : `${fechaCorta(e.ini, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${t('faltan', { t: faltaPara(e.ini - ahora) })}`;
}

// ---------- Noticias ----------
async function cargarNoticias() {
  try { const n = await llamar(quantum.noticias); estado.noticias = Array.isArray(n) ? n : n.noticias || []; } catch { estado.noticias = null; }
  pintarNoticias();
}
function pintarNoticias() {
  const ol = $('noticias');
  if (estado.noticias === null) { ol.replaceChildren(el('li', { class: 'vacio' }, t('errorNoticias'))); return; }
  const lista = estado.noticias.slice(0, 24);
  if (!lista.length) { ol.replaceChildren(el('li', { class: 'vacio' }, t('sinNoticias'))); return; }
  const fmt = (x) => { if (!x.fecha) return ''; const d = new Date(`${x.fecha}${x.fecha.length === 10 ? 'T12:00:00' : ''}`); return Number.isNaN(+d) ? '' : fechaCorta(d, { day: 'numeric', month: 'long', year: 'numeric' }); };
  ol.replaceChildren(...lista.map((x, i) => el('li', { class: `noticia${i === 0 ? ' destacada' : ''}` },
    x.imagen && /^https:\/\//.test(x.imagen) ? el('img', { src: x.imagen, alt: '' }) : null,
    el('div', { class: 'cuerpo' },
      fmt(x) ? el('time', {}, fmt(x)) : null, el('h3', {}, campo(x, 'titulo')), el('p', {}, campo(x, 'texto')),
      x.enlace && /^https:\/\//.test(x.enlace) ? el('button', { class: 'enlace', type: 'button', onclick: () => llamar(quantum.abrirEnlace, x.enlace) }, campo(x, 'textoEnlace') || t('verMas')) : null))));
  const top = lista.find((x) => x.destacada) || lista[0];
  $('noticia-titulo').textContent = campo(top, 'titulo') || '—';
  $('noticia-fecha').textContent = fmt(top);
  $('punto-noticias').classList.remove('oculto');
}

// ---------- Eventos (calendario) ----------
let mesVista = new Date(); mesVista.setDate(1);
function pintarCalendario() {
  const evs = eventos(), hoy = new Date();
  $('cal-mes').textContent = fechaCorta(mesVista, { month: 'long', year: 'numeric' });
  $('cal-semana').replaceChildren(...t('dia').map((d) => el('span', {}, d)));
  const primero = new Date(mesVista), desde = (primero.getDay() + 6) % 7;
  const celdas = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(primero.getFullYear(), primero.getMonth(), 1 - desde + i);
    const conEvento = evs.some((e) => e.ini.toDateString() === d.toDateString());
    const c = ['fuera', 'hoy', 'con-evento'].filter((k, j) => [d.getMonth() !== mesVista.getMonth(), d.toDateString() === hoy.toDateString(), conEvento][j]).join(' ');
    celdas.push(el('span', { class: c }, d.getDate()));
  }
  $('cal-grid').replaceChildren(...celdas);
  const delMes = evs.filter((e) => e.ini.getMonth() === mesVista.getMonth() && e.ini.getFullYear() === mesVista.getFullYear());
  const ol = $('lista-eventos');
  if (!delMes.length) { ol.replaceChildren(el('li', { class: 'vacio' }, t('sinEventosMes'))); return; }
  const ahora = Date.now();
  ol.replaceChildren(...delMes.map((e) => {
    const vivo = e.ini <= ahora && (!e.fin || e.fin > ahora);
    return el('li', { class: 'evento' },
      el('div', { class: 'dia' }, el('b', {}, e.ini.getDate()), el('small', {}, fechaCorta(e.ini, { month: 'short' }))),
      el('div', {}, el('h3', {}, campo(e, 'titulo')), el('p', {}, `${fechaCorta(e.ini, { hour: '2-digit', minute: '2-digit' })}${campo(e, 'lugar') ? ` · ${campo(e, 'lugar')}` : ''}${campo(e, 'texto') ? ` · ${campo(e, 'texto')}` : ''}`)),
      el('span', { class: `cuando${vivo ? ' vivo' : ''}` }, vivo ? t('ahora') : e.ini > ahora ? t('faltan', { t: faltaPara(e.ini - ahora) }) : ''));
  }));
}

// ---------- Pase de temporada ----------
function pintarPase() {
  const p = estado.contenido && estado.contenido.pase;
  const caja = $('pase');
  if (!p || !Array.isArray(p.niveles) || !p.niveles.length) { $('pase-nombre').textContent = t('pase'); $('pase-sub').textContent = t('paseSinTemporada'); caja.replaceChildren(); return; }
  $('pase-nombre').textContent = campo(p, 'nombre') || t('pase');
  const fin = p.fin ? new Date(p.fin) : null;
  $('pase-sub').textContent = fin && fin > Date.now() ? t('terminaEn', { t: faltaPara(fin - Date.now()) }) : '';
  caja.replaceChildren(...p.niveles.map((n, i) => el('div', { class: 'nivel' },
    el('b', {}, `${t('nivel')} ${n.nivel ?? i + 1}`),
    el('div', { class: 'premio' }, el('small', {}, t('gratis')), el('span', {}, campo(n, 'gratis') || '—')),
    el('div', { class: 'premio premium' }, el('small', {}, t('premiumPase')), el('span', {}, campo(n, 'premium') || '—')))));
}

// ---------- Normas ----------
function pintarNormas() {
  const l = (estado.contenido && Array.isArray(estado.contenido.normas)) ? estado.contenido.normas : [];
  $('normas').replaceChildren(...(l.length ? l.map((n) => el('li', {}, el('div', {}, el('b', {}, campo(n, 'titulo')), el('p', {}, campo(n, 'texto')))))
    : [el('li', { class: 'vacio' }, t('cargando'))]));
}

// ---------- Capturas ----------
async function cargarCapturas() {
  const caja = $('capturas');
  let l = [];
  try { l = await llamar(quantum.capturas); } catch { /* */ }
  if (!l.length) { caja.replaceChildren(el('p', { class: 'vacio' }, t('sinCapturas'))); return; }
  caja.replaceChildren(...l.map((c) => el('button', { type: 'button', class: 'captura', onclick: () => verCaptura(c) },
    c.miniatura ? el('img', { src: c.miniatura, alt: c.nombre, loading: 'lazy' }) : null, el('small', {}, fechaCorta(new Date(c.fecha))))));
}
async function verCaptura(c) {
  $('visor-nombre').textContent = c.nombre; $('visor-img').src = c.miniatura || '';
  $('visor-abrir').onclick = () => llamar(quantum.abrirCaptura, c.nombre);
  $('dlg-visor').showModal();
  try { $('visor-img').src = await llamar(quantum.verCaptura, c.nombre); } catch { /* */ }
}

// ---------- Mods ----------
async function cargarMods() {
  try { estado.mods = await llamar(quantum.mods); } catch { estado.mods = { mods: [], desactivados: [], texturas: [] }; }
  pintarMods();
}
function pintarMods() {
  const m = estado.mods; if (!m) return;
  const q = $('mods-buscar').value.trim().toLowerCase();
  const limpio = (n) => n.replace(/\.jar(\.disabled)?$/i, '').replace(/[-_+](fabric|mc)?[-_]?1\.21.*$/i, '').replace(/[-_]/g, ' ');
  let filas = estado.segMods === 'mods'
    ? [...m.mods.map((x) => ({ ...x, on: true })), ...m.desactivados.map((x) => ({ ...x, on: false }))]
    : m.texturas.map((x) => ({ ...x, on: true }));
  $('mods-sub').textContent = t('modsSub', { n: m.mods.length });
  if (q) filas = filas.filter((x) => x.nombre.toLowerCase().includes(q));
  filas.sort((a, b) => limpio(a.nombre).localeCompare(limpio(b.nombre)));
  $('lista-mods').replaceChildren(...(filas.length ? filas.map((x) => el('li', { class: x.on ? '' : 'apagado', title: x.nombre }, el('i'), el('b', {}, limpio(x.nombre)), el('small', {}, x.kb >= 1024 ? `${(x.kb / 1024).toFixed(1)} MB` : `${x.kb} KB`)))
    : [el('li', { class: 'vacio' }, t('sinMods'))]));
}
function configurarMods() {
  $('mods-buscar').addEventListener('input', pintarMods);
  for (const b of $$('.segmentos [data-seg]')) {
    b.addEventListener('click', () => {
      estado.segMods = b.dataset.seg; sonar('clic');
      for (const o of $$('.segmentos [data-seg]')) o.setAttribute('aria-selected', String(o === b));
      pintarMods();
    });
  }
  $('btn-carpeta-mods').addEventListener('click', () => llamar(quantum.abrirCarpeta, estado.segMods === 'mods' ? 'mods' : 'texturas'));
  $('btn-carpeta-capturas').addEventListener('click', () => llamar(quantum.abrirCarpeta, 'capturas'));
}

// ---------- Contenido remoto, actualizaciones y GIFs ----------
async function cargarContenido() {
  try { estado.contenido = await llamar(quantum.contenido); } catch { estado.contenido = null; }
  pintarFichaEvento(); pintarCalendario(); pintarPase(); pintarNormas(); pintarComunidad();
}
async function comprobarActualizacion() {
  try {
    const u = await llamar(quantum.actualizacion);
    if (u.hayNueva && u.instalada) aviso(t('packNuevo', { v: u.disponible }));
    if (u.launcherNuevo && u.launcherDescarga) aviso(t('launcherNuevo', { v: u.launcherVersion }), { texto: t('descargar'), accion: () => llamar(quantum.abrirEnlace, u.launcherDescarga) });
  } catch { /* sin conexión */ }
}
function ponerGifs(g) {
  const mapa = { 'gif-portada': 'portada', 'gif-progreso': 'progreso', 'gif-noticias': 'noticias', 'gif-cuentas': 'cuentas' };
  for (const [id, k] of Object.entries(mapa)) {
    const f = g && g[k];
    if (f) { $(id).src = `../../assets/gif/${f}`; $(id).classList.remove('oculto'); } else { $(id).removeAttribute('src'); if (id === 'gif-portada') $(id).classList.add('oculto'); }
  }
}

function repintarTodo() {
  pintarCuentas(); pintarNoticias(); pintarFichaEvento(); pintarCalendario(); pintarPase(); pintarNormas(); pintarComunidad();
  pintarTiempo(estado.init.stats || {}); pintarAcerca(estado.init.instalado); ponerIlustracion(); estadoServidor(); if (estado.mods) pintarMods();
  $('perfil-auto').textContent = t(estado.init.perfilAuto);
  if (!estado.jugando) { $('jugar-txt').textContent = t('jugar'); $('prog-etapa').textContent = estado.init.instalado ? t('listo') : t('primeraVez'); }
}

// ---------- Arranque ----------
(async () => {
  pintarIconos();
  $('skin-cuerpo').addEventListener('error', () => $('skin-cuerpo').removeAttribute('src'));
  $('win-min').addEventListener('click', () => quantum.ventana('minimizar'));
  $('win-max').addEventListener('click', () => quantum.ventana('maximizar'));
  $('win-cerrar').addEventListener('click', () => quantum.ventana('cerrar'));
  estado.init = await llamar(quantum.init);
  estado.cuentas = estado.init.cuentas;
  estado.ajustes = estado.init.ajustes;
  LANG = estado.ajustes.idioma || 'es';
  aplicarApariencia();
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (estado.ajustes.intro && estado.ajustes.animaciones && !reducido) {
    document.body.classList.add('con-intro');
    const quitar = () => document.body.classList.remove('con-intro');
    setTimeout(quitar, 2400);
    $('intro').addEventListener('click', quitar);
    addEventListener('keydown', quitar, { once: true });
  }
  traducir();
  document.title = estado.init.evento.nombre;
  $('ip-txt').textContent = estado.init.evento.ip;
  $('lema').textContent = (estado.init.evento.textos && estado.init.evento.textos.lema) || $('lema').textContent;
  ponerGifs(estado.init.evento.gifs);
  for (const b of $$('.riel-btn[data-pagina]')) b.addEventListener('click', () => irA(b.dataset.pagina));
  for (const b of $$('[data-pagina-ir]')) b.addEventListener('click', () => irA(b.dataset.paginaIr));
  $('ip').addEventListener('click', async () => { try { await navigator.clipboard.writeText(estado.init.evento.ip); aviso(t('ipCopiada')); sonar('ok'); } catch { /* */ } });
  $('rollo').addEventListener('click', () => abrirAjustes('personalizar'));
  $('cal-ant').addEventListener('click', () => { mesVista.setMonth(mesVista.getMonth() - 1); pintarCalendario(); });
  $('cal-sig').addEventListener('click', () => { mesVista.setMonth(mesVista.getMonth() + 1); pintarCalendario(); });
  $('jugar').addEventListener('click', () => jugar(false));
  configurarCuentas(); configurarAjustes(); configurarRegistro(); configurarSoporte(); configurarMods();
  repintarTodo();
  cargarNoticias(); cargarContenido(); comprobarActualizacion();
  setInterval(estadoServidor, 30000);
  setInterval(pintarFichaEvento, 60000);
  if (!estado.cuentas.length) setTimeout(() => $('dlg-cuentas').showModal(), estado.ajustes.intro ? 2300 : 200);
})();
