# Ruta de reparto del proveedor, con sus guías de despacho

Fecha: 2026-11-21 19:55
Autor: ruta-reparto

## Contexto
Después de vender en una compra conjunta, el proveedor tiene que llevar la mercadería a muchos negocios a la vez. Hoy
no veía dónde estaban ni en qué orden ir, y la compra conjunta factura en lote solo con facturas 33: la guía de
despacho (52), que acompaña la mercadería, salía solo en los pedidos sueltos.

## Decisión
- **Sección "Ruta de reparto" en `/proveedor`.** Aparece cuando hay pedidos por entregar (`confirmada` o `facturada`):
  un mapa con la ruta, cifras (paradas, km, tiempo manejando) y la hoja de ruta en orden. Una parada por negocio, con lo
  que lleva y sus guías (folio, estado en el SII y PDF). Se actualiza sola cuando cambian los pedidos o sus guías.
- **Orden óptimo en el servidor** (`server/reparto`, `GET /api/red/proveedor/ruta`, solo con sesión del proveedor).
  Circuito que sale de la bodega y vuelve a ella:
  - Por calles con OSRM (`/trip`, servidor público sin key), con caché y timeout de 4 s.
  - Si OSRM no responde, `ordenarParadas` de `shared/ruta.ts` (vecino más cercano y 2-opt) en línea recta, con el
    tiempo estimado a 25 km/h y 30 % más de recorrido. La pantalla dice cuál de los dos se usó.
- **Dónde queda cada negocio.** Su dirección del SII geocodificada con Nominatim: una consulta por segundo, User-Agent
  genérico, caché, y como mucho 3 s de espera por respuesta (lo que no alcanza queda en caché para la siguiente). Sin
  dirección, o mientras no se ubica, el punto de su comuna de siempre (`ubicarEnComuna`), marcado como aproximado.
  La bodega es la dirección del proveedor o, sin ella, el centro de su comuna.
- **Guías 52 desde la ruta.** "Emitir N guías de despacho" (`POST /api/red/proveedor/ruta/guias`, con `confirmado`)
  emite la guía de cada pedido por entregar que no la tiene, una por una con la sesión del SII de siempre
  (`emitirGuiasDeReparto` del dominio). Si falla a mitad, se vuelve a llamar y sigue con las que faltan; nunca duplica.
- **"Abrir en Google Maps"**: enlace `google.com/maps/dir` con la ruta en orden, sin API key. Google acepta hasta 9
  paradas intermedias; con más, el enlace lleva las primeras 9 y la pantalla lo dice.
- **Entregado:** no hay un botón nuevo. La entrega la confirma el comprador con su recepción (conforme o con faltante),
  que ya existe y saca el pedido de la ruta en vivo.
- **Privacidad:** las direcciones solo van al proveedor con sesión, a Nominatim y a OSRM (coordenadas). Nunca en la
  foto pública, en eventos, en URL de nuestra API ni en los logs.
- `REPARTO_CALLES=0` y `REPARTO_GEOCODIFICAR=0` apagan cada servicio externo.

## Consecuencias
- El mapa usa el arranque común de `client/src/mapa/base.ts` y se carga aparte (lazy), así MapLibre no pesa en el resto
  del panel.
- `distanciaKm` pasa a `shared/ubicacion.ts`; `server/locales/osm.ts` la reexporta.
