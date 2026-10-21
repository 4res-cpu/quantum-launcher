# Login premium: crear la aplicación de Azure y pedir permiso a Minecraft

Para que un jugador entre con su cuenta de Microsoft, el launcher necesita un **Client ID** propio.
Hay dos partes: crear la aplicación en Azure (10 minutos) y **pedir a Microsoft que la apruebe para
la API de Minecraft** (eso tarda: pídelo cuanto antes).

> Sí, Microsoft exige permiso. Las aplicaciones nuevas de Azure no pueden usar la API de Minecraft
> hasta que las aprueban. Sin aprobación, todo el inicio de sesión funciona hasta el último paso y
> `api.minecraftservices.com` responde **403**. El launcher muestra entonces el mensaje
> *"Minecraft rechazó la aplicación del launcher (403)…"*. El modo no premium no depende de esto.

## 1. Crear la aplicación

1. Entra en <https://portal.azure.com> con una cuenta de Microsoft (sirve la cuenta gratuita de Azure;
   si te pide crear un directorio o una suscripción gratuita, acéptalo, no se cobra nada por esto).
2. Busca **"Registros de aplicaciones"** (*App registrations*) → **Nuevo registro**.
3. Rellena:
   - **Nombre:** `Quantum Launcher`
   - **Tipos de cuenta admitidos:** *Solo cuentas personales de Microsoft* (Personal Microsoft accounts only).
   - **URI de redirección:** plataforma **"Cliente público/nativo (móvil y escritorio)"** y la dirección
     `https://login.microsoftonline.com/common/oauth2/nativeclient`
4. Pulsa **Registrar**.
5. En la página de la app, copia el **Id. de aplicación (cliente)**. Es algo como
   `1a2b3c4d-....`.
6. Ve a **Autenticación** → abajo del todo, **"Permitir flujos de clientes públicos"** → **Sí** → Guardar.
7. No hace falta añadir permisos de API ni crear secretos: el launcher es un cliente público
   (usa PKCE) y pide `XboxLive.signin offline_access` al iniciar sesión.

Pega el Client ID en `evento.config.json`:

```json
"microsoft": {
  "clientId": "1a2b3c4d-....",
  "redirectUri": "https://login.microsoftonline.com/common/oauth2/nativeclient"
}
```

y vuelve a compilar el launcher (ver README).

## 2. Pedir permiso para la API de Minecraft

1. Abre el formulario de revisión de Microsoft: <https://aka.ms/mce-reviewappid>
2. Te pedirá el **Client ID** y el **Id. de directorio (inquilino)**, que también aparece en la página
   de la app en Azure, más una descripción. Explica que es un launcher gratuito para los eventos de tu
   comunidad de Minecraft Java, que solo usa el inicio de sesión para obtener el perfil del jugador y
   conectarse a vuestro servidor.
3. Espera la respuesta por correo. No hay un plazo publicado: según lo que cuentan otros
   desarrolladores, va de días a varias semanas. Mientras tanto, los jugadores pueden usar el modo
   no premium.

## 3. Comprobar que funciona

1. Abre el launcher → Cuentas → **Iniciar sesión con Microsoft (premium)**.
2. Se abre la ventana de Microsoft. Inicia sesión con una cuenta que tenga Minecraft Java.
3. Si todo va bien, la cuenta aparece con su skin y "Premium (Microsoft)".

Errores que puedes ver y qué significan:

| Mensaje | Causa |
| --- | --- |
| Minecraft rechazó la aplicación del launcher (403) | La app aún no está aprobada (paso 2). |
| Esta cuenta de Microsoft no tiene perfil de Xbox | El jugador debe entrar una vez en minecraft.net o xbox.com. |
| Es una cuenta de menor de edad… | Un adulto debe añadirla a su grupo familiar de Microsoft. |
| Esta cuenta no tiene Minecraft Java comprado | No es premium: que use el modo no premium. |
| La sesión de Microsoft caducó | El jugador no abrió el launcher en ~90 días: que vuelva a iniciar sesión. |

## ¿Y usar el Client ID de otro launcher?

Algunos launchers usan el identificador del launcher oficial o de otro proyecto. No lo hagas para el
evento: no es tu aplicación, Microsoft puede bloquearla en cualquier momento y estarías actuando en
nombre de otro. Con tu propio Client ID aprobado no dependes de nadie.

## Dónde se guarda la sesión

En `%APPDATA%\QuantumLauncher\cuentas.json`. Los tokens se cifran con el sistema (DPAPI en Windows,
Llavero en macOS). El token de acceso de Minecraft dura 24 horas y el launcher lo renueva solo con el
token de actualización cada vez que haga falta.
