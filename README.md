# rifas-squirrel · Rifas con ruleta

Plataforma general en español para crear y administrar rifas, hecha con **Astro SSR**, **Firebase Authentication**, **Realtime Database** y **Motion**. Su identidad es **rifas-squirrel**, con la imagen de la ardilla proporcionada como logo, favicon y mascota de la landing.

## Ejecutar

Se requiere Node.js 22.12 o posterior.

```sh
npm install
# Si no tienes el .env local entregado, copia .env.example a .env y completa sus valores.
npm run dev
```

Abre http://localhost:4321. En PowerShell, usa `npm.cmd` si la política del sistema bloquea `npm.ps1`.

```sh
npm test
npm run test:rules
npm run build
npm start
```

El servidor de producción usa el adaptador Node de Astro. Necesita `.env`. Configura `APP_ORIGIN` con el origen público exacto (sin barra final), `HOST=0.0.0.0` cuando corresponda y HTTPS en producción. Las variables `PUBLIC_` se incorporan al bundle durante la compilación; recompila después de cambiarlas.

Para publicar en Vercel, sigue [DEPLOYMENT.md](DEPLOYMENT.md). `vercel.json` selecciona `npm run build:vercel`, que usa el adaptador oficial de Vercel; `npm run build` y `npm start` conservan el servidor Node local.

## Activar Firebase (proyecto `crear-rifas`)

1. En **Authentication → Sign-in method**, habilita **Google** y establece el correo de soporte.
2. En **Authentication → Settings → Authorized domains**, agrega `localhost`, `127.0.0.1` si lo utilizas y el dominio de producción.
3. En **Realtime Database → Rules**, publica el contenido de `database.rules.json`. Revisa y combina las reglas si esta base ya contiene otras aplicaciones: este archivo deniega las rutas que no pertenecen a esta app. También puedes usar Firebase CLI: `firebase deploy --only database --project crear-rifas` después de autenticarte.
4. Reinicia el servidor después de modificar `.env`.

La configuración web proporcionada está en `.env` (ignorado por Git); `.env.example` documenta sus variables. No se necesita una clave privada de servicio: el servidor verifica el ID token con la API oficial de Firebase Auth, y las solicitudes a Realtime Database usan ese token y sus reglas. Analytics está desactivado; `PUBLIC_ENABLE_ANALYTICS=true` lo habilita después de obtener el consentimiento necesario.

## Rutas y comportamiento

- `/`: landing sencilla con inicio de sesión de Google y animaciones de Motion.
- `/perfil`: protegida en el servidor. Muestra las rifas creadas por el usuario y las compartidas con su correo verificado de Google.
- `/rifas/:id`: página pública con premios, búsqueda, filtros y paginación de boletos. Recibe cambios de disponibilidad y resultados en tiempo real.
- `/api/auth/session`: crea o elimina la cookie HttpOnly de sesión. Se verifica el token en cada acceso privado; el SDK renueva el token mientras la sesión permanece activa.
- `/api/rifas`: creación y consulta privadas; subrutas para ventas y sorteo. `DELETE /api/rifas/:id` elimina una rifa del propietario.

El modal permite comenzar **desde cero** o **importar archivos CSV y Excel**. Siempre pide título, de 1 a 6 fotos con nombre y de 1 a 5,000 boletos. Además, permite agregar una **portada independiente de los premios** y el **WhatsApp del vendedor**. Las imágenes nuevas se reducen a un máximo de 1,200 píxeles y aproximadamente 270 KB cada una (360,000 caracteres en base64), y se guardan como data URL base64 en Realtime Database. No usa Firebase Storage. Las imágenes anteriores siguen siendo compatibles.

## Crear una rifa con archivos

1. En `/perfil`, abre **Crear una rifa → Importar archivos**.
2. Selecciona uno o varios CSV, XLSX o XLS. Puedes agregar archivos en varias selecciones y quitar cualquiera de la lista. Se admiten hasta 50 archivos, 5 MB por archivo y 20 MB en conjunto. Se revisan todas las hojas del Excel; las que no tienen boletos se indican como omitidas.
3. Revisa el resumen y la vista previa antes de guardar. Se aceptan encabezados como `Nº DE BOLETO`, `Boleto`, `Número` o `Folio`, aunque haya títulos y filas vacías antes de la tabla. `Nombre`/`Comprador`, `Teléfono`/`Contacto` y `Vendedor` son opcionales.
4. Un nombre indica un boleto comprado; un nombre vacío indica un boleto disponible. Si existe la columna `Estado`/`Estatus`, debe concordar con el comprador (`Comprado` o `Disponible`). No se admite marcar como comprado un boleto sin nombre ni importar un contacto sin comprador.
5. El total inicial coincide con el número mayor importado. Puedes ampliarlo. Los números faltantes entre 1 y el total se crean como disponibles y el formulario te informa cuántos son. Un número repetido, incluso entre diferentes archivos u hojas, bloquea la creación hasta que lo corrijas.
6. Agrega el título y las imágenes de los premios y pulsa **Crear rifa**. El servidor vuelve a validar cada boleto, guarda los compradores de forma privada y escribe la rifa y el índice del organizador de manera atómica.

