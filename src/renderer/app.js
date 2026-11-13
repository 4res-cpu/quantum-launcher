'use strict';
/* global quantum */
// Interfaz del launcher. Todo el texto que viene de internet se pinta con textContent (nunca innerHTML).
const $ = (id) => document.getElementById(id);
const estado = { init: null, cuentas: [], ajustes: null, jugando: false, logBuffer: [] };

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

function aviso(texto, boton) {
  const a = $('aviso');
  a.replaceChildren(el('span', {}, texto));
  if (boton) a.append(el('button', { type: 'button', onclick: boton.accion }, boton.texto));
  a.append(el('button', { type: 'button', 'aria-label': 'Cerrar aviso', onclick: () => a.classList.add('oculto') }, '✕'));
  a.classList.remove('oculto');
}

const mb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} GB` : `${n} MB`);
const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ---------- Cuenta atrás ----------
function iniciarCuentaAtras(fechaIso) {
  const fecha = new Date(fechaIso);
  const f = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(fecha);
  $('ca-fecha').textContent = `${f.charAt(0).toUpperCase()}${f.slice(1)}`;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const ms = fecha - Date.now();
    if (ms <= 0) {
      $('cuenta-atras').classList.add('en-marcha');
      $('ca-texto').textContent = TX.abierto || 'El servidor está abierto';
      return;
    }
    const s = Math.floor(ms / 1000);
    $('ca-d').textContent = pad(Math.floor(s / 86400));
    $('ca-h').textContent = pad(Math.floor((s % 86400) / 3600));
    $('ca-m').textContent = pad(Math.floor((s % 3600) / 60));
    $('ca-s').textContent = pad(s % 60);
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- Modalidades (selector tipo menú de juego) ----------
function pintarModos(modos) {
  const caja = $('modos'), det = $('modo-detalle');
  let sel = Math.max(0, modos.findIndex((m) => m.estado === 'abierto'));
  const filas = modos.map((m, i) => {
    const abierto = m.estado === 'abierto';
    const f = el('button', { type: 'button', class: `modo ${abierto ? 'abierto' : 'pronto'}`, role: 'option' },
      el('span', { class: 'modo-cursor' }), el('b', {}, m.nombre),
      el('span', { class: 'modo-estado' }, abierto ? 'Abierto' : 'Pronto'));
    f.style.setProperty('--i', i);
    f.addEventListener('mouseenter', () => elegir(i));
    f.addEventListener('focus', () => elegir(i));
    return f;
  });
  function elegir(i) {
    sel = i;
    filas.forEach((f, k) => { f.classList.toggle('activo', k === i); f.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    const m = modos[i], abierto = m.estado === 'abierto';
    det.classList.remove('entra'); void det.offsetWidth; det.classList.add('entra');
    det.replaceChildren(
      el('span', { class: 'det-num' }, String(i + 1).padStart(2, '0')),
      el('b', {}, m.nombre), el('p', {}, m.desc || ''),
      el('span', { class: `det-estado ${abierto ? 'abierto' : ''}` }, abierto ? 'Disponible ahora · pulsa JUGAR' : 'En construcción'));
  }
  caja.replaceChildren(...filas);
  caja.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); const n = (sel + (e.key === 'ArrowDown' ? 1 : -1) + filas.length) % filas.length; filas[n].focus();
  });
  if (filas.length) elegir(sel);
}

// ---------- Campo cuántico (fondo vivo) ----------
function campoCuantico() {
  const c = $('campo'); if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = c.getContext('2d'); let w = 0, h = 0, raton = { x: 0.5, y: 0.5 }, t0 = performance.now();
  const N = 54, P = Array.from({ length: N }, (_, i) => ({ r: 0.12 + Math.random() * 0.55, a: Math.random() * 6.283, v: (0.02 + Math.random() * 0.05) * (i % 2 ? 1 : -1), e: 0.35 + Math.random() * 0.4, inc: Math.random() * 3.14, s: 0.6 + Math.random() * 1.8, salto: Math.random() * 400 }));
  const medir = () => { w = c.width = innerWidth; h = c.height = innerHeight; };
  medir(); addEventListener('resize', medir);
  addEventListener('pointermove', (e) => { raton.x += (e.clientX / w - raton.x) * 0.08; raton.y += (e.clientY / h - raton.y) * 0.08; });
  const paso = (ahora) => {
    const t = (ahora - t0) / 1000; g.clearRect(0, 0, w, h);
    const cx = w * (0.62 + (raton.x - 0.5) * 0.05), cy = h * (0.46 + (raton.y - 0.5) * 0.05), R = Math.min(w, h) * 0.62, pts = [];
    for (const p of P) {
      p.salto -= 1; if (p.salto < 0) { p.r = 0.12 + Math.random() * 0.55; p.salto = 300 + Math.random() * 500; p.flash = 1; }
      const a = p.a + t * p.v * 6, x0 = Math.cos(a) * p.r * R, y0 = Math.sin(a) * p.r * R * p.e;
      const x = cx + x0 * Math.cos(p.inc) - y0 * Math.sin(p.inc), y = cy + x0 * Math.sin(p.inc) + y0 * Math.cos(p.inc);
      p.flash = (p.flash || 0) * 0.94; pts.push([x, y, p]);
    }
    g.lineWidth = 1;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], d = dx * dx + dy * dy;
      if (d < 12000) { g.strokeStyle = `rgba(199,125,255,${(1 - d / 12000) * 0.22})`; g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[j][0], pts[j][1]); g.stroke(); }
    }
    for (const [x, y, p] of pts) {
      g.fillStyle = `rgba(233,213,255,${0.35 + p.flash * 0.65})`; g.beginPath(); g.arc(x, y, p.s + p.flash * 3, 0, 6.283); g.fill();
      if (p.flash > 0.05) { g.strokeStyle = `rgba(199,125,255,${p.flash * 0.6})`; g.beginPath(); g.arc(x, y, 6 + (1 - p.flash) * 26, 0, 6.283); g.stroke(); }
    }
    requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ---------- Cuentas ----------
function cara(c, nodo) {
  nodo.replaceChildren();
  nodo.style.backgroundImage = '';
  if (!c) { nodo.textContent = '+'; return; }
  nodo.textContent = c.nombre.charAt(0).toUpperCase();   // se ve si la cara no carga (sin internet)
  // cara de la skin: premium por UUID; no premium por nombre (la ponen SkinRestorer/el servidor)
  const url = `https://mc-heads.net/avatar/${encodeURIComponent(c.tipo === 'microsoft' ? c.uuid : c.nombre)}/96`;
  const img = new Image();
  img.onload = () => { nodo.textContent = ''; nodo.style.backgroundImage = `url("${url}")`; };
  img.src = url;
}

