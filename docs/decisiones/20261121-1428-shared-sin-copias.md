# shared/ y chequeo de código copiado

Fecha: 2026-11-21 14:28
Autor: agente sin-copias

## Contexto
Front y back no se importan código, así que la misma lógica se copió en los dos lados: el formato de dinero (tres
versiones, una sin separador para montos de cuatro dígitos en algunas configuraciones), el RUT (cinco validaciones
módulo 11), los tramos de precio, los plurales, los teléfonos, los nombres de los documentos del SII, las fechas en
hora de Chile y los tipos del contrato de "Conectar mi SII". Cada copia se desviaba un poco de las otras.

## Decisión
- `shared/` en la raíz: TypeScript puro (sin dependencias, sin E/S, sin estado, sin DOM ni `node:`), con extensión
  `.ts` en los imports. Lo importan `client/` (Vite lo resuelve sin configuración extra) y `server/` (Node quita tipos).
- Un módulo por tema: `formato.ts` (`dinero`, `miles`, `nota`), `texto.ts` (plurales, conteos, sin tildes),
  `rut.ts`, `telefono.ts`, `fecha.ts`, `precios.ts` (tramos, precio vigente, neto, precio ajustado),
  `documentos.ts` (33, 52, 61), `red.ts` (nombres del contrato), `conexion-sii.ts` (contrato del panel del SII) y
  `canasta-demo.ts` (la canasta por defecto). Cada uno con su test en `test/shared-*.test.ts`.
- `npm run duplicados` corre jscpd (versión fija) sobre `client/`, `server/`, `shared/` y `scripts/` con bloques de
  50 tokens y umbral 0: cualquier copia nueva hace fallar el chequeo, igual que `build` y `test`.

## Consecuencias
- Antes de escribir un helper que pueda servir en los dos lados, se busca en `shared/`. Si algo tiene que vivir en
  los dos lados, va ahí; un re-export desde otro módulo no cuenta como copia.
- Cambios visibles menores al unificar: el PDF muestra `$77.000` en vez de `$ 77.000`; el plural de unidades con
  tilde sale bien en WhatsApp (bidones); "¿Cuántas unidades?" en vez de "¿Cuántos unidades?"; los logs dicen
  "guía de despacho 52"; la hora del límite de sesiones del SII sale en formato de 24 horas.
- Si jscpd marca un falso positivo, se ordena el código para que no se repita; no se sube el umbral.
