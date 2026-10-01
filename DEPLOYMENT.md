# Publicar rifas-squirrel en Vercel

El proyecto está preparado para Astro SSR en Vercel con `@astrojs/vercel`. `vercel.json` configura Astro, `npm ci` y `npm run build:vercel`. El adaptador genera `.vercel/output` con los archivos públicos y las funciones del servidor. Node.js se fija en **24.x** y cada función tiene hasta **60 segundos** para completar las operaciones con Firebase. Consulta la [documentación del adaptador oficial](https://docs.astro.build/en/guides/integrations-guide/vercel/).

## 1. Importar el proyecto

1. Sube este proyecto a un repositorio Git incluyendo `package-lock.json`, `vercel.json` y las dos configuraciones de Astro. `.env`, compradores locales, artefactos y `.vercel` están excluidos de Git.
2. En Vercel, selecciona **Add New → Project** e importa el repositorio.
3. Usa **Framework Preset: Astro** y como **Root Directory** la carpeta que contiene `package.json`. Mantén los comandos de `vercel.json`; deja **Output Directory** sin sobrescribir.
4. Antes de desplegar, agrega las variables indicadas abajo en **Settings → Environment Variables**. También puedes importar los valores desde tu `.env` en el panel, seleccionando las variables de Firebase y excluyendo `HOST` y `PORT`.

## 2. Variables de entorno

Copia los valores reales de tu `.env` a Vercel. `.env.example` documenta los nombres; sus placeholders no sirven para iniciar sesión.

| Variable | Valor / uso |
| --- | --- |
| `PUBLIC_FIREBASE_API_KEY` | Clave web de Firebase de tu `.env` |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | `crear-rifas.firebaseapp.com` |
| `PUBLIC_FIREBASE_DATABASE_URL` | `https://crear-rifas-default-rtdb.firebaseio.com` |
| `PUBLIC_FIREBASE_PROJECT_ID` | `crear-rifas` |
| `PUBLIC_FIREBASE_STORAGE_BUCKET` | `crear-rifas.firebasestorage.app` |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `135300430449` |
| `PUBLIC_FIREBASE_APP_ID` | ID web de Firebase de tu `.env` |
| `PUBLIC_FIREBASE_MEASUREMENT_ID` | `G-1J4FX89RL7`, opcional si Analytics está desactivado |
| `PUBLIC_ENABLE_ANALYTICS` | `false` |
| `APP_ORIGIN` | Opcional: URL pública exacta, por ejemplo `https://rifas-squirrel.vercel.app`, sin barra final |

Activa las variables de Firebase en **Production** y, si usarás despliegues de prueba, también en **Preview**. Configura `APP_ORIGIN` únicamente para **Production** cuando conozcas el dominio definitivo. En **Preview**, déjala sin definir: cada despliegue verificará las solicitudes contra su propia URL. Si cambias el dominio de producción y definiste `APP_ORIGIN`, actualízala y vuelve a desplegar. Las solicitudes de otros orígenes siguen rechazándose.

`HOST` y `PORT` corresponden al servidor Node local: no los agregues a Vercel. No hace falta un Redis, una clave de servicio de Firebase ni configurar las sesiones de Astro: el acceso utiliza tokens verificados de Google en una cookie HttpOnly, y Realtime Database conserva los datos.

Las variables `PUBLIC_` se incluyen al compilar. Después de cambiar cualquier variable, ejecuta **Redeploy** para aplicarla al cliente y al servidor.

## 3. Habilitar el dominio en Firebase

1. En el proyecto **crear-rifas**, abre **Authentication → Sign-in method** y verifica que Google esté habilitado.
2. En **Authentication → Settings → Authorized domains**, agrega el dominio que te asignó Vercel, por ejemplo `rifas-squirrel.vercel.app`, sin `https://` ni rutas. Si usas un dominio propio, agrégalo también. Para probar el login en Preview, autoriza también su dominio exacto. Consulta la [configuración de Google en Firebase](https://firebase.google.com/docs/auth/web/google-signin).
3. Mantén `PUBLIC_FIREBASE_AUTH_DOMAIN=crear-rifas.firebaseapp.com`; el dominio donde publicas la página se agrega a la lista autorizada.
4. En **Realtime Database → Rules**, publica el archivo `database.rules.json` de este repositorio. Vercel publica la aplicación; las reglas de Firebase se publican por separado.

## 4. Desplegar y comprobar

Pulsa **Deploy** en Vercel. Para revisar la compilación antes de subir:

```sh
npm ci
npm test
npm run build:vercel
```

Como alternativa al repositorio Git, puedes usar el CLI de Vercel desde esta carpeta:

```sh
npx vercel
# Configura las variables y el dominio en los paneles de Vercel y Firebase.
npx vercel --prod
```

`.vercelignore` excluye el `.env` y los compradores locales de las subidas por CLI. La compilación usa las variables configuradas en Vercel; no depende de copiar un `.env` al servidor.

En el sitio publicado, comprueba que la landing abra, Google te lleve al perfil, puedas crear y editar una rifa, y un visitante sin sesión pueda abrir su enlace público. El perfil y las API privadas se verifican en el servidor en cada petición y no usan ISR ni caché compartida. El login real requiere configurar tu dominio en Firebase.

## Fotos y archivos

Vercel limita las solicitudes de funciones a [4.5 MB](https://vercel.com/docs/functions/limitations). La app comprime las fotos nuevas y limita cada JSON a **4 MB** antes de enviarlo y al recibirlo. Las imágenes siguen guardándose en base64 en Realtime Database. Los CSV/Excel se leen en el navegador; se envían sus boletos normalizados junto con la rifa.

Las respuestas JSON se envían en fragmentos para consultar perfiles con varias rifas y rifas anteriores con imágenes grandes. Vercel recomienda [streaming para respuestas grandes](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). La validación existente de las imágenes de rifas anteriores se conserva.

Para seguir trabajando localmente, usa `npm run dev`. Para el servidor Node independiente, usa `npm run build` seguido de `npm start`. `npm start` corresponde a ese servidor local; Vercel ejecuta las funciones generadas por `npm run build:vercel`.
