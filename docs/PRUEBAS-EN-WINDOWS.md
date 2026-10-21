# Pruebas en un PC real antes del 1 de noviembre

Las pruebas automáticas (`npm test`) cubren el núcleo con servicios simulados. Estas cuatro solo se
pueden hacer con internet real, una cuenta comprada y Windows. Hazlas con la primera versión que
compile GitHub Actions. Calcula una hora en total.

Prepara un PC (o una máquina virtual de Windows 10/11) **sin Java y sin Minecraft**. Si no tienes uno,
crea un usuario nuevo de Windows: el launcher guarda todo en el `%APPDATA%` de cada usuario.

## 1. Instalación limpia + no premium

- [ ] Descarga `Quantum-Launcher-Setup-1.0.0.exe` de la Release e instálalo. Anota si sale SmartScreen.
- [ ] Al abrirse, se abre la ventana Cuentas. Prueba un nombre inválido (`ab`, `con espacio`): debe
      dar error. Añade `Prueba_Quantum`.
- [ ] Pulsa Jugar. Comprueba que el progreso pasa por: actualizaciones → modpack → Java → Minecraft →
      mods. Anota cuánto tarda.
- [ ] Minecraft abre en español, con el menú de Quantum (FancyMenu) y **entra directo al lobby**.
- [ ] `/register` funciona en el servidor. Sal del juego.
- [ ] En Multijugador aparece *QUANTUM · Lobby de eventos* el primero y no aparece `pruebasquantum.joinsrv.xyz`.
- [ ] `%APPDATA%\.minecraft` no existe o no se ha modificado.
- [ ] Ajustes → Abrir carpeta del juego abre `%APPDATA%\QuantumLauncher\instancias\quantum-maze-runner`.

## 2. Premium

Requiere el Client ID aprobado por Microsoft (ver AZURE.md).

- [ ] Cuentas → Iniciar sesión con Microsoft. Se abre la ventana de Microsoft; inicia sesión.
- [ ] Aparece la cuenta con su cara de skin y "Premium (Microsoft)".
- [ ] Jugar: entra al lobby con el nombre y skin premium.
- [ ] Cierra el launcher, ábrelo al día siguiente (o más de 24 h después) y pulsa Jugar: debe entrar
      sin volver a pedir la contraseña (renovación del token).
- [ ] Con dos cuentas guardadas, cambia de una a otra desde el selector.

## 3. Actualización del modpack

- [ ] Cambia algo pequeño en el modpack (por ejemplo, quita un mod visual y cambia un config) y
      publícalo como 3.4.8 siguiendo la Guía del organizador.
- [ ] Antes, en el PC de prueba: cambia el FOV en el juego, añade un servidor propio a Multijugador y
      haz una captura (F2).
- [ ] Abre el launcher: aparece el aviso "Hay una versión nueva del modpack (3.4.8)".
- [ ] Pulsa Jugar: descarga poco, el mod quitado ya no está en `mods`, el config cambió, y tu FOV,
      tu servidor y tu captura siguen ahí.

## 4. Rendimiento y errores

- [ ] En un PC de 8 GB con gráfica integrada: Ajustes muestra calidad automática "baja" y el modo de
      bajos recursos activado; el juego va fluido en el lobby.
- [ ] Pon la RAM al mínimo (3 GB) y abre el juego: debe funcionar.
- [ ] Borra un `.jar` de `mods` y pulsa Ajustes → Reparar instalación: vuelve a aparecer.
- [ ] Mata el proceso `javaw.exe` desde el Administrador de tareas con el juego abierto: el launcher
      debe mostrar el registro con el aviso de cierre inesperado.

## 5. Actualización del propio launcher

- [ ] Sube `version` a `1.0.1`, publica `v1.0.1` y abre el launcher 1.0.0 instalado: debe descargar la
      nueva y ofrecer "Reiniciar y actualizar".
- [ ] Con la versión portable: sube `launcher.version` a `1.0.1` en `manifest.json` y comprueba que
      sale el aviso con el botón Descargar.

Si algo falla, guarda el registro (botón Ajustes → Instalación → Ver informe técnico → Guardar en un archivo).
