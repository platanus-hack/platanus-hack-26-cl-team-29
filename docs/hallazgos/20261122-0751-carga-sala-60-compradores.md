# Carga: 60 compradores sumándose a la vez

Fecha: 2026-11-22 07:51
Autor: registro-resiliente

## Contexto
Antes de la demo, medir si el público puede sumarse en masa sin errores. `npm run carga` levanta un backend propio en
el puerto 3200 (memoria, SII y WhatsApp falsos, `SII_CONSULTA_RUT=falsa`, tarjeta no obligatoria) y simula 60
compradores que llegan en 5 s: piden código (leído del log del WhatsApp falso), entran, se registran con RUT ficticios
válidos y arman su carrito, con 3 pantallas escuchando el socket. Después el proveedor de la demo cierra y factura.

## Hallazgo
Con el tope anterior de 30 pedidos por minuto por IP en `/acceso/*`, una sala en el mismo WiFi (una IP pública) se
bloqueaba: 60 personas hacen unos 180 pedidos de acceso en segundos. Subido a 600 por minuto.

Resultado con el ajuste (MacBook, una corrida):

| Paso | n | p50 ms | p95 ms | máx ms | errores |
|---|---|---|---|---|---|
| Pedir código | 60 | 3 | 9 | 10 | 0 |
| Entrar (número nuevo) | 60 | 1 | 2 | 3 | 0 |
| Registrarse | 60 | 6.002 | 6.005 | 6.006 | 0 |
| Sumarse (carrito) | 60 | 4 | 6 | 7 | 0 |
| Cerrar la compra | 1 | 9 | 9 | 9 | 0 |
| Facturar todo (60 facturas, SII falso) | 1 | 283 | 283 | 283 | 0 |

- 60 de 60 se sumaron, 0 errores, 60 órdenes al cerrar; las unidades del estado final cuadran con lo pedido.
- Las 3 pantallas recibieron 1.068 eventos en vivo.
- El cuello es el registro: la fila de consultas de RUT va de a una por segundo, así que con 60 llegando en 5 s casi
  todos esperan el tope de 6 s y quedan declarados; se confirman solos después (ver la decisión del registro).

## Consecuencias
- Para la demo: pedir al público que escanee de a poco no hace falta; el registro tarda como máximo 6 s.
- El SII real (maullin) no se midió: facturar 60 en el SII de certificación depende de su latencia y va en un solo envío.
