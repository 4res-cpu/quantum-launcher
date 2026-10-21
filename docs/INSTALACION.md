# Puesta en marcha paso a paso

Tiempo: unos 45 minutos. Solo necesitas un PC con Windows, internet y una cuenta de GitHub (gratis).
No hace falta saber programar: todo se hace con el Bloc de notas, la web de GitHub y GitHub Desktop.

## Paso 1. Instala los programas

1. **GitHub:** crea una cuenta en <https://github.com/signup>. Apunta tu nombre de usuario exacto
   (en esta guía lo llamamos `4res-cpu`).
2. **GitHub Desktop:** descárgalo de <https://desktop.github.com>, instálalo e inicia sesión con tu
   cuenta de GitHub.
3. **Node.js:** descarga la versión **LTS** de <https://nodejs.org> e instálalo con las opciones por
   defecto. Solo lo usarás para publicar versiones nuevas del modpack.
4. **Visual Studio Code** (opcional, pero mejor que el Bloc de notas para editar): <https://code.visualstudio.com>.

## Paso 2. Crea la app de Azure (login premium)

Sigue [AZURE.md](AZURE.md), pasos 1 y 2: crea la app, copia el **Client ID** y envía el formulario de
aprobación. No hace falta esperar a que la aprueben para seguir con esta guía.

## Paso 3. Prepara la carpeta del launcher

1. Descomprime `quantum-launcher.zip` en una ruta sencilla, por ejemplo `C:\Quantum\quantum-launcher`.
2. Abre la carpeta con VS Code (*File → Open Folder*).
3. Pulsa **Ctrl+Shift+H** (reemplazar en todos los archivos). Busca `4res-cpu`, escribe tu usuario de
   GitHub y pulsa *Replace All*. Debe cambiar `evento.config.json`, `package.json`,
   `quantum-datos/manifest.json` y las guías.
4. En `evento.config.json`, sustituye `PEGA_AQUI_TU_CLIENT_ID_DE_AZURE` por tu Client ID.
5. Revisa en el mismo archivo `fechaEvento`. Ahora es `2026-11-01T00:00:00-05:00` (medianoche en
   Colombia). Si el evento empieza, por ejemplo, a las 8 de la noche de Colombia, pon
   `2026-11-01T20:00:00-05:00`.
6. Guarda todo (**Ctrl+K S**).

## Paso 4. Crea el repositorio de datos (`quantum-datos`)

1. En github.com pulsa **+ → New repository**. Nombre: `quantum-datos`. Márcalo **Public**. Pulsa
   *Create repository*.
2. En la página del repositorio, pulsa **uploading an existing file**. Arrastra los tres archivos de
   la carpeta `quantum-datos\`: `manifest.json`, `noticias.json` y `README.md`. Pulsa *Commit changes*.
3. Sube el modpack:
   1. Haz una copia de tu `Eventos Quantum 3.4.7.mrpack` y renómbrala `Eventos_Quantum_3.4.7.mrpack`
      (sin espacios). **Tiene que ser exactamente el mismo archivo que me pasaste**: el manifiesto lleva
      su huella (sha1) y, si subes otro, la descarga fallará.
   2. En `quantum-datos`, columna derecha, **Releases → Create a new release**.
   3. *Choose a tag* → escribe `modpack-3.4.7` → *Create new tag*.
   4. Título: `Modpack 3.4.7`. Arrastra el `.mrpack` a la zona de archivos. Pulsa **Publish release**.
4. Comprueba que funciona abriendo estas dos direcciones en el navegador (con tu usuario):
   - `https://raw.githubusercontent.com/4res-cpu/quantum-datos/main/manifest.json` → se ve el JSON.
   - `https://github.com/4res-cpu/quantum-datos/releases/download/modpack-3.4.7/Eventos_Quantum_3.4.7.mrpack`
     → se descarga el modpack.

## Paso 5. Sube el launcher a GitHub (`quantum-launcher`)

1. Abre GitHub Desktop → **File → Add local repository** → elige `C:\Quantum\quantum-launcher`.
2. Te dirá que no es un repositorio: pulsa **create a repository** → *Create repository*.
3. Pulsa **Publish repository**. Nombre: `quantum-launcher`. **Desmarca "Keep this code private"**
   (tiene que ser público para que los jugadores descarguen y el launcher se actualice solo).
   Pulsa *Publish repository*.
4. En github.com, abre `quantum-launcher` → **Settings → Actions → General** → en *Workflow
   permissions* elige **Read and write permissions** → *Save*.

## Paso 6. Compila el launcher

1. En GitHub Desktop, pestaña **History** → clic derecho sobre el último cambio → **Create Tag…** →
   escribe `v1.0.0` → *Create Tag*.
2. Pulsa **Push origin** (arriba). Así se sube la etiqueta.
3. En github.com → `quantum-launcher` → pestaña **Actions**. Verás "Compilar launcher" en marcha.
   Tarda unos 10–15 minutos. Primero pasan las pruebas y luego se compila para Windows, Linux y Mac.
4. Cuando todo esté en verde, ve a **Releases**. Debe estar la `v1.0.0` con:
   `Quantum-Launcher-Setup-1.0.0.exe`, `Quantum-Launcher-Portable-1.0.0.exe`, el `.AppImage`, el `.dmg`
   y `latest.yml` (este último lo usa el actualizador, no lo borres).

Si algo sale en rojo, abre el paso que falló, copia el error y pásamelo.

## Paso 7. Pruébalo tú

1. Descarga `Quantum-Launcher-Setup-1.0.0.exe` e instálalo. Si sale *"Windows protegió su PC"*:
   **Más información → Ejecutar de todas formas** (pasa porque el launcher no está firmado).
2. Añade una cuenta **no premium**, pulsa **Jugar** y comprueba que entra al lobby.
3. Haz el resto de pruebas de [PRUEBAS-EN-WINDOWS.md](PRUEBAS-EN-WINDOWS.md). La de premium tendrá que
   esperar a que Microsoft apruebe tu app: hasta entonces dará el error 403, y es normal.

## Paso 8. Compártelo con los jugadores

- Enlace de descarga: `https://github.com/4res-cpu/quantum-launcher/releases/latest`
- Guía para ellos: [GUIA-JUGADORES.md](GUIA-JUGADORES.md). Puedes pegarla en un canal del Discord.

## Después: tareas habituales

- **Versión nueva del modpack:** [GUIA-ORGANIZADOR.md](GUIA-ORGANIZADOR.md), apartado *Publicar una
  versión nueva del modpack*. La herramienta se ejecuta así: abre la carpeta del launcher en el
  Explorador, escribe `cmd` en la barra de direcciones, pulsa Enter y pega el comando de la guía.
- **Noticias:** edita `noticias.json` en la web de `quantum-datos` (icono del lápiz) → *Commit changes*.
- **Cuando Microsoft apruebe la app:** si ya pusiste el Client ID en el paso 3, no hay que hacer nada:
  el login premium empieza a funcionar solo.
- **Cambiar algo del launcher** (servidor, fecha, imágenes): edita, sube `version` en `package.json`
  (por ejemplo `1.0.1`), haz *Commit* y *Push* en GitHub Desktop, crea la etiqueta `v1.0.1` y vuelve a
  pulsar *Push origin*. Los que tienen el instalador se actualizan solos. Para avisar a los de la
  versión portable, cambia `launcher.version` a `1.0.1` en `quantum-datos/manifest.json`.