function pintarCuentas() {
  const activa = estado.cuentas.find((c) => c.activa);
  $('cuenta-nombre').textContent = activa ? activa.nombre : 'Añadir cuenta';
  $('cuenta-tipo').textContent = activa ? (activa.tipo === 'microsoft' ? 'Premium (Microsoft)' : 'No premium') : 'Premium o no premium';
  cara(activa, $('cuenta-cara'));
  const ul = $('lista-cuentas');
  ul.replaceChildren();
  if (!estado.cuentas.length) ul.append(el('li', { class: 'vacia' }, 'Añade una cuenta para jugar.'));
  for (const c of estado.cuentas) {
    const caraNodo = el('span', { class: 'cuenta-cara', 'aria-hidden': 'true' });
    cara(c, caraNodo);
    ul.append(el('li', { class: c.activa ? 'activa' : '' },
      caraNodo,
      el('span', { class: 'datos' }, el('b', {}, c.nombre), el('span', {}, c.tipo === 'microsoft' ? 'Premium (Microsoft)' : 'No premium')),
      el('button', { class: 'usar', type: 'button', disabled: c.activa, onclick: () => usarCuenta(c.id) }, c.activa ? 'En uso' : 'Usar'),
      el('button', { class: 'quitar', type: 'button', 'aria-label': `Quitar ${c.nombre}`, onclick: () => quitarCuenta(c) }, 'Quitar')));
  }
}

