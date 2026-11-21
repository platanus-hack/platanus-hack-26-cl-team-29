# Proveedores reales por WhatsApp, cada uno con su SII

Fecha: 2026-11-21 15:55
Autor: javier-proveedores

## Contexto
Para probar la red de punta a punta sin datos ficticios, tres personas con WhatsApp tienen que poder ser compradores y
proveedores a la vez. Hasta ahora había un solo proveedor real (fijo por variables de entorno), rivales ficticios que
ofertaban solos y una única conexión al SII. `20261121-1529-pedido-dividido-entre-proveedores.md` dejó diseñado el pedido
dividido cuando ganan varios proveedores; esto lo construye.

## Decisión
- **Ficticios detrás de `DEMO_FICTICIOS=1`**, apagado por defecto: sin él, la red parte solo con la compra conjunta
  abierta, sin proveedor fijo ni rivales. Con él, la demo de siempre.
- **Rol doble.** `Negocio.vende`: quien se registra como proveedor por WhatsApp vende y también compra (`puedeVender`,
  `puedeComprar` en shared/red.ts). Conserva su `rol` principal para las pantallas.
- **Registro de proveedor por WhatsApp, siempre con certificado digital**: "Vender" (o "quiero vender") manda el link
  privado al certificado; sin certificado no avanza. Con él, elige si factura con su RUT o con el de una empresa en que
  está autorizado. Se registra y su conexión al SII parte en segundo plano (ficha, resolución y folios); se le avisa por
  WhatsApp cuando queda lista o por qué no.
- **Productos de proveedores**: "vendo café molido 1 kg a $12.000 la bolsa" suma el producto a la canasta abierta con
  tramos automáticos (5 % menos desde 10, 10 % desde 25 y 15 % desde 50). Sus tramos son la oferta por volumen del creador.
- **Ofertas por WhatsApp**: "oferto $25.000 por rollos". Ofertar y sumar un producto son compromisos: piden un sí, como
  todo lo que tiene efecto. Quien iba ganando recibe un aviso cuando lo superan.
- **Ganador por producto** (puntos 1, 2, 3 y 5 de la decisión de Luciano): gana la mejor oferta ajustada por nota y plazo.
  Nadie se compra a sí mismo: las líneas de un participante que también ganó van a la siguiente mejor oferta (sin otra,
  quedan fuera). Una orden por participante y proveedor; cada proveedor dice que sí y factura solo lo suyo, en un sobre
  con su emisor. El cierre lo hace el agente al llegar `cierraEn` o un administrador con `DEMO_TOKEN`.
- **Una conexión al SII por empresa** (`sii_conexion` con id `rut:<rut>`; la del panel sigue en `proveedor`). Cada
  documento sale con la conexión de quien lo emite; sin una completa, con el SII falso. Si la empresa es la misma del
  panel, se usa esa conexión (nunca dos conexiones gastan el mismo CAF). `sii_folios` lleva `rut_emisor` en la llave:
  los folios de dos empresas no chocan; las filas de antes quedan con `''` (la del panel).
- **El registro a medias sobrevive a un reinicio**: lo que cada teléfono lleva a medias (registro, carrito, registro de
  proveedor) se guarda en `agente_borradores`. Antes, un deploy en medio del registro devolvía el saludo.

- **Salida de prueba sin certificado** (`DEMO_PROVEEDOR_SIN_CERTIFICADO=1`, apagada por defecto): para probar la red sin
  certificados, quien se registra como proveedor puede escribir su RUT en vez de subir el certificado. Queda sin conexión
  al SII y sus facturas salen simuladas; el mensaje se lo dice. En uso real el certificado es obligatorio.

## Consecuencias
- Para emitir en certificación, la empresa del proveedor tiene que estar postulada como emisor electrónico en maullin y el
  titular del certificado autorizado en ella. Si no, la conexión queda con el motivo del SII y sus facturas salen simuladas.
- Pendiente (punto 4 de la decisión de Luciano): sumar un costo de despacho por proveedor al elegir ganadores, para no
  premiar pedidos muy fragmentados.
- El panel web del proveedor sigue siendo solo el del proveedor de la demo (`PROVEEDOR_CODIGO`); los proveedores reales
  operan por WhatsApp. Actualizado: ahora cada proveedor entra al panel con su WhatsApp y un código
  (docs/decisiones/20261121-1950-entrar-con-codigo-por-whatsapp.md) y `PROVEEDOR_CODIGO` ya no existe.
