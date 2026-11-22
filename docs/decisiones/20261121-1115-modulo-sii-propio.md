# Módulo SII propio y solo en certificación

Fecha: 2026-11-21 11:15
Autor: Luciano Saavedra Reyes

## Contexto
El producto necesita el ciclo de compra completo en el SII: el proveedor emite la factura (33) con la orden de compra como referencia, la guía de despacho (52) y la nota de crédito (61), y el comprador acepta o reclama la factura. Todo el proyecto tiene que ser transparente y sin dependencias ocultas.

Las opciones evaluadas:
- Librerías open source existentes para el SII: las que cubren este ciclo están deprecadas.
- SDK o servicios comerciales, como librería o como servicio: son privados. Usarlos dejaría una parte del producto cerrada y sin transparentar.

## Decisión
Escribimos un módulo SII propio en `server/sii/`. Es de propiedad del equipo: el repo es público para que se pueda revisar, pero no tiene licencia de uso abierta. Cubre solo lo que el ciclo necesita: autenticación, firma XML, timbre, factura, guía, nota de crédito, envío, estado, aceptación y reclamo.

El módulo se escribe con conocimiento previo del equipo en facturación electrónica. Lo dejamos dicho aquí por transparencia: se escribió en el estilo de este repo a partir de la documentación pública del SII y de esa experiencia, y no incluye código privado.

Opera solo contra el ambiente de certificación del SII:
- `maullin.sii.cl`
- `ws2.sii.cl`, servicio de reclamos de certificación

El código no contiene hosts de producción, así que es imposible emitir un documento con validez tributaria por error.

Si faltan las credenciales, el módulo usa una implementación falsa en memoria. Así cualquiera puede correr el proyecto y trabajar en el resto del producto sin certificado digital.

## Consecuencias
- Para operar contra el SII hacen falta, solo por variables de entorno:
  - un certificado digital (`.pfx`) y su clave;
  - un CAF de certificación por tipo de documento;
  - la fecha de resolución de certificación.

  Nada de eso se commitea.
- El resto del monolito usa la interfaz de `server/sii/index.ts`. Nadie llama al SII directo.
- El envío al SII nunca se reintenta automáticamente. Antes de reenviar se consulta el folio, para no duplicar documentos.
- El reclamo solo aplica a facturas y tiene un plazo de 8 días desde que el SII recibe la factura.
- Alternativas descartadas:
  - Depender de una librería deprecada.
  - Usar un servicio privado que el jurado y otros equipos no pueden revisar ni ejecutar.

## Actualización (2026-11-21 22:42): propiedad del módulo
La versión anterior decía que el módulo tenía licencia MIT, pero el repo nunca tuvo un archivo de licencia. El módulo es de propiedad del equipo y se publica solo para revisión. `README.md` y `project-description.md` ya no dicen "open source".