async function usarCuenta(id) { estado.cuentas = await llamar(quantum.seleccionarCuenta, id); pintarCuentas(); $('dlg-cuentas').close(); }
async function quitarCuenta(c) {
  if (!confirm(`¿Quitar la cuenta ${c.nombre} de este launcher?`)) return;
  estado.cuentas = await llamar(quantum.eliminarCuenta, c.id); pintarCuentas();
}

function configurarCuentas() {
  $('cuenta-chip').addEventListener('click', () => $('dlg-cuentas').showModal());
  $('btn-ms').addEventListener('click', async () => {
    const b = $('btn-ms'); b.disabled = true; $('offline-error').textContent = '';
    try {
      estado.cuentas = await llamar(quantum.cuentaMicrosoft);
      pintarCuentas(); $('dlg-cuentas').close();
    } catch (e) { $('offline-error').textContent = e.message; } finally { b.disabled = false; $('ms-codigo').hidden = true; }
  });
  // 1.1.4: inicio de sesión con código (en el navegador normal)
  let codigoMs = null;
  quantum.on('cuentas:codigo', (d) => {
    codigoMs = d;
    $('ms-codigo').hidden = !d;
    if (d) { $('ms-num').textContent = d.codigo; $('ms-estado').textContent = 'Esperando a que aceptes en el navegador… esta ventana se actualiza sola.'; }
  });
  $('ms-abrir').addEventListener('click', () => { if (codigoMs) quantum.abrirEnlace(`https://www.microsoft.com/link?otc=${encodeURIComponent(codigoMs.codigo)}`); });
  $('ms-copiar').addEventListener('click', async () => {
    if (!codigoMs) return;
    try { await navigator.clipboard.writeText(codigoMs.codigo); $('ms-estado').textContent = 'Código copiado. Pégalo en la página de Microsoft.'; } catch { /* */ }
  });
  $('ms-cancelar').addEventListener('click', () => { quantum.cancelarMicrosoft(); $('ms-estado').textContent = 'Cancelando…'; });
  const input = $('nombre-offline');
  input.addEventListener('input', () => { input.value = input.value.replace(/[^A-Za-z0-9_]/g, ''); $('offline-error').textContent = ''; });
  $('form-offline').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      estado.cuentas = await llamar(quantum.cuentaOffline, input.value);
      input.value = ''; pintarCuentas(); $('dlg-cuentas').close();
    } catch (e) { $('offline-error').textContent = e.message; }
  });
}

