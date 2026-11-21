# Cómo se comportan las fuentes de Mercado Público

Fecha: 2026-11-21 15:46
Autor: agente mercado-publico

## Contexto
Para cargar proveedores y precios de referencia (docs/decisiones/20261121-1546-mercado-publico.md) revisamos las tres formas oficiales de leer Mercado Público.

## Hallazgo
**API con ticket** (`https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json`, documentada en https://www.chilecompra.cl/api/ y en el PDF "Diccionario de Datos - Órdenes de Compra"):
- Consultas: `?codigo=` (detalle completo, no depende de la fecha), `?fecha=ddmmaaaa` (todas las del día), `&estado=` (`aceptada`, `todos`, ...), `&CodigoProveedor=` y `&CodigoOrganismo=`. Proveedor por RUT: `Empresas/BuscarProveedor?rutempresaproveedor=70.017.820-k` (RUT con puntos y guion).
- Fechas de la consulta en `ddmmaaaa`; las de la respuesta, `AAAA-MM-DDTHH:MM:SS` sin zona.
- El listado por día trae solo un resumen (`Codigo`, `Nombre`, `CodigoEstado`): para ítems y proveedor hay que pedir cada orden por `codigo`.
- Campos usados: `Listado[].Proveedor.RutSucursal`, `.Nombre`, `.Comuna`, `.Region`; `Comprador.ComunaUnidad`, `.NombreOrganismo`; `Items.Listado[].PrecioNeto` (precio unitario neto), `.Cantidad`, `.Categoria`, `.CodigoProducto`, `.EspecificacionProveedor`. `Unidad` no está en el diccionario.
- Límite: **10.000 consultas diarias por ticket**, no ampliable; restricciones por IP; sugieren cargas masivas entre 22:00 y 07:00. La API rechaza peticiones simultáneas: el cliente hace una por vez, con 1,5 s entre llamadas y reintentos con espera creciente ante HTTP 429/5xx o el código de error de peticiones simultáneas (10500, según reportes de uso; sin ticket no lo pudimos confirmar).
- Estado 9 = cancelada.

**Dataset OCDS anual** (Open Contracting, CC0): `https://data.open-contracting.org/en/publication/144/download?name=2026.jsonl.gz` redirige (302) a fastly; responde `HEAD` con `ETag` y `Last-Modified` (18-nov-2026, 392.636.062 bytes). Un *compiled release* por línea:
- Proveedor en `parties[]` con `identifier.id` = RUT sin guion (`775594268`), `identifier.legalName` y `address.region` (sin comuna).
- Precio en `awards[].items[].unit.value.amount` con `unit.name` (`kilogramo`, `Unidad`, `EA`, `KGM`, `000`, `Global`...). "Global" y "Mes" traen el total del contrato; hay montos de $1 como marcador.
- La categoría con sus niveles va en `tender.items[]` (mismo `id` del ítem); en `awards` va el texto libre.
- Convenio Marco (`-CM` en el ocid, más de la mitad de las líneas) viene con `classification.id = "0"`, sin UNSPSC.
- Los alimentos son pocos: ~1 de cada 150 licitaciones tiene un ítem UNSPSC 50. Filtrar el texto de la línea antes de `JSON.parse` evita parsear casi todo el archivo.
- Muchos proveedores son personas naturales (RUT bajo 50.000.000) y los contactos traen nombres: no se guardan.

**Endpoint OCDS en vivo** (`https://apis.mercadopublico.cl/OCDS/data/listaA%C3%B1oMes/AAAA/MM/offset/limit`): existe y no pide ticket, pero hoy responde HTTP 500 `"Unable to connect to the remote server"` (error interno de ChileCompra al ir a su base). No se implementó porque no se puede ver la forma de su respuesta; queda como siguiente fuente cuando vuelva.

## Consecuencias
- Sin ticket, lo más fresco es el archivo anual, con algunos días de atraso.
- El tope de 100 detalles por día deja la API muy lejos del límite diario.
