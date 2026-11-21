# Avisos de compra conjunta abierta, solo a quien se registró

Fecha: 2026-11-21 16:04
Autor: avisos-vecinos

## Contexto
La compra conjunta mejora con cada negocio que se suma, pero quien compró en una compra anterior no se entera de
que abrió otra. Queremos avisarle por WhatsApp sin convertir el bot en una herramienta de envío masivo.

## Decisión
- `server/avisos/` escucha la red. Cuando abre una compra conjunta (hoy, `red.reiniciada`: el reinicio de la demo
  siembra una nueva), manda un solo WhatsApp por negocio y por compra (`ronda` = id y cierre de la compra) con
  `envios.difundir` del agente: "Hay una compra conjunta abierta cerca de ti: <producto> a <precio> y bajando,
  <n negocios sumados>. Responde SÍ para sumarte." El primer aviso a cada negocio agrega "Si no quieres más
  avisos, responde BASTA."
- **Audiencia, simple y explicable** (`audiencia.ts`): puntos por lo que ya compró de esa canasta (8), por haber
  participado en otra compra (4), por ser de la misma comuna (2) y por compartir rubro con quienes compraron esos
  productos (1). Se avisa a quienes suman algo, en ese orden; si nadie calza, a todos los que se puede avisar.
- **Solo registrados por sí mismos**: compradores con su RUT en la red (escribieron al bot y se registraron, o
  entraron en la web) y con teléfono. Nunca a teléfonos de facturas, de locales de OpenStreetMap, de Mercado
  Público ni de otra fuente. Los negocios sembrados de la demo no tienen RUT y no reciben avisos.
- **BASTA** ("no más avisos", "stop") queda guardado en el contacto y se respeta para siempre; un **SÍ** como
  primera respuesta al aviso lo suma con el flujo de siempre de la sala (registro, RUT, productos). El agente solo
  recibe un gancho opcional `avisos` en `conectarAgente`.
- Los contactos viven en su propia tabla (`avisos_contactos`), no en `red_*`: reiniciar la demo borra los negocios,
  pero no lo que cada uno compró ni quién dijo BASTA. Se copian de la red con cada `red:evento`.
- En la web, `/app` muestra el mismo texto como banner en vivo ("Compra conjunta abierta cerca de ti") mientras el
  negocio no está en la compra. El evento público `avisos.enviados` lleva solo `{ licitacionId, negocios }`.

## Por qué no hay envío en frío
- **Política de WhatsApp Business**: solo se puede escribir a quien dio su consentimiento (opt-in) al negocio que
  escribe. Un número sacado de una factura o de un mapa no lo dio.
- **Riesgo para el número del bot**: los bloqueos y reportes de personas que no esperaban el mensaje bajan la
  calidad del número y Meta lo limita o lo da de baja; sin ese número no hay sala ni facturas por WhatsApp.
- **Ley 19.628 de protección de datos personales** (y la Ley 21.719 que la reemplaza): un dato personal se usa
  solo para el fin con que se obtuvo. El teléfono de una factura sirve para facturar, no para publicidad.

## Consecuencias
- La ventana de 24 h de WhatsApp sigue mandando: `server/whatsapp/` retiene el aviso si la persona no escribió en
  las últimas 24 h y lo entrega cuando vuelva a escribir. No se salta. En producción, el aviso necesita una
  **plantilla de utilidad aprobada por Meta** (con el botón SÍ y la opción de darse de baja).
- Si en el futuro se abre una compra sin reiniciar la demo, basta con llamar `avisos.avisarCompraAbierta()`
  (idempotente) desde ese evento.
- Un comprador que entró en la web y no hizo nada antes de un reinicio no queda como contacto (no hubo evento).
