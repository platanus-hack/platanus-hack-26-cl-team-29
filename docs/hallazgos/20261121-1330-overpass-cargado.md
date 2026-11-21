# Overpass API pública: lenta y con errores frecuentes

Fecha: 2026-11-21 13:30
Autor: Jorge Oehrens

## Contexto
El explorador de locales consulta `overpass-api.de` celda por celda.

## Hallazgo
- Una consulta mínima (3 cafés en 300 m) tardó 37 s. Las celdas responden con 502 o 504 cerca de la mitad de las veces.
- Los espejos públicos `overpass.private.coffee` y `overpass.kumi.systems` no respondieron en 40 s.
- Una celda de 6 km en el centro de Santiago pide demasiado y falla siempre; un cuadrado de 1,5 km responde.
- Con límite (`out center tags 8`), Overpass devuelve los primeros de su índice espacial: todos en una esquina de la celda.
- Ritmo real con reintentos: cerca de una celda por minuto.

## Consecuencias
- El explorador reintenta la misma celda con una espera 4 veces mayor y nunca se salta celdas.
- El reparto inicial (~100 celdas) tarda cerca de una hora y media; la muestra acumulada hasta 30 km, varias horas. Por eso la muestra se versiona en `data/locales-mut.json` y producción parte desde ahí.
