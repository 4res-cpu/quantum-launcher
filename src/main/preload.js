'use strict';
// Puente seguro entre la interfaz y el proceso principal (la interfaz no tiene acceso a Node).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('quantum', {
  init: invoke('init'),
  noticias: invoke('noticias'),
  estadoServidor: invoke('servidor:estado'),
  actualizacion: invoke('actualizacion'),
  cuentaOffline: invoke('cuentas:offline'),
  cuentaMicrosoft: invoke('cuentas:microsoft'),
  seleccionarCuenta: invoke('cuentas:seleccionar'),
  eliminarCuenta: invoke('cuentas:eliminar'),
  guardarAjustes: invoke('ajustes:guardar'),
  aplicarPerfil: invoke('perfil:aplicar'),
  abrirCarpeta: invoke('carpeta:abrir'),
  abrirEnlace: invoke('enlace:abrir'),
  registro: invoke('registro'),
  guardarRegistro: invoke('registro:guardar'),
  instalarActualizacion: invoke('launcher:instalarActualizacion'),
  jugar: invoke('jugar'),
  ventana: (accion) => ipcRenderer.send('ventana', accion),
  on: (canal, fn) => {
    if (!['progreso', 'log', 'juego', 'launcher:update'].includes(canal)) return;
    ipcRenderer.on(canal, (_e, datos) => fn(datos));
  },
});
