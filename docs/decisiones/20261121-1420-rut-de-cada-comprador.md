# Cada comprador entrega su RUT y su factura sale a su nombre

Fecha: 2026-11-21 14:20
Autor: agente rut-comprador

## Contexto
Para que la demo sea real, la factura 33 de cada comprador de la compra conjunta tiene que salir a su propio RUT, con su razón social, giro, dirección y comuna del SII (ambiente de certificación). Antes todas iban al receptor fijo `SII_RUT_RECEPTOR`.

## Decisión
- Nadie se suma sin un RUT válido: `/unirse` y `/app` lo piden en el primer paso ("RUT de tu negocio o persona", formato 12.345.678-5 mientras se escribe) y WhatsApp lo pregunta una vez antes de sumar ("¿Cuál es el RUT de tu negocio?", con o sin puntos y guion). Dígito verificador con módulo 11; un error se reintenta con un mensaje claro.
- El RUT se consulta en el SII por un puerto: `ConsultarContribuyente = (rut) => Promise<{ razonSocial, giro, direccion, comuna, actividades, simulado? } | null>` (`server/red/contribuyente.ts`). La red nunca abre su propia sesión en el portal del SII: la consulta real la entrega el componente compartido de sesión del SII y se pasa a `iniciarRed(db, sii, { consultarContribuyente })`. Sin ella se usa la falsa, que marca sus datos como `simulado`.
- `conCacheYFila` envuelve la consulta: una sola consulta por RUT (también con pedidos simultáneos del mismo RUT), en fila de a una y con 1 s entre inicios. Un error no queda en cache. Además, un RUT ya guardado en un negocio no se vuelve a consultar.
- El RUT y los datos del SII viven en el `Negocio` (`rut`, `contribuyente`), solo internos: el sanitizador único (`server/red/publico.ts`) los quita de la foto pública, eventos y respuestas. Solo el dueño ve a quién sale su factura (`facturaA` en `GET /api/red/yo`). Nunca aparecen en pantallas proyectadas.
- Al facturar, cada documento (33, y también 52 y 61 de esa orden) va al receptor del comprador (`receptorDelComprador`): texto limpio a Latin-1, espacios colapsados y cortado al largo del XSD (razón social 100, giro 40, dirección 70, comuna 20). Sin RUT, con datos simulados o con un campo vacío, se usa el receptor de respaldo `SII_RUT_RECEPTOR`.

## Consecuencias
- `POST /api/red/sesion` y `POST /api/red/licitaciones/:id/unirse` exigen `rut` (400 `datos_invalidos` si falta, es inválido o el SII no lo conoce; 503 `sii_no_disponible` si la consulta falló). `PUT /yo/carrito` y `POST /yo/unirse` exigen que la sesión tenga RUT.
- Mientras la consulta real no esté conectada, las facturas siguen al receptor de respaldo (los datos simulados no se envían al SII).
- El reclamo (RFP) sigue a nombre del receptor de respaldo: el titular del certificado solo está autorizado en esa empresa.