// ---------- Ajustes ----------
function leerModulos() {
  const o = {};
  for (const i of document.querySelectorAll('#modulos input[data-mod]')) o[i.dataset.mod] = i.checked;
  return o;
}
function configurarAjustes() {
  const { ram, hw, perfilAuto } = estado.init;
  const a = estado.ajustes;
  const r = $('ram');
  r.min = ram.min; r.max = ram.max; r.value = a.ramMB;
  const pintarRam = () => {
    $('ram-valor').textContent = mb(Number(r.value));
    $('ram-ayuda').textContent = `Recomendado: ${mb(ram.recomendado)} · Tu equipo: ${mb(hw.ramMB)}${ram.poca ? ' · Cierra otros programas antes de jugar.' : ''}`;
  };
  pintarRam();
  r.addEventListener('input', pintarRam);
  $('ancho').value = a.ancho; $('alto').value = a.alto;
  $('pantalla-completa').checked = !!a.pantallaCompleta;
  $('perfil').value = a.perfil || 'auto';
  const nombres = { bajo: 'baja', medio: 'media', alto: 'alta', ultra: 'ultra' };
  $('perfil').options[0].textContent = `Automática (${nombres[perfilAuto]} para tu PC)`;
  $('modo-ligero').checked = a.modoLigero ?? perfilAuto === 'bajo';
  $('cerrar-al-jugar').checked = !!a.cerrarAlJugar;
  $('modo-seguro').checked = !!a.modoSeguro;
  $('pc-info').textContent = `${hw.cpu} · ${hw.gpu}`;

  const guardar = async () => {
    estado.ajustes = await llamar(quantum.guardarAjustes, {
      ramMB: Number(r.value), ancho: Number($('ancho').value), alto: Number($('alto').value),
      pantallaCompleta: $('pantalla-completa').checked, perfil: $('perfil').value,
      modoLigero: $('modo-ligero').checked, modoSeguro: $('modo-seguro').checked, cerrarAlJugar: $('cerrar-al-jugar').checked,
      modulos: leerModulos(),
    });
  };
  for (const id of ['ram', 'ancho', 'alto', 'pantalla-completa', 'perfil', 'modo-ligero', 'modo-seguro', 'cerrar-al-jugar']) $(id).addEventListener('change', guardar);
  // Módulos opcionales
  const lista = estado.init.evento.modulos || [];
  const cont = $('modulos');
  const contar = () => { $('mod-cuenta').textContent = lista.length ? `${cont.querySelectorAll('input:checked').length} de ${lista.length} activos.` : ''; };
  for (const m of lista) {
    const inp = el('input', { type: 'checkbox' }); inp.dataset.mod = m.id;
    inp.checked = (a.modulos || {})[m.id] ?? m.defecto;
    inp.addEventListener('change', () => { contar(); guardar(); });
    const txt = el('span', {}, m.nombre, el('small', {}, m.desc || ''));
    cont.append(el('label', { class: 'interruptor modulo' }, inp, el('span', { class: 'sw' }), txt));
  }
  contar();
  if (!lista.length) { document.querySelector('.pestanas [data-tab="modulos"]').hidden = true; $('btn-modulos').hidden = true; }
  $('btn-ajustes').addEventListener('click', () => $('dlg-ajustes').showModal());
  $('btn-modulos').addEventListener('click', () => { $('dlg-ajustes').showModal(); document.querySelector('.pestanas [data-tab="modulos"]').click(); });
  const tabs = [...document.querySelectorAll('.pestanas [data-tab]')];
  for (const t of tabs) {
    t.addEventListener('click', () => {
      for (const o of tabs) o.setAttribute('aria-selected', String(o === t));
      for (const sec of document.querySelectorAll('.panel-cuerpo [data-panel]')) sec.hidden = sec.dataset.panel !== t.dataset.tab;
    });
  }
  $('btn-optimizar').addEventListener('click', async () => {
    try {
      const p = await llamar(quantum.aplicarPerfil, $('perfil').value);
      aviso(`Calidad gráfica ${nombres[p]} aplicada.`);
    } catch (e) { aviso(e.message); }
  });
  $('btn-reparar').addEventListener('click', () => { $('dlg-ajustes').close(); jugar(true); });
  $('btn-carpeta').addEventListener('click', () => llamar(quantum.abrirCarpeta));
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
  $('btn-registro').addEventListener('click', () => { $('dlg-ajustes').close(); abrirRegistro(); });
  $('btn-copiar').addEventListener('click', () => navigator.clipboard.writeText($('registro').textContent));
  $('btn-guardar-reg').addEventListener('click', () => llamar(quantum.guardarRegistro, $('registro').textContent));
  quantum.on('log', (l) => {
    estado.logBuffer.push(l);
    if (estado.logBuffer.length > 3000) estado.logBuffer.splice(0, 500);
  });
}

