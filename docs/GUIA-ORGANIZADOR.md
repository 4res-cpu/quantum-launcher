# Guía del organizador

Todo lo que tienes que hacer para mantener el launcher durante el evento.

## Cómo está montado

Hay **dos repositorios de GitHub** (los dos públicos):

| Repositorio | Qué contiene | Quién lo cambia |
| --- | --- | --- |
| `quantum-launcher` | El código del launcher. Sus *Releases* son los instaladores `.exe`. | Tú, solo si cambias el launcher. |
| `quantum-datos` | `manifest.json` (versión del modpack), `noticias.json` y, en sus *Releases*, los `.mrpack`. | Tú, cada vez que publiques un modpack o una noticia. |

El launcher, al abrirse, lee `manifest.json` y `noticias.json` de `quantum-datos`. Por eso puedes
actualizar el modpack y las noticias **sin volver a compilar ni redistribuir el launcher**.

Se separan en dos repositorios para que las versiones del modpack no se mezclen con las del launcher
(el actualizador automático del launcher mira la última *Release* de `quantum-launcher`).

### Puesta en marcha (una sola vez)

1. Crea el repositorio `quantum-datos` y sube el contenido de la carpeta `quantum-datos/` de este
   proyecto.
2. En `quantum-datos` → **Releases** → **Draft a new release** → etiqueta `modpack-3.4.7` → adjunta
   `Eventos_Quantum_3.4.7.mrpack` (sin espacios en el nombre) → **Publish release**.
3. Cambia `TU_USUARIO` por tu usuario de GitHub en:
   - `evento.config.json` (las dos `urls`)
   - `package.json` (`build.publish.owner`)
   - `quantum-datos/manifest.json` (las dos URL)
4. Pega tu Client ID de Azure en `evento.config.json` (ver [AZURE.md](AZURE.md)).
5. Sube este proyecto al repositorio `quantum-launcher` y publica la primera versión:
   `git tag v1.0.0 && git push origin v1.0.0`. GitHub Actions compila el instalador, la versión
   portable, Linux y macOS, y los deja en *Releases* (tarda unos 10 minutos).
6. Comparte con los jugadores el enlace `https://github.com/TU_USUARIO/quantum-launcher/releases/latest`.

## Publicar una versión nueva del modpack (lo que harás más a menudo)

1. **Exporta el modpack** desde la Modrinth App: tu instancia → menú ⋮ → *Export modpack* → pon la
   versión (por ejemplo `3.4.8`) → guarda el `.mrpack`. Cámbiale el nombre para que no tenga espacios:
   `Eventos_Quantum_3.4.8.mrpack`.
2. **Súbelo a GitHub:** `quantum-datos` → Releases → *Draft a new release* → etiqueta `modpack-3.4.8`
   → arrastra el `.mrpack` → *Publish release*. Después haz clic derecho sobre el archivo en la release
   → *Copiar dirección del enlace*.
3. **Actualiza el manifiesto** con la herramienta (necesitas Node.js instalado):

   ```bat
   node tools\publicar-modpack.js Eventos_Quantum_3.4.8.mrpack --version 3.4.8 ^
     --url https://github.com/TU_USUARIO/quantum-datos/releases/download/modpack-3.4.8/Eventos_Quantum_3.4.8.mrpack ^
     --manifest ..\quantum-datos\manifest.json --nota "Arreglado el portón del sector 7"
   ```

   La herramienta calcula el tamaño y los hashes del archivo y te avisa si el paquete trae algo raro.
4. **Sube `manifest.json`** al repositorio `quantum-datos` (commit + push, o súbelo desde la web de
   GitHub con *Add file → Upload files*).

Listo. Cada jugador recibe la actualización la próxima vez que abra el launcher o pulse *Jugar*.
GitHub puede tardar hasta 5 minutos en servir el `manifest.json` nuevo.

### Sin Node.js (desde la web de GitHub)

Puedes editar `manifest.json` en la web: cambia `version` y `url`, y **borra** las líneas `size`, `sha1`
y `sha512`. Si dejas los hashes de la versión anterior, la descarga fallará para todos con el error
*"llegó dañado"*. Con la herramienta es más seguro, porque el launcher comprueba que el archivo no se
corrompió por el camino.

### Qué hace el launcher al actualizar

- Descarga solo los archivos que cambiaron (compara hashes).
- Borra los mods que ya no están en el modpack, y también cualquier `.jar` que el jugador haya metido
  por su cuenta en `mods/` (así nadie entra con mods no permitidos).
