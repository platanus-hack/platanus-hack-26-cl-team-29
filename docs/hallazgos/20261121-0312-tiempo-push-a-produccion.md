# Tiempo de un push a `main` hasta producción

Fecha: 2026-11-21 03:12
Autor: Luciano Saavedra Reyes

## Contexto
Con el deploy desde el espejo sincronizado, había que saber cuánto tarda un cambio en verse en producción.

## Hallazgo
Medido con un cambio en el frontend: push a `main` a las 03:06, visible en https://app-a2hn.onrender.com a las 03:11. Unos **5 minutos**, sumando la sincronización del espejo y el build de Render. Se verificó comparando el hash del bundle de JS publicado con el del build local.

## Consecuencias
- Para demos y pruebas en producción, considerar ~5 minutos de espera después de mergear, o más si el Action programado de GitHub se atrasa.
- Para verificar un deploy sin entrar a Render: comparar el nombre del bundle en el HTML publicado (`/assets/index-*.js`) con el de `npm run build` local.