// ---------- Progreso y jugar ----------
const ETAPAS = { cuenta: 'Cuenta', manifiesto: 'Actualizaciones', java: 'Java', minecraft: 'Minecraft', modpack: 'Modpack', juego: 'Juego', listo: 'Listo' };
function progreso(p) {
  $('prog-etapa').textContent = p.texto || ETAPAS[p.etapa] || '';
  const rel = $('prog-relleno');
  if (p.total) {
    rel.classList.remove('indet');
    rel.style.width = `${Math.min(100, (p.actual / p.total) * 100).toFixed(1)}%`;
    $('prog-detalle').textContent = p.bytes ? `${bytes(p.actual)} de ${bytes(p.total)}` : `${p.actual} de ${p.total}`;
  } else {
    rel.classList.add('indet'); rel.style.width = '';
    $('prog-detalle').textContent = '';
  }
}
function finProgreso(texto) {
  const rel = $('prog-relleno');
  rel.classList.remove('indet'); rel.style.width = '0';
  $('prog-etapa').textContent = texto; $('prog-detalle').textContent = '';
}

function botonJugar(texto, ocupado) {
  const b = $('jugar');
  $('jugar-txt').textContent = texto; b.disabled = ocupado; b.classList.toggle('ocupado', ocupado);
}

// Modo seguro: pregunta si iniciar sin paquetes de texturas
function elegirTexturas() {
  return new Promise((resolve) => {
    const d = $('dlg-seguro');
    const fin = (v) => { d.removeEventListener('close', cerrar); $('seguro-sin').onclick = null; $('seguro-normal').onclick = null; if (d.open) d.close(); resolve(v); };
    const cerrar = () => fin(null);
    $('seguro-sin').onclick = () => fin(true);
    $('seguro-normal').onclick = () => fin(false);
    d.addEventListener('close', cerrar);
    d.showModal();
  });
}

async function jugar(reparar = false) {
  if (estado.jugando) return;
  if (!estado.cuentas.some((c) => c.activa)) { $('dlg-cuentas').showModal(); return; }
  let sinTexturas = false;
  if (estado.ajustes?.modoSeguro) {
    sinTexturas = await elegirTexturas();
    if (sinTexturas === null) return;
  }
  estado.jugando = true;
  botonJugar(reparar ? 'Reparando…' : 'Preparando…', true);
  try {
    const r = await llamar(quantum.jugar, { reparar, sinTexturas });
    $('version').textContent = textoVersion(r.packVersion);
  } catch (e) {
    finProgreso('No se pudo iniciar');
    if (e.reLogin) { aviso(e.message, { texto: 'Iniciar sesión', accion: () => $('dlg-cuentas').showModal() }); } else abrirRegistro(e.message);
  } finally {
    estado.jugando = false;
    botonJugar('Jugar', false);
  }
}

function textoVersion(pack) {
  const t = `Versión ${pack || '-'}\nLauncher ${estado.init.version}`;
  const a = $('acerca-version');
  if (a) a.textContent = `Quantum Launcher ${estado.init.version}${estado.init.portable ? ' (portable)' : ''} · Modpack ${pack || '-'}`;
  return t;
}

quantum.on('progreso', progreso);
quantum.on('juego', (j) => {
  if (j.estado === 'abierto') { botonJugar('En juego', true); finProgreso(TX.suerte || '¡Suerte!'); }
  if (j.estado === 'cerrado') {
    finProgreso('Listo para jugar');
    if (j.fallo) {
      let resumen = 'El juego se cerró inesperadamente.';
      if (/OutOfMemoryError/.test(j.log + (j.crash?.texto || ''))) resumen += ' Falta memoria: sube la RAM en Ajustes o activa el modo bajo consumo.';
      else if (/GLFW error|OpenGL|Pixel format not accelerated/i.test(j.log)) resumen += ' Actualiza los drivers de tu tarjeta gráfica.';
      else resumen += ' Si se repite, guarda este informe y envíalo al staff por Discord.';
      if (j.crash?.texto) estado.logBuffer.push('----- Informe de error de Minecraft -----', j.crash.texto);
      abrirRegistro(resumen);
      if (!estado.ajustes?.modoSeguro) {
        aviso('Si el juego se cierra mientras carga, prueba el modo seguro.', { texto: 'Activar', accion: async () => {
          estado.ajustes = await llamar(quantum.guardarAjustes, { modoSeguro: true });
          $('modo-seguro').checked = true;
          aviso('Modo seguro activado. Pulsa Jugar para elegir cómo iniciar.');
        } });
      }
    }
  }
});
quantum.on('launcher:update', (u) => {
  if (u.estado === 'descargando') aviso(`Descargando actualización ${u.version}…`);
  if (u.estado === 'listo') aviso(`Actualización ${u.version} lista.`, { texto: 'Reiniciar', accion: () => llamar(quantum.instalarActualizacion) });
});

