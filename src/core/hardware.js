'use strict';
// Detecta el PC y propone memoria y gráficos para que el juego vaya fluido.
const os = require('os');

const MB = 1024 * 1024;

function detectar(gpu = {}) {
  const ramMB = Math.round(os.totalmem() / MB);
  const cpus = os.cpus() || [];
  const nucleos = cpus.length || 2;
  const cpu = cpus[0]?.model?.trim() || 'Desconocido';
  const gpuNombre = gpu.nombre || '';
  const integrada = /intel\(r\) (hd|uhd)|intel hd|intel uhd|vega [0-9] |radeon\(tm\) graphics|radeon graphics|mali|adreno|llvmpipe|swiftshader|microsoft basic/i.test(gpuNombre);
  return { ramMB, nucleos, cpu, gpu: gpuNombre || 'Desconocida', gpuIntegrada: integrada, sistema: `${os.type()} ${os.release()}`, arch: process.arch };
}

/** Límites del deslizador de RAM y valor recomendado (por defecto 4 GB). */
function limitesRam(ramTotalMB, { defectoMB = 4096, minimoMB = 3072 } = {}) {
  const reservaSistema = ramTotalMB <= 8192 ? 2048 : 3072;
  const max = Math.max(minimoMB, Math.floor((ramTotalMB - reservaSistema) / 512) * 512);
  const recomendado = Math.min(max, Math.max(minimoMB, ramTotalMB >= 16384 ? Math.max(defectoMB, 6144) : defectoMB));
  return { min: minimoMB, max: Math.min(max, 16384), recomendado, poca: ramTotalMB < minimoMB + 2048 };
}

const PERFILES = {
  bajo: { nombre: 'Bajo', renderDistance: 6, simulationDistance: 5, graphicsMode: 0, particles: 2, entityShadows: false, biomeBlendRadius: 0, maxFps: 60, ligero: true },
  medio: { nombre: 'Medio', renderDistance: 8, simulationDistance: 6, graphicsMode: 1, particles: 1, entityShadows: true, biomeBlendRadius: 1, maxFps: 120, ligero: false },
  alto: { nombre: 'Alto', renderDistance: 12, simulationDistance: 8, graphicsMode: 1, particles: 0, entityShadows: true, biomeBlendRadius: 2, maxFps: 144, ligero: false },
  ultra: { nombre: 'Ultra', renderDistance: 16, simulationDistance: 10, graphicsMode: 1, particles: 0, entityShadows: true, biomeBlendRadius: 3, maxFps: 260, ligero: false },
};

function perfilAuto(hw) {
  let p = 0;
  if (hw.ramMB >= 7000) p++; // PCs de "8 GB" reportan algo menos
  if (hw.ramMB >= 14000) p++;
  if (hw.nucleos >= 6) p++;
  if (hw.nucleos >= 10) p++;
  if (!hw.gpuIntegrada && hw.gpu !== 'Desconocida') p += 2;
  if (hw.ramMB < 6000 || hw.nucleos <= 2) return 'bajo';
  if (p <= 2) return 'bajo';
  if (p <= 3) return 'medio';
  if (p <= 5) return 'alto';
  return 'ultra';
}

/** Genera options.txt inicial (solo la primera vez: después el jugador manda). */
function optionsTxt(perfilId, base = {}) {
  const p = PERFILES[perfilId] || PERFILES.medio;
  const o = {
    version: 4440, // DataVersion de 1.21.8
    lang: base.lang || 'es_es',
    renderDistance: p.renderDistance,
    simulationDistance: p.simulationDistance,
    graphicsMode: p.graphicsMode,
    particles: p.particles,
    entityShadows: p.entityShadows,
    biomeBlendRadius: p.biomeBlendRadius,
    maxFps: p.maxFps,
    enableVsync: false,
    resourcePacks: JSON.stringify(base.resourcePacks || ['vanilla', 'fabric']),
    incompatibleResourcePacks: '[]',
    onboardAccessibility: false,
    skipMultiplayerWarning: true,
    joinedFirstServer: true,
    tutorialStep: 'none',
  };
  return `${Object.entries(o).map(([k, v]) => `${k}:${v}`).join('\n')}\n`;
}

module.exports = { detectar, limitesRam, PERFILES, perfilAuto, optionsTxt };
