# Deploy desde un repo espejo sincronizado automáticamente

Fecha: 2026-11-21 03:05
Autor: Jorge Oehrens

## Contexto
Render solo puede conectarse a repos que pertenecen a la cuenta del usuario. El repo del proyecto pertenece a la organización `platanus-hack`, así que Render no puede deployar desde él.

## Decisión
Render deploya desde un repo espejo personal. Un GitHub Action en el espejo copia `main` de este repo cada ~5 minutos. Todo el trabajo ocurre en el repo de la organización; nadie necesita configurar el espejo en su máquina.

## Consecuencias
- Lo que entra a `main` llega a producción sin intervención manual, en algunos minutos.
- `main` tiene que estar siempre en estado deployable.
- Alternativa descartada: que cada integrante configure un segundo destino de push hacia el espejo. Requería coordinación y permisos individuales.

## Actualización (2026-11-21 13:05)
El Action programado del espejo se atrasaba varios minutos y a veces horas. Ahora el repo de la organización empuja `main` al espejo en cada push (`.github/workflows/espejo.yml`), con el secreto `ESPEJO_TOKEN`: un token de grano fino del dueño del espejo, limitado a ese repo. Sin el secreto, el workflow no hace nada. El Action programado del espejo queda como respaldo.

## Actualización (2026-11-21 14:05): deploy on demand sin espejo
El servicio de Render ahora construye directo desde el repo público de la organización, sin auto-deploy. El workflow `.github/workflows/desplegar.yml` le pide a Render desplegar el commit exacto de cada push a `main` (y se puede correr a mano). Usa los secretos `RENDER_API_KEY` y `RENDER_SERVICE_ID`. El espejo personal deja de ser necesario. Para volver atrás basta con apuntar el servicio de nuevo al espejo y reactivar su auto-deploy.

## Actualización (2026-11-21 14:20): de vuelta al espejo
Seguimos la recomendación de la organización: Render despliega desde el espejo personal, con auto-deploy. El workflow `.github/workflows/espejo.yml` empuja `main` al espejo en cada push, con el secreto `ESPEJO_TOKEN` (token de un integrante con permiso de escritura en el espejo). Se descarta construir desde el repo público de la organización: funcionaba, pero se rompe si el repo pasa a privado.