// ---------- Noticias y estado del servidor ----------
async function cargarNoticias() {
  const ol = $('noticias');
  try {
    const n = await llamar(quantum.noticias);
    const lista = Array.isArray(n) ? n : n.noticias || [];
    ol.replaceChildren();
    if (!lista.length) { ol.append(el('li', { class: 'noticia vacia' }, 'Sin noticias por ahora.')); return; }
    for (const x of lista.slice(0, 20)) {
      let fecha = '';
      if (x.fecha) { const d = new Date(`${x.fecha}${x.fecha.length === 10 ? 'T12:00:00' : ''}`); if (!Number.isNaN(+d)) fecha = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(d); }
      const li = el('li', { class: `noticia${x.destacada ? ' destacada-n' : ''}` },
        el('h3', {}, x.titulo || ''),
        fecha ? el('time', { datetime: x.fecha }, fecha) : null,
        x.imagen && /^https:\/\//.test(x.imagen) ? el('img', { src: x.imagen, alt: '' }) : null,
        el('p', {}, x.texto || ''),
        x.enlace && /^https:\/\//.test(x.enlace) ? el('button', { class: 'enlace', type: 'button', onclick: () => llamar(quantum.abrirEnlace, x.enlace) }, x.textoEnlace || 'Ver más') : null);
      ol.append(li);
    }
    const top = lista.find((x) => x.destacada) || lista[0];
    if (top && top.titulo) {
      $('destacada-titulo').textContent = top.titulo;
      $('destacada').classList.remove('oculto');
      $('noticias-punto').classList.remove('oculto');
    }
  } catch { ol.replaceChildren(el('li', { class: 'noticia vacia' }, 'No se pudieron cargar las noticias.')); }
}

async function estadoServidor() {
  try {
    const s = await llamar(quantum.estadoServidor);
    $('led').className = `led ${s.online ? 'on' : 'off'}`;
    $('srv-nombre').textContent = s.online ? 'Jugadores' : 'Servidor';
    $('srv-jug').textContent = s.online ? s.jugadores : 'OFF';
    $('srv-max').textContent = s.online ? `/${s.max}` : '';
    $('estado-txt').textContent = s.online ? `${estado.init.evento.servidor} · ${s.latencia} ms` : `${estado.init.evento.servidor} fuera de línea`;
  } catch {
    $('led').className = 'led off'; $('srv-nombre').textContent = 'Servidor'; $('srv-jug').textContent = '--'; $('srv-max').textContent = '';
    $('estado-txt').textContent = 'No se pudo comprobar el servidor';
  }
}

async function comprobarActualizacion() {
  try {
    const u = await llamar(quantum.actualizacion);
    if (u.hayNueva && u.instalada) aviso(`Nueva versión del modpack (${u.disponible}). Se instala al pulsar Jugar.${u.nota ? ` ${u.nota}` : ''}`);
    if (u.launcherNuevo && u.launcherDescarga) aviso(`Nueva versión del launcher (${u.launcherVersion}).`, { texto: 'Descargar', accion: () => llamar(quantum.abrirEnlace, u.launcherDescarga) });
  } catch { /* sin conexión: se avisa al jugar */ }
}

// ---------- Fondo que va cambiando ----------
let TX = {};
const FONDOS = ['arte-1.jpg', 'arte-2.jpg', 'arte-3.jpg'];
function iniciarFondos(lista) {
  const cont = $('fondos');
  const diapos = (lista && lista.length ? lista : FONDOS).map((f) => {
    const d = el('div', { class: 'diapo' });
    d.style.backgroundImage = `url("../../assets/fondos/${f}")`;
    cont.append(d);
    return d;
  });
  let i = 0;
  const mostrar = () => {
    diapos.forEach((d, k) => {
      if (k === i) { d.classList.remove('activa'); void d.offsetWidth; d.classList.add('activa'); } else d.classList.remove('activa');
    });
  };
  mostrar();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => { i = (i + 1) % diapos.length; mostrar(); }, 10000);
}

