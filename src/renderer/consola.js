'use strict';
// Consola del juego en tiempo real (ventana aparte).
const $ = (id) => document.getElementById(id);
const log = $('log');
const MAX = 6000;
const cuenta = { todo: 0, info: 0, warn: 0, error: 0, launcher: 0 };
let filtro = 'todo';
let busca = '';

function nivel(l) {
  if (/\/(ERROR|FATAL)\]|\bException\b|^\s+at |Caused by:/.test(l)) return 'error';
  if (/\/WARN\]/.test(l)) return 'warn';
  if (/^\[\d{2}:\d{2}:\d{2}\] (?!\[)/.test(l) && !/\/(INFO|DEBUG)\]/.test(l)) return 'launcher';
  return 'info';
}
function visible(d) {
  const okF = filtro === 'todo' || d.dataset.n === filtro;
  const okB = !busca || d.textContent.toLowerCase().includes(busca);
  return okF && okB;
}
function pintarCuenta() {
  for (const k of Object.keys(cuenta)) $(`n-${k}`).textContent = cuenta[k];
  $('pie-lineas').textContent = `${cuenta.todo} líneas`;
  $('pie-err').textContent = cuenta.error ? `${cuenta.error} errores` : '';
}
let pendiente = [];
function agregar(l) { pendiente.push(l); if (pendiente.length === 1) requestAnimationFrame(volcar); }
function volcar() {
  const abajo = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  const frag = document.createDocumentFragment();
  for (const l of pendiente) {
    const n = nivel(l);
    const d = document.createElement('div');
    d.textContent = l; d.dataset.n = n; d.className = n === 'info' ? '' : n;
    if (!visible(d)) d.classList.add('oculto');
    cuenta.todo++; cuenta[n]++;
    frag.append(d);
  }
  pendiente = [];
  log.querySelector('.vacio')?.remove();
  log.append(frag);
  while (log.childElementCount > MAX) log.firstElementChild.remove();
  pintarCuenta();
  $('vivo').classList.add('on'); $('estado-juego').textContent = 'Juego en ejecución'; $('estado-juego').classList.add('on');
  clearTimeout(volcar.t); volcar.t = setTimeout(() => { $('vivo').classList.remove('on'); $('estado-juego').classList.remove('on'); $('estado-juego').textContent = 'En espera'; }, 8000);
  if ($('auto').checked && abajo) log.scrollTop = log.scrollHeight;
}
function refiltrar() { for (const d of log.children) if (d.dataset.n) d.classList.toggle('oculto', !visible(d)); }

for (const b of document.querySelectorAll('#filtros button')) {
  b.addEventListener('click', () => {
    filtro = b.dataset.f;
    for (const o of document.querySelectorAll('#filtros button')) o.setAttribute('aria-pressed', String(o === b));
    refiltrar();
  });
}
$('buscar').addEventListener('input', () => { busca = $('buscar').value.trim().toLowerCase(); refiltrar(); });
const texto = () => [...log.children].filter((d) => d.dataset.n && !d.classList.contains('oculto')).map((d) => d.textContent).join('\n');
$('copiar').addEventListener('click', () => navigator.clipboard.writeText(texto()));
$('guardar').addEventListener('click', () => quantum.guardarRegistro(texto()));
$('limpiar').addEventListener('click', () => { log.replaceChildren(); for (const k of Object.keys(cuenta)) cuenta[k] = 0; pintarCuenta(); });
$('w-min').addEventListener('click', () => quantum.ventana('minimizar'));
$('w-max').addEventListener('click', () => quantum.ventana('maximizar'));
$('w-cerrar').addEventListener('click', () => quantum.ventana('cerrar'));

const vacio = document.createElement('p'); vacio.className = 'vacio'; vacio.textContent = 'Pulsa Jugar en el launcher: aquí verás lo que hace el juego en tiempo real.';
log.append(vacio);
quantum.historialConsola().then((l) => { for (const x of l || []) agregar(x); }).catch(() => {});
quantum.on('log', agregar);
