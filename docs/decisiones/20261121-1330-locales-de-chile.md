# Locales de todo Chile desde OpenStreetMap, mostrados desde el MUT hacia afuera

Fecha: 2026-11-21 13:30
Autor: Jorge Oehrens

## Contexto
El mapa necesitaba los negocios reales, no solo los de la demo, y la meta es cubrir todo Chile para después completar cada local con más datos (scraping de su sitio y cruce con el SII).

## Decisión
- **Fuente: el extracto diario de OpenStreetMap de Chile (Geofabrik, ~350 MB).** Se filtra en local con `osmium` en segundos. Licencia ODbL: se puede usar con atribución, que ya está en el mapa. Se descartó Overpass celda por celda: el servicio público está saturado (502/504 cerca de la mitad de las veces, ~1 celda por minuto), y con ese ritmo Chile tomaría meses. También se descartó extraer datos de Google Maps: sus términos lo prohíben.
- **Catálogo versionado:** `scripts/importar-locales-chile.ts` deja `data/locales-chile.json.gz` (29.680 locales, 0,9 MB): restaurantes, almacenes, comida rápida, cafés, supermercados, panaderías, botillerías, bares, carnicerías, verdulerías, heladerías y mayoristas. No se guardan teléfonos: el repo es público.
- **El explorador muestra el catálogo en vivo, de adentro hacia afuera** (`server/locales/`). Primero un reparto: celdas de 25 km con 6 locales cada una por todo Chile (502 celdas), así el mapa tiene puntos en todas partes pronto. Después acumula: celdas de 2 km con todos sus locales, desde el MUT (2.917 celdas). Una celda cada 1,5 s: el reparto en ~12 min y Chile completo en ~1,5 h.
- La muestra de cada celda del reparto se elige en un orden fijo que parece al azar (hash del id), así queda repartida y es siempre la misma.
- Guarda lo mostrado en Postgres (o en memoria) y sigue desde la última celda tras un reinicio.

## Contrato
- `GET /api/locales` → `{ locales, avance, totalChile }`; cada local viaja con `{ id, nombre, tipo, lat, lng }`.
- Socket.io `locales:evento` → `{ nuevos, avance }`. `avance`: `{ celda, total, distanciaKm, fase: 'reparto' | 'acumulando', buscando, terminado }`.
- `LOCALES_EXPLORAR=0` apaga el explorador; `LOCALES_ESPERA_MS` cambia la pausa entre celdas.

## Consecuencias
- Para actualizar el catálogo: descargar el extracto, correr el importador y commitear el `.json.gz`.
- Con Chile completo, `GET /api/locales` pesa ~2,8 MB. Si molesta, se pide por zona visible.
- Siguientes pasos: un agente que visita el sitio web de cada local (unos 2.500 lo tienen) para completar sus datos, respetando `robots.txt`; y, con el dueño de `server/conexion-sii/`, cruzar la dirección oficial de un negocio que conecta su SII con su local del catálogo.