// ---------- Textos, logo y gifs del evento (evento.config.json) ----------
function aplicarTextos(ev) {
  TX = ev.textos || {};
  const poner = (id, t) => { if (t && $(id)) $(id).textContent = t; };
  poner('t-marca', TX.marca || ev.evento);
  poner('t-lema1', TX.lema1); poner('t-lema2', TX.lema2);
  poner('ca-texto', TX.cuentaAtras);
  poner('t-noticias-sub', TX.noticiasSub);
  poner('t-cuentas-sobre', TX.cuentasSobre); poner('t-cuentas-sub', TX.cuentasSub);
  if (ev.logo) { $('logo-evento').src = `../../assets/${ev.logo}`; $('logo-evento').alt = ev.evento; }
  const G = { corre: 'progreso', 'gif-noticias': 'noticias', 'gif-cuentas': 'cuentas' };
  for (const id of Object.keys(G)) {
    if (!$(id)) continue;
    const f = ev.gifs && typeof ev.gifs === 'object' ? ev.gifs[G[id]] : null;
    if (f) $(id).src = `../../assets/gif/${f}`; else if (ev.gifs === false || (ev.gifs && typeof ev.gifs === 'object')) $(id).style.display = 'none';
  }
}

// ---------- Cajón de noticias, galería y menú lateral ----------
function cajon(abrir) {
  $('cajon').classList.toggle('abierto', abrir);
  $('cajon-fondo').classList.toggle('abierto', abrir);
  $('cajon').setAttribute('aria-hidden', String(!abrir));
  if (abrir) $('noticias-punto').classList.add('oculto');
}
function configurarMenus() {
  $('btn-noticias').addEventListener('click', () => cajon(true));
  $('destacada').addEventListener('click', () => cajon(true));
  $('cajon-cerrar').addEventListener('click', () => cajon(false));
  $('cajon-fondo').addEventListener('click', () => cajon(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cajon(false); });
  $('win-max').addEventListener('click', () => quantum.ventana('maximizar'));
  $('estado-srv').addEventListener('click', estadoServidor);
}

// ---------- Arranque ----------
(async () => {
  $('win-min').addEventListener('click', () => quantum.ventana('minimizar'));
  $('win-cerrar').addEventListener('click', () => quantum.ventana('cerrar'));
  estado.init = await llamar(quantum.init);
  estado.cuentas = estado.init.cuentas;
  estado.ajustes = estado.init.ajustes;
  document.title = estado.init.evento.nombre === estado.init.evento.evento ? estado.init.evento.nombre : `${estado.init.evento.nombre}: ${estado.init.evento.evento}`;
  aplicarTextos(estado.init.evento);
  iniciarFondos(estado.init.evento.fondos);
  $('version').textContent = textoVersion(estado.init.instalado);
  if (estado.init.evento.fechaEvento) { $('cuenta-atras').classList.remove('oculto'); iniciarCuentaAtras(estado.init.evento.fechaEvento); }
  pintarModos(estado.init.evento.modos || []);
  campoCuantico();
  pintarCuentas();
  configurarCuentas();
  configurarAjustes();
  configurarRegistro();
  configurarMenus();
  $('discord').addEventListener('click', () => llamar(quantum.abrirEnlace, estado.init.evento.discord));
  $('jugar').addEventListener('click', () => jugar(false));
  if (!estado.init.instalado) $('prog-etapa').textContent = 'Primera instalación: aprox. 1 GB';
  cargarNoticias();
  estadoServidor();
  setInterval(estadoServidor, 30000);
  comprobarActualizacion();
  if (!estado.cuentas.length) $('dlg-cuentas').showModal();
})();
