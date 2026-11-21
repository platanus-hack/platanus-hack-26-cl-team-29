# Trae a tu vecino: invitaciones con código y su atribución

Fecha: 2026-11-21 16:14
Autor: avisos-vecinos

## Contexto
La compra conjunta baja de precio con cada negocio que se suma, así que a cada comprador le conviene traer a otro.
Los avisos de compra abierta solo llegan a quien ya se registró (ver
docs/decisiones/20261121-1604-avisos-de-compra-abierta.md); la manera de llegar a negocios nuevos sin envío en frío
es que un comprador invite a quien conoce.

## Decisión
- Cada comprador tiene un **código propio**, de 8 letras al azar (`crypto.randomInt`, sin I ni O: 24^8 posibles). No
  sale de su teléfono ni de su RUT, así que no se adivina ni revela nada. Se guarda en su contacto (`avisos_contactos`).
- Se comparte de dos formas: el enlace web `/unirse?ref=<código>` y un enlace `wa.me` al número del bot con el mensaje
  ya escrito ("Hola, quiero sumarme a la compra conjunta. Código de invitación: <código>"). Es la persona invitada
  quien escribe primero al bot: el bot nunca le escribe a un número que no le escribió.
- El bot la ofrece por WhatsApp al sumarse a una compra (una vez por compra) y cuando la persona escribe "invitar"
  (5 por teléfono cada 10 minutos, con `crearLimitador` de `server/limite.ts`). En `/app`, el botón "Invitar a otro
  negocio" usa Web Share y, si no hay, copia el texto (`GET /api/avisos/invitacion`, límite por negocio).
- **Atribución**: un mensaje al bot con el código, o `POST /api/avisos/invitado` desde `/unirse?ref=`, deja al negocio
  invitado por el dueño del código (nunca por sí mismo; el primero que lo invitó se queda). Cuando ese negocio entra a
  la compra, se cuenta una sola vez: a quien invitó le llega "<negocio> se sumó con tu invitación: el precio de
  <producto> bajó a <precio>" (o "va en", si aún no bajó) y se emite `invitacion.sumada` con solo nombres e ids de
  negocio, pasado por `sinTelefonos`. `/sala` lo muestra unos segundos como "X invitó a Y".
- `GET /api/avisos/invitaciones` entrega las mismas aristas para que `/red` dibuje quién invitó a quién.

## Consecuencias
- Quien dijo BASTA no recibe el ofrecimiento ni el aviso de su invitado.
- Sin `PUBLIC_URL` el mensaje del bot va sin enlace web (solo el de WhatsApp); sin `DEMO_WHATSAPP_NUMERO`, sin el de
  WhatsApp. En producción hay que definir los dos.
- Descartado: códigos derivados del teléfono o del RUT (se adivinan y exponen datos personales) y que el bot le
  escriba al número que el comprador entrega (sería envío en frío).
