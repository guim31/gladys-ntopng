# ntopng

[ntopng](https://www.ntop.org/products/traffic-analysis/ntop/) observa el
tráfico de una interfaz de red (un puerto espejo, el lado LAN de un router, un
servidor doméstico) e indica quién habla con quién, cuánto y qué parece
sospechoso. Esta integración lo lleva a Gladys: un dispositivo por interfaz que
supervisa ntopng, con sus caudales de recepción y envío, sus hosts y flujos
activos y sus alertas. Las escenas pueden reaccionar a una nueva alerta de
ntopng, a un host local nunca visto o a un caudal que supera un umbral, y un
widget del panel muestra el tráfico y las alertas de un vistazo. Todo se queda
en su red local.

Probada contra un ntopng 7.0 Community real (Docker), con tráfico y un escaneo
de puertos entre contenedores de prueba. Aún no en una red doméstica real: sus
comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-ntopng/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- ntopng 6 o 7 (basta con la edición gratuita **Community**), accesible desde
  la máquina de Gladys (puerto 3000 por defecto).
- Un usuario de ntopng que pueda leer las alertas (un administrador, o un
  usuario con el permiso «alertas»), y preferiblemente su token de API.

La integración solo lee: nunca cambia nada en ntopng.

## Primeros pasos

### 1. Obtener un token de API

Abra ntopng en un navegador (`http://<máquina>:3000`). En una instalación nueva,
ntopng pide primero cambiar la contraseña por defecto de `admin`: hágalo, la API
queda cerrada hasta entonces. Abra luego el menú de usuario (arriba a la
derecha) → su nombre de usuario → la pestaña del token → **Generate**, y copie
el token.

### 2. Configurar la integración

En Gladys, **Integraciones → ntopng → Configuración**:

- **Dirección de ntopng**: `192.168.1.20`, `ntop.lan`, o la dirección que
  muestra su navegador, como `https://ntop.lan:3001` (puerto 3000 si no se
  indica ninguno).
- **Token de API**: el token del paso 1. Sin token, rellene **Usuario (sin token)** y **Contraseña (sin token)**.
- **Intervalo de actualización**: 1 minuto por defecto (de 30 segundos a
  5 minutos).
- **Umbral de caudal (Mbit/s)**: solo para el disparador «Caudal por encima del
  umbral»; si no, déjelo vacío.
- **Aceptar certificados autofirmados**: solo para una dirección `https://`, ya
  que el certificado que trae ntopng es autofirmado.
- **Idioma de los nombres**: el idioma de los nombres de las funciones y de los
  textos de escena.

Pulse luego **Probar la conexión**: indica la versión de ntopng, las
interfaces, los hosts activos y las alertas en curso.

### 3. Añadir las interfaces

En la pestaña **Descubrir**, añada las interfaces que quiera seguir. Solo las
interfaces añadidas reciben valores; los disparadores de escena funcionan para
todas.

## Los dispositivos

Un dispositivo por interfaz, llamado `ntopng <interfaz>`:

| Función           | Lo que muestra                                                       |
| ----------------- | -------------------------------------------------------------------- |
| Accesible         | ntopng responde y sigue supervisando la interfaz                     |
| Recepción         | tráfico recibido, en Mbit/s                                          |
| Envío             | tráfico enviado, en Mbit/s                                           |
| Hosts activos     | hosts vistos en la interfaz en este momento                          |
| Hosts locales     | los de ellos que están en sus redes locales                          |
| Flujos activos    | conexiones seguidas en este momento                                  |
| Alertas en curso  | alertas que ntopng mantiene abiertas sobre hosts o sobre la interfaz |
| Flujos con alerta | flujos activos con una alerta (un escaneo de puertos genera miles)   |
| Gravedad más alta | la peor de ellas: Ninguna, Aviso, Advertencia o Error                |

Los caudales y los flujos se envían como máximo una vez por minuto; los demás
valores cuando cambian.

## Panel

El widget **Tráfico ntopng** muestra, para una interfaz (la elegida en sus
ajustes, o la única), la recepción, el envío, los hosts, los flujos y las
alertas en curso, y luego la lista de alertas: primero las que están en curso,
las más graves arriba, y después las alertas de flujo de las últimas 24 horas
con su número. Con varias interfaces y ninguna elegida, muestra los totales y
una línea por interfaz. El botón **Actualizar** vuelve a leer ntopng.

## Escenas

### Disparadores

- **Nueva alerta de ntopng**: ntopng genera una alerta sobre un host, un flujo o
  una interfaz. Filtros: interfaz, gravedad, tipo de alerta (el nombre en inglés
  que muestra ntopng, como `Probing Attempt`), dirección IP del host. Variables:
  interfaz, tipo de alerta, gravedad, generada en, dirección IP y nombre del
  host, descripción, ocurrencias. Un escaneo de puertos escribe una alerta de
  flujo por sonda: se agrupan por tipo y host, y la misma alerta se dispara como
  máximo una vez por hora.
- **Nuevo host local**: ntopng ve un host local nunca visto antes, por su
  dirección MAC (si no, por su dirección IP). Variables: interfaz, dirección IP,
  dirección MAC, nombre del host. Los hosts conocidos al arrancar la integración
  no se anuncian.
- **Caudal por encima del umbral**: recepción más envío de una interfaz supera
  el umbral de la configuración dos lecturas seguidas, o vuelve por debajo del
  90 % de este. Filtro: el cambio. Variables: recepción, envío, total y umbral
  en Mbit/s.

Para seguir la presencia de sus dispositivos, [NetAlertX](https://github.com/guim31/gladys-netalertx)
lo hace mejor (escaneos, presencia por dispositivo); ntopng solo ve los hosts
que envían tráfico por la interfaz que supervisa.

### Acciones

- **Estado de una interfaz de ntopng**: lee una interfaz para las acciones
  siguientes: recepción, envío, hosts, flujos, alertas, gravedad más alta, y un
  resumen listo para enviar como `eth0: recepción 12,3 Mbit/s, envío
1,5 Mbit/s, 24 host(s), 310 flujo(s), ninguna alerta`.
- **Alertas recientes de ntopng**: las alertas en curso y las alertas de flujo
  de las últimas 24 horas, en una interfaz o en todas, con su número y un
  resumen.

### Ideas de escenas

- **Nueva alerta de ntopng**, gravedad **Error** → enviar el mensaje
  `{{triggerEvent.data.alert_type}} en {{triggerEvent.data.host}} ({{triggerEvent.data.count}} veces)`.
- **Nuevo host local** → enviar `Nuevo dispositivo: {{triggerEvent.data.host_name}} {{triggerEvent.data.ip}} {{triggerEvent.data.mac}}`.
- **Caudal por encima del umbral** de noche → pausar las copias de seguridad, y
  reanudarlas con «De nuevo por debajo».
- Cada noche a las 21:00 → **Alertas recientes de ntopng** → si el número es
  mayor que 0, enviar el resumen.

## Solución de problemas

- **«no responde»**: compruebe la dirección y el puerto en un navegador; un
  cortafuegos puede bloquear el puerto 3000.
- **«inicie sesión una vez en ntopng y cambie la contraseña de admin por
  defecto»**: ntopng redirige cada petición a la página de la contraseña hasta
  que se cambie la de `admin`.
- **«token de API o contraseña rechazados»**: genere un nuevo token, o compruebe
  el usuario y la contraseña.
- **«este usuario de ntopng no puede leer las alertas»**: los valores llegan
  igualmente, pero ningún evento de alerta: dé al usuario el permiso «alertas»,
  o use un administrador.
- **«la dirección redirige»**: ntopng solo sirve HTTPS: introduzca la dirección
  `https://` (puerto 3001 por defecto).
- **ntopng genera «Clear-Text Credentials» para Gladys**: con un usuario y una
  contraseña por HTTP, ntopng ve pasar la contraseña en claro por la red que
  supervisa. Use un token de API, o HTTPS.
- **ntopng en Docker casi no muestra nada**: supervisa su propio contenedor;
  arránquelo con `--network host` (en la máquina que ve el tráfico) o en un
  puerto espejo.
- Más detalles con la variable de entorno `LOG_LEVEL=debug` en la integración.

## Límites

- Una sola instancia de ntopng, 8 interfaces como máximo.
- Se leen las alertas en curso (hosts, interfaz) y las alertas de flujo; las
  demás familias de alertas de ntopng (redes, sistema, SNMP de la edición
  Enterprise) no.
- Los eventos de alertas de flujo necesitan el almacenamiento SQLite de las
  ediciones Community y Pro; con ClickHouse (Enterprise), están desactivados.
- Pensada para la edición Community: las funciones de las ediciones de pago
  (políticas de tráfico, SNMP, nProbe) no se leen.
- La integración lee los valores actuales en cada actualización: no importa el
  historial de ntopng.
- Sin relación con ntop.
