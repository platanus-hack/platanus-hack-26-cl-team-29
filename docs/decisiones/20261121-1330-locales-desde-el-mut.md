# Muestra de locales desde el MUT con OpenStreetMap

Fecha: 2026-11-21 13:30
Autor: Jorge Oehrens

## Contexto
El mapa necesitaba los negocios reales de la zona, no solo los de la demo, y la red tiene que verse llena desde el primer momento. Alrededor del MUT hay muchísimos locales: en 3 km, unos 1.600 restaurantes, cafés, almacenes, panaderías y botillerías.

## Decisión
- **Fuente: OpenStreetMap vía Overpass API.** Es gratuita, sin clave, y su licencia (ODbL) permite usar los datos con atribución, que ya está en el mapa. Se descartó extraer datos de Google Maps: sus términos lo prohíben, y su API pide clave y facturación.
- **Siempre una muestra, nunca el catastro completo.** Primero un *reparto*: cada 6 km se busca en un cuadrado de 1,5 km y se toman 8 locales, así la zona de 30 km queda cubierta pronto. Después se *acumula*: celdas de 2 km con 12 locales cada una, del MUT hacia afuera.
- **La muestra de cada celda se elige aquí, no en Overpass.** Overpass con límite devuelve los primeros de su índice espacial, todos en una esquina. Se pide la celda y se eligen locales en un orden fijo que parece al azar (hash del id): la misma celda da siempre la misma muestra.
- **Un explorador corre solo en el servidor** (`server/locales/`): una celda cada 15 s, guarda en Postgres (o en memoria) y emite `locales:evento` con los locales nuevos y el avance. Si se reinicia, sigue desde la última celda guardada.
- **`scripts/explorar-locales.ts`** corre el mismo explorador en una máquina y vuelca la muestra a `data/locales-mut.json`. El servidor carga ese JSON al arrancar si va más adelante que su base, así producción parte con lo ya recorrido.
- No se guardan teléfonos: el repo es público y algunos son números personales de dueños.

## Contrato
- `GET /api/locales` → `{ locales, avance, centro, radioKm }`.
- Socket.io `locales:evento` → `{ nuevos, avance }`. `avance`: `{ celda, total, distanciaKm, fase: 'reparto' | 'acumulando', buscando, terminado }`.
- `LOCALES_EXPLORAR=0` apaga el explorador; `LOCALES_ESPERA_MS` cambia la pausa entre celdas.

## Consecuencias
- El mapa muestra los locales como puntos tenues bajo la red, el cuadrado que se está buscando y un aviso con el avance.
- Siguiente paso, con el dueño de `server/conexion-sii/`: cuando un negocio conecta su SII, su dirección y comuna oficiales se cruzan con el local más cercano de la muestra, que queda identificado con su RUT y razón social.
