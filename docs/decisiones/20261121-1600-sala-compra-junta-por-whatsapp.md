# La sala compra junta por WhatsApp: onboarding, cascada con freno y facturación con un solo sí

Fecha: 2026-11-21 16:00
Autor: sala-whatsapp

## Contexto
En la demo todo el público escribe al mismo número de WhatsApp para sumarse a una compra conjunta. Son 30 a 80 personas escribiendo a la vez, el precio baja por tramos y al cierre el proveedor factura todas las órdenes en el SII de certificación. Hay que avisar a todos sin spamear y sin que una ráfaga sature el envío.

## Decisión
- `server/agente/sala.ts` atiende a los teléfonos que la red no conoce como público de la compra abierta: bienvenida corta, nombre y cantidad en uno o dos mensajes, y confirmación con el precio, el ahorro y lo que falta para el siguiente tramo. Sumarse no tiene efecto legal, así que no pide un sí. Nunca se pide RUT.
- El agente activa la sala solo si la red expone `licitacionAbierta`, `unirseALicitacion`, `confirmarOrdenesDeLicitacion`, `telefonoDeNegocio` y `escuchar` (`tieneSala` en `puerto.ts`). Sin ellas sigue igual que antes; no hace falta cambiar `server/index.ts`.
- Producto, unidad y plural vienen de la licitación (`unidad`, `unidadPlural`), nunca del código. El tope por negocio es 20 (opción `cantidadMaxima`).
- Intérprete: primero reglas (rápidas y deterministas, cubren "Almacén Rosita, 4", "4 cajas, Panadería Sol", "somos X y queremos 3", solo el nombre o solo el número, "3 rollos" como cajas). Si las reglas no sacan nada de un mensaje largo o es una pregunta, y hay `ANTHROPIC_API_KEY`, lo clasifica Claude con la herramienta `datos_para_sumarse` (límite de 8 s, si falla vuelve a reglas). "80 rollos" (más que el tope) no se adivina: se pregunta.
- Cascada: las bajas de precio dentro de 1,5 s se agrupan y sale solo la última. Cada teléfono recibe a lo más una difusión cada 5 s; si llega otra antes, se guarda la última y sale al cumplirse el plazo. Todos los envíos masivos pasan por un limitador de 5 en vuelo (el módulo de WhatsApp ya reintenta cada envío).
- Cierre: si el dominio no cierra al llegar `cierraEn`, el agente llama a `cerrarLicitacion`. Con `licitacion.cerrada` le pregunta al proveedor (teléfono por `telefonoDeNegocio`, si no `DEMO_TELEFONO_PROVEEDOR`) usando la misma cola de confirmaciones del agente: se factura solo tras un sí, la pendiente sale de la cola antes de ejecutar y `facturar` es idempotente por licitación. Un "todavía no" seguido de "sí" vuelve a preguntar, no factura de golpe.
- Folio: con cada `documento.emitido` (33) de una orden de la compra, el comprador recibe folio, cantidad, precio, total y ahorro. Con `documento.actualizado` aceptado dentro de 60 s (`SALA_AVISO_ACEPTADA_MS`, 0 lo apaga) recibe "El SII aceptó tu factura folio N.", una sola vez.
- Robustez: los mensajes de un mismo teléfono se procesan en orden y de a uno (además de lo que ya garantiza el módulo de WhatsApp); cualquier error responde un mensaje corto y se loguea. Los logs enmascaran los teléfonos (`***123`).
- Si existe `PUBLIC_URL`, la bienvenida agrega "También puedes sumarte en <PUBLIC_URL>/app".

## Consecuencias
- El estado de la conversación de la sala (borradores y participantes) vive en memoria del proceso; tras un reinicio, la red sigue teniendo a los participantes y un mensaje nuevo del mismo teléfono vuelve a la bienvenida. `red.reiniciada` limpia ese estado.
- El dominio debe crear una orden por participante de WhatsApp y resolver su teléfono con `telefonoDeNegocio(orden.compradorId)` (o traer `negocioId` y `telefono` en los participantes) para que llegue el folio.
