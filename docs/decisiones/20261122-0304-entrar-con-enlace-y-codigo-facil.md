# Entrar con un enlace del mensaje y un código fácil de copiar

Fecha: 2026-11-22 03:04
Autor: Luciano (con agente)

## Contexto
Para entrar a `/app` o `/proveedor` llega un código de 6 dígitos por WhatsApp. Había que memorizarlo o seleccionarlo a
mano dentro de una frase. WhatsApp tiene un botón nativo "Copiar código", pero solo en plantillas de autenticación
(categoría AUTHENTICATION, botón `copy_code` o one-tap) aprobadas por Meta, y el sandbox de Kapso no envía plantillas
(ver la decisión de avisos fuera de la ventana de 24 h). Dentro de la ventana solo hay botones de respuesta, que no copian.

## Decisión
1. **Enlace de entrada directa.** El mensaje trae, además del código, `https://<PUBLIC_URL>/app?entrar=<token>` (o
   `/proveedor`, según desde dónde se pidió). El token es aleatorio (24 bytes), opaco, de un solo uso y vence con el
   código; el servidor guarda solo su hash, ligado al teléfono y al código. La URL nunca lleva teléfono ni código.
   `POST /api/red/acceso/enlace { token }` entra como `/acceso/entrar`; si el número no es de la red, responde
   `registro` con el teléfono y el código de ese mensaje para seguir con el formulario sin escribirlos.
2. **El host sale solo de `PUBLIC_URL`**, nunca de un encabezado del pedido: el enlace es una llave de entrada y alguien
   podría pedirla para el número de otra persona con su propio dominio. Sin `PUBLIC_URL` el mensaje va sin enlace.
3. **Mensaje fácil de copiar.** El código va solo en su línea y en monoespaciado (` ```123456``` `): mantenerlo apretado
   copia solo el número.
4. **Campo del código.** `autocomplete="one-time-code"` y teclado numérico; si se pega el mensaje entero, se toman los
   6 dígitos y entra sin apretar nada.

## Pendiente: botón nativo "Copiar código"
Cuando haya número propio y plantillas aprobadas: crear en Meta una plantilla de categoría AUTHENTICATION con botón
`copy_code` (o one-tap si hay app Android), definirla en `KAPSO_TEMPLATE_NAME`/`KAPSO_TEMPLATE_LANGUAGE` y mandar el
código como parámetro de la plantilla desde `enviarCodigo` (server/index.ts). Esas plantillas además llegan fuera de la
ventana de 24 h, así que el código deja de quedar "retenido". El enlace puede seguir en el cuerpo como alternativa.