Los archivos se leen en tu navegador; se envían solamente los boletos normalizados al crear la rifa. No se ejecutan macros ni fórmulas. Los CSV pueden estar separados por comas, punto y coma o tabulaciones, con codificación UTF-8, Windows-1252 o UTF-16. Para conservar ceros iniciales en teléfonos de Excel, usa texto o un formato numérico adecuado. Puedes descargar `/plantilla-boletos.csv` como ejemplo vacío de tres boletos.

La lectura de Excel usa [SheetJS CE 0.20.3 desde su distribución oficial](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), cargada solo al importar un Excel. El tamaño de cada solicitud JSON está limitado a 4 MB en el navegador y en el servidor, por debajo del [límite de Vercel de 4.5 MB](https://vercel.com/docs/functions/limitations). Si las imágenes y los compradores importados superan ese tamaño, el formulario pide reducirlos antes de enviar. Los archivos CSV/Excel originales se procesan localmente y no se suben al servidor.

## Portada y contacto del vendedor

La portada es opcional y aparece en la cabecera de la rifa y en su tarjeta del perfil. Los premios conservan sus imágenes por separado. Las rifas anteriores sin portada mantienen la imagen de su primer premio en la tarjeta.

El administrador puede agregar o cambiar la portada y el WhatsApp al crear la rifa o usando **Editar rifa** en su página, antes de iniciar el sorteo. También puede cambiar el título, nombres e imágenes de los premios. El teléfono se escribe con código de país, por ejemplo `+52 951 123 4567`; se guarda normalizado y se muestra públicamente como contacto del vendedor. Se puede quitar la portada o vaciar el teléfono desde el mismo modal. Las fotografías de los premios se muestran completas, conservando su proporción y sin recorte.

Al seleccionar un boleto disponible, el visitante escribe su nombre y pulsa **Contactar por WhatsApp**. Se abre el chat con el vendedor y un mensaje preparado que incluye el nombre del comprador, número del boleto, título y enlace de la rifa. El comprador revisa y envía el mensaje en WhatsApp. Se usan los [enlaces oficiales de WhatsApp con mensaje prellenado](https://faq.whatsapp.com/5913398998672934); no se requiere una API de mensajería ni iniciar sesión en la rifa.

Después de confirmar la compra, un administrador selecciona el boleto, pulsa **Marcar como ocupado**, registra el nombre, contacto y vendedor opcionales y guarda. El boleto queda comprado y participa en la ruleta. El estado y los datos privados se actualizan en tiempo real para los administradores. Las solicitudes por WhatsApp no reservan boletos automáticamente; la confirmación del administrador decide la ocupación. Un boleto vendido o una rifa cuyo sorteo ya comenzó no ofrece nuevas solicitudes. Una versión de la rifa validada en las reglas impide sobrescribir cambios simultáneos.

## Compartir la administración e historial

En la página de la rifa, el creador escribe el correo en **Administradores → Agregar administrador**. No hace falta que ese usuario haya visitado el sitio anteriormente. Cuando entre con esa cuenta de Google, encontrará la rifa en su perfil como **Rifa compartida contigo**. Se usa el correo verificado de la cuenta, sin distinguir mayúsculas; debe coincidir con el correo de Google que utilizará para entrar. No se envían correos ni se requiere un enlace de aceptación.

Los administradores invitados pueden ver los compradores privados, ocupar boletos, corregir nombre, contacto y vendedor, liberar un boleto, editar el título, portada, WhatsApp y premios, y realizar los giros del sorteo. Las ediciones y ventas siguen cerrándose en el primer giro para conservar el sorteo. Solo el creador puede agregar o retirar administradores y eliminar la rifa; retirar un acceso elimina la rifa del perfil de ese usuario y sus permisos de lectura y escritura.

Cada boleto muestra la última persona que lo modificó, con nombre, correo y fecha. **Historial de cambios** conserva quién realizó cada operación, los datos anteriores y nuevos del comprador, cambios de título y contacto, actualizaciones de imágenes, incorporaciones y bajas de administradores y giros. Permite cargar registros anteriores. Los cambios de imagen se registran como actualizaciones, sin duplicar imágenes base64 en cada evento. Las ventas y la configuración se guardan junto con su evento en una actualización atómica; los eventos son privados e inmutables mientras exista la rifa.

Las rifas anteriores pueden administrarse con estas reglas: en su siguiente modificación se agrega la versión y comienza el historial. Los cambios anteriores a esta función no se reconstruyen. Los compradores importados al crear una nueva rifa se atribuyen al administrador que realizó la importación.

## Pantalla completa, eliminaciones y varios ganadores

Antes del primer giro, en **Configura el sorteo**, el administrador elige la **cantidad de ganadores** y los **giros de eliminación antes de los ganadores**. La cantidad de ganadores está entre 1 y los boletos comprados; las eliminaciones no pueden dejar menos boletos que ganadores. El valor inicial sugiere un ganador por premio, sin superar los boletos comprados. Por ejemplo, 2 eliminaciones y 3 ganadores producen 5 giros: primero dos números eliminados y luego un ganador distinto en cada uno de los tres giros restantes. Con 0 eliminaciones comienza directamente la selección de ganadores.

Cada giro se inicia por separado con el botón. Un boleto que gana queda excluido de los siguientes giros y aparece de inmediato en la lista de ganadores. Si hay un ganador por premio, se asignan en el orden de los premios; con un único ganador, recibe todos los premios. Si las cantidades son distintas, la lista muestra los ganadores en su orden de selección para que el organizador distribuya los premios. La rifa termina cuando se han elegido todos los ganadores. La restricción de no repetir se aplica a números de boleto; una persona con varios boletos puede ganar con números diferentes.

Cada selección usa `crypto.randomInt` en el servidor sobre los números que siguen participando. Las eliminaciones y los ganadores se guardan antes de la animación y se excluyen de todos los giros siguientes. Se conserva el historial y los datos de compra; un boleto eliminado no vuelve a estar disponible para venta. Al recargar se puede continuar con el siguiente giro, conservando los ganadores anteriores. La cantidad de giros y ganadores queda fijada desde el primero, cuando se cierran las ventas. El número de ronda esperado y la versión validada en las reglas impiden ejecutar dos veces una ronda desde ventanas distintas o solicitudes simultáneas. El resultado final no se puede repetir. Las rifas antiguas sin cantidad de ganadores conservan el sorteo de un solo ganador, incluido cualquier sorteo ya iniciado.

La ruleta muestra **un sector y una etiqueta por cada participante**, incluso con 5,000 boletos; el zoom permite ampliar los sectores y desplazarse por ellos. La lista completa de participantes permanece disponible debajo de la ruleta. La animación se detiene en el sector seleccionado por el servidor y respeta `prefers-reduced-motion`. Los números eliminados y todos los ganadores aparecen en el historial y en la cuadrícula de boletos. Las rifas con resultados anteriores siguen mostrando su ganador.

Cada animación elige al azar **entre 3 y 10 vueltas completas**, más el ángulo necesario para detenerse en el boleto seleccionado. La duración se ajusta a las vueltas: entre 4.5 y 8 segundos. Se aplican los ángulos de inicio y fin explícitos para conservar el mínimo de vueltas también entre giros consecutivos. Las vueltas son visuales y no cambian el boleto que el servidor ya eligió. La preferencia de reducción de movimiento evita la animación.

Al elegir un ganador, el servidor publica el **nombre del comprador** de ese boleto en `public/winnerNames`. Se muestra junto al número en la lista de ganadores, el resultado del giro y su historial, tanto en la página pública como en pantalla completa, y permanece después de recargar. Los contactos y datos del vendedor siguen siendo privados; los nombres de boletos eliminados o todavía sin premio no se publican. Los administradores pueden consultar el comprador de una eliminación mediante los datos privados. Los resultados antiguos sin nombre público mantienen el número; si falta el dato, se muestra **Nombre no registrado**.

El botón **Pantalla completa** amplía la misma ruleta, con sus controles, zoom, lista de participantes, historial y ganadores. Se puede salir con el botón o Escape. Los administradores pueden configurar y realizar giros desde esta vista; los visitantes ven el avance en tiempo real. Se utiliza la [Fullscreen API del navegador](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen); si el navegador no la admite o rechaza la solicitud, la ruleta ocupa la ventana de la página. En pantallas grandes también se muestran los premios junto a la ruleta; en móviles se distribuyen en una columna.

Cuando hay varios premios, sus imágenes se alternan cada **5 segundos**, conservando la fotografía completa. Las flechas permiten avanzar o volver y **Pausar galería / Reanudar galería** controla la reproducción automática. La galería de la página y la de pantalla completa muestran el mismo premio. Si el sistema tiene activada la reducción de movimiento, la galería empieza pausada.

## Eliminar una rifa

El propietario puede pulsar **Eliminar** en la tarjeta del perfil o **Eliminar rifa** en la página de la rifa. Un modal pide confirmar la eliminación permanente. Se borran juntos la rifa, imágenes, compradores, historial, resultado e índice del perfil mediante una actualización atómica. Se pueden eliminar rifas activas, en sorteo o finalizadas. Los visitantes y otros usuarios no tienen permiso. Una página abierta recibe la eliminación en tiempo real.

Después de actualizar el proyecto, publica las nuevas reglas de `database.rules.json` en **Firebase Console → Realtime Database → Rules**. Estas reglas incorporan el acceso compartido, historial privado, cantidad de ganadores y nombres públicos de los ganadores. Las [reglas de Realtime Database](https://firebase.google.com/docs/reference/security/database/) comprueban los permisos, los nuevos campos, la eliminación conjunta, el plan fijo de ganadores, el nombre asociado al comprador real y el historial que solo puede añadir un número distinto por ronda.

Las escrituras incrementan una versión privada y enlazan un evento nuevo del historial; las reglas comprueban ambos en la actualización atómica para impedir ventas duplicadas y conflictos entre administradores. Los permisos se almacenan aparte de la rifa para que un colaborador no pueda concederse más acceso al editar datos. Las peticiones mutables comprueban el origen para evitar CSRF. La cookie tiene SameSite y HttpOnly (Secure en HTTPS). Los compradores y el historial se separan de la información pública y quedan limitados al creador y los correos verificados autorizados mediante las reglas.

## Identidad visual

`src/assets/squirrel.png` conserva la imagen de la ardilla original. Astro genera versiones optimizadas para el encabezado, la landing y el favicon. Los colores azul y naranja retoman la computadora y la ardilla del logo.

## Referencias para un futuro cliente

Mixtecánicos se agregará por separado como cliente. La aplicación no incluye su rifa como contenido predeterminado. Puedes cargar sus CSV desde el modal de creación igual que los archivos de cualquier otro cliente. Los archivos consolidados anteriores se conservan localmente como referencia y no se publican con la aplicación.

Se consolidaron los 24 CSV: **720 boletos consecutivos**, **319 con comprador** y **401 disponibles**. Los nombres y contactos se conservan tal como aparecen, quitando solo espacios exteriores. Los campos de contacto que contienen grupos escolares no se convierten en teléfonos. No se infiere un pago a partir de información inexistente: un nombre presente se interpreta como boleto comprado; un nombre vacío, como disponible.

```sh
npm run import:csv -- "C:/Users/omarc/Downloads"
```

El importador valida la cantidad de archivos, encabezados, números repetidos, secuencia completa y contactos sin comprador. Produce:

- `data/reference/buffet-public.json`: referencia de números y disponibilidad, sin nombres ni contactos.
- `data/private/buffet.json`: compradores, contactos y vendedor; se queda en el servidor y está ignorado por Git.

`data/reference/mixtecanicos.png` conserva la imagen del equipo para usarla posteriormente como cliente. El importador solo genera archivos locales; no crea clientes ni rifas en Firebase. Tampoco modifica los CSV originales.

## Verificación

`npm test` comprueba validación de premios y boletos, ventas duplicadas, cierre de ventas y sorteo, elegibilidad, importación de CSV/Excel, codificaciones, hojas múltiples, duplicados, archivos inválidos, rangos parciales y reconciliación de los 24 CSV. `npm run test:rules` usa el emulador local (requiere Java 21) para probar privacidad, permisos y bloqueo después del sorteo. `npm run test:http` verifica las páginas y la protección de endpoints con el servidor activo en el puerto 4321. `npm run build` ejecuta Astro Check y la compilación de servidor y cliente.

La prueba completa del login y persistencia requiere que el proveedor Google, el dominio y las reglas estén configurados en la consola del proyecto. No hay usuarios falsos ni modo demo que omita la protección del perfil.

Las dependencias transitivas de gRPC y de las herramientas de Firebase usan overrides de versiones corregidas. `npm audit` se verificó sin vulnerabilidades conocidas; al actualizar Firebase CLI, revisa si sus dependencias originales ya incorporan esos parches.