- `mods/`, `resourcepacks/` y `shaderpacks/` quedan siempre idénticos al modpack.
- `config/`: solo sobrescribe un archivo si **tú** lo cambiaste en la versión nueva. Si el jugador
  ajustó algo que tú no tocaste, se respeta.
- **Nunca** toca `options.txt`, `servers.dat` (solo se asegura de que el lobby esté el primero),
  `saves/`, `screenshots/` ni `logs/`.
- La versión de Minecraft y de Fabric salen del propio `.mrpack`: si un día pasas a 1.21.9, basta con
  exportar el `.mrpack` nuevo.

## Noticias

Edita `noticias.json` en `quantum-datos` (se puede hacer desde la web de GitHub, con el lápiz):

```json
{
  "noticias": [
    {
      "titulo": "Ensayo general",
      "fecha": "2026-10-25",
      "destacada": true,
      "texto": "Sábado 25: 8:00 p. m. en Colombia, 3:00 a. m. del domingo en España.",
      "enlace": "https://discord.gg/srGGsHJug8",
      "textoEnlace": "Ver en Discord",
      "imagen": "https://…/cartel.png"
    }
  ]
}
```

Solo `titulo` y `texto` son obligatorios. `destacada` la pinta en ámbar. `enlace` e `imagen` tienen
que empezar por `https://`. Se muestran en el orden del archivo (pon la más nueva arriba).

## Actualizar el propio launcher

1. Cambia lo que necesites y sube el número de `version` en `package.json` (por ejemplo `1.0.1`).
2. `git tag v1.0.1 && git push origin v1.0.1`.
3. GitHub Actions compila y publica. Los que usan el **instalador** reciben la actualización solos
   (se descarga en segundo plano y les sale "Reiniciar y actualizar").
4. Para avisar a los que usan la **versión portable**, sube `launcher.version` a `1.0.1` en
   `quantum-datos/manifest.json`. Les aparece un aviso con el botón *Descargar*.

## Cambiar datos del evento

Todo está en `evento.config.json` (hace falta compilar una versión nueva del launcher):

| Campo | Para qué |
| --- | --- |
| `servidor.host` / `servidor.puerto` | Lobby al que se conecta *Jugar* (`37.187.159.20:9175`). |
| `servidor.nombre` | Nombre en la lista de Multijugador (admite códigos de color `§`). |
| `servidoresAntiguos` | IPs viejas que se quitan de la lista del jugador (ahora `pruebasquantum.joinsrv.xyz`). |
| `fechaEvento` | Fin de la cuenta atrás. Ahora: 1 de noviembre a las 00:00 hora de Colombia. |
| `discord` | Botón de Discord. |
| `ram.defectoMB` / `ram.minimoMB` | 4 GB por defecto, 3 GB mínimo. |
| `modsLigeros` | Mods que se desactivan en el modo PC de bajos recursos (solo visuales/sonido). |
| `opcionesIniciales` | Idioma y packs de recursos activos la primera vez. |
| `instancia` | Nombre de la carpeta del juego. Cámbialo para un evento nuevo y tendrá su propia instalación. |

Para reutilizarlo en otro evento: cambia `evento.config.json` y las imágenes de `assets/`
(`fondos/fondo-1.jpg`…`fondo-3.jpg` (la lista está al principio de `src/renderer/app.js`, en `FONDOS`), `gif/`, `logo-evento.png`, `logo-quantum.png`, `icon.png`). Los colores están al principio de
`src/renderer/styles.css`.

## Dónde está cada cosa en el PC del jugador

`%APPDATA%\QuantumLauncher\` (la versión portable usa `QuantumLauncher-datos\` junto al `.exe`):

```text
QuantumLauncher\
  compartido\        Java 21, Minecraft 1.21.8, librerías y assets (de Mojang/Adoptium)
  instancias\quantum-maze-runner\   carpeta del juego: mods, config, saves, logs…
  modpacks\          el .mrpack descargado
  cuentas.json       cuentas (tokens cifrados)
  ajustes.json       RAM, resolución, etc.
```

La carpeta `.minecraft` del jugador no se toca.

## Si un jugador tiene problemas

Pídele que pulse **Ajustes → Instalación → Ver informe técnico → Guardar en un archivo** y te lo mande por Discord. Si el juego se cierra
con error, el launcher le abre el registro solo y guarda una copia en
`instancias\quantum-maze-runner\logs\quantum-error-*.log`.
