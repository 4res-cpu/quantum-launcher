# Quantum Launcher

Launcher de Minecraft para el evento **The Maze Runner** del clan Quantum (1 de noviembre de 2026).
Un botón *Jugar* que instala Java 21, Minecraft 1.21.8, Fabric 0.19.5 y el modpack del evento, y entra
directamente al lobby `37.187.159.20:9175`. Cuentas premium (Microsoft) y no premium.

- Puesta en marcha paso a paso: [docs/INSTALACION.md](docs/INSTALACION.md)
- Guía para ti (publicar modpacks, noticias, versiones): [docs/GUIA-ORGANIZADOR.md](docs/GUIA-ORGANIZADOR.md)
- Guía para los jugadores: [docs/GUIA-JUGADORES.md](docs/GUIA-JUGADORES.md)
- Login premium y permiso de Microsoft: [docs/AZURE.md](docs/AZURE.md)
- Lista de pruebas en un PC real: [docs/PRUEBAS-EN-WINDOWS.md](docs/PRUEBAS-EN-WINDOWS.md)

## Qué hace

| Función | Dónde está |
| --- | --- |
| Login Microsoft (OAuth + PKCE → Xbox Live → XSTS → Minecraft Services), renovación automática, tokens cifrados | `src/core/accounts.js`, `src/main/main.js` |
| No premium con UUID offline estándar (`OfflinePlayer:<nombre>`) y validación del nombre | `src/core/accounts.js` |
| Varias cuentas guardadas | `AccountStore` en `src/core/accounts.js` |
| Descarga de Minecraft desde Mojang (manifiesto, librerías, assets, nativos) | `src/core/minecraft.js` |
| Fabric Loader desde `meta.fabricmc.net` | `src/core/minecraft.js` |
| Java 21 de Adoptium (Temurin) si el PC no lo tiene | `src/core/java.js` |
| Modpack `.mrpack`: hashes, overrides, borrado de mods retirados, respeto de opciones del jugador | `src/core/modpack.js` |
| Instancia aislada en `%APPDATA%\QuantumLauncher` (no toca `.minecraft`) | `src/core/launcher.js` |
| Entrar directo al lobby (`--quickPlayMultiplayer`) y lobby en `servers.dat` sin borrar los del jugador | `src/core/launcher.js`, `src/core/servers-dat.js` |
| Actualizaciones del modpack por manifiesto remoto; auto-actualización del launcher | `src/core/launcher.js`, `electron-updater` |
| RAM (4 GB por defecto, mínimo 3, máximo según el PC), resolución, pantalla completa | `src/core/hardware.js`, interfaz |
| Optimización según el PC: calidad gráfica automática y modo de bajos recursos | `src/core/hardware.js` |
| Reparar instalación, abrir carpeta, registro de errores con informe de crash | interfaz + `src/core/launcher.js` |
| Logo, fondo, noticias remotas, cuenta atrás, Discord, estado del lobby (ping de Minecraft) | `src/renderer/`, `src/core/status.js` |

### Por qué este diseño

El núcleo (`src/core/`) está escrito **sin dependencias** (solo Node). En vez de
`minecraft-launcher-core` + `msmc` se implementó el lanzamiento y el login directamente, por tres
motivos: son pocas piezas y bien documentadas; así se pudo **probar todo el flujo de punta a punta**
(ver *Pruebas*); y no depende de librerías que van por detrás de las versiones nuevas de Minecraft.
Electron solo pone la ventana. Las únicas dependencias son `electron`, `electron-builder` (compilar)
y `electron-updater` (auto-actualización).

## Compilar

Necesitas [Node.js 22](https://nodejs.org) y Git.

```bash
npm install
npm start               # abre el launcher en modo desarrollo
npm run dist:win        # Windows: instalador NSIS + portable en dist/
npm run dist:linux      # AppImage
npm run dist:mac        # dmg (hay que compilarlo en un Mac)
```

Lo más cómodo es dejar que **GitHub Actions** compile todo: sube una etiqueta `vX.Y.Z` y el workflow
`.github/workflows/compilar.yml` pasa las pruebas, compila Windows, Linux y macOS y publica la
*Release*. Los instaladores no están firmados (Windows SmartScreen avisará la primera vez; ver la
guía de jugadores). Si más adelante consigues un certificado de firma de código, electron-builder lo
usa con las variables `CSC_LINK` / `CSC_KEY_PASSWORD`.

Antes de la primera compilación cambia `TU_USUARIO` (en `evento.config.json`, `package.json` y
`quantum-datos/manifest.json`) y pon tu Client ID de Azure.

## Pruebas

```bash
npm test
```

- `test/e2e.js`: arranca servidores simulados de Mojang, Fabric, Modrinth, Adoptium y Microsoft/Xbox
  y un servidor de Minecraft falso (para el ping), y prueba en un "PC limpio": instalación desde cero
  (con descarga de Java), lanzar no premium y premium, login con PKCE, renovación de token, errores de
  Xbox, actualización 3.4.7 → 3.4.8 (descarga solo lo cambiado, borra mods retirados y ajenos, respeta
  `options.txt`, servidores y capturas del jugador), modo bajos recursos, reparación, crash, juego sin
  internet y estado del lobby. En lugar de Minecraft se lanza `test/fake/FakeMain.java`, que recibe
  exactamente los mismos argumentos y comprueba classpath, nativos, memoria y conexión directa.
- `test/electron-smoke.js`: arranca el proceso principal de Electron con un `electron` simulado y
  recorre lo que hace la interfaz (init, cuentas, ajustes, Jugar).

Lo que estas pruebas **no** cubren (porque necesitan internet real, una cuenta comprada y Windows) está
en [docs/PRUEBAS-EN-WINDOWS.md](docs/PRUEBAS-EN-WINDOWS.md).

## Estructura

```text
evento.config.json      datos del evento (servidor, fecha, Discord, URLs, Client ID, RAM…)
assets/                 fondo, logos e icono
src/core/               núcleo sin dependencias (probado)
src/main/               proceso principal de Electron y preload
src/renderer/           interfaz (HTML/CSS/JS)
tools/publicar-modpack.js  genera el manifiesto de una versión nueva del modpack
quantum-datos/          plantilla del repositorio de datos: manifest.json + noticias.json
test/                   pruebas y servicios simulados
docs/                   guías
```

## Avisos

- El launcher no incluye ni redistribuye archivos de Minecraft: todo se descarga de Mojang en el PC
  del jugador.
- El `.mrpack` 3.4.7 trae un `servers.dat` con la IP antigua `pruebasquantum.joinsrv.xyz`. El launcher
  lo ignora, pone el lobby `37.187.159.20:9175` y borra esa IP vieja de la lista del jugador.
- Los fondos están en `assets/fondos/`.
