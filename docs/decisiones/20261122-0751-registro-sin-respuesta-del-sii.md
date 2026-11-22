# Registro cuando el SII no responde

Fecha: 2026-11-22 07:51
Autor: registro-resiliente

## Contexto
El registro de un comprador consulta su RUT en la consulta pública del SII. Si el SII fallaba o tardaba, el registro
web se rechazaba ("No pudimos consultar tu RUT"). Con el público de la demo sumándose a la vez, la fila de consultas va
de a una por segundo (para no gatillar bloqueos del SII) y un bloqueo o una caída del SII dejaba a todos afuera.

## Decisión
- La consulta de un RUT espera como máximo 6 s (`esperaRutMs`). Si el SII falla o no responde a tiempo, el negocio se
  registra con lo que escribió la persona (nombre, dirección, comuna), marcado `declarado`. Un RUT que el SII dice que
  no existe se sigue rechazando.
- El negocio declarado se vuelve a consultar a los 30 s, 2 min y 10 min, por la misma fila (la consulta que venció
  sigue en la fila y queda en caché). Cuando el SII responde, su razón social y giro reemplazan lo declarado, la
  dirección que dio la persona se conserva y se emite `negocio.actualizado`.
- Un solo mensaje en web y WhatsApp: "No pudimos confirmar tu RUT con el SII ahora." (`RUT_SIN_CONFIRMAR`,
  `shared/rut.ts`). En la web, `/acceso/rut` responde `sinConfirmar` en vez de error y el formulario sigue a mano.
- Si al cerrar la compra el SII aún no confirmó, la factura sale a su RUT con los datos declarados (`rutParaFactura`).
- `SII_CONSULTA_RUT=falsa` usa la consulta de prueba (solo para pruebas de carga locales).

## Consecuencias
- Nadie queda afuera por el SII. Con una sala grande, quien entra cuando la fila está llena espera 6 s y queda
  declarado; se confirma solo en los minutos siguientes.
- El tope por IP de `/acceso/*` sube de 30 a 600 por minuto: una sala entera comparte la IP del WiFi. El límite que
  protege a cada persona sigue siendo por teléfono. Medición en `docs/hallazgos/20261122-0751-carga-sala-60-compradores.md`.
